import { getConfig, setConfig } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export class ItxClient {
  private endpoint: string;
  private headers: Record<string, string>;

  constructor() {
    const config = getConfig();

    if (!config.tokenv2) {
      throw new Error(
        'Not authenticated. Run "itx config set" to configure credentials.',
      );
    }

    this.endpoint = config.activeEndpoint || config.ssoEndpoint;
    this.headers = {
      tokenv2: config.tokenv2,
      rcntrl: config.rcntrl,
      ccntrl: config.ccntrl,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Discover the active API endpoint from the SSO cluster.
   * Caches the result in config for subsequent calls.
   */
  async resolveEndpoint(): Promise<string> {
    const config = getConfig();
    const ssoUrl = config.ssoEndpoint.replace(/\/$/, "");

    const res = await fetch(`${ssoUrl}/rest/api/state`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(
        `Failed to resolve active endpoint: ${res.status} ${res.statusText}`,
      );
    }

    const state = (await res.json()) as { endpoint?: string };
    if (!state.endpoint) {
      throw new Error(
        "No active endpoint returned from /rest/api/state. Check your SSO endpoint.",
      );
    }

    const activeEndpoint = state.endpoint.replace(/\/$/, "");
    setConfig({ activeEndpoint });
    this.endpoint = activeEndpoint;
    return activeEndpoint;
  }

  /**
   * Verify connectivity by fetching the active user.
   */
  async getActiveUser(): Promise<unknown> {
    return this.request("/rest/core/activeuser");
  }

  /**
   * Make an authenticated request to the ITX API.
   */
  async request<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { method = "GET", body, params } = options;

    let url = `${this.endpoint}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API error ${res.status} ${res.statusText}: ${text}`);
    }

    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return (await res.json()) as T;
    }

    return (await res.text()) as unknown as T;
  }
}
