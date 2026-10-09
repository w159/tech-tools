// bun test preload (omp/bunfig.toml). Tests must not inherit a worker/lead identity from the invoking shell
// (ATLAS_WORKER_NAME, ATLAS_LEAD_NAME, ATLAS_CHANNEL, ...). Runs before test-isolation.ts, which then sets its own ATLAS_* paths.
for (const k of Object.keys(process.env)) if (k.startsWith("ATLAS_")) delete process.env[k];
