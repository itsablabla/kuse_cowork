/**
 * Generates MCP tool definitions from the Kuse OpenAPI spec.
 *
 * Each API endpoint becomes an MCP tool.  Tool names are derived from the
 * operationId (or synthesised from method + path).  The JSON-Schema for the
 * tool's inputSchema is built from the endpoint's query/path parameters and
 * request body.
 */

import { z } from "zod";
import type { KuseClient } from "./client.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: { schemas?: Record<string, JSONSchema> };
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JSONSchema }>;
  };
  responses?: Record<string, unknown>;
}

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: JSONSchema;
  description?: string;
}

// Minimal JSON-Schema subset used by the OpenAPI spec
export interface JSONSchema {
  type?: string;
  $ref?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  title?: string;
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  format?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /** runtime metadata used to dispatch the request */
  _meta: {
    method: string;
    pathTemplate: string;
    pathParams: string[];
    queryParams: string[];
    hasBody: boolean;
    tags: string[];
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch"]);

/** Turn an operationId (or method+path) into a safe MCP tool name. */
function toToolName(operationId: string | undefined, method: string, path: string): string {
  if (operationId) {
    // Truncate overly verbose auto-generated FastAPI operation IDs
    // e.g. "get_users_me_api_users_me_get" → keep as-is but strip trailing _method
    let name = operationId;
    const suffix = `_${method}`;
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
    }
    // Remove repeated api_ prefix
    name = name.replace(/^api_/, "");
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 64);
  }
  // Fallback: synthesise from method + path
  const slug = path
    .replace(/^\/api\//, "")
    .replace(/\{[^}]+\}/g, "by_id")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${method}_${slug}`.substring(0, 64);
}

/** Resolve a $ref to its schema in the components section. */
function resolveRef(ref: string, components: Record<string, JSONSchema>): JSONSchema {
  const name = ref.replace("#/components/schemas/", "");
  return components[name] ?? { type: "object" };
}

/** Recursively resolve $ref in a schema (one level deep to avoid cycles). */
function resolveSchema(schema: JSONSchema, components: Record<string, JSONSchema>, depth = 0): JSONSchema {
  if (depth > 3) return schema;
  if (schema.$ref) {
    return resolveSchema(resolveRef(schema.$ref, components), components, depth + 1);
  }
  if (schema.allOf) {
    // Merge all schemas
    const merged: JSONSchema = { type: "object", properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const resolved = resolveSchema(sub, components, depth + 1);
      if (resolved.properties) {
        merged.properties = { ...merged.properties, ...resolved.properties };
      }
      if (resolved.required) {
        merged.required = [...(merged.required ?? []), ...resolved.required];
      }
    }
    return merged;
  }
  if (schema.anyOf) {
    // Pick the first non-null variant
    for (const sub of schema.anyOf) {
      if (sub.type !== "null" && sub.type !== undefined) {
        return resolveSchema(sub, components, depth + 1);
      }
      if (sub.$ref) {
        return resolveSchema(sub, components, depth + 1);
      }
    }
  }
  // Resolve nested properties
  if (schema.properties) {
    const resolved: Record<string, JSONSchema> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      resolved[k] = resolveSchema(v, components, depth + 1);
    }
    return { ...schema, properties: resolved };
  }
  if (schema.items) {
    return { ...schema, items: resolveSchema(schema.items, components, depth + 1) };
  }
  return schema;
}

/** Map an OpenAPI type to a simple JSON-Schema type string. */
function paramTypeToSchema(param: OpenAPIParameter): JSONSchema {
  const s = param.schema ?? {};
  return {
    type: s.type ?? "string",
    description: param.description ?? undefined,
    ...(s.enum ? { enum: s.enum } : {}),
    ...(s.default !== undefined ? { default: s.default } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  Generator                                                          */
/* ------------------------------------------------------------------ */

export function generateTools(spec: OpenAPISpec): ToolDef[] {
  const components = spec.components?.schemas ?? {};
  const tools: ToolDef[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = operation as OpenAPIOperation;

      const name = toToolName(op.operationId, method, path);
      const description = [
        `[${method.toUpperCase()} ${path}]`,
        op.summary ?? "",
        op.description ?? "",
      ]
        .filter(Boolean)
        .join(" — ")
        .substring(0, 1024);

      // Build input schema from parameters + request body
      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];

      for (const param of op.parameters ?? []) {
        if (param.in === "path") {
          pathParams.push(param.name);
          properties[param.name] = paramTypeToSchema(param);
          required.push(param.name); // path params always required
        } else if (param.in === "query") {
          queryParams.push(param.name);
          properties[param.name] = paramTypeToSchema(param);
          if (param.required) required.push(param.name);
        }
      }

      // Request body
      let hasBody = false;
      const bodyContent = op.requestBody?.content;
      if (bodyContent) {
        const jsonSchema = bodyContent["application/json"]?.schema;
        if (jsonSchema) {
          hasBody = true;
          const resolved = resolveSchema(jsonSchema, components);
          // Flatten body properties into the tool input
          if (resolved.properties) {
            for (const [k, v] of Object.entries(resolved.properties)) {
              // Prefix with body_ if it collides with a param name
              const key = properties[k] ? `body_${k}` : k;
              properties[key] = resolveSchema(v, components);
            }
            if (resolved.required) {
              for (const r of resolved.required) {
                const key = pathParams.includes(r) || queryParams.includes(r) ? `body_${r}` : r;
                required.push(key);
              }
            }
          } else {
            // Opaque body — accept it as a "body" property
            properties["body"] = {
              type: "object",
              description: "Request body (JSON)",
            };
          }
        }
        // Handle multipart (file upload) — accept file_path
        const multipartSchema = bodyContent["multipart/form-data"]?.schema;
        if (multipartSchema && !jsonSchema) {
          hasBody = true;
          const resolved = resolveSchema(multipartSchema, components);
          if (resolved.properties) {
            for (const [k, v] of Object.entries(resolved.properties)) {
              properties[k] = resolveSchema(v, components);
            }
          }
        }
      }

      const inputSchema: JSONSchema = {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };

      tools.push({
        name,
        description,
        inputSchema,
        _meta: {
          method: method.toUpperCase(),
          pathTemplate: path,
          pathParams,
          queryParams,
          hasBody,
          tags: op.tags ?? [],
        },
      });
    }
  }

  return tools;
}

/* ------------------------------------------------------------------ */
/*  Executor                                                           */
/* ------------------------------------------------------------------ */

/**
 * Execute a tool call by dispatching an HTTP request to the Kuse API.
 */
export async function executeTool(
  client: KuseClient,
  tool: ToolDef,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { method, pathTemplate, pathParams, queryParams, hasBody } = tool._meta;

  // Substitute path parameters
  let resolvedPath = pathTemplate;
  for (const p of pathParams) {
    const val = args[p];
    if (val === undefined || val === null) {
      return {
        content: [{ type: "text", text: `Error: missing required path parameter "${p}"` }],
      };
    }
    resolvedPath = resolvedPath.replace(`{${p}}`, encodeURIComponent(String(val)));
  }

  // Collect query params
  const query: Record<string, string> = {};
  for (const q of queryParams) {
    if (args[q] !== undefined && args[q] !== null) {
      query[q] = String(args[q]);
    }
  }

  // Collect body (everything that isn't a path/query param)
  let body: unknown = undefined;
  if (hasBody) {
    const reserved = new Set([...pathParams, ...queryParams]);
    // If user passed a top-level "body" key, use it directly
    if (args["body"] !== undefined && typeof args["body"] === "object") {
      body = args["body"];
    } else {
      const bodyObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (!reserved.has(k) && v !== undefined && v !== null) {
          // Remove body_ prefix if added during generation
          const originalKey = k.startsWith("body_") ? k.slice(5) : k;
          bodyObj[originalKey] = v;
        }
      }
      if (Object.keys(bodyObj).length > 0) {
        body = bodyObj;
      }
    }
  }

  try {
    const result = await client.request(method, resolvedPath, { query, body });
    const text =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data, null, 2);
    return {
      content: [
        {
          type: "text",
          text: `HTTP ${result.status}\n${text}`,
        },
      ],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
    };
  }
}
