// bun test preload (omp/bunfig.toml). Tests must not inherit a worker/lead identity from the invoking shell
// (ATLAS_WORKER_NAME, ATLAS_LEAD_NAME, ATLAS_CHANNEL, ...). Runs before test-isolation.ts, which then sets its own ATLAS_* paths.
for (const k of Object.keys(process.env)) if (k.startsWith("ATLAS_")) delete process.env[k];

// Every os.tmpdir() a test (or a child it spawns) reads is a private dir removed when the run ends, so a full
// `bun test` leaves nothing in /tmp. Tests that call mkdtempSync(join(tmpdir(), ...)) and forget to clean up no
// longer leak. Removal is on process exit (not afterAll): afterAll in a preload fires per file, and later files
// still need the dir.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tmpRoot = mkdtempSync(join(realpathSync(tmpdir()), "atlas-bun-tmp-"));
process.env.TMPDIR = tmpRoot;
process.on("exit", () => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {}
});
