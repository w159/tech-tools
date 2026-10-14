import { expect, test } from "bun:test";
import { registerTeamTool, teamArgv } from "./team-tool";

const ROOT = "/p/atlas";

function fakePi() {
	const tools: any[] = [];
	const Type = new Proxy({}, { get: () => () => ({}) });
	return { tools, pi: { registerTool: (t: any) => void tools.push(t), typebox: { Type } } as any };
}

test("spawn argv carries class, effort, task, paths and the omp harness", () => {
	expect(teamArgv({ action: "spawn", class: "audit", effort: "medium", task: "t", paths: ["a", "b"] }, ROOT)).toEqual([
		"python3", "/p/atlas/scripts/atlas_mux.py", "spawn-team", "--class", "audit", "--effort", "medium", "--task", "t", "--harness", "omp", "--paths", "a,b",
	]);
});

test("wait and reap argv", () => {
	expect(teamArgv({ action: "wait", team: "t1", timeout: 5 }, ROOT).slice(2)).toEqual(["wait", "--team", "t1", "--timeout", "5"]);
	expect(teamArgv({ action: "reap", team: "t1" }, ROOT).slice(2)).toEqual(["reap", "--team", "t1"]);
});

test("missing required field throws", () => {
	expect(() => teamArgv({ action: "wait" }, ROOT)).toThrow("team is required");
});

test("tool shells out through the injected runner and returns its JSON", async () => {
	const { tools, pi } = fakePi();
	const calls: string[][] = [];
	expect(registerTeamTool(pi, ROOT, async argv => (calls.push(argv), { code: 0, stdout: '{"ok": true}\n' }), {})).toBe(true);
	const res = await tools[0].execute("id", { action: "reap", team: "t1" }, undefined, undefined, { cwd: "/w" });
	expect(res.content[0].text).toBe('{"ok": true}');
	expect(calls[0].slice(2)).toEqual(["reap", "--team", "t1"]);
});

test("hidden from worker sessions", () => {
	const { tools, pi } = fakePi();
	expect(registerTeamTool(pi, ROOT, undefined, { ATLAS_WORKER_NAME: "w1" })).toBe(false);
	expect(tools).toHaveLength(0);
});
