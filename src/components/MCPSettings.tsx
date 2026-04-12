import { Component, For, createSignal, onMount, createMemo, Show } from "solid-js";
import {
  MCPServerConfig,
  MCPServerStatus,
  listMCPServers,
  saveMCPServer,
  deleteMCPServer,
  connectMCPServer,
  disconnectMCPServer,
  getMCPServerStatuses
} from "../lib/mcp-api";
import { isTauri } from "../lib/tauri-api";
import "./MCPSettings.css";

interface MCPSettingsProps {
  onClose: () => void;
}

// Pre-configured MCP server templates
const PRESET_SERVERS = [
  {
    name: "composio",
    server_url: "https://connect.composio.dev/mcp",
    custom_headers: { "x-consumer-api-key": "ck_5BPjQp-eNXt3v1ktnhuZ" },
    description: "Composio MCP - Connect 250+ apps & tools to your AI agent",
  },
];

const MCPSettings: Component<MCPSettingsProps> = (props) => {
  const [servers, setServers] = createSignal<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = createSignal<MCPServerStatus[]>([]);
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [editingServer, setEditingServer] = createSignal<MCPServerConfig | null>(null);
  const [loading, setLoading] = createSignal(false);

  // Form state
  const [formData, setFormData] = createSignal({
    name: "",
    serverUrl: "",
    oauthClientId: "",
    oauthClientSecret: "",
    customHeaders: "" as string, // JSON string of key-value pairs
  });

  const mergedData = createMemo(() => {
    const statusMap = new Map(statuses().map(s => [s.id, s]));
    return servers().map(server => ({
      server,
      status: statusMap.get(server.id)
    }));
  });

  // Check which presets are already added
  const availablePresets = createMemo(() => {
    const existing = servers().map(s => s.name.toLowerCase());
    return PRESET_SERVERS.filter(p => !existing.includes(p.name.toLowerCase()));
  });

  onMount(async () => {
    await refreshData();
  });

  const refreshData = async () => {
    try {
      setLoading(true);
      const [serverList, statusList] = await Promise.all([
        listMCPServers(),
        getMCPServerStatuses()
      ]);
      setServers(serverList);
      setStatuses(statusList);
    } catch (err) {
      console.error("Failed to load MCP data:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      serverUrl: "",
      oauthClientId: "",
      oauthClientSecret: "",
      customHeaders: "",
    });
    setEditingServer(null);
    setShowAddForm(false);
  };

  const startEdit = (server: MCPServerConfig) => {
    setFormData({
      name: server.name,
      serverUrl: server.server_url || "",
      oauthClientId: server.oauth_client_id || "",
      oauthClientSecret: server.oauth_client_secret || "",
      customHeaders: server.custom_headers
        ? JSON.stringify(server.custom_headers, null, 2)
        : "",
    });
    setEditingServer(server);
    setShowAddForm(true);
  };

  const parseCustomHeaders = (headersStr: string): Record<string, string> | undefined => {
    if (!headersStr.trim()) return undefined;
    try {
      const parsed = JSON.parse(headersStr);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const value of Object.values(parsed)) {
          if (typeof value !== "string") return undefined;
        }
        return parsed;
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const handleSave = async () => {
    try {
      const data = formData();

      if (!data.name.trim()) {
        alert("Server name is required");
        return;
      }

      if (!data.serverUrl.trim()) {
        alert("Server URL is required");
        return;
      }

      // Validate custom headers JSON if provided
      if (data.customHeaders.trim()) {
        const parsed = parseCustomHeaders(data.customHeaders);
        if (!parsed) {
          alert("Custom headers must be valid JSON object (e.g. {\"key\": \"value\"})");
          return;
        }
      }

      const config: MCPServerConfig = {
        id: editingServer()?.id || crypto.randomUUID(),
        name: data.name,
        server_url: data.serverUrl,
        oauth_client_id: data.oauthClientId.trim() || undefined,
        oauth_client_secret: data.oauthClientSecret.trim() || undefined,
        custom_headers: parseCustomHeaders(data.customHeaders),
        enabled: editingServer()?.enabled ?? true,
        created_at: editingServer()?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await saveMCPServer(config);
      await refreshData();
      resetForm();
    } catch (err) {
      console.error("Failed to save server:", err);
      alert("Failed to save server configuration");
    }
  };

  const handleAddPreset = async (preset: typeof PRESET_SERVERS[0]) => {
    try {
      const config: MCPServerConfig = {
        id: crypto.randomUUID(),
        name: preset.name,
        server_url: preset.server_url,
        custom_headers: preset.custom_headers,
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await saveMCPServer(config);
      await refreshData();
    } catch (err) {
      console.error("Failed to add preset server:", err);
      alert("Failed to add preset server");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this MCP server?")) {
      return;
    }

    try {
      await deleteMCPServer(id);
      await refreshData();
    } catch (err) {
      console.error("Failed to delete server:", err);
      alert("Failed to delete server");
    }
  };

  const handleToggleConnection = async (server: MCPServerConfig, currentStatus?: MCPServerStatus) => {
    try {
      if (currentStatus?.status === "Connected") {
        await disconnectMCPServer(server.id);
      } else {
        await connectMCPServer(server.id);
      }
      await refreshData();
    } catch (err) {
      console.error("Failed to toggle connection:", err);
      if (!isTauri()) {
        alert("MCP server connections require the desktop app. Servers can be configured here for use in the desktop version.");
      } else {
        alert("Failed to connect/disconnect server");
      }
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "Connected": return "green";
      case "Connecting": return "orange";
      case "Error": return "red";
      default: return "gray";
    }
  };

  return (
    <div class="mcp-settings">
      <div class="mcp-settings-header">
        <h2>MCP Settings</h2>
        <div class="header-actions">
          <button class="add-btn" onClick={() => setShowAddForm(true)}>
            Add Server
          </button>
          <button class="refresh-btn" onClick={refreshData} disabled={loading()}>
            {loading() ? "Loading..." : "Refresh"}
          </button>
          <button class="close-btn" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      <div class="mcp-settings-content">
        {/* Quick Add Presets */}
        <Show when={availablePresets().length > 0}>
          <div class="presets-section">
            <h3>Quick Add</h3>
            <div class="presets-grid">
              <For each={availablePresets()}>
                {(preset) => (
                  <div class="preset-card">
                    <div class="preset-info">
                      <h4>{preset.name}</h4>
                      <p>{preset.description}</p>
                    </div>
                    <button class="preset-add-btn" onClick={() => handleAddPreset(preset)}>
                      + Add
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {showAddForm() && (
          <div class="add-form">
            <h3>{editingServer() ? "Edit Server" : "Add MCP Server"}</h3>

            <div class="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData().name}
                onInput={(e) => setFormData(prev => ({ ...prev, name: e.currentTarget.value }))}
                placeholder="Server name"
              />
            </div>

            <div class="form-group">
              <label>Remote MCP server URL</label>
              <input
                type="url"
                value={formData().serverUrl}
                onInput={(e) => setFormData(prev => ({ ...prev, serverUrl: e.currentTarget.value }))}
                placeholder="https://your-mcp-server.com"
              />
            </div>

            <details class="advanced-settings">
              <summary>Advanced settings</summary>
              <div class="advanced-content">
                <div class="form-group">
                  <label>Custom Headers (JSON)</label>
                  <textarea
                    value={formData().customHeaders}
                    onInput={(e) => setFormData(prev => ({ ...prev, customHeaders: e.currentTarget.value }))}
                    placeholder={'{"x-api-key": "your-key"}'}
                    rows={3}
                  />
                  <small>JSON object with header name-value pairs sent with every request</small>
                </div>

                <div class="form-group">
                  <label>OAuth Client ID (optional)</label>
                  <input
                    type="text"
                    value={formData().oauthClientId}
                    onInput={(e) => setFormData(prev => ({ ...prev, oauthClientId: e.currentTarget.value }))}
                    placeholder="your-oauth-client-id"
                  />
                </div>

                <div class="form-group">
                  <label>OAuth Client Secret (optional)</label>
                  <input
                    type="password"
                    value={formData().oauthClientSecret}
                    onInput={(e) => setFormData(prev => ({ ...prev, oauthClientSecret: e.currentTarget.value }))}
                    placeholder="your-oauth-client-secret"
                  />
                </div>
              </div>
            </details>

            <div class="warning-text">
              <strong>Security Notice:</strong> Only use connectors from developers you trust.
              MCP servers have access to tools and data as configured, and this app cannot verify
              that they will work as intended or that they won't change.
            </div>

            <div class="form-actions">
              <button class="save-btn" onClick={handleSave}>
                {editingServer() ? "Update" : "Add"}
              </button>
              <button class="cancel-btn" onClick={resetForm}>Cancel</button>
            </div>
          </div>
        )}

        <div class="servers-list">
          <h3>MCP Servers</h3>

          {mergedData().length === 0 ? (
            <div class="empty-state">
              <p>No MCP servers configured.</p>
              <p>Add your first server to get started with MCP tools.</p>
            </div>
          ) : (
            <div class="servers-grid">
              <For each={mergedData()}>
                {({ server, status }) => (
                  <div class="server-card">
                    <div class="server-header">
                      <div class="server-info">
                        <h4>{server.name}</h4>
                        <p>{server.server_url}</p>
                      </div>
                      <div class="server-status">
                        <span
                          class={`status-badge ${getStatusColor(status?.status)}`}
                          title={status?.last_error}
                        >
                          {status?.status || "Disconnected"}
                        </span>
                      </div>
                    </div>

                    <div class="server-details">
                      <div class="detail-row">
                        <strong>URL:</strong> {server.server_url}
                      </div>

                      {server.oauth_client_id && (
                        <div class="detail-row">
                          <strong>OAuth:</strong> Configured
                        </div>
                      )}

                      {server.custom_headers && Object.keys(server.custom_headers).length > 0 && (
                        <div class="detail-row">
                          <strong>Custom Headers:</strong> {Object.keys(server.custom_headers).join(", ")}
                        </div>
                      )}

                      {status?.tools && status.tools.length > 0 && (
                        <div class="detail-row">
                          <strong>Tools:</strong> {status.tools.map(t => t.name).join(", ")}
                        </div>
                      )}
                    </div>

                    <div class="server-actions">
                      <button
                        class={`toggle-btn ${status?.status === "Connected" ? "disconnect" : "connect"}`}
                        onClick={() => handleToggleConnection(server, status)}
                        disabled={status?.status === "Connecting"}
                      >
                        {status?.status === "Connected" ? "Disconnect" :
                         status?.status === "Connecting" ? "Connecting..." : "Connect"}
                      </button>
                      <button class="edit-btn" onClick={() => startEdit(server)}>
                        Edit
                      </button>
                      <button class="delete-btn" onClick={() => handleDelete(server.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MCPSettings;