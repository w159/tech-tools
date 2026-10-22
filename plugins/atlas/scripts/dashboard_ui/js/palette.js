// Command palette: mono input + filtered list. No animation (high-frequency action).
const ROUTES = [
  ["run", "Run"], ["agents", "Agents"], ["board", "Board"],
  ["channels", "Channels"], ["health", "Health"], ["settings", "Settings"],
];

// fallow-ignore-next-line unused-export -- consumed by the T7b wiring unit
export function filterCommands(commands, query) {
  const q = (query || "").toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

// fallow-ignore-next-line unused-export -- consumed by the T7b wiring unit
export function defaultCommands({ navigate, steerLead, holdSelected, toggleTheme }) {
  return [
    ...ROUTES.map(([id, name]) => ({ id: `go-${id}`, label: `Go to ${name}`, run: () => navigate(id) })),
    { id: "steer", label: "Steer lead", run: steerLead },
    { id: "hold", label: "Hold selected seat", run: holdSelected },
    { id: "theme", label: "Toggle theme", run: toggleTheme },
  ];
}

// fallow-ignore-next-line unused-export -- consumed by the T7b wiring unit
export function openPalette(commands, { root = document.body, onClose } = {}) {
  if (!root) throw new Error("openPalette: root element is required (document.body is not available)");
  const doc = root.ownerDocument;
  const box = doc.createElement("div");
  box.className = "palette";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Command palette");
  const input = doc.createElement("input");
  input.className = "palette-input mono";
  input.setAttribute("aria-label", "Command");
  const list = doc.createElement("ul");
  list.className = "palette-list";
  list.setAttribute("role", "listbox");
  box.append(input, list);

  let shown = commands;
  let sel = 0;
  const paint = () => {
    list.replaceChildren(...shown.map((c, i) => {
      const li = doc.createElement("li");
      li.textContent = c.label;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === sel));
      if (i === sel) li.className = "is-active";
      li.addEventListener("mousedown", (e) => { e.preventDefault(); run(c); });
      return li;
    }));
  };
  const close = () => {
    if (!box.isConnected) return;
    box.remove();
    onClose?.();
  };
  const run = (c) => { close(); c.run(); };

  input.addEventListener("input", () => {
    shown = filterCommands(commands, input.value);
    sel = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) run(shown[sel]); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      paint();
    }
  });
  paint();
  root.append(box);
  input.focus();
  return { close };
}
