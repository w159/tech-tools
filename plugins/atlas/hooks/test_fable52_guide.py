"""Contract: atlas prompt text follows Anthropic's "Prompting Claude Fable 5.2" guide.

Each test pins text the guide asks for (finish the whole task, clear reports, progress
updates, subagent cost, reasons on absolute rules) and bans text the guide says to remove
(hard sentence caps, standing delegate-everything lines, stale telemetry cautions).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

ROOT = Path(__file__).resolve().parents[3]
ATLAS = ROOT / "plugins" / "atlas"


def _read(rel: str) -> str:
    path = ROOT / rel
    assert path.is_file(), f"missing file: {rel}"
    return path.read_text(encoding="utf-8")


def _check(rel: str, has: tuple[str, ...] = (), lacks: tuple[str, ...] = ()) -> None:
    text = _read(rel)
    for needle in has:
        assert needle in text, f"{rel} must contain: {needle!r}"
    for needle in lacks:
        assert needle not in text, f"{rel} must not contain: {needle!r}"


def test_references() -> None:
    _check(
        "plugins/atlas/references/operating-contract.md",
        has=(
            "## Finishing work",
            "Ordinary obstacles",
            "## Communicating clearly",
            "low-context reader",
            "Before your first tool call",
            "without asking",
        ),
        lacks=("Do not narrate intent",),
    )
    _check(
        "plugins/atlas/references/agent-common.md",
        has=("## Finishing work", "Ordinary obstacles", "plain full sentences"),
    )


def test_agents() -> None:
    files = sorted((ATLAS / "agents").glob("*.md"))
    assert len(files) >= 11
    for path in files:
        text = path.read_text(encoding="utf-8")
        rel = str(path.relative_to(ROOT))
        assert "Finishing work" in text, f"{rel} must point at the Finishing work rule"
        match = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
        assert match, f"{rel} has no description"
        assert re.search(r"\b[Ss]kip\b", match.group(1)), (
            f"{rel} description must say when to skip the dispatch"
        )
    _check(
        "plugins/atlas/agents/runner.md",
        lacks=("Do not try another way", "stops on surprise"),
    )
    _check("plugins/atlas/agents/explorer.md", lacks=("reference-dense",))


def test_lead_files() -> None:
    _check(
        "plugins/atlas/output-styles/atlas-orchestrator.md",
        has=(
            "Before the first tool call",
            "recap that stands on its own",
            "does not depend on the answer",
        ),
        lacks=("Decisions stop the line", "(gate o)", "## Length budget"),
    )
    _check("AGENTS.md", has=("costs a fresh context",), lacks=("for high-impact changes do three",))
    _check("plugins/atlas/omp/lead-addendum.md", lacks=("Never drop `agent`",))


def test_orchestrate() -> None:
    base = "plugins/atlas/skills/atlas-orchestrate/"
    _check(
        base + "SKILL.md",
        has=("A subagent costs",),
        lacks=("delegate anyway", "Protect your context window ruthlessly"),
    )
    _check(
        base + "references/laws-and-gates.md",
        lacks=('There is no "apply a quick fix yourself" path', "crossing >1 service boundary"),
    )
    _check(
        base + "references/anti-rationalization.md",
        lacks=("driven hard", "2026-09-24"),
    )
    _check(
        base + "references/multi-stage-planning.md",
        lacks=("most exhaustive correct answer",),
    )
    _check(
        base + "references/squad-and-tiers.md",
        lacks=("Dispatch constantly", "is a last resort"),
    )
    _check(
        base + "references/subagent-kit.md",
        has=("A subagent costs", "When delegation is worth it"),
    )


def test_skills_a() -> None:
    _check(
        "plugins/atlas/skills/atlas-prompt/SKILL.md",
        has=("ASD-STE100",),
        lacks=("20 words max", "one instruction per sentence", "ASDSTE-100"),
    )
    _check(
        "plugins/atlas/skills/atlas-prompt/references/prompt-spec-template.md",
        lacks=("MUST NOT DO:",),
    )
    _check(
        "plugins/atlas/skills/atlas-debug/SKILL.md",
        lacks=("step by step", "present it to the user, and re-diagnose"),
    )
    _check(
        "plugins/atlas/skills/atlas-debug/references/debug-workflow.md",
        lacks=("step by step",),
    )
    _check(
        "plugins/atlas/skills/atlas-resolve-pr-feedback/SKILL.md",
        lacks=("The confirmation gate is absolute",),
    )
    _check("plugins/atlas/skills/atlas-loop/SKILL.md", lacks=("visible to others",))


def test_skills_b() -> None:
    _check(
        "plugins/atlas/skills/atlas-refactor/SKILL.md",
        has=("you own this code's structure",),
    )
    _check(
        "plugins/atlas/skills/atlas-handoff/SKILL.md",
        has=("low-context reader",),
        lacks=("No summary of intent",),
    )
    _check(
        "plugins/atlas/skills/atlas-handoff/references/handoff-memory-schema.md",
        lacks=("cut it.",),
    )
    _check(
        "plugins/atlas/skills/atlas-bakeoff/SKILL.md",
        lacks=("reasoning that would survive",),
    )
    _check(
        "plugins/atlas/skills/atlas-readme/SKILL.md",
        lacks=("before writing a word",),
    )
    _check(
        "plugins/atlas/skills/atlas-explain/SKILL.md",
        lacks=("two minimum, four maximum",),
    )


def test_hooks_boot() -> None:
    _check(
        "plugins/atlas/hooks/session_boot_core.py",
        has=("A subagent adds cost",),
        lacks=("Route execution to atlas:<role> subagents",),
    )
    _check(
        "plugins/atlas/hooks/prompt_optimizer_core.py",
        has=("ASD-STE100",),
        lacks=("20 words max", "one instruction per sentence", "at most 3 lines"),
    )
    _check(
        "plugins/atlas/hooks/completion_gate_core.py",
        lacks=("do not start one",),
    )
    _check(
        "plugins/atlas/hooks/crew_worker.py",
        lacks=("you cannot finish yet",),
    )


def test_hooks_tripwire() -> None:
    _check(
        "plugins/atlas/hooks/dispatch_tripwire_core.py",
        has=("deliberate blockers", "plain full sentences"),
        lacks=("never edit target code inline", "STOP - route this"),
    )
    _check(
        "plugins/atlas/hooks/worker_report_gate_core.py",
        has=("plain full sentences",),
    )


def test_memory() -> None:
    _check("plugins/atlas/hooks/memory_capture.py", has=("noted ",))
    _check("plugins/atlas/scripts/recalled_memory.py", has=("still holds",))


def test_crew_mux() -> None:
    _check(
        "plugins/atlas/scripts/atlas_crew.py",
        lacks=("No status chatter", "Never `sleep`", "Then reply with one line"),
    )
    _check(
        "plugins/atlas/scripts/atlas_mux.py",
        has=("STATUS/STEPS/FILES_CHANGED/EVIDENCE/DELIVERABLE/NEXT",),
        lacks=("Do not retry sends", "Post no other notes to the board"),
    )
    _check(
        "plugins/atlas/scripts/atlas_todo.py",
        lacks=("instead of idling",),
    )
