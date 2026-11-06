// The bun preload (test-env-preload.ts) points TMPDIR at a private dir and removes it on exit, so tests that forget to
// clean their mkdtemp dirs do not accumulate in /tmp.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const preload = join(import.meta.dir, "test-env-preload.ts");

test("os.tmpdir() inside a test is the preload's private dir", () => {
	expect(tmpdir()).toContain("atlas-bun-tmp-");
	expect(process.env.TMPDIR).toBe(tmpdir());
});

test("a dir a test leaves behind is gone after the process exits", () => {
	const script = `import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
console.log(mkdtempSync(join(tmpdir(), "leaky-")));`;
	const base = mkdtempSync(join(realpathSync(tmpdir()), "hyg-"));
	const r = Bun.spawnSync(["bun", "--preload", preload, "-e", script], { env: { ...process.env, TMPDIR: base }, stdout: "pipe" });
	const leaked = r.stdout.toString().trim();
	expect(leaked).toContain("atlas-bun-tmp-");
	expect(existsSync(leaked)).toBe(false);
	expect(existsSync(join(leaked, ".."))).toBe(false);
});
