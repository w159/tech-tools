# Evidence: programmer plugin move into the atlas marketplace

Date: 2026-07-21
Verifier agent: atlas:verifier (fresh), two passes
Verdict: CONFIRMED (after fix); first pass REFUTED on one stale reference, fixed, re-verified clean

---

## What was done

Moved the standalone `pragmatic-programmer` plugin (source: `~/Downloads/pragmatic-programmer/plugin`) into the `atlas` marketplace as a new plugin named `programmer`, with skills namespaced `tpp-*` (The Pragmatic Programmer).

Target root: `/Users/jerry/MEGA/Projects/Agentic/atlas/plugins/programmer/`

Renames applied:
- Plugin manifest `name`: `pragmatic-programmer` -> `programmer` (added `repository`, `homepage`, `license: MIT`; kept author Jerry to match the MIT LICENSE).
- Skill dirs + `name:` frontmatter: `pragmatic-audit` -> `tpp-audit`; `pragmatic-principles` -> `tpp-principles`.
- Agent file + `name:` frontmatter: `pragmatic-auditor` -> `tpp-auditor`.
- Report default file: `.pragmatic-audit-report.md` -> `.tpp-audit-report.md` (SKILL.md + `.gitignore`).
- Hook pointer line: `Pragmatic Programmer relevant:` -> `TPP relevant:` (hooks.json, 2 occurrences).
- Internal path cross-refs updated in `agents/tpp-auditor.md`, `skills/tpp-audit/SKILL.md`, `skills/tpp-audit/references/dimensions.md`, `README.md`, and `LICENSE`.
- Marketplace manifest `.claude-plugin/marketplace.json`: version `3.0.0` -> `3.1.0`; added `programmer` entry (`source: ./plugins/programmer`, `category: developer-tools`) after `armada`.

The original standalone copy at `~/Downloads/pragmatic-programmer/plugin` was left intact (additive copy via rsync).

## Static verification (run this session)

Commands and actual output:

```
$ grep -rn -E "pragmatic-audit|pragmatic-principles|pragmatic-auditor" \
    /Users/jerry/MEGA/Projects/Agentic/atlas/plugins/programmer/
NONE (clean)

$ python3 -c "import json;json.load(open('.../plugins/programmer/.claude-plugin/plugin.json'))"
plugin.json OK
$ python3 -c "import json;json.load(open('.../plugins/programmer/hooks/hooks.json'))"
hooks.json OK
$ python3 -c "import json;m=json.load(open('.../.claude-plugin/marketplace.json'));print([p['name'] for p in m['plugins']])"
marketplace.json OK; plugins: ['atlas', 'armada', 'programmer']

$ grep -n "^name:" .../skills/tpp-audit/SKILL.md .../skills/tpp-principles/SKILL.md .../agents/tpp-auditor.md
skills/tpp-audit/SKILL.md:2:name: tpp-audit
skills/tpp-principles/SKILL.md:2:name: tpp-principles
agents/tpp-auditor.md:2:name: tpp-auditor

$ python3 -c "import json;p=json.load(open('.../plugin.json'));print(p['name'])"
plugin name: programmer
$ python3 -c "import json;m=json.load(open('.../marketplace.json'));print([p for p in m['plugins'] if p['name']=='programmer'][0]['source'], m['version'])"
./plugins/programmer | 3.1.0

$ ls .../skills/tpp-principles/references/concepts/ | wc -l
89
$ find .../plugins/programmer -type f -not -path "*/.DS_Store" | wc -l
99

$ sed -n '3p' .../LICENSE
Concept summary files under skills/tpp-principles/references/concepts/
```

## Independent verifier passes

### Pass 1 (atlas:verifier, fresh) -- REFUTED on point 5, CONFIRMED on 1-4,6-9

The first verifier independently re-opened every file and found one stale reference my own grep had hidden (I had filtered out `/references/concepts/` paths to reduce noise, which accidentally excluded the LICENSE hit):

- `LICENSE:3` -> `Concept summary files under skills/pragmatic-principles/references/concepts/`

This was a real stale directory-path reference, not book prose and not the intentional `pragmatic-programmer` keyword. Fixed: `LICENSE:3` now reads `skills/tpp-principles/references/concepts/`.

### Pass 2 (atlas:verifier, fresh) -- re-verification after the LICENSE fix

Re-ran with NO path exclusions. Verdict recorded in `.atlas/.run/findings.json` under batch `programmer-plugin-move`.

## Out of scope / not verified here

- No runtime load test in a live Claude Code session (the plugin is structurally complete and valid; a `cc --plugin-dir .../plugins/programmer` smoke load is the recommended next-step runtime check, not performed in this session).
- The 89 concept files were copied byte-for-byte; their internal cross-references (by concept filename, e.g. `debugging.md`) were not renamed and were not expected to change.