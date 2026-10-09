import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const publicDir = join(import.meta.dir, "..", "public");

/** Runs public/sw.js against a stand-in `self` and returns its fetch listener. */
function serviceWorkerFetch(): (request: { method: string; url: string; mode: string }) => boolean {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = { location: { origin: "https://app.test" }, addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) };
  const caches = { match: async () => new Response("cached"), open: async () => ({ match: async () => undefined, put: async () => undefined }) };
  const fetch = async () => new Response("network");
  new Function("self", "caches", "fetch", readFileSync(join(publicDir, "sw.js"), "utf8"))(self, caches, fetch);
  const listener = listeners.get("fetch")!;
  return (request) => {
    let answered = false;
    listener({ request, respondWith: () => { answered = true; }, waitUntil: () => undefined });
    return answered;
  };
}

describe("installed app", () => {
  it("leaves the screen orientation to the device's rotation lock", () => {
    // Chrome for Android before mid-2026 ran an `orientation: "any"` app full-sensor,
    // rotating it even with auto-rotate off; no orientation follows the system setting
    const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.webmanifest"), "utf8")) as Record<string, unknown>;
    expect(manifest["orientation"]).toBeUndefined();
  });

  it("rereads the web manifest from the network while static assets stay cache-first", () => {
    const answers = serviceWorkerFetch();
    const get = (path: string) => ({ method: "GET", url: `https://app.test${path}`, mode: "no-cors" });
    expect(answers(get("/manifest.webmanifest"))).toBe(false);
    expect(answers(get("/icons/icon-192.png?v=ram1"))).toBe(true);
    expect(answers(get("/assets/index-abc123.js"))).toBe(true);
  });
});

type WorkerRequest = { method: string; url: string; mode: string };

/** public/sw.js over a stand-in CacheStorage and a network that can be cut. */
function serviceWorker(stored: Record<string, Record<string, string>>) {
  const origin = "https://app.test";
  const keyOf = (request: string | WorkerRequest): string => (typeof request === "string" ? request : request.url.slice(origin.length));
  const store = new Map(Object.entries(stored).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const cacheOf = (entries: Map<string, string>) => ({
    match: async (request: string | WorkerRequest) => (entries.has(keyOf(request)) ? new Response(entries.get(keyOf(request))) : undefined),
    put: async (request: string | WorkerRequest, response: Response) => { await disk.ready; entries.set(keyOf(request), await response.text()); },
  });
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      return cacheOf(store.get(name)!);
    },
    // every cache, oldest first, as the browser's does
    match: async (request: string | WorkerRequest) => {
      for (const entries of store.values()) if (entries.has(keyOf(request))) return new Response(entries.get(keyOf(request)));
      return undefined;
    },
  };
  /** `ready` is awaited by every write: a test replaces it to hold the cache back. */
  const disk = { ready: Promise.resolve() as Promise<void> };
  const network = { online: true, shell: "shell", status: 200, fetched: [] as string[] };
  const fetch = async (request: WorkerRequest) => {
    if (!network.online) throw new TypeError("Failed to fetch");
    network.fetched.push(keyOf(request));
    const response = request.mode === "navigate" ? new Response(network.shell, { status: network.status }) : new Response(`network ${keyOf(request)}`);
    // a same-origin answer, which is all the worker keeps
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = { location: { origin }, clients: { claim: async () => undefined }, skipWaiting: () => undefined, addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) };
  new Function("self", "caches", "fetch", readFileSync(join(publicDir, "sw.js"), "utf8"))(self, caches, fetch);
  /** The answer as the page gets it, and `kept`: everything the worker asked to stay alive for. */
  const fire = (type: string, event: Record<string, unknown> = {}): { answer: Promise<Response> | undefined; kept: () => Promise<void> } => {
    let answer: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, respondWith: (response: Promise<Response>) => { answer = response; }, waitUntil: (work: Promise<unknown>) => { waits.push(work); } });
    // a wait may be added while the answer is made, so the list is read again until it is still
    const kept = async (): Promise<void> => { for (let seen = -1; seen !== waits.length;) { seen = waits.length; await Promise.all(waits); } };
    return { answer, kept };
  };
  const dispatch = async (type: string, event: Record<string, unknown> = {}): Promise<Response | undefined> => {
    const { answer, kept } = fire(type, event);
    const response = await answer;
    await kept();
    return response;
  };
  const text = async (request: WorkerRequest): Promise<string | null> => {
    // a rejected answer is what the page sees as a network error
    const response = await dispatch("fetch", { request }).catch(() => undefined);
    const body = response === undefined || response.type === "error" ? null : await response.text();
    // an asset is kept without holding its answer back
    await new Promise((done) => setTimeout(done, 0));
    return body;
  };
  return {
    network,
    disk,
    fire: (path = "/") => fire("fetch", { request: { method: "GET", url: `${origin}${path}`, mode: "navigate" } }),
    names: () => [...store.keys()],
    entries: (name: string) => [...(store.get(name)?.keys() ?? [])],
    update: async () => { await dispatch("install"); await dispatch("activate"); },
    navigate: (path = "/") => text({ method: "GET", url: `${origin}${path}`, mode: "navigate" }),
    get: (path: string) => text({ method: "GET", url: `${origin}${path}`, mode: "no-cors" }),
    /** an asset request as fired, its answer apart from what the worker keeps alive for it */
    ask: (path: string) => fire("fetch", { request: { method: "GET", url: `${origin}${path}`, mode: "no-cors" } }),
  };
}

