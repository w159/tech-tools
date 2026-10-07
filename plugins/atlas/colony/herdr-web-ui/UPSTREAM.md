# Upstream: herdr-web-ui

| Field   | Value |
|---------|-------|
| Source  | https://github.com/devswha/herdr-web-ui |
| Version | 0.3.52 |
| Pinned sha | `54e5a1f67090cb09552d182e7e30dd0ecc314918` |
| License | MIT (see `LICENSE`; third-party notices in `THIRD_PARTY_NOTICES.md`) |

Vendored unmodified at import; atlas changes are listed under ATLAS-PATCHES below.

## Omitted at import (size budget)

Media-only paths were left out to stay under the repo size budget; otherwise unmodified:

- `site/` (GitHub Pages marketing site, ~22 MB incl. a 16.7 MB mp4)
- `docs/screenshots/`, `docs/media/`, `docs/brand/` (screenshots, GIFs, logo sources)
- `.git/`, `node_modules/`, `dist/`, `.DS_Store`

None are used at runtime. `scripts/build-site.ts` (Pages build only) will not work without `site/`.

## ATLAS-PATCHES

<!-- One bullet per atlas change: path, why, date. Empty = tree is byte-identical to upstream (minus omissions). -->

- NEW `server/atlas-gateway.ts` (+ `atlas-gateway.test.ts`): same-origin proxy of the loopback Atlas dashboard under `/atlas/**`; reuses `decideAccess`/`sameOrigin`/`unauthorizedJson`, adds no auth of its own — 2026-10-07
- NEW `server/atlas-landing.ts` (+ `atlas-landing.test.ts`): `atlasLandingRedirect` answers 302 `/atlas/#/herd` for a plain browser navigation of `/` (GET/HEAD, `Accept: text/html`, no `embed`/`pane`/`machine`/`chrome` query, `Sec-Fetch-Dest` absent or `document`, access level `full`); `ATLAS_LANDING=off` disables it — 2026-10-07
- `server/index.ts`: 5 lines — import `createAtlasGatewayFromEnv` and `atlasLandingRedirect`, build the gateway before `Bun.serve` (throws on a non-loopback `ATLAS_DASHBOARD_URL`), route `atlasGateway.owns(pathname)` to `atlasGateway.handle(request, { access, authenticated })`, then for `pathname === "/"` return `atlasLandingRedirect(request, access)` when set; both sit right after the `/api/` CSRF guard and before the static/SPA fallback, so the access verdict (AccessGate/pairing) always runs first — 2026-10-07
- Framing: no patch. Upstream sends no `X-Frame-Options` or CSP `frame-ancestors` on the SPA, `/assets` or any static path (`server/static.ts`), so the dashboard's same-origin iframe (`/atlas/` and the SPA share the gateway origin) already works; verified with `curl -si` on a throwaway server — 2026-10-07
- NEW `src/lib/atlasBridge.ts` (+ `src/atlas-bridge.test.ts`): `FRAMED`, `retireEmbedParam` (legacy `?embed=1` → `?chrome=pane|full`), `isChromeFull` (`?chrome=full` only counts when framed), `postToParent` (`herdr:selected-pane`, `herdr:attention`) and `onParentMessage` (`atlas:theme`, `atlas:select-pane`), all same-origin only (`event.origin`/`event.source` checked) — 2026-10-07
- `src/App.tsx`: `?chrome=pane` (`PANE_CHROME`) renders only a `.pane-strip` over the terminal/chat; the legacy `?embed=1` is rewritten first; Sign out is hidden inside any non-pane frame (`SHARED_COOKIE_FRAME`); the selection (`herdr:selected-pane`) and the count of panes needing input (`herdr:attention`, via `panesNeedingInput`) are mirrored to the parent and the parent may select a pane (`atlas:select-pane`); a framed pane does not store its selection and keeps its `?pane=` — 2026-10-07
- `src/App.tsx`: `?chrome=full` inside a frame (`CHROME_FULL`) drops `<header>`, the sidebar toggle, `<aside id="workspace-drawer">`/`MachineSidebar` and the scrim (the pane list lives in the Atlas dashboard) and shows a slim `.pane-strip` with the Chat/Terminal switch instead; tabs, dialogs, files and shortcuts stay; a top-level `?chrome=full` shows the normal UI — 2026-10-07
- `src/lib/dagPane.ts` (+ `dagPane.test.ts`): `isSidebarPane` (herdr's sidebar plugin pane: `herdr-sidebar-*` tokens, or label `Sidebar` with no agent), `colonyPanes`, `colonyFallbackPane`; `src/App.tsx`: under `CHROME_FULL` the selection effect replaces a missing or sidebar pane by `colonyFallbackPane` (or none), `selectAdjacentPane` uses `colonyPanes`, the pane-column `TabStrip` moves into the one `.pane-strip.pane-strip-colony` (shown only with 2+ usable panes, else the pane title), an empty `selectedPaneId` shows "No agents running. Start one from Agents." (new key in `i18n.ko|ja|zh.ts`), and `<html data-chrome="full">` is set; `src/styles.css`: `.pane-strip-colony .tab-strip` flattened into the strip, `html[data-chrome="full"]:not([data-keyboard]) .key-bar { display: none }` — 2026-10-07
- `src/lib/settings.ts`: `?theme=dark|light` pins this window's theme (nothing saved) and `atlas:theme` from the same-origin parent re-pins it without a reload — 2026-10-07
- `src/components/DevicesPanel.tsx`: no Revoke button for the current device while framed (it would drop the cookie the whole Atlas shell shares) — 2026-10-07
- `src/styles.css`: new `.pane-strip` / `.pane-strip-title` rules after `.app` — 2026-10-07
- `public/sw.js` (cache `v4` → `v5` → `v6`): every older cache is deleted at activation (v4 held `/atlas/` as `/`), `/atlas/**` navigations and top-level navigations to exactly `/` (any query) are never handled — the worker's own `fetch(request)` is not a document navigation to `server/atlas-landing.ts`, so the landing 302 was lost once the worker controlled the origin — the offline shell is kept per other path, and a notification click opens `/atlas/#/herdr?pane=…[&machine=…]` and picks a herdr page rather than the Atlas shell — 2026-10-07
- `src/pwa.test.ts`, `src/pwa-notification.test.ts`: follow the `sw.js` change (v5 poisoned-cache and `/atlas/` test; Atlas notification-target URLs; clients carry `url`/`frameType`) — 2026-10-07

## Update procedure

1. `git clone https://github.com/devswha/herdr-web-ui /tmp/herdr-src/herdr-web-ui && git -C /tmp/herdr-src/herdr-web-ui checkout <new-sha>`
2. Re-sync, keeping omissions:
   `rsync -a --delete --exclude=.git --exclude=node_modules --exclude=dist --exclude=.DS_Store --exclude=/site --exclude=/docs/screenshots --exclude=/docs/media --exclude=/docs/brand --exclude=/UPSTREAM.md /tmp/herdr-src/herdr-web-ui/ plugins/atlas/colony/herdr-web-ui/`
3. Re-apply every entry listed under ATLAS-PATCHES (diff first with `git diff plugins/atlas/colony/herdr-web-ui`); resolve conflicts.
4. Update the version and pinned sha above; check `THIRD_PARTY_NOTICES.md` and `LICENSE` still ship.
5. Verify that `herdr-plugin.toml` still matches the herdr protocol in `../herdr/PIN.json` (`min_protocol`).
6. Run `bun test` in this directory after `bun install` (never commit `node_modules/` or `dist/`).
