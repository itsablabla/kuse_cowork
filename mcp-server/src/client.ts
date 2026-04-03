/**
 * HTTP client for the Kuse AI API (api.kuse.ai).
 * Handles authentication and request dispatch.
 */

const BASE_URL = "https://api.kuse.ai";

export interface KuseClientOptions {
  apiBaseUrl?: string;
  accessToken?: string;
}

export class KuseClient {
  private baseUrl: string;
  private accessToken: string | undefined;

  constructor(options: KuseClientOptions = {}) {
    this.baseUrl = (options.apiBaseUrl ?? BASE_URL).replace(/\/+$/, "");
    this.accessToken = options.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Send an arbitrary request to the Kuse API.
   */
  async request(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | string[]>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; data: unknown }> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined || v === null || v === "") continue;
        if (Array.isArray(v)) {
          for (const item of v) {
            url.searchParams.append(k, item);
          }
        } else {
          url.searchParams.set(k, v);
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers,
    };

    if (options.body !== undefined && options.body !== null) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return { status: response.status, data };
  }

  /** Convenience: POST /api/auth/login */
  async login(email: string, password: string): Promise<{ status: number; data: unknown }> {
    return this.request("POST", "/api/auth/login", {
      body: { email, password },
    });
  }
}
