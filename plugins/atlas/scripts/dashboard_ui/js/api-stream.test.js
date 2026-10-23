import test from "node:test";
import assert from "node:assert/strict";

test("stream mints a fresh single-use ticket per connect and never puts the token in a URL", async () => {
  const urls = [];
  const posts = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    posts.push({ url, method: init.method });
    const body = String(url).endsWith("/stream/ticket")
      ? { ok: true, ticket: `tkt-${++n}` }
      : { ok: true }; // fallback polls
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sources = [];
  globalThis.EventSource = class {
    constructor(url) {
      urls.push(url);
      sources.push(this);
    }
    addEventListener() {}
    close() {
      this.closed = true;
    }
  };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // collapse the reconnect delay
  const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
  globalThis.document = {
    hidden: false,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  globalThis.CustomEvent = class {};
  const { api } = await import("./api.js");
  let handle;
  try {
    handle = api.stream({ pollMs: 3600000 });
    await wait(30);
    assert.deepEqual(urls, ["/api/v2/stream?ticket=tkt-1"]);
    assert.equal(posts[0].url, "/api/v2/stream/ticket");
    assert.equal(posts[0].method, "POST");
    sources[0].onerror(); // burnt ticket: must reconnect with a new one
    await wait(150);
    assert.equal(sources[0].closed, true);
    assert.deepEqual(urls, [
      "/api/v2/stream?ticket=tkt-1",
      "/api/v2/stream?ticket=tkt-2",
    ]);
    for (const u of urls) assert.ok(!/token=/.test(u), u);
  } finally {
    handle?.close(); // stops timers so node can exit
    globalThis.setTimeout = realSetTimeout;
  }
});
