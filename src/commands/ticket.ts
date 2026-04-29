import { Command } from "commander";
import { resolveAlias } from "../lib/config.js";
import { type ItxUser } from "../lib/client.js";
import { requireAuth } from "../lib/auth.js";
import {
  printTable,
  printJsonOk,
  printError,
  printSuccess,
  printInfo,
  printJsonError,
  handleError,
  exitWithError,
} from "../lib/output.js";
import {
  ROLES,
  ACTIVITY_TYPES,
  activityTypeLabel,
  formatDuration,
  htmlToText,
  projectActivity,
  resolveTicketActivities,
} from "../lib/activities.js";
import type { TicketActivitiesResult } from "../lib/schemas.js";

// Re-export for callers that imported ROLES from this module.
export { ROLES };

/** Extract a translated name, falling back to defaultText. */
function translateName(nameObj: Record<string, unknown> | undefined): string {
  if (!nameObj) return "";
  const translations = nameObj.translations as
    | Record<string, { translatedText?: string }>
    | undefined;
  return (
    translations?.en?.translatedText ??
    (nameObj.defaultText as string) ??
    ""
  );
}

/** Build a display name from a member's user or entity. */
function memberName(member: Record<string, unknown>): string {
  const user = member.user as
    | { firstName?: string; lastName?: string }
    | undefined;
  if (user?.firstName || user?.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  const ext = member.entityExtension as
    | { entity?: { name1?: string; name2?: string } }
    | undefined;
  if (ext?.entity?.name1 || ext?.entity?.name2) {
    return [ext.entity.name1, ext.entity.name2].filter(Boolean).join(" ");
  }
  return (member.name as string) ?? "(unknown)";
}

export function registerTicketCommands(program: Command): void {
  const ticket = program
    .command("ticket")
    .alias("t")
    .description("Manage tickets (cases)");

  ticket
    .command("list")
    .alias("ls")
    .description("List tickets (itx ticket list --limit 10)")
    .option("-l, --limit <n>", "Maximum number of tickets to return", "25")
    .option("-o, --offset <n>", "Offset for pagination", "0")
    .option("--json", "Output raw JSON")
    .action(async (opts: { limit: string; offset: string; json: boolean }) => {
      const client = requireAuth(opts);
      try {
        const limit = Number(opts.limit);
        const offset = Number(opts.offset);
        const data = await client.request<Record<string, unknown>[]>(
          "/rest/itxems/cases",
          {
            params: {
              getMembers: true,
              limitFrom: offset,
              limitTo: limit,
            },
          },
        );

        const cases = data ?? [];

        if (opts.json) {
          printJsonOk(cases, {
            pagination: {
              limit,
              offset,
              total: cases.length,
              hasMore: cases.length === limit,
            },
          });
          return;
        }

        printInfo(`Showing ${cases.length} tickets`);

        printTable(
          cases.map((c) => {
            const status = c.emsStatus as
              | { name?: Record<string, unknown> }
              | undefined;
            return {
              id: c.seqNo,
              subject: c.description ?? "",
              status: translateName(status?.name),
              created: c.creationTs
                ? new Date(c.creationTs as string).toLocaleDateString()
                : "",
            };
          }),
          [
            { key: "id", label: "ID", width: 10 },
            { key: "subject", label: "Subject", width: 40 },
            { key: "status", label: "Status", width: 15 },
            { key: "created", label: "Created", width: 12 },
          ],
        );
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });

  ticket
    .command("view <id>")
    .description("View ticket details (itx ticket view 43146)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth(opts);
      try {
        const result = await client.request<
          Record<string, unknown> | Record<string, unknown>[]
        >("/rest/itxems/cases", {
          params: {
            seqNo: Number(id),
            getMembers: true,
          },
        });

        const data = Array.isArray(result) ? result[0] : result;
        if (!data) {
          if (opts.json) {
            printJsonError("NOT_FOUND", `Ticket #${id} not found.`);
          } else {
            printError(`Ticket #${id} not found.`);
          }
          exitWithError("NOT_FOUND");
        }

        if (opts.json) {
          printJsonOk(data);
          return;
        }

        const status = data.emsStatus as
          | { name?: Record<string, unknown> }
          | undefined;
        const priority = data.priority as
          | { name?: Record<string, unknown> }
          | undefined;
        const category = data.category as
          | { name?: Record<string, unknown> }
          | undefined;

        console.log(`ID:        #${data.seqNo}`);
        console.log(`Subject:   ${data.description ?? ""}`);
        console.log(`Status:    ${translateName(status?.name)}`);
        console.log(`Priority:  ${translateName(priority?.name)}`);
        console.log(`Category:  ${translateName(category?.name)}`);
        console.log(
          `Created:   ${data.creationTs ? new Date(data.creationTs as string).toISOString() : ""}`,
        );
        console.log(
          `Modified:  ${data.updateTs ? new Date(data.updateTs as string).toISOString() : ""}`,
        );

        const members = data.members as Record<string, unknown>[] | undefined;
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
            console.log(
              `  - ${memberName(m)} [${roleLabel}]${m.anon ? " (external)" : ""}`,
            );
          }
        }
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });

  ticket
    .command("create [subject]")
    .description("Create a new ticket (itx ticket create 'Bug in login')")
    .option("-s, --subject <text>", "Ticket subject (alternative to positional)")
    .option("--json", "Output raw JSON")
    .action(
      async (subjectArg: string | undefined, opts: {
        subject?: string;
        json: boolean;
      }) => {
        const subject = subjectArg || opts.subject;
        if (!subject) {
          if (opts.json) {
            printJsonError("USAGE", "Subject is required. Provide as argument or with -s/--subject.");
          } else {
            printError("Subject is required. Provide as argument or with -s/--subject.");
          }
          exitWithError("USAGE");
        }
        const client = requireAuth(opts);
        try {
          const data = await client.request<Record<string, unknown>>(
            "/rest/itxems/cases",
            {
              method: "POST",
              body: { description: subject },
            },
          );

          if (opts.json) {
            printJsonOk(data);
            return;
          }

          printSuccess(`Ticket created: #${data.seqNo}`);
        } catch (err) {
          handleError(err, { json: opts.json });
        }
      },
    );

  ticket
    .command("update <id>")
    .description("Update a ticket (itx ticket update 43146 --status resolved)")
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
        const client = requireAuth(opts);
        try {
          const body: Record<string, unknown> = { seqNo: Number(id) };
          if (opts.subject) body.description = opts.subject;
          if (opts.status) body.status = opts.status;
          if (opts.category) body.category = opts.category;
          if (opts.assignee) {
            body.members = [
              { role: ROLES.ASSIGNED_USER, name: resolveAlias(opts.assignee) },
            ];
          }

          if (Object.keys(body).length <= 1) {
            const msg = "Provide at least one field to update (--subject, --status, --category, --assignee).";
            if (opts.json) {
              printJsonError("USAGE", msg);
            } else {
              printError(msg);
            }
            exitWithError("USAGE");
          }

          const data = await client.request<Record<string, unknown>>(
            "/rest/itxems/cases",
            {
              method: "PUT",
              body,
            },
          );

          if (opts.json) {
            printJsonOk(data);
            return;
          }

          printSuccess(`Ticket #${id} updated.`);
        } catch (err) {
          handleError(err, { json: opts.json });
        }
      },
    );

  ticket
    .command("activities <id>")
    .alias("act")
    .description("List activities on a ticket (itx ticket activities 43146)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth(opts);
      try {
        // 1. Fetch case by seqNo to get eactId + comments
        const result = await client.request<
          Record<string, unknown> | Record<string, unknown>[]
        >("/rest/itxems/cases", {
          params: { seqNo: Number(id), getComments: true },
        });

        const caseData = Array.isArray(result) ? result[0] : result;
        if (!caseData) {
          if (opts.json) {
            printJsonError("NOT_FOUND", `Ticket #${id} not found.`);
          } else {
            printError(`Ticket #${id} not found.`);
          }
          exitWithError("NOT_FOUND");
        }

        const eactId = caseData.eactId as number;
        const texts = caseData.texts as Record<string, unknown>[] | undefined;

        const { activities, emailBodies } = await resolveTicketActivities(
          client,
          eactId,
          { includeBodies: true },
        );

        if (opts.json) {
          const result: TicketActivitiesResult = {
            ticket: { seqNo: Number(id), eactId },
            activities: activities.map((a) =>
              projectActivity(a, emailBodies.get(a.eactId as number)),
            ),
            comments: (texts ?? []).map((t) => {
              const creator = (t.creator as { firstName?: string; lastName?: string }) ?? {};
              return {
                ts: (t.creationTs as string) ?? "",
                author: {
                  firstName: creator.firstName ?? null,
                  lastName: creator.lastName ?? null,
                },
                text: htmlToText((t.text as string) ?? ""),
              };
            }),
          };
          printJsonOk(result);
          return;
        }

        if (!activities.length && !texts?.length) {
          printInfo("No activities or comments.");
          return;
        }

        // Display communication activities
        if (activities.length) {
          printInfo(`${activities.length} activities:`);
          for (const act of activities) {
            const actType = act.activityType as
              | { eatyId?: number }
              | undefined;
            const eatyId = actType?.eatyId;
            const typeLabel = activityTypeLabel(eatyId);
            const dir = act.direction as number | undefined;
            const dirArrow = dir === 1 ? "->" : dir === 2 ? "<-" : "";
            const date = act.creationTs
              ? new Date(act.creationTs as string).toLocaleString()
              : "";

            console.log(`--- [${typeLabel} ${dirArrow}] ${date} ---`);

            if (eatyId === ACTIVITY_TYPES.EMAIL) {
              const fromMail = (act.fromMail as string) ?? "";
              const toMail = (act.toMail as string) ?? "";
              const subject = (act.subject as string) ?? "";
              const sender = act.sender as
                | { firstName?: string; lastName?: string }
                | undefined;
              const senderName = sender
                ? [sender.firstName, sender.lastName]
                    .filter(Boolean)
                    .join(" ")
                : "";

              console.log(
                `From:    ${fromMail}${senderName ? ` (${senderName})` : ""}`,
              );
              console.log(`To:      ${toMail}`);
              console.log(`Subject: ${subject}`);

              const body = emailBodies.get(act.eactId as number);
              if (body) {
                console.log();
                console.log(body);
              }
            } else if (eatyId === ACTIVITY_TYPES.CALL) {
              const src = (act.srcNumber as string) ?? "";
              const dst = (act.dstNumber as string) ?? "";
              const members = act.members as
                | Record<string, unknown>[]
                | undefined;
              const agent = members?.find(
                (m) => !(m.anon as boolean) && (m.role as number) === 0,
              );
              const contact = members?.find((m) => m.anon);

              console.log(
                `From:     ${src}${agent ? ` (${memberName(agent)})` : ""}`,
              );
              console.log(
                `To:       ${dst}${contact ? ` (${memberName(contact)})` : ""}`,
              );

              const startTs = act.startTs as string | undefined;
              const endTs = act.endTs as string | undefined;
              if (startTs && endTs) {
                const dur = Math.round(
                  (new Date(endTs).getTime() -
                    new Date(startTs).getTime()) /
                    1000,
                );
                console.log(`Duration: ${formatDuration(dur)}`);
              }

              const recordings = act.recordings as
                | Record<string, unknown>[]
                | undefined;
              if (recordings?.length) {
                console.log(`Recordings: ${recordings.length}`);
              }
            } else {
              // Generic activity
              const members = act.members as
                | Record<string, unknown>[]
                | undefined;
              const contact = members?.find((m) => m.anon);
              if (contact) {
                console.log(`Contact: ${memberName(contact)}`);
              }
              const desc = (act.description as string) ?? "";
              if (desc) console.log(`Note: ${desc}`);
            }

            // Show attachments
            const files = act.coreFileReferences as
              | { cfreId?: number; type?: number; name?: string }[]
              | undefined;
            if (files?.length) {
              console.log(
                `Attachments: ${files.map((f) => f.name ?? `file#${f.cfreId}`).join(", ")}`,
              );
            }

            console.log();
          }
        }

        // Display comments
        if (texts?.length) {
          printInfo(`${texts.length} comments:`);
          for (const t of texts) {
            const date = t.creationTs
              ? new Date(t.creationTs as string).toLocaleString()
              : "";
            const creator = t.creator as
              | { firstName?: string; lastName?: string }
              | undefined;
            const author = creator
              ? [creator.firstName, creator.lastName].filter(Boolean).join(" ")
              : "(unknown)";
            console.log(`  [${date}] ${author}:`);
            console.log(`    ${htmlToText((t.text as string) ?? "")}`);
            console.log();
          }
        }
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });

  ticket
    .command("comment <id> [message]")
    .description("Add a comment to a ticket (itx ticket comment 43146 'Looking into it')")
    .option("-m, --message <text>", "Comment text (alternative to positional)")
    .option("--mention <user...>", "Mention users by alias or email (repeatable)")
    .option("--json", "Output raw JSON")
    .action(
      async (
        id: string,
        messageArg: string | undefined,
        opts: { message?: string; mention?: string[]; json: boolean },
      ) => {
        const message = messageArg || opts.message;
        if (!message) {
          const msg = "Message is required. Provide as argument or with -m/--message.";
          if (opts.json) {
            printJsonError("USAGE", msg);
          } else {
            printError(msg);
          }
          exitWithError("USAGE");
        }
        const client = requireAuth(opts);
        try {
          // Fetch case by seqNo to get eactId
          const result = await client.request<
            Record<string, unknown> | Record<string, unknown>[]
          >("/rest/itxems/cases", {
            params: { seqNo: Number(id) },
          });

          const caseData = Array.isArray(result) ? result[0] : result;
          if (!caseData) {
            if (opts.json) {
              printJsonError("NOT_FOUND", `Ticket #${id} not found.`);
            } else {
              printError(`Ticket #${id} not found.`);
            }
            exitWithError("NOT_FOUND");
          }

          const eactId = caseData.eactId as number;

          // Build text and tags for mentions
          let mentionPrefix = "";
          const tags: { startIndex: number; length: number; type: string; data: string }[] = [];

          if (opts.mention?.length) {
            const users = await client.searchUsers();

            for (const mentionInput of opts.mention) {
              const resolved = resolveAlias(mentionInput);
              const user = findUser(users, resolved);
              if (!user) {
                const msg = `User not found for: ${mentionInput}`;
                if (opts.json) {
                  printJsonError("NOT_FOUND", msg);
                } else {
                  printError(msg);
                }
                exitWithError("NOT_FOUND");
              }

              const displayName = `@${user.firstName} ${user.lastName}`;
              // startIndex is position of @ in the full HTML string
              // prefix so far + "<p>" = 3 chars, plus existing mentionPrefix
              const startIndex = 3 + mentionPrefix.length + 1; // +1 for leading \uFEFF
              tags.push({
                startIndex,
                length: displayName.length,
                type: "user",
                data: String(user.userId),
              });
              mentionPrefix += `\uFEFF${displayName}\uFEFF `;
            }
          }

          const text = `<p>${mentionPrefix}${message}</p>`;
          const data = tags.length > 0 ? { tags } : undefined;

          const response = await client.addActivityText(eactId, text, data);

          if (opts.json) {
            printJsonOk(response);
            return;
          }

          printSuccess(`Comment added to ticket #${id}.`);
        } catch (err) {
          handleError(err, { json: opts.json });
        }
      },
    );
}

function findUser(users: ItxUser[], emailOrName: string): ItxUser | undefined {
  // Try exact email match first
  const byEmail = users.find(
    (u) => u.email?.toLowerCase() === emailOrName.toLowerCase(),
  );
  if (byEmail) return byEmail;

  // Try name match (firstName lastName)
  const lower = emailOrName.toLowerCase();
  return users.find(
    (u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase() === lower ||
      u.firstName?.toLowerCase() === lower ||
      u.lastName?.toLowerCase() === lower,
  );
}
