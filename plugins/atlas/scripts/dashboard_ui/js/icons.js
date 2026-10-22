// Inline SVG icon set: 1.5 stroke, 16px default (pass size 20 for the larger variant). No icon font.
const P = {
  overview:
    '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  agents:
    '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"/>',
  board:
    '<rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="7" rx="1"/><rect x="10.5" y="2.5" width="3.5" height="9" rx="1"/>',
  channels: '<path d="M6 2.5L5 13.5M11 2.5L10 13.5M2.5 6h11M2.5 10h11"/>',
  activity: '<path d="M1.5 8h3l2-5 3 10 2-5h3"/>',
  health:
    '<path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z"/>',
  improve: '<path d="M3 11l3-3 2 2 5-5M9.5 5H13v3.5"/>',
  projects:
    '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  settings:
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  x: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  chevron: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  external:
    '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7"/>',
  play: '<path d="M4.5 3l8 5-8 5z"/>',
  stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"/>',
  moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
  sidebar:
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  check: '<path d="M3 8.5l3.5 3.5L13 4.5"/>',
  alert: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 7v3M8 11.5v.01"/>',
  terminal:
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7l2 1.5L5 10M8.5 10.5H11"/>',
  message: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  task: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5.5 8l2 2 3-3.5"/>',
};

const ICON_NAMES = Object.keys(P);

/** icon(name, size=16) -> SVG element. Unknown names render an empty box so layout holds. */
export function icon(name, size = 16) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = P[name] || "";
  return svg;
}

/** The hex cube brand mark (the only kept Atlas asset). */
export function brandMark() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "brand-mark");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/>';
  return svg;
}
