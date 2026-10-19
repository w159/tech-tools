import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type TuiSpawnResult, type TuiSpawner, allowlistTuiArgs, registerAtlasTuiCommand } from "./tui-command";

type CommandDef = { description: string; handler: (args: string, ctx: unknown) => Promise<void> };

/** Ordered event log shared by the fake tui and the fake spawner, so ordering asserts are plain array compares. */
type Harness = {
	events: string[];
	notifications: Array<{ message: string; level?: string }>;
	customCalls: number;
	component: { render: (width: number) => readonly string[] } | undefined;
	resolved: unknown;
	run: (args?: string, hasUI?: boolean) => Promise<void>;
};

function harness(spawnImpl: TuiSpawner): Harness {
	let command: CommandDef | undefined;
	registerAtlasTuiCommand(
		{ registerCommand: (_name: string, def: CommandDef) => { command = def; } } as unknown as Pick<ExtensionAPI, "registerCommand">,
		{ spawn: spawnImpl },
	);
	if (!command) throw new Error("/atlas-tui was not registered");
	const state: Harness = {
		events: [],
		notifications: [],
		customCalls: 0,
		component: undefined,
		resolved: undefined,
		run: async (args = "", hasUI = true) => {
			const tui = {
				stop: () => state.events.push("stop"),
				start: () => state.events.push("start"),
				requestRender: (full: boolean) => state.events.push(`render:${full}`),
			};
			const ctx = {
				hasUI,
				cwd: "/proj",
				ui: {
					notify: (message: string, level?: string) => state.notifications.push({ message, level }),
					custom: <T,>(factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: T) => void) => unknown) =>
						new Promise<T>(resolve => {
							state.customCalls++;
							state.component = factory(tui, {}, {}, resolve as (v: T) => void) as Harness["component"];
						}),
				},
			};
			await command!.handler(args, ctx);
		},
	};
	return state;
}

function loggedHarness(result: Partial<TuiSpawnResult> | Error): Harness {
	const h = harness((_bin, args, opts) => {
		h.events.push(`spawn:${_bin} ${args.join(" ")} @${opts.cwd}`);
		if (result instanceof Error) return Promise.resolve({ exitCode: null, error: result });
		return Promise.resolve({ exitCode: 0, ...result });
	});
	return h;
}

test("allowlist accepts bare --all and value flags, rejecting anything else", () => {
	expect(allowlistTuiArgs("--all --view colony")).toEqual({ ok: true, argv: ["--all", "--view", "colony"] });
	expect(allowlistTuiArgs("--seat lead-abc123 --colony c1")).toEqual({ ok: true, argv: ["--seat", "lead-abc123", "--colony", "c1"] });
	expect(allowlistTuiArgs(undefined)).toEqual({ ok: true, argv: [] });
	expect(allowlistTuiArgs("--evil")).toMatchObject({ ok: false });
	expect(allowlistTuiArgs("--view")).toMatchObject({ ok: false }); // value flag without its value
	expect(allowlistTuiArgs("--launch")).toMatchObject({ ok: false }); // ours to decide, never the user's
});

test("stop runs before spawn; start and a full render run after exit; component renders empty", async () => {
	const h = loggedHarness({});
	await h.run("--all");
	expect(h.events).toEqual([
		"stop",
		expect.stringContaining("atlas_tui.py --project /proj --all"),
		"start",
		"render:true",
	]);
	// the spawn row must name the script, the project root, and the passthrough arg
	expect(h.events[1]).toContain("--all");
	expect(h.component?.render(80)).toEqual([]);
	expect(h.resolved).toBeUndefined();
	expect(h.notifications).toEqual([]); // success is silent
});

test("a non-zero exit notifies a warning with the code, after the UI restarts", async () => {
	const h = loggedHarness({ exitCode: 3 });
	await h.run();
	expect(h.events).toEqual(["stop", expect.stringContaining("atlas_tui.py --project /proj"), "start", "render:true"]);
	expect(h.notifications).toEqual([{ message: expect.stringContaining("exited with code 3"), level: "warning" }]);
});

test("a spawn error notifies a warning with the message instead of throwing", async () => {
	const h = loggedHarness(new Error("python3 not found"));
	await h.run("--view overview");
	expect(h.events[h.events.length - 2]).toBe("start");
	expect(h.events[h.events.length - 1]).toBe("render:true");
	expect(h.notifications).toEqual([{ message: expect.stringContaining("python3 not found"), level: "warning" }]);
	expect(h.events[1]).toContain("--view overview");
});

test("a rejected flag notifies a warning and never spawns or opens custom UI", async () => {
	let spawned = false;
	const h = harness(() => {
		spawned = true;
		return Promise.resolve({ exitCode: 0 });
	});
	await h.run("--evil");
	expect(spawned).toBe(false);
	expect(h.customCalls).toBe(0);
	expect(h.notifications).toEqual([{ message: expect.stringContaining("--evil"), level: "warning" }]);
});

test("the no-UI path points at --launch and never spawns", async () => {
	let spawned = false;
	const h = harness(() => {
		spawned = true;
		return Promise.resolve({ exitCode: 0 });
	});
	await h.run("--all", false);
	expect(spawned).toBe(false);
	expect(h.customCalls).toBe(0);
	expect(h.notifications).toEqual([
		{ message: expect.stringContaining("atlas_tui.py --launch"), level: "info" },
	]);
});
