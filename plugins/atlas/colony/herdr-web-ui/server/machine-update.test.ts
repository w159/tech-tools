import { describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIDGE_PROTOCOL, REMOTE_BUNDLE_VERSION, type SetupJob } from "../shared/machines.ts";
import { MachineManager } from "./machines.ts";
import { handleMachineRequest } from "./machine-api.ts";
import { posixHost } from "./remote-host.ts";
import { SshConnection } from "./ssh.ts";
import { CompletionTracker } from "./completion.ts";
import type { PushService } from "./push.ts";

// Real setup/approval/verification with a loopback identity endpoint and a fake SSH host.
// No bundle is downloaded and no real process or user's herdr is touched.
describe("approved bridge replacement", () => {
  async function scenario(options: { identity?: Record<string, unknown>; unauthorized?: boolean; replacementProtocol?: number } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "herdr-bridge-replacement-"));
    const socket = "/home/fixture/.config/herdr/herdr.sock";
    const token = "a".repeat(64);
    let descriptor = { pid: 4242, port: 29431, token, socket_path: socket, managed_remote: true, bridge_protocol: BRIDGE_PROTOCOL + 1, bundle_version: "older" };
    let stopped = false;
    const operations: string[] = [];
    const relays: ReturnType<typeof Bun.serve>[] = [];
    const real = { start: SshConnection.prototype.start, run: SshConnection.prototype.run, close: SshConnection.prototype.close, forward: SshConnection.prototype.forward };
    const install = spyOn(posixHost, "installBundle").mockImplementation(async () => { operations.push("install"); });
    const manager = new MachineManager(dir, { seed() {} } as unknown as PushService, new CompletionTracker(null));
    const request = async (path: string, body?: unknown) => {
      const response = await handleMachineRequest(new Request(`http://localhost:7317/api/machines/setup${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { origin: "http://localhost:7317", "x-herdr-machine": "1", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), manager);
      expect(response.ok).toBe(true);
      return response.json() as Promise<SetupJob>;
    };
    const until = async (id: string, phases: SetupJob["phase"][]) => {
      for (const deadline = Date.now() + 3000;;) {
        const job = await request(`/${id}`);
        if (phases.includes(job.phase)) return job;
        if (Date.now() >= deadline) throw new Error(`Setup stuck in ${job.phase}: ${job.error}`);
        await Bun.sleep(10);
      }
    };
    try {
      SshConnection.prototype.start = async () => {};
      SshConnection.prototype.close = () => {};
      SshConnection.prototype.run = async (script: string) => {
        if (script.includes("uname")) return `Linux\nx86_64\n/home/fixture\n/home/fixture/.config\n/usr/bin/herdr\nbundle-older\n${JSON.stringify(descriptor)}\n`;
        if (script.includes("socket=")) return socket;
        if (script.includes("--version")) return "herdr 0.9.3";
        if (script.includes("kill -0")) return stopped ? "" : "live";
        if (script === "kill -TERM 4242") { operations.push("stop:4242"); stopped = true; return ""; }
        if (script.includes("nohup")) {
          operations.push("start");
          descriptor = { ...descriptor, pid: 4243, bridge_protocol: options.replacementProtocol ?? BRIDGE_PROTOCOL, bundle_version: REMOTE_BUNDLE_VERSION };
          return "";
        }
        if (script.includes('for f in "$HOME/.config/herdr-web-ui/bridges/"')) return JSON.stringify(descriptor);
        throw new Error(`Unexpected remote command: ${script}`);
      };
      SshConnection.prototype.forward = async (local: number, remote: number) => {
        expect(remote).toBe(descriptor.port);
        const relay = Bun.serve({ hostname: "127.0.0.1", port: local,
          fetch(request, server) {
            if (options.unauthorized || request.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
            const path = new URL(request.url).pathname;
            if (path === "/api/bridge") {
              operations.push(`verify:${descriptor.pid}`);
              return Response.json({ ...descriptor, socket_id: "fixture:1", herdr: { version: "0.9.3", protocol: 22 }, ...(descriptor.pid === 4242 ? options.identity : {}) });
            }
            if (path === "/api/session") return Response.json({ snapshot: { panes: [], workspaces: [] } });
            if (path === "/ws" && server.upgrade(request)) return;
            return new Response("not found", { status: 404 });
          }, websocket: { message() {} },
        });
        relays.push(relay);
      };
      const first = await request("", { destination: "fixture-only" });
      expect(await until(first.id, ["failed"])).toMatchObject({ action_required: "update_bridge" });
      expect(manager.list().map((machine) => machine.kind)).toEqual(["local"]);
      expect(operations).toEqual([]);
      const update = await request("", { destination: "fixture-only", update_remote: true });
      const approval = await until(update.id, ["approval", "failed"]);
      expect(approval.phase).toBe("approval");
      expect(approval.installations.join(" ")).toContain("restart this bridge");
      expect(operations).toEqual([]); // Even the explicit retry still waits for approval.
      await request(`/${update.id}`, { action: "approve" });
      const result = await until(update.id, ["connected", "failed"]);
      return { result, operations: [...operations], registered: manager.list().filter((machine) => machine.kind === "ssh").length };
    } finally {
      manager.stop();
      Object.assign(SshConnection.prototype, real);
      install.mockRestore();
      for (const relay of relays) relay.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("replaces a different protocol only after approval, then verifies the new bridge normally", async () => {
    const { result, operations, registered } = await scenario();
    expect(result.phase).toBe("connected");
    expect(operations).toEqual(["install", "verify:4242", "stop:4242", "start", "verify:4243"]);
    expect(registered).toBe(1);
  });
  for (const [name, options] of [
    ["unauthenticated endpoint", { unauthorized: true }],
    ["different socket", { identity: { socket_path: "/other/herdr.sock" } }],
    ["missing socket identity", { identity: { socket_id: "" } }],
    ["unknown herdr protocol", { identity: { herdr: {} } }],
    ["different process", { identity: { pid: 9999 } }],
    ["independent bridge", { identity: { managed_remote: false } }],
    ["invalid ownership flag", { identity: { managed_remote: "true" } }],
  ] as const) {
    it(`never stops the old process for an ${name}`, async () => {
      const { result, operations, registered } = await scenario(options);
      expect(result.phase).toBe("failed");
      expect(operations.some((step) => step.startsWith("stop:") || step === "start")).toBe(false);
      expect(registered).toBe(0);
    });
  }
  it("does not connect if the replacement still speaks another protocol", async () => {
    const { result, operations, registered } = await scenario({ replacementProtocol: BRIDGE_PROTOCOL + 1 });
    expect(result).toMatchObject({ phase: "failed", action_required: "update_bridge" });
    expect(operations).toContain("verify:4243");
    expect(registered).toBe(0);
  });
});
