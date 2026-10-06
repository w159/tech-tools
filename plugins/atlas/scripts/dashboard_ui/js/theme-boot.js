// Runs before the stylesheets paint so a saved light theme or compact density never
// flashes dark/comfortable first. Must stay in sync with LOCAL_KEY in app.js.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem("atlas.dashboard.prefs") || "{}") || {};
    var root = document.documentElement;
    if (prefs.theme === "dark" || prefs.theme === "light" || prefs.theme === "system") root.setAttribute("data-theme", prefs.theme);
    if (prefs.density === "compact" || prefs.density === "comfortable") root.setAttribute("data-density", prefs.density);
  } catch (_err) {
    // storage blocked: the dark, comfortable defaults in index.html apply
  }
})();
