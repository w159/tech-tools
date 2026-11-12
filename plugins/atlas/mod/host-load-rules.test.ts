// The live host (claude 2.1.322) refuses to load a mod that breaks its static rules and drops the WHOLE mod (no band, HUD, cards or panel), while every
// unit test here still passes against fakes. register-hooks.test.ts holds rule 1 (one unmatched `on(event)` per event). This file holds rule 2:
// the context `$` may be passed only to a function declared at the top level of the same file, or imported from the mod's own files. Not
// `deps.x?.($)`, not a local const bound to a dep, not a method call. Rule 3: `$` is never assigned, stored, returned or spread (`engine = $`
// took the whole mod down at 09a0dd86: "$ itself is assigned (bound, passed, spread, returned or read); $ is always spelled $.noun.event(...) at the
// call site"); rule 4: no .json import and no dynamic import() in mod code. It reads the source the host loads: mod/** and omp/*.ts, tests excluded.
import { describe, expect, test } from 'claude-code/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '..'); // plugins/atlas

/** Source with comments and string contents blanked (same length), template `${ }` expressions kept: only code is left to read. */
function codeOnly(src: string): string {
  let out = '';
  const stack: ('tpl' | 'expr')[] = [];
  let depth: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const n = src[i + 1];
    const inTpl = stack[stack.length - 1] === 'tpl';
    if (inTpl) {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === '`') { stack.pop(); out += '`'; continue; }
      if (c === '$' && n === '{') { stack.push('expr'); depth.push(0); out += '${'; i++; continue; }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? src.length : end + 2; out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (src[j] === c ? c : '');
      i = src[j] === c ? j : j - 1; // an unterminated quote (a regex literal) stops at its line end, which is kept
      continue;
    }
    if (c === '`') { stack.push('tpl'); out += '`'; continue; }
    if (stack[stack.length - 1] === 'expr') {
      if (c === '{') depth[depth.length - 1]!++;
      if (c === '}') { if (depth[depth.length - 1] === 0) { stack.pop(); depth.pop(); out += '}'; continue; } depth[depth.length - 1]!--; }
    }
    out += c;
  }
  return out;
}

const KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'await', 'typeof', 'void', 'new', 'yield', 'throw']);

/** Every place `$` is passed as an argument to something the host will not follow, as `file:line  callee($)  why`. */
export function hostLoadViolations(file: string, source: string): string[] {
  const code = codeOnly(source);
  const lineOf = (at: number): number => code.slice(0, at).split('\n').length;
  const allowed = new Set<string>();
  for (const m of code.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) allowed.add(m[1]!); // column 0: top level only
  for (const m of code.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=\n]+)?=>|[A-Za-z_$][\w$]*\s*=>)/gm)) allowed.add(m[1]!); // column 0: a top-level arrow or function expression
  const namespaces = new Set<string>();
  for (const m of source.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[2]!;
    const host = spec === 'claude-code' || spec.startsWith('claude-code/'); // the host's own API (`read($, atom)`, `update($, atom, v)`) takes the context
    if (!host && !spec.startsWith('.')) continue; // any other package is not the mod's own file
    if (!host && !resolve(dirname(file), spec).startsWith(ROOT + sep)) continue; // nor is a path out of the plugin
    const clause = m[1]!;
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) namespaces.add(ns[1]!);
    const def = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def) allowed.add(def[1]!);
    for (const named of clause.match(/\{([^}]*)\}/)?.[1]?.split(',') ?? []) {
      const nm = named.trim().replace(/^type\s+/, '');
      if (nm && !/^type\b/.test(named.trim())) allowed.add(nm.split(/\s+as\s+/).pop()!.trim());
    }
  }
  const found: string[] = [];
  for (const m of code.matchAll(/(?<![\w$.])\$(?![\w$:{])/g)) {
    const at = m.index!;
    let after = at + 1;
    while (/\s/.test(code[after] ?? '')) after++;
    if (code[after] !== ',' && code[after] !== ')') continue; // not an argument position
    let before = at - 1;
    while (before >= 0 && /\s/.test(code[before]!)) before--;
    if (code[before] !== '(' && code[before] !== ',') continue;
    // the paren this argument sits in (a `[` or `{` first means an array or object, not a call)
    let open = -1;
    let level = 0;
    for (let k = before; k >= 0; k--) {
      const ch = code[k]!;
      if (ch === ')' || ch === ']' || ch === '}') level++;
      else if (ch === '(' || ch === '[' || ch === '{') {
        if (level === 0) { open = ch === '(' ? k : -1; break; }
        level--;
      }
    }
    if (open < 0) continue;
    // a declaration, not a call: `function f($, x)`, `($) =>`, `method($) {`
    let close = at;
    for (let k = open, lv = 0; k < code.length; k++) { if (code[k] === '(') lv++; else if (code[k] === ')' && --lv === 0) { close = k; break; } }
    const tail = code.slice(close + 1).replace(/^\s+/, '');
    const head = code.slice(0, open).replace(/\s+$/, '');
    if (/\bfunction\s*\*?\s*[\w$]*$/.test(head) || tail.startsWith('=>')) continue;
    if (tail.startsWith('{') && /(?:^|\n)\s*(?:(?:async|static|public|private)\s+)*[A-Za-z_$][\w$]*$/.test(head)) continue;
    // the callee: `name`, `a.b`, `a?.b`, `a?.(` right before the paren
    const callee = head.match(/((?:[A-Za-z_$][\w$]*)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)(\?\.)?$/);
    if (!callee) { found.push(`${relative(ROOT, file)}:${lineOf(at)}  (expression)($)  the callee is not a named function`); continue; }
    const name = callee[1]!.replace(/\s+/g, '');
    if (KEYWORDS.has(name)) continue;
    const root = name.split(/\??\./)[0]!;
    const plain = !/[?.]/.test(name);
    const ok = plain ? allowed.has(name) : namespaces.has(root) && !name.includes('?.');
    if (!ok) found.push(`${relative(ROOT, file)}:${lineOf(at)}  ${name}($)  ${plain ? 'not a top-level function of this file or an import from the mod' : 'a member call; $ goes only to a named top-level function or a mod import'}`);
  }
  return found;
}

