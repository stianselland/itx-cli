import { Command } from "commander";
import { isConfigured, resolveAlias } from "../lib/config.js";
import { ItxClient, type ItxUser } from "../lib/client.js";
import {
  printTable,
  printJson,
  printError,
  printSuccess,
  printInfo,
} from "../lib/output.js";

/** Role constants for ticket members. */
export const ROLES = {
  ASSIGNED_USER: 1,
  CASE_FOLLOWER: 2,
  CONTACT_PERSON: 20,
} as const;

/** Activity link types. */
const LINK_TYPES = {
  CONVERSATION: 13,
  CASE: 14,
} as const;

/** Activity type IDs. */
const ACTIVITY_TYPES = {
  CHAT: 2,
  CALL: 4,
  NOTE: 8,
  EMAIL: 11,
  FB_CHAT: 13,
  WECHAT: 14,
  TICKET: 15,
  SMS: 17,
  SCREEN_SHARE: 24,
  IG_CHAT: 27,
  WHATSAPP: 29,
  EMAIL_CONVERSATION: 21,
} as const;

/** Human-readable label for an activity type ID. */
function activityTypeLabel(eatyId?: number): string {
  switch (eatyId) {
    case ACTIVITY_TYPES.CHAT: return "Chat";
    case ACTIVITY_TYPES.CALL: return "Call";
    case ACTIVITY_TYPES.NOTE: return "Note";
    case ACTIVITY_TYPES.EMAIL: return "Email";
    case ACTIVITY_TYPES.FB_CHAT: return "FB Chat";
    case ACTIVITY_TYPES.WECHAT: return "WeChat";
    case ACTIVITY_TYPES.SMS: return "SMS";
    case ACTIVITY_TYPES.SCREEN_SHARE: return "Screen Share";
    case ACTIVITY_TYPES.IG_CHAT: return "IG Chat";
    case ACTIVITY_TYPES.WHATSAPP: return "WhatsApp";
    default: return "Activity";
  }
}

function requireAuth(): ItxClient {
  if (!isConfigured()) {
    printError('Not configured. Run "itx login" first.');
    process.exit(1);
  }
  return new ItxClient();
}

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

