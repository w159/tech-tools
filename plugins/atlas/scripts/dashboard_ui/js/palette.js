// Command palette: mono input + filtered list. No animation (high-frequency action).
const ROUTES = [
  ["run", "Run"], ["agents", "Agents"], ["board", "Board"],
  ["channels", "Channels"], ["health", "Health"], ["settings", "Settings"],
];

export function filterCommands(commands, query) {
  const q = (query || "").toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

export function defaultCommands({ navigate, steerLead, holdSelected, toggleTheme }) {
  return [
    ...ROUTES.map(([id, name]) => ({ id: `go-${id}`, label: `Go to ${name}`, run: () => navigate(id) })),
    { id: "steer", label: "Steer lead", run: steerLead },
    { id: "hold", label: "Hold selected seat", run: holdSelected },
    { id: "theme", label: "Toggle theme", run: toggleTheme },
  ];
}

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
  const step = (dir) => {
    if (shown.length) sel = (sel + dir + shown.length) % shown.length;
    paint();
  };
  const KEYS = {
    Escape: close,
    Enter: () => shown[sel] && run(shown[sel]),
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
  };
  input.addEventListener("keydown", (e) => {
    if (!KEYS[e.key]) return;
    e.preventDefault();
    KEYS[e.key]();
  });
  paint();
  root.append(box);
  input.focus();
  return { close };
}
