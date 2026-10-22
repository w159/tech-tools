import test from "node:test";
import assert from "node:assert/strict";
import { bindKeys, RUN_KEYS, isTypingIn } from "./keys.js";

function fakeTarget() {
  const ls = new Set();
  return {
    addEventListener: (t, fn) => t === "keydown" && ls.add(fn),
    removeEventListener: (t, fn) => t === "keydown" && ls.delete(fn),
    dispatch(key) {
      const ev = { key, prevented: 0, preventDefault() { this.prevented++; } };
      for (const fn of [...ls]) fn(ev);
      return ev;
    },
    size: () => ls.size,
    listeners: () => [...ls],
  };
}

test("RUN_KEYS lists the TUI keys", () => {
  assert.deepEqual(RUN_KEYS, ["1", "2", "3", "f", "i", "m", "h", "Escape", "/"]);
});

test("handled key calls its handler once and prevents default", () => {
  const target = fakeTarget();
  let n = 0;
  bindKeys({ f: () => n++ }, { isTyping: () => false, target });
  const ev = target.dispatch("f");
  assert.equal(n, 1);
  assert.equal(ev.prevented, 1);
  assert.equal(target.dispatch("x").prevented, 0);
});

test("keys are ignored while typing, Escape is not", () => {
  const target = fakeTarget();
  const hit = [];
  bindKeys({ f: () => hit.push("f"), Escape: () => hit.push("Escape") }, { isTyping: () => true, target });
  target.dispatch("f");
  target.dispatch("Escape");
  assert.deepEqual(hit, ["Escape"]);
});

test("unbind removes the listener", () => {
  const target = fakeTarget();
  let n = 0;
  const unbind = bindKeys({ f: () => n++ }, { isTyping: () => false, target });
  unbind();
  target.dispatch("f");
  assert.equal(n, 0);
  assert.equal(target.size(), 0);
});

test("isTypingIn recognises form fields and contenteditable", () => {
  assert.equal(isTypingIn({ tagName: "INPUT" }), true);
  assert.equal(isTypingIn({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingIn({ tagName: "SELECT" }), true);
  assert.equal(isTypingIn({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingIn({ tagName: "DIV" }), false);
  assert.equal(isTypingIn(null), false);
});

test("modifier chords are ignored and not prevented", () => {
  const target = fakeTarget();
  let n = 0;
  bindKeys({ f: () => n++ }, { isTyping: () => false, target });
  for (const m of ["metaKey", "ctrlKey", "altKey"]) {
    const ev = { key: "f", [m]: true, prevented: 0, preventDefault() { this.prevented++; } };
    for (const fn of target.listeners()) fn(ev);
    assert.equal(ev.prevented, 0);
  }
  assert.equal(n, 0);
});