/** Strip HTML to plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p><p[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|ul|ol|blockquote|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&#\d+;/g, "")
    .replace(/[\uFEFF\u200B\u200C\u200D\u00AD\u00A0]/g, " ")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Format seconds as human-readable duration. */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
      const client = requireAuth();
      try {
        const data = await client.request<Record<string, unknown>[]>(
          "/rest/itxems/cases",
          {
            params: {
              getMembers: true,
              limitFrom: Number(opts.offset),
              limitTo: Number(opts.limit),
            },
          },
        );

        if (opts.json) {
          printJson(data);
          return;
        }

        const cases = data ?? [];
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
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  ticket
    .command("view <id>")
    .description("View ticket details (itx ticket view 43146)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth();
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
          printError(`Ticket #${id} not found.`);
          process.exit(1);
        }

        if (opts.json) {
          printJson(data);
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
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
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
          printError("Subject is required. Provide as argument or with -s/--subject.");
          process.exit(1);
        }
        const client = requireAuth();
        try {
          const data = await client.request<Record<string, unknown>>(
            "/rest/itxems/cases",
            {
              method: "POST",
              body: { description: subject },
            },
          );

          if (opts.json) {
            printJson(data);
            return;
          }

          printSuccess(`Ticket created: #${data.seqNo}`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
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
        const client = requireAuth();
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
            printError(
              "Provide at least one field to update (--subject, --status, --category, --assignee).",
            );
            process.exit(1);
          }

          const data = await client.request<Record<string, unknown>>(
            "/rest/itxems/cases",
            {
              method: "PUT",
              body,
            },
          );

          if (opts.json) {
            printJson(data);
            return;
          }

          printSuccess(`Ticket #${id} updated.`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  ticket
    .command("activities <id>")
    .alias("act")
    .description("List activities on a ticket (itx ticket activities 43146)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const client = requireAuth();
      try {
        // 1. Fetch case by seqNo to get eactId + comments
        const result = await client.request<
          Record<string, unknown> | Record<string, unknown>[]
        >("/rest/itxems/cases", {
          params: { seqNo: Number(id), getComments: true },
        });

        const caseData = Array.isArray(result) ? result[0] : result;
        if (!caseData) {
          printError(`Ticket #${id} not found.`);
          process.exit(1);
        }

        const eactId = caseData.eactId as number;
        const texts = caseData.texts as Record<string, unknown>[] | undefined;

        // 2. Fetch case with links via search endpoint
        const fullCaseResult = await client.request<
          Record<string, unknown> | Record<string, unknown>[]
        >("/rest/itxems/cases/search", {
          method: "POST",
          body: { eactIds: [eactId] },
        });

        const fullCase = Array.isArray(fullCaseResult)
          ? fullCaseResult[0]
          : fullCaseResult;

        // 3. Extract linked activity IDs from case links
        const links = ((fullCase?.links ?? []) as Record<string, unknown>[]);
        const caseLinks = links.filter((link) => {
          const to = link.to as { eactId?: number } | undefined;
          return link.type === LINK_TYPES.CASE && to?.eactId === eactId;
        });
        const linkedActivityIds = caseLinks.map(
          (link) => (link.from as { eactId: number }).eactId,
        );

        // 4. Fetch linked activities
        let activities: Record<string, unknown>[] = [];
        if (linkedActivityIds.length > 0) {
          const actResult = await client.request<Record<string, unknown>[]>(
            "/rest/itxems/activities/search",
            {
              method: "POST",
              body: { eactIds: linkedActivityIds, getMembers: true },
            },
          );
          activities = actResult ?? [];

          // 5. Resolve email conversations to individual emails
          const emailConversations = activities.filter(
            (a) =>
              (a.activityType as { eatyId?: number })?.eatyId ===
              ACTIVITY_TYPES.EMAIL_CONVERSATION,
          );

          for (const conv of emailConversations) {
            const emails = await client.request<Record<string, unknown>[]>(
              "/rest/itxems/activities/search",
              {
                method: "POST",
                body: {
                  activityLinkFilters: [
                    {
                      eactIds: [conv.eactId],
                      linkTypes: [LINK_TYPES.CONVERSATION],
                      linkDirection: "FROM",
                    },
                  ],
                  getMembers: true,
                },
              },
            );
            activities = activities.filter(
              (a) => a.eactId !== conv.eactId,
            );
            activities.push(...(emails ?? []));
          }
        }

        // Sort activities by creation timestamp
        activities.sort((a, b) => {
          const aTs = new Date((a.creationTs as string) ?? 0).getTime();
          const bTs = new Date((b.creationTs as string) ?? 0).getTime();
          return aTs - bTs;
        });

        // Fetch email body content for all email activities
        const emailActivities = activities.filter(
          (a) =>
            (a.activityType as { eatyId?: number })?.eatyId ===
            ACTIVITY_TYPES.EMAIL,
        );
        const emailBodies = new Map<number, string>();
        await Promise.all(
          emailActivities.map(async (email) => {
            try {
              const html = await client.request<string>(
                "/rest/itxems/emailcontent",
                { params: { eactId: email.eactId as number } },
              );
              emailBodies.set(
                email.eactId as number,
                typeof html === "string" ? htmlToText(html) : "",
              );
            } catch {
              // Email content may not be available
            }
          }),
        );

        if (opts.json) {
          const enriched = activities.map((a) => ({
            ...a,
            _emailBody: emailBodies.get(a.eactId as number),
          }));
          printJson({ activities: enriched, comments: texts ?? [] });
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
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
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
          printError("Message is required. Provide as argument or with -m/--message.");
          process.exit(1);
        }
        const client = requireAuth();
        try {
          // Fetch case by seqNo to get eactId
          const result = await client.request<
            Record<string, unknown> | Record<string, unknown>[]
          >("/rest/itxems/cases", {
            params: { seqNo: Number(id) },
          });

          const caseData = Array.isArray(result) ? result[0] : result;
          if (!caseData) {
            printError(`Ticket #${id} not found.`);
            process.exit(1);
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
                printError(`User not found for: ${mentionInput}`);
                process.exit(1);
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
            printJson(response);
            return;
          }

          printSuccess(`Comment added to ticket #${id}.`);
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
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
