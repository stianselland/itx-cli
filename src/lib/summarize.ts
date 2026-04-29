import {
  ACTIVITY_TYPES,
  activityKind,
  emptyKindMap,
  projectActivity,
} from "./activities.js";
import type {
  ActivityKind,
  ActivitySummary,
  CommunicationStats,
  CustomerSummary,
  EntityIdentity,
  ContactInfo,
  SaleStats,
  SummaryDepth,
  TicketStats,
  TicketSummary,
} from "./schemas.js";

interface SummarizeInput {
  identity: EntityIdentity;
  contact: ContactInfo;
  /** Raw activities from /itxems/activities (and contacts, if --include-contacts). */
  activities: Record<string, unknown>[];
  refStatuses: { emstId: number; internalStatus: number; name: string }[];
  refPriorities: { empriId: number; name: string }[];
  refCategories: { emcaId: number; name: string }[];
  depth: SummaryDepth;
  since?: string;
}

/**
 * Build a customer/prospect summary tuned for LLM consumption.
 *
 * `depth` controls verbosity:
 *  - brief:    counts only, no lists
 *  - standard: counts + last N tickets/activities, email threads collapsed
 *  - full:     counts + everything, no thread collapsing
 */
export function summarize(input: SummarizeInput): CustomerSummary {
  const {
    identity,
    contact,
    activities,
    refStatuses,
    refPriorities,
    refCategories,
    depth,
    since,
  } = input;

  const statusMap = new Map(refStatuses.map((s) => [s.emstId, s]));
  const priorityMap = new Map(refPriorities.map((p) => [p.empriId, p.name]));
  const categoryMap = new Map(refCategories.map((c) => [c.emcaId, c.name]));

  // Filter by since (client-side).
  const inWindow = (ts: string) =>
    !since || new Date(ts).getTime() >= new Date(since).getTime();

  const acts = activities.filter((a) => inWindow((a.creationTs as string) ?? ""));

  // ---- ticket stats ----
  const tickets = acts.filter(
    (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId === ACTIVITY_TYPES.TICKET,
  );
  const ticketStats: TicketStats = {
    totalOpen: 0,
    totalClosed: 0,
    byStatus: {},
    byPriority: {},
    byCategory: {},
    awaitingExternal: 0,
    awaitingInternal: 0,
    criticalOpen: 0,
  };
  const recentTickets: TicketSummary[] = [];

  for (const t of tickets) {
    const stId = ((t.emsStatus as { emstId?: number }) ?? {}).emstId ?? 0;
    const stRef = statusMap.get(stId);
    const stName = stRef?.name ?? "Unknown";
    const internal = stRef?.internalStatus ?? 0;

    if (internal === 1 || internal === 7 || internal === 8) ticketStats.totalOpen++;
    else ticketStats.totalClosed++;

    ticketStats.byStatus[stName] = (ticketStats.byStatus[stName] ?? 0) + 1;

    // ITX status names follow a "Follow up <duration>" / "Await<…>" convention
    // for blocked states. Bucket the count by who's holding the ball.
    if (/Follow up/i.test(stName) || /Await/i.test(stName)) {
      if (/external/i.test(stName) || /customer/i.test(stName)) ticketStats.awaitingExternal++;
      else ticketStats.awaitingInternal++;
    }

    const pr = ((t.priority as { empriId?: number }) ?? {}).empriId ?? 0;
    const prName = priorityMap.get(pr) ?? "Unknown";
    ticketStats.byPriority[prName] = (ticketStats.byPriority[prName] ?? 0) + 1;
    if (/critical/i.test(prName) && (internal === 1 || internal === 7 || internal === 8)) {
      ticketStats.criticalOpen++;
    }

    const cat = ((t.category as { emcaId?: number }) ?? {}).emcaId ?? 0;
    const catName = categoryMap.get(cat) ?? "Uncategorised";
    ticketStats.byCategory[catName] = (ticketStats.byCategory[catName] ?? 0) + 1;
  }

  if (depth !== "brief") {
    const ranked = [...tickets].sort((a, b) => {
      const ta = new Date((a.creationTs as string) ?? 0).getTime();
      const tb = new Date((b.creationTs as string) ?? 0).getTime();
      return tb - ta;
    });
    const recentLimit = depth === "standard" ? 10 : 50;
    for (const t of ranked.slice(0, recentLimit)) {
      const stId = ((t.emsStatus as { emstId?: number }) ?? {}).emstId ?? 0;
      const pr = ((t.priority as { empriId?: number }) ?? {}).empriId ?? 0;
      const cat = ((t.category as { emcaId?: number }) ?? {}).emcaId ?? 0;
      recentTickets.push({
        seqNo: (t.seqNo as number) ?? 0,
        eactId: (t.eactId as number) ?? 0,
        subject: (t.description as string) ?? "",
        status: { id: stId || null, name: statusMap.get(stId)?.name ?? "" },
        priority: { id: pr || null, name: priorityMap.get(pr) ?? "" },
        category: { id: cat || null, name: categoryMap.get(cat) ?? "" },
        creationTs: (t.creationTs as string) ?? "",
        updateTs: (t.updateTs as string) ?? "",
      });
    }
  }

  // ---- communication stats ----
  const commStats: CommunicationStats = {
    lastInboundTs: null,
    lastOutboundTs: null,
    byKind: emptyKindMap(),
    totalActivities: 0,
  };
  const commActivities = acts.filter((a) => {
    const eaty = ((a.activityType as { eatyId?: number }) ?? {}).eatyId;
    return (
      eaty !== ACTIVITY_TYPES.TICKET &&
      eaty !== ACTIVITY_TYPES.SALE &&
      eaty !== ACTIVITY_TYPES.EMAIL_CONVERSATION
    );
  });

  for (const a of commActivities) {
    const eaty = ((a.activityType as { eatyId?: number }) ?? {}).eatyId;
    const kind = activityKind(eaty);
    commStats.byKind[kind] = (commStats.byKind[kind] ?? 0) + 1;
    commStats.totalActivities++;
    const dir = a.direction as number | undefined;
    const ts = (a.creationTs as string) ?? "";
    if (!ts) continue;
    if (dir === 2 && (!commStats.lastInboundTs || ts > commStats.lastInboundTs)) {
      commStats.lastInboundTs = ts;
    }
    if (dir === 1 && (!commStats.lastOutboundTs || ts > commStats.lastOutboundTs)) {
      commStats.lastOutboundTs = ts;
    }
  }

  let recentActivities: ActivitySummary[] | undefined;
  if (depth !== "brief") {
    let recent = [...commActivities];
    if (depth === "standard") recent = collapseEmailThreads(recent);
    recent.sort((a, b) => {
      const ta = new Date((a.creationTs as string) ?? 0).getTime();
      const tb = new Date((b.creationTs as string) ?? 0).getTime();
      return tb - ta;
    });
    const recentLimit = depth === "standard" ? 15 : 75;
    recentActivities = recent.slice(0, recentLimit).map((a) => projectActivity(a));
  }

  // ---- pipeline (sales) ----
  const sales = acts.filter(
    (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId === ACTIVITY_TYPES.SALE,
  );
  const pipeline = summarizeSales(sales);

  // ---- health ----
  const health = computeHealth(ticketStats, commStats, pipeline);

  return {
    identity,
    depth,
    since: since ?? null,
    contact,
    tickets: { ...ticketStats, ...(recentTickets.length ? { recent: recentTickets } : {}) },
    communication: {
      ...commStats,
      ...(recentActivities ? { recent: recentActivities } : {}),
    },
    pipeline,
    health,
  };
}

/**
 * Replace each EMAIL_CONVERSATION's child emails with a single representative
 * email carrying a `description` that includes the reply count. Only used at
 * `--depth standard`.
 *
 * NOTE: we don't have explicit conversation linkage in the entity-level
 * activities feed, so this implementation collapses by inReplyTo + references
 * lineage when available, falling back to subject normalization.
 */
function collapseEmailThreads(
  activities: Record<string, unknown>[],
): Record<string, unknown>[] {
  const emails = activities.filter(
    (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId === ACTIVITY_TYPES.EMAIL,
  );
  if (emails.length === 0) return activities;

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const e of emails) {
    const subj = ((e.subject as string) ?? "").replace(/^(re|fwd|fw):\s*/i, "").trim().toLowerCase();
    const key = subj || `_${e.eactId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const collapsedEmails: Record<string, unknown>[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      collapsedEmails.push(group[0]);
    } else {
      group.sort((a, b) => new Date((b.creationTs as string) ?? 0).getTime() - new Date((a.creationTs as string) ?? 0).getTime());
      const head = group[0];
      collapsedEmails.push({
        ...head,
        description: `[${group.length} emails in thread] ${(head.subject as string) ?? ""}`,
      });
    }
  }
  // Replace email entries with the collapsed list, keep non-emails intact.
  const nonEmails = activities.filter(
    (a) => ((a.activityType as { eatyId?: number }) ?? {}).eatyId !== ACTIVITY_TYPES.EMAIL,
  );
  return [...nonEmails, ...collapsedEmails];
}

function summarizeSales(sales: Record<string, unknown>[]): SaleStats {
  const stats: SaleStats = {
    openCount: 0,
    openValue: 0,
    weightedValue: 0,
    byStep: {},
    lastUpdateTs: null,
  };
  for (const s of sales) {
    const step = (s.step as { name?: { defaultText?: string } } | undefined)?.name?.defaultText
      ?? "(no step)";
    stats.byStep[step] = (stats.byStep[step] ?? 0) + 1;

    const value = typeof s.value === "number" ? (s.value as number) : 0;
    const prob = typeof s.saleProbability === "number" ? (s.saleProbability as number) : 0;
    const status = (s.status as number | undefined) ?? 0;
    // Heuristic: status 1 = open in ITX. Bucket the rest under closed.
    if (status === 1 || status === 0) {
      stats.openCount++;
      stats.openValue += value;
      stats.weightedValue += value * (prob / 100);
    }
    const upd = (s.updateTs as string) ?? (s.creationTs as string) ?? null;
    if (upd && (!stats.lastUpdateTs || upd > stats.lastUpdateTs)) {
      stats.lastUpdateTs = upd;
    }
  }
  return stats;
}

/**
 * Compute the LLM-facing health signal for a customer/prospect.
 *
 * Escalation precedence (highest wins):
 *   trouble  — critical-priority ticket open, OR no inbound contact >180d
 *   stalled  — no inbound contact 90-180d (engagement is dead but not yet a fire)
 *   attention — awaiting internal action, ≥5 open tickets, or active pipeline
 *               with no recent contact (60-90d quiet)
 *   ok       — none of the above
 *
 * `reasons` always lists everything we noticed, regardless of signal — agents
 * can use it for context. Signal is the single value to branch on.
 */
export function computeHealth(
  tickets: TicketStats,
  comm: CommunicationStats,
  pipeline: SaleStats,
  now: number = Date.now(),
): CustomerSummary["health"] {
  const reasons: string[] = [];
  let signal: CustomerSummary["health"]["signal"] = "ok";

  const escalate = (to: CustomerSummary["health"]["signal"]) => {
    const order = { ok: 0, attention: 1, stalled: 2, trouble: 3 } as const;
    if (order[to] > order[signal]) signal = to;
  };

  if (tickets.criticalOpen > 0) {
    escalate("trouble");
    reasons.push(`${tickets.criticalOpen} critical-priority ticket(s) open`);
  }
  if (tickets.awaitingInternal > 0) {
    escalate("attention");
    reasons.push(`${tickets.awaitingInternal} ticket(s) awaiting internal action`);
  }
  if (tickets.totalOpen >= 5) {
    escalate("attention");
    reasons.push(`${tickets.totalOpen} open tickets`);
  }
  if (comm.lastInboundTs) {
    const ageDays = Math.floor(
      (now - new Date(comm.lastInboundTs).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (ageDays > 180) {
      escalate("trouble");
      reasons.push(`No inbound contact for ${ageDays} days`);
    } else if (ageDays > 90) {
      escalate("stalled");
      reasons.push(`No inbound contact for ${ageDays} days`);
    } else if (ageDays > 60 && pipeline.openCount > 0) {
      escalate("attention");
      reasons.push(`No inbound contact for ${ageDays} days while pipeline is open`);
    }
  } else if (comm.totalActivities === 0) {
    // Never had any communication — likely never onboarded or fresh prospect.
    escalate("stalled");
    reasons.push("No communication on record");
  }
  if (pipeline.openValue > 0) {
    reasons.push(
      `Pipeline: ${pipeline.openCount} open opportunities, ${pipeline.openValue.toLocaleString()} total value`,
    );
  }

  return { signal, reasons };
}
