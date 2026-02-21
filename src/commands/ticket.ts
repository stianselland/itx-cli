import { Command } from "commander";
import { isConfigured, resolveAlias } from "../lib/config.js";
import { ItxClient } from "../lib/client.js";
import {
  printTable,
  printJson,
  printError,
  printSuccess,
  printInfo,
} from "../lib/output.js";

/** Known activity type ID for tickets/cases in ITX. */
const TICKET_ACTIVITY_TYPE = 4;

/** Role constants for ticket members. */
export const ROLES = {
  ASSIGNED_USER: 1,
  CASE_FOLLOWER: 2,
  CONTACT_PERSON: 20,
} as const;

function requireAuth(): ItxClient {
  if (!isConfigured()) {
    printError('Not configured. Run "itx config set" first.');
    process.exit(1);
  }
  return new ItxClient();
}

export function registerTicketCommands(program: Command): void {
  const ticket = program
    .command("ticket")
    .alias("t")
    .description("Manage tickets (cases)");

  ticket
    .command("list")
    .alias("ls")
    .description("List tickets")
    .option("-l, --limit <n>", "Maximum number of tickets to return", "25")
    .option("-o, --offset <n>", "Offset for pagination", "0")
    .option("--json", "Output raw JSON")
    .action(async (opts: { limit: string; offset: string; json: boolean }) => {
      const client = requireAuth();
      try {
        const data = await client.request<{ activities?: Record<string, unknown>[]; totalActivityCount?: number }>(
          "/rest/itxems/activities",
          {
            params: {
              eatyId: TICKET_ACTIVITY_TYPE,
              getMembers: true,
              getTotalActivityCount: true,
              limitFrom: Number(opts.offset),
              limitTo: Number(opts.limit),
            },
          },
        );

        if (opts.json) {
          printJson(data);
          return;
        }

        const activities = data.activities ?? [];
        if (data.totalActivityCount !== undefined) {
          printInfo(`Total tickets: ${data.totalActivityCount}`);
        }

        printTable(
          activities.map((a) => ({
            id: a.id,
            subject: a.subject ?? a.name ?? "",
            status: a.status ?? "",
            created: a.createdTs
              ? new Date(a.createdTs as string).toLocaleDateString()
              : "",
          })),
          [
            { key: "id", label: "ID", width: 10 },
            { key: "subject", label: "Subject", width: 40 },
            { key: "status", label: "Status", width: 15 },
            { key: "created", label: "Created", width: 12 },
          ],
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  ticket
    .command("get <id>")
    .description("Get details of a specific ticket")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth();
      try {
        const data = await client.request<Record<string, unknown>>(
          `/rest/itxems/activities/${id}`,
          {
            params: {
              getMembers: true,
            },
          },
        );

        if (opts.json) {
          printJson(data);
          return;
        }

        console.log(`ID:       ${data.id}`);
        console.log(`Subject:  ${data.subject ?? data.name ?? ""}`);
        console.log(`Status:   ${data.status ?? ""}`);
        console.log(
          `Created:  ${data.createdTs ? new Date(data.createdTs as string).toISOString() : ""}`,
        );
        console.log(
          `Modified: ${data.modifiedTs ? new Date(data.modifiedTs as string).toISOString() : ""}`,
        );

        const members = data.members as
          | { role?: number; name?: string; anon?: boolean }[]
          | undefined;
        if (members?.length) {
          console.log("\nMembers:");
          for (const m of members) {
            const roleLabel =
              m.role === ROLES.ASSIGNED_USER
                ? "Assigned"
                : m.role === ROLES.CASE_FOLLOWER
                  ? "Follower"
                  : m.role === ROLES.CONTACT_PERSON
                    ? "Contact"
                    : `Role ${m.role}`;
            console.log(`  - ${m.name ?? "(unknown)"} [${roleLabel}]${m.anon ? " (external)" : ""}`);
          }
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  ticket
    .command("create")
    .description("Create a new ticket")
    .requiredOption("-s, --subject <text>", "Ticket subject")
    .option("-d, --description <text>", "Ticket description")
    .option("--json", "Output raw JSON")
    .action(
      async (opts: {
        subject: string;
        description?: string;
        json: boolean;
      }) => {
        const client = requireAuth();
        try {
          const body: Record<string, unknown> = {
            activityType: TICKET_ACTIVITY_TYPE,
            subject: opts.subject,
          };
          if (opts.description) {
            body.description = opts.description;
          }

          const data = await client.request<Record<string, unknown>>(
            "/rest/itxems/activities",
            {
              method: "POST",
              body,
            },
          );

          if (opts.json) {
            printJson(data);
            return;
          }

          printSuccess(`Ticket created: ${data.id}`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  ticket
    .command("update <id>")
    .description("Update an existing ticket")
    .option("-s, --subject <text>", "New subject")
    .option("--status <status>", "New status")
    .option("--category <category>", "New category")
    .option("--assignee <user>", "Assign to user (email or alias)")
    .option("--json", "Output raw JSON")
    .action(
      async (
        id: string,
        opts: {
          subject?: string;
          status?: string;
          category?: string;
          assignee?: string;
          json: boolean;
        },
      ) => {
        const client = requireAuth();
        try {
          const body: Record<string, unknown> = {};
          if (opts.subject) body.subject = opts.subject;
          if (opts.status) body.status = opts.status;
          if (opts.category) body.category = opts.category;
          if (opts.assignee) {
            body.members = [
              { role: ROLES.ASSIGNED_USER, name: resolveAlias(opts.assignee) },
            ];
          }

          if (Object.keys(body).length === 0) {
            printError(
              "Provide at least one field to update (--subject, --status, --category, --assignee).",
            );
            process.exit(1);
          }

          const data = await client.request<Record<string, unknown>>(
            `/rest/itxems/activities/${id}`,
            {
              method: "PUT",
              body,
            },
          );

          if (opts.json) {
            printJson(data);
            return;
          }

          printSuccess(`Ticket ${id} updated.`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  ticket
    .command("activities <id>")
    .alias("act")
    .description("List activities and comments on a ticket")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth();
      try {
        const data = await client.request<{
          comments?: Record<string, unknown>[];
        }>(`/rest/itxems/activities/${id}/comments`);

        if (opts.json) {
          printJson(data);
          return;
        }

        const comments = data.comments ?? [];
        if (comments.length === 0) {
          printInfo("No activities or comments.");
          return;
        }

        for (const c of comments) {
          const date = c.createdTs
            ? new Date(c.createdTs as string).toLocaleString()
            : "";
          const author = c.createdBy ?? c.author ?? "(unknown)";
          console.log(
            `[${date}] ${author as string}:`,
          );
          console.log(`  ${c.text ?? c.body ?? ""}`);
          console.log();
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  ticket
    .command("comment <id>")
    .description("Add a comment to a ticket")
    .requiredOption("-m, --message <text>", "Comment text")
    .option("--json", "Output raw JSON")
    .action(
      async (
        id: string,
        opts: { message: string; json: boolean },
      ) => {
        const client = requireAuth();
        try {
          const data = await client.request<Record<string, unknown>>(
            `/rest/itxems/activities/${id}/comments`,
            {
              method: "POST",
              body: { text: opts.message },
            },
          );

          if (opts.json) {
            printJson(data);
            return;
          }

          printSuccess(`Comment added to ticket ${id}.`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );
}
