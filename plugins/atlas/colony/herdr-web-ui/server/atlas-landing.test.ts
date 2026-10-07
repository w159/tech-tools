import { describe, expect, it } from "bun:test";

import type { Access } from "./access.ts";
import { ATLAS_LANDING_LOCATION, atlasLandingRedirect } from "./atlas-landing.ts";

const full: Access = { level: "full", via: "token", role: "drive" };
const denied: Access = { level: "none", reason: "pairing_required" };
const html = { accept: "text/html,application/xhtml+xml" };
const get = (path: string, headers: Record<string, string> = html, method = "GET") =>
  new Request(`http://127.0.0.1:7317${path}`, { method, headers });

describe("atlas landing", () => {
  it("redirects a plain navigation of / to the dashboard shell", () => {
    const response = atlasLandingRedirect(get("/"), full, {});
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(ATLAS_LANDING_LOCATION);
    expect(ATLAS_LANDING_LOCATION).toBe("/atlas/#/herd");
    expect(atlasLandingRedirect(get("/", { ...html, "sec-fetch-dest": "document" }), full, {})?.status).toBe(302);
    expect(atlasLandingRedirect(get("/?utm=1"), full, {})?.status).toBe(302);
  });

  it("serves the SPA for the embed, iframes and deep links", () => {
    expect(atlasLandingRedirect(get("/?embed=1"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/?embed=0"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/", { ...html, "sec-fetch-dest": "iframe" }), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/?chrome=pane&pane=p_1"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/?chrome=full"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/?pane=p_1"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/?machine=m_1"), full, {})).toBeUndefined();
  });

  it("leaves non-HTML, non-GET and other paths alone", () => {
    expect(atlasLandingRedirect(get("/", { accept: "application/json" }), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/", {}), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/", html, "POST"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/index.html"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/assets/app.js"), full, {})).toBeUndefined();
    expect(atlasLandingRedirect(get("/atlas/"), full, {})).toBeUndefined();
  });

  it("never redirects an unauthenticated request", () => {
    expect(atlasLandingRedirect(get("/"), denied, {})).toBeUndefined();
  });

  it("is switched off by ATLAS_LANDING=off", () => {
    expect(atlasLandingRedirect(get("/"), full, { ATLAS_LANDING: "off" })).toBeUndefined();
    expect(atlasLandingRedirect(get("/"), full, { ATLAS_LANDING: " OFF " })).toBeUndefined();
    expect(atlasLandingRedirect(get("/"), full, { ATLAS_LANDING: "on" })?.status).toBe(302);
  });
});