/** `code` with regex literal bodies blanked (`/x$/` holds no `$` reference): a `/` after an operator, an opening bracket, `,`, `;` or a keyword starts one. */
function noRegex(code: string): string {
  let out = '';
  let last = ''; // the last token: a word or one punctuation character
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '/' && code[i + 1] !== '/' && code[i + 1] !== '*' && (last === '' || /^[(,=:\[!&|?{};+\-*%<>~^]$/.test(last) || /^(?:return|typeof|case|void|in|of)$/.test(last))) {
      let j = i + 1;
      let cls = false;
      while (j < code.length && code[j] !== '\n' && (cls || code[j] !== '/')) { if (code[j] === '\\') j++; else if (code[j] === '[') cls = true; else if (code[j] === ']') cls = false; j++; }
      if (code[j] === '/') { out += '/' + ' '.repeat(j - i - 1) + '/'; i = j; last = '/'; continue; }
    }
    out += c;
    if (/[\w$]/.test(c)) { let j = i; while (/[\w$]/.test(code[j + 1] ?? '')) { j++; } out += code.slice(i + 1, j + 1); last = code.slice(i, j + 1); i = j; } else if (!/\s/.test(c)) last = c;
  }
  return out;
}

/** Rule 3: every `$` that is bound, stored, returned, spread or read bare (not `$.noun.event(...)`, not an argument or a parameter), as `file:line  why`. */
export function hostBindViolations(file: string, source: string): string[] {
  const code = noRegex(codeOnly(source));
  const lineOf = (at: number): number => code.slice(0, at).split('\n').length;
  const found: string[] = [];
  for (const m of code.matchAll(/(?<![\w$])\$(?![\w$:{])/g)) {
    const at = m.index!;
    if (code[at - 1] === '.' && code.slice(at - 3, at) !== '...') continue; // a property named $, not the context
    let after = at + 1;
    while (/\s/.test(code[after] ?? '')) after++;
    const next = code.slice(after, after + 2);
    let before = at - 1;
    while (before >= 0 && /\s/.test(code[before]!)) before--;
    const prev = code.slice(Math.max(0, before - 6), before + 1);
    const nextBad = after >= code.length || /^[;}\]|&+\-*\/<>!]/.test(next) || (next[0] === '?' && next[1] !== '.') || (next[0] === '=' && next[1] !== '>');
    const prevBad = /(?:[^=!<>]=|\.\.\.|[\[:?|&]|\breturn|\byield|\bawait|\btypeof|=>)$/.test(prev);
    if (next[0] === '.' || next === '?.') continue; // `$.noun.event(...)` and `$.plugin.root`: the context spelled at the use site
    if (nextBad || prevBad) found.push(`${relative(ROOT, file)}:${lineOf(at)}  $ is assigned, stored, returned, spread or read; the host drops the whole mod`);
  }
  return found;
}

/** Rule 4 on one file the host loads: no dynamic import(), no .json import. */
export function hostImportViolations(file: string, source: string): string[] {
  const code = noRegex(codeOnly(source));
  const found: string[] = [];
  for (const m of code.matchAll(/(?<![\w$.])import\s*\(/g)) found.push(`${relative(ROOT, file)}:${code.slice(0, m.index!).split('\n').length}  dynamic import(); use an import declaration`);
  for (const m of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"][^'"]+\.json['"]/gm)) found.push(`${relative(ROOT, file)}:${source.slice(0, m.index!).split('\n').length}  .json import; the host refuses it (use a code module)`);
  return found;
}

/** The files the host reaches from the hooks module `entry` through relative import/export declarations (a CLI only a test imports is not loaded). */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s+(?!type\b)[^;'"]*?from\s+['"](\.[^'"]*)['"]|^import\s+['"](\.[^'"]*)['"]/gm)) {
      const base = resolve(dirname(file), (m[1] ?? m[2])!);
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((c) => { try { return statSync(c).isFile(); } catch { return false; } });
      if (hit && /\.tsx?$/.test(hit)) queue.push(hit);
    }
  }
  return [...seen];
}

