import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  setConfig,
  clearConfig,
  getConfig,
  getAliases,
  setAlias,
} from "../lib/config.js";
import { registerConfigCommands, parseApiKey } from "../commands/config.js";
import { registerTicketCommands, ROLES } from "../commands/ticket.js";
import { registerUserCommands } from "../commands/user.js";
import { registerAliasCommands } from "../commands/alias.js";

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

function jsonResponse(data: unknown) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => data,
  };
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

describe("parseApiKey", () => {
  it("parses full API key with leading ?", () => {
    const result = parseApiKey("?tokenv2=abc123&rcntrl=1407055&ccntrl=60000654");
    expect(result).toEqual({
      tokenv2: "abc123",
      rcntrl: "1407055",
      ccntrl: "60000654",
    });
  });

  it("parses API key without leading ?", () => {
    const result = parseApiKey("tokenv2=abc123&rcntrl=100&ccntrl=200");
    expect(result).toEqual({
      tokenv2: "abc123",
      rcntrl: "100",
      ccntrl: "200",
    });
  });

  it("handles whitespace around input", () => {
    const result = parseApiKey("  ?tokenv2=abc123&rcntrl=1&ccntrl=2  ");
    expect(result).toEqual({
      tokenv2: "abc123",
      rcntrl: "1",
      ccntrl: "2",
    });
  });

  it("returns null if tokenv2 is missing", () => {
    expect(parseApiKey("?rcntrl=1&ccntrl=2")).toBeNull();
  });

  it("defaults rcntrl and ccntrl to empty string if missing", () => {
    const result = parseApiKey("?tokenv2=abc123");
    expect(result).toEqual({
      tokenv2: "abc123",
      rcntrl: "",
      ccntrl: "",
    });
  });
});

