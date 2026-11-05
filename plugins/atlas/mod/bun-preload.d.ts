// Minimal ambient types for the two bun-only modules mod/test-shim.ts (the `bun test` preload) imports.
// Only the surface the shim touches; the real types ship with bun, which is not a dependency of the mod.
declare module 'bun:test' {
	export const describe: (name: string, body: () => void) => void;
	export const expect: (actual: unknown) => Record<string, (...args: unknown[]) => unknown>;
	export const test: ((name: string, body: (...args: unknown[]) => unknown) => void) & { skip(name: string, body: () => void): void };
	export const mock: unknown;
}
declare module 'bun' {
	export interface PluginBuilder {
		module(specifier: string, factory: () => { exports: Record<string, unknown>; loader: 'object' }): void;
	}
	export function plugin(options: { name: string; setup(build: PluginBuilder): void }): void;
}
