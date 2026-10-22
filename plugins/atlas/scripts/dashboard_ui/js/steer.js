// Steer bar transport. POST /api/v2/channels -> h_channels_post -> _post (atlas_dash_irc.py:659, :346).
// The server reads the message text from `body` (atlas_dash_irc.py:348: str(b.get("body"))), NOT `text`.
// ponytail: the server ignores `kind` today, so steer and hold are both plain board notes; the kind field
// is sent so a later server change can tell them apart without a client change.
import { post } from "./api.js";

const strip = (to) => String(to || "lead").replace(/^@/, "");

/** "@<seat>" when a seat other than the lead is selected, else "@lead". */
export function steerTarget(selectedSeat, lead) {
  const name = selectedSeat && selectedSeat.name;
  return name && name !== lead ? `@${name}` : "@lead";
}

/** Typed "@all " overrides the chip target; the prefix is stripped from the sent text. */
export function resolveTarget(input, target) {
  const m = /^@all\s+/i.exec(input);
  if (m) return { to: "all", text: input.slice(m[0].length) };
  return { to: strip(target), text: input };
}

async function send(kind, { channel, to, text }, postFn) {
  if (!channel) return { ok: false, error: "no_channel" };
  if (!String(text || "").trim()) return { ok: false, error: "empty" };
  try {
    await postFn("/api/v2/channels", { channel, to: strip(to), body: text, kind });
    return { ok: true };
  } catch (e) {
    // ApiError carries the server envelope in .data; anything else (network) keeps its message.
    return { ok: false, error: (e && e.data && e.data.error) || (e && e.message) || "failed" };
  }
}

/** Never throws: resolves {ok:true} or {ok:false,error}. `postFn` is injectable for tests. */
export const sendSteer = (args, postFn = post) => send("steer", args, postFn);

// fallow-ignore-next-line unused-export -- bound to the `h` key in T7 (keys and palette)
export const holdSeat = (channel, seat, postFn = post) =>
  send("hold", { channel, to: seat, text: "hold" }, postFn);
