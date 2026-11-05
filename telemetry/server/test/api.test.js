// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle as aggregate } from "../api/aggregate.js";
import { handle as ingest } from "../api/ingest.js";
import { createFsStore } from "../lib/store.js";
import { ALLOWED, NOW, PAST_WEEK, submission } from "./helpers.js";

/**
 * @param {unknown} body
 * @param {string} [method]
 */
const post = (body, method = "POST") =>
  new Request("http://x/api/ingest", {
    method,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "atlas-tel-"));
  const store = createFsStore(dir);
  return { dir, ctx: { store, allowed: ALLOWED, now: NOW }, done: () => rm(dir, { recursive: true, force: true }) };
}

test("ingest: 405, 413, 400, 201, 409", async () => {
  const { dir, ctx, done } = await setup();
  try {
    assert.equal((await ingest(post("", "GET"), ctx)).status, 405);
    assert.equal((await ingest(post("x".repeat(70 * 1024)), ctx)).status, 413);

    const bad = await ingest(post(submission({ counts: { "skill.unknown": 1 } })), ctx);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).errors[0], /not allowed/);

    const good = submission();
    assert.equal((await ingest(post(good), ctx)).status, 201);
    assert.equal((await ingest(post(good), ctx)).status, 409);

    // stored file is exactly the validated body, nothing else
    const files = await readdir(join(dir, PAST_WEEK));
    assert.equal(files.length, 1);
    const stored = JSON.parse(await readFile(join(dir, PAST_WEEK, files[0]), "utf8"));
    assert.deepEqual(Object.keys(stored).sort(), ["atlas_version", "counts", "nonce", "os", "python", "schema", "week"]);
  } finally {
    await done();
  }
});

test("ingest: oversized content-length is refused without reading", async () => {
  const { ctx, done } = await setup();
  try {
    const req = new Request("http://x/api/ingest", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999" },
    });
    assert.equal((await ingest(req, ctx)).status, 413);
  } finally {
    await done();
  }
});

test("aggregate: 2 installs hidden, 3 shown, cache header, bad week, 405", async () => {
  const { ctx, done } = await setup();
  try {
    const get = (/** @type {string} */ q) => aggregate(new Request(`http://x/api/aggregate${q}`), ctx);
    for (let i = 0; i < 2; i++) await ingest(post(submission()), ctx);
    let res = await get(`?week=${PAST_WEEK}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    assert.deepEqual(await res.json(), { week: PAST_WEEK, submissions: 2 });

    await ingest(post(submission({ counts: { "skill.atlas-plan": 2, "agent.planner": 1 } })), ctx);
    res = await get(""); // default = last finished week = 2026-W44
    const body = await res.json();
    assert.equal(body.submissions, 3);
    assert.deepEqual(body.counts, { "skill.atlas-plan": { installs: 3, total: 8 } });

    assert.equal((await get("?week=nope")).status, 400);
    assert.equal((await aggregate(post("", "POST"), ctx)).status, 405);
  } finally {
    await done();
  }
});
