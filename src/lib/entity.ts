import type { ItxClient } from "./client.js";
import type {
  ContactInfo,
  EntityClassification,
  EntityIdentity,
  ExtensionRole,
} from "./schemas.js";

/** ITX entityType values. */
export const ENTITY_TYPE = { PRIVATE: 1, CORPORATE: 2 } as const;

/** ITX extension types we care about. */
export const EXT_TYPE = {
  PROSPECT: 9,
  CUSTOMER: 10,
  SUPPLIER: 20,
  DEBTOR: 30,
  CONTACT: 40,
} as const;

/** ITX third-party system ids (PaperDrop instance). */
export const ESTP = {
  ITX_INTERNAL: 20,
  HUBSPOT_CUSTOMER: 87,
  HUBSPOT_CONTACT: 88,
} as const;

/** What the user passes us — exactly one identifier strategy at a time. */
export interface EntityLookup {
  /** UI-visible "customer number" (extension seqNo). */
  seqNo?: number;
  /** Internal entity id. */
  emenId?: number;
  /** Internal extension id. */
  eeexId?: number;
  /** External system id (auto-detected — HubSpot is most common). */
  hubspotId?: string;
  /** Org number / personal SSN — matched against `entityIds`. */
  orgNo?: string;
  /** Whether to look up customer (extType=10) or prospect (extType=9). */
  role: ExtensionRole;
}

/** Resolved entity with everything downstream commands need. */
export interface ResolvedEntity {
  identity: EntityIdentity;
  contact: ContactInfo;
  /** emenIds of contact people linked to this entity (for activity aggregation). */
  linkedContactEmenIds: number[];
  /** Raw entity payload, for callers that need fields not yet projected. */
  raw: Record<string, unknown>;
  /**
   * Non-fatal warnings captured during resolution — e.g., a search hit the
   * 1000-row server cap so results may be incomplete. Surfaced to JSON callers
   * via `meta.warnings` and `meta.truncated`.
   */
  warnings: string[];
}

/** Server cap on entity/case search pagination — verified by probing. */
const MAX_PAGE = 1000;

const EXT_TYPE_TO_ROLE: Record<number, ExtensionRole> = {
  [EXT_TYPE.CUSTOMER]: "customer",
  [EXT_TYPE.PROSPECT]: "prospect",
};

const ROLE_TO_EXT_TYPE: Record<ExtensionRole, number> = {
  customer: EXT_TYPE.CUSTOMER,
  prospect: EXT_TYPE.PROSPECT,
};

const ESTP_TO_LABEL: Record<number, string> = {
  [ESTP.ITX_INTERNAL]: "ITXEMS",
  [ESTP.HUBSPOT_CUSTOMER]: "HUBSPOTCUST",
  [ESTP.HUBSPOT_CONTACT]: "HUBSPOTCONT",
};

/**
 * Resolve a user-supplied identifier to a fully-loaded entity.
 *
 * Strategy:
 *  1. Pick exactly one lookup field (caller-validated).
 *  2. Search by that field; reject ambiguous matches.
 *  3. Pull the full entity to populate addresses/emails/numbers.
 *  4. Walk extensionLinks to extract linked contact emenIds.
 */