function sources(dir: string, deep: boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return deep && name !== 'fixtures' && name !== 'node_modules' ? sources(p, deep) : [];
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

describe('host load rule 2: $ is passed only to a top-level function of the same file or a mod import', () => {
  test('the seeded violations are caught', () => {
    const file = join(ROOT, 'mod', 'seed.ts');
    const head = "import { lookOf } from './look';\nfunction local($: unknown) { return $; }\n";
    const bad = [
      'deps.onPrompt?.($);', // an optional member call
      'const f = deps.onPrompt; f($);', // a local const bound to a dep
      'deps.onPrompt($, 1);',
      'registry.get(k)($);',
      'const g = (x: unknown) => x;\n  g($);', // a const arrow declared inside the handler, not at the top level
    ];
    for (const stmt of bad) {
      const out = hostLoadViolations(file, `${head}export async function reg(on: any, deps: any) {\n  on('x', async ($: any) => {\n    ${stmt}\n  });\n}\n`);
      expect([stmt, out.length]).toEqual([stmt, 1]);
    }
  });
  test('the allowed shapes pass', () => {
    const file = join(ROOT, 'mod', 'seed.ts');
    const src = [
      "import { lookOf, type Look } from './look';",
      "import * as ns from './look';",
      "import { a as renamed } from '../contracts/core-fixture';",
      'function local($: unknown) { return $; }',
      'async function later($: unknown, n: number) { return n; }',
      'export function reg(on: any) {',
      "  on('x', async ($: any) => {",
      '    local($); await later($, 1); await lookOf($); renamed($); ns.lookOf($);',
      "    const s = 'deps.x?.($)'; // deps.y?.($)",
      '    if (ok($)) { /* z($) */ }',
      '  });',
      '}',
    ].join('\n');
    expect(hostLoadViolations(file, src.replace('ns.lookOf($)', 'lookOf($)').replace('if (ok($)) {', 'if (local($)) {'))).toEqual([]);
  });
  test('every source file the host loads passes', () => {
    const files = [...sources(join(ROOT, 'mod'), true), ...sources(join(ROOT, 'omp'), false)];
    expect(files.length).toBeGreaterThan(50);
    const out = files.flatMap((f) => hostLoadViolations(f, readFileSync(f, 'utf8')));
    expect(out).toEqual([]);
  });
  test('every source file the host loads never assigns, stores, returns or spreads $', () => {
    const files = [...sources(join(ROOT, 'mod'), true), ...sources(join(ROOT, 'omp'), false)];
    expect(files.flatMap((f) => hostBindViolations(f, readFileSync(f, 'utf8')))).toEqual([]);
  });
  test('every file reachable from mod/register.ts has no .json import and no dynamic import()', () => {
    const files = reachable(join(ROOT, 'mod', 'register.ts'));
    expect(files.length).toBeGreaterThan(30);
    expect(files.flatMap((f) => hostImportViolations(f, readFileSync(f, 'utf8')))).toEqual([]);
  });
  test('rule 3 and 4: the 09a0dd86 shape and its siblings are caught, the call-site shapes pass', () => {
    const file = join(ROOT, 'mod', 'seed.ts');
    const wrap = (stmt: string): string => `export function reg(on: any) {\n  let engine: any = null;\n  on('x', async ($: any, e: any) => {\n    ${stmt}\n  });\n}\n`;
    const bad = ['engine = $', 'const c = $;', 'return $', 'const { ui } = $;', 'const o = { ctx: $ };', 'const o = { $ };', 'const a = [$];', 'const f = () => $;', 'const k = $ || null;', 'const s = { ...$ };'];
    for (const stmt of bad) expect([stmt, hostBindViolations(file, wrap(stmt)).length]).toEqual([stmt, 1]);
    const good = ["$.ui.invalidate('ui.render')", "void Promise.resolve().then(() => { try { $.ui.invalidate('x') } catch {} })", 'await lookOf($)', "const t = await $.clock.now()", "const q = $?.ui?.log('x')", "const note = 'engine = $'; // engine = $"];
    for (const stmt of good) expect([stmt, hostBindViolations(file, wrap(stmt).replace('export function', "import { lookOf } from './look';\nexport function"))]).toEqual([stmt, []]);
    expect(hostImportViolations(file, "import c from '../contracts/operating-contract.json';\n").length).toBe(1);
    expect(hostImportViolations(file, "import type c from '../contracts/operating-contract.json';\nconst m = await import('./x');\n").length).toBe(1);
  });
});
