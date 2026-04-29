import { Command } from "commander";
import { ItxClient } from "../lib/client.js";
import { requireAuth } from "../lib/auth.js";
import {
  printTable,
  printJsonOk,
  printJsonError,
  printError,
  printInfo,
  handleError,
  exitWithError,
} from "../lib/output.js";
import {
  resolveEntity,
  identityFrom,
  validateSingleLookup,
  ENTITY_TYPE,
  EXT_TYPE,
  type EntityLookup,
} from "../lib/entity.js";
import {
  ACTIVITY_TYPES,
  activityKind,
  emptyKindMap,
  projectActivity,
  htmlToText,
} from "../lib/activities.js";
import { loadRefdata, buildLookup as buildRefLookup } from "../lib/refdata.js";
import { summarize } from "../lib/summarize.js";
import type {
  CustomerSearchResult,
  CustomerView,
  ExtensionRole,
  ActivityKind,
  ActivitySummary,
  TicketSummary,
  CustomerTicketsResult,
  CustomerActivitiesResult,
} from "../lib/schemas.js";

/** Build the printJsonOk meta block from a warnings list. */
function metaFromWarnings(
  warnings: string[],
): { meta?: { truncated: true; warnings: string[] } } {
  if (warnings.length === 0) return {};
  return { meta: { truncated: true, warnings } };
}

interface SearchOpts {
  exact: boolean;
  type?: "private" | "corporate";
  limit: string;
  offset: string;
  json: boolean;
}

interface IdOpts {
  emenId?: string;
  eeexId?: string;
  hubspotId?: string;
  orgNo?: string;
  json: boolean;
}

interface ViewOpts extends IdOpts {
  includeContacts: boolean;
}

/** Build an EntityLookup from a positional seqNo + flag-based id options. */
function buildLookup(
  positional: string | undefined,
  opts: IdOpts,
  role: ExtensionRole,
): { lookup?: EntityLookup; error?: string } {
  const flagInput = {
    seqNo: positional ? Number(positional) : undefined,
    emenId: opts.emenId ? Number(opts.emenId) : undefined,
    eeexId: opts.eeexId ? Number(opts.eeexId) : undefined,
    hubspotId: opts.hubspotId,
    orgNo: opts.orgNo,
  };
  const validation = validateSingleLookup(flagInput);
  if (validation) return { error: validation };
  return {
    lookup: {
      ...flagInput,
      role,
    } as EntityLookup,
  };
}

