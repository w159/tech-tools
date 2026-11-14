// @ts-check
// Review fixes: ingest races, FS temp names, header-only token, purge re-check, cache headers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle as admin } from "../api/admin.js";
import { handle as aggregate } from "../api/aggregate.js";
import { handle as health } from "../api/health.js";
import { handle as ingest } from "../api/ingest.js";
import { createFsStore } from "../lib/store.js";
import { ALLOWED, NOW, PAST_WEEK, submission } from "./helpers.js";

const TOKEN = "t0ken-for-tests-only-0123456789";
const post = (/** @type {unknown} */ body) =>
  new Request("http://x/api/ingest", { method: "POST", body: JSON.stringify(body) });
const v3 = (/** @type {Record<string, unknown>} */ over = {}) => submission({ schema: 3, partial: false, ...over });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "atlas-tel-rv-"));
  const store = createFsStore(dir);
  const env = { ATLAS_DASHBOARD_TOKEN: TOKEN };
  return { dir, store, ctx: { store, allowed: ALLOWED, now: NOW, env }, done: () => rm(dir, { recursive: true, force: true }) };
}

test("finding 1: a schema 3 partial never replaces a stored schema 2 final", async () => {
  const { ctx, store, done } = await setup();
  try {
    const nonce = randomUUID();
    assert.equal((await ingest(post(submission({ nonce, counts: { "skill.atlas-plan": 9 } })), ctx)).status, 201);
    const res = await ingest(post(v3({ nonce, partial: true, counts: { "skill.atlas-plan": 1 } })), ctx);
    assert.equal(res.status, 409);
    const kept = /** @type {any} */ ((await store.get(PAST_WEEK, nonce))?.value);
    assert.equal(kept.counts["skill.atlas-plan"], 9);
  } finally {
    await done();
  }
});

test("finding 1: a final that lands between a partial's read and write is not overwritten", async () => {
  const { ctx, store, done } = await setup();
  try {
    const nonce = randomUUID();
    await ingest(post(v3({ nonce, partial: true, counts: { "skill.atlas-plan": 1 } })), ctx);
    const finalBody = v3({ nonce, partial: false, counts: { "skill.atlas-plan": 7 } });
    // The partial reads the old row, then the final lands before the partial's write.
    let injected = false;
    const racing = {
      ...store,
      async get(/** @type {string} */ w, /** @type {string} */ n) {
        const got = await store.get(w, n);
        if (!injected) {
          injected = true;
          assert.equal((await ingest(post(finalBody), { ...ctx, store })).status, 200);
        }
        return got;
      },
    };
    const res = await ingest(post(v3({ nonce, partial: true, counts: { "skill.atlas-plan": 2 } })), { ...ctx, store: racing });
    assert.equal(res.status, 409);
    const kept = /** @type {any} */ ((await store.get(PAST_WEEK, nonce))?.value);
    assert.equal(kept.partial, false);
    assert.equal(kept.counts["skill.atlas-plan"], 7);
  } finally {
    await done();
  }
});

test("finding 1: two first writes cannot clobber each other (create-only, loser re-reads)", async () => {
  const { ctx, store, done } = await setup();
  try {
    const nonce = randomUUID();
    let injected = false;
    const racing = {
      ...store,
      async get(/** @type {string} */ w, /** @type {string} */ n) {
        const got = await store.get(w, n);
        if (!injected) {
          injected = true;
          await ingest(post(v3({ nonce, partial: false, counts: { "skill.atlas-plan": 5 } })), { ...ctx, store });
        }
        return got;
      },
    };
    const res = await ingest(post(v3({ nonce, partial: true, counts: { "skill.atlas-plan": 1 } })), { ...ctx, store: racing });
    assert.equal(res.status, 409);
    assert.equal(/** @type {any} */ ((await store.get(PAST_WEEK, nonce))?.value).counts["skill.atlas-plan"], 5);
  } finally {
    await done();
  }
});

