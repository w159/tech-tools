// Native herdr workspace / tab / pane actions (create, rename, close, send keys) through the herdr host's own
// same-origin /api/workspace|tab|pane/* routes. They only exist when Atlas is served through the host gateway
// (<meta name="atlas-base" content="/atlas">): the page origin is then the host. Standalone, every action says so
// honestly and points at Colony instead of failing silently. Roles are enforced by the host: a view-only
// device gets its own 403 text, shown as is.

import { h } from "./dom.js";
import { ApiError } from "./api.js";
import { agentsStore } from "./agents-store.js";
import { Input, Button } from "./ui-core.js";
import { Modal, openModal, closeModal, toast, toastError } from "./ui-overlays.js";

const PREFIX = ((document.querySelector('meta[name="atlas-base"]') || {}).content || "").replace(/\/+$/, "");

/** true when same-origin host routes are reachable (Atlas served under the gateway). */
export const hostReachable = () => Boolean(PREFIX);

export async function hostPost(path, body) {
  if (!PREFIX) throw new ApiError(0, "Needs the herdr host address", "Atlas is open on its own port, so the herdr host's workspace routes are on another origin.", "Open Atlas through the herdr web UI address (/atlas/) or use Colony.");
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin", body: JSON.stringify(body || {}) });
  } catch (_err) {
    throw new ApiError(0, "Cannot reach the herdr host", "The terminal service did not answer.", "Recheck from Colony.");
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_err) {
    data = {};
  }
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText, data.message || data.why || (res.status === 403 ? "This device is view-only on the herdr host." : ""), data.do || "");
  return data;
}

async function run(label, path, body) {
  try {
    const res = await hostPost(path, body);
    toast(label, { kind: "ok" });
    agentsStore.refresh(["herd"]);
    return res;
  } catch (e) {
    toastError(e, "Could not " + label.charAt(0).toLowerCase() + label.slice(1));
    return null;
  }
}

function confirm({ title, body, action, onYes }) {
  openModal(Modal({ title, children: [h("p", null, body)], actions: [Button({ label: "Cancel", onClick: () => closeModal() }), Button({ label: action, variant: "danger", onClick: async () => { closeModal(); await onYes(); } })] }));
}

function prompt({ title, label, value, action, onSubmit, extra }) {
  const field = Input({ label, value: value || "" });
  const input = () => field.querySelector("input");
  const go = async () => {
    const v = input().value.trim();
    closeModal();
    await onSubmit(v);
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  openModal(Modal({ title, children: [field, ...(extra || [])], actions: [Button({ label: "Cancel", onClick: () => closeModal() }), Button({ label: action, variant: "primary", onClick: go })] }));
  setTimeout(() => input().focus(), 0);
}

export function newWorkspace(defaultCwd) {
  const cwd = Input({ label: "Directory", value: defaultCwd || "", placeholder: "/path/to/project", hint: "Leave empty for herdr's default." });
  prompt({
    title: "New workspace",
    label: "Name",
    action: "Create",
    extra: [cwd],
    onSubmit: (label) => run("Workspace created", "/api/workspace/create", { ...(label ? { label } : {}), ...(cwd.querySelector("input").value.trim() ? { cwd: cwd.querySelector("input").value.trim() } : {}) }),
  });
}

export const newTab = (workspaceId) => run("Tab created", "/api/tab/create", { workspace_id: workspaceId });

export function renameWorkspace(id, current) {
  prompt({ title: "Rename workspace", label: "Name", value: current, action: "Rename", onSubmit: (label) => (label ? run("Workspace renamed", "/api/workspace/rename", { workspace_id: id, label }) : null) });
}
export function renameTab(id, current) {
  prompt({ title: "Rename tab", label: "Name", value: current, action: "Rename", onSubmit: (label) => (label ? run("Tab renamed", "/api/tab/rename", { tab_id: id, label }) : null) });
}
export function renamePane(id, current) {
  prompt({ title: "Rename pane", label: "Name", value: current, action: "Rename", onSubmit: (label) => run("Pane renamed", "/api/pane/rename", { pane_id: id, label }) });
}

export function closeWorkspace(id, name) {
  confirm({ title: "Close workspace " + name + "?", body: "Every tab and pane in it closes, and any agent running there stops.", action: "Close workspace", onYes: () => run("Workspace closed", "/api/workspace/close", { workspace_id: id }) });
}
export function closeTab(id, name) {
  confirm({ title: "Close tab " + name + "?", body: "Every pane in this tab closes, and any agent running there stops.", action: "Close tab", onYes: () => run("Tab closed", "/api/tab/close", { tab_id: id }) });
}
export function closePane(id, name) {
  confirm({ title: "Close pane " + name + "?", body: "The pane closes and any agent running in it stops.", action: "Close pane", onYes: () => run("Pane closed", "/api/pane/close", { pane_id: id }) });
}

// Named keys for the inspector's keys row: the names herdr-web-ui's own key bar sends.
export const QUICK_KEYS = [["Enter", ["Enter"]], ["Esc", ["Escape"]], ["Tab", ["Tab"]], ["Up", ["ArrowUp"]], ["Down", ["ArrowDown"]]];
export const sendKeys = (paneId, keys) => run("Sent " + keys.join(" "), "/api/pane/keys", { pane_id: paneId, keys });

// Focus a pane. The host has no focus route, so "focus" is what the Fleet already does: a pane Atlas lists opens in the
// inspector's Terminal tab; an unlisted pane (a herdr-projects thread whose agent has not reported) opens in the Herdr
// console deep link. Never silent: no pane id is a toast, not a no-op.
export function focusPane(paneId) {
  if (!paneId) return toast("This item has no live pane", { kind: "warn", why: "Its agent has not started or has exited." });
  const rec = agentsStore.get(paneId);
  location.hash = rec ? "#/agents?agent=" + encodeURIComponent(rec.key) + "&tab=terminal" : "#/herdr?pane=" + encodeURIComponent(paneId);
}
