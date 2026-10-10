// Ambient declarations for the sprite tests: the mod tsconfig pins `types` to
// claude-code only, so the test-only Node/Bun APIs are declared here rather
// than widening the shared config.
declare module 'node:fs' {
  export function readdirSync(path: string): string[];
}
interface ImportMeta {
  readonly dir: string; // bun runtime
}
