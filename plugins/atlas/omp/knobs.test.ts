import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atlasKnob, atlasStoreEnv } from "./knobs";

let home: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.ATLAS_HOME;
	home = mkdtempSync(join(tmpdir(), "knobs-test-"));
	process.env.ATLAS_HOME = home;
});

afterEach(() => {
	if (previous === undefined) delete process.env.ATLAS_HOME;
	else process.env.ATLAS_HOME = previous;
});

const save = (env: unknown) => writeFileSync(join(home, "settings.json"), JSON.stringify({ env }));

describe("atlasKnob", () => {
	test("store value wins over the env value", () => {
		save({ ATLAS_X: "stored" });
		expect(atlasKnob("ATLAS_X", { ATLAS_X: "env" })).toBe("stored");
	});

	test("falls back to env when the store lacks the key", () => {
		save({ ATLAS_Y: "stored" });
		expect(atlasKnob("ATLAS_X", { ATLAS_X: "env" })).toBe("env");
	});

	test("missing settings.json yields the env value", () => {
		expect(atlasKnob("ATLAS_X", { ATLAS_X: "env" })).toBe("env");
	});

	test("malformed JSON yields the env value without throwing", () => {
		writeFileSync(join(home, "settings.json"), "{not json");
		expect(atlasKnob("ATLAS_X", { ATLAS_X: "env" })).toBe("env");
	});
});

describe("atlasStoreEnv", () => {
	test("keeps only ATLAS_* keys with non-empty string values", () => {
		save({ ATLAS_OK: "1", ATLAS_NUM: 5, ATLAS_EMPTY: "", atlas_lower: "x", OTHER: "y" });
		expect(atlasStoreEnv({})).toEqual({ ATLAS_OK: "1" });
	});

	test("a non-object env block exports nothing", () => {
		save("nope");
		expect(atlasStoreEnv({})).toEqual({});
	});
});
