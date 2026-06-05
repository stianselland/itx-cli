import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { setConfig, clearConfig } from "../lib/config.js";
import { clearRefdataCache } from "../lib/refdata.js";
import { ItxClient } from "../lib/client.js";
import { buildCaseSearchBody } from "../lib/ticketsearch.js";
import { registerTicketCommands } from "../commands/ticket.js";
import { resolveEntity } from "../lib/entity.js";

// `--customer` resolution goes through resolveEntity; stub it so these tests
// stay focused on the fallback logic rather than the entity-search wire format.
vi.mock("../lib/entity.js", () => ({ resolveEntity: vi.fn() }));

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

function jsonResponse(data: unknown) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
}

/** Refdata responses in the order loadRefdata fetches them: statuses, priorities, categories. */
function stubRefdata() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse([
        { emstId: 295, internalStatus: 1, name: { defaultText: "Open" } },
        { emstId: 307, internalStatus: 6, name: { defaultText: "Spam" } },
      ]),
    )
    .mockResolvedValueOnce(
      jsonResponse([{ empriId: 107, name: { defaultText: "Normal" } }]),
    )
    .mockResolvedValueOnce(
      jsonResponse([{ ctnoId: 28757, name: { defaultText: "Admin" } }]),
    );
}

describe("buildCaseSearchBody", () => {
  it("returns an empty body when no filters are set (no network)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = await buildCaseSearchBody(new ItxClient(), {});

    expect(body).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps non-refdata filters without hitting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = await buildCaseSearchBody(new ItxClient(), {
      mine: true,
      unassigned: true,
      following: true,
      seq: ["50729", "50728", "bogus"],
      search: "invoice",
      createdFrom: "2026-06-01",
      updatedTo: "2026-06-05T12:00:00Z",
    });

    expect(body.assignedToSelf).toBe(true);
    expect(body.getUnassignedCasesOnly).toBe(true);
    expect(body.includeFollowedCases).toBe(true);
    expect(body.seqNumbers).toEqual([50729, 50728]); // "bogus" dropped
    expect(body.description).toBe("invoice");
    expect(body.fromInc).toBe(new Date("2026-06-01").toISOString());
    expect(body.updateToInc).toBe(new Date("2026-06-05T12:00:00Z").toISOString());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves status/priority/category names to ids via refdata", async () => {
    vi.stubGlobal("fetch", stubRefdata());

    const body = await buildCaseSearchBody(new ItxClient(), {
      status: ["Open"],
      excludeStatus: ["Spam"],
      priority: ["Normal"],
      category: ["Admin"],
      excludeCategory: ["Admin"],
    });

    expect(body.emsStatuses).toEqual([{ emstId: 295 }]);
    expect(body.excludeEmsStatuses).toEqual([{ emstId: 307 }]);
    expect(body.priorities).toEqual([{ empriId: 107 }]);
    expect(body.categories).toEqual([{ ctnoId: 28757 }]);
    expect(body.excludeCategories).toEqual([{ ctnoId: 28757 }]);
  });

  it("matches refdata names case-insensitively and by substring", async () => {
    vi.stubGlobal("fetch", stubRefdata());

    const body = await buildCaseSearchBody(new ItxClient(), { status: ["open"] });

    expect(body.emsStatuses).toEqual([{ emstId: 295 }]);
  });

  it("throws a Not found error for an unknown status name", async () => {
    vi.stubGlobal("fetch", stubRefdata());

    await expect(
      buildCaseSearchBody(new ItxClient(), { status: ["nope"] }),
    ).rejects.toThrow(/Not found: status "nope"/);
  });

  it("resolves an assignee name to a userId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          { userId: 42, firstName: "Piers", lastName: "Barron", email: "piers@example.com", active: 1 },
        ]),
      ),
    );

    const body = await buildCaseSearchBody(new ItxClient(), { assignee: "Piers Barron" });

    expect(body.assignedToUserIds).toEqual([42]);
  });

  it("throws Not found for an unknown assignee", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([])));

    await expect(
      buildCaseSearchBody(new ItxClient(), { assignee: "ghost" }),
    ).rejects.toThrow(/Not found: user "ghost"/);
  });

  it("maps --customer-emen-id to an entities filter without a lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = await buildCaseSearchBody(new ItxClient(), { customerEmenId: "5051961" });

    expect(body.entities).toEqual([{ emenId: 5051961 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric --customer-emen-id", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      buildCaseSearchBody(new ItxClient(), { customerEmenId: "abc" }),
    ).rejects.toThrow(/Invalid --customer-emen-id/);
  });

  it("rejects a non-numeric --customer seqNo", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      buildCaseSearchBody(new ItxClient(), { customer: "acme" }),
    ).rejects.toThrow(/Invalid --customer/);
  });

  it("resolves --customer as a customer when one matches", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(resolveEntity).mockReset();
    vi.mocked(resolveEntity).mockResolvedValueOnce({ identity: { emenId: 111 } } as never);

    const body = await buildCaseSearchBody(new ItxClient(), { customer: "16930" });

    expect(body.entities).toEqual([{ emenId: 111 }]);
    expect(vi.mocked(resolveEntity)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveEntity)).toHaveBeenNthCalledWith(1, expect.anything(), {
      seqNo: 16930,
      role: "customer",
    });
  });

  it("falls back to prospect resolution when no customer matches", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(resolveEntity).mockReset();
    vi.mocked(resolveEntity)
      .mockRejectedValueOnce(new Error("Not found: customer seqNo=10058"))
      .mockResolvedValueOnce({ identity: { emenId: 222 } } as never);

    const body = await buildCaseSearchBody(new ItxClient(), { customer: "10058" });

    expect(body.entities).toEqual([{ emenId: 222 }]);
    expect(vi.mocked(resolveEntity)).toHaveBeenNthCalledWith(2, expect.anything(), {
      seqNo: 10058,
      role: "prospect",
    });
  });

  it("throws a combined Not found when neither customer nor prospect matches", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(resolveEntity).mockReset();
    vi.mocked(resolveEntity)
      .mockRejectedValueOnce(new Error("Not found: customer seqNo=999"))
      .mockRejectedValueOnce(new Error("Not found: prospect seqNo=999"));

    await expect(
      buildCaseSearchBody(new ItxClient(), { customer: "999" }),
    ).rejects.toThrow(/Not found: no customer or prospect with seqNo=999/);
  });

  it("propagates ambiguity without falling back to prospect", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(resolveEntity).mockReset();
    vi.mocked(resolveEntity).mockRejectedValueOnce(
      new Error("Ambiguous: 2 customer entities match seqNo=5"),
    );

    await expect(
      buildCaseSearchBody(new ItxClient(), { customer: "5" }),
    ).rejects.toThrow(/Ambiguous/);
    expect(vi.mocked(resolveEntity)).toHaveBeenCalledTimes(1);
  });
});

describe("ticket list (filtered)", () => {
  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerTicketCommands(program);
    return program;
  }

  it("POSTs to /cases/search with a status filter in the body", async () => {
    const fetchMock = stubRefdata().mockResolvedValueOnce(
      jsonResponse([{ seqNo: 1, description: "x", emsStatus: { name: { defaultText: "Open" } } }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createProgram().parseAsync([
      "node",
      "itx",
      "ticket",
      "list",
      "--status",
      "Open",
      "--json",
    ]);

    // Last call is the cases/search request (refdata calls precede it).
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url as string).toContain("/rest/itxems/cases/search");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.emsStatuses).toEqual([{ emstId: 295 }]);

    const env = JSON.parse(spy.mock.calls[0][0] as string);
    expect(env.ok).toBe(true);
  });
});
