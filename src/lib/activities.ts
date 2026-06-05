import type { ItxClient } from "./client.js";
import type { ActivityKind, ActivitySummary } from "./schemas.js";

/** Activity-link types used by the case→activities resolution. */
export const LINK_TYPES = {
  CONVERSATION: 13,
  CASE: 14,
} as const;

/**
 * Activity type ids (eatyId values).
 * Per ITX API ref: 17 = Meeting. SMS does not have a documented eatyId in the
 * version of the API we target — if it surfaces, it will be classified as "other".
 */
export const ACTIVITY_TYPES = {
  CHAT: 2,
  FEEDBACK: 3,
  CALL: 4,
  NOTE: 8,
  COMMENT: 9,
  EMAIL: 11,
  FB_CHAT: 13,
  WECHAT: 14,
  TICKET: 15,
  MEETING: 17,
  SALE: 20,
  EMAIL_CONVERSATION: 21,
  SCREEN_SHARE: 24,
  IG_CHAT: 27,
  WHATSAPP: 29,
} as const;

/** Member role ids on activities and cases. */
export const ROLES = {
  ASSIGNED_USER: 1,
  CASE_FOLLOWER: 2,
  CONTACT_PERSON: 20,
} as const;

/**
 * Build a zero-filled map of every ActivityKind.
 * Use as the seed when computing per-kind counts so the resulting object
 * always carries every key — agents can rely on `byKind.email` existing.
 */
export function emptyKindMap(): Record<ActivityKind, number> {
  return {
    email: 0,
    emailConversation: 0,
    call: 0,
    note: 0,
    comment: 0,
    ticket: 0,
    sale: 0,
    meeting: 0,
    feedback: 0,
    chat: 0,
    whatsapp: 0,
    fbChat: 0,
    igChat: 0,
    wechat: 0,
    other: 0,
  };
}

/** Map an eatyId to a stable string kind used in our JSON output. */
export function activityKind(eatyId: number | undefined): ActivityKind {
  switch (eatyId) {
    case ACTIVITY_TYPES.EMAIL: return "email";
    case ACTIVITY_TYPES.EMAIL_CONVERSATION: return "emailConversation";
    case ACTIVITY_TYPES.CALL: return "call";
    case ACTIVITY_TYPES.NOTE: return "note";
    case ACTIVITY_TYPES.COMMENT: return "comment";
    case ACTIVITY_TYPES.TICKET: return "ticket";
    case ACTIVITY_TYPES.SALE: return "sale";
    case ACTIVITY_TYPES.MEETING: return "meeting";
    case ACTIVITY_TYPES.FEEDBACK: return "feedback";
    case ACTIVITY_TYPES.CHAT: return "chat";
    case ACTIVITY_TYPES.WHATSAPP: return "whatsapp";
    case ACTIVITY_TYPES.FB_CHAT: return "fbChat";
    case ACTIVITY_TYPES.IG_CHAT: return "igChat";
    case ACTIVITY_TYPES.WECHAT: return "wechat";
    default: return "other";
  }
}

/** Human-readable label for table rendering. */
export function activityTypeLabel(eatyId?: number): string {
  switch (eatyId) {
    case ACTIVITY_TYPES.CHAT: return "Chat";
    case ACTIVITY_TYPES.CALL: return "Call";
    case ACTIVITY_TYPES.NOTE: return "Note";
    case ACTIVITY_TYPES.EMAIL: return "Email";
    case ACTIVITY_TYPES.FB_CHAT: return "FB Chat";
    case ACTIVITY_TYPES.WECHAT: return "WeChat";
    case ACTIVITY_TYPES.MEETING: return "Meeting";
    case ACTIVITY_TYPES.SCREEN_SHARE: return "Screen Share";
    case ACTIVITY_TYPES.IG_CHAT: return "IG Chat";
    case ACTIVITY_TYPES.WHATSAPP: return "WhatsApp";
    default: return "Activity";
  }
}

