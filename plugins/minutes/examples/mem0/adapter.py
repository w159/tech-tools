#!/usr/bin/env python3
"""
Minutes → Mem0 reference adapter.

Walks a Minutes meetings folder (default ~/.minutes/demo), parses YAML
frontmatter, and pushes one memory per meeting summary plus one per
decision and action item into Mem0.

This is a reference implementation, not a supported package. The shape of
the mapping is what matters — fork and adapt for your use case.

Usage:
    MEM0_API_KEY=... python adapter.py
    MEM0_API_KEY=... python adapter.py --meetings-dir ~/meetings
"""

import argparse
import os
import pathlib
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("Missing dep: pip install pyyaml\n")
    sys.exit(1)

# mem0 import is deferred to main() so --dry-run works without the SDK installed.


DEFAULT_MEETINGS_DIR = pathlib.Path.home() / ".minutes" / "demo"


def resolve_meetings_dir(cli_arg: pathlib.Path | None) -> pathlib.Path:
    """CLI flag wins, then MEETINGS_DIR env, then the demo dir."""
    if cli_arg is not None:
        return cli_arg
    env = os.environ.get("MEETINGS_DIR")
    if env:
        return pathlib.Path(env).expanduser()
    return DEFAULT_MEETINGS_DIR


def parse_frontmatter(path: pathlib.Path) -> tuple[dict, str]:
    """Return (frontmatter dict, body text). Schema guarantees UTF-8."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("---\n", 2)
    if len(parts) < 3:
        return {}, text
    fm = yaml.safe_load(parts[1]) or {}
    return fm, parts[2]


def build_memories(fm: dict, body: str, path: pathlib.Path) -> list[dict]:
    """Produce the list of (content, metadata) memory records for one meeting."""
    title = fm.get("title", path.stem)
    date = str(fm.get("date", ""))
    attendees = fm.get("attendees") or []
    # Metadata intentionally carries only the file NAME, not the absolute path.
    # Absolute paths would leak local home-directory layout to Mem0.
    base_meta = {
        "source": "minutes",
        "file": path.name,
        "date": date,
        "title": title,
        "attendees": attendees,
        "tags": fm.get("tags") or [],
    }

    memories = []

    # Meeting-level summary memory: grab the Summary section if present,
    # otherwise the first 500 chars of the transcript.
    summary_text = ""
    if "## Summary" in body:
        chunk = body.split("## Summary", 1)[1]
        chunk = chunk.split("\n##", 1)[0]
        summary_text = chunk.strip()
    if not summary_text:
        summary_text = body.strip()[:500]
    if summary_text:
        memories.append({
            "content": f"{title} ({date}): {summary_text}",
            "metadata": {**base_meta, "category": "meeting"},
        })

    # One memory per decision, carrying authority and supersedes for downstream
    # conflict resolution.
    for d in fm.get("decisions") or []:
        memories.append({
            "content": f"Decision ({title}, {date}): {d.get('text', '')}",
            "metadata": {
                **base_meta,
                "category": "decision",
                "topic": d.get("topic"),
                "authority": d.get("authority"),
                "supersedes": d.get("supersedes"),
            },
        })

    # One memory per action item, carrying assignee + due date.
    for item in fm.get("action_items") or []:
        memories.append({
            "content": (
                f"Action ({title}, {date}): {item.get('assignee', 'unassigned')} "
                f"→ {item.get('task', '')} (due {item.get('due', 'unspecified')}, "
                f"status {item.get('status', 'open')})"
            ),
            "metadata": {
                **base_meta,
                "category": "action_item",
                "assignee": item.get("assignee"),
                "due": item.get("due"),
                "status": item.get("status"),
            },
        })

    return memories


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipe Minutes meetings into Mem0.")
    parser.add_argument(
        "--meetings-dir",
        type=pathlib.Path,
        default=None,
        help="Folder of meeting markdown files. "
        "Defaults to $MEETINGS_DIR if set, else ~/.minutes/demo.",
    )
    parser.add_argument("--user-id", default="minutes-demo")
    parser.add_argument("--agent-id", default="minutes-adapter")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be pushed; don't call Mem0.")
    args = parser.parse_args()

    meetings_dir = resolve_meetings_dir(args.meetings_dir)
    if not meetings_dir.exists():
        sys.stderr.write(f"No meetings dir at {meetings_dir}. Try `npx minutes-mcp --demo` first.\n")
        return 1

    client = None
    if not args.dry_run:
        if not os.environ.get("MEM0_API_KEY"):
            sys.stderr.write(
                "MEM0_API_KEY not set. Sign up at https://app.mem0.ai or run with --dry-run.\n"
            )
            return 1
        try:
            from mem0 import MemoryClient
        except ImportError:
            sys.stderr.write("Missing dep: pip install mem0ai\n")
            return 1
        client = MemoryClient()

    total = 0
    skipped: list[str] = []
    for md_path in sorted(meetings_dir.rglob("*.md")):
        try:
            fm, body = parse_frontmatter(md_path)
        except Exception as e:
            skipped.append(f"{md_path.name}: parse error ({e})")
            continue
        if not fm:
            skipped.append(f"{md_path.name}: no frontmatter")
            continue
        memories = build_memories(fm, body, md_path)
        for mem in memories:
            if args.dry_run:
                print(f"[dry] {mem['metadata']['category']}: {mem['content'][:80]}")
            else:
                try:
                    client.add(
                        mem["content"],
                        user_id=args.user_id,
                        agent_id=args.agent_id,
                        metadata=mem["metadata"],
                    )
                except Exception as e:
                    skipped.append(f"{md_path.name}: Mem0 add failed ({e})")
                    continue
            total += 1

    print(f"Pushed {total} memories from {meetings_dir}")
    if skipped:
        print(f"Skipped {len(skipped)} item(s):")
        for s in skipped:
            print(f"  - {s}")
    if not args.dry_run:
        print(f"Query with: client.search(query='...', user_id='{args.user_id}', agent_id='{args.agent_id}')")
    return 0


if __name__ == "__main__":
    sys.exit(main())
