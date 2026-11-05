// @ts-check
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEEK_RE = /^\d{4}-W\d{2}$/;
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * put() resolves true when stored and false when the nonce already exists (never overwrites).
 * list() returns parsed submissions for the week.
 * @typedef {{
 *   has(week: string, nonce: string): Promise<boolean>,
 *   put(week: string, nonce: string, json: string): Promise<boolean>,
 *   list(week: string): Promise<unknown[]>
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
    async put(week, nonce, json) {
      checkIds(week, nonce);
      await mkdir(join(dir, week), { recursive: true });
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

  return {
    has,
    async put(week, nonce, json) {
      checkIds(week, nonce);
      const { put } = await sdk();
      try {
        await put(key(week, nonce), json, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
          ...opts,
        });
        return true;
      } catch (err) {
        // The SDK throws a generic BlobError when the pathname is taken; confirm instead of
        // matching on message text.
        if (await has(week, nonce)) return false;
        throw err;
      }
    },
    async list(week) {
      checkIds(week);
      const { list, get } = await sdk();
      const out = [];
      let cursor;
      do {
        const page = await list({ prefix: `submissions/${week}/`, limit: 1000, cursor, ...opts });
        for (const b of page.blobs) {
          const res = await get(b.pathname, { access: "private", useCache: false, ...opts });
          if (!res || res.statusCode !== 200) continue;
          out.push(JSON.parse(await new Response(res.stream).text()));
        }
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

/**
 * @param {unknown} err
 * @param {string} code
 */
function isCode(err, code) {
  return typeof err === "object" && err !== null && /** @type {any} */ (err).code === code;
}
