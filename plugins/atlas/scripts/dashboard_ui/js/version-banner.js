// Sticky "Dashboard updated" banner: the page knows the version it was served with (meta atlas-version,
// else the first /api/health) and polls health; a different version means the daemon was upgraded under it.
import { h } from "./dom.js";

const metaVersion = () => {
  const m = typeof document !== "undefined" && document.querySelector('meta[name="atlas-version"]');
  const v = m ? m.getAttribute("content") || "" : "";
  return v && v !== "__ATLAS_VERSION__" ? v : "";
};

export function watchVersion({ probe, mount, reload = () => location.reload(), ms = 30000, known = metaVersion() }) {
  let banner = null;
  const tick = async () => {
    const p = await probe();
    const v = p && p.up && p.data && p.data.version;
    if (!v) return;
    if (!known) { known = v; return; }
    if (v === known || banner) return;
    banner = h("div", { class: "update-banner", role: "status" }, h("span", {}, "Dashboard updated to " + v + " — "), h("button", { class: "btn", type: "button", onClick: reload }, "Reload"));
    mount(banner);
  };
  tick();
  const t = setInterval(() => { if (!(typeof document !== "undefined" && document.hidden)) tick(); }, ms);
  return { tick, stop: () => clearInterval(t) };
}
