/**
 * Kuse → Blinko sync engine.
 * Pulls data from Kuse via the KuseClient and saves organized notes to Blinko.
 */

import type { KuseClient } from "./client.js";
import type { BlinkoClient } from "./blinko-client.js";

interface SyncResult {
  saved: number;
  errors: string[];
  notes: Array<{ category: string; noteId: number; chars: number }>;
}

/**
 * Format a JS value as a JSON code block.
 */
function fmtJson(data: unknown): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

/**
 * Safe API call – returns the parsed JSON body or null on error.
 */
async function safeCall(
  client: KuseClient,
  method: string,
  path: string,
  opts?: { query?: Record<string, string | string[]>; body?: unknown },
): Promise<unknown | null> {
  try {
    const { status, data } = await client.request(method, path, opts);
    if (status < 200 || status >= 300) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Run a full sync of all Kuse data categories into Blinko notes.
 */
export async function syncKuseToBlinko(
  kuse: KuseClient,
  blinko: BlinkoClient,
): Promise<SyncResult> {
  const result: SyncResult = { saved: 0, errors: [], notes: [] };
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const nowTs = Math.floor(Date.now() / 1000);
  const monthAgoTs = nowTs - 30 * 24 * 3600;

  async function save(category: string, content: string): Promise<void> {
    try {
      const note = await blinko.upsertNote(content, 1);
      result.saved++;
      result.notes.push({ category, noteId: note.id, chars: content.length });
    } catch (err) {
      result.errors.push(`${category}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 1. User Profile
  const profile = (await safeCall(kuse, "GET", "/api/users/me")) as Record<string, unknown> | null;
  if (profile && typeof profile === "object" && profile.id) {
    await save(
      "User Profile",
      `#kuse #kuse/user-profile #sync\n# Kuse User Profile\n**Synced:** ${now}\n\n` +
        `| Field | Value |\n|---|---|\n` +
        `| **ID** | ${profile.id} |\n` +
        `| **Email** | ${profile.email} |\n` +
        `| **Name** | ${profile.full_name} |\n` +
        `| **Status** | ${profile.status} |\n` +
        `| **Login Type** | ${profile.login_type} |\n` +
        `| **Onboarded** | ${profile.onboarded} |\n\n` +
        fmtJson(profile),
    );
  }

  // 2. User Config
  const config = await safeCall(kuse, "GET", "/api/users/me/config");
  if (config) {
    await save(
      "User Config",
      `#kuse #kuse/user-config #sync\n# Kuse User Config\n**Synced:** ${now}\n\n${fmtJson(config)}`,
    );
  }

  // 3. Subscription
  const sub = (await safeCall(kuse, "GET", "/api/payment/subscription")) as Record<string, unknown> | null;
  if (sub && typeof sub === "object") {
    const price = Number(sub.stripe_subscription_price ?? 0) / 100;
    await save(
      "Subscription",
      `#kuse #kuse/subscription #sync\n# Kuse Subscription\n**Synced:** ${now}\n\n` +
        `| Field | Value |\n|---|---|\n` +
        `| **Plan** | ${sub.subscription_plan} |\n` +
        `| **Status** | ${sub.stripe_subscription_status} |\n` +
        `| **Price** | $${price.toFixed(2)}/mo |\n` +
        `| **Period** | ${sub.current_period_start} → ${sub.current_period_end} |\n` +
        `| **Auto-Renew** | ${sub.cancel_at_period_end ? "No" : "Yes"} |\n\n` +
        fmtJson(sub),
    );
  }

  // 4. Credits Balance
  const balance = (await safeCall(kuse, "GET", "/api/credits/balancev2")) as Record<string, unknown> | null;
  if (balance && typeof balance === "object") {
    const details = (balance.credit_details ?? []) as Array<Record<string, unknown>>;
    let table = "| Name | Remaining | Initial | Info |\n|---|---|---|---|\n";
    for (const d of details) {
      table += `| ${d.name} | ${d.remaining} | ${d.initial_amount} | ${d.hint ?? ""} |\n`;
    }
    await save(
      "Credits Balance",
      `#kuse #kuse/credits #sync\n# Kuse Credits Balance\n**Synced:** ${now}\n\n` +
        `**Total:** ${balance.total_amount} / ${balance.total_initial_amount} credits\n\n${table}\n` +
        fmtJson(balance),
    );
  }

  // 5. Credit History
  const creditHist = (await safeCall(kuse, "GET", "/api/credits/credit_history", {
    query: { start_time: String(monthAgoTs), end_time: String(nowTs) },
  })) as Record<string, unknown> | null;
  if (creditHist && typeof creditHist === "object") {
    await save(
      "Credit History",
      `#kuse #kuse/credits #kuse/credit-history #sync\n# Kuse Credit History (30 days)\n**Synced:** ${now}\n\n` +
        fmtJson(creditHist),
    );
  }

  // 6. Consumption History
  const consumption = (await safeCall(kuse, "GET", "/api/credits/consumption_history", {
    query: { start_time: String(monthAgoTs), end_time: String(nowTs) },
  })) as Record<string, unknown> | null;
  if (consumption && typeof consumption === "object") {
    await save(
      "Consumption History",
      `#kuse #kuse/credits #kuse/consumption #sync\n# Kuse Consumption History (30 days)\n**Synced:** ${now}\n\n` +
        fmtJson(consumption),
    );
  }

  // 7. User Activity
  const activity = await safeCall(kuse, "GET", "/api/users/activity");
  if (activity) {
    await save(
      "User Activity",
      `#kuse #kuse/activity #sync\n# Kuse User Activity\n**Synced:** ${now}\n\n${fmtJson(activity)}`,
    );
  }

  // 8. Boards
  const boards = await safeCall(kuse, "GET", "/api/boards/");
  if (boards) {
    await save(
      "Boards",
      `#kuse #kuse/boards #sync\n# Kuse Boards\n**Synced:** ${now}\n\n${fmtJson(boards)}`,
    );
  }

  // 9. Projects
  const projects = await safeCall(kuse, "GET", "/api/projects/");
  if (projects) {
    await save(
      "Projects",
      `#kuse #kuse/projects #sync\n# Kuse Projects\n**Synced:** ${now}\n\n${fmtJson(projects)}`,
    );
  }

  // 10. Spaces
  const spaces = await safeCall(kuse, "GET", "/api/dashboard/spaces");
  if (spaces) {
    await save(
      "Spaces",
      `#kuse #kuse/spaces #sync\n# Kuse Spaces\n**Synced:** ${now}\n\n${fmtJson(spaces)}`,
    );
  }

  // 11. Favorites
  const favorites = await safeCall(kuse, "GET", "/api/dashboard/favorite-boards");
  if (favorites) {
    await save(
      "Favorites",
      `#kuse #kuse/favorites #sync\n# Kuse Favorite Boards\n**Synced:** ${now}\n\n${fmtJson(favorites)}`,
    );
  }

  // 12. Shared With Me
  const shared = await safeCall(kuse, "GET", "/api/dashboard/share_with_me/");
  if (shared) {
    await save(
      "Shared With Me",
      `#kuse #kuse/shared #sync\n# Kuse Shared With Me\n**Synced:** ${now}\n\n${fmtJson(shared)}`,
    );
  }

  // 13. Recycle Bin
  const recycle = await safeCall(kuse, "GET", "/api/dashboard/recycle-bin");
  if (recycle) {
    await save(
      "Recycle Bin",
      `#kuse #kuse/recycle-bin #sync\n# Kuse Recycle Bin\n**Synced:** ${now}\n\n${fmtJson(recycle)}`,
    );
  }

  // 14. Library
  const libItems = await safeCall(kuse, "GET", "/api/library/items");
  const libUsage = await safeCall(kuse, "GET", "/api/library/usage");
  if (libItems || libUsage) {
    await save(
      "Library",
      `#kuse #kuse/library #sync\n# Kuse Library\n**Synced:** ${now}\n\n` +
        `**Usage:** ${fmtJson(libUsage)}\n**Items:** ${fmtJson(libItems)}`,
    );
  }

  // 15. Agents
  const agents = await safeCall(kuse, "GET", "/api/doit/agents");
  if (agents) {
    await save(
      "Agents",
      `#kuse #kuse/agents #sync\n# Kuse Available Agents\n**Synced:** ${now}\n\n${fmtJson(agents)}`,
    );
  }

  // 16. Tenants
  const tenants = await safeCall(kuse, "GET", "/api/tenants");
  const currentTenant = await safeCall(kuse, "GET", "/api/tenants/current");
  if (tenants || currentTenant) {
    await save(
      "Tenants",
      `#kuse #kuse/tenants #sync\n# Kuse Tenants / Teams\n**Synced:** ${now}\n\n` +
        fmtJson({ tenants, current: currentTenant }),
    );
  }

  // 17. Notifications
  const notifs = await safeCall(kuse, "GET", "/api/notifications/");
  if (notifs) {
    await save(
      "Notifications",
      `#kuse #kuse/notifications #sync\n# Kuse Notifications\n**Synced:** ${now}\n\n${fmtJson(notifs)}`,
    );
  }

  // 18. Events
  const events = await safeCall(kuse, "GET", "/api/events/");
  if (events) {
    await save(
      "Events",
      `#kuse #kuse/events #sync\n# Kuse Events\n**Synced:** ${now}\n\n${fmtJson(events)}`,
    );
  }

  // 19. Promo & Invite Codes
  const promo = await safeCall(kuse, "GET", "/api/promo/my_code");
  const inviteStatus = await safeCall(kuse, "GET", "/api/users/invite_code_status");
  if (promo || inviteStatus) {
    await save(
      "Promo & Invite Codes",
      `#kuse #kuse/promo #sync\n# Kuse Promo & Invite Codes\n**Synced:** ${now}\n\n` +
        fmtJson({ promo, invite_status: inviteStatus }),
    );
  }

  // 20. Exampaper
  const exampaper = await safeCall(kuse, "GET", "/api/exampaper/me");
  if (exampaper) {
    await save(
      "Exampaper",
      `#kuse #kuse/exampaper #sync\n# Kuse Exam Paper Credits\n**Synced:** ${now}\n\n${fmtJson(exampaper)}`,
    );
  }

  // 21. Migration Tasks
  const migration = await safeCall(kuse, "GET", "/api/board_migration/tasks");
  if (migration) {
    await save(
      "Migration Tasks",
      `#kuse #kuse/migration #sync\n# Kuse Board Migration Tasks\n**Synced:** ${now}\n\n${fmtJson(migration)}`,
    );
  }

  // 22. Dispute Status
  const dispute = await safeCall(kuse, "GET", "/api/credits/dispute/status");
  if (dispute) {
    await save(
      "Dispute Status",
      `#kuse #kuse/disputes #sync\n# Kuse Credit Dispute Status\n**Synced:** ${now}\n\n${fmtJson(dispute)}`,
    );
  }

  // 23. Curriculum
  const curriculum = await safeCall(kuse, "GET", "/api/knsh/curriculum");
  if (curriculum) {
    await save(
      "Curriculum",
      `#kuse #kuse/curriculum #sync\n# Kuse Curriculum\n**Synced:** ${now}\n\n${fmtJson(curriculum)}`,
    );
  }

  // 24. Library Progress
  const progress = await safeCall(kuse, "GET", "/api/library/progress");
  if (progress) {
    await save(
      "Library Progress",
      `#kuse #kuse/library #kuse/library-progress #sync\n# Kuse Library Processing Progress\n**Synced:** ${now}\n\n${fmtJson(progress)}`,
    );
  }

  // 25. MCP Server Summary
  await save(
    "MCP Server Info",
    `#kuse #kuse/mcp-server #infrastructure #sync\n# Kuse MCP Server - Deployment Info\n**Synced:** ${now}\n\n` +
      `## Server\n- **URL:** \`https://kuse-mcp-server.fly.dev/mcp\`\n` +
      `- **Transport:** Streamable HTTP (JSON-RPC 2.0 + SSE)\n` +
      `- **Source:** [PR #2](https://github.com/itsablabla/kuse_cowork/pull/2)\n\n` +
      `## Tools: 207 total (204 API + 3 meta)\n` +
      `Meta: kuse_list_tools, kuse_login, kuse_set_token\n`,
  );

  return result;
}