export async function resolveEntity(
  client: ItxClient,
  lookup: EntityLookup,
): Promise<ResolvedEntity> {
  const extType = ROLE_TO_EXT_TYPE[lookup.role];

  const warnings: string[] = [];
  const noteIfTruncated = (results: unknown[], context: string) => {
    if (results.length === MAX_PAGE) {
      warnings.push(
        `Lookup by ${context} scanned ${MAX_PAGE} rows (server cap) — match may have been outside the page.`,
      );
    }
  };

  // Find candidate emenId(s) using the selected lookup strategy.
  let candidates: Record<string, unknown>[] = [];

  if (lookup.emenId !== undefined) {
    const ent = await client.getEntity(lookup.emenId);
    candidates = [ent];
  } else if (lookup.seqNo !== undefined) {
    // Undocumented but functional ITX filter — keep cast until typed in EntityFilter.
    candidates = await client.searchEntities(
      {
        extensionTypes: [extType],
        getExtensions: true,
        getExtensionLinks: true,
        active: true,
        ...({ extensionSeqNoFilters: [{ seqNo: lookup.seqNo }] } as Record<string, unknown>),
      },
      { limitFrom: 0, limitTo: 50 },
    );
  } else if (lookup.eeexId !== undefined) {
    const all = await client.searchEntities(
      { extensionTypes: [extType], getExtensions: true, getExtensionLinks: true, active: true },
      { limitFrom: 0, limitTo: MAX_PAGE },
    );
    noteIfTruncated(all, "eeexId");
    candidates = all.filter((e) => extensionsOf(e).some((x) => x.eeexId === lookup.eeexId));
  } else if (lookup.hubspotId) {
    const corp = await client.searchEntities(
      { extensionTypes: [extType], entityTypes: [ENTITY_TYPE.CORPORATE], getExtensions: true, getExtensionLinks: true, active: true },
      { limitFrom: 0, limitTo: MAX_PAGE },
    );
    const priv = await client.searchEntities(
      { extensionTypes: [extType], entityTypes: [ENTITY_TYPE.PRIVATE], getExtensions: true, getExtensionLinks: true, active: true },
      { limitFrom: 0, limitTo: MAX_PAGE },
    );
    noteIfTruncated(corp, "hubspotId (corporate page)");
    noteIfTruncated(priv, "hubspotId (private page)");
    candidates = [...corp, ...priv].filter((e) =>
      extensionsOf(e).some((x) =>
        (x.thirdPartySystemEntityExtList ?? []).some(
          (t) => t.id === lookup.hubspotId,
        ),
      ),
    );
  } else if (lookup.orgNo) {
    const all = await client.searchEntities(
      { extensionTypes: [extType], getExtensions: true, getExtensionLinks: true, active: true },
      { limitFrom: 0, limitTo: MAX_PAGE },
    );
    noteIfTruncated(all, "orgNo");
    candidates = all.filter((e) => (e as Record<string, unknown>).entityId === lookup.orgNo);
  } else {
    throw new Error("resolveEntity: no lookup field provided");
  }

  if (candidates.length === 0) {
    const desc = describeLookup(lookup);
    throw new Error(`Not found: ${lookup.role} ${desc}`);
  }
  if (candidates.length > 1) {
    const desc = describeLookup(lookup);
    throw new Error(
      `Ambiguous: ${candidates.length} ${lookup.role} entities match ${desc}`,
    );
  }

  // Always re-fetch the full entity (search results may not include addresses).
  const emenId = (candidates[0] as { emenId?: number }).emenId;
  if (!emenId) throw new Error("Resolved entity missing emenId");
  const full = await client.getEntity(emenId);

  const { ids: linkedIds, truncated: contactsTruncated } = await linkedContactEmenIds(
    client,
    full,
    lookup.role,
  );
  if (contactsTruncated) {
    warnings.push(
      `Linked-contact lookup hit the ${MAX_PAGE}-row server cap — some contacts may be missing from --include-contacts.`,
    );
  }

  return {
    identity: identityFrom(full, lookup.role),
    contact: contactFrom(full),
    linkedContactEmenIds: linkedIds,
    raw: full,
    warnings,
  };
}

/**
 * Project an ITX entity into our stable identity shape.
 * Picks the extension matching the role; if multiple, prefers active.
 */
export function identityFrom(
  entity: Record<string, unknown>,
  role: ExtensionRole,
): EntityIdentity {
  const exts = extensionsOf(entity);
  const targetExtType = ROLE_TO_EXT_TYPE[role];
  const ext =
    exts.find((x) => x.extType === targetExtType && x.active !== false) ??
    exts.find((x) => x.extType === targetExtType) ??
    exts[0];

  const entityType = (entity.entityType as number) ?? 2;
  const classification: EntityClassification =
    entityType === ENTITY_TYPE.PRIVATE ? "private" : "corporate";

  const externalIds = (ext?.thirdPartySystemEntityExtList ?? []).map((t) => ({
    system: ESTP_TO_LABEL[t.thirdPartySystem?.estpId ?? 0] ?? String(t.thirdPartySystem?.estpId ?? "?"),
    estpId: t.thirdPartySystem?.estpId ?? 0,
    id: String(t.id ?? ""),
  }));

  return {
    emenId: (entity.emenId as number) ?? 0,
    eeexId: ext?.eeexId ?? 0,
    seqNo: ext?.seqNo ?? 0,
    name1: (entity.name1 as string) ?? "",
    name2: (entity.name2 as string) ?? null,
    classification,
    role,
    externalIds,
  };
}

