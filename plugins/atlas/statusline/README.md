# atlas statusline (opt-in)

A compact, colored one-line status line for atlas sessions. It renders:

```
atlas | <git-branch> | <output-style-or-model>
```

Colors use the atlas palette (dark green wordmark, gold accents). The `<mode>`
field shows the active output style name when one is selected (for example
`Atlas Orchestrator`), otherwise it falls back to the model display name.

This is OPT-IN. Nothing here is wired up automatically. The atlas plugin does not
set a default status line, and installing the plugin does not change your existing
`statusLine` setting. Enable it yourself with the snippet below.

## Enable it

The script reads Claude Code's session JSON from stdin and prints the status line.
`jq` is used when available; without `jq` the script still renders using a minimal
fallback parser.

1. Make the script executable (once):

   ```bash
   chmod +x "<plugin-dir>/statusline/atlas-statusline.sh"
   ```

2. Add a `statusLine` block to your settings.

   Inside the plugin, `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin directory, so
   the cleanest path is:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "${CLAUDE_PLUGIN_ROOT}/statusline/atlas-statusline.sh",
       "padding": 0
     }
   }
   ```

   If you prefer an absolute path in your user settings (`~/.claude/settings.json`),
   point `command` at the script's full path on disk instead:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "/absolute/path/to/plugins/atlas/statusline/atlas-statusline.sh",
       "padding": 0
     }
   }
   ```

A `statusLine` setting only takes effect when you add it yourself. To revert, remove
the `statusLine` block from your settings. The status line renders in its own row
above Claude Code's built-in footer badges; it does not replace them.

## Pair it with the orchestrator output style

The `<mode>` field is most useful alongside the `Atlas Orchestrator` output style
shipped in `output-styles/atlas-orchestrator.md`. Select it from `/config` under
Output style; the status line then reads `atlas | <branch> | Atlas Orchestrator`.