describe("ticket commands", () => {
  beforeEach(() => {
    setConfig({
      ssoEndpoint: "https://sso.test.com",
      activeEndpoint: "https://sso.test.com",
      tokenv2: "test-token",
    });
  });

  it("ROLES constants are correct", () => {
    expect(ROLES.ASSIGNED_USER).toBe(1);
    expect(ROLES.CASE_FOLLOWER).toBe(2);
    expect(ROLES.CONTACT_PERSON).toBe(20);
  });

  it("ticket list calls the API with correct params and outputs table", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          seqNo: 1,
          description: "Bug report",
          emsStatus: { name: { defaultText: "Open" } },
          creationTs: "2025-01-01T00:00:00Z",
        },
        {
          seqNo: 2,
          description: "Feature req",
          emsStatus: { name: { defaultText: "Closed" } },
          creationTs: "2025-01-02T00:00:00Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "list", "-l", "10", "-o", "5"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/itxems/cases");
    expect(calledUrl).toContain("getMembers=true");
    expect(calledUrl).toContain("limitFrom=5");
    expect(calledUrl).toContain("limitTo=10");
  });

  it("ticket list --json outputs raw JSON", async () => {
    const responseData = [
      { seqNo: 1, description: "Test" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(responseData)),
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "list", "--json"]);

    expect(spy).toHaveBeenCalledWith(JSON.stringify(responseData, null, 2));
  });

  it("ticket get fetches a single ticket", async () => {
    const ticketData = [
      {
        seqNo: 42,
        description: "Server issue",
        emsStatus: { name: { defaultText: "Open" } },
        priority: { name: { defaultText: "High" } },
        category: { name: { defaultText: "Dev" } },
        creationTs: "2025-01-01T00:00:00Z",
        updateTs: "2025-01-02T00:00:00Z",
        members: [
          { role: 1, user: { firstName: "Alice", lastName: "Smith" } },
          { role: 2, user: { firstName: "Bob", lastName: "Jones" } },
          {
            role: 20,
            anon: true,
            entityExtension: {
              entity: { name1: "Charlie", name2: "Brown" },
            },
          },
        ],
      },
    ];
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(ticketData));
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "get", "42"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/itxems/cases");
    expect(calledUrl).toContain("seqNo=42");

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Server issue");
    expect(output).toContain("Alice Smith");
    expect(output).toContain("[Assigned]");
    expect(output).toContain("[Follower]");
    expect(output).toContain("[Contact]");
    expect(output).toContain("(external)");
  });

  it("ticket create sends POST with subject", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ seqNo: 99 }),
    );
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
    ]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/rest/itxems/cases");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string);
    expect(body.description).toBe("New ticket");
  });

  it("ticket update sends PUT with fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ seqNo: 42 }),
    );
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
    expect(url).toContain("/rest/itxems/cases");
    expect(opts.method).toBe("PUT");

    const body = JSON.parse(opts.body as string);
    expect(body.seqNo).toBe(42);
    expect(body.description).toBe("Updated subject");
    expect(body.status).toBe("resolved");
  });

  it("ticket alias 't' works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([])),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "t", "ls"]);
    // If it didn't throw, the alias worked
  });

  it("ticket update sends category and assignee", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ seqNo: 42 }),
    );
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
    expect(url).toContain("/rest/itxems/cases");
    expect(opts.method).toBe("PUT");

    const body = JSON.parse(opts.body as string);
    expect(body.seqNo).toBe(42);
    expect(body.category).toBe("billing");
    expect(body.members).toEqual([
      { role: ROLES.ASSIGNED_USER, name: "alice@company.com" },
    ]);
  });

  it("ticket update resolves assignee alias", async () => {
    setAlias("dave", "dave@company.com");

    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ seqNo: 42 }),
    );
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

  it("ticket activities fetches comments and linked activities", async () => {
    // The activities command makes multiple API calls:
    // 1. GET /rest/itxems/cases?seqNo=42&getComments=true
    // 2. POST /rest/itxems/cases/search (get links)
    // 3. POST /rest/itxems/activities/search (get linked activities)
    // 4. GET /rest/itxems/emailcontent (for each email)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // 1. GET case by seqNo
        jsonResponse([
          {
            eactId: 1000,
            seqNo: 42,
            texts: [
              {
                creationTs: "2025-06-01T10:00:00Z",
                creator: { firstName: "Alice", lastName: "Smith" },
                text: "Looking into this now",
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        // 2. POST cases/search - case with links
        jsonResponse([
          {
            eactId: 1000,
            links: [
              {
                type: 14,
                from: { eactId: 2000 },
                to: { eactId: 1000 },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        // 3. POST activities/search - linked activities
        jsonResponse([
          {
            eactId: 2000,
            activityType: { eatyId: 4 },
            direction: 1,
            creationTs: "2025-06-01T09:00:00Z",
            srcNumber: "+44123",
            dstNumber: "+44456",
            startTs: "2025-06-01T09:00:00Z",
            endTs: "2025-06-01T09:05:00Z",
            members: [
              { role: 0, anon: false, user: { firstName: "Bob", lastName: "Jones" } },
              {
                role: 20,
                anon: true,
                entityExtension: { entity: { name1: "Charlie", name2: "Brown" } },
              },
            ],
          },
        ]),
      );

    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "activities", "42"]);

    // Verify API calls
    const call1Url = mockFetch.mock.calls[0][0] as string;
    expect(call1Url).toContain("/rest/itxems/cases");
    expect(call1Url).toContain("seqNo=42");
    expect(call1Url).toContain("getComments=true");

    const call2Url = mockFetch.mock.calls[1][0] as string;
    expect(call2Url).toContain("/rest/itxems/cases/search");

    const call3Url = mockFetch.mock.calls[2][0] as string;
    expect(call3Url).toContain("/rest/itxems/activities/search");

    const output = spy.mock.calls.map((c) => c[0] ?? c.join(" ")).join("\n");
    expect(output).toContain("Alice Smith");
    expect(output).toContain("Looking into this now");
    expect(output).toContain("[Call ->]");
    expect(output).toContain("Charlie Brown");
    expect(output).toContain("5m 0s");
  });

  it("ticket activities --json outputs raw JSON", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse([{ eactId: 1000, seqNo: 42, texts: [{ text: "hi" }] }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ eactId: 1000, links: [] }]),
      );

    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync(["node", "itx", "ticket", "activities", "42", "--json"]);

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveProperty("activities");
    expect(output).toHaveProperty("comments");
    expect(output.comments).toEqual([{ text: "hi" }]);
  });

  it("ticket comment without mention uses activitytexts endpoint", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // GET case by seqNo
        jsonResponse([{ eactId: 1000, seqNo: 42 }]),
      )
      .mockResolvedValueOnce(
        // POST activitytexts
        jsonResponse({ eateId: 999 }),
      );
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

    // First call: fetch case
    const call1Url = mockFetch.mock.calls[0][0] as string;
    expect(call1Url).toContain("/rest/itxems/cases");
    expect(call1Url).toContain("seqNo=42");

    // Second call: POST activitytexts
    const [url2, opts2] = mockFetch.mock.calls[1];
    expect(url2).toContain("/rest/itxems/activitytexts");
    expect(opts2.method).toBe("POST");

    const body = JSON.parse(opts2.body as string);
    expect(body.text).toBe("<p>This is my comment</p>");
    expect(body.activity).toEqual({ eactId: 1000 });
    expect(body.data).toBeUndefined();
  });

  it("ticket comment --mention with alias resolves user and sends tags", async () => {
    setAlias("dave", "dave@company.com");

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        // GET case by seqNo
        jsonResponse([{ eactId: 1000, seqNo: 42 }]),
      )
      .mockResolvedValueOnce(
        // POST users/search
        jsonResponse([
          { userId: 123, firstName: "Dave", lastName: "Smith", email: "dave@company.com", active: 1 },
          { userId: 456, firstName: "Alice", lastName: "Jones", email: "alice@company.com", active: 1 },
        ]),
      )
      .mockResolvedValueOnce(
        // POST activitytexts
        jsonResponse({ eateId: 999 }),
      );
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
      "Please look at this",
      "--mention",
      "dave",
    ]);

    // Verify activitytexts call
    const [url3, opts3] = mockFetch.mock.calls[2];
    expect(url3).toContain("/rest/itxems/activitytexts");

    const body = JSON.parse(opts3.body as string);
    expect(body.text).toContain("@Dave Smith");
    expect(body.text).toContain("Please look at this");
    expect(body.text).toContain("\uFEFF");
    expect(body.activity).toEqual({ eactId: 1000 });
    expect(body.data.tags).toHaveLength(1);
    expect(body.data.tags[0]).toEqual({
      startIndex: 4,
      length: 11, // "@Dave Smith"
      type: "user",
      data: "123",
    });
  });

  it("ticket comment --mention with email resolves user", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse([{ eactId: 2000, seqNo: 10 }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { userId: 789, firstName: "Alice", lastName: "Jones", email: "alice@company.com", active: 1 },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({ eateId: 888 }),
      );
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerTicketCommands(program);

    await program.parseAsync([
      "node",
      "itx",
      "ticket",
      "comment",
      "10",
      "-m",
      "Check this",
      "--mention",
      "alice@company.com",
    ]);

    const body = JSON.parse(mockFetch.mock.calls[2][1].body as string);
    expect(body.text).toContain("@Alice Jones");
    expect(body.data.tags[0].data).toBe("789");
  });
});

