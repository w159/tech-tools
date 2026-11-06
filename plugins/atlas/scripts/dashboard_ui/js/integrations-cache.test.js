import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom } from "./operate-dom-stub.js";
import { api } from "./api.js";

installDom();
const { getHp } = await import("./integrations.js");
restoreDom();

describe("integrations cached reads", () => {
  let savedGet;
  let realNow;
  let now;
  let calls;
  beforeEach(() => {
    savedGet = api.get;
    realNow = Date.now;
    now = realNow() + 1_000_000; // past every entry another file may have written with the real clock
    Date.now = () => now;
    calls = 0;
    api.get = async () => ({ projects: [], n: ++calls });
  });
  afterEach(() => { api.get = savedGet; Date.now = realNow; });

  test("a read inside the ttl is served from the cache, one past it refetches", async () => {
    const first = await getHp(true);
    now += 4_000;
    expect(await getHp()).toBe(first);
    expect(calls).toBe(1);
    now += 2_000;
    expect((await getHp()).n).toBe(2);
  });

  test("an entry stamped in the future (clock stepped back) is not fresh", async () => {
    await getHp(true);
    now -= 500_000;
    expect((await getHp()).n).toBe(2);
    expect(calls).toBe(2);
  });
});