describe("a service worker under a new cache name", () => {
  const sw = readFileSync(join(publicDir, "sw.js"), "utf8");
  const current = /const CACHE_NAME = "([^"]+)"/.exec(sw)![1]!;
  const before = "herdr-web-ui-v5-ram";
  const old = () => ({ [before]: { "/herdr": "old shell", "/assets/index-old.js": "old bundle" } });

  it("is v6, past the v5 worker that answered '/' itself", () => {
    expect(current).toBe("herdr-web-ui-v6-ram");
  });

  it("deletes every older cache at activation and carries nothing of the old build over", async () => {
    const worker = serviceWorker({ ...old(), "herdr-web-ui-v4-ram": { "/": "atlas html" } });
    await worker.update();
    expect(worker.names()).toEqual([]);
    worker.network.online = false;
    expect(await worker.navigate("/herdr")).toBeNull();
    expect(await worker.get("/assets/index-old.js")).toBeNull();
  });

  it("keeps the shell of a non-root path for offline starts, and its bundles file by file", async () => {
    const worker = serviceWorker(old());
    await worker.update();
    worker.network.shell = "new shell";
    expect(await worker.navigate("/herdr")).toBe("new shell");
    expect(worker.names()).toEqual([current]);
    expect(worker.entries(current)).toEqual(["/herdr"]);
    expect(await worker.get("/assets/index-new.js")).toBe("network /assets/index-new.js");
    expect(worker.entries(current)).toEqual(["/herdr", "/assets/index-new.js"]);
    worker.network.online = false;
    expect(await worker.navigate("/herdr")).toBe("new shell");
    expect(await worker.get("/assets/index-new.js")).toBe("network /assets/index-new.js");
    expect(await worker.get("/assets/index-old.js")).toBeNull();
  });

  it("gives the page its shell without waiting for the copy to be kept", async () => {
    const worker = serviceWorker({});
    await worker.update();
    worker.network.shell = "new shell";
    let written = (): void => undefined;
    worker.disk.ready = new Promise<void>((done) => { written = done; });
    const { answer, kept } = worker.fire("/herdr");
    // the answer settles while the write is still held
    expect(await (await answer)!.text()).toBe("new shell");
    expect(worker.entries(current)).toEqual([]);
    written();
    await kept();
    expect(worker.entries(current)).toEqual(["/herdr"]);
  });

  it("keeps nothing of a navigation the server refused", async () => {
    const worker = serviceWorker({});
    await worker.update();
    worker.network.shell = "sign in";
    worker.network.status = 401;
    expect(await worker.navigate("/herdr")).toBe("sign in");
    expect(worker.entries(current)).toEqual([]);
  });

  it("has no shell to give a device that never loaded the app online", async () => {
    const worker = serviceWorker({});
    await worker.update();
    worker.network.online = false;
    expect(await worker.navigate("/herdr")).toBeNull();
  });
});

describe("a service worker on an origin that lands '/' in Atlas and also serves /atlas/", () => {
  it("leaves '/' (any query) and /atlas/ navigations to the browser, so the server's 302 is honoured", async () => {
    const worker = serviceWorker({ "herdr-web-ui-v4-ram": { "/": "atlas html" } });
    await worker.update();
    expect(worker.names()).not.toContain("herdr-web-ui-v4-ram");
    for (const path of ["/", "/?chrome=full", "/?pane=p_1", "/?embed=1", "/atlas/", "/atlas", "/atlas/#/herdr"]) {
      const { answer, kept } = worker.fire(path);
      expect(answer).toBeUndefined();
      await kept();
    }
    expect(worker.network.fetched).toEqual([]);
    expect(worker.names()).toEqual([]);
  });

  it("still answers other navigations, and '/' as a non-navigation request is unchanged", async () => {
    const worker = serviceWorker({});
    await worker.update();
    worker.network.shell = "herdr shell";
    expect(await worker.navigate("/herdr")).toBe("herdr shell");
    expect(worker.entries(worker.names()[0]!)).toEqual(["/herdr"]);
    worker.network.online = false;
    expect(await worker.navigate("/herdr")).toBe("herdr shell");
    // not a navigation, so the root-path rule does not apply (and it is not a cache-first path either)
    expect((await worker.ask("/")).answer).toBeUndefined();
  });
});