/** Strip HTML to plain text. Conservative — preserves paragraph breaks. */
export function htmlToText(html: string): string {
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

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Resolve activities linked to a single ticket (case) eactId.
 * Steps (kept identical to the existing `ticket activities` flow):
 *   1. cases/search to get the case + its links[]
 *   2. activities/search by linked eactIds
 *   3. expand any EMAIL_CONVERSATION activities to individual emails
 *   4. sort by creationTs ascending
 *   5. (optional) fetch email bodies in parallel
 */
export async function resolveTicketActivities(
  client: ItxClient,
  eactId: number,
  opts: { includeBodies?: boolean } = {},
): Promise<{
  activities: Record<string, unknown>[];
  emailBodies: Map<number, string>;
}> {
  const fullCaseResult = await client.request<
    Record<string, unknown> | Record<string, unknown>[]
  >("/rest/itxems/cases/search", {
    method: "POST",
    body: { eactIds: [eactId] },
  });

  const fullCase = Array.isArray(fullCaseResult)
    ? fullCaseResult[0]
    : fullCaseResult;
  const links = ((fullCase?.links ?? []) as Record<string, unknown>[]);
  const caseLinks = links.filter((link) => {
    const to = link.to as { eactId?: number } | undefined;
    return link.type === LINK_TYPES.CASE && to?.eactId === eactId;
  });
  const linkedActivityIds = caseLinks.map(
    (link) => (link.from as { eactId: number }).eactId,
  );

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

    // Expand email conversations to individual emails.
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
      activities = activities.filter((a) => a.eactId !== conv.eactId);
      activities.push(...(emails ?? []));
    }
  }

  activities.sort((a, b) => {
    const aTs = new Date((a.creationTs as string) ?? 0).getTime();
    const bTs = new Date((b.creationTs as string) ?? 0).getTime();
    return aTs - bTs;
  });

  const emailBodies = new Map<number, string>();
  if (opts.includeBodies) {
    const emailActivities = activities.filter(
      (a) =>
        (a.activityType as { eatyId?: number })?.eatyId ===
        ACTIVITY_TYPES.EMAIL,
    );
    await Promise.all(
      emailActivities.map(async (email) => {
        const html = await client.getEmailContent(email.eactId as number);
        if (typeof html === "string") {
          emailBodies.set(email.eactId as number, htmlToText(html));
        }
      }),
    );
  }

  return { activities, emailBodies };
}

/**
 * Project a raw activity payload into the stable ActivitySummary shape.
 * `direction`: 1 = outbound, 2 = inbound (per ITX convention).
 */
export function projectActivity(
  raw: Record<string, unknown>,
  emailBody?: string,
): ActivitySummary {
  const eatyId = ((raw.activityType as { eatyId?: number }) ?? {}).eatyId ?? 0;
  const direction = raw.direction as number | undefined;
  const dirLabel: ActivitySummary["direction"] =
    direction === 1 ? "outbound" : direction === 2 ? "inbound" : null;

  const ts = (raw.creationTs as string) ?? "";

  let durationSec: number | undefined;
  if (raw.startTs && raw.endTs) {
    durationSec = Math.round(
      (new Date(raw.endTs as string).getTime() -
        new Date(raw.startTs as string).getTime()) /
        1000,
    );
  }

  return {
    eactId: (raw.eactId as number) ?? 0,
    kind: activityKind(eatyId),
    eatyId,
    direction: dirLabel,
    ts,
    subject: raw.subject as string | undefined,
    fromMail: raw.fromMail as string | undefined,
    toMail: raw.toMail as string | undefined,
    body: emailBody,
    callDurationSec: durationSec,
    saleValue: typeof raw.value === "number" ? (raw.value as number) : undefined,
    saleProbability:
      typeof raw.saleProbability === "number"
        ? (raw.saleProbability as number)
        : undefined,
    description: raw.description as string | undefined,
  };
}
