#!/usr/bin/env node

/**
 * Kuse AI MCP Server
 *
 * Exposes every endpoint of the Kuse AI platform (api.kuse.ai) as an MCP tool.
 * Tool definitions are auto-generated from the official OpenAPI spec.
 *
 * Environment variables:
 *   KUSE_ACCESS_TOKEN  – Bearer token for authenticated requests
 *   KUSE_API_BASE_URL  – Override the default API base URL (https://api.kuse.ai)
 *
 * Usage (stdio transport):
 *   KUSE_ACCESS_TOKEN=<token> node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { KuseClient } from "./client.js";
import {
  generateTools,
  executeTool,
  type OpenAPISpec,
  type ToolDef,
} from "./tool-gen.js";

// Dynamically import the OpenAPI spec (bundled as JSON)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const openApiSpec: OpenAPISpec = require("./openapi.json");

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

const client = new KuseClient({
  apiBaseUrl: process.env["KUSE_API_BASE_URL"],
  accessToken: process.env["KUSE_ACCESS_TOKEN"],
});

const allTools = generateTools(openApiSpec);

// Build a quick lookup map: tool name → ToolDef
const toolMap = new Map<string, ToolDef>();
for (const t of allTools) {
  toolMap.set(t.name, t);
}

/* ------------------------------------------------------------------ */
/*  MCP Server                                                         */
/* ------------------------------------------------------------------ */

const server = new McpServer({
  name: "kuse-ai",
  version: "1.0.0",
});

// ---------- Meta tool: list available tools by category ----------

server.tool(
  "kuse_list_tools",
  "List all available Kuse AI tools, optionally filtered by tag/category. " +
    "Tags include: auth, boards, dashboard, block, file, library, projects, " +
    "conversations, credits, payment, tenants, invitations, roles, mcp, " +
    "notifications, admin, agents, promo, brush, summary, suggestions, video, " +
    "survey, student, dispute, events, task, knsh, board-migration, " +
    "whitelist-admin, doit.",
  { tag: z.string().optional().describe("Filter tools by API tag/category") },
  async ({ tag }) => {
    let filtered = allTools;
    if (tag) {
      const lowerTag = tag.toLowerCase();
      filtered = allTools.filter((t) =>
        t._meta.tags.some((tg) => tg.toLowerCase() === lowerTag),
      );
    }

    const lines = filtered.map(
      (t) =>
        `${t.name}  [${t._meta.method} ${t._meta.pathTemplate}]  ${t._meta.tags.join(",")}`,
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `${filtered.length} tools${tag ? ` (tag: ${tag})` : ""}:\n\n${lines.join("\n")}`,
        },
      ],
    };
  },
);

// ---------- Meta tool: authenticate ----------

server.tool(
  "kuse_login",
  "Authenticate with the Kuse AI platform using email and password. " +
    "Returns an access token that will be used for subsequent requests.",
  {
    email: z.string().describe("Kuse account email"),
    password: z.string().describe("Kuse account password"),
  },
  async ({ email, password }) => {
    try {
      const result = await client.login(email, password);
      // Extract token from response
      const data = result.data as Record<string, unknown>;
      const token =
        (data?.["access_token"] as string) ??
        (data?.["token"] as string) ??
        (data?.["data"] as Record<string, unknown>)?.["access_token"];

      if (token && typeof token === "string") {
        client.setAccessToken(token);
        return {
          content: [
            {
              type: "text" as const,
              text: `Authenticated successfully. Token set for this session.\nResponse: ${JSON.stringify(data, null, 2)}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Login response (HTTP ${result.status}):\n${JSON.stringify(result.data, null, 2)}\n\nNote: could not auto-extract token. If the response contains a token, set it via KUSE_ACCESS_TOKEN env var.`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Login error: ${message}` }],
      };
    }
  },
);

// ---------- Meta tool: set token manually ----------

server.tool(
  "kuse_set_token",
  "Manually set the Bearer access token for authenticated Kuse API requests.",
  {
    token: z.string().describe("Bearer access token"),
  },
  async ({ token }) => {
    client.setAccessToken(token);
    return {
      content: [
        { type: "text" as const, text: "Access token updated for this session." },
      ],
    };
  },
);

// ---------- Register every OpenAPI endpoint as an MCP tool ----------

for (const tool of allTools) {
  // Build a Zod schema dynamically from the tool's inputSchema
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = tool.inputSchema.properties ?? {};
  const requiredSet = new Set(tool.inputSchema.required ?? []);

  for (const [key, schemaDef] of Object.entries(props)) {
    let field: z.ZodTypeAny;

    switch (schemaDef.type) {
      case "integer":
      case "number":
        field = z.number().describe(schemaDef.description ?? key);
        break;
      case "boolean":
        field = z.boolean().describe(schemaDef.description ?? key);
        break;
      case "array":
        field = z.array(z.any()).describe(schemaDef.description ?? key);
        break;
      case "object":
        field = z.record(z.any()).describe(schemaDef.description ?? key);
        break;
      default:
        // string, or unknown → treat as string
        if (schemaDef.enum && Array.isArray(schemaDef.enum)) {
          const values = schemaDef.enum.map(String);
          if (values.length > 0) {
            field = z.enum(values as [string, ...string[]]).describe(schemaDef.description ?? key);
          } else {
            field = z.string().describe(schemaDef.description ?? key);
          }
        } else {
          field = z.string().describe(schemaDef.description ?? key);
        }
    }

    if (!requiredSet.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  server.tool(
    tool.name,
    tool.description,
    shape,
    async (args: Record<string, unknown>) => {
      return executeTool(client, tool, args);
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Kuse AI MCP Server running (${allTools.length} API tools + 3 meta tools)`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