test("finding 1: fs put with ifMatch fails when the row changed, succeeds when it did not", async () => {
  const { store, done } = await setup();
  try {
    const nonce = randomUUID();
    await store.put(PAST_WEEK, nonce, '{"a":1}');
    const first = /** @type {{etag: string}} */ (await store.get(PAST_WEEK, nonce));
    assert.equal(await store.put(PAST_WEEK, nonce, '{"a":2}', { ifMatch: first.etag }), true);
    assert.equal(await store.put(PAST_WEEK, nonce, '{"a":3}', { ifMatch: first.etag }), false);
    assert.equal(await store.put(PAST_WEEK, randomUUID(), '{"a":3}', { ifMatch: first.etag }), false, "no row, no replace");
    assert.deepEqual((await store.get(PAST_WEEK, nonce))?.value, { a: 2 });
  } finally {
    await done();
  }
});

test("finding 2: concurrent overwrites use distinct temp names and leave no temp files", async () => {
  const { dir, store, done } = await setup();
  try {
    const nonce = randomUUID();
    await store.put(PAST_WEEK, nonce, '{"a":0}');
    const names = new Set();
    const writes = Array.from({ length: 8 }, async () => {
      const cur = /** @type {{etag: string}} */ (await store.get(PAST_WEEK, nonce));
      return store.put(PAST_WEEK, nonce, '{"a":1}', { ifMatch: cur.etag });
    });
    let running = true;
    const watcher = (async () => {
      while (running) for (const n of await readdir(join(dir, PAST_WEEK))) if (n.endsWith(".tmp")) names.add(n);
    })();
    const results = await Promise.all(writes);
    running = false;
    await watcher;
    assert.ok(results.filter(Boolean).length >= 1);
    assert.deepEqual((await readdir(join(dir, PAST_WEEK))).filter((n) => n.endsWith(".tmp")), []);
    for (const n of names) assert.match(n, new RegExp(`^\\.${nonce}\\.\\d+\\.[0-9a-f]{12}\\.tmp$`));
  } finally {
    await done();
  }
});

test("finding 3: checkToken accepts only the Authorization header", async () => {
  const { checkToken } = await import("../lib/http.js");
  const env = { ATLAS_DASHBOARD_TOKEN: TOKEN };
  assert.equal(checkToken(new Request("http://x/a", { headers: { authorization: `Bearer ${TOKEN}` } }), env), "ok");
  assert.equal(checkToken(new Request(`http://x/a?token=${TOKEN}`), env), "denied");
  assert.equal(checkToken(new Request(`http://x/a?token=${TOKEN}`, { headers: { authorization: "Bearer nope" } }), env), "denied");
});

test("finding 4: purge re-reads each row and keeps one that is no longer test", async () => {
  const { ctx, store, done } = await setup();
  try {
    const keep = randomUUID();
    const drop = randomUUID();
    await ingest(post(v3({ nonce: keep, test: true, partial: true })), ctx);
    await ingest(post(v3({ nonce: drop, test: true, partial: true })), ctx);
    // After the purge has listed both as test, the first is replaced by a real final submission.
    const stale = {
      ...store,
      async list(/** @type {string} */ w) {
        const rows = await store.list(w);
        if (w !== PAST_WEEK) return rows;
        await ingest(post(v3({ nonce: keep, partial: false })), { ...ctx, store });
        return rows;
      },
    };
    const res = await admin(
      new Request("http://x/api/admin?purge=test", { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }),
      { ...ctx, store: stale },
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, 1);
    assert.ok(await store.get(PAST_WEEK, keep), "the real row survives");
    assert.equal(await store.get(PAST_WEEK, drop), null);
  } finally {
    await done();
  }
});

test("finding 5: health is edge-cacheable for 60 s and still has no secrets", async () => {
  const { ctx, done } = await setup();
  try {
    const res = await health(new Request("http://x/api/health"), ctx);
    assert.equal(res.headers.get("cache-control"), "public, s-maxage=60");
    assert.doesNotMatch(JSON.stringify(await res.json()), new RegExp(TOKEN));
  } finally {
    await done();
  }
});

test("finding 5: aggregate rejects any query parameter other than week", async () => {
  const { ctx, done } = await setup();
  try {
    const ok = await aggregate(new Request(`http://x/api/aggregate?week=${PAST_WEEK}`), ctx);
    assert.equal(ok.status, 200);
    for (const q of ["?cb=1", `?week=${PAST_WEEK}&x=1`, "?token=a"]) {
      const res = await aggregate(new Request(`http://x/api/aggregate${q}`), ctx);
      assert.equal(res.status, 400, q);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal((await aggregate(new Request("http://x/api/aggregate"), ctx)).status, 200);
  } finally {
    await done();
  }
});
