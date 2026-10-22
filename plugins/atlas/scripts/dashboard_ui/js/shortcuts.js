// Keyboard: g-prefixed chords, "/" opens the palette (app.js), "?" for the list. Esc is handled by the layers in ui.js.
import { h } from "./dom.js";
import { Modal, Kbd, Button } from "./ui.js";
import { navigate } from "./router.js";

const CHORDS = {
  o: ["overview", "Overview"],
  a: ["agents", "Agents"],
  b: ["board", "Board"],
  c: ["channels", "Channels"],
  t: ["activity", "Activity"],
  h: ["health", "Health"],
  i: ["improve", "Improve"],
  p: ["projects", "Projects"],
  s: ["settings", "Settings"],
};

const CHORD_WINDOW_MS = 1200;

function typing(el) {
  return (
    !!el &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
      el.isContentEditable ||
      !!el.closest?.(".xterm"))
  );
}

function showShortcuts() {
  const rows = Object.entries(CHORDS).flatMap(([k, [, label]]) => [
    h("span", {}, Kbd("g"), " ", Kbd(k)),
    h("span", {}, `Go to ${label}`),
  ]);
  rows.push(
    h("span", {}, Kbd("/")),
    h("span", {}, "Command palette"),
    h("span", {}, Kbd("Esc")),
    h("span", {}, "Close drawer or dialog"),
    h("span", {}, Kbd("?")),
    h("span", {}, "Show this list"),
  );
  const modal = Modal(
    {
      title: "Keyboard shortcuts",
      footer: Button(
        { variant: "primary", onClick: () => modal.close(), autofocus: true },
        "Close",
      ),
    },
    h("div", { class: "shortcut-list" }, rows),
  );
}

export function initShortcuts() {
  let armed = 0;
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || typing(ev.target)) return;
    if (armed && Date.now() - armed < CHORD_WINDOW_MS && CHORDS[ev.key]) {
      armed = 0;
      ev.preventDefault();
      navigate(CHORDS[ev.key][0]);
      return;
    }
    armed = 0;
    if (ev.key === "g") armed = Date.now();
    else if (ev.key === "?") {
      ev.preventDefault();
      showShortcuts();
    }
  });
}
