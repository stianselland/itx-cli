import chalk from "chalk";

/**
 * Exit codes — distinct values per failure mode so agents can branch on outcome
 * without parsing stderr. See AGENTS.md for the contract.
 */
export const EXIT = {
  OK: 0,
  USAGE: 1,
  API: 2,
  NOT_FOUND: 3,
  AMBIGUOUS: 4,
  AUTH: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Stable error codes used in the JSON error envelope. */
export type ErrorCode =
  | "USAGE"
  | "API"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "AUTH"
  | "UNKNOWN";

const ERROR_TO_EXIT: Record<ErrorCode, ExitCode> = {
  USAGE: EXIT.USAGE,
  API: EXIT.API,
  NOT_FOUND: EXIT.NOT_FOUND,
  AMBIGUOUS: EXIT.AMBIGUOUS,
  AUTH: EXIT.AUTH,
  UNKNOWN: EXIT.API,
};

export interface Pagination {
  limit: number;
  offset: number;
  total?: number;
  hasMore?: boolean;
}

export interface JsonOk<T> {
  ok: true;
  data: T;
  pagination?: Pagination;
  /**
   * `truncated` is set to `true` when an underlying API page hit the 1000-row
   * server cap and the result may be incomplete. Agents should treat
   * truncated results as suggestive rather than complete.
   */
  meta?: { durationMs?: number; truncated?: boolean; warnings?: string[] };
}

export interface JsonErr {
  ok: false;
  error: { code: ErrorCode; message: string; hint?: string };
  meta?: { durationMs?: number };
}

/**
 * stdout is reserved for data so consumers can pipe to jq without filtering.
 * Returns whether the stream is a TTY (used to suppress chalk on pipes).
 */
export function isStdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

/**
 * Print a value as machine-readable JSON envelope on stdout.
 * Pretty-printed when stdout is a TTY, compact when piped (saves bytes for agents).
 */
export function printJsonOk<T>(
  data: T,
  opts: { pagination?: Pagination; meta?: JsonOk<T>["meta"] } = {},
): void {
  const env: JsonOk<T> = { ok: true, data };
  if (opts.pagination) env.pagination = opts.pagination;
  if (opts.meta) env.meta = opts.meta;
  const indent = isStdoutTty() ? 2 : 0;
  console.log(JSON.stringify(env, null, indent));
}

/** Print an error envelope on stdout (so an agent that pipes can still parse it). */
export function printJsonError(
  code: ErrorCode,
  message: string,
  hint?: string,
): void {
  const env: JsonErr = {
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
  };
  const indent = isStdoutTty() ? 2 : 0;
  console.log(JSON.stringify(env, null, indent));
}

/**
 * Print a list of available top-level data fields for the gh-style
 * "--json with no value" introspection. Goes to stdout, one per line.
 */
export function printJsonFields(fields: string[]): void {
  for (const f of fields) console.log(f);
}

/**
 * Exit with the appropriate code for a given error category.
 * Single chokepoint so we never accidentally diverge from the documented mapping.
 */
export function exitWithError(code: ErrorCode): never {
  process.exit(ERROR_TO_EXIT[code]);
}

/**
 * Unified error handler — prints either a human message (stderr) or a JSON
 * error envelope (stdout), then exits with the documented code.
 *
 * Use at the end of every command's catch block.
 */
export function handleError(
  err: unknown,
  opts: { json?: boolean; code?: ErrorCode; hint?: string } = {},
): never {
  const message = err instanceof Error ? err.message : String(err);
  const code = opts.code ?? inferErrorCode(message);
  if (opts.json) {
    printJsonError(code, message, opts.hint);
  } else {
    printError(message);
    if (opts.hint) console.error(opts.hint);
  }
  exitWithError(code);
}

/**
 * Infer an error code from an Error message.
 *
 * Order matters: check unambiguous prefixes (`api error`) before substring
 * matches (`not found`) so backend errors that happen to contain "not found"
 * in their body are correctly classified as API errors. Auth-class messages
 * win over both because the original error path that throws them does so
 * specifically (not as a generic API error).
 */
export function inferErrorCode(message: string): ErrorCode {
  const lower = message.toLowerCase();
  if (lower.startsWith("not authenticated") || lower.startsWith("not configured")) return "AUTH";
  if (lower.startsWith("ambiguous")) return "AMBIGUOUS";
  if (lower.startsWith("not found")) return "NOT_FOUND";
  if (lower.startsWith("api error")) return "API";
  return "UNKNOWN";
}

/**
 * Print a user-facing error to stderr (red when TTY, plain when piped).
 * Does NOT exit — caller picks the exit code.
 */
export function printError(message: string): void {
  const out = process.stderr.isTTY ? chalk.red(`Error: ${message}`) : `Error: ${message}`;
  console.error(out);
}

export function printSuccess(message: string): void {
  const out = isStdoutTty() ? chalk.green(message) : message;
  console.log(out);
}

export function printInfo(message: string): void {
  const out = isStdoutTty() ? chalk.blue(message) : message;
  console.log(out);
}

/**
 * Legacy raw-JSON printer kept for callers that haven't moved to the envelope.
 * @deprecated use printJsonOk/printJsonError
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string; width?: number }[],
): void {
  if (rows.length === 0) {
    console.log(isStdoutTty() ? chalk.dim("No results.") : "No results.");
    return;
  }

  const tty = isStdoutTty();
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(col.label.length, Math.min(dataMax, 50));
  });

  const header = columns
    .map((col, i) => col.label.padEnd(widths[i]))
    .join("  ");
  console.log(tty ? chalk.bold(header) : header);
  console.log(tty ? chalk.dim("-".repeat(header.length)) : "-".repeat(header.length));

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col.key] ?? "");
        return val.length > widths[i]
          ? val.slice(0, widths[i] - 1) + "\u2026"
          : val.padEnd(widths[i]);
      })
      .join("  ");
    console.log(line);
  }
}
