#!/usr/bin/env python3
"""Release gate: load the Atlas mod's hooks module the way a Claude Code session does.

A hooks module that throws at import time (a top-level throw, a broken import) is
dropped by the host and the band never renders; the unit suite does not catch it
because the tests import modules one at a time. This gate:

  a. every hooks.json "modules" entry exists (a malformed hooks.json is a FAIL);
  b. smoke: bundles each entry with bun (fails on a broken import or syntax error);
  c. smoke: imports the bundle in a fresh process against a hand-written
     'claude-code' stub, calls the module's register(on, options) with a recording
     fake host, fails unless it registers handlers, then renders the band for a
     fixture snapshot and fails on empty output. The stub is NOT the host and has
     accepted code the host rejects, so b and c are smoke checks only;
  d. with --live, loads the modules in the real host: a trimmed temp copy of the
     plugin (hooks.json, mod/, contracts/, omp/, types/; every test file removed)
     plus one probe test beside EVERY module in hooks.json goes through
     `claude plugin test` under an isolated HOME/CLAUDE_CONFIG_DIR. The run passes
     only if the CLI exits 0, reports no failure and executed at least one pass per
     probe. The host refuses modules the offline load accepts (e.g.
     `$.env.get(name)` with a non-literal name), so this is the authoritative check.
     `claude plugin test` needs no login and no network, so a failed run is never
     classified as "cannot run here". Without --require-live a SKIP (CLI missing,
     spawn failure or timeout) exits 0; with --require-live it is a FAIL.

Exit 0 only when every non-skipped check passes. Never touches ~/.claude.
Usage: atlas_mod_gate.py [--root plugins/atlas] [--live] [--require-live]
"""
from __future__ import annotations

import argparse
import json
import os
import re
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

# `claude plugin test` needs no login and no network (verified: with an empty HOME, no credentials and an
# unreachable proxy it still runs and passes), so it prints no auth or network text and none is matched.
# The only "could not run here" outcomes are a spawn failure (127) and a timeout (124).
CANNOT_RUN = (124, 127)
PASS_COUNT = re.compile(r"^\s*(\d+)\s+pass\b", re.M)


def classify_live(rc: int, txt: str, probes: int, require_live: bool) -> tuple[str, str]:
    """Verdict for the live run: only a run that really executed every probe passes."""
    low = txt.lower()
    failed_marker = "hookserror" in low or "(fail)" in low
    if rc == 0 and not failed_marker:
        m = PASS_COUNT.search(txt)
        passed = int(m.group(1)) if m else 0
        if passed >= probes:
            return PASS, f"{probes} probe(s), " + tail(txt, 3).replace("\n", " | ")
        return FAIL, f"exit 0 but {passed} test(s) passed for {probes} probe(s); the live check did not really run: {tail(txt, 4)}"
    if rc in CANNOT_RUN and not failed_marker:
        why = f"cannot run here (exit {rc}): {tail(txt, 4)}"
        return (FAIL, why) if require_live else (SKIP, why)
    hit = next((l.strip() for l in txt.splitlines() if "hooks module did not load" in l), tail(txt))
    return FAIL, f"exit {rc}: {hit}"


def tail(text: str, n: int = 12) -> str:
    return "\n".join(text.strip().splitlines()[-n:])


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None, timeout: int = 300):
    try:
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except OSError as e:  # missing binary, exec format error, permission: the command never ran
        return 127, str(e)
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s: {' '.join(cmd)}"


def report(results: list, name: str, status: str, evidence: str) -> None:
    results.append((name, status))
    print(f"{status} {name}: {evidence}")


def module_entries(root: Path) -> tuple[list[Path], list[str]]:
    hooks_dir = root / "hooks"
    cfg = json.loads((hooks_dir / "hooks.json").read_text())
    if not isinstance(cfg, dict):
        raise ValueError(f"top level is {type(cfg).__name__}, expected an object")
    rels = cfg.get("modules") or []
    if not isinstance(rels, list) or not all(isinstance(r, str) for r in rels):
        raise ValueError('"modules" must be a list of strings')
    return [(hooks_dir / r).resolve() for r in rels], rels


