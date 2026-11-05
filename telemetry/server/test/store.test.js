// @ts-check
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFsStore, createStore } from "../lib/store.js";

test("fs store round trip, no overwrite, list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-tel-"));
  try {
    const store = createFsStore(dir);
    const nonce = randomUUID();
    assert.equal(await store.has("2026-W44", nonce), false);
    assert.deepEqual(await store.list("2026-W44"), []);
    assert.equal(await store.put("2026-W44", nonce, '{"a":1}'), true);
    assert.equal(await store.has("2026-W44", nonce), true);
    assert.equal(await store.put("2026-W44", nonce, '{"a":2}'), false);
    assert.deepEqual(await store.list("2026-W44"), [{ a: 1 }]);
    assert.deepEqual(await readdir(join(dir, "2026-W44")), [`${nonce}.json`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fs store rejects path-like ids", async () => {
  const store = createFsStore("/nonexistent");
  await assert.rejects(store.put("../x", randomUUID(), "{}"), /invalid week/);
  await assert.rejects(store.put("2026-W44", "../../etc/passwd", "{}"), /invalid nonce/);
});

test("backend choice follows BLOB_READ_WRITE_TOKEN", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-tel-"));
  try {
    const fs = createStore({ TELEMETRY_DATA_DIR: dir });
    assert.equal(await fs.put("2026-W44", randomUUID(), "{}"), true);
    assert.equal((await readdir(join(dir, "2026-W44"))).length, 1);
    const blob = createStore({ BLOB_READ_WRITE_TOKEN: "x" });
    assert.notEqual(blob, fs);
    assert.equal(typeof blob.put, "function");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
