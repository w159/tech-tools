import { afterEach, beforeEach, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTranscriptPath } from "./codex.ts";

// Native stores and the real RPC client; only herdr's foreground metadata is synthetic.
// In particular, a real process supplies /proc/cmdline when that metadata omits argv.
const thread = "01a0c7a1-56d9-7e20-9f08-f7a2d973bc01";
const answer = "This specific native conversation belongs to the selected Codex process, not whichever session was updated last.";
let root: string;
let home: string;
let path: string;
let screen: string;
let foreground: { pid: number; name?: string; argv?: string[] }[];
let listener: ReturnType<typeof Bun.listen>;
let socketBefore: string | undefined;
const children: ReturnType<typeof Bun.spawn>[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "herdr-web-ui-codex-processes-"));
  home = join(root, "codex");
  mkdirSync(join(home, "sessions"), { recursive: true });
  path = join(home, "sessions", `rollout-${thread}.jsonl`);
  writeFileSync(path, [
    { type: "session_meta", payload: { id: thread, cwd: root } },
    { type: "event_msg", payload: { type: "agent_message", message: answer } },
  ].map((entry) => JSON.stringify(entry)).join("\n"));
  const db = new Database(join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT)");
  db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 1, 1, 'cli')").run(thread, path, root);
  db.close();
  screen = "";
  foreground = [];
  socketBefore = process.env["HERDR_SOCKET"];
  const socket = join(root, "herdr.sock");
  process.env["HERDR_SOCKET"] = socket;
  listener = Bun.listen<{ buffer: string }>({
    unix: socket,
    socket: {
      open(socket) { socket.data = { buffer: "" }; },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        if (!socket.data.buffer.includes("\n")) return;
        const request = JSON.parse(socket.data.buffer) as { id: string; method: string };
        const result = request.method === "agent.get" ? { agent: {} }
          : request.method === "pane.process_info" ? { process_info: { foreground_processes: foreground } }
          : request.method === "pane.read" ? { read: { text: screen } }
          : null;
        if (result === null) throw new Error(`unexpected RPC ${request.method}`);
        socket.end(`${JSON.stringify({ id: request.id, result })}\n`);
      },
    },
  });
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  listener.stop(true);
  if (socketBefore === undefined) delete process.env["HERDR_SOCKET"];
  else process.env["HERDR_SOCKET"] = socketBefore;
  rmSync(root, { recursive: true, force: true });
});

const resolve = () => codexTranscriptPath(root, root, home, [{
  pane_id: root, workspace_id: root, tab_id: root, terminal_id: root,
  agent: "codex", agent_status: "working", cwd: root, focused: false, revision: 0,
}]);

/** A ready, owned process with Codex's argv[0], no rollout descriptor and no timer. */
async function runningCodex(resume = false): Promise<ReturnType<typeof Bun.spawn>> {
  const node = Bun.which("node");
  if (node === null) throw new Error("node is required for the Codex process fixture");
  const child = Bun.spawn([
    "/bin/bash", "-c", 'exec -a "$1" "$2" -e \'process.stdout.write("READY\\n"); process.stdin.resume()\' "${@:3}"',
    "fixture", join(root, "codex"), node, ...(resume ? ["resume", thread] : []),
  ], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  children.push(child);
  const reader = child.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(ready.value)).toBe("READY\n");
  return child;
}

it.skipIf(process.platform !== "linux")("selects the resumed rollout when Linux foreground metadata omits argv", async () => {
  const child = await runningCodex(true);
  foreground = [{ pid: child.pid, name: "codex" }];
  expect(await resolve()).toBe(path);
});

it("selects the resumed rollout for the observed native executable alias", async () => {
  foreground = [{ pid: 2147483647, argv: ["/home/user/.local/bin/codex.opencodex-real", "resume", thread] }];
  expect(await resolve()).toBe(path);
});

it.skipIf(process.platform !== "linux")("keeps the screen binding with recovered argv while the same process runs", async () => {
  const child = await runningCodex();
  foreground = [{ pid: child.pid, name: "codex" }];
  screen = answer;
  expect(await resolve()).toBe(path);
  screen = "";
  expect(await resolve()).toBe(path);
});

it.skipIf(process.platform !== "linux")("drops the recovered binding when its process has exited", async () => {
  const child = await runningCodex();
  foreground = [{ pid: child.pid, name: "codex" }];
  screen = answer;
  expect(await resolve()).toBe(path);
  child.kill();
  await child.exited;
  screen = "";
  expect(await resolve()).toBeNull();
});

it("does not guess a session when argv and proc data are unavailable", async () => {
  foreground = [{ pid: 2147483647, name: "codex" }];
  expect(await resolve()).toBeNull();
});

it("does not trust the Codex name when recovered argv belongs to another executable", async () => {
  foreground = [{ pid: process.pid, name: "codex" }];
  expect(await resolve()).toBeNull();
});

it("does not use an alias resume after a newer interactive thread starts", async () => {
  foreground = [{ pid: 2147483647, argv: ["/usr/bin/codex.opencodex-real", "resume", thread] }];
  expect(await resolve()).toBe(path);
  const db = new Database(join(home, "state_5.sqlite"));
  db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 2, 2, 'cli')").run(
    "01a0c7a1-56d9-7e20-9f08-f7a2d973bc02", join(home, "sessions", "missing.jsonl"), root,
  );
  db.close();
  expect(await resolve()).toBeNull();
});

for (const argv of [
  ["echo", "/usr/bin/codex", "resume", thread],
  ["node", "-e", "/usr/bin/codex", "resume", thread],
  ["python", "/usr/bin/codex.js", "resume", thread],
  ["/bin/sh", "-c", "/usr/bin/codex", "resume", thread],
  ["node", "--eval", "/usr/bin/codex", "resume", thread],
  ["node", "--require", "/usr/bin/codex", "resume", thread],
  ["node", "--no-warnings", "-e", "/usr/bin/codex", "resume", thread],
  ["node", "--eval=setInterval(()=>{},1000)", "/usr/bin/codex", "resume", thread],
  ["node", "--title", "/usr/bin/codex", "--eval=setInterval(()=>{},1000)", "resume", thread],
  ["node", "--import=./hook.mjs", "/usr/bin/codex", "resume", thread],
  ["/usr/bin/not-codex", "resume", thread],
]) {
  it(`ignores unrelated executable or command arguments: ${argv.slice(0, 3).join(" ")}`, async () => {
    foreground = [{ pid: 2147483647, argv }];
    expect(await resolve()).toBeNull();
  });
}

for (const executable of [
  ["/usr/bin/codex"],
  ["node", "/usr/lib/codex.js"],
  ["/bin/sh", "/usr/bin/codex"],
  ["bun", "/usr/lib/codex.js"],
  ["node", "--no-warnings", "/usr/bin/codex"],
  ["bash", "--", "/usr/bin/codex"],
  ["zsh", "/usr/bin/codex"],
  ["node", "--max-old-space-size=4096", "--no-warnings", "/usr/lib/codex.js"],
  ["node", "--title=codex", "--enable-source-maps", "/usr/lib/codex.js"],
  ["C:\\tools\\codex.exe"],
  ["C:\\tools\\node.exe", "C:\\tools\\codex.js"],
]) {
  it(`preserves resume selection for ${executable.join(" ")}`, async () => {
    foreground = [{ pid: 2147483647, argv: [...executable, "resume", thread] }];
    expect(await resolve()).toBe(path);
  });
}
