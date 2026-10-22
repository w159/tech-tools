import test from "node:test";
import assert from "node:assert/strict";
import { sendSteer, steerTarget, resolveTarget, holdSeat } from "./steer.js";

const reject = (status, data) => async () => {
  throw Object.assign(new Error(data.error || "x"), { status, data });
};

test("steerTarget: no seat is @lead, a seat is @seat, the lead seat is @lead", () => {
  assert.equal(steerTarget(null, "lead-x"), "@lead");
  assert.equal(steerTarget({ name: "impl-a" }, "lead-x"), "@impl-a");
  assert.equal(steerTarget({ name: "lead-x" }, "lead-x"), "@lead");
});

test("resolveTarget: typed @all overrides the chip and is stripped", () => {
  assert.deepEqual(resolveTarget("@all stand down", "@impl-a"), { to: "all", text: "stand down" });
  assert.deepEqual(resolveTarget("hello", "@impl-a"), { to: "impl-a", text: "hello" });
  assert.deepEqual(resolveTarget("hello", "@lead"), { to: "lead", text: "hello" });
});

test("sendSteer posts body (the server field), kind steer, to without @", async () => {
  let seen;
  const r = await sendSteer({ channel: "c@main/l", to: "@impl-a", text: "go" }, async (path, body) => {
    seen = { path, body };
    return { ok: true };
  });
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.path, "/api/v2/channels");
  assert.deepEqual(seen.body, { channel: "c@main/l", to: "impl-a", body: "go", kind: "steer" });
});

test("sendSteer maps a 409 held reply to {ok:false,error} without throwing", async () => {
  const r = await sendSteer({ channel: "c", to: "lead", text: "go" }, reject(409, { error: "held" }));
  assert.deepEqual(r, { ok: false, error: "held" });
});

test("sendSteer maps 401 bad_token and a network failure", async () => {
  assert.deepEqual(
    await sendSteer({ channel: "c", to: "lead", text: "x" }, reject(401, { error: "bad_token" })),
    { ok: false, error: "bad_token" },
  );
  const r = await sendSteer({ channel: "c", to: "lead", text: "x" }, async () => {
    throw new Error("the dashboard daemon is not reachable");
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /not reachable/);
});

test("sendSteer refuses an empty channel or empty text without posting", async () => {
  const never = async () => assert.fail("must not post");
  assert.deepEqual(await sendSteer({ channel: "", to: "lead", text: "x" }, never), { ok: false, error: "no_channel" });
  assert.deepEqual(await sendSteer({ channel: "c", to: "lead", text: "  " }, never), { ok: false, error: "empty" });
});

test("holdSeat posts kind hold to the seat", async () => {
  let body;
  await holdSeat("c", "impl-a", async (_p, b) => ((body = b), { ok: true }));
  assert.equal(body.kind, "hold");
  assert.equal(body.to, "impl-a");
});