describe("user commands", () => {
  beforeEach(() => {
    setConfig({
      ssoEndpoint: "https://sso.test.com",
      activeEndpoint: "https://sso.test.com",
      tokenv2: "test-token",
    });
  });

  it("user list displays table of users", async () => {
    const users = [
      { userId: 1, firstName: "Alice", lastName: "Smith", email: "alice@co.com", active: 1 },
      { userId: 2, firstName: "Bob", lastName: "Jones", email: "bob@co.com", active: 0 },
    ];
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(users));
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerUserCommands(program);

    await program.parseAsync(["node", "itx", "user", "list"]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/rest/core/users/search");

    const output = spy.mock.calls.map((c) => c[0] ?? c.join(" ")).join("\n");
    expect(output).toContain("Alice Smith");
    expect(output).toContain("alice@co.com");
    expect(output).toContain("Bob Jones");
  });

  it("user list --json outputs raw JSON", async () => {
    const users = [
      { userId: 1, firstName: "Alice", lastName: "Smith", email: "alice@co.com", active: 1 },
    ];
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(users));
    vi.stubGlobal("fetch", mockFetch);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    registerUserCommands(program);

    await program.parseAsync(["node", "itx", "user", "list", "--json"]);

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveLength(1);
    expect(output[0].firstName).toBe("Alice");
  });
});

describe("top-level alias commands", () => {
  it("alias set creates an alias", async () => {
    const program = createProgram();
    registerAliasCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "itx",
      "alias",
      "set",
      "dave",
      "dave@company.com",
    ]);

    expect(getAliases()).toEqual({ dave: "dave@company.com" });
  });

  it("alias list shows aliases", async () => {
    setAlias("dave", "dave@company.com");
    setAlias("alice", "alice@company.com");

    const program = createProgram();
    registerAliasCommands(program);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "itx", "alias", "list"]);

    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("dave");
    expect(output).toContain("dave@company.com");
    expect(output).toContain("alice");
  });

  it("alias remove deletes an alias", async () => {
    setAlias("dave", "dave@company.com");

    const program = createProgram();
    registerAliasCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync([
      "node",
      "itx",
      "alias",
      "remove",
      "dave",
    ]);

    expect(getAliases()).toEqual({});
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
