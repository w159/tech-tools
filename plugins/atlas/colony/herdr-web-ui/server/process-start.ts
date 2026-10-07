import { readFileSync } from "node:fs";

/** `ps -o etime=`: `[[dd-]hh:]mm:ss` since the process started. */
export function parseElapsed(text: string): number | null {
  const match = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (!match) return null;
  const [, days = "0", hours = "0", minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes!)) * 60 + Number(seconds!);
}

/**
 * When a process started, in ms since the epoch: Linux counts it in /proc (USER_HZ
 * ticks after boot); macOS has no /proc, so there `ps` tells how long it has run (to the
 * second, which is all the callers compare). null where neither answers.
 */
export function processStartedAt(pid: number): number | null {
  if (process.platform === "darwin") {
    try {
      const ps = Bun.spawnSync(["/bin/ps", "-o", "etime=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
      const elapsed = ps.exitCode === 0 ? parseElapsed(ps.stdout.toString()) : null;
      return elapsed === null ? null : Date.now() - elapsed * 1000;
    } catch {
      return null;
    }
  }
  try {
    const ticks = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop()!.split(" ")[19]);
    const boot = Number(readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m)?.[1]);
    return Number.isFinite(ticks) && Number.isFinite(boot) ? boot * 1000 + ticks * 10 : null;
  } catch {
    return null;
  }
}
