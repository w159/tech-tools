// bun test preload (omp/bunfig.toml). usage-statusline.ts imports two RUNTIME modules that only the oh-my-pi host
// installs (@oh-my-pi/pi-catalog, @oh-my-pi/pi-tui). On a machine without oh-my-pi those imports fail and every test
// file that reaches index.ts or usage-statusline.ts dies at load time. When a module cannot be resolved, register a
// minimal in-memory stand-in so the suite stays hermetic; when the real one resolves, it is used untouched.
// Tests whose assertions depend on the real host module check OMP_HOST_PRESENT (see test-omp-stubs.ts exports).
import { plugin } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Read at preload time: tests pin HOME to an empty directory later, and the module factory below runs lazily.
const GLOBAL_HOST_TUI = join(process.env.HOME ?? "", ".bun/install/global/node_modules/@oh-my-pi/pi-tui");

function resolvable(spec: string): boolean {
	try {
		import.meta.resolveSync(spec);
		return true;
	} catch {
		return false;
	}
}

export const OMP_CATALOG_PRESENT = resolvable("@oh-my-pi/pi-catalog");
export const OMP_TUI_PRESENT = resolvable("@oh-my-pi/pi-tui");
export const OMP_HOST_PRESENT = OMP_CATALOG_PRESENT && OMP_TUI_PRESENT;

/** Terminal cell width: 2 for East Asian wide / emoji code points, 0 for combining marks and ZWJ, else 1. */
function cellWidth(cp: number): number {
	if (
		(cp >= 0x300 && cp <= 0x36f) ||
		cp === 0x200d ||
		(cp >= 0xfe00 && cp <= 0xfe0f)
	)
		return 0;
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		// BMP emoji that are East Asian Wide (the statusline's hourglass U+23F3 is one): the real pi-tui counts 2
		(cp >= 0x231a && cp <= 0x231b) ||
		(cp >= 0x23e9 && cp <= 0x23ec) ||
		cp === 0x23f0 ||
		cp === 0x23f3 ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff)
	)
		return 2;
	return 1;
}

function visibleWidth(s: string): number {
	// strip ANSI CSI/OSC escapes, then sum cell widths
	const plain = s
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
	let w = 0;
	for (const ch of plain) w += cellWidth(ch.codePointAt(0)!);
	return w;
}

if (!OMP_TUI_PRESENT) {
	plugin({
		name: "atlas-test-stub-pi-tui",
		setup(build) {
			// build.module() replaces the module for EVERY importer in the process, including the real oh-my-pi
			// sources a test loads from the global install (gen-agents.test.ts imports its model-resolver.ts), which
			// die on any export the stand-in lacks ("Export named 'replaceTabs' not found"). So when the host is
			// installed globally, hand out its real package; the stand-in is only for machines with no host at all.
			// (A per-importer onResolve would be narrower, but bun 1.4 does not call runtime onResolve for this import.)
			build.module("@oh-my-pi/pi-tui", () => ({
				exports: existsSync(GLOBAL_HOST_TUI) ? require(GLOBAL_HOST_TUI) : { visibleWidth },
				loader: "object",
			}));
		},
	});
}

if (!OMP_CATALOG_PRESENT) {
	plugin({
		name: "atlas-test-stub-pi-catalog",
		setup(build) {
			// classifyModel(provider, id) -> { family }: the id's leading alphabetic family token
			const classifyModel = (_provider: string, id: string) => ({
				family:
					/^(?:claude-)?([a-z]+)/i
						.exec(String(id))?.[1]
						?.toLowerCase() ?? "unknown",
			});
			build.module("@oh-my-pi/pi-catalog", () => ({
				exports: { classifyModel },
				loader: "object",
			}));
		},
	});
}
