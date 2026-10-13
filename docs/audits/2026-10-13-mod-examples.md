# Mod Examples & API Audit — 2026-10-13

Authoritative facts on the Claude Code plugin **mods** system (a.k.a. function hooks), collected from the official docs and real example repos, to ground the atlas mod redesign. Every fact carries its source. No plugin source was edited.

Docs are for Claude Code **v2.1.290** (docs state "as of v2.1.290"; mods load from v2.1.287, Desktop app from v2.1.286). [overview](https://code.claude.com/docs/en/plugins/mods/overview)

---

## 1. Official docs — full API surface

All facts in this section come from the docs under `https://code.claude.com/docs/en/plugins/mods/…`. Pages fetched 2026-10-13: `overview`, `create`, `interface`, `events`, `api`, `test`, `reference`, `gallery`. The docs themselves say: **trust the TypeScript declarations Claude Code writes into `.claude-plugin/types/claude-code/index.d.ts` for your build over any docs page when they disagree** ([create](https://code.claude.com/docs/en/plugins/mods/create#get-the-types-for-your-build), [reference](https://code.claude.com/docs/en/plugins/mods/reference)).

### 1.1 What a mod is / where it runs

- A mod is a plugin whose code registers event handlers ("hooks") in-process. Files: `.claude-plugin/plugin.json` + `hooks/hooks.json` (`{"modules": ["./register.js"]}`) + the hooks module exporting `register(on, options)`. `hooks.json` with a `modules` key is *what makes a plugin a mod*. [reference#files](https://code.claude.com/docs/en/plugins/mods/reference#files), [create](https://code.claude.com/docs/en/plugins/mods/create#write-a-mod-yourself)
- Module extensions: `.js .mjs .cjs .jsx .ts .mts .cts .tsx`. ES modules only; the only bare import allowed is `claude-code` (types + `atom/read/update/derive/memberOf`). Import only by relative path inside the plugin; dynamic `import()` fails validation. [reference#files](https://code.claude.com/docs/en/plugins/mods/reference#files), [create#rules](https://code.claude.com/docs/en/plugins/mods/create#check-what-claude-code-reads-from-your-mod)
- Hooks run in every session type that loads the plugin; **drawing appears only in the terminal CLI and the Desktop Code tab** (not VS Code chat panel, not `claude -p`, not cloud sessions). WSL Desktop sessions load no plugins at all. [overview#where-mods-run](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run)
- Mods are **not sandboxed**: they run with your permissions (fs, network, env, session prompts). They can be listed pre-install via `claude plugin validate <dir>` which prints `hooks:` and `calls:` lines (also `env reads/writes:`, `state reads/writes:`, `gating hook without .catch:`). [overview#trust](https://code.claude.com/docs/en/plugins/mods/overview#decide-whether-to-trust-a-mod), [create#validate](https://code.claude.com/docs/en/plugins/mods/create#check-what-claude-code-reads-from-your-mod)
- Built-in mods are themselves mods with public source: `cc-plugin-diff` (the /diff pane), `cc-plugin-agents-md`, `cc-plugin-sec-default` (the guard), `cc-plugin-telemetry`, plus `cc-plugin-plugin-authoring` skill and `cc-plugin-you-should-know`. [overview#built-in](https://code.claude.com/docs/en/plugins/mods/overview#mods-built-into-claude-code)

### 1.2 Render sites (`ui.render`, `e.component`) and props

From [reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites):

| Site | `e.props` | `e.requestId` | Surface |
| :- | :- | :- | :- |
| `Pane` | `title, isFocused, bodyColumns, placement ('dock'\|'inline'), scroll {offset, bodyRows}, view` | the pane's `id` | Terminal, Desktop |
| `AbovePrompt` | `hasSurvey, isWorking, maxRows, bodyColumns, scroll, view` | One instance (one shared band) | Terminal, Desktop |
| `UserMessage` | `text, origin, isExpanded, task\|from` | message id | Terminal, Desktop |
| `AssistantMessage` | reply text | message id | Terminal, Desktop |
| `ToolUse`, `ToolResult`, `ToolGroup` | tool name, input, result | tool call id | Terminal, Desktop |
| `CommandOutput` | `command, text` | message id | Terminal, Desktop |
| `AskUserQuestion` | question + options | tool call id | Terminal, Desktop |
| `ToolProgress` | `kind` | tool call id | **Terminal only** |
| `Spinner` | `word, message, suffix, mode` | agent id | Terminal, Desktop |
| `TurnDuration` | `word, durationMs` | message id | **Terminal only** |
| `InfoNotice` | `text, command` | message id | **Terminal only** |
| `SessionMode` | `modes` (the footer mode labels) | One instance | Terminal, Desktop |
| `PromptHint` | `isDraft, isWorking, hint` | One instance | Terminal, Desktop |

- `e.surface` = `'terminal' | 'desktop'`; `e.viewport` = `{columns, rows, isFullscreen}` (absent until measured; rows = whole window). Fit to `e.props.bodyColumns` for width; `scroll.bodyRows` for available height. [reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites)
- The band (`AbovePrompt`) is **one instance shared by all mods**: each hook gets what mods after it drew via `await next(e)`; to stack, put the `next(e)` result among your Box children. Returning your own tree without `next` erases every other mod's band row. [interface#band](https://code.claude.com/docs/en/plugins/mods/interface#pick-where-to-draw)
- At engine-drawn sites `next(e)` resolves to `{type:'engine', ref}`; you may return it as-is or place it in a Box (must appear exactly once — for `AskUserQuestion` your elements must be *above* it). [interface#change-what-claude-code-already-draws](https://code.claude.com/docs/en/plugins/mods/interface#change-what-claude-code-already-draws)
- Three choices at any engine site: **detail** (`next({...e, props:{...e.props, suffix}})`), **replace** (return a tree, no `next`), **pass** (`next(e)`). [interface#tabs](https://code.claude.com/docs/en/plugins/mods/interface#change-what-claude-code-already-draws)
- The permission prompt is **not** a render site and can't be restyled. [overview#trust](https://code.claude.com/docs/en/plugins/mods/overview#decide-whether-to-trust-a-mod)

### 1.3 Panes / sidebar

- Open with `$.ui.open({id, title?, focus?, closeOnEscape?, holdToasts?, rows?, columns?})`; close with `$.ui.close({id})`. `focus/closeOnEscape/holdToasts` accept **only `true`** (omitting ≠ passing `false`; `false` throws). [interface#open-a-pane](https://code.claude.com/docs/en/plugins/mods/interface#open-a-pane-at-the-right-time)
- Pane placement: sidebar beside the transcript in a wide fullscreen terminal (docked), else framed region above the prompt (inline). `rows` = height request when inline (default ⅓ of space); `columns` = width request when docked. [interface](https://code.claude.com/docs/en/plugins/mods/interface#pick-where-to-draw)
- Width gates: a pane opened *by the mod itself* (timer/turn hook) appears only ≥ **144 columns** (≥110 after the user opened it once); user-initiated opens work at any width. `$.ui.open` resolves `{isPlaced:true}` or `{isPlaced:false, reason}`. [interface#narrow](https://code.claude.com/docs/en/plugins/mods/interface#when-a-pane-waits-for-a-wider-terminal)
- With several panes open, each gets a tab showing its `title`. [interface#pane](https://code.claude.com/docs/en/plugins/mods/interface#pick-where-to-draw)
- Keys while pane/band focused: Tab cycles controls; Up/Down move or scroll; Enter presses/submits/picks; hotkey (one digit or lowercase letter); PageUp/PageDown/Home/End scroll; Ctrl+X + arrow resizes pane; Ctrl+X + X closes; Esc returns focus (and closes if `closeOnEscape`). **Tab and arrows cannot be rebound** — games must use wasd. [interface#keys](https://code.claude.com/docs/en/plugins/mods/interface#know-which-keys-your-mod-can-receive)
- `focus:true` is granted only while the prompt is empty and nothing else holds focus. [interface#focus](https://code.claude.com/docs/en/plugins/mods/interface#how-a-pane-gets-keyboard-focus)

### 1.4 Component set (`$.ui.resolve(e)`)

From [interface#elements](https://code.claude.com/docs/en/plugins/mods/interface#build-a-tree-from-elements), [reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements), [gallery](https://code.claude.com/docs/en/plugins/mods/gallery):

| Element | Main props | Terminal | Desktop |
| :- | :- | :-: | :-: |
| `Box` | `key`, flex layout (`flexDirection`, `columnGap`/`gap`), `padding(X/Y)`, `margin`, `width`, `height`, `borderStyle`, `backgroundColor`, `position ('absolute')`, `hover`, `flexShrink`, `display` | ✓ | ✓ |
| `Text` | `color, backgroundColor, bold, italic, underline, strikethrough, dimColor, inverse, wrap ('wrap'\|'truncate'\|'truncate-start/middle/end')` | ✓ | ✓ |
| `Button` | `key, label, onPress, hotkey, plain, dimColor, autoFocus, action` | ✓ | ✓ |
| `Link` | `href, label` (Desktop https/localhost-only, see docs) | ✓ | ✓ |
| `Code` | `source, language, path, startLine, format ('diff'), wrap` | ✓ | ✓ |
| `Markdown` | `text` (not children), `key, dimColor, onLinkPress, pressableLinks` | ✓ | ✓ |
| `Input` | `key, label, placeholder, value, submitLabel, onSubmit, onInput, autoFocus` | ✓ | ✓ |
| `Select` | `key, label, options (≥1, unique values), value, onSelect, autoFocus` | ✓ | ✓ |
| `Svg` | SVG document ≤131,072 chars | — | ✓ |
| `Client` | `module, key, props, width, height` — second file, no mods API, posts back via `ui.message`; failures → `ui.fault` | ✓ | ✓ |
| `Raster` | `key, columns (≤512), rows (≤256), cells` (base64-packed codepoint+fg+bg per cell; RGB 24-bit; `0x01000000`=default) | ✓ | — |
| `Image` | PNG/RGBA ≤2 MiB or path, `columns/rows ≤255, alt` (kitty graphics protocol / Ghostty only; alt text dimmed otherwise) | ✓ | — |

- Invalid element/prop/child → engine draws its own site; log line `ui.render (Pane) refused: …`. [interface#elements](https://code.claude.com/docs/en/plugins/mods/interface#build-a-tree-from-elements)
- `borderStyle` values: `single, double, round, bold, singleDouble, doubleSingle, classic, arrow, dashed, quote` (unknown names draw **no** border). [reference#box-border-styles](https://code.claude.com/docs/en/plugins/mods/reference#box-border-styles)
- JSX available in `.tsx`/`.jsx` modules after destructuring from `$.ui.resolve(e)`. [interface#elements](https://code.claude.com/docs/en/plugins/mods/interface#build-a-tree-from-elements)

### 1.5 State: module vars, `$.state`, `$.store`

From [interface#keep-state](https://code.claude.com/docs/en/plugins/mods/interface#keep-state):

| Where | Lifetime | Notes |
| :- | :- | :- |
| module-level variable | until module reload (every save during dev) | simplest; lost on reload |
| `$.state` | session; reset by `/clear`, `/resume`, `/branch` | **reactive**: a `ui.render` hook that reads an atom redraws on write; survives reload |
| `$.store` | JSON file under `~/.claude/plugins/store/`, until deleted / `cleanupPeriodDays` | shared by all sessions on the machine; 4 MiB total; not atomic — re-read before write |

- `$.state` usage: `import { atom, read, update } from 'claude-code'`; `const count = atom({plugin:'x', key:'count'}, 0)` (held in `const`, literals only); `read($, count)` in render; `update($, count, v=>v+1)` in callbacks. Every atom must be declared in `types/index.d.ts` under `PluginState` and pointed at by manifest `"types"`. Render hooks **read, never write** state. [interface#$-state](https://code.claude.com/docs/en/plugins/mods/interface#keep-a-value-in-$-state)
- After `/clear`/`/resume`/`/branch`, `session.start` does **not** re-fire; hook `classic.SessionStart` with `source: ['clear','resume','fork']` to re-load store→state. [interface#clear](https://code.claude.com/docs/en/plugins/mods/interface#load-a-saved-value-again-after-clear)

### 1.6 Timers, redraw, notifications

- Redraw triggers: site props change, terminal width change, or `$.ui.invalidate('ui.render')` from your code. No repaint on a timer by default — start `$.clock.every(ms, () => $.ui.invalidate('ui.render'))` in `session.start`. [interface#redraw](https://code.claude.com/docs/en/plugins/mods/interface#redraw-when-something-changes)
- Throttle: invalidate coalesced to **10/s** general, **30/s** in the terminal for the visible pane, expanded band, and prompt hint line. Animation can't beat the limit. [reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)
- `$.clock`: `now/sleep/after/every` (ms), each timer has `.cancel()`. Timers die on module reload. Background callback errors go to the debug log only. [api#background](https://code.claude.com/docs/en/plugins/mods/api#run-work-in-the-background)
- Out-of-turn output: `$.ui.status(text)` (persistent line under prompt, `⚠ my-mod:` prefix), `$.ui.toast(text, {timeoutMs?})` (4 s default toast), `$.ui.log(text)` (dim transcript line, `● my-mod:` prefix, Claude doesn't read it). [api#show](https://code.claude.com/docs/en/plugins/mods/api#show-something-without-starting-a-turn)
- Start a turn from background: `$.prompt.submit({text, asUser?})` (waits for idle; don't await from a working handler). [api#submit](https://code.claude.com/docs/en/plugins/mods/api#start-a-turn-from-a-background-job)
- `$.ui.ask(question, options)` holds a tool call pending a user answer; rejects on dismiss/`claude -p`. [events#hold](https://code.claude.com/docs/en/plugins/mods/events#hold-a-tool-call-until-the-user-decides)

### 1.7 Commands, tools, panes registration

- Commands: `await $.command.register({name, description, argumentHint?, immediate?})` in `session.start`; handle `on('command.run', {command:'name'}, …)` returning `{text}` (transcript; Claude reads it), `{}` (silent), or `next(e)`. `immediate:true` lets it run mid-turn. Taken names throw (register last / try-catch). [api#command](https://code.claude.com/docs/en/plugins/mods/api#add-a-command)
- Tools: `$.tool.register({name, description, inputSchema})` → exposed to Claude as `mcp__<plugin>__<name>`; handle via `tool.call` filter. `isDeferred:false` (v2.1.293+) loads it upfront. [api#tool](https://code.claude.com/docs/en/plugins/mods/api#add-a-tool)
- Model calls: `$.model.complete({model, prompt, system?, maxTokens?, timeoutMs?})` (check `r.isAnswered`) and `$.model.fork({prompt})` (full conversation, prompt-cache friendly); prompt-array with `{text, cache:true}` blocks for cache breakpoints (v2.1.292+). [api#model](https://code.claude.com/docs/en/plugins/mods/api#call-a-model)

### 1.8 Events (the full hook surface)

From [reference#events](https://code.claude.com/docs/en/plugins/mods/reference#events). Every hook is `async ($, e, next) => …` middleware; `next(e)` passes on, `next({...e, …})` rewrites, a returned object answers without `next`. Matchers: object fields as value / array / regex; wildcard `'*'` (except telemetry). Duplicate `on(event)` without distinct matchers fails to load.

- **Tools**: `tool.call` (deny/result/rewrite), `tool.check` (decision allow/ask/deny after rules+hooks; `e.agentId`, `e.ceiling` v2.1.290+), `tool.describe`
- **Prompts**: `prompt.submit` (rewrite text/context, `{drop: reason}`), `prompt.fill/suggest/edit/autocomplete/compose/section/context/attachment/mention`, `skill.prompt`, `attribution.text`
- **Commands/config**: `command.run/describe`, `config.set/describe`
- **Turns**: `turn.start`, `turn.step` (**async generator**: `yield* next(e)`, can retarget `{model, effort}`, sees `result.usage` token counts), `turn.complete` (`{text}` adds a line under the answer; `e.isAborted`, `e.usage`)
- **Session**: `session.start` (per mod, pre-first-prompt, re-fires on reload; **not** after /clear etc.), `session.end`, `session.compact`, `session.receive/send/append/attach/detach/measure`
- **Subagents**: `agent.offer`, `agent.spawn` (retarget `{model}`, deny)
- **Interface**: `ui.render`, `ui.resolve`, `ui.press/input/select`, `ui.focus`, `ui.scroll`, `ui.close`, `ui.message`, `ui.fault` (v2.1.289+)
- **Mod-on-mod**: `plugin.register` (`e.uses` lists events/calls; `{refuse: reason}` blocks a mod from loading), `engine.create` (add a namespace to the mods API — how `$.telemetry` exists)
- **Telemetry**: `telemetry.log/mark` (require `{to:'collector'}` filter)
- **Settings hooks as events**: any settings hook event as `classic.<Event>` (e.g. `classic.SessionStart`, `classic.Stop`), `e` = the stdin JSON
- **API-call interception**: every mods API method is itself an event (`fs.read`, `model.complete`, `ui.open`…) that earlier mods can observe/rewrite/deny
- `next` extras: `next.signal` (AbortSignal), `next.origin {plugin, tier}`, `next.budget {ms, remainingMs}`, `next.to(e, tier)`, and in `.catch`: `next.error {kind, message}` / `next.called`
- Failure: a hook failing before `next` is skipped; after `next`, its result stands. `.catch(handler)` gives fail-closed guards (1 s budget). [events#failure](https://code.claude.com/docs/en/plugins/mods/events#handle-a-hook-that-fails)
- Order: `sec-default@builtin` + managed `prependPlugins` → org mods → user-installed (deps first) → managed `appendPlugins` → other built-ins. Managed `PreToolUse` runs before all mods and is final. [events#order](https://code.claude.com/docs/en/plugins/mods/events#the-order-mods-run-in)

### 1.9 Mods API namespaces ($)

From [reference#mods-api-methods](https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods):

`$.plugin` (name, root) · `$.ui` (resolve, invalidate, open, close, panes, focus, scroll, toast, status, log, notice, ask, copy, selection, blit) · `$.command` (register, run, list) · `$.tool` (register, call, check, list) · `$.agent` (register, spawn, list) · `$.model` (complete, fork, classify) · `$.prompt` (submit, read, fill, suggest, compose) · `$.turn` (abort) · `$.session` (messages, cwd, root, model, turns, id, repo, surfaces, usage, version, compact, send, append, authorize — `usage()` → `{startedAt, context:{tokens,window,percent}, rateLimits, cost}`) · `$.config` (list, set) · `$.settings` (read) · `$.env` (get, set — names must be string literals) · `$.fs` (read, write, list, exists, stat, ancestors) · `$.store` (get, set, delete, keys) · `$.state` (get, set + `atom/read/update/derive/memberOf` from `claude-code`) · `$.clock` (now, sleep, after, every) · `$.http` (fetch) · `$.process` (run, spawn) · `$.mcp` (call, connect) · `$.audio` (play, speak) · `$.telemetry` (log, mark)

**Limits / "no fs/network"**: the hooks module itself has **no Node.js APIs, no `setTimeout`/`setInterval` globals, no direct file or network access** — all IO goes through `$` (stdlib web APIs like `URL`, `TextEncoder`, `AbortController`, `crypto.subtle` are available). [api#reach](https://code.claude.com/docs/en/plugins/mods/api#reach-files-processes-and-the-network). Numeric limits ([reference#limits](https://code.claude.com/docs/en/plugins/mods/reference#limits)): hook body 10 s (50 ms for `prompt.edit`); `.catch` 1 s; `$.process.run` 30 s default/10 min max; `$.model.complete` maxTokens 1024 default/64 k max; fs/http bodies 4 MiB; http call 30 s, 5 redirects; tree text first 100,000 chars; `$.store` 4 MiB; `$.session.messages()` newest 4096; names 64 chars `[A-Za-z0-9_-]`; one test 5 s; nested scopes 2000.

### 1.10 Testing kit (`claude-code/testing`)

From [test](https://code.claude.com/docs/en/plugins/mods/test):

- Files named `*.test.ts`/`*.test.tsx` anywhere in the plugin; run with `claude plugin test` (exit 1 on fail; CI-safe); each test `test('name', async ($, on) => …)`; needs ≥1 `test()` per file.
- Test `$` ≠ hook `$`: each method **fires** the event of that name through your hooks (`$.tool.call`, `$.command.run`, `$.session.start`, `$.classic.SessionStart`, …). You cannot fire `ui.close` directly — press the button instead.
- `on('name', stub)` registers stubs that answer in Claude Code's place (`store.get → {value: …}`, `tool.call → {result}`, `ui.open → {value:{isPlaced:true}}`, `model.complete → {value:{isAnswered, text, usage}}`, `fs.read → {value}`). Deny = `{deny: reason}` makes the call reject. All stubs must be registered before the first `$` call.
- Kit self-answers only `$.ui.invalidate`, `$.state`, `$.session.append`. Ready-made mocks: `mock.clock(on, {now?})` with `advance/set/settle/sleep`, `mock.store(on, entries)`, `mock.env(on, vars)`, `mock.session(on)` (`.appended()`, v2.1.293+).
- Drawing tests: `const ui = await $.ui.mount({...siteProps, surface})` renders a site through your hook; then `ui.press({key})`, `ui.input({key, text, kind:'change'?})`, `ui.select({key, value})`, `ui.find({key} | {type, text|regex})`, `ui.unmount()`. Per-surface loop over `['terminal','desktop']`. `session.start` doesn't auto-fire; `/clear` simulation = fire `$.classic.SessionStart({source:'clear'})`.
- Policy-mod tests: `tier('prepend'|'append'|'builtin')` at file top; `test('…', {plugins:[{name, register}]}, fn)` loads inline second mods to be refused/admitted. Full stub table + `expect` assertions (`toBe toEqual toMatch toMatchObject toContain toBeDefined toBeUndefined toThrow`, `.not`) in the docs.
- Repo convention (built-in mods): tests beside hooks (`register.test.ts`), `tier('builtin')`, one `describe` per tier; shared fixtures under `tests/fixtures/`. [claude-code repo mods README](https://github.com/anthropics/claude-code/tree/main/mods)

### 1.11 Dev loop facts

- `claude --plugin-dir ./mod` loads + **hot-reloads** on save (register re-runs → module state resets). `/reload-plugins` for installed plugins. [create](https://code.claude.com/docs/en/plugins/mods/create#change-the-code-while-the-session-runs)
- Claude Code writes `.claude-plugin/types/` (claude-code, claude-code-tools, claude-code-mcp, per-dependency, tsconfig.json) for `--plugin-dir` sessions — the authoritative per-build reference. [create#types](https://code.claude.com/docs/en/plugins/mods/create#get-the-types-for-your-build)
- Static-analysis rules for validation: `on` names must be string literals; `$` calls spelled fully (`$.ns.method`), `$` passable only to top-level same-file functions; no aliasing/destructuring/computed access on `$`/namespaces; no shadowing `on`; top-level `import` declarations only. [create#validate](https://code.claude.com/docs/en/plugins/mods/create#check-what-claude-code-reads-from-your-mod)
- Sample mods (official playground): `token-weather`, `blast-radius`, `replay-theater`. [overview#sample](https://code.claude.com/docs/en/plugins/mods/overview#try-a-sample-mod)

### 1.12 Troubleshooting (from [troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot))

- A broken mod is invisible by design: a failed module or hook is skipped and the session continues. `claude plugin validate <dir>` catches misspelled events and bad manifests without a session.
- Where errors surface: hot-reload `--plugin-dir` sessions → dim transcript line; installed mods → debug log only (`claude --debug` or `--debug-file <path>`, then `tail -f | grep <mod>`); `claude -p` → stderr.
- `claude plugin test` in a non-mod directory tells you if mods can load at all (`no hooks module to load` = OK; `hooks modules are turned off…` = blocked by `disableAllHooks` or Anthropic's remote rollout switch).
- Module-load refusals follow `hooks module <name>@inline not loaded:` — reasons include `disableAllHooks in managed settings`, `only managed plugins and built-in plugins run` (`allowManagedHooksOnly`), `--bare`, name collision (`another plugin of that name loads first`), `code nested too deep to scan: more than 2000 scopes`.
- Runtime skips: `<mod>: tool.call hook skipped: threw Error: boom`; a registered command with no answering hook prints `<mod> registered /tally but no command.run hook answered it`; a mod that blocks the worker thread is unloaded (`was unloaded: it crashed the hooks worker`); the worker crashing 3× unloads **every** non-built-in mod until `/reload-plugins`.
- Drawing failures: invalid tree → `ui.render (Pane) refused: <reason>; the engine drew its own`; a render hook that throws → `ui.render (ToolUse) threw while drawn: …; the engine drew its own`. A silent `Client` error prints `the module failed without a message`.
- A pane that doesn't appear: mod-initiated open below the width gate (144/110 cols) — check `isPlaced`. Toast debugging: max 3 toasts on screen, `timeoutMs` 1–60000, `holdToasts` panes hold them, newer toast replaces older.
- Hotkeys dead = pane lacks focus (Ctrl+X Tab or click or `focus:true`). Works in terminal but not Desktop = site/element surface difference.
- Your own log lines: `$.ui.log('msg', { to: 'debug' })` writes to the debug log; without the second arg it's a transcript line.
- Reload loop: `--plugin-dir` watches the directory; a save that breaks the module prints `reload failed, the previous version stays loaded:` and the old version keeps running.

### 1.13 Organization controls (from [admin](https://code.claude.com/docs/en/plugins/mods/admin))

- A built-in guard `sec-default@builtin` (`cc-plugin-sec-default`) loads ahead of every user-installed mod on machines with managed settings or for Team/Enterprise sign-ins; its source is public ([mods/sec-default](https://github.com/anthropics/claude-code/tree/main/mods/sec-default)). Users can't disable it.
- Guard options in managed settings `pluginConfigs` keyed `cc-plugin-sec-default@builtin`: `allowManagedModsOnly` (refuse every user mod) and `allowModsToOverrideDenyRules`. Managed settings only; the guard fails closed.
- Organization mods are recognized only when managed `enabledPlugins` + `extraKnownMarketplaces` pointing at an **absolute directory path** on the machine + relative-path plugin entries; anything fetched from GitHub/git/URL/npm counts as a user's mod even if managed-enabled.
- Ordering: managed `prependPlugins` (mod sees events first, results last; naming it replaces the default guard list — re-include `sec-default@builtin`), managed `appendPlugins`.
- A policy mod hooks `plugin.register` (`e.tier`, `e.uses.calls` — the same list `validate` prints) to refuse other mods, and hooks API-call events by name (`fs.write`, `process.run`) to audit/deny other mods' calls; `.catch` on `plugin.register` for fail-closed checks (full policy-mod example in the docs). Deny rules and managed `PreToolUse` are final; neither limits a mod's own `$.fs`/`$.process` calls.

---

## 2. Real examples

Public examples are few and concentrated in two Anthropic repos plus a small third-party set. Searched: `site:github.com claude-code mod "ui.render" "AbovePrompt"` (web_search, 2026-10-13) → surfaced only the repos below (t3-mods, claude-code-effort-cycle, claude-kit, beacon) among issues. A second search `"claude-code/testing"` and `"$.ui.open"` confirmed the same picture: **the seven Anthropic mods are the corpus; third-party mods number in the single digits.**

### 2.1 token-weather (official playground) — AbovePrompt band done right

URL: <https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather> (file `hooks/token-weather.mjs`). Draws a context-window forecast band: icon, percent, tokens, block-char sparkline of last 12 turns, trend arrow. Instructive: turn.complete sampling + invalidate +AbovePrompt render + width-aware layout + `▲▼` trend.

```js
const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const FORECAST = [
  { upTo: 25, icon: "☀", word: "Clear", color: "yellow" },
  { upTo: 50, icon: "☁", word: "Cloudy", color: "cyan" },
  { upTo: 75, icon: "☂", word: "Showers", color: "blue" },
  { upTo: 90, icon: "☇", word: "Storm", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "Compact soon", color: "red" },
];

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    readings = []; await takeReading($); return result;
  });
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;          // main loop only
    await takeReading($); return result;
  });
  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (e.hasSurvey || readings.length === 0) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return band(Box, Text, e.bodyColumns ?? 80);
  });
}

async function takeReading($) {
  const { context } = await $.session.usage();
  readings.push({ tokens: context.tokens ?? 0, window: context.window,
                  percent: Math.round(context.percent ?? 0) });
  if (readings.length > HISTORY) readings = readings.slice(-HISTORY);
  $.ui.invalidate("ui.render");
}

function chart() {                          // sparkline scaled to the busiest reading
  const top = Math.max(...readings.map(r => r.tokens), 1);
  return readings.map(r =>
    BARS[Math.min(BARS.length-1, Math.floor((r.tokens/top)*(BARS.length-1)))]).join("");
}
```

Patterns to steal: single-line band, `e.bodyColumns` width gate before adding the chart, single-width glyphs ("not emoji: they line up in every terminal font"), color-coded thresholds.

### 2.2 diff (official built-in) — the reference pane implementation

URL: <https://github.com/anthropics/claude-code/tree/main/mods/diff> (`hooks/register.ts`, 1068 lines + 25 helper modules). The production `/diff` pane. Instructive: engine-host indirection, generation/stamp body caching, coalesced redraw timer, `ui.scroll`/`ui.focus` ownership, `deny` on `ui.close` to turn Esc into "back".

```ts
on('ui.render', { component: 'Pane' }, async ($, e, next) => {
  if (e.requestId !== Names.PANE_ID || !host || !isOnPaneSurface(e)) return next(e)
  const { Box, Text, Button, Select, Code } = await $.ui.resolve(e)
  columns = e.viewport?.columns ?? columns
  // ... re-seat detection:
  const isReseated = e.props.placement !== model.placement
  model = { ...model,
    placement: e.props.placement,
    place: { ...model.place,
      columns: Math.max(1, e.props.bodyColumns - Limits.PANE_RIGHT_PAD_COLUMNS),
      rows: e.props.scroll.bodyRows } }
  if (isReseated) void loadBodies(host).catch(() => undefined)
  return Views.paneView({ ui: {Box,Text,Button,Select,Code}, actions: actionsOf(host),
                          columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows },
                        model, { placement: e.props.placement, terminalColumns: columns })
})

function redraw(engine: Host) {             // coalesce: one invalidate per REDRAW_COALESCE_MS
  fitDialog(engine)
  if (timers.has('redraw')) return
  timers.set('redraw', engine.after(Limits.REDRAW_COALESCE_MS, () => {
    timers.delete('redraw'); engine.invalidate()
  }))
}

on('ui.close', { id: Names.PANE_ID }, async ($, e, next) => {
  // Esc in the inline detail view backs out to the list instead of closing:
  const isBack = e.origin.kind === 'person' && model.placement === 'inline'
              && model.dialogView === 'detail'
  if (isBack && host) {
    model = { ...model, dialogView: 'list' }; redraw(host)
    void host.openPane({ ...dialogPane(), focus: true }).catch(() => undefined)
    return { deny: 'back to the file list' }
  }
  ...
})
```

Its README ([mods/diff](https://github.com/anthropics/claude-code/tree/main/mods/diff)) documents the full UX contract: 144/110-column auto-open rules, focus ring re-centering around `❯`, ctrl+x-b base chord via `Button action`, prime-before-open so it never lands on "Loading…", withdrawn opens on resize. Also the `session.start` "engine host" adapter pattern (wraps `$` once into a `Host` object so the logic is testable and `Host`-typed).

### 2.3 effort-cycle (third party: Anerco/claude-code-effort-cycle) — restyled footer + Client + borrowed keybindings

URL: <https://github.com/Anerco/claude-code-effort-cycle> (MIT, `hooks/register.tsx`, 763 lines, JSX). Steps reasoning effort per agent with Ctrl+↑/↓ shown as `Opus 5.5 ▰▰▰▱▱ high` in the footer. Instructive tricks:

- **Borrowing engine keybinding actions on hidden band buttons** (mods can't bind arbitrary keys; a `Button` with `action` receives the user's binding for an engine action):

```tsx
// A key reaches a mod without a prompt only through a Button naming an engine
// keybinding action ... hidden Buttons above the prompt borrow actions.
// app:diffFileListUp / app:diffFileListDown default to Ctrl+↑/↓ and do nothing
// at the prompt, so they step with no setup.
```

- **Hover-revealed clickable carets as `Client` modules** with fixed-width slots so the footer never reflows, and a press-count protocol through `ui.message` so a post whose frame was replaced still applies its steps.
- Restyling `SessionMode` while preserving the engine's own modes: `{e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}` — compose with `next`-style stacking via a keyed Box.
- Theme-key colors (`HEAT: { low:'inactive', …, max:'error' }`) that follow the user's theme, ANSI translation for tasks-list rows.
- Known-limits list in the README is gold: settings are read-only to mods, a plugin cannot write settings, spinner/footer drift, `—` before first request.

### 2.4 blast-radius (official playground) — holding a tool call for a user decision

URL: <https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius> (file `hooks/blast-radius.mjs`, 534 lines, Apache-2.0). Holds risky Bash (`rm -rf`, `git reset --hard`, force push, migrations), measures the blast radius with `find`/`du`/`git`, draws Proceed/Cancel in a pane — or in the band when the terminal is too narrow. Instructive: the 10-second-budget hold loop, the `isPlaced` fallback, the queue of overlapping holds, deny messages Claude can act on.

```js
const HOLD_LIMIT_MS = 10 * 60 * 1000;
let held = null;                       // one hold at a time

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const risk = classify(String(e.command ?? ""));
    if (risk === null) return next(e);
    // Queue: wait for an already-held call. `next.signal.aborted` = user pressed Esc.
    while (held !== null) {
      if (next.signal.aborted) return { deny: "…the turn was interrupted. Do not retry it." };
      await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
    }
    const mine = { command: …, risk, report: null, decision: null, where: "pane" };
    held = mine;
    try {
      // … measure with $.process.run, paths as arguments, never shell-interpolated …
      const opened = await $.ui.open({ id: PANE_ID, title: "Blast Radius",
                                       focus: true, rows: paneRows(mine.report) });
      if (!opened.isPlaced) mine.where = "band";   // narrow terminal → AbovePrompt fallback
      $.ui.invalidate("ui.render");
      const startedAt = await $.clock.now();
      // HOLD LOOP: hook body time is limited to 10s, but time inside a $ call is free,
      // so the wait is a poll on $.process.run(["sleep", "0.25"]).
      while (mine.decision === null) {
        if (next.signal.aborted) { mine.decision = "interrupted"; break; }
        if ((await $.clock.now()) - startedAt > HOLD_LIMIT_MS) { mine.decision = "timeout"; break; }
        await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
      }
    } catch { mine.decision = "error"; }              // anything unexpected refuses the command
    finally { /* close pane, release hold, invalidate */ }
    if (decision === "proceed") { $.ui.toast("Blast Radius: running it"); return next(e); }
    return { deny: `Blast Radius held this command and did not run it: ${why}. ` +
                    `It would have: ${summary}. Do not retry it unless the user asks you to.` };
  });
  on("ui.render", { component: "Pane" }, …);          // same report, two sites
  on("ui.render", { component: "AbovePrompt" }, …);   // narrow-terminal fallback
}
```

Its README's "Iterations" section is a field guide to mod constraints: the hold-free-time trick, `isPlaced` fallback, **Cancel gets focus by default** (Enter refuses, never runs), 10-minute timeout, safety-first refusal on any hold error, and the band being single-occupancy ("If another mod that draws there takes the band, the Proceed and Cancel buttons may not show").

### 2.5 replay-theater (official playground) + built-ins agents-md / sec-default / telemetry

- **replay-theater**: `/replay` command that steps through the file edits of the last turn. URL: <https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater>.
- **agents-md**: loads `AGENTS.md` as project instructions with a `userConfig` option; shows how a mod ships configuration via manifest `userConfig` + `register(on, options)`. URL: <https://github.com/anthropics/claude-code/tree/main/mods/agents-md>.
- **sec-default**: the policy guard; the model for a mod that enforces org policy (see §1.13). URL: <https://github.com/anthropics/claude-code/tree/main/mods/sec-default>.
- **telemetry**: adds `$.telemetry` to the mods API via an `engine.create` hook and ships its types in `types/index.d.ts`; the model for noun contracts between mods. URL: <https://github.com/anthropics/claude-code/tree/main/mods/telemetry>. Contract convention from the [mods README](https://github.com/anthropics/claude-code/tree/main/mods): the contract file has no imports, is checked against `EngineInterface['telemetry']`, and callers import it rather than copying it.

### 2.6 claude-kit / t3-mods / beacon (third party, issue-level)

- **JohnnyVizz/claude-kit** — `savvy-progress` band mod; issue #21 documents the classic AbovePrompt bug: its handler answered **without `next(e)`**, hiding every other mod's band row (<https://github.com/JohnnyVizz/claude-kit/issues/21>). Lesson: band mods must always stack via `next`.
- **codeclawd/t3-mods** — keeps Claude Code plugin UI (status lines, toasts, prompt band) alive across updates in a forked desktop app (<https://github.com/codeclawd/t3-mods>).
- **chris-peterson/beacon** — plans to render its status bar as a Claude Code mod band (<https://github.com/chris-peterson/beacon/issues/64>).

Open issues worth citing in the redesign: VS Code draws no mod UI (`$.session.surfaces()` → `[]`, opens resolve `isPlaced:true` but nothing appears — [#99401](https://github.com/anthropics/claude-code/issues/99401)); Desktop split-view renders band only in the leftmost pane ([#101065](https://github.com/anthropics/claude-code/issues/101065)); feature request for per-plugin band rows instead of one shared chain ([#100789](https://github.com/anthropics/claude-code/issues/100789)); band collapse key `[-]` not observable ([#98986](https://github.com/anthropics/claude-code/issues/98986)).

*(That's 9 example repos — Anthropic playground ×3 [token-weather/blast-radius/replay-theater], built-in repo ×4 [diff/agents-md/sec-default/telemetry], third-party ×3; 5 of them carry full code excerpts.)*

---

## 3. Modern TUI UX patterns worth borrowing

Well-regarded terminal UIs and the specific patterns to steal for mod panes/bands:

- **lazygit** (<https://github.com/jesseduffield/lazygit>) — persistent top status line + per-panel focus highlight; every key hinted in the bottom line of the focused panel (`Enter`, `space`, `c`…); everything visible in one screen, no hidden menus.
- **k9s** (<https://github.com/derailed/k9s>) — dense, column-aligned resource tables with color-coded status; type-ahead `/` filter over the focused table; resource-count + context crumb in the header; alias commands instead of menus.
- **btop** (<https://github.com/aristocratos/btop>) — box-drawn modules with 1-row sparkline/bar meters (braille/block chars), theme-keyed colors, live-updating without flicker, keys shown in a bottom help bar toggled by `?`.
- **gh-dash** (<https://github.com/dlvhdr/gh-dash>) — exactly the "pane beside the transcript" shape: sidebar list + detail pane, tabbed sections, row-selected focus with `❯`, percent-bound progress for CI columns.
- **Warp blocks** — output grouped into selectable, collapsible blocks with a one-line per-block summary; relevant to atlas because collapsible tool-call groups exist (`ToolGroup`) and a collapsed group should show one dense summary line, expandable on demand.

Pattern checklist for the atlas redesign (each maps to a doc feature):

| Pattern | Mod feature to use | Source |
| :- | :- | :- |
| Status bar / persistent one-line summary | `AbovePrompt` band, single row, `e.bodyColumns`-aware truncation | token-weather; [interface](https://code.claude.com/docs/en/plugins/mods/interface) |
| Keyboard hints under the focused thing | `Button` with `hotkey` + `plain:true` (`1: One` style); label-embedded hints for bracketed buttons | [interface#keys](https://code.claude.com/docs/en/plugins/mods/interface#know-which-keys-your-mod-can-receive), [gallery#button](https://code.claude.com/docs/en/plugins/mods/gallery) |
| Focus ring (`❯`) + re-centering | `autoFocus`, `ui.focus` handler like diff's `dialogFocusOf` | diff README |
| Dense aligned tables | `Box` rows + fixed `width` cells, `Text wrap:'truncate-end'`; `Raster` for bars/sparklines | [reference#elements](https://code.claude.com/docs/en/plugins/mods/reference#elements) |
| Sparklines / meters | `Raster` (`cellsOf` packer) or plain block-char strings like token-weather's `BARS` | [interface#raster](https://code.claude.com/docs/en/plugins/mods/interface#draw-a-grid-of-colored-cells) |
| Theme-aware color | `Text color` as **theme key** (`'success'`, `'warning'`, `'error'`, `'inactive'`, `'claude'`), never hard-coded RGB except in `Raster` | effort-cycle HEAT map; [gallery#text](https://code.claude.com/docs/en/plugins/mods/gallery) |
| Esc-as-backout (dialogs) | `closeOnEscape` + `ui.close` handler returning `{deny}` | diff register.ts |
| Non-blocking notice, not modal | `$.ui.toast` / `$.ui.status` / `$.ui.log` hierarchy | [api#show](https://code.claude.com/docs/en/plugins/mods/api#show-something-without-starting-a-turn) |
| Quiet-by-default width | only auto-open ≥144 cols (110 after first user open); degrade to a line otherwise | [interface#narrow](https://code.claude.com/docs/en/plugins/mods/interface#when-a-pane-waits-for-a-wider-terminal) |

---

## 4. Local type surface (atlas plugin)

Two files define the atlas mod's contract; both are atlas-owned declarations, **not** the Claude Code API surface. The authoritative Claude Code API for this build is the generated `plugins/atlas/.claude-plugin/types/claude-code/index.d.ts` (gitignored, per `plugins/atlas/mod/contract.ts:2`).

### `plugins/atlas/types/index.d.ts` (181 lines)

Declares the `PluginState` atoms interface (the `$.state` schema) and shared UI types:

- `PaneTab = 'colony' | 'channel' | 'board' | 'squad' | 'collab'` — types/index.d.ts:151
- `Usage = { tokens: number|null; costUsd: number|null; contextPct: number|null }` — types/index.d.ts:154
- `SpinnerTick = number` (spinner frame counter, written/read by `mod/restyle.tsx`) — types/index.d.ts:157
- `declare module 'claude-code' { interface PluginState { atlas: { snapshot: LiveSnapshot|null; usage: Usage; taskAgents: SquadAgent[]; headerPhase: PhaseId|null; headerMisses: number; lastSeenSeq: number; isModOn: boolean; isInteractive: boolean; paneOpened: boolean; spinnerTick: SpinnerTick; discipline: {heavy, delegated, hint, toastAt}; orch: Orch; sidebarRecipient: string|null; sidebarExpanded: string|null; sidebarDraft: string; gates: {...}[]; lastHeader: {...}|null } } }` — types/index.d.ts:160-180 (15 state atoms)
- Data-shape types `Phase, Contract, TodoItem, ChannelNote, ChannelMember, AgentState, Persona, SquadAgent, AtlasSnapshot, LiveSnapshot, …` — types/index.d.ts:9-149

### `plugins/atlas/mod/contract.ts` (134 lines)

Same data types re-exported for the mod plus mod-specific surface (mod/contract.ts:1-134):

- `AtlasSnapshot` — everything the UI needs, rebuilt on file change and passed as Client props (mod/contract.ts:76-95)
- `Intent` — the 9 `Client`→hooks intents posted via `surface.post` and validated by the hooks module: `todo.phase, todo.claim, todo.complete, note, steer, stop, tab, inspect` (mod/contract.ts:98-106)
- `SpriteState/SpriteSize/Frame/Frames/SpriteSet` — pixel-sprite contract (mod/contract.ts:109-120)
- `FsLike` — injectable IO so data readers are pure functions over it; `register.ts` adapts `$.fs` (mod/contract.ts:123-128)
- `BRAND` — 12 hard-coded hex brand tokens mirroring `scripts/dashboard_ui/css/tokens.css` (mod/contract.ts:131-134)

### Render sites the atlas mod actually hooks

- `Spinner`, `ToolUse`, `AssistantMessage`, `TurnDuration`, `PromptHint` — mod/restyle.tsx:288,310,319,326,333
- `AbovePrompt` (band), `Pane` — mod/register.ts:640,648

### Mismatch notes vs docs

1. **`types/index.d.ts` and `mod/contract.ts` duplicate the same ~15 data interfaces** (`Phase`, `Contract`, `TodoItem`, `ChannelNote`, `ChannelMember`, `Persona`, `SquadAgent`, `AtlasSnapshot`, …) in two files; `types/index.d.ts` re-declares what `contract.ts` exports. Docs' convention is a single declaration per shape (the claude-code repo keeps one `types/index.d.ts` per noun contract and says "a mod that calls another's noun reads the same file and never copies it" — [mods README](https://github.com/anthropics/claude-code/tree/main/mods)). Drift risk between the two copies.
2. **`BRAND` hard-codes hex colors** while `Text color` accepts theme keys that follow the user's theme; hard-coded hex won't adapt to light themes in the Desktop app or a re-themed terminal ([gallery#text](https://code.claude.com/docs/en/plugins/mods/gallery), effort-cycle's `HEAT` map as counter-example).
3. `SpinnerTick` implies an animation driven by state writes; docs' spinner `props` are `{word, message, suffix, mode}` and animation is engine-owned — writing `spinnerTick` from a timer is the documented `$.clock.every` + `invalidate` pattern ([interface#redraw](https://code.claude.com/docs/en/plugins/mods/interface#redraw-when-something-changes)), fine, but at the 10/s coalesce cap.
4. The mod hooks 7 of the 13 sites; unused sites (`UserMessage`, `CommandOutput`, `ToolGroup`, `ToolResult`, `AskUserQuestion`, `InfoNotice`, `SessionMode`, `ToolProgress`) are available if the redesign wants them ([reference#render-sites](https://code.claude.com/docs/en/plugins/mods/reference#render-sites)).
