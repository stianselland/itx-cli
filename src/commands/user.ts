import { Command } from "commander";
import { isConfigured } from "../lib/config.js";
import { ItxClient } from "../lib/client.js";
import { printTable, printJson, printError, printInfo } from "../lib/output.js";

function requireAuth(): ItxClient {
  if (!isConfigured()) {
    printError('Not configured. Run "itx login" first.');
    process.exit(1);
  }
  return new ItxClient();
}

export function registerUserCommands(program: Command): void {
  const user = program
    .command("user")
    .alias("u")
    .description("Manage users");

  user
    .command("list")
    .alias("ls")
    .description("List all users")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json: boolean }) => {
      const client = requireAuth();
      try {
        const users = await client.searchUsers();

        if (opts.json) {
          printJson(users);
          return;
        }

        printInfo(`${users.length} users`);

        printTable(
          users.map((u) => ({
            userId: u.userId,
            name: [u.firstName, u.lastName].filter(Boolean).join(" "),
            email: u.email ?? "",
            active: u.active ? "Yes" : "No",
          })),
          [
            { key: "userId", label: "ID", width: 10 },
            { key: "name", label: "Name", width: 25 },
            { key: "email", label: "Email", width: 30 },
            { key: "active", label: "Active", width: 8 },
          ],
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
