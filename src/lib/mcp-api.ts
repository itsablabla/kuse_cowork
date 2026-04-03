import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri-api";

export interface MCPServerConfig {
  id: string;
  name: string;
  server_url: string;
  oauth_client_id?: string;
  oauth_client_secret?: string;
  custom_headers?: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MCPTool {
  server_id: string;
  name: string;
  description: string;
  input_schema: any;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  status: "Connected" | "Disconnected" | "Connecting" | "Error";
  tools: MCPTool[];
  last_error?: string;
}

export interface MCPToolCall {
  server_id: string;
  tool_name: string;
  parameters: any;
}

export interface MCPToolResult {
  success: boolean;
  result: any;
  error?: string;
}

const MCP_STORAGE_KEY = "kuse-cowork-mcp-servers";

function getMCPServersFromStorage(): MCPServerConfig[] {
  const stored = localStorage.getItem(MCP_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveMCPServersToStorage(servers: MCPServerConfig[]): void {
  localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers));
}

export async function listMCPServers(): Promise<MCPServerConfig[]> {
  if (!isTauri()) {
    return getMCPServersFromStorage();
  }
  return invoke("list_mcp_servers");
}

export async function saveMCPServer(config: MCPServerConfig): Promise<void> {
  if (!isTauri()) {
    const servers = getMCPServersFromStorage();
    const idx = servers.findIndex(s => s.id === config.id);
    if (idx >= 0) {
      servers[idx] = config;
    } else {
      servers.push(config);
    }
    saveMCPServersToStorage(servers);
    return;
  }
  return invoke("save_mcp_server", { config });
}

export async function deleteMCPServer(id: string): Promise<void> {
  if (!isTauri()) {
    const servers = getMCPServersFromStorage();
    saveMCPServersToStorage(servers.filter(s => s.id !== id));
    return;
  }
  return invoke("delete_mcp_server", { id });
}

export async function connectMCPServer(id: string): Promise<void> {
  if (!isTauri()) {
    // Web mode: MCP connections require Tauri backend
    throw new Error("MCP server connections require the desktop app");
  }
  return invoke("connect_mcp_server", { id });
}

export async function disconnectMCPServer(id: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("MCP server connections require the desktop app");
  }
  return invoke("disconnect_mcp_server", { id });
}

export async function getMCPServerStatuses(): Promise<MCPServerStatus[]> {
  if (!isTauri()) {
    // Web mode: return all servers as disconnected
    const servers = getMCPServersFromStorage();
    return servers.map(s => ({
      id: s.id,
      name: s.name,
      status: "Disconnected" as const,
      tools: [],
      last_error: undefined,
    }));
  }
  return invoke("get_mcp_server_statuses");
}

export async function executeMCPTool(call: MCPToolCall): Promise<MCPToolResult> {
  if (!isTauri()) {
    return {
      success: false,
      result: null,
      error: "MCP tool execution requires the desktop app",
    };
  }
  return invoke("execute_mcp_tool", { call });
}