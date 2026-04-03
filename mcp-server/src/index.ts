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
 *   MCP_TRANSPORT      – "stdio" (default) or "http"
 *   PORT               – HTTP port when using http transport (default: 3000)
 *
 * Usage (stdio transport):
 *   KUSE_ACCESS_TOKEN=<token> node dist/index.js
 *
 * Usage (HTTP transport for Railway / remote deployment):
 *   MCP_TRANSPORT=http PORT=3000 node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

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

const apiBaseUrl = process.env["KUSE_API_BASE_URL"];
const defaultAccessToken = process.env["KUSE_ACCESS_TOKEN"];

// Singleton client for stdio mode (single session)
const stdioClient = new KuseClient({
  apiBaseUrl: apiBaseUrl,
  accessToken: defaultAccessToken,
});

const allTools = generateTools(openApiSpec);

// Build a quick lookup map: tool name → ToolDef
const toolMap = new Map<string, ToolDef>();
for (const t of allTools) {
  toolMap.set(t.name, t);
}

/* ------------------------------------------------------------------ */
/*  MCP Server (used for stdio mode)                                   */
/* ------------------------------------------------------------------ */

const server = new McpServer({
  name: "kuse-ai",
  version: "1.0.0",
});

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

const transportMode = (process.env["MCP_TRANSPORT"] ?? "stdio").toLowerCase();

async function startStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Kuse AI MCP Server running on stdio (${allTools.length} API tools + 3 meta tools)`,
  );
}

async function startHttp(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "3000", 10);

  // Track transports by session ID for stateful connections
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
    // CORS headers for browser-based clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        server: "kuse-ai-mcp",
        tools: allTools.length + 3,
        transport: "streamable-http",
      }));
      return;
    }

    // MCP endpoint
    if (req.url === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Parse the request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
          return;
        }

        // Check if this is an initialization request
        const isInit = Array.isArray(body)
          ? body.some((m: { method?: string }) => (m as { method?: string }).method === "initialize")
          : (body as { method?: string }).method === "initialize";

        if (isInit) {
          // Create a new transport + server for this session
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          const sessionServer = new McpServer({
            name: "kuse-ai",
            version: "1.0.0",
          });

          // Each HTTP session gets its own KuseClient to isolate auth tokens
          const sessionClient = new KuseClient({
            apiBaseUrl: apiBaseUrl,
            accessToken: defaultAccessToken,
          });

          // Register all tools on this session server with its own client
          registerTools(sessionServer, sessionClient);

          await sessionServer.connect(transport);

          // handleRequest generates the session ID
          await transport.handleRequest(req, res, body);

          // Store transport by session ID after initialization
          const sid = transport.sessionId;
          if (sid) {
            transports.set(sid, transport);
            transport.onclose = () => {
              transports.delete(sid);
            };
          }
          return;
        }

        // Existing session
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, body);
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No valid session. Send an initialize request first." }));
        return;
      }

      if (req.method === "GET") {
        // SSE stream for server-initiated messages
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No valid session ID" }));
        return;
      }

      if (req.method === "DELETE") {
        // Session termination
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      console.error("HTTP handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(
      `Kuse AI MCP Server running on http://0.0.0.0:${port}/mcp (${allTools.length} API tools + 3 meta tools)`,
    );
  });
}

/**
 * Register all tools (meta + API) on a given McpServer instance.
 * Used by HTTP transport to create per-session servers.
 */
function registerTools(srv: McpServer, kuseClient: KuseClient): void {
  // Meta tool: list tools
  srv.tool(
    "kuse_list_tools",
    "List all available Kuse AI tools, optionally filtered by tag/category.",
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
        (t) => `${t.name}  [${t._meta.method} ${t._meta.pathTemplate}]  ${t._meta.tags.join(",")}`,
      );
      return {
        content: [{ type: "text" as const, text: `${filtered.length} tools${tag ? ` (tag: ${tag})` : ""}:\n\n${lines.join("\n")}` }],
      };
    },
  );

  // Meta tool: login
  srv.tool(
    "kuse_login",
    "Authenticate with the Kuse AI platform using email and password.",
    { email: z.string().describe("Kuse account email"), password: z.string().describe("Kuse account password") },
    async ({ email, password }) => {
      try {
        const result = await kuseClient.login(email, password);
        const data = result.data as Record<string, unknown>;
        const token =
          (data?.["access_token"] as string) ??
          (data?.["token"] as string) ??
          (data?.["data"] as Record<string, unknown>)?.["access_token"];
        if (token && typeof token === "string") {
          kuseClient.setAccessToken(token);
          return { content: [{ type: "text" as const, text: `Authenticated successfully.\nResponse: ${JSON.stringify(data, null, 2)}` }] };
        }
        return { content: [{ type: "text" as const, text: `Login response (HTTP ${result.status}):\n${JSON.stringify(result.data, null, 2)}` }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Login error: ${message}` }] };
      }
    },
  );

  // Meta tool: set token
  srv.tool(
    "kuse_set_token",
    "Manually set the Bearer access token for authenticated Kuse API requests.",
    { token: z.string().describe("Bearer access token") },
    async ({ token }) => {
      kuseClient.setAccessToken(token);
      return { content: [{ type: "text" as const, text: "Access token updated for this session." }] };
    },
  );

  // Register all API tools
  for (const tool of allTools) {
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

    srv.tool(
      tool.name,
      tool.description,
      shape,
      async (args: Record<string, unknown>) => {
        return executeTool(kuseClient, tool, args);
      },
    );
  }
}

async function main(): Promise<void> {
  if (transportMode === "http") {
    await startHttp();
  } else {
    // Register tools on the default server for stdio mode
    registerTools(server, stdioClient);
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
