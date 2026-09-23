#!/usr/bin/env python3
"""Resolve the Compound Packs declared in `.claude/atlas.local.md` into pack roots.

Why this exists: prescriptive team rules live in separate versioned roots, but
the agent that reads them is the same agent that can be told what to do by what
it reads. A resolver, not a prompt convention, is what keeps that boundary
mechanical: it decides which directories are packs, and it refuses to publish
any pack whose tree could read files off the user's machine, because consumers
later feed pack text into agent context. A pack that carries a symlink pointing
out of its source is not a pack with a broken file -- it is an exfiltration
attempt, and the whole pack is rejected rather than trimmed a file at a time.

Public interface (other atlas skills call this conditionally -- see
`plugins/atlas/references/compound-packs.md`):

    resolve_packs(repo_root) -> [{"id": ..., "rootPath": ..., "warnings": [...], "errors": [...]}, ...]

One entry per selected pack; a declaration that resolves to nothing still
yields one entry (`rootPath` None) carrying its warnings/errors, so a broken
declaration is loud rather than silent. An absent `packs:` key -- or a missing
config file -- returns `[]` with zero side effects: no directories created, no
git invoked. `rootPath` is always an absolute realpath.

Contract: per-entry failures are data, never crashes. Only a resolver crash is
caught and reported as JSON with exit 0; consumers treat `errors` as loud
configuration problems and `warnings` as degraded availability. Exit is 0
whenever the resolver ran at all.

Usage:
    python3 atlas_packs.py [--repo PATH]

prints {"packs": [...]} as JSON on stdout. Environment overrides:
ATLAS_PACKS_CACHE_ROOT (git cache base, default `<repo>/.atlas/.run/packs-cache`),
ATLAS_PACKS_GIT_TIMEOUT (clone/fetch seconds, default 60).

Rule shape (see references/compound-packs.md for the full contract): a rule is
a top-level `.md` in a pack whose closed YAML frontmatter carries a non-empty
`title` and a non-empty `applies_when` list. Subdirectories are storage, never
rules; top-level README.md is description-only whatever frontmatter it carries.

Stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# The documented declaration subset -- anything else under `packs:` is a loud error.
KNOWN_KEYS = {"source", "ref", "path", "pack", "id"}
SCALAR_KEYS = ("source", "ref", "path", "id")  # every known key but the list-valued `pack`

GIT_TIMEOUT = float(os.environ.get("ATLAS_PACKS_GIT_TIMEOUT") or 60)
_CACHE_DIRNAME = "packs-cache"

_FRONTMATTER_CAP = 64 * 1024  # frontmatter must close within this many characters
# A pack's README is its description, never a rule, whatever frontmatter it
# carries: it is not published, not reported as skipped, and not counted.
_README = "readme.md"


def _is_git_url(source: str) -> bool:
    return bool(
        re.match(r"^(https?|ssh|git|file)://", source) or re.match(r"^[\w.-]+@[\w.-]+:", source)
    )


def _within(path: str, parent: str) -> bool:
    """True when `path` is `parent` or lies below it (both already realpath'd)."""
    return path == parent or path.startswith(parent + os.sep)


# --- config (.claude/atlas.local.md frontmatter) ------------------------------

def frontmatter_lines(path: str) -> list[str] | None:
    """The YAML frontmatter lines of a markdown file, or None when the file is
    missing, unreadable, or opens without a closed `---` block. A UTF-8 BOM is
    not part of the content."""
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as fh:
            lines = fh.read(_FRONTMATTER_CAP).splitlines()
    except OSError:
        return None
    if not lines or lines[0].strip() != "---":
        return None
    for end, line in enumerate(lines[1:], 1):
        if line.strip() == "---":
            return lines[1:end]
    return None


def _strip_comment(line: str) -> str:
    """Drop a trailing comment (a # preceded by whitespace, outside quotes).

    A quote toggles quoted state only when it opens a value (start of line or
    after `: `/`- `/`[`/`,`) or closes one it opened -- a mid-word apostrophe
    (``it's``) is ordinary content and must not absorb a later comment.
    """
    out, quote = [], ""
    for i, ch in enumerate(line):
        prev = line[i - 1] if i else " "
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"" and prev in " \t[,:":
            quote = ch
        elif ch == "#" and prev in " \t":
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(raw: str):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        return raw[1:-1]
    if raw.lower() in ("true", "false"):
        return raw.lower() == "true"
    return raw


def _parse_value(raw: str):
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        return [] if not inner else [_scalar(part) for part in inner.split(",")]
    return _scalar(raw)


def parse_packs_block(lines: list[str], origin: str, errors: list) -> list:
    """Return the entry dicts under the top-level `packs:` key of frontmatter
    `lines`. A minimal reader for the documented `packs:` subset: block list of
    `- key: value` entries, inline `[a, b]` lists, trailing comments."""
    entries, in_packs, current, pending_list_key = [], False, None, None
    for lineno, raw in enumerate(lines, 1):
        line = _strip_comment(raw)
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0 and not (in_packs and line.lstrip().startswith("-")):
            # A new top-level key ends the packs block; a zero-indent list item
            # (`- source: ...`) is still part of it -- YAML allows both styles.
            key, sep, rest = line.partition(":")
            in_packs = bool(sep) and key.strip() == "packs" and rest.strip() in ("", "[]")
            if sep and key.strip() == "packs" and not in_packs:
                # `packs: <inline value>` is malformed, not absent: say so rather
                # than letting a flow list or a bare path declare nothing.
                errors.append(
                    f"{origin}:{lineno}: `packs:` must be a block list of"
                    f" `- source: ...` entries (got `{line.strip()}`)"
                )
            current, pending_list_key = None, None
            continue
        if not in_packs:
            continue
        stripped = line.strip()
        loc = f"{origin}:{lineno}"
        if stripped.startswith("- ") or stripped == "-":
            body = stripped[1:].strip()
            if pending_list_key and current is not None and ":" not in body:
                current[pending_list_key].append(_scalar(body))
                continue
            current, pending_list_key = {"_origin": origin, "_line": lineno}, None
            entries.append(current)
            if body:
                if ":" not in body:
                    errors.append(f"{loc}: unrecognized packs entry `{stripped}` -- expected `key: value`")
                    continue
                key, _, val = body.partition(":")
                _set_key(current, key.strip(), val, loc, errors)
            continue
        if current is None:
            errors.append(f"{loc}: unrecognized line under packs: `{stripped}` -- expected a `- source: ...` entry")
            continue
        if ":" not in stripped:
            errors.append(f"{loc}: unrecognized line under packs: `{stripped}` -- expected `key: value`")
            continue
        key, _, val = stripped.partition(":")
        key = key.strip()
        if val.strip() == "" and key == "pack":
            current[key] = []
            pending_list_key = key
            continue
        pending_list_key = None
        _set_key(current, key, val, loc, errors)
    return entries


def _set_key(entry: dict, key: str, raw_val: str, loc: str, errors: list) -> None:
    if key not in KNOWN_KEYS:
        errors.append(
            f"{loc}: unknown packs entry key `{key}:` -- accepted keys: {', '.join(sorted(KNOWN_KEYS))}"
        )
        return
    entry[key] = _parse_value(raw_val)


# --- git ----------------------------------------------------------------------

def _git_env() -> dict:
    """Non-interactive git: prompts, askpass, and SSH password prompts all fail
    fast instead of hanging a stage that runs unattended."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = env.get("GIT_ASKPASS") or "true"
    ssh = env.get("GIT_SSH_COMMAND") or "ssh"
    if "BatchMode" not in ssh:
        env["GIT_SSH_COMMAND"] = ssh + " -o BatchMode=yes"
    return env


def _run_git(args: list, cwd: str | None = None):
    return subprocess.run(
        ["git", *args], cwd=cwd, env=_git_env(), timeout=GIT_TIMEOUT,
        capture_output=True, text=True,
    )


def _cache_base(repo_root: str) -> str | None:
    """Where git checkouts cache: `<repo>/.atlas/.run/packs-cache/` by default
    (.run/ is ephemeral and gitignored), ATLAS_PACKS_CACHE_ROOT overrides for
    tests. None when no writable base exists, which degrades git sources only."""
    configured = os.environ.get("ATLAS_PACKS_CACHE_ROOT")
    base = os.path.abspath(configured) if configured else os.path.join(repo_root, ".atlas", ".run", _CACHE_DIRNAME)
    try:
        os.makedirs(base, exist_ok=True)
    except OSError:
        return None
    return base if os.path.isdir(base) and os.access(base, os.W_OK) else None


def _trusted_checkout(path: str) -> bool:
    """A real directory, never a symlink: the cache is trusted content, so a
    planted symlink at a cache key is refetched, never followed."""
    return not os.path.islink(path) and os.path.isdir(path)


def resolve_git_source(url: str, ref: str, warnings: list, label: str, repo_root: str) -> str | None:
    """Return the cached checkout dir for url@ref, cloning on miss. None = warn+skip."""
    if shutil.which("git") is None:
        warnings.append(f"{label}: git binary not found; source skipped")
        return None
    base = _cache_base(repo_root)
    if base is None:
        warnings.append(f"{label}: no writable packs cache under {repo_root}; source skipped")
        return None
    key = hashlib.sha256(f"{url}\n{ref}".encode()).hexdigest()
    dest = os.path.join(base, key)
    if os.path.lexists(dest):
        if _trusted_checkout(dest):
            return dest
        warnings.append(f"{label}: cached checkout {dest} is a symlink; refetching")
        # rmtree refuses to follow a symlink (and ignores a plain file); unlink
        # those explicitly so a planted link is removed, never its target.
        shutil.rmtree(dest, ignore_errors=True)
        if os.path.islink(dest) or os.path.isfile(dest):
            try:
                os.unlink(dest)
            except OSError:
                pass
        if os.path.lexists(dest):
            warnings.append(f"{label}: cannot replace untrusted cached checkout {dest}; source skipped")
            return None
    tmp = tempfile.mkdtemp(prefix=f"{key}.part-", dir=base)
    try:
        try:
            proc = _run_git(["clone", "--quiet", "--depth", "1", "--no-recurse-submodules",
                             "--branch", ref, "--end-of-options", url, tmp])
        except subprocess.TimeoutExpired:
            warnings.append(f"{label}: git clone timed out after {int(GIT_TIMEOUT)}s; source skipped")
            return None
        if proc.returncode != 0:
            # tag/branch clone failed -- retry treating ref as a commit sha
            try:
                fetched = (
                    _run_git(["init", "--quiet", tmp]).returncode == 0
                    and _run_git(["fetch", "--quiet", "--depth", "1", "--end-of-options", url, ref], cwd=tmp).returncode == 0
                    and _run_git(["checkout", "--quiet", "FETCH_HEAD"], cwd=tmp).returncode == 0
                )
                if not fetched:
                    warnings.append(f"{label}: cannot fetch `{ref}` from {url}; source skipped")
                    return None
            except subprocess.TimeoutExpired:
                warnings.append(f"{label}: git fetch timed out after {int(GIT_TIMEOUT)}s; source skipped")
                return None
        if not os.path.lexists(dest):
            try:
                os.replace(tmp, dest)
            except OSError:
                # Expected when another resolver published the same key
                # concurrently; anything else leaves no checkout to return.
                if not os.path.lexists(dest):
                    warnings.append(f"{label}: could not publish the clone to {dest}; source skipped")
                    return None
        if _trusted_checkout(dest):
            return dest
        warnings.append(f"{label}: cached checkout {dest} is a symlink; source skipped")
        return None
    finally:
        if os.path.isdir(tmp):
            shutil.rmtree(tmp, ignore_errors=True)


# --- rule files ---------------------------------------------------------------

def rule_frontmatter(path: str) -> dict | None:
    """`{title, applies_when}` for a rule-shaped file, else None.

    A rule is a top-level `.md` whose closed frontmatter carries a non-empty
    `title` and a non-empty `applies_when` list (block or inline). A README is
    never a rule whatever it carries; empty `applies_when` is not a rule, so a
    rule cannot accidentally match everything.
    """
    lines = frontmatter_lines(path)
    if lines is None:
        return None
    title, applies, in_list = None, [], False
    for raw in lines:
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("- ") or stripped == "-":
            if in_list:
                item = _scalar(stripped[1:].strip())
                if item:
                    applies.append(item)
            continue
        in_list = False
        key, sep, rest = stripped.partition(":")
        if not sep:
            continue
        if key == "title":
            title = _scalar(rest)
        elif key == "applies_when":
            value = rest.strip()
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                applies = [p for p in (_scalar(x.strip()) for x in inner.split(",")) if p] if inner else []
            else:
                in_list = True
    if not title or not applies:
        return None
    return {"title": str(title), "applies_when": applies}


def _contained_md_files(directory: str, boundary: str, escaped: list) -> list:
    """Paths of the `.md` entries directly under `directory`, minus its README,
    whose real path stays within `boundary` (a realpath). An entry that links
    outside it is appended to `escaped` and never opened, so a pack cannot read
    files off the user's machine."""
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    files = []
    for name in names:
        if not name.endswith(".md") or name.lower() == _README:
            continue
        child = os.path.join(directory, name)
        if _within(os.path.realpath(child), boundary):
            files.append(child)
        else:
            escaped.append(child)
    return files


def _contained_child_dirs(directory: str, boundary: str, escaped: list) -> list:
    """`(name, path)` of the non-hidden directories directly under `directory`
    whose real path stays within `boundary`; one that links outside it is
    appended to `escaped` and never entered."""
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    dirs = []
    for name in names:
        child = os.path.join(directory, name)
        if name.startswith(".") or not os.path.isdir(child):
            continue
        if _within(os.path.realpath(child), boundary):
            dirs.append((name, child))
        else:
            escaped.append(child)
    return dirs


def _has_rules(directory: str, boundary: str, escaped: list) -> bool:
    return any(rule_frontmatter(f) for f in _contained_md_files(directory, boundary, escaped))


def _escaping_links(root: str, boundary: str) -> list:
    """Symlinks anywhere under `root` (walked without following links) whose
    real path leaves `boundary`, sorted. Only a link can leave: every other
    entry sits under `root`, which is already inside the boundary."""
    leaks = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in dirnames + filenames:
            child = os.path.join(dirpath, name)
            if os.path.islink(child) and not _within(os.path.realpath(child), boundary):
                leaks.append(child)
    return sorted(leaks)


def enumerate_packs(source_root: str, boundary: str, escaped: list, self_name: str | None = None) -> dict:
    """Map published pack id -> dir. Immediate children only; self = single pack.

    A source publishes multiple packs when immediate child directories contain
    at least one valid top-level rule (child directory name = pack id); if the
    source root itself holds valid top-level rules, it is one pack named
    `self_name` (or its directory basename). Deeper nesting never creates
    additional packs: subdirectories are storage.
    """
    if _has_rules(source_root, boundary, escaped):
        name = self_name or os.path.basename(os.path.abspath(source_root))
        return {name: source_root}
    return {
        name: child
        for name, child in _contained_child_dirs(source_root, boundary, escaped)
        if _has_rules(child, boundary, escaped)
    }


def _nested_rules_warning(pack_id: str, pack_dir: str, boundary: str) -> str | None:
    """The warning for a source with no rule at its top level whose immediate
    subdirectories hold rule-shaped files: it registers, yet nothing can ever be
    discovered, because subdirectories are storage."""
    hits, total = [], 0
    for name, child in _contained_child_dirs(pack_dir, boundary, []):
        count = sum(1 for f in _contained_md_files(child, boundary, []) if rule_frontmatter(f))
        if count:
            hits.append(name)
            total += count
    if not hits:
        return None
    where = ", ".join(f"`{name}/`" for name in hits)
    return (
        f"pack `{pack_id}` has {total} rule-shaped file(s) under {where} that discovery"
        f" never reads -- move rules to the top level (see references/compound-packs.md, Pack layout)"
    )


# --- entry resolution ---------------------------------------------------------

def _entry_label(entry: dict) -> str:
    return f"{entry.get('_origin', 'config')}:{entry.get('_line', '?')}"


def resolve_entry(entry: dict, repo_root: str) -> list:
    """One declaration -> its pack entries. Every failure mode lands in the
    returned entry's `warnings`/`errors` rather than raising, so one broken
    declaration never hides the others."""
    label = _entry_label(entry)
    # Declaration-level notes; each pack entry snapshots them plus its own.
    warnings: list[str] = []
    errors: list[str] = []

    def out(pack_id, root_path, pack_warnings: list | None = None):
        return {
            "id": pack_id,
            "rootPath": root_path,
            "warnings": warnings + (pack_warnings or []),
            "errors": list(errors),
        }

    # I/O-free shape check first: scalar keys scalar, `source:` present.
    for key in SCALAR_KEYS:
        val = entry.get(key)
        if val is not None and not isinstance(val, str):
            errors.append(f"{label}: `{key}:` must be a single string (got {val!r})")
            return [out(entry.get("id"), None)]
    if not entry.get("source"):
        errors.append(f"{label}: entry has no `source:`")
        return [out(entry.get("id"), None)]

    source, ref, sub_path = entry["source"], entry.get("ref"), entry.get("path")

    if _is_git_url(source):
        if not isinstance(ref, str) or not ref:
            errors.append(f"{label}: git source `{source}` requires `ref:` (tag, sha, or branch)")
            return [out(entry.get("id"), None)]
        if ref.startswith("-") or source.startswith("-"):
            errors.append(f"{label}: git source/ref may not begin with `-`")
            return [out(entry.get("id"), None)]
        checkout = resolve_git_source(source, ref, warnings, label, repo_root)
        if checkout is None:
            return [out(entry.get("id"), None)]  # unreachable source: warn-and-continue
        source_root = os.path.join(checkout, sub_path) if sub_path else checkout
        real_root, real_checkout = os.path.realpath(source_root), os.path.realpath(checkout)
        if not _within(real_root, real_checkout):
            errors.append(f"{label}: path `{sub_path}` escapes the source checkout")
            return [out(entry.get("id"), None)]
        source_root, boundary = real_root, real_checkout
        if not os.path.isdir(source_root):
            errors.append(f"{label}: path `{sub_path}` does not exist in {source}@{ref}")
            return [out(entry.get("id"), None)]
        # Display name for a single-pack git source: the path: subfolder's
        # basename, else the URL's last path segment (never the cache key).
        tail = (sub_path or source).rstrip("/").rsplit("/", 1)[-1]
        self_name = re.sub(r"\.git$", "", tail.split(":")[-1]) or None
    else:
        if ref is not None:
            errors.append(f"{label}: `ref:` is only valid on git sources; path sources are read live")
            return [out(entry.get("id"), None)]
        if sub_path is not None:
            errors.append(f"{label}: `path:` is only valid on git sources; point `source:` at the directory instead")
            return [out(entry.get("id"), None)]
        expanded = os.path.expanduser(source)
        if os.path.isabs(expanded):
            source_root = os.path.realpath(expanded)
            boundary = source_root
        else:
            # Repo-relative sources must stay inside the repository and outside
            # `.git`; this is the boundary pack content can never leave.
            source_root = os.path.realpath(os.path.join(repo_root, expanded))
            repo_real = os.path.realpath(repo_root)
            if not _within(source_root, repo_real) or _within(source_root, os.path.join(repo_real, ".git")):
                errors.append(f"{label}: repo-relative source `{source}` resolves outside the repository")
                return [out(entry.get("id"), None)]
            boundary = repo_real
        if not os.path.isdir(source_root):
            errors.append(f"{label}: source directory `{source}` does not exist")
            return [out(entry.get("id"), None)]
        self_name = None

    escaped = []
    published = enumerate_packs(source_root, boundary, escaped, self_name)
    for link in escaped:
        warnings.append(
            f"{label}: skipped `{os.path.relpath(link, source_root)}` in `{source}` -- it links outside the source"
        )
    if not published:
        warnings.append(f"{label}: source `{source}` publishes no packs (no top-level rules)")
        # Each child directory is a would-be pack with no top-level rule; say
        # when its rules sit one level too deep, so the author learns why
        # nothing published.
        for name, child in _contained_child_dirs(source_root, boundary, []):
            nested = _nested_rules_warning(name, child, boundary)
            if nested:
                warnings.append(f"{label}: {nested}")
        return [out(entry.get("id"), None)]

    selection = entry.get("pack")
    if selection is None:
        selected = dict(published)
    else:
        wanted = selection if isinstance(selection, list) else [selection]
        if not wanted:
            warnings.append(f"{label}: `pack:` lists no ids; nothing installed from `{source}`")
            return [out(entry.get("id"), None)]
        missing = [w for w in wanted if w not in published]
        if missing:
            errors.append(
                f"{label}: pack id(s) {', '.join(map(str, missing))} not published by `{source}`"
                f" -- available: {', '.join(sorted(published)) or 'none'}"
            )
            return [out(entry.get("id"), None)]
        selected = {w: published[w] for w in wanted}

    override = entry.get("id")
    if override is not None:
        if len(selected) != 1:
            errors.append(f"{label}: `id:` override requires the entry to install exactly one pack")
            return [out(entry.get("id"), None)]
        selected = {str(override): next(iter(selected.values()))}

    outputs = []
    for pack_id, pack_dir in selected.items():
        # Consumers list the pack directory themselves, so a link that leaves
        # the source anywhere inside it would let pack content read files off
        # the user's machine: refuse the whole pack. This is the prompt-injection
        # / data-exfiltration boundary -- never trim a file at a time.
        leaks = _escaping_links(pack_dir, boundary)
        if leaks:
            names = ", ".join(f"`{os.path.relpath(p, pack_dir)}`" for p in leaks)
            errors.append(f"{label}: pack `{pack_id}` not published -- {names} link(s) outside the source")
            continue
        skipped = []
        for child in _contained_md_files(pack_dir, boundary, []):
            name = os.path.basename(child)
            if os.path.isfile(child) and not rule_frontmatter(child):
                skipped.append(
                    f"{label}: skipped pack file `{pack_id}/{name}`"
                    " (missing or empty `title`/`applies_when` frontmatter)"
                )
        outputs.append(out(pack_id, pack_dir, skipped))
    return outputs or [out(entry.get("id"), None)]


# --- public interface ---------------------------------------------------------

def resolve_packs(repo_root: str) -> list:
    """Resolve the packs declared in `<repo_root>/.claude/atlas.local.md`.

    Returns one entry per selected pack:

        {"id": ..., "rootPath": ..., "warnings": [...], "errors": [...]}

    `rootPath` is an absolute realpath, or None when the declaration resolved
    to nothing (its `warnings`/`errors` say why). An absent `packs:` key -- or a
    missing/unfrontmattered config file -- returns `[]` with zero side effects.
    Duplicate pack ids: the first declaration wins, later ones are reported as
    errors and resolve to nothing.
    """
    repo = os.path.realpath(repo_root)
    lines = frontmatter_lines(os.path.join(repo, ".claude", "atlas.local.md"))
    if lines is None:
        return []  # no config, no packs, no side effects
    parse_errors: list[str] = []
    entries = parse_packs_block(lines, "atlas.local.md", parse_errors)
    packs: list[dict] = []
    if parse_errors:
        # A malformed packs block is still a declaration the consumer should surface.
        packs.append({"id": None, "rootPath": None, "warnings": [], "errors": parse_errors})
    for entry in entries:
        try:
            packs.extend(resolve_entry(entry, repo))
        except Exception as exc:  # one entry's surprise is that entry's error, not everyone's
            packs.append({
                "id": entry.get("id"), "rootPath": None, "warnings": [],
                "errors": [f"{_entry_label(entry)}: unexpected error resolving entry: {exc}"],
            })
    # First declaration wins: a personal `id:` can never displace an earlier pack.
    final, seen = [], set()
    for pack in packs:
        pid = pack["id"]
        if pid is None:
            final.append(pack)
            continue
        if pid in seen:
            pack["id"] = None  # keeps output ids unique: this declaration is gone
            pack["rootPath"] = None
            pack["errors"].append(
                f"duplicate pack id `{pid}`: this declaration ignored -- the first declaration wins"
            )
            final.append(pack)
            continue
        seen.add(pid)
        final.append(pack)
    return final


def main(argv: list | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Resolve the Compound Packs declared in .claude/atlas.local.md."
    )
    p.add_argument("--repo", default=os.getcwd(), help="repository root (default: working directory)")
    args = p.parse_args(argv)
    try:
        packs = resolve_packs(args.repo)
    except Exception as exc:  # never a traceback: consumers need valid JSON
        print(json.dumps({"packs": [], "errors": [f"packs resolver failed unexpectedly: {exc}"]}))
        return 0
    print(json.dumps({"packs": packs}))
    return 0


if __name__ == "__main__":
    sys.exit(main())