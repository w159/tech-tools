// @ts-check
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEEK_RE = /^\d{4}-W\d{2}$/;
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * put() resolves true when stored and false when the nonce already exists (create-only); with
 * {ifMatch: etag} it replaces the stored value only while its etag still matches (schema 3
 * week-to-date snapshots) and resolves false when the value changed or vanished meanwhile.
 * get() returns {value, etag} (the parsed submission and its version token) or null.
 * list() returns parsed submissions for the week. del() removes one and resolves true if it existed.
 * @typedef {{
 *   has(week: string, nonce: string): Promise<boolean>,
 *   get(week: string, nonce: string): Promise<{value: unknown, etag: string} | null>,
 *   put(week: string, nonce: string, json: string, opts?: {ifMatch?: string}): Promise<boolean>,
 *   list(week: string): Promise<unknown[]>,
 *   del(week: string, nonce: string): Promise<boolean>
 * }} Store
 */

/**
 * @param {string} week
 * @param {string} [nonce]
 */
function checkIds(week, nonce) {
  if (!WEEK_RE.test(week)) throw new Error("invalid week");
  if (nonce !== undefined && !NONCE_RE.test(nonce)) throw new Error("invalid nonce");
}

/**
 * Filesystem backend: <dir>/<week>/<nonce>.json.
 * @param {string} dir
 * @returns {Store}
 */
export function createFsStore(dir) {
  return {
    async has(week, nonce) {
      checkIds(week, nonce);
      try {
        await readFile(join(dir, week, `${nonce}.json`));
        return true;
      } catch (err) {
        if (isCode(err, "ENOENT")) return false;
        throw err;
      }
    },
    async get(week, nonce) {
      checkIds(week, nonce);
      try {
        const text = await readFile(join(dir, week, `${nonce}.json`), "utf8");
        return { value: JSON.parse(text), etag: contentEtag(text) };
      } catch (err) {
        if (isCode(err, "ENOENT")) return null;
        throw err;
      }
    },
    async del(week, nonce) {
      checkIds(week, nonce);
      try {
        await unlink(join(dir, week, `${nonce}.json`));
        return true;
      } catch (err) {
        if (isCode(err, "ENOENT")) return false;
        throw err;
      }
    },
    async put(week, nonce, json, opts = {}) {
      checkIds(week, nonce);
      await mkdir(join(dir, week), { recursive: true });
      if (opts.ifMatch !== undefined) {
        const target = join(dir, week, `${nonce}.json`);
        const tmp = join(dir, week, `.${nonce}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        await writeFile(tmp, json);
        // Compare and swap with no await between them, so no other request in this process interleaves.
        try {
          if (contentEtag(readFileSync(target, "utf8")) !== opts.ifMatch) throw new PreconditionFailed();
          renameSync(tmp, target);
          return true;
        } catch (err) {
          await unlink(tmp).catch(() => {});
          if (err instanceof PreconditionFailed || isCode(err, "ENOENT")) return false;
          throw err;
        }
      }
      try {
        await writeFile(join(dir, week, `${nonce}.json`), json, { flag: "wx" });
        return true;
      } catch (err) {
        if (isCode(err, "EEXIST")) return false;
        throw err;
      }
    },
    async list(week) {
      checkIds(week);
      let names;
      try {
        names = await readdir(join(dir, week));
      } catch (err) {
        if (isCode(err, "ENOENT")) return [];
        throw err;
      }
      const out = [];
      for (const name of names.sort()) {
        if (!name.endsWith(".json")) continue;
        out.push(JSON.parse(await readFile(join(dir, week, name), "utf8")));
      }
      return out;
    },
  };
}

/**
 * Vercel Blob backend: private blobs at submissions/<week>/<nonce>.json, no random suffix,
 * allowOverwrite false. The package is imported lazily so tests and local runs do not need it.
 * @param {string} [token] defaults to BLOB_READ_WRITE_TOKEN via the SDK
 * @returns {Store}
 */
export function createBlobStore(token) {
  const opts = token ? { token } : {};
  const key = (/** @type {string} */ week, /** @type {string} */ nonce) => `submissions/${week}/${nonce}.json`;
  const sdk = () => import("@vercel/blob");

  /** @type {Store["has"]} */
  async function has(week, nonce) {
    checkIds(week, nonce);
    const { list } = await sdk();
    const pathname = key(week, nonce);
    const res = await list({ prefix: pathname, limit: 5, ...opts });
    return res.blobs.some((b) => b.pathname === pathname);
  }

  /**
   * @param {string} pathname
   * @returns {Promise<{value: unknown, etag: string} | null>}
   */
  async function read(pathname) {
    const { get } = await sdk();
    const res = await get(pathname, { access: "private", useCache: false, ...opts });
    if (!res || res.statusCode !== 200) return null;
    return { value: JSON.parse(await new Response(res.stream).text()), etag: res.blob.etag };
  }

  return {
    has,
    async get(week, nonce) {
      checkIds(week, nonce);
      if (!(await has(week, nonce))) return null;
      return read(key(week, nonce));
    },
    async del(week, nonce) {
      checkIds(week, nonce);
      if (!(await has(week, nonce))) return false;
      const { del } = await sdk();
      await del(key(week, nonce), { ...opts });
      return true;
    },
    async put(week, nonce, json, putOpts = {}) {
      checkIds(week, nonce);
      const { put, BlobPreconditionFailedError } = await sdk();
      const conditional = putOpts.ifMatch !== undefined;
      try {
        await put(key(week, nonce), json, {
          access: "private",
          addRandomSuffix: false,
          // ifMatch implies allowOverwrite in the SDK; a create stays create-only.
          allowOverwrite: false,
          ...(conditional ? { ifMatch: putOpts.ifMatch } : {}),
          contentType: "application/json",
          cacheControlMaxAge: 60,
          ...opts,
        });
        return true;
      } catch (err) {
        if (conditional) {
          if (err instanceof BlobPreconditionFailedError) return false;
          throw err;
        }
        // The SDK throws a generic BlobError when the pathname is taken; confirm instead of
        // matching on message text.
        if (await has(week, nonce)) return false;
        throw err;
      }
    },
    async list(week) {
      checkIds(week);
      const { list } = await sdk();
      const out = [];
      let cursor;
      do {
        const page = await list({ prefix: `submissions/${week}/`, limit: 1000, cursor, ...opts });
        // Read a page's blobs in parallel; a dashboard spans ten weeks.
        const docs = await Promise.all(page.blobs.map((b) => read(b.pathname).catch(() => null)));
        for (const d of docs) if (d) out.push(d.value);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

/**
 * BLOB_READ_WRITE_TOKEN present -> Blob, else filesystem under TELEMETRY_DATA_DIR.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Store}
 */
export function createStore(env = process.env) {
  if (env.BLOB_READ_WRITE_TOKEN) return createBlobStore(env.BLOB_READ_WRITE_TOKEN);
  return createFsStore(env.TELEMETRY_DATA_DIR || join(process.cwd(), ".data"));
}

/** FS version token: a hash of the stored text, so any rewrite with different content changes it. */
const contentEtag = (/** @type {string} */ text) => createHash("sha256").update(text, "utf8").digest("hex");

class PreconditionFailed extends Error {}

/**
 * @param {unknown} err
 * @param {string} code
 */
function isCode(err, code) {
  return typeof err === "object" && err !== null && /** @type {any} */ (err).code === code;
}
