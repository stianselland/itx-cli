import { getConfig, setConfig } from "./config.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface ItxUser {
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  active: number;
}

/**
 * Body filter for /itxems/entities/search.
 *
 * NOTE: only `names` (substring), `exactNames`, `emenIds`, `entityTypes`,
 * `extensionTypes` reliably filter. Other body fields are silently ignored —
 * verified by probing live API.
 */
export interface EntityFilter {
  names?: string[];
  exactNames?: string[];
  emenIds?: number[];
  entityTypes?: number[];      // 1=Private, 2=Corporate
  extensionTypes?: number[];   // 9=Prospect, 10=Customer, 20=Supplier, 30=Debtor, 40=Contact
  active?: boolean;
  getExtensions?: boolean;
  getExtensionLinks?: boolean;
}

/** Pagination options that map to limitFrom/limitTo (ITX's offset/limit). */
export interface PageOpts {
  limitFrom?: number;  // 0-indexed offset
  limitTo?: number;    // page size, max 1000 enforced server-side
}

export class ItxClient {
  private endpoint: string;
  private authParams: Record<string, string>;
  private resolved: boolean;

  constructor() {
    const config = getConfig();

    if (!config.tokenv2) {
      throw new Error(
        'Not authenticated. Run "itx login" to configure credentials.',
      );
    }

    this.endpoint = config.activeEndpoint || config.ssoEndpoint;
    this.resolved = Boolean(config.activeEndpoint);
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
   * Search for users.
   */
  async searchUsers(): Promise<ItxUser[]> {
    return this.request<ItxUser[]>("/rest/core/users/search", {
      method: "POST",
      body: {},
    });
  }

  /**
   * Search entities by filter. See {@link EntityFilter} for working filter fields.
   * Pagination uses limitFrom/limitTo as query params (max 1000).
   */
  async searchEntities(
    filter: EntityFilter,
    page: PageOpts = {},
  ): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>(
      "/rest/itxems/entities/search",
      {
        method: "POST",
        body: filter,
        params: {
          limitFrom: page.limitFrom ?? 0,
          limitTo: page.limitTo ?? 50,
        },
      },
    );
  }

  /**
   * Get a single entity by emenId with full details (extensions, links, addresses).
   */
  async getEntity(
    emenId: number,
    opts: { getExtensions?: boolean; getExtensionLinks?: boolean; active?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/rest/itxems/entity", {
      params: {
        emenId,
        getExtensions: opts.getExtensions ?? true,
        getExtensionLinks: opts.getExtensionLinks ?? true,
        active: opts.active ?? true,
      },
    });
  }

  /**
   * Get all activities (cases, emails, calls, notes, sales) for an entity.
   *
   * Verified to return the full activity feed for active entities — single
   * call replaces the corp-wide cases/search + client-filter strategy.
   */
  async getActivities(emenId: number): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>(
      "/rest/itxems/activities",
      { params: { emenId } },
    );
  }

  /** Batched entity lookup by emenIds. */
  async getEntitiesByIds(emenIds: number[]): Promise<Record<string, unknown>[]> {
    if (emenIds.length === 0) return [];
    return this.searchEntities(
      { emenIds, getExtensions: true, getExtensionLinks: true, active: true },
      { limitTo: emenIds.length },
    );
  }

  /**
   * Get the email body (HTML) for an email activity.
   *
   * Returns `null` when the body is not available (404). All other errors —
   * auth failures, 5xx, schema mismatches — propagate so callers don't need
   * a wide catch that swallows real problems.
   */
  async getEmailContent(eactId: number): Promise<string | null> {
    try {
      return await this.request<string>("/rest/itxems/emailcontent", {
        params: { eactId },
      });
    } catch (err) {
      if (err instanceof Error && /API error 404\b/.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * Lookup a corporate customer by external system id (e.g., HubSpot id).
   * estpId 87=HubSpot Customer, 88=HubSpot Contact, 20=ITX internal.
   */
  async getCustomerByExternalId(
    kind: "corporate" | "private",
    estpId: number,
    extSystemId: string,
  ): Promise<Record<string, unknown>[]> {
    const path = kind === "corporate" ? "corporatecustomer" : "privatecustomer";
    return this.request<Record<string, unknown>[]>(`/rest/v1/${path}`, {
      params: { extSystemEstpId: estpId, extSystemId },
    });
  }

  /** Lookup a prospect by external system id. */
  async getProspectByExternalId(
    kind: "corporate" | "private",
    estpId: number,
    extSystemId: string,
  ): Promise<Record<string, unknown>[]> {
    const path = kind === "corporate" ? "corporateprospect" : "privateprospect";
    return this.request<Record<string, unknown>[]>(`/rest/v1/${path}`, {
      params: { extSystemEstpId: estpId, extSystemId },
    });
  }

  /** Lookup a contact person by external system id. */
  async getContactPersonByExternalId(
    estpId: number,
    extSystemId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>("/rest/v1/contactperson", {
      params: { extSystemEstpId: estpId, extSystemId },
    });
  }

  /**
   * Add an activity text (comment with optional mention tags).
   */
  async addActivityText(
    eactId: number,
    text: string,
    data?: { tags: { startIndex: number; length: number; type: string; data: string }[] },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      text,
      activity: { eactId },
    };
    if (data) {
      body.data = data;
    }
    return this.request("/rest/itxems/activitytexts", {
      method: "POST",
      body,
    });
  }

  /**
   * Make an authenticated request to the ITX API.
   * Auto-resolves the active endpoint on first call if needed.
   */
  async request<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!this.resolved) {
      await this.resolveEndpoint();
      this.resolved = true;
    }

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
      // 401/403 are auth failures — surface them with a "Not authenticated" prefix
      // so handleError() / inferErrorCode() route to exit code 5 (AUTH) instead of
      // 2 (API). Agents need to distinguish "session expired, re-login" from
      // generic backend failures.
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Not authenticated: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
        );
      }
      throw new Error(`API error ${res.status} ${res.statusText}: ${text}`);
    }

    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return (await res.json()) as T;
    }

    return (await res.text()) as unknown as T;
  }
}
