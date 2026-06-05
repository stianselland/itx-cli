import type { ItxClient } from "./client.js";
import { loadRefdata } from "./refdata.js";
import { resolveAlias } from "./config.js";
import { resolveEntity } from "./entity.js";

/**
 * CLI filters for `itx ticket list`, mapped to the POST `/itxems/cases/search`
 * request body.
 *
 * Every field here was probe-verified against the live API — the public docs
 * are wrong about several (e.g. status filtering keys on `emsStatuses:[{emstId}]`
 * objects, NOT the documented `statuses:["string"]`; `statuses:[emstId]` is
 * silently ignored). Do not add a filter field without probing that it narrows
 * results server-side.
 */
export interface TicketSearchOpts {
  status?: string[];
  excludeStatus?: string[];
  priority?: string[];
  category?: string[];
  excludeCategory?: string[];
  assignee?: string;
  mine?: boolean;
  unassigned?: boolean;
  following?: boolean;
  customer?: string;
  customerEmenId?: string;
  seq?: string[];
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
}

/**
 * Resolve a human-typed refdata name (status/priority/category) to its id.
 *
 * Tries case-insensitive exact match first, then a unique substring match.
 * Throws with `Ambiguous…` / `Not found…` prefixes so handleError() routes to
 * the right exit code.
 */
function resolveRef<T extends { name: string }>(
  input: string,
  list: T[],
  idOf: (item: T) => number,
  kind: string,
): number {
  const lower = input.trim().toLowerCase();
  const exact = list.filter((x) => x.name.toLowerCase() === lower);
  if (exact.length === 1) return idOf(exact[0]);
  if (exact.length > 1) {
    throw new Error(`Ambiguous ${kind} "${input}": ${exact.length} entries share that name.`);
  }
  const sub = list.filter((x) => x.name && x.name.toLowerCase().includes(lower));
  if (sub.length === 1) return idOf(sub[0]);
  if (sub.length > 1) {
    throw new Error(
      `Ambiguous ${kind} "${input}": matches ${sub.map((x) => x.name).join(", ")}. Be more specific.`,
    );
  }
  const available = [...new Set(list.map((x) => x.name).filter(Boolean))].join(", ");
  throw new Error(`Not found: ${kind} "${input}". Available: ${available}.`);
}

/** Resolve an assignee (alias, email, or name) to a userId. */
async function resolveAssigneeId(client: ItxClient, input: string): Promise<number> {
  const resolved = resolveAlias(input).toLowerCase();
  const users = await client.searchUsers();
  const user =
    users.find((u) => u.email?.toLowerCase() === resolved) ??
    users.find((u) => `${u.firstName} ${u.lastName}`.toLowerCase() === resolved) ??
    users.find(
      (u) => u.firstName?.toLowerCase() === resolved || u.lastName?.toLowerCase() === resolved,
    );
  if (!user) throw new Error(`Not found: user "${input}".`);
  return user.userId;
}

/**
 * Resolve a UI customer/prospect seqNo to its entity emenId, trying the
 * customer surface first and falling back to prospect on a not-found (a seqNo
 * is only unique within a role). Ambiguity and API errors propagate.
 */
async function resolveSeqNoEmenId(client: ItxClient, seqNo: number): Promise<number> {
  try {
    const customer = await resolveEntity(client, { seqNo, role: "customer" });
    return customer.identity.emenId;
  } catch (err) {
    if (!(err instanceof Error) || !/^Not found:/.test(err.message)) throw err;
    try {
      const prospect = await resolveEntity(client, { seqNo, role: "prospect" });
      return prospect.identity.emenId;
    } catch (perr) {
      if (perr instanceof Error && /^Not found:/.test(perr.message)) {
        throw new Error(`Not found: no customer or prospect with seqNo=${seqNo}.`);
      }
      throw perr;
    }
  }
}

