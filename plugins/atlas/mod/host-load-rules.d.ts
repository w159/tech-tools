// Ambient types for the node modules mod/host-load-rules.test.ts reads sources with (the mod has no @types/node; bun supplies them at run time).
declare module 'node:fs' {
	export function readdirSync(path: string): string[];
	export function readFileSync(path: string, encoding: 'utf8'): string;
	export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}
declare module 'node:path' {
	export const sep: string;
	export function dirname(path: string): string;
	export function join(...parts: string[]): string;
	export function relative(from: string, to: string): string;
	export function resolve(...parts: string[]): string;
}
interface ImportMeta {
	readonly dir: string;
}
