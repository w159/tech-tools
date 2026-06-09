import test from "node:test";
import assert from "node:assert/strict";
import { auditNonPortableSurfaces } from "./surface-audit.js";

test("surface-audit passes against the real repo", async () => {
  const report = await auditNonPortableSurfaces();
  assert.equal(report.ok, true);
  assert.ok(report.auditedFiles.length >= 6);
});
