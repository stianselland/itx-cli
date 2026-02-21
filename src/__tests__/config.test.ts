import { describe, it, expect, afterEach } from "vitest";
import {
  getConfig,
  setConfig,
  clearConfig,
  isConfigured,
  getConfigPath,
  getAliases,
  setAlias,
  removeAlias,
  resolveAlias,
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

  describe("aliases", () => {
    it("returns empty aliases by default", () => {
      expect(getAliases()).toEqual({});
    });

    it("sets and retrieves an alias", () => {
      setAlias("dave", "dave@company.com");
      expect(getAliases()).toEqual({ dave: "dave@company.com" });
    });

    it("overwrites an existing alias", () => {
      setAlias("dave", "dave@old.com");
      setAlias("dave", "dave@new.com");
      expect(getAliases()).toEqual({ dave: "dave@new.com" });
    });

    it("supports multiple aliases", () => {
      setAlias("dave", "dave@company.com");
      setAlias("alice", "alice@company.com");
      expect(getAliases()).toEqual({
        dave: "dave@company.com",
        alice: "alice@company.com",
      });
    });

    it("removes an existing alias and returns true", () => {
      setAlias("dave", "dave@company.com");
      expect(removeAlias("dave")).toBe(true);
      expect(getAliases()).toEqual({});
    });

    it("returns false when removing a non-existent alias", () => {
      expect(removeAlias("nobody")).toBe(false);
    });

    it("resolveAlias returns the value for a known alias", () => {
      setAlias("dave", "dave@company.com");
      expect(resolveAlias("dave")).toBe("dave@company.com");
    });

    it("resolveAlias returns the input unchanged for unknown aliases", () => {
      expect(resolveAlias("unknown@email.com")).toBe("unknown@email.com");
    });

    it("aliases survive getConfig round-trip", () => {
      setAlias("dave", "dave@company.com");
      const c = getConfig();
      expect(c.aliases).toEqual({ dave: "dave@company.com" });
    });
  });
});