/** Project the entity's contact channels into the stable shape. */
export function contactFrom(entity: Record<string, unknown>): ContactInfo {
  const emails = ((entity.emails as Record<string, unknown>[]) ?? []).map((e) => ({
    type: (e.emailType as number) ?? 0,
    address: (e.email as string) ?? "",
  }));
  const numbers = ((entity.numbers as Record<string, unknown>[]) ?? []).map((n) => ({
    type: (n.numberType as number) ?? 0,
    number: (n.number as string) ?? "",
  }));
  const addresses = ((entity.addresses as Record<string, unknown>[]) ?? []).map(
    (a) => ({
      type: (a.addressType as number) ?? 0,
      line1: a.line1 as string | undefined,
      line2: a.line2 as string | undefined,
      postalCode: a.postalCode as string | undefined,
      postalCity: a.postalCity as string | undefined,
      country: a.country as string | undefined,
    }),
  );
  return { emails, numbers, addresses };
}

/**
 * Walk extensionLinks to collect contact-person emenIds linked to this entity.
 *
 * Returns `{ ids, truncated }`. `truncated` is true when the corp-wide contact
 * scan hit the server's 1000-row page cap — in that case the linked-contact
 * list may be incomplete and the caller should surface a warning.
 *
 * No batched-by-eeexIds endpoint exists, so we fetch a page of contact
 * extensions and filter client-side. For tenants with >1000 contacts this is
 * lossy; future work: paginate.
 */
export async function linkedContactEmenIds(
  client: ItxClient,
  entity: Record<string, unknown>,
  role: ExtensionRole,
): Promise<{ ids: number[]; truncated: boolean }> {
  const targetExtType = ROLE_TO_EXT_TYPE[role];
  const ourExts = extensionsOf(entity).filter((x) => x.extType === targetExtType);
  const ourEeexIds = new Set(ourExts.map((x) => x.eeexId).filter(Boolean));

  const contactEeexIds = new Set<number>();
  for (const ext of ourExts) {
    for (const link of ext.extensionLinks ?? []) {
      const fromId = link.from?.eeexId;
      const toId = link.to?.eeexId;
      // Direction: contacts link from contact-extension TO customer-extension.
      if (toId && ourEeexIds.has(toId) && fromId) contactEeexIds.add(fromId);
    }
  }
  if (contactEeexIds.size === 0) return { ids: [], truncated: false };

  const all = await client.searchEntities(
    { extensionTypes: [EXT_TYPE.CONTACT], getExtensions: true, active: true },
    { limitFrom: 0, limitTo: MAX_PAGE },
  );
  const ids: number[] = [];
  for (const e of all) {
    const exts = extensionsOf(e);
    if (exts.some((x) => x.eeexId && contactEeexIds.has(x.eeexId))) {
      const id = (e as { emenId?: number }).emenId;
      if (id) ids.push(id);
    }
  }
  return { ids, truncated: all.length === MAX_PAGE };
}

// ---------- helpers ----------

interface ExtensionShape {
  eeexId?: number;
  extType?: number;
  seqNo?: number;
  active?: boolean;
  thirdPartySystemEntityExtList?: {
    id?: string;
    thirdPartySystem?: { estpId?: number };
  }[];
  extensionLinks?: {
    from?: { eeexId?: number };
    to?: { eeexId?: number };
    type?: number;
  }[];
}

function extensionsOf(entity: Record<string, unknown>): ExtensionShape[] {
  return (entity.extensions as ExtensionShape[] | undefined) ?? [];
}

function describeLookup(lookup: EntityLookup): string {
  if (lookup.seqNo !== undefined) return `seqNo=${lookup.seqNo}`;
  if (lookup.emenId !== undefined) return `emenId=${lookup.emenId}`;
  if (lookup.eeexId !== undefined) return `eeexId=${lookup.eeexId}`;
  if (lookup.hubspotId) return `hubspotId=${lookup.hubspotId}`;
  if (lookup.orgNo) return `orgNo=${lookup.orgNo}`;
  return "(no identifier)";
}

/** Validate that exactly one lookup identifier is present. */
export function validateSingleLookup(input: {
  seqNo?: unknown;
  emenId?: unknown;
  eeexId?: unknown;
  hubspotId?: unknown;
  orgNo?: unknown;
}): string | null {
  const provided = ["seqNo", "emenId", "eeexId", "hubspotId", "orgNo"].filter(
    (k) => input[k as keyof typeof input] !== undefined && input[k as keyof typeof input] !== "",
  );
  if (provided.length === 0) return "no identifier provided";
  if (provided.length > 1) return `multiple identifiers (${provided.join(", ")}) — pick one`;
  return null;
}

export { EXT_TYPE_TO_ROLE };
