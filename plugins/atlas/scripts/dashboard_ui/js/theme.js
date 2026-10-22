// Theme (dark | light | system) and density. index.html applies the stored theme before first paint.
const KEY = "atlas.theme";

function store(fn) {
  try {
    return fn(localStorage);
  } catch (e) {
    // localStorage can be blocked (private window); the theme then lasts for this page only.
    return null;
  }
}

export function getTheme() {
  return store((s) => s.getItem(KEY)) || "dark";
}

function resolveTheme(choice) {
  if (choice === "system")
    return matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  return choice === "light" ? "light" : "dark";
}

export function applyTheme(choice) {
  document.documentElement.setAttribute("data-theme", resolveTheme(choice));
  store((s) => s.setItem(KEY, choice));
  // Lets the sidebar icon repaint at once instead of waiting for the prefs round trip.
  window.dispatchEvent(new CustomEvent("atlas:theme", { detail: choice }));
}

export function applyDensity(density) {
  document.documentElement.setAttribute(
    "data-density",
    density === "comfortable" ? "comfortable" : "compact",
  );
}

/** Dark -> light -> system -> dark. Returns the new choice. */
function cycleTheme() {
  const next =
    { dark: "light", light: "system", system: "dark" }[getTheme()] || "dark";
  applyTheme(next);
  return next;
}

/** Re-apply when the OS scheme changes and the choice is "system". */
export function watchSystemTheme() {
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}

function setCollapsed(on) {
  if (on) document.documentElement.setAttribute("data-collapsed", "true");
  else document.documentElement.removeAttribute("data-collapsed");
  store((s) => s.setItem("atlas.collapsed", on ? "1" : "0"));
}
