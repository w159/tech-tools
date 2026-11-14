#!/usr/bin/env python3
"""Release gate: load the Atlas mod's hooks module the way a Claude Code session does.

A hooks module that throws at import time (a top-level throw, a broken import) is
dropped by the host and the band never renders; the unit suite does not catch it
because the tests import modules one at a time. This gate:

  a. every hooks.json "modules" entry exists;
  b. bundles each entry with bun (fails on a broken import or syntax error);
  c. imports the bundle in a fresh process against a 'claude-code' stub, calls the
     module's register(on, options) with a recording fake host, fails unless it
     registers handlers, then renders the band for a fixture snapshot and fails
     on empty output;
  d. with --live, loads the module in the real host: a trimmed temp copy of the
     plugin (hooks.json, mod/, contracts/, omp/, types/; every test file removed)
     plus one probe test goes through `claude plugin test` under an isolated
     HOME/CLAUDE_CONFIG_DIR. The host refuses modules the offline load accepts
     (e.g. `$.env.get(name)` with a non-literal name), so this is the authoritative
     check; SKIP with the reason when the CLI is missing or cannot run headless.

Exit 0 only when every non-skipped check passes. Never touches ~/.claude.
Usage: atlas_mod_gate.py [--root plugins/atlas] [--live]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"

# 'claude-code' stub: the three value imports register.ts and its modules make
# (atom, read, update), same semantics as mod/test-shim.ts.
STUB_INDEX = """\
export const atom = (ref, initial, o) => Object.freeze({ ref, initial, ...(o ? { shape: o.shape } : {}) });
export const read = async ($, source) => {
  const ref = source && 'initial' in source ? source.ref : source;
  const cell = await $.state.get(ref);
  return cell.value === undefined && source && 'initial' in source ? source.initial : cell.value;
};
export const update = async ($, target, change) => {
  const isA = target && 'initial' in target;
  const ref = isA ? target.ref : target;
  const cell = await $.state.get(ref);
  const next = change(cell.value === undefined && isA ? target.initial : cell.value);
  await $.state.set(ref, next, { ifVersion: cell.version });
  return next;
};
"""

PROBE = """\
import * as mod from {entry};
import {{ bandTree }} from {band};
import {{ busySnap, NOW }} from {fixture};
import {{ liveWorkers }} from {live};

if (typeof mod.register !== 'function') throw new Error('module exports no register(on, options) function');
const events = [];
const on = (...a) => {{ events.push(String(a[0])); }};
await mod.register(on, {{}});
if (events.length === 0) throw new Error('register() ran but registered no handlers');
const mk = (kind) => (props) => ({{ kind, props }});
const els = {{ Box: mk('Box'), Text: mk('Text') }};
const snapshot = busySnap();
const node = bandTree(els, {{ snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: 160, tick: 3, maxRows: 12,
  ui: {{ theme: 'mocha', ascii: false, color: 'truecolor' }} }});
const txt = (n) => typeof n === 'string' ? n : Array.isArray(n) ? n.map(txt).join('') : n && n.props ? txt(n.props.children) : '';
const rows = (node.props.children || []).map(txt).filter((r) => r.trim() !== '');
if (rows.length === 0) throw new Error('band rendered no text');
console.log(JSON.stringify({{ handlers: events.length, rows: rows.length, first: rows[0].trim().slice(0, 80) }}));
"""

HOST_PROBE = """\
import { expect, mock, test } from 'claude-code/testing';

const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});

