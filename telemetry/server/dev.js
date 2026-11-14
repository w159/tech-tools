// @ts-check
// Local server: the same routes as Vercel (ingest, aggregate, health, admin, dashboard) on the filesystem store.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { join } from "node:path";
import { handle as admin } from "./api/admin.js";
import { handle as aggregate } from "./api/aggregate.js";
import { handle as dashboard } from "./api/dashboard.js";
import { handle as health } from "./api/health.js";
import { handle as ingest } from "./api/ingest.js";
import { createFsStore } from "./lib/store.js";

const port = Number(process.env.PORT || 8787);
const store = createFsStore(process.env.TELEMETRY_DATA_DIR || join(process.cwd(), ".data"));

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: /** @type {Record<string, string>} */ (req.headers),
    body: hasBody ? /** @type {any} */ (Readable.toWeb(req)) : undefined,
    // @ts-ignore duplex is required by undici for streamed bodies
    duplex: "half",
  });
  let response;
  if (url.pathname === "/api/ingest") response = await ingest(request, { store });
  else if (url.pathname === "/api/aggregate") response = await aggregate(request, { store });
  else if (url.pathname === "/api/health") response = await health(request, { store });
  else if (url.pathname === "/api/admin") response = await admin(request, { store });
  else if (url.pathname === "/" || url.pathname === "/dashboard") response = await dashboard(request, { store });
  else response = new Response('{"error":"not found"}', { status: 404, headers: { "content-type": "application/json" } });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`atlas-telemetry dev server on http://127.0.0.1:${port}`);
});
