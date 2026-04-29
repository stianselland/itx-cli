import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  identityFrom,
  contactFrom,
  validateSingleLookup,
  resolveEntity,
  EXT_TYPE,
  ENTITY_TYPE,
  ESTP,
} from "../lib/entity.js";
import { setConfig, clearConfig } from "../lib/config.js";
import { ItxClient } from "../lib/client.js";

beforeEach(() => {
  setConfig({
    ssoEndpoint: "https://sso.test",
    activeEndpoint: "https://api.test",
    tokenv2: "tok",
    rcntrl: "1",
    ccntrl: "2",
  });
});

afterEach(() => {
  clearConfig();
  vi.restoreAllMocks();
});

const sampleCorporateCustomer = {
  emenId: 1000,
  name1: "Acme Ltd",
  name2: null,
  entityType: ENTITY_TYPE.CORPORATE,
  extensions: [
    {
      eeexId: 555,
      extType: EXT_TYPE.CUSTOMER,
      seqNo: 13918,
      active: true,
      thirdPartySystemEntityExtList: [
        { id: "hs-789", thirdPartySystem: { estpId: ESTP.HUBSPOT_CUSTOMER } },
      ],
      extensionLinks: [
        { from: { eeexId: 8001 }, to: { eeexId: 555 }, type: 10 },
        { from: { eeexId: 8002 }, to: { eeexId: 555 }, type: 10 },
      ],
    },
  ],
  emails: [{ emailType: 30, email: "info@acme.com" }],
  numbers: [{ numberType: 10, number: "+441000" }],
  addresses: [
    { addressType: 20, line1: "1 Main St", postalCity: "Manchester", country: "UK" },
  ],
};

describe("identityFrom", () => {
  it("projects a corporate customer", () => {
    const id = identityFrom(sampleCorporateCustomer, "customer");
    expect(id.emenId).toBe(1000);
    expect(id.eeexId).toBe(555);
    expect(id.seqNo).toBe(13918);
    expect(id.name1).toBe("Acme Ltd");
    expect(id.classification).toBe("corporate");
    expect(id.role).toBe("customer");
    expect(id.externalIds).toEqual([
      { system: "HUBSPOTCUST", estpId: ESTP.HUBSPOT_CUSTOMER, id: "hs-789" },
    ]);
  });

  it("projects a private customer", () => {
    const priv = { ...sampleCorporateCustomer, entityType: ENTITY_TYPE.PRIVATE };
    const id = identityFrom(priv, "customer");
    expect(id.classification).toBe("private");
  });

  it("falls back when extension list is empty", () => {
    const id = identityFrom({ emenId: 999, name1: "X", extensions: [] }, "customer");
    expect(id.eeexId).toBe(0);
    expect(id.seqNo).toBe(0);
  });
});

describe("contactFrom", () => {
  it("projects emails, numbers, addresses", () => {
    const c = contactFrom(sampleCorporateCustomer);
    expect(c.emails).toEqual([{ type: 30, address: "info@acme.com" }]);
    expect(c.numbers).toEqual([{ type: 10, number: "+441000" }]);
    expect(c.addresses[0].postalCity).toBe("Manchester");
  });
});

describe("validateSingleLookup", () => {
  it("accepts exactly one", () => {
    expect(validateSingleLookup({ seqNo: 13918 })).toBeNull();
    expect(validateSingleLookup({ emenId: 1000 })).toBeNull();
    expect(validateSingleLookup({ hubspotId: "abc" })).toBeNull();
  });

  it("rejects none", () => {
    expect(validateSingleLookup({})).toContain("no identifier");
  });

  it("rejects multiple", () => {
    expect(validateSingleLookup({ seqNo: 1, emenId: 2 })).toContain("multiple");
  });
});

describe("resolveEntity", () => {
  function jsonResponse(data: unknown) {
    return {
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => data,
    };
  }

  it("resolves by emenId via getEntity", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(sampleCorporateCustomer))   // getEntity
      .mockResolvedValueOnce(jsonResponse(sampleCorporateCustomer))   // re-fetch full
      .mockResolvedValueOnce(jsonResponse([]));                       // contact lookup
    vi.stubGlobal("fetch", mockFetch);

    const result = await resolveEntity(new ItxClient(), {
      emenId: 1000,
      role: "customer",
    });
    expect(result.identity.emenId).toBe(1000);
    expect(result.identity.seqNo).toBe(13918);
  });

  it("resolves by seqNo using extensionSeqNoFilters server-side", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleCorporateCustomer])) // search
      .mockResolvedValueOnce(jsonResponse(sampleCorporateCustomer))   // re-fetch full
      .mockResolvedValueOnce(jsonResponse([]));                       // contact lookup
    vi.stubGlobal("fetch", mockFetch);

    const result = await resolveEntity(new ItxClient(), {
      seqNo: 13918,
      role: "customer",
    });

    expect(result.identity.seqNo).toBe(13918);
    // Lock the undocumented-but-functional filter into the request body so a
    // refactor that drops it can't pass tests with hand-shaped mock responses.
    const searchBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string,
    ) as { extensionSeqNoFilters?: { seqNo: number }[] };
    expect(searchBody.extensionSeqNoFilters).toEqual([{ seqNo: 13918 }]);
  });

  it("throws NotFound when nothing matches", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([])); // search returns empty
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      resolveEntity(new ItxClient(), { seqNo: 99999, role: "customer" }),
    ).rejects.toThrow(/Not found/);
  });

  it("throws Ambiguous when multiple match", async () => {
    const dup = { ...sampleCorporateCustomer, emenId: 1001 };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([sampleCorporateCustomer, dup]));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      resolveEntity(new ItxClient(), { seqNo: 13918, role: "customer" }),
    ).rejects.toThrow(/Ambiguous/);
  });
});
