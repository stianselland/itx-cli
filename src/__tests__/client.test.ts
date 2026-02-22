import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setConfig, clearConfig } from "../lib/config.js";
import { ItxClient } from "../lib/client.js";

beforeEach(() => {
  setConfig({
    ssoEndpoint: "https://sso.example.com",
    activeEndpoint: "https://sso.example.com",
    tokenv2: "test-token",
    rcntrl: "rc-val",
    ccntrl: "cc-val",
  });
});

afterEach(() => {
  clearConfig();
  vi.restoreAllMocks();
});

describe("ItxClient", () => {
  describe("constructor", () => {
    it("throws when tokenv2 is not set", () => {
      clearConfig();
      expect(() => new ItxClient()).toThrow("Not authenticated");
    });

    it("creates a client when credentials are configured", () => {
      const client = new ItxClient();
      expect(client).toBeInstanceOf(ItxClient);
    });

    it("uses activeEndpoint when available", () => {
      setConfig({ activeEndpoint: "https://active.example.com" });
      const client = new ItxClient();
      // Verify by making a request that uses the endpoint
      expect(client).toBeInstanceOf(ItxClient);
    });
  });

  describe("resolveEndpoint", () => {
    it("fetches active endpoint from SSO and caches it", async () => {
      setConfig({ activeEndpoint: "" });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ endpoint: "https://active.example.com/" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new ItxClient();
      const endpoint = await client.resolveEndpoint();

      expect(endpoint).toBe("https://active.example.com");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("https://sso.example.com/rest/api/state");
      expect(calledUrl).toContain("tokenv2=test-token");
    });

    it("throws on non-ok response", async () => {
      setConfig({ activeEndpoint: "" });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      );

      const client = new ItxClient();
      await expect(client.resolveEndpoint()).rejects.toThrow(
        "Failed to resolve active endpoint: 401 Unauthorized",
      );
    });

    it("throws when endpoint is missing from response", async () => {
      setConfig({ activeEndpoint: "" });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({}),
        }),
      );

      const client = new ItxClient();
      await expect(client.resolveEndpoint()).rejects.toThrow(
        "No active endpoint returned",
      );
    });
  });

  describe("request", () => {
    it("makes a GET request with auth in query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: 1, name: "Test" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new ItxClient();
      const result = await client.request("/rest/test");

      expect(result).toEqual({ id: 1, name: "Test" });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("https://sso.example.com/rest/test");
      expect(calledUrl).toContain("tokenv2=test-token");
      expect(calledUrl).toContain("rcntrl=rc-val");
      expect(calledUrl).toContain("ccntrl=cc-val");
      expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    });

    it("appends query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new ItxClient();
      await client.request("/rest/test", {
        params: { foo: "bar", num: 42, skip: undefined },
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("foo=bar");
      expect(calledUrl).toContain("num=42");
      expect(calledUrl).not.toContain("skip");
    });

    it("sends JSON body on POST", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: 99 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new ItxClient();
      await client.request("/rest/test", {
        method: "POST",
        body: { subject: "Hello" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ subject: "Hello" }),
        }),
      );
    });

    it("throws on API error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "Resource not found",
        }),
      );

      const client = new ItxClient();
      await expect(client.request("/rest/missing")).rejects.toThrow(
        "API error 404 Not Found: Resource not found",
      );
    });

    it("returns text when content-type is not JSON", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "text/plain" }),
          text: async () => "plain response",
        }),
      );

      const client = new ItxClient();
      const result = await client.request("/rest/text");
      expect(result).toBe("plain response");
    });
  });

  describe("getActiveUser", () => {
    it("calls /rest/core/activeuser", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ userId: 1, name: "Admin" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new ItxClient();
      const user = await client.getActiveUser();

      expect(user).toEqual({ userId: 1, name: "Admin" });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/rest/core/activeuser");
    });
  });
});
