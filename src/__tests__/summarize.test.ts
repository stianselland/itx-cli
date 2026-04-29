import { describe, it, expect } from "vitest";
import { computeHealth } from "../lib/summarize.js";
import type {
  CommunicationStats,
  SaleStats,
  TicketStats,
} from "../lib/schemas.js";

const NOW = new Date("2026-04-29T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function ticketStats(over: Partial<TicketStats> = {}): TicketStats {
  return {
    totalOpen: 0,
    totalClosed: 0,
    byStatus: {},
    byPriority: {},
    byCategory: {},
    awaitingExternal: 0,
    awaitingInternal: 0,
    criticalOpen: 0,
    ...over,
  };
}

function commStats(over: Partial<CommunicationStats> = {}): CommunicationStats {
  return {
    lastInboundTs: null,
    lastOutboundTs: null,
    byKind: {} as CommunicationStats["byKind"],
    totalActivities: 0,
    ...over,
  };
}

function saleStats(over: Partial<SaleStats> = {}): SaleStats {
  return {
    openCount: 0,
    openValue: 0,
    weightedValue: 0,
    byStep: {},
    lastUpdateTs: null,
    ...over,
  };
}

describe("computeHealth", () => {
  it("returns ok when no signals fire", () => {
    const h = computeHealth(ticketStats(), commStats({ totalActivities: 1 }), saleStats(), NOW);
    expect(h.signal).toBe("ok");
  });

  it("escalates to trouble for any open critical ticket", () => {
    const h = computeHealth(
      ticketStats({ criticalOpen: 1, totalOpen: 1 }),
      commStats({ totalActivities: 5 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("trouble");
    expect(h.reasons.some((r) => r.includes("critical"))).toBe(true);
  });

  it("escalates to attention when ≥5 open tickets without higher signal", () => {
    const h = computeHealth(
      ticketStats({ totalOpen: 6 }),
      commStats({ totalActivities: 10 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("attention");
  });

  it("escalates to stalled for inbound silence 90-180 days", () => {
    const lastInbound = new Date(NOW - 100 * DAY).toISOString();
    const h = computeHealth(
      ticketStats(),
      commStats({ lastInboundTs: lastInbound, totalActivities: 5 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("stalled");
    expect(h.reasons.some((r) => r.includes("100 days"))).toBe(true);
  });

  it("escalates to trouble for inbound silence >180 days", () => {
    const lastInbound = new Date(NOW - 200 * DAY).toISOString();
    const h = computeHealth(
      ticketStats(),
      commStats({ lastInboundTs: lastInbound, totalActivities: 5 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("trouble");
  });

  it("flags attention for 60-90 day silence with open pipeline", () => {
    const lastInbound = new Date(NOW - 75 * DAY).toISOString();
    const h = computeHealth(
      ticketStats(),
      commStats({ lastInboundTs: lastInbound, totalActivities: 5 }),
      saleStats({ openCount: 1, openValue: 1000 }),
      NOW,
    );
    expect(h.signal).toBe("attention");
  });

  it("stays ok for 60-90 day silence without pipeline", () => {
    const lastInbound = new Date(NOW - 75 * DAY).toISOString();
    const h = computeHealth(
      ticketStats(),
      commStats({ lastInboundTs: lastInbound, totalActivities: 5 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("ok");
  });

  it("flags stalled for never-communicated entities", () => {
    const h = computeHealth(
      ticketStats(),
      commStats({ totalActivities: 0 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("stalled");
    expect(h.reasons).toContain("No communication on record");
  });

  it("trouble outranks stalled outranks attention", () => {
    // Both critical-open AND >180d silence should still report trouble.
    const lastInbound = new Date(NOW - 200 * DAY).toISOString();
    const h = computeHealth(
      ticketStats({ criticalOpen: 1, totalOpen: 1 }),
      commStats({ lastInboundTs: lastInbound, totalActivities: 5 }),
      saleStats(),
      NOW,
    );
    expect(h.signal).toBe("trouble");
    // both reasons should still be listed
    expect(h.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