// Booting the real hooks module is what makes the host compile and check it; a test body without ($, on) never loads it.
test('atlas mod: the hooks module loads in the host and the band renders', async ($, on) => {
  mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    if (String((e as { path: string }).path).endsWith('/contracts/operating-contract.json')) return { value: CONTRACT } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async () => { throw new Error('no such file'); });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: [] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: 160, hasSurvey: false, maxRows: 30 } as never });
  const text = (await ui.findAll({})).map((n) => n.text ?? '').join('\\n');
  await ui.unmount();
  expect(text).toContain('ATLAS');
});
"""
HOST_COPY = ("hooks/hooks.json", "mod", "contracts", "omp", "types", "package.json")

AUTH_HINTS = ("not logged in", "login", "log in", "authenticat", "api key", "unauthorized", "401", "oauth",
              "enotfound", "econnrefused", "etimedout", "network", "proxy", "unable to connect")


def tail(text: str, n: int = 12) -> str:
    return "\n".join(text.strip().splitlines()[-n:])


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None, timeout: int = 300):
    try:
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError as e:
        return 127, str(e)
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s: {' '.join(cmd)}"


def report(results: list, name: str, status: str, evidence: str) -> None:
    results.append((name, status))
    print(f"{status} {name}: {evidence}")


def module_entries(root: Path) -> tuple[list[Path], list[str]]:
    hooks_dir = root / "hooks"
    cfg = json.loads((hooks_dir / "hooks.json").read_text())
    rels = cfg.get("modules") or []
    return [(hooks_dir / r).resolve() for r in rels], rels


def gate(root: Path, live: bool) -> int:
    results: list = []
    root = root.resolve()
    entries, rels = module_entries(root)
    if not entries:
        report(results, "modules-declared", FAIL, "hooks.json declares no \"modules\"")
        return 1
    missing = [str(e) for e in entries if not e.is_file()]
    report(results, "modules-exist", FAIL if missing else PASS,
           f"missing: {', '.join(missing)}" if missing else f"{len(entries)} module(s): {', '.join(rels)}")
    if missing:
        return 1
    bun = shutil.which("bun")
    if not bun:
        report(results, "bun-available", FAIL, "bun not on PATH")
        return 1
    runner = shutil.which("node") or bun
    tmp = Path(tempfile.mkdtemp(prefix="atlas-mod-gate-"))
    try:
        stub = tmp / "node_modules" / "claude-code"
        stub.mkdir(parents=True)
        (stub / "package.json").write_text(json.dumps({"name": "claude-code", "type": "module", "main": "index.js"}))
        (stub / "index.js").write_text(STUB_INDEX)
        ext = ["--external", "claude-code", "--external", "claude-code/*"]
        for i, entry in enumerate(entries):
            out = tmp / f"register.probe.{i}.js"
            rc, txt = run([bun, "build", str(entry), "--target=node", *ext, "--outfile", str(out)], cwd=root)
            report(results, f"bundle {entry.name}", PASS if rc == 0 else FAIL,
                   f"bun build exit 0, {out.stat().st_size} bytes" if rc == 0 else f"bun build exit {rc}: {tail(txt)}")
            if rc != 0:
                continue
            moddir = entry.parent
            need = [moddir / "band.tsx", moddir / "live_fixture.ts", moddir / "data" / "live.ts"]
            gone = [str(p) for p in need if not p.is_file()]
            if gone:
                report(results, f"load+render {entry.name}", FAIL, f"band fixtures missing: {', '.join(gone)}")
                continue
            probe_src = tmp / f"probe.{i}.ts"
            q = lambda p: json.dumps(str(p))  # noqa: E731
            probe_src.write_text(PROBE.format(entry=q(entry), band=q(moddir / "band"),
                                              fixture=q(moddir / "live_fixture"), live=q(moddir / "data" / "live")))
            probe_js = tmp / f"probe.{i}.js"
            rc, txt = run([bun, "build", str(probe_src), "--target=node", *ext, "--outfile", str(probe_js)], cwd=root)
            if rc != 0:
                report(results, f"load+render {entry.name}", FAIL, f"probe bundle exit {rc}: {tail(txt)}")
                continue
            rc, txt = run([runner, str(probe_js)], cwd=tmp)
            last = txt.strip().splitlines()[-1] if txt.strip() else ""
            report(results, f"load+render {entry.name}", PASS if rc == 0 else FAIL,
                   last if rc == 0 else f"{Path(runner).name} exit {rc}: {tail(txt)}")
        if live:
            claude = shutil.which("claude")
            if not claude:
                report(results, "live claude plugin test", SKIP, "claude CLI not on PATH")
            else:
                trim = tmp / "host" / "atlas"
                for rel in HOST_COPY:
                    src = root / rel
                    if src.is_dir():
                        shutil.copytree(src, trim / rel, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
                    elif src.is_file():
                        (trim / rel).parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src, trim / rel)
                for t in [*trim.rglob("*.test.ts"), *trim.rglob("*.test.tsx")]:
                    t.unlink()
                moddir = (trim / "hooks" / rels[0]).resolve().parent
                (moddir / "zz_gate_probe.test.ts").write_text(HOST_PROBE)
                home = tmp / "home"
                cfg = tmp / "claude-config"
                home.mkdir()
                cfg.mkdir()
                env = {**os.environ, "HOME": str(home), "CLAUDE_CONFIG_DIR": str(cfg)}
                rc, txt = run([claude, "plugin", "test", str(trim)], env=env, timeout=900)
                low = txt.lower()
                if rc == 0:
                    report(results, "live claude plugin test", PASS, tail(txt, 3).replace("\n", " | "))
                elif "hookserror" not in low and "(fail)" not in low and (rc in (124, 127) or any(h in low for h in AUTH_HINTS)):
                    report(results, "live claude plugin test", SKIP, f"cannot run headless here (exit {rc}): {tail(txt, 4)}")
                else:
                    hit = next((l.strip() for l in txt.splitlines() if "hooks module did not load" in l), tail(txt))
                    report(results, "live claude plugin test", FAIL, f"exit {rc}: {hit}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, s in results if s == FAIL]
    print(f"mod gate: {'FAIL' if failed else 'PASS'} ({sum(s == PASS for _, s in results)} pass, "
          f"{len(failed)} fail, {sum(s == SKIP for _, s in results)} skip)")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="plugin root holding hooks/hooks.json and mod/ (default: this plugin)")
    ap.add_argument("--live", action="store_true", help="also load the module in the real host (`claude plugin test` on a trimmed temp copy, isolated HOME)")
    args = ap.parse_args(argv)
    return gate(args.root, args.live)


if __name__ == "__main__":
    sys.exit(main())
