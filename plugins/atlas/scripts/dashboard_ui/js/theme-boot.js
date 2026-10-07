// Runs before the stylesheets paint so a saved light theme, compact density or collapsed rail never flashes
// first, and so the shell mode is known before layout. Keep LOCAL_KEY / RAIL_KEY in sync with app.js.
//   data-shell="framed"  when ?embed=1 or the page is inside a frame (MASTER 4): no rail, a 40px context bar
//   ?theme=dark|light|system and ?density=compact|comfortable override the saved prefs for this load only
(function () {
  var root = document.documentElement;
  var q = new URLSearchParams(location.search);
  var framed = q.get("embed") === "1";
  try {
    framed = framed || window.self !== window.top;
  } catch (_err) {
    framed = true; // cross-origin parent: definitely framed
  }
  root.setAttribute("data-shell", framed ? "framed" : "app");
  try {
    var prefs = JSON.parse(localStorage.getItem("atlas.dashboard.prefs") || "{}") || {};
    var theme = q.get("theme") || prefs.theme;
    var density = q.get("density") || prefs.density;
    if (theme === "dark" || theme === "light" || theme === "system") root.setAttribute("data-theme", theme);
    if (density === "compact" || density === "comfortable") root.setAttribute("data-density", density);
    var rail = localStorage.getItem("atlas.rail");
    if (rail === "collapsed" || rail === "expanded") root.setAttribute("data-rail", rail);
  } catch (_err) {
    // storage blocked: the dark, comfortable defaults in index.html apply
  }
})();
