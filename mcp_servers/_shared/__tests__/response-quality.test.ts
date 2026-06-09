/**
 * Tests for the three _shared response-quality modules.
 *
 * Run with Node 22's built-in test runner (no install needed):
 *   node --experimental-strip-types --test \
 *     mcp_servers/_shared/__tests__/response-quality.test.ts
 *
 * Or from the _shared directory:
 *   node --experimental-strip-types --test __tests__/response-quality.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Imports under test — paths relative to this file's location
// ---------------------------------------------------------------------------
import {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  DEFAULT_CHAR_CAP,
  type SummaryFn,
} from "../response-shaper.ts";

import {
  toolError,
  toolErrorFromCatch,
  missingCredsError,
} from "../error-envelope.ts";

import {
  resolveBaseUrl,
  makeBaseUrlResolver,
  describeBaseUrl,
  VENDOR_DEFAULTS,
} from "../base-url.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseText(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// response-shaper: shapeList
// ---------------------------------------------------------------------------

describe("shapeList", () => {
  const items = [
    { id: "1", name: "Alpha", status: "open", noise: "irrelevant" },
    { id: "2", name: "Beta",  status: "closed", noise: "skip me" },
  ];

  const summaryFn: SummaryFn = (item) => ({
    id:     item.id,
    name:   item.name,
    status: item.status,
  });

  it("applies summaryFn by default, omitting extra fields", () => {
    const result = shapeList(items, summaryFn);
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].noise, undefined);
    assert.equal(parsed[0].name, "Alpha");
  });

  it("respects full:true, returning every field", () => {
    const result = shapeList(items, summaryFn, { full: true });
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed[0].noise, "irrelevant");
  });

  it("respects fields array, selecting only named keys", () => {
    const result = shapeList(items, summaryFn, { fields: ["id", "noise"] });
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed[0].id, "1");
    assert.equal(parsed[0].noise, "irrelevant");
    assert.equal(parsed[0].name, undefined);
  });

  it("filters out items where summaryFn returns null", () => {
    const filterFn: SummaryFn = (item) =>
      item.status === "open" ? { id: item.id } : null;
    const result = shapeList(items, filterFn);
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "1");
  });

  it("truncates at charCap and appends a TRUNCATED notice", () => {
    const bigItems = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: "x".repeat(500),
    }));
    const result = shapeList(bigItems, undefined, {}, 1000);
    const text = result.content[0].text;
    assert.ok(text.includes("[TRUNCATED:"), "expected TRUNCATED notice");
    assert.ok(text.length < 2000, "truncated output should be much smaller than input");
  });

  it("appends paginationHint in truncation notice when supplied", () => {
    const bigItems = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      name: "x".repeat(300),
    }));
    const result = shapeList(bigItems, undefined, {}, 500, "Pass cursor='next' to continue.");
    const text = result.content[0].text;
    assert.ok(text.includes("Pass cursor='next' to continue."));
  });

  it("returns isError undefined (not an error result)", () => {
    const result = shapeList(items, summaryFn);
    assert.equal(result.isError, undefined);
  });

  it("handles empty array without throwing", () => {
    const result = shapeList([], summaryFn);
    const parsed = parseText(result) as unknown[];
    assert.equal(parsed.length, 0);
  });

  it("strips undefined values from the summary so no undefined keys appear in output", () => {
    const allUndefinedFn: SummaryFn = (_item) => ({
      realField: _item["id"],   // defined
      missingField: _item["doesNotExist"],  // undefined
    });
    const result = shapeList(items, allUndefinedFn);
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 2);
    // realField is present; missingField must be absent (not undefined key)
    assert.equal(parsed[0].realField, "1");
    assert.equal("missingField" in parsed[0], false);
  });

  it("falls back to primitive fields when summaryFn returns all-undefined keys", () => {
    // Simulates a summaryFn that references wrong field names (the live defect)
    const wrongFieldsFn: SummaryFn = (_item) => ({
      badKey1: _item["nonExistentField1"],
      badKey2: _item["nonExistentField2"],
    });
    const result = shapeList(items, wrongFieldsFn);
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 2);
    // Must not be empty objects — at least one key from the raw item
    assert.ok(Object.keys(parsed[0]).length > 0, "fallback must yield at least one field");
    // id, name, status, noise are all primitives — at least one must appear
    const hasId = parsed[0].id !== undefined;
    const hasName = parsed[0].name !== undefined;
    assert.ok(hasId || hasName, "fallback should include primitive fields from item");
  });

  it("fallback caps at 8 primitive fields", () => {
    const wide = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 }];
    const zeroFn: SummaryFn = () => ({ bad: undefined });
    const result = shapeList(wide, zeroFn);
    const parsed = parseText(result) as Array<Record<string, unknown>>;
    assert.ok(Object.keys(parsed[0]).length <= 8, "fallback must cap at 8 keys");
  });
});

// ---------------------------------------------------------------------------
// response-shaper: shapeItem
// ---------------------------------------------------------------------------

describe("shapeItem", () => {
  const item = { id: "42", subject: "Fix printer", status: "open", internalNotes: "secret" };

  const summaryFn: SummaryFn = (i) => ({
    id:      i.id,
    subject: i.subject,
    status:  i.status,
  });

  it("applies summaryFn, omitting unselected fields", () => {
    const result = shapeItem(item, summaryFn);
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.internalNotes, undefined);
    assert.equal(parsed.subject, "Fix printer");
  });

  it("returns full item when full:true", () => {
    const result = shapeItem(item, summaryFn, { full: true });
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.internalNotes, "secret");
  });

  it("returns selected fields when fields provided", () => {
    const result = shapeItem(item, summaryFn, { fields: ["id", "internalNotes"] });
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.id, "42");
    assert.equal(parsed.internalNotes, "secret");
    assert.equal(parsed.subject, undefined);
  });

  it("passes item through when summaryFn is undefined", () => {
    const result = shapeItem(item, undefined);
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.internalNotes, "secret");
  });
});

// ---------------------------------------------------------------------------
// response-shaper: shapeRaw
// ---------------------------------------------------------------------------

describe("shapeRaw", () => {
  it("serializes an object", () => {
    const result = shapeRaw({ ok: true });
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.ok, true);
  });

  it("passes a string through as-is when under cap", () => {
    const result = shapeRaw("hello world");
    assert.equal(result.content[0].text, "hello world");
  });

  it("truncates a large string", () => {
    const big = "x".repeat(DEFAULT_CHAR_CAP + 1000);
    const result = shapeRaw(big);
    assert.ok(result.content[0].text.includes("[TRUNCATED:"));
  });
});

// ---------------------------------------------------------------------------
// response-shaper: extractShapeArgs
// ---------------------------------------------------------------------------

describe("extractShapeArgs", () => {
  it("extracts fields array from args", () => {
    const args = extractShapeArgs({ fields: ["id", "name"], full: false });
    assert.deepEqual(args.fields, ["id", "name"]);
    assert.equal(args.full, false);
  });

  it("sets full:true from args", () => {
    const args = extractShapeArgs({ full: true });
    assert.equal(args.full, true);
    assert.equal(args.fields, undefined);
  });

  it("ignores invalid fields values (not string array)", () => {
    const args = extractShapeArgs({ fields: [1, 2, 3] });
    assert.equal(args.fields, undefined);
  });

  it("returns empty shape args for empty input", () => {
    const args = extractShapeArgs({});
    assert.equal(args.full, false);
    assert.equal(args.fields, undefined);
  });
});

// ---------------------------------------------------------------------------
// response-shaper: nested field picking
// ---------------------------------------------------------------------------

describe("pickFields (via shapeItem with fields)", () => {
  const item = {
    id: "1",
    contact: { email: "a@b.com", phone: "555" },
    status: "open",
  };

  it("picks a nested field with dot notation", () => {
    const result = shapeItem(item, undefined, { fields: ["id", "contact.email"] });
    const parsed = parseText(result) as Record<string, unknown>;
    assert.equal(parsed.id, "1");
    const contact = parsed.contact as Record<string, unknown>;
    assert.equal(contact.email, "a@b.com");
    assert.equal(contact.phone, undefined);
  });
});

// ---------------------------------------------------------------------------
// response-shaper: SHAPE_PROPS constant
// ---------------------------------------------------------------------------

describe("SHAPE_PROPS", () => {
  it("exports fields and full properties with correct types", () => {
    assert.equal(SHAPE_PROPS.fields.type, "array");
    assert.equal(SHAPE_PROPS.full.type, "boolean");
  });
});

// ---------------------------------------------------------------------------
// error-envelope: toolError
// ---------------------------------------------------------------------------

describe("toolError", () => {
  it("sets isError:true", () => {
    const result = toolError("NOT_FOUND", "Resource missing");
    assert.equal(result.isError, true);
  });

  it("produces parseable JSON with error envelope", () => {
    const result = toolError("NOT_FOUND", "Resource missing", {
      hint: "Check the ID.",
    });
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.equal(parsed.error.message, "Resource missing");
    assert.equal(parsed.error.hint, "Check the ID.");
  });

  it("omits detail and hint keys when not provided", () => {
    const result = toolError("INTERNAL_ERROR", "Something broke");
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal("detail" in parsed.error, false);
    assert.equal("hint" in parsed.error, false);
  });

  it("includes detail when provided", () => {
    const result = toolError("VENDOR_ERROR", "API failed", {
      detail: "HTTP 503: Service Unavailable",
    });
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.detail, "HTTP 503: Service Unavailable");
  });
});

// ---------------------------------------------------------------------------
// error-envelope: toolErrorFromCatch
// ---------------------------------------------------------------------------

describe("toolErrorFromCatch", () => {
  it("handles a standard Error instance", () => {
    const result = toolErrorFromCatch("tickets.get", new Error("connection refused ECONNREFUSED"));
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "NETWORK_ERROR");
    assert.ok(
      (parsed.error.message as string).includes("tickets.get"),
      "message should name the operation"
    );
  });

  it("maps HTTP 404 to NOT_FOUND", () => {
    const err = { status: 404, body: "not found" };
    const result = toolErrorFromCatch("devices.get", err);
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "NOT_FOUND");
  });

  it("maps HTTP 429 to RATE_LIMITED", () => {
    const err = { status: 429 };
    const result = toolErrorFromCatch("reports.list", err);
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "RATE_LIMITED");
  });

  it("maps HTTP 401 to FORBIDDEN", () => {
    const err = { status: 401, body: "unauthorized" };
    const result = toolErrorFromCatch("users.list", err);
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "FORBIDDEN");
  });

  it("applies caller-supplied hint over auto-detected values", () => {
    const err = { status: 404 };
    const result = toolErrorFromCatch("tickets.get", err, {
      hint: "Use ninjaone_tickets_list to find valid IDs.",
    });
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.hint, "Use ninjaone_tickets_list to find valid IDs.");
  });

  it("handles unknown thrown shapes gracefully", () => {
    const result = toolErrorFromCatch("something", "a raw string was thrown");
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "INTERNAL_ERROR");
    assert.ok(parsed.error.detail !== undefined);
  });

  it("maps an Error subclass with numeric .status to the correct code (CwHttpError pattern)", () => {
    // Simulates how CwManageClient throws: an Error subclass that carries .status
    // so isStatusError() matches it before the plain instanceof Error branch.
    class VendorHttpError extends Error {
      readonly status: number;
      constructor(status: number, msg: string) {
        super(msg);
        this.status = status;
      }
    }

    const err404 = new VendorHttpError(404, "ConnectWise API GET /service/tickets/99999 returned 404: Not Found");
    const result = toolErrorFromCatch("cw_get_ticket", err404, {
      hint: "Verify the ticket_id with cw_search_tickets first.",
    });
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.ok((parsed.error.message as string).includes("cw_get_ticket"));
    assert.equal(parsed.error.hint, "Verify the ticket_id with cw_search_tickets first.");
  });

  it("maps Error subclass with status 429 to RATE_LIMITED", () => {
    class VendorHttpError extends Error {
      readonly status: number;
      constructor(status: number, msg: string) { super(msg); this.status = status; }
    }
    const result = toolErrorFromCatch("cw_search_tickets", new VendorHttpError(429, "rate limited"));
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "RATE_LIMITED");
  });

  it("maps Error subclass with status 403 to FORBIDDEN", () => {
    class VendorHttpError extends Error {
      readonly status: number;
      constructor(status: number, msg: string) { super(msg); this.status = status; }
    }
    const result = toolErrorFromCatch("cw_get_ticket", new VendorHttpError(403, "forbidden"));
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// error-envelope: missingCredsError
// ---------------------------------------------------------------------------

describe("missingCredsError", () => {
  it("produces MISSING_CREDENTIALS code with env var hint", () => {
    const result = missingCredsError("NinjaOne", [
      "NINJAONE_CLIENT_ID",
      "NINJAONE_CLIENT_SECRET",
    ]);
    const parsed = parseText(result) as { error: Record<string, unknown> };
    assert.equal(parsed.error.code, "MISSING_CREDENTIALS");
    assert.ok(
      (parsed.error.hint as string).includes("NINJAONE_CLIENT_ID"),
      "hint should name the env vars"
    );
  });

  it("sets isError:true", () => {
    const result = missingCredsError("Vanta", ["VANTA_API_TOKEN"]);
    assert.equal(result.isError, true);
  });
});

// ---------------------------------------------------------------------------
// base-url: resolveBaseUrl
// ---------------------------------------------------------------------------

describe("resolveBaseUrl", () => {
  it("returns the hardcoded default when override is absent", () => {
    const url = resolveBaseUrl("ninjaone");
    assert.equal(url, "https://app.ninjarmm.com");
  });

  it("returns the hardcoded default when override is empty string", () => {
    const url = resolveBaseUrl("ninjaone", "");
    assert.equal(url, "https://app.ninjarmm.com");
  });

  it("returns the hardcoded default when override is whitespace", () => {
    const url = resolveBaseUrl("ninjaone", "   ");
    assert.equal(url, "https://app.ninjarmm.com");
  });

  it("returns the env var override when provided", () => {
    const url = resolveBaseUrl("ninjaone", "https://eu.ninjarmm.com");
    assert.equal(url, "https://eu.ninjarmm.com");
  });

  it("strips trailing slashes from overrides", () => {
    const url = resolveBaseUrl("vanta", "https://api.vanta.com/v1/");
    assert.equal(url, "https://api.vanta.com/v1");
  });

  it("strips trailing slashes from defaults", () => {
    // Confirm none of the hardcoded defaults have trailing slashes after resolution
    for (const [, defaultUrl] of Object.entries(VENDOR_DEFAULTS)) {
      if (!defaultUrl) continue;
      const resolved = resolveBaseUrl(
        "ninjaone", // vendor arg doesn't matter when we test the stripping logic
        defaultUrl + "/"
      );
      assert.ok(!resolved?.endsWith("/"), `default for ${defaultUrl} should not end with /`);
    }
  });

  it("returns undefined for self-hosted vendors with no override (cipp)", () => {
    const url = resolveBaseUrl("cipp");
    assert.equal(url, undefined);
  });

  it("returns the override for self-hosted vendors when provided", () => {
    const url = resolveBaseUrl("cipp", "https://my-cipp.example.com");
    assert.equal(url, "https://my-cipp.example.com");
  });

  it("returns correct default for all vendors with known defaults", () => {
    const entries = Object.entries(VENDOR_DEFAULTS) as Array<
      [string, string | undefined]
    >;
    for (const [vendor, expected] of entries) {
      if (!expected) continue;
      const resolved = resolveBaseUrl(vendor as Parameters<typeof resolveBaseUrl>[0]);
      assert.equal(
        resolved,
        expected.replace(/\/$/, ""),
        `${vendor} default mismatch`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// base-url: makeBaseUrlResolver
// ---------------------------------------------------------------------------

describe("makeBaseUrlResolver", () => {
  it("returns a bound function that resolves correctly", () => {
    const resolveNinja = makeBaseUrlResolver("ninjaone");
    assert.equal(resolveNinja(), "https://app.ninjarmm.com");
    assert.equal(resolveNinja("https://eu.ninjarmm.com"), "https://eu.ninjarmm.com");
    assert.equal(resolveNinja(""), "https://app.ninjarmm.com");
  });
});

// ---------------------------------------------------------------------------
// base-url: describeBaseUrl
// ---------------------------------------------------------------------------

describe("describeBaseUrl", () => {
  it("describes the default when no override is set", () => {
    const desc = describeBaseUrl("vanta", "", "VANTA_BASE_URL");
    assert.ok(desc.includes("https://api.vanta.com/v1"), "should contain the URL");
    assert.ok(desc.includes("vendor default"), "should label it as vendor default");
    assert.ok(desc.includes("VANTA_BASE_URL"), "should name the env var");
  });

  it("describes the override when set", () => {
    const desc = describeBaseUrl("vanta", "https://staging.vanta.com", "VANTA_BASE_URL");
    assert.ok(desc.includes("staging.vanta.com"), "should contain the override URL");
    assert.ok(desc.includes("VANTA_BASE_URL"), "should name the env var source");
  });

  it("handles self-hosted vendors with no default and no override", () => {
    const desc = describeBaseUrl("cipp", "", "CIPP_BASE_URL");
    assert.ok(desc.includes("not configured"), "should say not configured");
    assert.ok(desc.includes("CIPP_BASE_URL"), "should name the required env var");
  });
});
