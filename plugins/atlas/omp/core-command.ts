/**
 * `/atlas-core`: the four Atlas pillars (contract, verdicts, offload, route) as plain text, from a fresh read of
 * <root>/.atlas/.run. The text is coreReport() from mod/core-row.ts, so it matches the Claude mod's /atlas-core.
 */
import { statSync } from "node:fs";
import * as nodePath from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { coreReport } from "../mod/core-row";
import { hasCore } from "../mod/data/core";
import { openGateCount, parseGates } from "../mod/gates";
import { type CoreSource, createCoreSource } from "./core-source";
import { spawnText } from "./mission-panel";
import { pluginScript } from "./plugin-path";
import { gatesArmed } from "./scope";

export interface CoreCommandDeps {
	source?: CoreSource;
	/** Open gate count for `root`; default runs atlas_gates.py (armed projects only). */
	openGates?: (root: string, cwd: string) => Promise<number>;
	/** Board root for `cwd`; default: nearest ancestor with docs/ (index.ts docsRoot), else cwd. */
	rootOf?: (cwd: string) => string;
}

function docsRootOr(cwd: string): string {
	let root = nodePath.resolve(cwd);
	for (;;) {
		try {
			if (statSync(nodePath.join(root, "docs")).isDirectory()) return root;
		} catch {
			// no docs/ here: keep walking
		}
		const parent = nodePath.dirname(root);
		if (parent === root) return nodePath.resolve(cwd);
		root = parent;
	}
}

async function gateCount(root: string, cwd: string): Promise<number> {
	if (!gatesArmed(cwd)) return 0;
	try {
		return openGateCount(parseGates(await spawnText(["python3", pluginScript("atlas_gates.py"), "--session", "-", "--root", root, "--json"])));
	} catch {
		return 0;
	}
}

export function registerAtlasCoreCommand(pi: Pick<ExtensionAPI, "registerCommand">, deps: CoreCommandDeps = {}): void {
	const source = deps.source ?? createCoreSource();
	const openGates = deps.openGates ?? gateCount;
	const rootOf = deps.rootOf ?? docsRootOr;
	pi.registerCommand("atlas-core", {
		description: "Show the Atlas core: contract, verdicts, offload and route",
		handler: async (_args, ctx) => {
			try {
				const root = rootOf(ctx.cwd);
				const model = source.build(root, { openGates: await openGates(root, ctx.cwd) });
				ctx.ui.notify(coreReport(hasCore(model) ? model : null), "info");
			} catch (error) {
				ctx.ui.notify(`/atlas-core: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		},
	});
}
