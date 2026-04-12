/**
 * Blinko client for saving notes to a Blinko instance.
 * Used to sync Kuse data to Blinko for persistent storage.
 */

export interface BlinkoClientOptions {
  baseUrl: string;
  token: string;
}

export class BlinkoClient {
  private baseUrl: string;
  private token: string;

  constructor(options: BlinkoClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * Create or update a note in Blinko.
   * @param content - Markdown content for the note
   * @param type - 0=blinko/quick, 1=note, 2=todo
   * @param id - Optional note ID for updating existing notes
   */
  async upsertNote(
    content: string,
    type: number = 1,
    id?: number,
  ): Promise<{ id: number; content: string }> {
    const body: Record<string, unknown> = { content, type };
    if (id !== undefined) {
      body["id"] = id;
    }
    const resp = await fetch(`${this.baseUrl}/api/v1/note/upsert`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Blinko API error (${resp.status}): ${errorText}`);
    }
    return (await resp.json()) as { id: number; content: string };
  }

  /**
   * List notes from Blinko, optionally filtered.
   */
  async listNotes(options: {
    page?: number;
    size?: number;
    searchText?: string;
    type?: number;
    tagId?: number | null;
  } = {}): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}/api/v1/note/list`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        page: options.page ?? 1,
        size: options.size ?? 30,
        searchText: options.searchText ?? "",
        type: options.type ?? -1,
        tagId: options.tagId ?? null,
        isArchived: false,
        isRecycle: false,
      }),
    });
    return resp.json();
  }

  /**
   * Get tags list from Blinko.
   */
  async listTags(): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}/api/v1/tags/list`, {
      method: "GET",
      headers: this.headers,
    });
    return resp.json();
  }
}
