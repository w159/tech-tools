// The one client path for talking to and stopping a colony member. Every composer (roster row, fleet drawer, channel
// composer) sends through POST colony/<name>/send, which is the only server handler behind the wave gate (pause/cancel
// holds). Stop/Kill is one action: confirm naming the seat, then the identity-checked POST colony/<name>/kill.

import { api as defaultApi } from "./api.js";
import { confirm as defaultConfirm, toast, toastError } from "./ui-overlays.js";

const SKIP = new Set(["finished", "dead", "parked"]);

// sendToSeat({ channel, to, body, project }) -> { ok, delivered, message:{delivery_text} }; throws ApiError on refusal
// (409 member_dead / not_deliverable / wave gate). `to` "all" (or empty) fans out to every live member of the roster.
export async function sendToSeat({ to, body, project }, deps = {}) {
  const api = deps.api || defaultApi;
  if (to && to !== "all") return api.post("colony/" + encodeURIComponent(to) + "/send", { text: body, project });
  const d = await api.get("colony", { project });
  const live = ((d && d.members) || []).filter((m) => !SKIP.has(m.state));
  if (!live.length) return { ok: true, delivered: false, message: { delivery_text: "No live members to receive it" } };
  const rs = await Promise.allSettled(live.map((m) => api.post("colony/" + encodeURIComponent(m.name) + "/send", { text: body, project })));
  const ok = rs.filter((r) => r.status === "fulfilled").length;
  if (!ok) throw rs[0].reason;
  return { ok: true, delivered: rs.some((r) => r.status === "fulfilled" && r.value && r.value.delivered), message: { delivery_text: "Sent to " + ok + " of " + live.length + " members" } };
}
export const sendToMember = (ctx, name, text, deps) => sendToSeat({ to: name, body: text, project: ctx.params.project || ctx.project }, deps);

export const sendToMembers = (ctx, names, text, deps) => Promise.all(names.map((n) => sendToMember(ctx, n, text, deps)));

// 409 member_dead is a normal race (the seat exited since the roster painted): say so instead of a generic failure.
export function killMessage(e, name) {
  return e && e.error === "member_dead" ? name + " is already gone (member_dead): nothing to kill" : null;
}

// Stop / Kill one seat. Resolves true when the kill was sent, false when cancelled or refused.
export async function killSeat({ name, kind, project }, deps = {}) {
  const api = deps.api || defaultApi;
  const ask = deps.confirm || defaultConfirm;
  const ok = await ask({ title: "Kill " + name + "?", body: "Stops this " + (kind || "member") + " and closes its pane. Its unfinished work stays on the board.", danger: true, confirmLabel: "Kill" });
  if (!ok) return false;
  try {
    await api.post("colony/" + encodeURIComponent(name) + "/kill", { project });
    toast(name + " killed", { kind: "ok" });
    return true;
  } catch (e) {
    const msg = killMessage(e, name);
    if (msg) toast(msg, { kind: "warn" });
    else toastError(e, "Could not kill " + name);
    return false;
  }
}

// Pause / Resume / Cancel use the existing colony routes. Cancel asks first; pause and resume are reversible.
const WAVE = { pause: "Paused", resume: "Resumed", cancel: "Canceled" };
export async function waveAction(verb, { name, project }, deps = {}) {
  const api = deps.api || defaultApi;
  const ask = deps.confirm || defaultConfirm;
  if (!WAVE[verb]) throw new Error("unknown wave action " + verb);
  if (verb === "cancel") {
    const ok = await ask({ title: "Cancel " + name + "?", body: "Stops its current work and keeps it resumable. Sends to it are refused until resume.", danger: true, confirmLabel: "Cancel work" });
    if (!ok) return false;
  }
  try {
    await api.post("colony/" + encodeURIComponent(name) + "/" + verb, { project });
    toast(WAVE[verb] + " " + name, { kind: "ok" });
    return true;
  } catch (e) {
    toastError(e, "Could not " + verb + " " + name);
    return false;
  }
}
