import type { Page } from "playwright-core";

/**
 * Resolves once the page draws the app's own faces (src/fonts/fonts.css) and has laid itself out
 * with them. A browser check measures widths, and both faces are `font-display: swap`: before they
 * arrive the page is drawn in whatever this machine falls back to, which CI's Chrome and a
 * developer's desktop do not share. The Pretendard chunk is fetched only once text needs it
 * (unicode-range), so the load is asked for by sample, then seen on a face of the page.
 */
export async function appFaces(page: Page, sample = "Mg"): Promise<void> {
  await page.waitForFunction(async (text) => {
    await Promise.all([document.fonts.load('15px "Pretendard Variable"', text), document.fonts.load('13px "JetBrains Mono Web"', "Mg")]);
    await document.fonts.ready;
    const loaded = (family: string) => [...document.fonts].some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded");
    return loaded("Pretendard Variable") && loaded("JetBrains Mono Web");
  }, sample, { timeout: 10_000 });
  // the composer measures again in the render an arrival causes: let that frame be drawn
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
