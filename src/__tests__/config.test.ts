import { describe, it, expect, afterEach } from "vitest";
import {
  getConfig,
  setConfig,
  clearConfig,
  isConfigured,
  getConfigPath,
} from "../lib/config.js";

afterEach(() => {
  clearConfig();
});

describe("config", () => {
  it("returns empty defaults when nothing is set", () => {
    const c = getConfig();
    expect(c.ssoEndpoint).toBe("");
    expect(c.tokenv2).toBe("");
    expect(c.rcntrl).toBe("");
    expect(c.ccntrl).toBe("");
    expect(c.activeEndpoint).toBe("");
  });

  it("sets and retrieves config values", () => {
    setConfig({
      ssoEndpoint: "https://sso.example.com",
      tokenv2: "my-token",
      rcntrl: "rc-value",
      ccntrl: "cc-value",
    });

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("https://sso.example.com");
    expect(c.tokenv2).toBe("my-token");
    expect(c.rcntrl).toBe("rc-value");
    expect(c.ccntrl).toBe("cc-value");
  });

  it("supports partial updates without overwriting other fields", () => {
    setConfig({
      ssoEndpoint: "https://sso.example.com",
      tokenv2: "token-1",
    });

    setConfig({ tokenv2: "token-2" });

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("https://sso.example.com");
    expect(c.tokenv2).toBe("token-2");
  });

  it("ignores undefined values in setConfig", () => {
    setConfig({ ssoEndpoint: "https://sso.example.com" });
    setConfig({ ssoEndpoint: undefined });

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("https://sso.example.com");
  });

  it("clears all config", () => {
    setConfig({
      ssoEndpoint: "https://sso.example.com",
      tokenv2: "my-token",
    });
    clearConfig();

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("");
    expect(c.tokenv2).toBe("");
  });

  describe("isConfigured", () => {
    it("returns false when nothing is set", () => {
      expect(isConfigured()).toBe(false);
    });

    it("returns false when only ssoEndpoint is set", () => {
      setConfig({ ssoEndpoint: "https://sso.example.com" });
      expect(isConfigured()).toBe(false);
    });

    it("returns false when only tokenv2 is set", () => {
      setConfig({ tokenv2: "my-token" });
      expect(isConfigured()).toBe(false);
    });

    it("returns true when both ssoEndpoint and tokenv2 are set", () => {
      setConfig({
        ssoEndpoint: "https://sso.example.com",
        tokenv2: "my-token",
      });
      expect(isConfigured()).toBe(true);
    });
  });

  it("returns a file path from getConfigPath", () => {
    const p = getConfigPath();
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
});
