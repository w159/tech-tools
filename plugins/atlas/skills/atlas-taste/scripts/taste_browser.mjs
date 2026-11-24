#!/usr/bin/env node
// atlas-taste computed-style audit. OPTIONAL and gated: it starts a browser, so it refuses to run
// unless the caller passes --allow-browser, and SKILL.md says to ask the user every time first.
//
// usage: node taste_browser.mjs <url> --allow-browser --tokens <tokens.css> [--widths 375,768,1280]
// Loads the page at each width, collects computed colors, border radii, font sizes and spacing,
// flags values that are not in the project's CSS custom properties, and flags horizontal overflow.
// Exit: 0 clean, 1 findings, 2 usage or missing browser library, 3 refused (no --allow-browser).

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (!argv.includes("--allow-browser")) {
  console.error("atlas-taste: the browser check needs the user's permission; ask, then pass --allow-browser");
  process.exit(3);
}

const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const url = argv.find((a) => /^https?:\/\//.test(a));
const tokensPath = flag("--tokens");
const widths = flag("--widths", "375,768,1280").split(",").map(Number).filter(Boolean);
if (!url || !tokensPath) {
  console.error("usage: taste_browser.mjs <url> --allow-browser --tokens <tokens.css> [--widths 375,768,1280]");
  process.exit(2);
}

// Token values come only from the project's own CSS custom properties (var-to-var chains resolve below).
const tokenText = readFileSync(tokensPath, "utf8");
const raw = Object.fromEntries([...tokenText.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
const norm = (v) => v.trim().toLowerCase().replace(/\s+/g, "");
const allowed = new Set(Object.values(raw).map(norm));
// ponytail: only literal token values are known; colors defined as hex compare after the browser's rgb() form is normalized below.
const hexToRgb = (h) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const n = parseInt(s, 16);
  return `rgb(${n >> 16},${(n >> 8) & 255},${n & 255})`;
};
for (const v of Object.values(raw)) {
  const rgb = hexToRgb(v);
  if (rgb) allowed.add(rgb);
}

let launcher;
for (const lib of ["playwright", "puppeteer"]) {
  try {
    launcher = (await import(lib)).chromium ?? (await import(lib)).default;
    break;
  } catch {
    /* try the next one the project may already have */
  }
}
if (!launcher) {
  console.error("atlas-taste: neither playwright nor puppeteer is installed in this project; ask the user before adding one");
  process.exit(2);
}

// Runs inside the page via page.evaluate, so the helpers are nested: nothing outside collect is visible there.
const collect = () => {
  const out = { color: new Map(), radius: new Map(), fontSize: new Map(), spacing: new Map() };
  const label = (el) => el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "");
  const bump = (m, v, el) => v && m.set(v, m.get(v) ?? label(el));
  const colorProps = (cs) => {
    const props = ["color"];
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") props.push("backgroundColor");
    if (cs.borderTopWidth !== "0px") props.push("borderTopColor");
    return props;
  };
  const isSpace = (v) => v && v !== "0px" && v !== "normal" && v !== "auto";
  const spaceProps = ["paddingTop", "paddingLeft", "marginTop", "marginLeft", "rowGap", "columnGap"];
  const bumpSpacing = (cs, el) => {
    for (const p of spaceProps) if (isSpace(cs[p])) bump(out.spacing, cs[p], el);
  };
  const sample = (el) => {
    const cs = getComputedStyle(el);
    for (const p of colorProps(cs)) bump(out.color, cs[p], el);
    if (cs.borderTopLeftRadius !== "0px") bump(out.radius, cs.borderTopLeftRadius, el);
    bump(out.fontSize, cs.fontSize, el);
    bumpSpacing(cs, el);
  };
  document.querySelectorAll("body *").forEach(sample);
  const de = document.documentElement;
  return { ...Object.fromEntries(Object.entries(out).map(([k, m]) => [k, [...m]])), overflow: de.scrollWidth > de.clientWidth };
};

const browser = await launcher.launch();
let findings = 0;
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: "load" });
    const r = await page.evaluate(collect);
    if (r.overflow) {
      console.log(`FAIL ${width}px horizontal overflow`);
      findings++;
    }
    for (const [kind, list] of Object.entries(r)) {
      if (!Array.isArray(list)) continue;
      for (const [value, where] of list) {
        if (!allowed.has(norm(value)) && !allowed.has(norm(value.replace(/(\.\d+)?px$/, "px")))) {
          console.log(`${kind === "color" ? "FAIL" : "WARN"} ${width}px ${kind} ${value} is not a token value (first seen on ${where})`);
          if (kind === "color") findings++;
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(findings ? 1 : 0);
