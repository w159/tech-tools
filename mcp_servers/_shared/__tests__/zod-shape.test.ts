/**
 * Run with: node --experimental-strip-types --test __tests__/zod-shape.test.ts
 * zod comes from a connector's node_modules (_shared has none).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "../../threatlocker-mcp/node_modules/zod/index.js";
import { toZodShape } from "../zod-shape.ts";

const parse = (schema: Parameters<typeof toZodShape>[1], value: unknown) =>
  z.object(toZodShape(z, schema)).safeParse(value);

describe("toZodShape", () => {
  const schema = {
    type: "object" as const,
    properties: {
      id: { type: "string", description: "Device ID" },
      limit: { type: "integer" },
      ratio: { type: "number" },
      includeGlobal: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
      status: { enum: ["open", "closed"] },
      osType: { enum: [1, 2, 3] },
      json: {},
    },
    required: ["id"],
  };

  it("accepts a valid payload with optional fields omitted", () => {
    assert.equal(parse(schema, { id: "a" }).success, true);
  });

  it("rejects a missing required field", () => {
    assert.equal(parse(schema, {}).success, false);
  });

  it("rejects a wrong primitive type (boolean given a string)", () => {
    assert.equal(parse(schema, { id: "a", includeGlobal: "yes" }).success, false);
  });

  it("rejects a non-integer for an integer property", () => {
    assert.equal(parse(schema, { id: "a", limit: 1.5 }).success, false);
  });

  it("enforces string and numeric enums", () => {
    assert.equal(parse(schema, { id: "a", status: "open", osType: 2 }).success, true);
    assert.equal(parse(schema, { id: "a", status: "pending" }).success, false);
    assert.equal(parse(schema, { id: "a", osType: 9 }).success, false);
  });

  it("validates array items and lets typeless properties through", () => {
    assert.equal(parse(schema, { id: "a", tags: ["x"], json: { any: 1 } }).success, true);
    assert.equal(parse(schema, { id: "a", tags: [1] }).success, false);
  });

  it("keeps descriptions so tools/list still documents each field", () => {
    assert.equal(toZodShape(z, schema).id.description, "Device ID");
  });

  it("accepts a free-form object property and rejects a non-object for it", () => {
    const body = { type: "object" as const, properties: { body: { type: "object" } } };
    assert.equal(parse(body, { body: { entry: { name: "x" } } }).success, true);
    assert.equal(parse(body, { body: "x" }).success, false);
  });

  it("throws at startup on an unsupported schema feature instead of dropping validation", () => {
    const nested = { type: "object", properties: { a: { type: "string" } } };
    assert.throws(() => toZodShape(z, { type: "object", properties: { nested } }), /Unsupported/);
  });
});