/** Parse a date filter to an ISO-8601 string, or throw a usage error. */
function toIso(input: string, flag: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `Invalid date for ${flag}: "${input}". Use ISO 8601 (e.g. 2026-06-01 or 2026-06-01T00:00:00Z).`,
    );
  }
  return d.toISOString();
}

/**
 * Build the `/itxems/cases/search` request body from CLI filter options.
 *
 * Returns `{}` when no filters are set (a plain `ticket list`), which the
 * search endpoint treats as "most recent cases".
 */
export async function buildCaseSearchBody(
  client: ItxClient,
  opts: TicketSearchOpts,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};

  const needsRefdata =
    opts.status?.length ||
    opts.excludeStatus?.length ||
    opts.priority?.length ||
    opts.category?.length ||
    opts.excludeCategory?.length;
  const ref = needsRefdata ? await loadRefdata(client) : null;

  if (opts.status?.length) {
    body.emsStatuses = opts.status.map((s) => ({
      emstId: resolveRef(s, ref!.statuses, (x) => x.emstId, "status"),
    }));
  }
  if (opts.excludeStatus?.length) {
    body.excludeEmsStatuses = opts.excludeStatus.map((s) => ({
      emstId: resolveRef(s, ref!.statuses, (x) => x.emstId, "status"),
    }));
  }
  if (opts.priority?.length) {
    body.priorities = opts.priority.map((p) => ({
      empriId: resolveRef(p, ref!.priorities, (x) => x.empriId, "priority"),
    }));
  }
  if (opts.category?.length) {
    body.categories = opts.category.map((c) => ({
      ctnoId: resolveRef(c, ref!.categories, (x) => x.ctnoId, "category"),
    }));
  }
  if (opts.excludeCategory?.length) {
    body.excludeCategories = opts.excludeCategory.map((c) => ({
      ctnoId: resolveRef(c, ref!.categories, (x) => x.ctnoId, "category"),
    }));
  }

  if (opts.assignee) {
    body.assignedToUserIds = [await resolveAssigneeId(client, opts.assignee)];
  }
  if (opts.mine) body.assignedToSelf = true;
  if (opts.unassigned) body.getUnassignedCasesOnly = true;
  if (opts.following) body.includeFollowedCases = true;

  // Filter by the case's filed entity. A case's primary entity is keyed on
  // emenId; `--customer-emen-id` uses it directly, while `--customer` takes the
  // UI seqNo and resolves it (customer first, prospect fallback). Note the
  // entity is NOT returned by cases/search itself (only by GET /cases), so it
  // can't be derived from the response.
  if (opts.customerEmenId) {
    const emenId = Number(opts.customerEmenId);
    if (!Number.isFinite(emenId)) {
      throw new Error(`Invalid --customer-emen-id (expected a number): "${opts.customerEmenId}".`);
    }
    body.entities = [{ emenId }];
  } else if (opts.customer) {
    const seqNo = Number(opts.customer);
    if (!Number.isFinite(seqNo)) {
      throw new Error(
        `Invalid --customer (expected a numeric customer seqNo): "${opts.customer}". Use --customer-emen-id for an internal entity id.`,
      );
    }
    body.entities = [{ emenId: await resolveSeqNoEmenId(client, seqNo) }];
  }

  if (opts.seq?.length) {
    const nums = opts.seq.map((s) => Number(s)).filter((n) => Number.isFinite(n));
    if (nums.length) body.seqNumbers = nums;
  }
  if (opts.search) body.description = opts.search;

  if (opts.createdFrom) body.fromInc = toIso(opts.createdFrom, "--created-from");
  if (opts.createdTo) body.toInc = toIso(opts.createdTo, "--created-to");
  if (opts.updatedFrom) body.updateFromInc = toIso(opts.updatedFrom, "--updated-from");
  if (opts.updatedTo) body.updateToInc = toIso(opts.updatedTo, "--updated-to");

  return body;
}
