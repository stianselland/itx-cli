import { Command } from "commander";
import { COMMAND_FIELDS } from "../lib/schemas.js";
import { printJsonOk, printJsonError, exitWithError } from "../lib/output.js";

/**
 * Documented exit codes — single source of truth so AGENTS.md stays in sync.
 */
const EXIT_CODES = [
  { code: 0, name: "OK", description: "Success" },
  { code: 1, name: "USAGE", description: "User input error (missing arg, bad flag combo)" },
  { code: 2, name: "API", description: "API error (network, 5xx, schema mismatch)" },
  { code: 3, name: "NOT_FOUND", description: "The requested resource does not exist" },
  { code: 4, name: "AMBIGUOUS", description: "Multiple matches when one was expected" },
  { code: 5, name: "AUTH", description: "Not authenticated — run `itx login`" },
];

const ENVELOPE_DESCRIPTION = {
  success: { ok: true, data: "<command-specific>", pagination: { limit: 0, offset: 0, total: 0, hasMore: false } },
  error: { ok: false, error: { code: "USAGE | API | NOT_FOUND | AMBIGUOUS | AUTH | UNKNOWN", message: "<human readable>", hint: "<optional remediation>" } },
};

/**
 * `itx schema [command]` — print the JSON contract for a given command (or
 * the index when called without args). Modeled on `gh repo view --json` (lists
 * fields) and AWS `--generate-cli-skeleton` (dumps shape).
 */
export function registerHelpCommands(program: Command): void {
  program
    .command("schema [command]")
    .description(
      "Print the JSON output contract for a command (or the index). Use to teach an LLM the stable shape.",
    )
    .option("--json", "Output JSON envelope (default; flag kept for symmetry)")
    .action((command: string | undefined, opts: { json?: boolean }) => {
      // schema output is always JSON — there's no human variant
      void opts;
      if (!command) {
        const out = {
          envelope: ENVELOPE_DESCRIPTION,
          exitCodes: EXIT_CODES,
          commands: Object.fromEntries(
            Object.entries(COMMAND_FIELDS).map(([k, fields]) => [k, { fields }]),
          ),
        };
        printJsonOk(out);
        return;
      }

      const fields = COMMAND_FIELDS[command];
      if (!fields) {
        printJsonError(
          "NOT_FOUND",
          `No schema for command "${command}"`,
          `Try one of: ${Object.keys(COMMAND_FIELDS).join(", ")}`,
        );
        exitWithError("NOT_FOUND");
      }
      printJsonOk({
        command,
        fields,
        envelope: ENVELOPE_DESCRIPTION.success,
      });
    });

  // `itx help schemas` — alias that prints everything (for CLAUDE.md inclusion).
  const help = program.command("help").description("CLI help and schema introspection");
  help
    .command("schemas")
    .description("Print the full JSON-output schema reference")
    .action(() => {
      printJsonOk({
        envelope: ENVELOPE_DESCRIPTION,
        exitCodes: EXIT_CODES,
        commands: Object.fromEntries(
          Object.entries(COMMAND_FIELDS).map(([k, fields]) => [k, { fields }]),
        ),
      });
    });
}
