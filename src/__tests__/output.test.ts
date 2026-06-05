import { describe, it, expect, vi, afterEach } from "vitest";
import {
  printTable,
  printJson,
  printJsonOk,
  printJsonError,
  printJsonFields,
  printError,
  printSuccess,
  printInfo,
  inferErrorCode,
  EXIT,
} from "../lib/output.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("output", () => {
  describe("printTable", () => {
    it("prints 'No results.' for empty rows", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTable([], [{ key: "id", label: "ID" }]);
      expect(spy).toHaveBeenCalledTimes(1);
      // chalk.dim wraps the text — just check that it was called
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("No results.");
    });

    it("prints header and rows", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTable(
        [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Beta" },
        ],
        [
          { key: "id", label: "ID", width: 5 },
          { key: "name", label: "Name", width: 10 },
        ],
      );
      // header + separator + 2 data rows = 4 calls
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it("truncates long values with ellipsis", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printTable(
        [{ val: "This is a very long string that should be truncated" }],
        [{ key: "val", label: "Val", width: 10 }],
      );
      // header + separator + 1 row = 3 calls
      const rowOutput = spy.mock.calls[2][0] as string;
      expect(rowOutput).toContain("\u2026"); // ellipsis character
    });
  });

  describe("printJson", () => {
    it("prints formatted JSON to stdout", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJson({ foo: "bar", num: 42 });
      expect(spy).toHaveBeenCalledWith(
        JSON.stringify({ foo: "bar", num: 42 }, null, 2),
      );
    });
  });

  describe("printError", () => {
    it("prints to stderr with the message", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      printError("something broke");
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("something broke");
    });
  });

  describe("printSuccess", () => {
    it("prints to stdout with the message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printSuccess("it worked");
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("it worked");
    });
  });

  describe("printInfo", () => {
    it("prints to stdout with the message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printInfo("heads up");
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("heads up");
    });
  });

  describe("printJsonOk", () => {
    it("wraps data in {ok:true, data}", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJsonOk({ id: 7, name: "Acme" });
      const env = JSON.parse(spy.mock.calls[0][0] as string);
      expect(env).toEqual({ ok: true, data: { id: 7, name: "Acme" } });
    });

    it("includes pagination when provided", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJsonOk(
        [1, 2, 3],
        { pagination: { limit: 10, offset: 0, total: 3, hasMore: false } },
      );
      const env = JSON.parse(spy.mock.calls[0][0] as string);
      expect(env.pagination).toEqual({
        limit: 10,
        offset: 0,
        total: 3,
        hasMore: false,
      });
    });
  });

  describe("printJsonError", () => {
    it("wraps in {ok:false, error:{code, message}}", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJsonError("NOT_FOUND", "Customer 999 not found", "try `customer search`");
      const env = JSON.parse(spy.mock.calls[0][0] as string);
      expect(env.ok).toBe(false);
      expect(env.error).toEqual({
        code: "NOT_FOUND",
        message: "Customer 999 not found",
        hint: "try `customer search`",
      });
    });

    it("omits hint when not provided", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJsonError("API", "Backend exploded");
      const env = JSON.parse(spy.mock.calls[0][0] as string);
      expect(env.error).toEqual({ code: "API", message: "Backend exploded" });
    });
  });

  describe("printJsonFields", () => {
    it("prints one field per line", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      printJsonFields(["id", "name", "tickets"]);
      expect(spy.mock.calls.map((c) => c[0])).toEqual(["id", "name", "tickets"]);
    });
  });

  describe("EXIT codes", () => {
    it("exposes the documented codes", () => {
      expect(EXIT.OK).toBe(0);
      expect(EXIT.USAGE).toBe(1);
      expect(EXIT.API).toBe(2);
      expect(EXIT.NOT_FOUND).toBe(3);
      expect(EXIT.AMBIGUOUS).toBe(4);
      expect(EXIT.AUTH).toBe(5);
    });
  });

  describe("inferErrorCode", () => {
    it("classifies AMBIGUOUS prefix", () => {
      expect(inferErrorCode("Ambiguous: 3 customer entities match seqNo=42")).toBe("AMBIGUOUS");
    });

    it("classifies NOT_FOUND prefix", () => {
      expect(inferErrorCode("Not found: customer seqNo=99999")).toBe("NOT_FOUND");
    });

    it("classifies AUTH prefix", () => {
      expect(inferErrorCode("Not authenticated: 401 Unauthorized")).toBe("AUTH");
      expect(inferErrorCode('Not configured. Run "itx login" first.')).toBe("AUTH");
    });

    it("classifies API prefix even when message body contains 'not found'", () => {
      // Regression: inferErrorCode used to use includes() and would have
      // returned NOT_FOUND for any backend body that mentioned "not found".
      expect(inferErrorCode("API error 500 Internal: handler not found")).toBe("API");
    });

    it("falls through to UNKNOWN for unrecognized messages", () => {
      expect(inferErrorCode("something completely unexpected")).toBe("UNKNOWN");
    });
  });
});
