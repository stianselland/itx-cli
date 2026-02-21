import { getConfig, setConfig } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export class ItxClient {
  private endpoint: string;
  private authParams: Record<string, string>;

  constructor() {
    const config = getConfig();

    if (!config.tokenv2) {
      throw new Error(
        'Not authenticated. Run "itx config set" to configure credentials.',
      );
    }

    this.endpoint = config.activeEndpoint || config.ssoEndpoint;
    this.authParams = {
      tokenv2: config.tokenv2,
      rcntrl: config.rcntrl,
      ccntrl: config.ccntrl,
    };
  }

  /**
   * Discover the active API endpoint from the SSO cluster.
   * Caches the result in config for subsequent calls.
   */
  async resolveEndpoint(): Promise<string> {
    const config = getConfig();
    const ssoUrl = config.ssoEndpoint.replace(/\/$/, "");

    const qs = new URLSearchParams(this.authParams).toString();
    const res = await fetch(`${ssoUrl}/rest/api/state?${qs}`);

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

    const searchParams = new URLSearchParams(this.authParams);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
    }

    const url = `${this.endpoint}${path}?${searchParams.toString()}`;

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
