// Crash tracer for the MCP server.
//
// Must only import from Node builtins. This module is loaded FIRST by
// index.ts so our process.on handlers and initial trace line land on
// disk before any other import (including the MCP SDK) evaluates. If
// an import later in the chain throws, `process.on("uncaughtException")`
// fires and we get a real trace instead of a silent exit.
//
// Issue #149: Claude Desktop 1.3109.0 with MCP protocol 2025-11-25
// shows the extension runtime killing the server without emitting any
// stderr to the host log. Synchronous file writes sidestep whatever is
// eating stderr.

import { appendFileSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";

export const CRASH_LOG_PATH: string = (() => {
  const preferred = join(homedir(), ".minutes", "logs", "mcp-crash.log");
  try {
    mkdirSync(dirname(preferred), { recursive: true });
    return preferred;
  } catch {
    return join(tmpdir(), "minutes-mcp-crash.log");
  }
})();

export function crashTrace(event: string, detail?: unknown): void {
  try {
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        pid: process.pid,
        ppid: process.ppid,
        cwd: process.cwd(),
        argv: process.argv,
        execPath: process.execPath,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        MCP_EXTENSION_ID: process.env.MCP_EXTENSION_ID ?? null,
        MEETINGS_DIR: process.env.MEETINGS_DIR ?? null,
        MINUTES_HOME: process.env.MINUTES_HOME ?? null,
        detail:
          detail === undefined
            ? null
            : detail instanceof Error
              ? { message: detail.message, name: detail.name, stack: detail.stack }
              : detail,
      }) + "\n";
    appendFileSync(CRASH_LOG_PATH, line);
  } catch {
    // Best-effort. Never throw from the tracer.
  }
}

crashTrace("module-load-start");

process.on("uncaughtException", (err) => {
  crashTrace("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  crashTrace("unhandledRejection", reason as any);
});
process.on("exit", (code) => {
  crashTrace("process-exit", { code });
});
process.on("SIGTERM", () => crashTrace("signal-SIGTERM"));
process.on("SIGINT", () => crashTrace("signal-SIGINT"));
process.on("SIGHUP", () => crashTrace("signal-SIGHUP"));
process.on("SIGPIPE", () => crashTrace("signal-SIGPIPE"));
