import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  setConfig,
  clearConfig,
  getConfig,
  getAliases,
  setAlias,
} from "../lib/config.js";
import { registerConfigCommands } from "../commands/config.js";
import { registerTicketCommands, ROLES } from "../commands/ticket.js";

afterEach(() => {
  clearConfig();
  vi.restoreAllMocks();
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

describe("config commands", () => {
  it("config set stores credentials", async () => {
    const program = createProgram();
    registerConfigCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "itx",
      "config",
      "set",
      "--sso-endpoint",
      "https://sso.test.com",
      "--tokenv2",
      "tok123",
      "--rcntrl",
      "rc1",
      "--ccntrl",
      "cc1",
    ]);

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("https://sso.test.com");
    expect(c.tokenv2).toBe("tok123");
    expect(c.rcntrl).toBe("rc1");
    expect(c.ccntrl).toBe("cc1");
  });

  it("config set requires --sso-endpoint and --tokenv2", async () => {
    const program = createProgram();
    registerConfigCommands(program);

    await expect(
      program.parseAsync(["node", "itx", "config", "set"]),
    ).rejects.toThrow();
  });

  it("config show prints current config", async () => {
    setConfig({
      ssoEndpoint: "https://sso.test.com",
      tokenv2: "abcdefghijklmnop",
    });

    const program = createProgram();
    registerConfigCommands(program);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "itx", "config", "show"]);

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("https://sso.test.com");
    // Token should be masked (not fully visible)
    expect(output).toContain("...");
    expect(output).not.toContain("abcdefghijklmnop");
  });

  it("config show --reveal shows full tokens", async () => {
    setConfig({
      ssoEndpoint: "https://sso.test.com",
      tokenv2: "abcdefghijklmnop",
    });

    const program = createProgram();
    registerConfigCommands(program);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "itx", "config", "show", "--reveal"]);

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("abcdefghijklmnop");
  });

  it("config clear removes all config", async () => {
    setConfig({ ssoEndpoint: "https://sso.test.com", tokenv2: "tok" });

    const program = createProgram();
    registerConfigCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "itx", "config", "clear"]);

    const c = getConfig();
    expect(c.ssoEndpoint).toBe("");
    expect(c.tokenv2).toBe("");
  });
});

