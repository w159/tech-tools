#!/usr/bin/env python3
"""
Minutes → Graphiti reference adapter.

Walks a Minutes meetings folder (default ~/.minutes/demo), parses YAML
frontmatter, and pushes each meeting as a temporal episode into Graphiti.

This is a reference implementation, not a supported package. The shape of
the mapping is what matters — fork and adapt for your use case.

Usage:
    OPENAI_API_KEY=... python adapter.py
    OPENAI_API_KEY=... python adapter.py --meetings-dir ~/meetings
    python adapter.py --dry-run          # no Graphiti or OpenAI required
"""

import argparse
import asyncio
import json
import os
import pathlib
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("Missing dep: pip install pyyaml\n")
    sys.exit(1)

# graphiti import is deferred to main() so --dry-run works without it installed.

DEFAULT_MEETINGS_DIR = pathlib.Path.home() / ".minutes" / "demo"
DEFAULT_GROUP_ID = "minutes-corpus"


def resolve_meetings_dir(cli_arg: pathlib.Path | None) -> pathlib.Path:
    """CLI flag wins, then MEETINGS_DIR env, then the demo dir."""
    if cli_arg is not None:
        return cli_arg
    env = os.environ.get("MEETINGS_DIR")
    if env:
        return pathlib.Path(env).expanduser()
    return DEFAULT_MEETINGS_DIR


def parse_frontmatter(path: pathlib.Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("---\n", 2)
    if len(parts) < 3:
        return {}, text
    fm = yaml.safe_load(parts[1]) or {}
    return fm, parts[2]


def meeting_to_episode_body(fm: dict, body: str) -> dict:
    """Build the JSON payload Graphiti will LLM-extract entities from.

    Keeping the structure close to the frontmatter itself (decisions, action
    items, attendees) gives Graphiti the best signal for entity + temporal
    reasoning.
    """
    summary = ""
    if "## Summary" in body:
        chunk = body.split("## Summary", 1)[1].split("\n##", 1)[0]
        summary = chunk.strip()

    return {
        "title": fm.get("title"),
        "type": fm.get("type"),
        "attendees": fm.get("attendees") or [],
        "tags": fm.get("tags") or [],
        "decisions": [
            {
                "text": d.get("text"),
                "topic": d.get("topic"),
                "authority": d.get("authority"),
                "supersedes": d.get("supersedes"),
            }
            for d in fm.get("decisions") or []
        ],
        "action_items": [
            {
                "assignee": a.get("assignee"),
                "task": a.get("task"),
                "due": a.get("due"),
                "status": a.get("status"),
            }
            for a in fm.get("action_items") or []
        ],
        "summary": summary,
    }


async def run(args) -> int:
    meetings_dir = resolve_meetings_dir(args.meetings_dir)
    if not meetings_dir.exists():
        sys.stderr.write(
            f"No meetings dir at {meetings_dir}. Try `npx minutes-mcp --demo` first.\n"
        )
        return 1

    graphiti = None
    if not args.dry_run:
        if not os.environ.get("OPENAI_API_KEY"):
            sys.stderr.write(
                "OPENAI_API_KEY not set. Graphiti uses LLM-based entity extraction. "
                "Set it or run with --dry-run.\n"
            )
            return 1
        try:
            from graphiti_core import Graphiti  # type: ignore
            from graphiti_core.nodes import EpisodeType  # type: ignore
        except ImportError:
            sys.stderr.write("Missing dep: pip install graphiti-core\n")
            return 1
        graphiti = Graphiti(args.neo4j_uri, args.neo4j_user, args.neo4j_password)
        await graphiti.build_indices_and_constraints()

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

        episode_body = meeting_to_episode_body(fm, body)
        name = fm.get("title", md_path.stem)
        ref_time = fm.get("date")

        if args.dry_run:
            print(f"[dry] episode: {name} @ {ref_time}")
            print(f"        decisions={len(episode_body['decisions'])} "
                  f"action_items={len(episode_body['action_items'])} "
                  f"attendees={len(episode_body['attendees'])}")
        else:
            assert graphiti is not None
            try:
                await graphiti.add_episode(
                    name=name,
                    episode_body=json.dumps(episode_body, default=str),
                    source=EpisodeType.json,
                    source_description=f"Minutes meeting file: {md_path.name}",
                    reference_time=ref_time,
                    group_id=args.group_id,
                )
            except Exception as e:
                skipped.append(f"{md_path.name}: add_episode failed ({e})")
                continue
        total += 1

    print(f"Pushed {total} episodes from {meetings_dir}")
    if skipped:
        print(f"Skipped {len(skipped)} item(s):")
        for s in skipped:
            print(f"  - {s}")
    if not args.dry_run:
        print(f"Query with: graphiti.search('your question', group_ids=['{args.group_id}'])")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipe Minutes meetings into Graphiti.")
    parser.add_argument(
        "--meetings-dir",
        type=pathlib.Path,
        default=None,
        help="Folder of meeting markdown files. "
        "Defaults to $MEETINGS_DIR if set, else ~/.minutes/demo.",
    )
    parser.add_argument("--group-id", default=DEFAULT_GROUP_ID)
    parser.add_argument("--neo4j-uri", default="bolt://localhost:7687")
    parser.add_argument("--neo4j-user", default="neo4j")
    parser.add_argument("--neo4j-password", default="demodemodemo")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
