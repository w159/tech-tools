#!/usr/bin/env python3
"""Convert an omp session JSONL into a Claude-Code-shaped transcript.

The atlas Stop-chain hooks (completion_gate, ingest_session, ...) read Claude
transcripts: records with top-level `type`/`uuid`/`parentUuid`/`sessionId`/
`timestamp`/`isSidechain` and a `message` whose content blocks are `text`,
`thinking`, `tool_use` and `tool_result`. omp writes a different shape (typed
entries, `toolCall` blocks with `arguments`, `toolResult` messages carrying
`details`). This module is the one place that translates between them so the
hooks stay byte-for-byte unchanged on the Claude path.

CLI:
    omp_transcript.py convert --session-file <omp .jsonl> --out <path> [--session-id <id>]

Prints exactly one JSON line and exits 0 on every outcome (fail-open):
    {"ok": true, "out": "<path>", "lines": N, "session_id": "<id>"}
    {"ok": false, "error": "..."}

Sub-agent / colony files live next to the lead file in a directory named after
its stem (`<stem>/<Agent>.jsonl`, `<stem>/__advisor.jsonl`). They are written to
`<out-dir>/subagents/agent-<name>.jsonl` with `isSidechain: true` and the lead's
sessionId, because ingest and the completion gate recognise sub-agent
transcripts by that path and flag.

Stdlib only.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

# omp tool -> Claude tool. Only tools with a real Claude equivalent are renamed;
# every other omp tool (advise, hub, eval, yield, ...) keeps its own name rather
# than being dressed up as something Claude does not have. Entry types other than
# `message` (custom, title, credential_pin, model_usage, ...) carry no
# conversation and are never emitted.
#
# The map is derived from contracts/tool-names.json (`claudeToOmp`, Claude -> omp;
# several Claude names may share one omp name) so the two cannot drift. For each
# omp tool the canonical Claude name is the FIRST plain-name key in file order
# (task -> Task, todo -> TodoWrite). Keys whose omp side is a phrase
# (ToolSearch, AskUserQuestion, SendMessage) or that are not plain names
# (ToolSearch-load) never become a rename.
_CONTRACTS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts"
)
_TOOL_NAMES_JSON = os.path.join(_CONTRACTS_DIR, "tool-names.json")
_CLAUDE_PLAIN_NAME = re.compile(r"^[A-Z]\w*$")
_OMP_PLAIN_NAME = re.compile(r"^[a-z]\w*$")

# omp tools with no claudeToOmp entry (Claude has no 1:1 name for them in the contract).
_OMP_ONLY_TOOLS = {"find": "Glob", "web_search": "WebSearch"}

# Used only when the contract is unreadable, so conversion never breaks.
_TOOL_MAP_FALLBACK = {
    "bash": "Bash",
    "edit": "Edit",
    "write": "Write",
    "read": "Read",
    "grep": "Grep",
    "glob": "Glob",
    "find": "Glob",
    "task": "Task",
    "todo": "TodoWrite",
    "web_search": "WebSearch",
}


def _load_tool_map(path: str | None = None) -> dict[str, str]:
    try:
        with open(path or _TOOL_NAMES_JSON, encoding="utf-8") as fh:
            claude_to_omp = json.load(fh)["claudeToOmp"]
        derived: dict[str, str] = {}
        for claude, omp in claude_to_omp.items():
            if _CLAUDE_PLAIN_NAME.match(claude) and _OMP_PLAIN_NAME.match(omp):
                derived.setdefault(omp, claude)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return dict(_TOOL_MAP_FALLBACK)
    return {**derived, **_OMP_ONLY_TOOLS}


TOOL_MAP = _load_tool_map()

# A `[path#TAG]` header opens each file section of an omp hashline `edit` input.
_EDIT_HEADER = re.compile(r"^\[(?P<path>[^\]\n#]+)(?:#[0-9A-Fa-f]+)?\]\s*$", re.M)

_TODO_STATUS = {
    "pending": "pending",
    "in_progress": "in_progress",
    "completed": "completed",
    "done": "completed",
    "abandoned": "completed",
}

# `xd://mcp__<server...>_<tool...>`: the server name is repeated as the tool's
# own prefix (atlas_falcon + falcon_get_host_details).
_XD_MCP = re.compile(r"^xd://mcp__(?P<rest>[A-Za-z0-9_]+)$")


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def _iso_from_epoch_ms(value) -> str | None:
    try:
        return (
            datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _entry_timestamp(entry: dict) -> str | None:
    """ISO timestamp for an entry. The entry-level `timestamp` is already ISO;
    `message.timestamp` is epoch-ms and is only a fallback (the hooks parse
    `timestamp` with fromisoformat, so an epoch number there would silently
    date the record to nothing and drop it from the run window)."""
    ts = entry.get("timestamp")
    if isinstance(ts, str) and ts:
        return ts
    if isinstance(ts, (int, float)):
        return _iso_from_epoch_ms(ts)
    msg = entry.get("message")
    if isinstance(msg, dict):
        return _iso_from_epoch_ms(msg.get("timestamp"))
    return None


# Servers whose names contain underscores, so the server/tool boundary in an
# `xd://mcp__<server>_<tool>` device name cannot be guessed from the string
# alone. Longest match wins. Anything else falls back to the duplicate-token
# rule below (atlas_falcon + falcon_status). Read from contracts/mcp-servers.json
# (`underscoredServers`); the literal below is the fail-open fallback.
_MCP_SERVERS_JSON = os.path.join(_CONTRACTS_DIR, "mcp-servers.json")
_KNOWN_MCP_SERVERS_FALLBACK = (
    "lean_ctx",
    "context_mode_context_mode",
    "context_mode",
    "claude_mem",
    "browser_use",
    "azure",
    "serena",
    "context7",
    "microsoft_docs",
    "plaid",
    "mobbin",
    "clippy",
    "atlas_connectwise",
    "mcp_search",
    "cmux_browser",
)


def _load_mcp_servers(path: str | None = None) -> tuple[str, ...]:
    try:
        with open(path or _MCP_SERVERS_JSON, encoding="utf-8") as fh:
            servers = json.load(fh)["underscoredServers"]
        if (
            isinstance(servers, list)
            and servers
            and all(isinstance(s, str) and s for s in servers)
        ):
            return tuple(servers)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return _KNOWN_MCP_SERVERS_FALLBACK


_KNOWN_MCP_SERVERS = _load_mcp_servers()


def _split_mcp_xd(path: str) -> str | None:
    """`xd://mcp__lean_ctx_ctx_shell` -> `mcp__lean_ctx__ctx_shell`.

    The completion gate matches shell MCP tools by `name.rsplit("__", 1)[-1]`
    (`ctx_shell`, `ctx_execute`, ...) and ingest's `classify` splits on
    `mcp__<server>__<tool>`, so the boundary has to be right, not merely
    plausible. Returns None when the shape is not recognisable (caller keeps
    the plain `Write`)."""
    m = _XD_MCP.match(path or "")
    if not m:
        return None
    rest = m.group("rest")
    for server in sorted(_KNOWN_MCP_SERVERS, key=len, reverse=True):
        if rest.startswith(server + "_") and len(rest) > len(server) + 1:
            return f"mcp__{server}__{rest[len(server) + 1 :]}"
    tokens = rest.split("_")
    for i in range(len(tokens) - 1):
        if tokens[i] and tokens[i] == tokens[i + 1]:
            server = "_".join(tokens[: i + 1])
            tool = "_".join(tokens[i + 2 :])
            return f"mcp__{server}__{tool}" if tool else None
    return None


def _edit_paths(patch_text) -> list[str]:
    if not isinstance(patch_text, str):
        return []
    seen: list[str] = []
    for m in _EDIT_HEADER.finditer(patch_text):
        p = m.group("path").strip()
        if p and p not in seen:
            seen.append(p)
    return seen


def _flatten_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(str(b.get("text", "")))
            elif isinstance(b, str):
                parts.append(b)
        return "\n".join(p for p in parts if p)
    return ""


def _todos_from_result(result_msg: dict | None) -> list[dict]:
    """Reconstruct a Claude TodoWrite `todos` list from an omp todo toolResult.

    omp keeps plan state in `details.phases[].tasks[]`; Claude's TodoWrite
    rewrites the whole list each call, which is exactly what the gate reads
    (the LAST TodoWrite is current state)."""
    todos: list[dict] = []
    details = (result_msg or {}).get("details")
    phases = details.get("phases") if isinstance(details, dict) else None
    if not isinstance(phases, list):
        return todos
    for phase in phases:
        if not isinstance(phase, dict):
            continue
        for task in phase.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            content = str(task.get("content") or task.get("title") or "").strip()
            if not content:
                continue
            status = _TODO_STATUS.get(str(task.get("status") or "pending"), "pending")
            todos.append({"content": content, "status": status, "activeForm": content})
    return todos


# --------------------------------------------------------------------------
# entry loading
# --------------------------------------------------------------------------


def _warn(message: str) -> None:
    """Diagnostics go to stderr only: stdout is the one-JSON-line contract."""
    print(f"omp_transcript: {message}", file=sys.stderr)


def _mcp_input(args: dict) -> dict:
    """omp hands an MCP tool its arguments as a JSON STRING in `content`, while
    Claude's tool_use carries the argument object itself. Decode it, or the gate's
    test-runner match on `"command": "..."` sees escaped quotes and a real pytest
    run through a shell MCP earns no credit. Non-object content is kept raw."""
    content = args.get("content")
    if isinstance(content, str):
        try:
            decoded = json.loads(content)
        except (ValueError, TypeError):
            decoded = None
        if isinstance(decoded, dict):
            return decoded
    return {k: v for k, v in args.items() if k != "path"}


def _list_dir(path: str) -> list[str]:
    """Sorted directory listing; a missing or unreadable dir is simply empty."""
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


def _load_entries(path: str) -> list[dict]:
    """Parse a JSONL file, tolerating blank lines, junk lines and a truncated
    final line (a live session is being appended to while we read it)."""
    entries: list[dict] = []
    # A missing/unreadable file is re-raised with the path: main() turns it into
    # {"ok": false, "error": ...} (exit 0), and the lead file failing is the one
    # case that must be reported rather than skipped.
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except (ValueError, TypeError):
                    continue  # junk or a truncated tail: expected on a live file
                if isinstance(obj, dict):
                    entries.append(obj)
    except OSError as exc:
        raise OSError(f"cannot read {path}: {exc}") from exc
    return entries


# --------------------------------------------------------------------------
# conversion
# --------------------------------------------------------------------------


class _Converter:
    def __init__(
        self, session_id: str, agent: str | None, sidechain: bool, cwd: str | None
    ):
        self.sid = session_id
        self.agent = agent
        self.sidechain = sidechain
        self.cwd = cwd
        self.records: list[dict] = []
        self._seen_tool_ids: set[str] = set()
        self._last_uuid: str | None = None

    # ---- ids ---------------------------------------------------------
    def _uuid(self, entry_id) -> str:
        prefix = f"{self.sid}:{self.agent}:" if self.agent else f"{self.sid}:"
        return f"{prefix}{entry_id}"

    def _tool_id(self, raw_id, fallback: str) -> str:
        """Unique tool_use id. `tool_calls` is keyed on tool_use_id with
        INSERT OR IGNORE, so a repeated id would silently drop a row; sub-agent
        files are namespaced by agent for the same reason."""
        base = str(raw_id) if raw_id else fallback
        if self.agent:
            base = f"{self.agent}:{base}"
        candidate, n = base, 1
        while candidate in self._seen_tool_ids:
            n += 1
            candidate = f"{base}#{n}"
        self._seen_tool_ids.add(candidate)
        return candidate

    # ---- tool mapping --------------------------------------------------
    def _map_tool_calls(
        self, block: dict, result_msg: dict | None, entry_id
    ) -> list[dict]:
        """One omp toolCall -> one or more Claude tool_use blocks."""
        name = str(block.get("name") or "")
        args = block.get("arguments")
        args = args if isinstance(args, dict) else {}
        raw_id = block.get("id")
        fallback = f"{entry_id}:{name or 'tool'}"

        if name == "task":
            return self._map_task(args, raw_id, fallback)

        if name == "todo":
            return [
                {
                    "type": "tool_use",
                    "id": self._tool_id(raw_id, fallback),
                    "name": "TodoWrite",
                    "input": {"todos": _todos_from_result(result_msg)},
                }
            ]

        if name == "write":
            mcp = _split_mcp_xd(str(args.get("path") or ""))
            if mcp:
                return [
                    {
                        "type": "tool_use",
                        "id": self._tool_id(raw_id, fallback),
                        "name": mcp,
                        "input": _mcp_input(args),
                    }
                ]

        claude_name = TOOL_MAP.get(name) or name or "unknown"
        inp = dict(args)

        # run_changed_paths reads `file_path` back out of the ingested summary, and
        # omp `edit` has no path argument (the target lives only in the `[path#TAG]`
        # header of its patch), so it is derived here. summarize_input caps each
        # value at 200 chars and the whole JSON at 500 in insertion order; leading
        # with the path keeps it inside that cut however many other fields follow.
        lead: dict = {}
        if name == "edit":
            paths = _edit_paths(args.get("input"))
            if not paths and args.get("path"):
                paths = [str(args["path"])]
            if paths:
                lead["file_path"] = paths[0]
                lead["path"] = paths[0]
                if len(paths) > 1:
                    lead["files"] = paths
        elif name in ("write", "read") and args.get("path"):
            lead["file_path"] = args["path"]
        if lead:
            inp = {**lead, **{k: v for k, v in args.items() if k not in lead}}

        return [
            {
                "type": "tool_use",
                "id": self._tool_id(raw_id, fallback),
                "name": claude_name,
                "input": inp,
            }
        ]

    def _map_task(self, args: dict, raw_id, fallback: str) -> list[dict]:
        items = args.get("tasks")
        if not isinstance(items, list) or not items:
            items = [args]
        out = []
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            prompt = item.get("task") or item.get("prompt") or ""
            out.append(
                {
                    "type": "tool_use",
                    "id": self._tool_id(
                        f"{raw_id}.{idx}" if raw_id else None, f"{fallback}.{idx}"
                    ),
                    "name": "Task",
                    "input": {
                        "subagent_type": item.get("agent")
                        or args.get("agent")
                        or "task",
                        "prompt": prompt,
                        "description": item.get("name") or args.get("i") or "",
                    },
                }
            )
        return out

    # ---- records -------------------------------------------------------
    def _base(
        self, entry: dict, rtype: str, role: str, content: list, model=None, usage=None
    ) -> dict:
        eid = entry.get("id")
        msg: dict = {"role": role, "content": content}
        if model:
            msg["model"] = model
        if usage:
            msg["usage"] = usage
        parent = entry.get("parentId")
        rec = {
            "type": rtype,
            "uuid": self._uuid(eid),
            "parentUuid": self._uuid(parent) if parent else self._last_uuid,
            "sessionId": self.sid,
            "timestamp": _entry_timestamp(entry),
            "isSidechain": self.sidechain,
            "message": msg,
        }
        if self.cwd:
            rec["cwd"] = self.cwd
        self._last_uuid = rec["uuid"]
        return rec

    @staticmethod
    def _usage(raw) -> dict | None:
        if not isinstance(raw, dict):
            return None

        def num(*keys):
            for k in keys:
                v = raw.get(k)
                # bool is an int subclass; nan/inf would raise in int() and the
                # per-entry guard would then drop the whole assistant record.
                if (
                    isinstance(v, (int, float))
                    and not isinstance(v, bool)
                    and math.isfinite(v)
                ):
                    try:
                        return int(v)
                    except (OverflowError, ValueError):
                        return 0
            return 0

        return {
            "input_tokens": num("input"),
            "output_tokens": num("output"),
            "cache_read_input_tokens": num("cacheRead"),
            "cache_creation_input_tokens": num("cacheWrite"),
        }

    def convert(self, entries: list[dict]) -> None:
        # Pass 1: pair toolResults to their call by toolCallId. Needed because a
        # TodoWrite input is reconstructed from the RESULT, which follows the call.
        results: dict[str, dict] = {}
        for e in entries:
            m = e.get("message")
            if (
                e.get("type") == "message"
                and isinstance(m, dict)
                and m.get("role") == "toolResult"
            ):
                tcid = m.get("toolCallId")
                if tcid:
                    results[str(tcid)] = m

        # Maps omp toolCallId -> list of emitted Claude tool_use ids, so a
        # toolResult can point at the right one (a batched `task` fans out).
        id_map: dict[str, list[str]] = {}

        for e in entries:
            if e.get("type") != "message":
                continue  # unknown / bookkeeping entry types are skipped
            m = e.get("message")
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            try:
                if role == "user":
                    self._emit_user(e, m)
                elif role == "assistant":
                    self._emit_assistant(e, m, results, id_map)
                elif role == "toolResult":
                    self._emit_tool_result(e, m, id_map)
                # role == "developer" and anything else: skipped
            except Exception as exc:  # noqa: BLE001 -- one bad entry must not sink the file
                _warn(f"skipped entry {e.get('id')!r}: {type(exc).__name__}: {exc}")

    def _emit_user(self, entry: dict, m: dict) -> None:
        text = _flatten_text(m.get("content"))
        if not text.strip():
            return
        # attribution other than "user" is the harness or a parent agent talking
        # (sub-agent assignments, injected reminders), not a human prompt. Claude
        # marks that class with a <system-reminder> wrapper, which ingest already
        # excludes from user_prompts via NOISE_PREFIXES.
        if m.get("attribution", "user") != "user":
            text = "<system-reminder>\n" + text + "\n</system-reminder>"
        self.records.append(
            self._base(entry, "user", "user", [{"type": "text", "text": text}])
        )

    def _emit_assistant(
        self, entry: dict, m: dict, results: dict, id_map: dict
    ) -> None:
        blocks: list[dict] = []
        content = m.get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        for b in content if isinstance(content, list) else []:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                blocks.append({"type": "text", "text": str(b.get("text", ""))})
            elif bt == "thinking":
                blocks.append(
                    {"type": "thinking", "thinking": str(b.get("thinking", ""))}
                )
            elif bt == "toolCall":
                tcid = str(b.get("id") or "")
                mapped = self._map_tool_calls(b, results.get(tcid), entry.get("id"))
                if tcid:
                    id_map[tcid] = [x["id"] for x in mapped]
                blocks.extend(mapped)
        if not blocks:
            return
        self.records.append(
            self._base(
                entry,
                "assistant",
                "assistant",
                blocks,
                m.get("model"),
                self._usage(m.get("usage")),
            )
        )

    def _emit_tool_result(self, entry: dict, m: dict, id_map: dict) -> None:
        tcid = str(m.get("toolCallId") or "")
        text = _flatten_text(m.get("content"))
        targets = id_map.get(tcid)
        if not targets:
            # Orphan result (call truncated away / compacted): keep it, but
            # under an id nothing else owns so it cannot clobber a real row.
            targets = [
                self._tool_id(
                    f"orphan-{tcid}" if tcid else None, f"{entry.get('id')}:orphan"
                )
            ]
        is_error = bool(m.get("isError"))
        blocks = [
            {
                "type": "tool_result",
                "tool_use_id": t,
                "content": text,
                "is_error": is_error,
            }
            for t in targets
        ]
        self.records.append(self._base(entry, "user", "user", blocks))


# --------------------------------------------------------------------------
# file level
# --------------------------------------------------------------------------


def _session_meta(entries: list[dict]) -> tuple[str | None, str | None]:
    for e in entries:
        if e.get("type") == "session":
            return (e.get("id") or None), (e.get("cwd") or None)
    return None, None


def _write_atomic(path: str, records: list[dict]) -> None:
    out_dir = os.path.dirname(os.path.abspath(path)) or "."
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as exc:
        raise OSError(f"cannot create {out_dir}: {exc}") from exc
    fd, tmp = tempfile.mkstemp(prefix=".omp-transcript-", suffix=".tmp", dir=out_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def _agent_name(filename: str) -> str:
    stem = os.path.splitext(filename)[0]
    return stem.lstrip("_") or "agent"


def convert_file(session_file: str, out: str, session_id: str | None = None) -> dict:
    entries = _load_entries(session_file)
    meta_id, cwd = _session_meta(entries)
    sid = session_id or meta_id or os.path.splitext(os.path.basename(session_file))[0]

    lead = _Converter(sid, None, False, cwd)
    lead.convert(entries)
    _write_atomic(out, lead.records)
    total = len(lead.records)

    # Colony / sub-agent / advisor files: <stem>/<Agent>.jsonl next to the lead.
    sub_dir = os.path.splitext(session_file)[0]
    out_sub = os.path.join(os.path.dirname(os.path.abspath(out)) or ".", "subagents")
    written: set[str] = set()
    for name in _list_dir(sub_dir):
        if not name.endswith(".jsonl"):
            continue
        try:
            sub_entries = _load_entries(os.path.join(sub_dir, name))
            conv = _Converter(sid, _agent_name(name), True, cwd)
            conv.convert(sub_entries)
            if not conv.records:
                continue
            # `__advisor.jsonl` and `advisor.jsonl` both reduce to "advisor":
            # never let the second silently overwrite the first.
            target, n = f"agent-{conv.agent}.jsonl", 1
            while target in written:
                n += 1
                target = f"agent-{conv.agent}-{n}.jsonl"
            _write_atomic(os.path.join(out_sub, target), conv.records)
            written.add(target)
            total += len(conv.records)
        except Exception as exc:  # noqa: BLE001 -- a bad sub file must not lose the lead
            _warn(f"skipped sub-agent file {name!r}: {type(exc).__name__}: {exc}")
    # A re-run is a full rewrite: drop sub-agent outputs this run did not
    # produce, or a stale file would keep being mirrored into the DB.
    for stale in _list_dir(out_sub):
        if (
            stale.startswith("agent-")
            and stale.endswith(".jsonl")
            and stale not in written
        ):
            try:
                os.unlink(os.path.join(out_sub, stale))
            except OSError as exc:
                _warn(f"could not remove stale {stale!r}: {exc}")
    return {"ok": True, "out": out, "lines": total, "session_id": sid}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="omp_transcript")
    sub = parser.add_subparsers(dest="cmd")
    conv = sub.add_parser("convert")
    conv.add_argument("--session-file", required=True)
    conv.add_argument("--out", required=True)
    conv.add_argument("--session-id", default=None)
    try:
        args = parser.parse_args(argv)
        if args.cmd != "convert":
            raise ValueError(
                "usage: omp_transcript.py convert --session-file F --out O"
            )
        result = convert_file(args.session_file, args.out, args.session_id)
    except SystemExit:
        result = {"ok": False, "error": "bad arguments"}
    except Exception as exc:  # noqa: BLE001 -- fail open, never wedge a session
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
