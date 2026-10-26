# Output-style audit (2026-10-13) — intended path docs/audits/2026-10-13_output-style-audit.md (explorer may not write repo files; lead please copy)

Repo plugin 11.1.7 (00592fa1). Read-only.

## 1. Style file
- plugins/atlas/output-styles/atlas-orchestrator.md:13-30 mandates `ATLAS | <glyph> <phase> | <state>` (l.18), n/m form (l.22), "no header exemption" (l.29). Frontmatter l.4-5 force-for-plugin: true, keep-coding-instructions: true.
- git log --follow: only 6a38a258 (2026-10-10) changed it since 10.0.0, and it made the header rule stricter. Not the cause.
- Cached 11.1.7 copy is byte-identical to repo (diff -q silent).

## 2. Activation
- plugin.json has no outputStyles key; Claude Code auto-discovers output-styles/.
- hooks/session_boot.py:237-280: does not set outputStyle; read_output_style reads settings.json; status_contract_lines returns [] when outputStyle == "Atlas Orchestrator" (l.271-272), so no hook backup of the header rule.
- ~/.claude/settings.json:799 `"outputStyle": "Atlas Orchestrator"` (matches exactly). ~/.claude/output-styles/ has only concise.md.
- MOD: plugins/atlas/mod/restyle.tsx:182-209 assistantTree: tests first line against contract.headerFirstLinePattern (l.187); on match (l.204-209) `rest = props.text.slice(first.length)` DROPS the `ATLAS | ... | ...` line and renders only a pill ` ▸ <phase> <n/m> ` (MARK at l.44). Glyph, pipes and state text never display. On non-match for first message (l.188-197) renders dim `▸ <phase> · inferred` pill. Wired at mod/register.ts:319 (ui.render AssistantMessage); headerPhaseOf at register.ts:93-107. Pill code arrived 6a38a258 (2026-10-10); pattern field e0b28570 (2026-10-06).

## 3. Installed
- installed_plugins.json: atlas@tech-tools 11.1.7, installPath cache/tech-tools/atlas/11.1.7, sha 00592fa1, updated 2026-10-13T12:30Z = repo plugin.json:3. enabledPlugins atlas@tech-tools true (settings.json:714). 21 stale cache dirs (8.0.1..11.1.6), unused. No skew.

## 4. Ranked causes
1. Mod swaps header for pill (restyle.tsx:204-209). Fix: keep `first` visible, e.g. kids.push(txt({}, first)) next to the pill, or return null on match. Confirm with ATLAS_MOD=off (register.ts:559).
2. Fake "inferred" pill on header-less replies (restyle.tsx:188-197). Fix: return null.
3. Boot hook gives no header backup when outputStyle matches (session_boot.py:271-272). Fix: drop early `return []`, always emit one-line header rule.
4. [INFERENCE] setting may need plugin namespace (`atlas:Atlas Orchestrator`); unverified. Check /output-style listing.
Ruled out: style text weakened, stale install, version skew.
