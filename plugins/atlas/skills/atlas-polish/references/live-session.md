# Live polish session: workspace, server, handoff

This reference owns checkout safety, server startup, reachability, and browser handoff. It does not own the user's iterative polish decisions.

## Resolve the workspace

If the user named a PR or branch, first locate whether its branch is already checked out in a worktree. Enter that existing worktree when the harness can; if it cannot, report the blocker and stop. Only use the harness's checkout capability in the current workspace when no other worktree owns the target. With no argument, stay in the current checkout.

Confirm the resulting branch is neither the repository's default branch nor detached. Report and stop when a safe feature-branch workspace cannot be reached; do not create another worktree behind the harness and do not move the user's uncommitted changes.

## Resolve the start tuple

There are no bundled launch scripts - that would make the skill host-specific. Resolve the dev-server start tuple (command, working directory, environment, port) from facts the project itself declares, in this order:

1. An existing launch configuration the repo already carries (`.claude/launch.json`, `vscode/launch.json`, or an equivalent the user points at). A selected config supplies every fact it declares: runtime executable + args form the command, `cwd` defaults to the repository root, `env` augments the inherited environment, and `port` must be numeric. Use every declared fact; resolve only what remains unknown.
2. `AGENTS.md` "Commands" section and `package.json` scripts (`dev`, `start`) for the command; derive the port from the script's output convention, framework default, or config file.
3. `docs/` (architecture, features) for framework-specific serving notes.

Ambiguity resolves by asking the user, never by guessing: show the candidates and ask them to choose. Any unresolved tuple fact (no command, no numeric port) blocks startup and must be reported - do not substitute a plausible value. Once a complete tuple has been resolved, offer once to save it as `.claude/launch.json` for future runs; write it only when the user accepts.

## Start and hand off

Inspect the chosen port and select exactly one intended server instance before handoff. Reuse a process already serving that port only when evidence identifies it as the intended project server. Only when no intended instance is selected may the resolved command be launched in the background with the project's working directory and environment; that process becomes the selected instance. Keep its process handle, and write its output under a directory created with `mktemp -d "${TMPDIR:-/tmp}/atlas-polish-XXXXXX"`.

An occupied port that cannot be attributed to the intended project server remains an unresolved collision. Ask the user whether to stop that process, choose another port, or stop this run; never kill it and never launch past it.

Resolve the selected instance's actual URL before handoff. The resolved port seeds `http://localhost:<port>` as the default candidate, but server output or a user correction replaces that candidate when it identifies a different URL. Probe the actual URL for up to 30 seconds and attribute success to the selected instance; a response from another process is not success.

- **Reachable:** hand off with the browser-opening capability available in the active harness (Claude_Preview, webapp-testing/Playwright, or the browser tool). If there is none or the handoff fails, print the URL - browser handoff is a convenience, not a gate.
- **Not reachable:** show diagnostics derived from the selected instance; include the last 20 log lines only when this run launched it and owns those logs. Ask whether to correct the server URL or start configuration, or stop.

Do not continue into the polish loop unless reachability is attributed to the selected instance. Leave the server running for the whole loop; tear it down only if this run launched it and the user is finished.

Tell the user:

```text
Dev server running on <verified-actual-url>
Browse the feature and tell me what could be better.
```
