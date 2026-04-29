import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { setConfig, clearConfig } from "../lib/config.js";
import { registerCustomerCommands } from "../commands/customer.js";
import { clearRefdataCache } from "../lib/refdata.js";

afterEach(() => {
  clearConfig();
  clearRefdataCache();
  vi.restoreAllMocks();
});

beforeEach(() => {
  setConfig({
    ssoEndpoint: "https://sso.test.com",
    activeEndpoint: "https://api.test.com",
    tokenv2: "test-token",
    rcntrl: "rc",
    ccntrl: "cc",
  });
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerCustomerCommands(program);
  return program;
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
}

const sampleCustomer = {
  emenId: 6846831,
  name1: "Wright Electrical Ltd",
  name2: null,
  entityType: 2,
  extensions: [
    {
      eeexId: 6846705,
      extType: 10,
      seqNo: 10058,
      active: true,
      thirdPartySystemEntityExtList: [],
      extensionLinks: [],
    },
  ],
  emails: [],
  numbers: [],
  addresses: [],
};

describe("customer search", () => {
  it("emits envelope with pagination + identity projection", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse([sampleCustomer]));
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "node", "itx", "customer", "search", "Wright", "--json",
    ]);

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(true);
    expect(env.data).toHaveLength(1);
    expect(env.data[0].identity.seqNo).toBe(10058);
    expect(env.data[0].matchedOn).toBe("name");
    expect(env.pagination.hasMore).toBe(false);
    // No misleading total
    expect(env.pagination.total).toBeUndefined();
  });
});

describe("customer view", () => {
  it("resolves by seqNo and projects identity + contact", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleCustomer])) // search by seqNo
      .mockResolvedValueOnce(jsonResponse(sampleCustomer))    // re-fetch full
      .mockResolvedValueOnce(jsonResponse([]));               // contact lookup
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "node", "itx", "customer", "view", "10058", "--json",
    ]);

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(true);
    expect(env.data.identity.emenId).toBe(6846831);
    expect(env.data.contact).toBeDefined();
  });

  it("returns NOT_FOUND error envelope when nothing matches", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse([])); // empty search
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await createProgram()
      .parseAsync(["node", "itx", "customer", "view", "99999", "--json"])
      .catch(() => {});

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("NOT_FOUND");
    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});

describe("customer tickets", () => {
  it("filters to eatyId=15 and emits stable schema", async () => {
    const acts = [
      {
        eactId: 1,
        seqNo: 100,
        description: "Bug",
        activityType: { eatyId: 15 },
        emsStatus: { emstId: 295 },
        priority: { empriId: 107 },
        category: { emcaId: 1 },
        creationTs: "2026-04-01T00:00:00Z",
        updateTs: "2026-04-01T00:00:00Z",
      },
      {
        eactId: 2,
        activityType: { eatyId: 11 }, // email — should be filtered out
        creationTs: "2026-04-01T00:00:00Z",
      },
    ];
    const refStatuses = [{ emstId: 295, internalStatus: 1, name: { defaultText: "Open" } }];
    const refPriorities = [{ empriId: 107, name: { defaultText: "Normal" } }];
    const refCategories = [{ emcaId: 1, name: { defaultText: "Support" } }];

    // Sample customer has no extensionLinks → linkedContactEmenIds returns
    // early with no API call, so the mock sequence skips that step.
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleCustomer]))  // resolve search
      .mockResolvedValueOnce(jsonResponse(sampleCustomer))    // re-fetch full
      .mockResolvedValueOnce(jsonResponse(refStatuses))       // refdata
      .mockResolvedValueOnce(jsonResponse(refPriorities))
      .mockResolvedValueOnce(jsonResponse(refCategories))
      .mockResolvedValueOnce(jsonResponse(acts));             // getActivities
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "node", "itx", "customer", "tickets", "10058", "--status", "any", "--json",
    ]);

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(true);
    expect(env.data.tickets).toHaveLength(1);
    expect(env.data.tickets[0].seqNo).toBe(100);
    expect(env.data.tickets[0].status.name).toBe("Open");
  });
});

describe("customer activities", () => {
  it("projects through ActivitySummary and counts by kind", async () => {
    const acts = [
      {
        eactId: 1,
        activityType: { eatyId: 11 },
        creationTs: "2026-04-01T00:00:00Z",
        direction: 2,
        subject: "Hello",
      },
      {
        eactId: 2,
        activityType: { eatyId: 4 },
        creationTs: "2026-04-02T00:00:00Z",
        direction: 1,
      },
    ];
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleCustomer]))
      .mockResolvedValueOnce(jsonResponse(sampleCustomer))
      .mockResolvedValueOnce(jsonResponse(acts));
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "node", "itx", "customer", "activities", "10058", "--json",
    ]);

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(true);
    expect(env.data.activities).toHaveLength(2);
    expect(env.data.counts.email).toBe(1);
    expect(env.data.counts.call).toBe(1);
    // pre-fill: every kind exists with at least 0
    expect(env.data.counts.note).toBe(0);
    expect(env.data.counts.sale).toBe(0);
  });
});
