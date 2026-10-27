import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliIo } from "../admin/cli.js";

export const FIXTURES = new URL("../admin/fixtures/", import.meta.url);
export const fixturePath = (name: string): string => new URL(name, FIXTURES).pathname;

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mcp-admin-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Captured {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

export function capture(env: NodeJS.ProcessEnv): Captured {
  let out = "";
  let err = "";
  return {
    io: { env, stdout: (t) => (out += t), stderr: (t) => (err += t) },
    stdout: () => out,
    stderr: () => err,
  };
}

export async function cli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  const c = capture(env);
  const code = await runCli(args, c.io);
  return { code, stdout: c.stdout(), stderr: c.stderr() };
}

export function allFileText(dir: string): string {
  let text = "";
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    text += statSync(p).isDirectory() ? allFileText(p) : readFileSync(p, "utf8");
  }
  return text;
}
