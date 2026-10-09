/**
 * Root landing: a plain browser navigation to `/` lands in the Atlas dashboard shell
 * (/atlas/#/herd), which embeds this app on its Colony page.
 *
 * index.ts calls this only after decideAccess, so an unauthenticated request never gets a
 * redirect: it keeps the normal AccessGate/pairing flow. The dashboard frames the app with
 * `?chrome=full` (Herdr console) and `?chrome=pane` (Fleet inspector terminal); those, plus
 * `embed`, `pane` and `machine` queries, skip the redirect and serve the SPA exactly as upstream.
 */
import type { Access } from "./access.ts";

export const ATLAS_LANDING_LOCATION = "/atlas/#/herd";

export function atlasLandingRedirect(
  request: Request,
  access: Access,
  env: Record<string, string | undefined> = process.env,
): Response | undefined {
  if ((env["ATLAS_LANDING"] ?? "").trim().toLowerCase() === "off") return undefined;
  if (access.level !== "full") return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  if (!URL.canParse(request.url)) return undefined;
  const url = new URL(request.url);
  if (url.pathname !== "/") return undefined;
  if (["embed", "pane", "machine", "chrome"].some((key) => url.searchParams.has(key))) return undefined; // chrome=full|pane: the host UI itself
  const dest = request.headers.get("sec-fetch-dest");
  if (dest !== null && dest !== "document") return undefined;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return undefined;
  return new Response(null, { status: 302, headers: { location: ATLAS_LANDING_LOCATION, "cache-control": "no-store" } });
}
