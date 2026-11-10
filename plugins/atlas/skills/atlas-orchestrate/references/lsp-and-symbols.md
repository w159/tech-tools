# LSP & Symbol Intelligence

The single biggest token lever in a long run is **never reading a file you can query**. A
language server (or lean-ctx's shaped reads) answers "where is this defined / who calls it /
what's the signature / does this edit type-check" with one structured call that replaces 3-10
full-file reads - and the bytes never enter context. This is law 1 (protect your context) made
concrete.

## What's available, in priority order

1. **lean-ctx MCP** - shaped code navigation across every language, without pulling raw bytes
   into context. Primary tool when connected:
   - `ctx_compose` - orient in an unfamiliar tree in one call.
   - `ctx_read` `mode=signatures` / `mode=map` - the shape of a file without reading its body.
   - `ctx_search` (`action=semantic` when meaning matters) - locate a symbol or pattern.
   - `ctx_callgraph` - callers and callees for impact analysis.
2. **The native `LSP` tool** - when a language server is wired for the active language, use it
   for go-to-definition, find-references, hover/signature, and diagnostics. One call, no read.
3. **LSP plugins** (`enabledPlugins`) - `typescript-lsp`, `pyright-lsp`, `gopls-lsp`,
   `rust-analyzer-lsp`, etc. They add automatic post-edit diagnostics for their language. If a
   language is in active use and its LSP plugin is **absent**, that gap is itself a finding ->
   `references/claude-code-tuning.md`.
4. **`smart-explore` skill** - tree-sitter AST structure when you want shape without an LSP.

### lean-ctx vs the native `LSP` tool - they are not substitutes

They answer different questions, so "pick one" is the wrong instinct:

| You have | You want | Tool |
|---|---|---|
| a symbol **name** | where it lives and who calls it | `ctx_search` then `ctx_callgraph` (lean-ctx) |
| a **position** (file, line, char) | locations that reference it | `LSP findReferences` |
| a file | its outline | `ctx_read` `mode=signatures` (lean-ctx) or `LSP documentSymbol` |
| a known span | its body | `ctx_read` with a line range (lean-ctx) |

The native `LSP` tool requires `(filePath, line, character)` and returns *locations*. Use
lean-ctx to go from a name to a location and a shaped body; use `LSP` for position-anchored
facts, call hierarchy and diagnostics once you are already anchored.

## The hard rule for every navigating subagent

Put this directive in the dispatch spec for any explore/implement/review/verify job on an
LSP-capable language:

> Use find-references / go-to-definition / signature views (lean-ctx or the LSP tool), **not**
> grep-then-read. Read a full file body only as a last resort, and only the relevant span.
> After any edit, check LSP diagnostics for the touched file before reporting done.

`grep` + `Read` is the anti-pattern: it pulls whole files into context to answer a question a
structured call answers directly. Reserve raw grep for genuinely non-semantic searches (a
string in config, a TODO sweep) and route even those through `context-mode` when noisy.

## Keeping generated/vendor bytes out of context entirely

LSP discipline is undermined if build artifacts can still be read into context. Pair it with
`permissions.deny` Read rules (apply via `references/claude-code-tuning.md`):

```
Read(./**/dist/**)   Read(./**/build/**)   Read(./**/*.generated.*)
Read(./**/node_modules/**)   Read(./**/.venv*/**)   Read(./vendor/**)
```

## The post-edit diagnostics loop (verify by the language server, not by eye)

After `atlas:implementer` (or any editor) makes a change, the cheapest real verification is the
language server's own diagnostics on the edited file:

1. Make a minimal targeted Edit (never a whole-file rewrite).
2. Pull diagnostics for that file (the LSP tool / the LSP plugin's automatic post-edit report).
3. A clean diagnostics pass is necessary-but-not-sufficient - still run the project's real gate
   (typecheck/lint/test/build, derived from manifests) per `references/execution-testing.md`.
   "Type-checks" is not "works"; observed behavior is the final word.

If no LSP/diagnostics capability exists for a language in active use, record that absence as a
finding and route to `claude-code-tuning.md` - don't silently fall back to read-everything.
