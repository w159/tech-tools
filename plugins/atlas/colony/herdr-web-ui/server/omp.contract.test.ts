import { afterAll, beforeAll, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "./index.ts";
import { herdrRpc, sessionSnapshot, workspaceClose, workspaceCreate } from "./herdr/client.ts";
import type { ConversationResponse } from "../shared/protocol.ts";

// omp names its session file when it starts and writes it with the first message (seen on a
// fresh omp pane: herdr held the path, the file was not there). A fake omp stands in.
const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-omp-contract-"));
const slug = join(root, ".omp", "agent", "sessions", "-omp-contract");
const fresh = join(slug, "2026-10-06T00-00-00-000Z_omp-fresh.jsonl");
const originalHome = process.env["HOME"];
let workspaceId: string | undefined;
let paneId: string;
let server: ReturnType<typeof createServer>;
let seq = Date.now() * 1000;

beforeAll(async () => {
  mkdirSync(slug, { recursive: true });
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const fakeOmp = join(bin, "omp");
  writeFileSync(fakeOmp, "#!/bin/sh\nsleep 600\n");
  chmodSync(fakeOmp, 0o755);
  const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-omp-contract" });
  workspaceId = created.workspace.workspace_id;
  paneId = created.root_pane.pane_id;
  await herdrRpc("pane.send_text", { pane_id: paneId, text: `${fakeOmp}\n` });
  for (let attempt = 0; attempt < 100; attempt++) {
    const pane = (await sessionSnapshot()).panes.find((candidate) => candidate.pane_id === paneId);
    if (pane?.agent === "omp") break;
    await Bun.sleep(50);
  }
  await herdrRpc("pane.report_agent", { pane_id: paneId, source: "herdr:omp", agent: "omp", state: "idle", seq: ++seq });
  await herdrRpc("pane.report_agent_session", { pane_id: paneId, source: "herdr:omp", agent: "omp", seq: ++seq, agent_session_path: fresh, session_start_source: "startup" });
  process.env["HOME"] = root;
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state") });
});

afterAll(async () => {
  server?.stop();
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (workspaceId) await workspaceClose(workspaceId);
  rmSync(root, { recursive: true, force: true });
});

const read = async (): Promise<ConversationResponse> => {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/pane/conversation?pane_id=${encodeURIComponent(paneId)}`);
  expect(response.status).toBe(200);
  return await response.json() as ConversationResponse;
};

it("answers a session omp has not written yet as an empty conversation, then follows the file it writes", async () => {
  expect(await read()).toMatchObject({ source: "omp-transcript", turns: [], cursor: null, history_id: "unwritten:2026-10-06T00-00-00-000Z_omp-fresh" });
  writeFileSync(fresh, [
    { type: "session", version: 3, id: "omp-fresh", timestamp: new Date().toISOString(), cwd: root },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-10-06T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "First prompt" }] } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-10-06T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "First answer" }] } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const written = await read();
  expect(written.source).toBe("omp-transcript");
  expect(written.history_id).not.toBe("unwritten:2026-10-06T00-00-00-000Z_omp-fresh");
  expect(written.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
});