/** Register the "search" subcommand for either customer or prospect. */
function addSearch(parent: Command, role: ExtensionRole) {
  parent
    .command("search [query]")
    .description(
      `Search ${role}s by name (substring). Use --exact for exact match.`,
    )
    .option("--exact", "Exact name match", false)
    .option(
      "--type <type>",
      `Filter by entity type: private or corporate (default both)`,
    )
    .option("-l, --limit <n>", "Page size (max 1000)", "50")
    .option("-o, --offset <n>", "Pagination offset", "0")
    .option("--json", "Output JSON envelope")
    .action(async (query: string | undefined, opts: SearchOpts) => {
      const client = requireAuth(opts);
      try {
        const limit = Math.min(Number(opts.limit), 1000);
        const offset = Number(opts.offset);
        const filter: Record<string, unknown> = {
          extensionTypes: [
            role === "customer" ? EXT_TYPE.CUSTOMER : EXT_TYPE.PROSPECT,
          ],
          getExtensions: true,
          getExtensionLinks: true,
          active: true,
        };
        if (query) {
          if (opts.exact) filter.exactNames = [query];
          else filter.names = [query];
        }
        if (opts.type === "private") filter.entityTypes = [ENTITY_TYPE.PRIVATE];
        else if (opts.type === "corporate")
          filter.entityTypes = [ENTITY_TYPE.CORPORATE];

        const results = await client.searchEntities(
          filter,
          { limitFrom: offset, limitTo: limit },
        );

        const projected: CustomerSearchResult[] = results.map((e) => ({
          identity: identityFrom(e, role),
          matchedOn: opts.exact ? "exactName" : query ? "name" : "id",
        }));

        if (opts.json) {
          // `total` is omitted — the API doesn't return a count, and reporting
          // page-size-as-total would mislead consumers. `hasMore` is the right
          // signal for "fetch the next page".
          printJsonOk(projected, {
            pagination: {
              limit,
              offset,
              hasMore: projected.length === limit,
            },
          });
          return;
        }

        printInfo(`${projected.length} ${role}s`);
        printTable(
          projected.map((p) => ({
            seqNo: p.identity.seqNo,
            name: [p.identity.name1, p.identity.name2].filter(Boolean).join(" "),
            type: p.identity.classification,
            emenId: p.identity.emenId,
          })),
          [
            { key: "seqNo", label: "Customer #", width: 12 },
            { key: "name", label: "Name", width: 35 },
            { key: "type", label: "Type", width: 10 },
            { key: "emenId", label: "emenId", width: 10 },
          ],
        );
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });
}

/** Register the "view" subcommand. */
function addView(parent: Command, role: ExtensionRole) {
  parent
    .command("view [seqNo]")
    .description(
      `View ${role} profile. Default positional is seqNo (UI-visible customer number).`,
    )
    .option("--emen-id <n>", "Lookup by internal entity id (emenId)")
    .option("--eeex-id <n>", "Lookup by extension id (eeexId)")
    .option("--hubspot-id <id>", "Lookup by HubSpot id")
    .option("--org-no <id>", "Lookup by org number / SSN")
    .option("--include-contacts", "Include linked contact persons", false)
    .option("--json", "Output JSON envelope")
    .action(async (positional: string | undefined, opts: ViewOpts) => {
      const { lookup, error } = buildLookup(positional, opts, role);
      if (error || !lookup) {
        const msg = `${error ?? "missing identifier"}. Pass a seqNo as positional, or use --emen-id / --eeex-id / --hubspot-id / --org-no.`;
        if (opts.json) printJsonError("USAGE", msg);
        else printError(msg);
        exitWithError("USAGE");
      }
      const client = requireAuth(opts);
      try {
        const resolved = await resolveEntity(client, lookup);

        const view: CustomerView = {
          identity: resolved.identity,
          contact: resolved.contact,
        };

        if (opts.includeContacts && resolved.linkedContactEmenIds.length > 0) {
          const contacts = await client.getEntitiesByIds(
            resolved.linkedContactEmenIds,
          );
          view.linkedContacts = contacts.map((c) => ({
            emenId: (c.emenId as number) ?? 0,
            eeexId: 0,
            name1: (c.name1 as string) ?? null,
            name2: (c.name2 as string) ?? null,
            emails: ((c.emails as { email?: string }[]) ?? [])
              .map((e) => e.email ?? "")
              .filter(Boolean),
            numbers: ((c.numbers as { number?: string }[]) ?? [])
              .map((n) => n.number ?? "")
              .filter(Boolean),
          }));
        }

        if (opts.json) {
          printJsonOk(view, metaFromWarnings(resolved.warnings));
          return;
        }

        const id = view.identity;
        console.log(`Name:       ${[id.name1, id.name2].filter(Boolean).join(" ")}`);
        console.log(`Type:       ${id.classification} ${id.role}`);
        console.log(`Customer #: ${id.seqNo}`);
        console.log(`emenId:     ${id.emenId}`);
        console.log(`eeexId:     ${id.eeexId}`);
        if (id.externalIds.length) {
          console.log("External IDs:");
          for (const x of id.externalIds) console.log(`  ${x.system}: ${x.id}`);
        }
        if (view.contact.emails.length) {
          console.log("Emails:");
          for (const e of view.contact.emails) console.log(`  ${e.address}`);
        }
        if (view.contact.numbers.length) {
          console.log("Numbers:");
          for (const n of view.contact.numbers) console.log(`  ${n.number}`);
        }
        if (view.contact.addresses.length) {
          console.log("Addresses:");
          for (const a of view.contact.addresses) {
            console.log(
              `  ${[a.line1, a.postalCode, a.postalCity, a.country].filter(Boolean).join(", ")}`,
            );
          }
        }
        if (view.linkedContacts?.length) {
          console.log(`Linked contacts: ${view.linkedContacts.length}`);
          for (const c of view.linkedContacts) {
            console.log(`  - ${[c.name1, c.name2].filter(Boolean).join(" ")} ${c.emails.join(", ")}`);
          }
        }
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });
}

interface TicketsOpts extends IdOpts {
  status: "open" | "closed" | "any";
  since?: string;
  limit: string;
  includeContacts: boolean;
}

interface ActivitiesOpts extends IdOpts {
  type: ActivityKind | "all";
  since?: string;
  limit: string;
  includeBodies: boolean;
  includeContacts: boolean;
}

/** Concurrency-limited parallel map. */
async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Pull activities for the entity (and optionally linked contacts), merged + deduped by eactId. */
async function fetchAggregateActivities(
  client: ItxClient,
  emenIds: number[],
): Promise<Record<string, unknown>[]> {
  const lists = await pMap(emenIds, 5, (id) => client.getActivities(id));
  const merged = ([] as Record<string, unknown>[]).concat(...lists);
  const seen = new Set<number>();
  const out: Record<string, unknown>[] = [];
  for (const a of merged) {
    const id = a.eactId as number | undefined;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(a);
  }
  return out;
}

/**
 * Partition tickets into open vs closed for the --status filter.
 * "Open" maps to ITX `internalStatus` 1 (open), 7 (in-progress family),
 * 8 (awaiting/follow-up family). Anything else is closed.
 */
function partitionByStatus(
  activities: Record<string, unknown>[],
  refStatuses: { emstId: number; internalStatus: number; name: string }[],
): { open: Record<string, unknown>[]; closed: Record<string, unknown>[] } {
  const openIds = new Set(
    refStatuses.filter((s) => s.internalStatus === 1 || s.internalStatus === 7 || s.internalStatus === 8).map((s) => s.emstId),
  );
  const open: Record<string, unknown>[] = [];
  const closed: Record<string, unknown>[] = [];
  for (const a of activities) {
    const stId = ((a.emsStatus as { emstId?: number }) ?? {}).emstId ?? 0;
    if (openIds.has(stId)) open.push(a);
    else closed.push(a);
  }
  return { open, closed };
}

function withinSince(ts: string, sinceIso: string | undefined): boolean {
  if (!sinceIso) return true;
  return new Date(ts).getTime() >= new Date(sinceIso).getTime();
}

function projectTicket(
  raw: Record<string, unknown>,
  statusMap: Map<number, string>,
  priorityMap: Map<number, string>,
  categoryMap: Map<number, string>,
): TicketSummary {
  const status = (raw.emsStatus as { emstId?: number }) ?? {};
  const priority = (raw.priority as { empriId?: number }) ?? {};
  const category = (raw.category as { emcaId?: number }) ?? {};
  return {
    seqNo: (raw.seqNo as number) ?? 0,
    eactId: (raw.eactId as number) ?? 0,
    subject: (raw.description as string) ?? "",
    status: { id: status.emstId ?? null, name: statusMap.get(status.emstId ?? 0) ?? "" },
    priority: { id: priority.empriId ?? null, name: priorityMap.get(priority.empriId ?? 0) ?? "" },
    category: { id: category.emcaId ?? null, name: categoryMap.get(category.emcaId ?? 0) ?? "" },
    creationTs: (raw.creationTs as string) ?? "",
    updateTs: (raw.updateTs as string) ?? "",
  };
}

/** Register the "tickets" subcommand. */
function addTickets(parent: Command, role: ExtensionRole) {
  parent
    .command("tickets [seqNo]")
    .description(`List tickets (cases) for a ${role}, aggregated from all linked activity.`)
    .option("--emen-id <n>", "Lookup by internal entity id (emenId)")
    .option("--eeex-id <n>", "Lookup by extension id (eeexId)")
    .option("--hubspot-id <id>", "Lookup by HubSpot id")
    .option("--org-no <id>", "Lookup by org number / SSN")
    .option("--status <state>", "open | closed | any (default any)", "any")
    .option("--since <iso>", "Only tickets newer than this ISO date")
    .option("-l, --limit <n>", "Cap returned tickets", "200")
    .option("--include-contacts", "Aggregate across linked contacts (slower)", false)
    .option("--json", "Output JSON envelope")
    .action(async (positional: string | undefined, opts: TicketsOpts) => {
      const { lookup, error } = buildLookup(positional, opts, role);
      if (error || !lookup) {
        const msg = `${error ?? "missing identifier"}.`;
        if (opts.json) printJsonError("USAGE", msg);
        else printError(msg);
        exitWithError("USAGE");
      }
      const client = requireAuth(opts);
      try {
        const resolved = await resolveEntity(client, lookup);
        const refdata = await loadRefdata(client);
        const statusMap = buildRefLookup(refdata.statuses, (s) => s.emstId);
        const priorityMap = buildRefLookup(refdata.priorities, (p) => p.empriId);
        const categoryMap = buildRefLookup(refdata.categories, (c) => c.emcaId);

        const ids = [resolved.identity.emenId];
        if (opts.includeContacts) ids.push(...resolved.linkedContactEmenIds);

        const all = await fetchAggregateActivities(client, ids);
        const cases = all.filter(
          (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId === ACTIVITY_TYPES.TICKET,
        );

        const { open, closed } = partitionByStatus(cases, refdata.statuses);
        let filtered =
          opts.status === "open" ? open : opts.status === "closed" ? closed : cases;
        if (opts.since) filtered = filtered.filter((c) => withinSince((c.creationTs as string) ?? "", opts.since));

        // Sort desc by creation
        filtered.sort((a, b) => {
          const ta = new Date((a.creationTs as string) ?? 0).getTime();
          const tb = new Date((b.creationTs as string) ?? 0).getTime();
          return tb - ta;
        });
        filtered = filtered.slice(0, Number(opts.limit));

        const tickets: TicketSummary[] = filtered.map((t) =>
          projectTicket(t, statusMap, priorityMap, categoryMap),
        );

        const counts = {
          total: tickets.length,
          byStatus: countBy(tickets, (t) => t.status.name || "Unknown"),
          byPriority: countBy(tickets, (t) => t.priority.name || "Unknown"),
        };

        const result: CustomerTicketsResult = {
          identity: {
            emenId: resolved.identity.emenId,
            seqNo: resolved.identity.seqNo,
            name1: resolved.identity.name1,
          },
          tickets,
          counts,
        };

        if (opts.json) {
          printJsonOk(result, metaFromWarnings(resolved.warnings));
          return;
        }
        printInfo(`${tickets.length} tickets for ${resolved.identity.name1}`);
        printTable(
          tickets.map((t) => ({
            seqNo: `#${t.seqNo}`,
            subject: t.subject,
            status: t.status.name,
            priority: t.priority.name,
            updated: t.updateTs ? new Date(t.updateTs).toLocaleDateString() : "",
          })),
          [
            { key: "seqNo", label: "ID", width: 8 },
            { key: "subject", label: "Subject", width: 40 },
            { key: "status", label: "Status", width: 14 },
            { key: "priority", label: "Priority", width: 10 },
            { key: "updated", label: "Updated", width: 12 },
          ],
        );
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });
}

function countBy<T>(items: T[], keyFn: (t: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of items) {
    const k = keyFn(t);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

/** Register the "activities" subcommand. */
function addActivities(parent: Command, role: ExtensionRole) {
  parent
    .command("activities [seqNo]")
    .description(`Communication trail for a ${role} (emails, calls, notes, sales).`)
    .option("--emen-id <n>", "Lookup by internal entity id")
    .option("--eeex-id <n>", "Lookup by extension id")
    .option("--hubspot-id <id>", "Lookup by HubSpot id")
    .option("--org-no <id>", "Lookup by org number / SSN")
    .option("--type <kind>", "Filter: email | call | note | sale | comment | all (default all)", "all")
    .option("--since <iso>", "Only activities newer than this ISO date")
    .option("--include-bodies", "Fetch email body text (slower)", false)
    .option("--include-contacts", "Aggregate across linked contacts (slower)", false)
    .option("-l, --limit <n>", "Cap returned activities", "200")
    .option("--json", "Output JSON envelope")
    .action(async (positional: string | undefined, opts: ActivitiesOpts) => {
      const { lookup, error } = buildLookup(positional, opts, role);
      if (error || !lookup) {
        const msg = `${error ?? "missing identifier"}.`;
        if (opts.json) printJsonError("USAGE", msg);
        else printError(msg);
        exitWithError("USAGE");
      }
      const client = requireAuth(opts);
      try {
        const resolved = await resolveEntity(client, lookup);
        const ids = [resolved.identity.emenId];
        if (opts.includeContacts) ids.push(...resolved.linkedContactEmenIds);
        const all = await fetchAggregateActivities(client, ids);

        let activities = all
          .filter((a) => {
            // Skip raw email-conversation entries — we keep the underlying emails.
            const eatyId = ((a.activityType as { eatyId?: number }) ?? {}).eatyId;
            if (eatyId === ACTIVITY_TYPES.EMAIL_CONVERSATION) return false;
            if (opts.type === "all") return true;
            return activityKind(eatyId) === opts.type;
          })
          .filter((a) => withinSince((a.creationTs as string) ?? "", opts.since));

        activities.sort((a, b) => {
          const ta = new Date((a.creationTs as string) ?? 0).getTime();
          const tb = new Date((b.creationTs as string) ?? 0).getTime();
          return tb - ta;
        });
        activities = activities.slice(0, Number(opts.limit));

        const bodies = new Map<number, string>();
        if (opts.includeBodies) {
          const emails = activities.filter(
            (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId === ACTIVITY_TYPES.EMAIL,
          );
          await pMap(emails, 5, async (e) => {
            const html = await client.getEmailContent(e.eactId as number);
            if (typeof html === "string") {
              bodies.set(e.eactId as number, htmlToText(html));
            }
            return null;
          });
        }

        const projected: ActivitySummary[] = activities.map((a) =>
          projectActivity(a, bodies.get(a.eactId as number)),
        );

        const counts: Record<ActivityKind, number> = emptyKindMap();
        for (const a of projected) counts[a.kind]++;

        const result: CustomerActivitiesResult = {
          identity: {
            emenId: resolved.identity.emenId,
            seqNo: resolved.identity.seqNo,
            name1: resolved.identity.name1,
          },
          activities: projected,
          counts,
        };

        if (opts.json) {
          printJsonOk(result, metaFromWarnings(resolved.warnings));
          return;
        }
        printInfo(`${projected.length} activities for ${resolved.identity.name1}`);
        printTable(
          projected.map((a) => ({
            ts: a.ts ? new Date(a.ts).toLocaleString() : "",
            kind: a.kind,
            dir: a.direction ?? "",
            subj: a.subject ?? a.description ?? "",
          })),
          [
            { key: "ts", label: "When", width: 20 },
            { key: "kind", label: "Kind", width: 10 },
            { key: "dir", label: "Dir", width: 9 },
            { key: "subj", label: "Subject / desc", width: 50 },
          ],
        );
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });
}

interface SummaryOpts extends IdOpts {
  depth: "brief" | "standard" | "full";
  since?: string;
  includeContacts: boolean;
}

/** Register the "summary" subcommand — the LLM payoff command. */
function addSummary(parent: Command, role: ExtensionRole) {
  parent
    .command("summary [seqNo]")
    .description(
      `Aggregated summary of a ${role}: profile, ticket stats, recent activity, sales pipeline, health signal.`,
    )
    .option("--emen-id <n>", "Lookup by internal entity id")
    .option("--eeex-id <n>", "Lookup by extension id")
    .option("--hubspot-id <id>", "Lookup by HubSpot id")
    .option("--org-no <id>", "Lookup by org number / SSN")
    .option(
      "--depth <level>",
      "brief | standard | full (JSON default standard, human default brief)",
    )
    .option("--since <iso>", "Bound history to this ISO date")
    .option("--include-contacts", "Aggregate across linked contacts (slower)", false)
    .option("--json", "Output JSON envelope")
    .action(async (positional: string | undefined, opts: SummaryOpts) => {
      const { lookup, error } = buildLookup(positional, opts, role);
      if (error || !lookup) {
        const msg = `${error ?? "missing identifier"}.`;
        if (opts.json) printJsonError("USAGE", msg);
        else printError(msg);
        exitWithError("USAGE");
      }
      const depth =
        opts.depth ?? (opts.json ? "standard" : "brief");
      const client = requireAuth(opts);
      try {
        const resolved = await resolveEntity(client, lookup);
        const refdata = await loadRefdata(client);

        const ids = [resolved.identity.emenId];
        if (opts.includeContacts) ids.push(...resolved.linkedContactEmenIds);
        const activities = await fetchAggregateActivities(client, ids);

        const summary = summarize({
          identity: resolved.identity,
          contact: resolved.contact,
          activities,
          refStatuses: refdata.statuses,
          refPriorities: refdata.priorities,
          refCategories: refdata.categories,
          depth,
          since: opts.since,
        });

        if (opts.json) {
          printJsonOk(summary, metaFromWarnings(resolved.warnings));
          return;
        }
        // Human output: prioritise the question "happy or in trouble?"
        console.log(`# ${summary.identity.name1} (${summary.identity.classification} ${role}, #${summary.identity.seqNo})`);
        console.log(`Health: ${summary.health.signal.toUpperCase()}`);
        for (const r of summary.health.reasons) console.log(`  - ${r}`);
        console.log();
        console.log(`Tickets: ${summary.tickets.totalOpen} open, ${summary.tickets.totalClosed} closed`);
        if (summary.tickets.criticalOpen) console.log(`  - ${summary.tickets.criticalOpen} critical priority open`);
        const topStatuses = Object.entries(summary.tickets.byStatus)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        for (const [name, count] of topStatuses) console.log(`  - ${name}: ${count}`);
        console.log();
        console.log(
          `Communication: ${summary.communication.totalActivities} activities` +
            (summary.communication.lastInboundTs
              ? `, last inbound ${new Date(summary.communication.lastInboundTs).toLocaleDateString()}`
              : ""),
        );
        if (summary.pipeline.openCount > 0) {
          console.log();
          console.log(
            `Pipeline: ${summary.pipeline.openCount} open, value ${summary.pipeline.openValue.toLocaleString()} (weighted ${Math.round(summary.pipeline.weightedValue).toLocaleString()})`,
          );
        }
        if (summary.tickets.recent?.length) {
          console.log();
          console.log("Recent tickets:");
          for (const t of summary.tickets.recent.slice(0, 5)) {
            console.log(`  #${t.seqNo} [${t.status.name}] ${t.subject}`);
          }
        }
      } catch (err) {
        handleError(err, { json: opts.json });
      }
    });
}

/**
 * Build the parent command (customer or prospect) and attach all verbs.
 * Used by both registerCustomerCommands and registerProspectCommands.
 */
export function buildEntityGroup(
  program: Command,
  role: ExtensionRole,
): Command {
  const parent = program
    .command(role)
    .description(
      role === "customer"
        ? "Manage customers (read-only)"
        : "Manage prospects (read-only)",
    );
  addSearch(parent, role);
  addView(parent, role);
  addTickets(parent, role);
  addActivities(parent, role);
  addSummary(parent, role);
  return parent;
}

export function registerCustomerCommands(program: Command): void {
  buildEntityGroup(program, "customer");
}
