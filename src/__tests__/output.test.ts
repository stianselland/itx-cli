import { describe, it, expect, vi, afterEach } from "vitest";
import { printTable, printJson, printError, printSuccess, printInfo } from "../lib/output.js";

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
});
