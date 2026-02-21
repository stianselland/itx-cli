import chalk from "chalk";

export function printTable(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string; width?: number }[],
): void {
  if (rows.length === 0) {
    console.log(chalk.dim("No results."));
    return;
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const dataMax = rows.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(col.label.length, Math.min(dataMax, 50));
  });

  // Print header
  const header = columns
    .map((col, i) => col.label.padEnd(widths[i]))
    .join("  ");
  console.log(chalk.bold(header));
  console.log(chalk.dim("-".repeat(header.length)));

  // Print rows
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

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printError(message: string): void {
  console.error(chalk.red(`Error: ${message}`));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(message));
}

export function printInfo(message: string): void {
  console.log(chalk.blue(message));
}