def gate(root: Path, live: bool, require_live: bool = False) -> int:
    results: list = []
    root = root.resolve()
    live = live or require_live
    try:
        entries, rels = module_entries(root)
    except (OSError, ValueError) as e:  # ValueError covers json.JSONDecodeError
        report(results, "hooks-json", FAIL, f"cannot read {root / 'hooks' / 'hooks.json'}: {type(e).__name__}: {e}")
        print("mod gate: FAIL (0 pass, 1 fail, 0 skip)")
        return 1
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
            report(results, f"smoke bundle {entry.name}", PASS if rc == 0 else FAIL,
                   f"bun build exit 0, {out.stat().st_size} bytes" if rc == 0 else f"bun build exit {rc}: {tail(txt)}")
            if rc != 0:
                continue
            moddir = entry.parent
            need = [moddir / "band.tsx", moddir / "live_fixture.ts", moddir / "data" / "live.ts"]
            gone = [str(p) for p in need if not p.is_file()]
            if gone:
                report(results, f"smoke load+render {entry.name}", FAIL, f"band fixtures missing: {', '.join(gone)}")
                continue
            probe_src = tmp / f"probe.{i}.ts"
            q = lambda p: json.dumps(str(p))  # noqa: E731
            probe_src.write_text(PROBE.format(entry=q(entry), band=q(moddir / "band"),
                                              fixture=q(moddir / "live_fixture"), live=q(moddir / "data" / "live")))
            probe_js = tmp / f"probe.{i}.js"
            rc, txt = run([bun, "build", str(probe_src), "--target=node", *ext, "--outfile", str(probe_js)], cwd=root)
            if rc != 0:
                report(results, f"smoke load+render {entry.name}", FAIL, f"probe bundle exit {rc}: {tail(txt)}")
                continue
            rc, txt = run([runner, str(probe_js)], cwd=tmp)
            last = txt.strip().splitlines()[-1] if txt.strip() else ""
            report(results, f"smoke load+render {entry.name}", PASS if rc == 0 else FAIL,
                   last if rc == 0 else f"{Path(runner).name} exit {rc}: {tail(txt)}")
        if live:
            claude = shutil.which("claude")
            if not claude:
                st = FAIL if require_live else SKIP
                report(results, "live claude plugin test", st, "claude CLI not on PATH")
            else:
                trim = tmp / "host" / "atlas"
                for rel in HOST_COPY:
                    src = root / rel
                    if src.is_dir():
                        shutil.copytree(src, trim / rel, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
                    elif src.is_file():
                        (trim / rel).parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src, trim / rel)
                for entry in entries:  # a module outside the copied dirs still has to be in the trimmed plugin
                    try:
                        rel_dir = entry.parent.relative_to(root)
                    except ValueError:
                        continue
                    if not (trim / rel_dir).exists():
                        shutil.copytree(entry.parent, trim / rel_dir, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
                for t in [*trim.rglob("*.test.ts"), *trim.rglob("*.test.tsx")]:
                    t.unlink()
                probes = 0
                for j, rel in enumerate(rels):
                    moddir = (trim / "hooks" / rel).resolve().parent
                    (moddir / f"zz_gate_probe_{j}.test.ts").write_text(HOST_PROBE)
                    probes += 1
                home = tmp / "home"
                cfg = tmp / "claude-config"
                home.mkdir()
                cfg.mkdir()
                env = {**os.environ, "HOME": str(home), "CLAUDE_CONFIG_DIR": str(cfg)}
                rc, txt = run([claude, "plugin", "test", str(trim)], env=env, timeout=900)
                st, ev = classify_live(rc, txt, probes, require_live)
                report(results, "live claude plugin test", st, ev)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, s in results if s == FAIL]
    print(f"mod gate: {'FAIL' if failed else 'PASS'} (offline checks are smoke only; {sum(s == PASS for _, s in results)} pass, "
          f"{len(failed)} fail, {sum(s == SKIP for _, s in results)} skip)")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="plugin root holding hooks/hooks.json and mod/ (default: this plugin)")
    ap.add_argument("--live", action="store_true", help="also load the module in the real host (`claude plugin test` on a trimmed temp copy, isolated HOME)")
    ap.add_argument("--require-live", action="store_true",
                    help="implies --live; a live check that is skipped (CLI missing, cannot spawn, timeout) is a FAIL, never a pass")
    args = ap.parse_args(argv)
    return gate(args.root, args.live, args.require_live)


if __name__ == "__main__":
    sys.exit(main())
