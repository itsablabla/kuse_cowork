# Kuse AI MCP Server

An MCP (Model Context Protocol) server that exposes **all 204 API endpoints** of the [Kuse AI](https://app.kuse.ai/) platform as tools. Connect it to any MCP-compatible client (Claude Desktop, Cursor, VS Code, Kuse Cowork, etc.) to interact with Kuse programmatically.

## Features

- **Complete API coverage** — every endpoint from the Kuse AI OpenAPI spec is available as an MCP tool
- **Auto-generated tools** — tool definitions, parameter schemas, and descriptions are derived directly from the official OpenAPI spec
- **Authentication support** — log in with email/password or provide a Bearer token
- **Organized by category** — tools span auth, boards, dashboard, AI generation (block), file management, library/knowledge, projects, conversations, credits, payment, tenants, invitations, roles, MCP, notifications, admin, and more
- **Stdio transport** — standard MCP stdio transport for universal client compatibility

## Quick Start

### 1. Install dependencies

```bash
cd mcp-server
npm install
npm run build
```

### 2. Run the server

```bash
# With an access token (recommended)
KUSE_ACCESS_TOKEN=<your_token> npm start

# Or authenticate at runtime via the kuse_login tool
npm start
```

### 3. Configure your MCP client

#### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "kuse-ai": {
      "command": "node",
      "args": ["/path/to/kuse_cowork/mcp-server/dist/index.js"],
      "env": {
        "KUSE_ACCESS_TOKEN": "<your_token>"
      }
    }
  }
}
```

#### Cursor / VS Code

Add to your MCP settings:

```json
{
  "kuse-ai": {
    "command": "node",
    "args": ["/path/to/kuse_cowork/mcp-server/dist/index.js"],
    "env": {
      "KUSE_ACCESS_TOKEN": "<your_token>"
    }
  }
}
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `KUSE_ACCESS_TOKEN` | Bearer token for authenticated API calls | _(none)_ |
| `KUSE_API_BASE_URL` | Override the API base URL | `https://api.kuse.ai` |

## Meta Tools

In addition to the 204 API tools, the server provides 3 meta tools:

| Tool | Description |
|---|---|
| `kuse_list_tools` | List all available tools, optionally filtered by tag/category |
| `kuse_login` | Authenticate with email + password; auto-sets the token for the session |
| `kuse_set_token` | Manually set a Bearer token for this session |

## API Categories

| Category | Endpoints | Description |
|---|---|---|
| **auth** | 24 | Login, register, user profile, OAuth, invite codes |
| **boards** | 18 | Board CRUD, sharing, favorites, duplicating, exam papers |
| **dashboard** | 18 | Spaces, recycle bin, favorites, shared-with-me |
| **credits** | 13 | Balance, consumption history, gift codes, disputes |
| **file** | 12 | Upload, download, extraction status, PDF/HTML |
| **tenants** | 12 | Team/org management, members, roles, switching |
| **payment** | 11 | Subscriptions, checkout, billing portal, upgrades |
| **projects** | 11 | Project CRUD, knowledge upload/transfer |
| **library** | 8 | Knowledge base: upsert, list, reparse, reprocess |
| **agents** | 8 | Agent management, configs, run history |
| **block** | 7 | AI generation: magic_v1/v2, regenerate, shortcuts |
| **roles** | 6 | Role/permission management |
| **promo** | 6 | Promo codes, KNSH profiles |
| **invitations** | 5 | Team invitations: send, preview, accept, cancel |
| **conversations** | 5 | Conversation CRUD, message history |
| **whitelist-admin** | 5 | Admin: award/revoke credits, grant/revoke whitelist |
| **admin** | 20 | Operator management, user admin, notifications |
| **dispute** | 3 | Dispute filing and status |
| **mcp** | 2 | Kuse's own MCP tools listing and execution |
| **notifications** | 2 | Notification listing and read-marking |
| **brush** | 2 | AI image magic and editing |
| **board-migration** | 2 | Board migration tasks |
| **survey** | 2 | Typeform surveys and answers |
| **student** | 2 | Student contact forms |
| **summary** | 1 | AI title summarization |
| **suggestions** | 1 | AI suggestions |
| **video** | 1 | YouTube video processing |
| **task** | 1 | Task status retrieval |
| **knsh** | 1 | KNSH curriculum |
| **events** | 1 | Event listing |
| **doit** | 1 | Doit agents |

## Development

```bash
# Type-check
npm run typecheck

# Run in dev mode (with tsx, no build needed)
npm run dev

# Build
npm run build
```

## Updating the OpenAPI Spec

To update the tools when the Kuse API changes:

```bash
curl -s https://api.kuse.ai/api/openapi.json > src/openapi.json
npm run build
```

## License

MIT
