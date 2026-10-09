# LSP & Symbol Intelligence

The single biggest token lever in a long run is **never reading a file you can query**. A
language server (or `serena`) answers "where is this defined / who calls it / what's the
signature / does this edit type-check" with one structured call that replaces 3-10 full-file
reads - and the bytes never enter context. This is law 1 (protect your context) made concrete.

## What's available, in priority order

1. **`serena` MCP** - symbol-level navigation and edits across many languages, plus its own
   memory. Primary tool when connected:
   - `get_symbols_overview` - the shape of a file without reading it.
   - `find_symbol` / `find_referencing_symbols` - definition and all callers.
   - `replace_symbol_body` / `insert_after_symbol` - surgical edits by symbol, not line math.
   - `get_diagnostics_for_file` - post-edit type/lint errors straight from the language server.
2. **The native `LSP` tool** - when a language server is wired for the active language, use it
   for go-to-definition, find-references, hover/signature, and diagnostics. One call, no read.
3. **LSP plugins** (`enabledPlugins`) - `typescript-lsp`, `pyright-lsp`, `gopls-lsp`,
   `rust-analyzer-lsp`, etc. They add automatic post-edit diagnostics for their language. If a
   language is in active use and its LSP plugin is **absent**, that gap is itself a finding ->
   `references/claude-code-tuning.md`.
4. **`smart-explore` skill** - tree-sitter AST structure when you want shape without an LSP.

### serena vs the native `LSP` tool - they are not substitutes

They answer different questions, so "pick one" is the wrong instinct:

| You have | You want | Tool |
|---|---|---|
| a symbol **name** | its **body** | `find_symbol(name_path, include_body=true)` (serena) |
| a **position** (file, line, char) | locations that reference it | `LSP findReferences` |
| a symbol name | to **replace/rename/delete** it safely | serena only - the native `LSP` tool is read-only |
| a file | its outline | `get_symbols_overview` (serena) or `LSP documentSymbol` |

The native `LSP` tool requires `(filePath, line, character)` and returns *locations*. To reach a
position you must first Read or Grep - which is the context cost serena removes. Use serena to
go from a name to a body; use `LSP` for position-anchored facts and call hierarchy once you are
already anchored.

### serena preconditions (check before routing work to it)

serena's `claude-code` context deliberately **excludes** `read_file`, `create_text_file`,
`execute_shell_command`, `find_file`, `list_dir` and `search_for_pattern` so it never duplicates
Claude Code's own tools. Naming any of those in a dispatch spec guarantees a failed call.

It also needs an **active project**. Two failure modes, both silent-looking:
- server started without `--project` / `--project-from-cwd` -> every symbol call returns
  `No active project`.
- the repo's `.serena/project.yml` predates serena 1.6 and lacks the required `languages:` key
  -> `KeyError: 'languages'`, the project is skipped at load, and nothing activates.

Both are one-line config fixes. Neither is a reason to route around serena; report the fix.

## The hard rule for every navigating subagent

Put this directive in the dispatch spec for any explore/implement/review/verify job on an
LSP-capable language:

> Use find-references / go-to-definition / symbol-overview (serena or the LSP tool), **not**
> grep-then-read. Read a full file body only as a last resort, and only the relevant span.
> After any edit, check LSP diagnostics for the touched file before reporting done.

`grep` + `Read` is the anti-pattern: it pulls whole files into context to answer a question a
symbol call answers structurally. Reserve raw grep for genuinely non-semantic searches (a
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

1. Edit by symbol (`replace_symbol_body`) or minimal Edit.
2. Pull diagnostics for that file (`get_diagnostics_for_file` / the LSP tool / the LSP plugin's
   automatic post-edit report).
3. A clean diagnostics pass is necessary-but-not-sufficient - still run the project's real gate
   (typecheck/lint/test/build, derived from manifests) per `references/execution-testing.md`.
   "Type-checks" is not "works"; observed behavior is the final word.

If no LSP/diagnostics capability exists for a language in active use, record that absence as a
finding and route to `claude-code-tuning.md` - don't silently fall back to read-everything.
