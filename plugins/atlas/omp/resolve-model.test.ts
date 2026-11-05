// resolve(): the per-seat model falls back to the role's agents/<role>.md `model:` pin when the matrix seat has none.
// A throwaway plugin root is swapped in for pluginRoot() only; every other plugin-path export stays real.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as realPluginPath from "./plugin-path";

let rootOverride: string | undefined;
// snapshot first: the namespace object is live and points at the mock once it is installed
const real = { ...realPluginPath };
mock.module("./plugin-path", () => ({ ...real, pluginRoot: () => rootOverride ?? real.pluginRoot() }));
const { resolve } = await import("./resolve");

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "resolve-root-"));
	mkdirSync(join(root, "contracts"));
	mkdirSync(join(root, "agents"));
	rootOverride = root;
});
afterEach(() => {
	rootOverride = undefined;
	rmSync(root, { recursive: true, force: true });
});

const writeMatrix = (team: object[]) =>
	writeFileSync(join(root, "contracts", "scope-matrix.json"), JSON.stringify({ classes: { fix: { low: { team, isolation: "shared", max_parallel: 1 } } } }));
const agent = (role: string, text: string) => writeFileSync(join(root, "agents", `${role}.md`), text);
const models = (team: object[]) => {
	writeMatrix(team);
	return (resolve("fix", "low").team as { role: string; model: string }[]).map((s) => s.model);
};

test("a seat without a model takes the agents/<role>.md frontmatter pin (quotes and spacing stripped)", () => {
	agent("alpha", "---\nname: alpha\nmodel: sonnet\neffort: low\n---\nbody\n");
	agent("bravo", '---\nmodel: "opus"\n---\n');
	agent("charlie", "---\nmodel: 'haiku'\n---\n");
	agent("delta", "---\nmodel:fable\n---\n");
	agent("echo", "---\nmodel:   spaced   \n---\n");
	expect(models([{ role: "alpha" }, { role: "bravo" }, { role: "charlie" }, { role: "delta" }, { role: "echo" }])).toEqual(["sonnet", "opus", "haiku", "fable", "spaced"]);
});

test("a seat's own model wins over the role pin; an empty one falls back to it", () => {
	agent("alpha", "---\nmodel: sonnet\n---\n");
	expect(models([{ role: "alpha", model: "opus" }, { role: "alpha", model: "" }])).toEqual(["opus", "sonnet"]);
});

test("only the frontmatter is read: a model: line in the body is ignored", () => {
	agent("alpha", "---\nname: alpha\n---\n\nmodel: leaked\n");
	expect(models([{ role: "alpha" }])).toEqual([""]);
});

test("a missing or modelless agent file yields an empty model, never undefined or a throw", () => {
	agent("alpha", "---\nname: alpha\n---\n");
	expect(models([{ role: "alpha" }, { role: "ghost" }])).toEqual(["", ""]);
});
