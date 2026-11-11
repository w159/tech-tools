// Parity: omp's board rows settle a finished worker's dispatch row exactly as the mod's snapshot does (S1), and carry
// claimed_at / completed_at so the shared board model prints the same `ran m:ss` detail on both hosts.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { todoItems } from "./channel-view";
import { boardRowsOf } from "../mod/board-model";
import { endedOf, settleDispatch } from "../mod/data/todos";

const row = (over: Record<string, unknown>) => ({ id: "x", content: "t", status: "pending", owner: null, origin: "session", session_id: "s1", archived: false, claimed_at: null, completed_at: null, ...over });
function board(items: unknown[]): string {
	const root = mkdtempSync(join(tmpdir(), "chan-todos-"));
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	writeFileSync(join(root, ".atlas", ".run", "todos.json"), JSON.stringify({ items }));
	return root;
}

test("a dispatch row whose worker ended reads completed; a running worker's row and plan rows are untouched", () => {
	const root = board([
		row({ content: "plan", status: "in_progress" }),
		row({ content: "dispatch w1", origin: "dispatch", owner: "w1", claimed_at: 100 }),
		row({ content: "dispatch w2", origin: "dispatch", owner: "w2", claimed_at: 100 }),
	]);
	const got = todoItems(root, "s1", ["w1"]);
	expect(got.map(i => i.status)).toEqual(["in_progress", "completed", "pending"]);
});

test("parity with the mod: omp settles through the same settleDispatch", () => {
	const items = [row({ origin: "dispatch", owner: "w1" }), row({ origin: "dispatch", owner: "w3" })];
	const root = board(items);
	const mod = settleDispatch(items.map(i => ({ ...i, owner: i.owner ?? undefined })), endedOf([{ name: "w1", state: "finished" }, { name: "w3", state: "running" }]));
	expect(todoItems(root, "s1", ["w1"]).map(i => i.status)).toEqual(mod.map(i => i.status));
});

test("claimed_at and completed_at reach the board model: a settled row prints how long it ran", () => {
	const root = board([row({ origin: "dispatch", owner: "w1", claimed_at: 100, completed_at: 165 })]);
	const [r] = boardRowsOf(todoItems(root, "s1", ["w1"]), 200);
	expect(r!.state).toBe("done");
	expect(r!.detail).toBe("ran 01:05");
});

test("a running row is timed from claimed_at against now", () => {
	const root = board([row({ status: "in_progress", claimed_at: 100 })]);
	const [r] = boardRowsOf(todoItems(root, "s1"), 130);
	expect(r!.state).toBe("running");
	expect(r!.elapsed?.secs).toBe(30);
});