describe("ticket commands", () => {
  beforeEach(() => {
    setConfig({
      ssoEndpoint: "https://sso.test.com",
      tokenv2: "test-token",
    });
  });

  it("ROLES constants are correct", () => {
    expect(ROLES.ASSIGNED_USER).toBe(1);
    expect(ROLES.CASE_FOLLOWER).toBe(2);
    expect(ROLES.CONTACT_PERSON).toBe(20);
  });

  it("ticket list calls the API with correct params and outputs table", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        activities: [
          { id: 1, subject: "Bug report", status: "open", createdTs: "2025-01-01T00:00:00Z" },
          { id: 2, subject: "Feature req", status: "closed", createdTs: "2025-01-02T00:00:00Z" },
        ],
        totalActivityCount: 2,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "list", "-l", "10", "-o", "5"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/itxems/activities");
    expect(calledUrl).toContain("eatyId=4");
    expect(calledUrl).toContain("limitFrom=5");
    expect(calledUrl).toContain("limitTo=10");
  });

  it("ticket list --json outputs raw JSON", async () => {
    const responseData = {
      activities: [{ id: 1, subject: "Test" }],
      totalActivityCount: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => responseData,
      }),
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "list", "--json"]);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(responseData, null, 2));
  });

  it("ticket get fetches a single ticket", async () => {
    const ticketData = {
      id: 42,
      subject: "Server issue",
      status: "open",
      createdTs: "2025-01-01T00:00:00Z",
      modifiedTs: "2025-01-02T00:00:00Z",
      members: [
        { role: 1, name: "Alice" },
        { role: 2, name: "Bob" },
        { role: 20, name: "Charlie", anon: true },
      ],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ticketData,
    });
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "get", "42"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/itxems/activities/42");

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Server issue");
    expect(output).toContain("Alice");
    expect(output).toContain("[Assigned]");
    expect(output).toContain("[Follower]");
    expect(output).toContain("[Contact]");
    expect(output).toContain("(external)");
  });

  it("ticket create sends POST with subject", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 99 }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "create",
      "-s",
      "New ticket",
      "-d",
      "Description here",
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rest/itxems/activities");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string);
    expect(body.subject).toBe("New ticket");
    expect(body.description).toBe("Description here");
    expect(body.activityType).toBe(4);
  });

  it("ticket update sends PUT with fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 42 }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "update",
      "42",
      "-s",
      "Updated subject",
      "--status",
      "resolved",
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rest/itxems/activities/42");
    expect(opts.method).toBe("PUT");

    const body = JSON.parse(opts.body as string);
    expect(body.subject).toBe("Updated subject");
    expect(body.status).toBe("resolved");
  });

  it("ticket alias 't' works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ activities: [], totalActivityCount: 0 }),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "t", "ls"]);
    // If it didn't throw, the alias worked
  });

  it("ticket update sends category and assignee", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 42 }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "update",
      "42",
      "--category",
      "billing",
      "--assignee",
      "alice@company.com",
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rest/itxems/activities/42");
    expect(opts.method).toBe("PUT");

    const body = JSON.parse(opts.body as string);
    expect(body.category).toBe("billing");
    expect(body.members).toEqual([
      { role: ROLES.ASSIGNED_USER, name: "alice@company.com" },
    ]);
  });

  it("ticket update resolves assignee alias", async () => {
    setAlias("dave", "dave@company.com");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 42 }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "update",
      "42",
      "--assignee",
      "dave",
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.members).toEqual([
      { role: ROLES.ASSIGNED_USER, name: "dave@company.com" },
    ]);
  });

  it("ticket activities fetches comments for a ticket", async () => {
    const commentsData = {
      comments: [
        {
          createdTs: "2025-06-01T10:00:00Z",
          createdBy: "alice@company.com",
          text: "Looking into this now",
        },
        {
          createdTs: "2025-06-01T11:00:00Z",
          createdBy: "bob@company.com",
          text: "Fixed in latest release",
        },
      ],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => commentsData,
    });
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "activities", "42"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/itxems/activities/42/comments");

    const output = spy.mock.calls.map((c) => c[0] ?? c.join(" ")).join("\n");
    expect(output).toContain("alice@company.com");
    expect(output).toContain("Looking into this now");
    expect(output).toContain("bob@company.com");
  });

  it("ticket activities --json outputs raw JSON", async () => {
    const commentsData = { comments: [{ text: "hi" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => commentsData,
      }),
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "activities", "42", "--json"]);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(commentsData, null, 2));
  });

  it("ticket comment sends POST with message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 100 }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "comment",
      "42",
      "-m",
      "This is my comment",
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rest/itxems/activities/42/comments");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string);
    expect(body.text).toBe("This is my comment");
  });
});

describe("alias commands", () => {
  it("config alias set creates an alias", async () => {
    const program = createProgram();
    registerConfigCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "itx",
      "config",
      "alias",
      "set",
      "dave",
      "dave@company.com",
    ]);

    expect(getAliases()).toEqual({ dave: "dave@company.com" });
  });

  it("config alias list shows aliases", async () => {
    setAlias("dave", "dave@company.com");
    setAlias("alice", "alice@company.com");

    const program = createProgram();
    registerConfigCommands(program);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "itx", "config", "alias", "list"]);

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("dave");
    expect(output).toContain("dave@company.com");
    expect(output).toContain("alice");
  });

  it("config alias remove deletes an alias", async () => {
    setAlias("dave", "dave@company.com");

    const program = createProgram();
    registerConfigCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "itx",
      "config",
      "alias",
      "remove",
      "dave",
    ]);

    expect(getAliases()).toEqual({});
  });
});
