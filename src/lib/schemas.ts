/**
 * Stable JSON schemas for `itx ... --json` output.
 *
 * Every command's `data` field has a typed shape declared here. Treat this
 * file as the public contract — agents and downstream tools rely on these
 * names. Bump the package major version on any breaking change.
 *
 * The runtime `itx schema <command>` command reads these definitions to
 * produce machine-readable JSON Schema for LLM consumption.
 */

/** Customer/prospect classification — matches ITX entityType + extType. */
export type EntityClassification = "private" | "corporate";
export type ExtensionRole = "customer" | "prospect";

/** Compact contact info shared by `view` and inside `summary.profile`. */
export interface ContactInfo {
  emails: { type: number; address: string }[];
  numbers: { type: number; number: string }[];
  addresses: {
    type: number;
    line1?: string;
    line2?: string;
    postalCode?: string;
    postalCity?: string;
    country?: string;
  }[];
}

/** Identity block returned on every entity-shaped response. */
export interface EntityIdentity {
  emenId: number;
  eeexId: number;
  seqNo: number;          // the UI-visible "customer number"
  name1: string;
  name2: string | null;
  classification: EntityClassification;
  role: ExtensionRole;
  externalIds: { system: string; estpId: number; id: string }[];
}

// ---------- customer search ----------

export interface CustomerSearchResult {
  identity: EntityIdentity;
  matchedOn: "name" | "exactName" | "id";
}

// ---------- customer view ----------

export interface CustomerView {
  identity: EntityIdentity;
  contact: ContactInfo;
  linkedContacts?: {
    emenId: number;
    eeexId: number;
    name1: string | null;
    name2: string | null;
    emails: string[];
    numbers: string[];
  }[];
}

// ---------- customer tickets ----------

export interface TicketSummary {
  seqNo: number;
  eactId: number;
  subject: string;
  status: { id: number | null; name: string };
  priority: { id: number | null; name: string };
  category: { id: number | null; name: string };
  creationTs: string;
  updateTs: string;
  assignedUser?: { userId: number; name: string };
}

export interface CustomerTicketsResult {
  identity: Pick<EntityIdentity, "emenId" | "seqNo" | "name1">;
  tickets: TicketSummary[];
  counts: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
}

// ---------- ticket activities ----------

export interface TicketComment {
  ts: string;
  author: { firstName: string | null; lastName: string | null };
  text: string;
}

export interface TicketActivitiesResult {
  ticket: { seqNo: number; eactId: number };
  activities: ActivitySummary[];
  comments: TicketComment[];
}

// ---------- customer activities ----------

export type ActivityKind =
  | "email"
  | "emailConversation"
  | "call"
  | "note"
  | "comment"
  | "ticket"
  | "sale"
  | "meeting"
  | "feedback"
  | "chat"
  | "whatsapp"
  | "fbChat"
  | "igChat"
  | "wechat"
  | "other";

export interface ActivitySummary {
  eactId: number;
  kind: ActivityKind;
  eatyId: number;
  direction: "inbound" | "outbound" | "internal" | null;
  ts: string;
  subject?: string;
  fromMail?: string;
  toMail?: string;
  body?: string; // populated only when --include-bodies
  callDurationSec?: number;
  saleValue?: number;
  saleProbability?: number;
  description?: string;
}

export interface CustomerActivitiesResult {
  identity: Pick<EntityIdentity, "emenId" | "seqNo" | "name1">;
  activities: ActivitySummary[];
  counts: Record<ActivityKind, number>;
}

// ---------- customer summary ----------

export type SummaryDepth = "brief" | "standard" | "full";

export interface SaleStats {
  openCount: number;
  openValue: number;
  weightedValue: number;
  byStep: Record<string, number>;
  lastUpdateTs: string | null;
}

export interface CommunicationStats {
  lastInboundTs: string | null;
  lastOutboundTs: string | null;
  byKind: Record<ActivityKind, number>;
  totalActivities: number;
}

export interface TicketStats {
  totalOpen: number;
  totalClosed: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  awaitingExternal: number;
  awaitingInternal: number;
  criticalOpen: number;
}

export interface CustomerSummary {
  identity: EntityIdentity;
  depth: SummaryDepth;
  since: string | null;
  contact: ContactInfo;
  tickets: TicketStats & { recent?: TicketSummary[] };
  communication: CommunicationStats & { recent?: ActivitySummary[] };
  pipeline: SaleStats;
  health: {
    signal: "ok" | "attention" | "trouble" | "stalled";
    reasons: string[];
  };
}

/**
 * Top-level field names per command — used by the gh-style "--json with no
 * value" introspection helper.
 */
export const COMMAND_FIELDS: Record<string, string[]> = {
  "ticket activities": ["ticket", "activities", "comments"],
  "customer search": ["identity", "matchedOn"],
  "customer view": ["identity", "contact", "linkedContacts"],
  "customer tickets": ["identity", "tickets", "counts"],
  "customer activities": ["identity", "activities", "counts"],
  "customer summary": [
    "identity",
    "depth",
    "since",
    "contact",
    "tickets",
    "communication",
    "pipeline",
    "health",
  ],
  "customer contacts": ["identity", "linkedContacts"],
  "prospect search": ["identity", "matchedOn"],
  "prospect view": ["identity", "contact", "linkedContacts"],
  "prospect tickets": ["identity", "tickets", "counts"],
  "prospect activities": ["identity", "activities", "counts"],
  "prospect summary": [
    "identity",
    "depth",
    "since",
    "contact",
    "tickets",
    "communication",
    "pipeline",
    "health",
  ],
};
