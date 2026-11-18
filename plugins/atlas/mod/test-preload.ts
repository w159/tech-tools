// bun test preload (bunfig.toml, first in the list): colour support is read from the ambient environment
// (mod/atlas-ui.ts reads NO_COLOR; FORCE_COLOR is honoured by the runtime), so a caller's NO_COLOR or FORCE_COLOR would
// change what the suite renders. Clear both before any module loads; tests that want them pass their own env.
// the mod tsconfig has no node types, hence the structural view of the global
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
delete env.NO_COLOR;
delete env.FORCE_COLOR;
