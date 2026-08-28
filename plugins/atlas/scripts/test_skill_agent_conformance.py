#!/usr/bin/env python3
"""Conformance tests for atlas skill SKILL.md files.

A skill's SKILL.md may direct the model to load a reference file via a
${CLAUDE_PLUGIN_ROOT} or ${CLAUDE_SKILL_DIR} expansion. Those load directives
must resolve to a file that actually exists - either under the skill's own
references/ directory or under the plugin-level references/ directory. A
dangling directive sends the model to a file that does not exist relative to
either base, which silently breaks the skill's operating contract.
"""

import pathlib
import re
import shutil
import tempfile
import unittest

# Repo root is three levels up: scripts/ -> atlas/ -> plugins/ -> repo root.
# Plugin root is two levels up: scripts/ -> atlas/ -> plugins/atlas.
_THIS_DIR = pathlib.Path(__file__).resolve().parent
PLUGIN_ROOT = _THIS_DIR.parent

# Match a load directive that expands to a references/<name>.md path.
# Group 1 captures whatever sits between the expansion var and "references/"
# (e.g. "/skills/atlas-orchestrate/" for a cross-skill directive, or just "/"
# for a same-skill one); group 2 captures the trailing references/<name>.md
# portion. The leading expansion var (${CLAUDE_PLUGIN_ROOT} or
# ${CLAUDE_SKILL_DIR}) anchors this to actual load directives, ignoring prose
# mentions of other skills' references.
_REF_RE = re.compile(
    r"\$\{(?:CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR)\}([^\s`\"\')\]]*?)"
    r"(references/[A-Za-z0-9_.-]+\.md)"
)

# Detects an explicit cross-skill path segment ("skills/<skill>/") immediately
# preceding the references/<file>.md tail, e.g.
# ${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/foo.md. Such a
# directive is fully qualified from the plugin root and should resolve there,
# unlike a bare cross-skill mention (no expansion var at all).
_CROSS_SKILL_PREFIX_RE = re.compile(r"(?:^|/)skills/([A-Za-z0-9_.-]+)/$")


def _dangling_references(plugin_root: pathlib.Path):
    """Return list of (skill_md_rel, reference) for unresolved load directives.

    A directive of the form ${CLAUDE_PLUGIN_ROOT}/skills/<skill>/references/<f>
    is a fully-qualified cross-skill reference and resolves against
    plugin_root/skills/<skill>/references/<f>; anything else resolves under the
    referencing skill's own references/ dir or the plugin-level references/ dir.
    """
    dangling = []
    for skill_md in sorted((plugin_root / "skills").glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        skill_dir = skill_md.parent
        for match in _REF_RE.finditer(text):
            prefix, ref_str = match.group(1), match.group(2)
            cross = _CROSS_SKILL_PREFIX_RE.search(prefix)
            if cross:
                other_skill = cross.group(1)
                if (plugin_root / "skills" / other_skill / ref_str).is_file():
                    continue
                dangling.append(
                    (
                        str(skill_md.relative_to(plugin_root)),
                        f"skills/{other_skill}/{ref_str}",
                    )
                )
                continue
            ref = pathlib.Path(ref_str)
            if (skill_dir / ref).is_file():
                continue
            if (plugin_root / ref).is_file():
                continue
            dangling.append((str(skill_md.relative_to(plugin_root)), str(ref)))
    return dangling


# Any references/<file>.md token, bare or prefixed, including cross-skill forms
# like atlas-orchestrate/references/foo.md. Captures only the basename; the
# resolution rule is "the file exists in the referencing skill's references/ or
# the plugin-level references/", so a file that lives only in a different skill
# is dangling (a cross-skill link is dead at runtime - ${CLAUDE_SKILL_DIR}
# expands to the *referencing* skill, not the one named in prose) - UNLESS the
# mention is explicitly qualified as a cross-skill path via
# ${CLAUDE_PLUGIN_ROOT}/skills/<skill>/references/<file> or ../<skill>/references/<file>,
# both of which unambiguously name the target skill and resolve against
# plugin_root/skills/<skill>/references/<file>.
_REF_NAME_RE = re.compile(
    r"(?:\$\{CLAUDE_PLUGIN_ROOT\}/skills/(?P<xskill1>[A-Za-z0-9_.-]+)/"
    r"|\.\./(?P<xskill2>[A-Za-z0-9_.-]+)/"
    r")?"
    r"references/(?P<file>[A-Za-z0-9_.-]+\.md)"
)

# A scripts/<file> token with an optional ${CLAUDE_*} expansion prefix. Captures
# (prefix_or_None, filename). The negative lookbehind avoids matching the tail
# of a longer word (e.g. "subscripts/"). Only script extensions that appear in
# the plugin are matched, so prose uses of "scripts/" do not false-trigger.
_SCRIPT_RE = re.compile(
    r"(\$\{(?:CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}/)?"
    r"(?<!\w)scripts/([A-Za-z0-9_.-]+\.(?:py|sh|sql))"
)

# A prefixed references/<file>.md load directive. Captures (var, ref) so the
# caller can resolve against the base the prefix actually expands to.
_PREFIXED_REF_RE = re.compile(
    r"\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}/(references/[A-Za-z0-9_.-]+\.md)"
)


def _dangling_skill_references(plugin_root: pathlib.Path):
    """Dangling references/<file>.md or scripts/<file> mentions in any SKILL.md.

    A mention resolves when the file lives in the referencing skill's own
    references/ (or scripts/) dir or the plugin-level references/ (or scripts/)
    dir. A file that lives only in a different skill is dangling.
    """
    dangling = []
    for skill_md in sorted((plugin_root / "skills").glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        skill_dir = skill_md.parent
        for m in _REF_NAME_RE.finditer(text):
            base = m.group("file")
            xskill = m.group("xskill1") or m.group("xskill2")
            if xskill:
                if (plugin_root / "skills" / xskill / "references" / base).is_file():
                    continue
                dangling.append(
                    (
                        str(skill_md.relative_to(plugin_root)),
                        f"skills/{xskill}/references/{base}",
                    )
                )
                continue
            if (skill_dir / "references" / base).is_file():
                continue
            if (plugin_root / "references" / base).is_file():
                continue
            dangling.append(
                (str(skill_md.relative_to(plugin_root)), f"references/{base}")
            )
        for m in _SCRIPT_RE.finditer(text):
            prefix, name = m.group(1), m.group(2)
            if prefix:
                base_dir = skill_dir if "SKILL_DIR" in prefix else plugin_root
                if (base_dir / "scripts" / name).is_file():
                    continue
            if (skill_dir / "scripts" / name).is_file():
                continue
            if (plugin_root / "scripts" / name).is_file():
                continue
            dangling.append((str(skill_md.relative_to(plugin_root)), f"scripts/{name}"))
    return dangling


def _wrong_prefix_references(plugin_root: pathlib.Path):
    """Prefixed references/ load directives whose prefix base does not hold the file.

    ${CLAUDE_PLUGIN_ROOT}/references/<f> must resolve under plugins/atlas/references/.
    ${CLAUDE_SKILL_DIR}/references/<f> must resolve under the skill's own references/.
    """
    wrong = []
    for skill_md in sorted((plugin_root / "skills").glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        skill_dir = skill_md.parent
        for m in _PREFIXED_REF_RE.finditer(text):
            var, ref = m.group(1), m.group(2)
            base_dir = skill_dir if var == "CLAUDE_SKILL_DIR" else plugin_root
            if not (base_dir / ref).is_file():
                wrong.append(
                    (str(skill_md.relative_to(plugin_root)), f"${{{var}}}/{ref}")
                )
    return wrong


def _bare_plugin_scripts_references(plugin_root: pathlib.Path):
    """Bare scripts/<file> refs whose file lives in the plugin scripts/ dir.

    A bare scripts/<file> path is ambiguous between the skill-local scripts/
    and the plugin scripts/; the ambiguity is real (a reader cannot tell which
    is meant) when the file actually lives in the plugin scripts/ dir. Bare
    refs to a script that lives only in the skill's own scripts/ are not
    flagged - the skill's own scripts/ is the unambiguous home.
    """
    bare = []
    for skill_md in sorted((plugin_root / "skills").glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        for m in _SCRIPT_RE.finditer(text):
            prefix, name = m.group(1), m.group(2)
            if prefix:
                continue
            if (plugin_root / "scripts" / name).is_file():
                bare.append((str(skill_md.relative_to(plugin_root)), f"scripts/{name}"))
    return bare


def _malformed_frontmatter(plugin_root: pathlib.Path):
    """Return list of (skill_md_rel, reason) for SKILL.md files with malformed frontmatter.

    The file must open with a standalone ``---`` line, have a second standalone
    ``---`` closing delimiter, no frontmatter value line carrying a trailing
    run of 6+ dashes, and a body after the closing delimiter.
    """
    bad = []
    for skill_md in sorted((plugin_root / "skills").glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        lines = text.splitlines()
        rel = str(skill_md.relative_to(plugin_root))

        if not lines or lines[0].strip() != "---":
            bad.append((rel, "missing opening standalone '---' line"))
            continue

        close_idx = None
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                close_idx = i
                break
        if close_idx is None:
            bad.append((rel, "no standalone closing '---' delimiter"))
            continue

        for i in range(1, close_idx):
            if re.search(r"-{6,}$", lines[i]) and lines[i].rstrip().endswith(
                "-" * 6
            ):
                bad.append(
                    (rel, f"trailing 6+ dashes glued to value: {lines[i]!r}")
                )
                break

        if close_idx + 1 >= len(lines):
            bad.append((rel, "no body after closing '---' delimiter"))

    return bad


class TestSkillAgentConformance(unittest.TestCase):
    def test_no_dangling_references(self):
        """Every ${CLAUDE_PLUGIN_ROOT}/${CLAUDE_SKILL_DIR} reference must resolve.

        Resolves under the skill's own references/ dir or the plugin-level
        references/ dir. Catches the H5 operating-contract defect where 14
        skills pointed at skills/atlas-orchestrate/references/operating-contract.md,
        a path that resolves under neither base.
        """
        dangling = _dangling_references(PLUGIN_ROOT)
        self.assertEqual(
            [],
            dangling,
            "dangling reference load directives (resolve under neither the "
            "skill's own references/ dir nor the plugin-level references/ dir): "
            + ", ".join(f"{s} -> {r}" for s, r in dangling),
        )

    def test_no_dangling_skill_references(self):
        """Every references/<file>.md and scripts/<file> mention must resolve.

        A mention resolves to a real file in the referencing skill's own
        references/ (or scripts/) dir or the plugin-level references/ (or
        scripts/) dir. Catches M16 cross-skill links like
        atlas-orchestrate/references/workflow-template.md written in another
        skill's SKILL.md: the file lives in a different skill, so the link is
        dead at runtime (${CLAUDE_SKILL_DIR} expands to the referencing skill).
        """
        dangling = _dangling_skill_references(PLUGIN_ROOT)
        self.assertEqual(
            [],
            dangling,
            "dangling references/<file>.md or scripts/<file> mentions (the file "
            "lives in neither the referencing skill's own references/scripts/ dir "
            "nor the plugin-level references/scripts/ dir): "
            + ", ".join(f"{s} -> {r}" for s, r in dangling),
        )

    def test_skill_reference_prefix_resolves(self):
        """A prefixed references/ load directive must resolve at its prefix base.

        ${CLAUDE_PLUGIN_ROOT}/references/<f> must resolve under the plugin
        references/ dir; ${CLAUDE_SKILL_DIR}/references/<f> must resolve under
        the skill's own references/ dir. Catches M17 wrong-prefix directives
        that send the model to a file that does not exist at the named base.
        """
        wrong = _wrong_prefix_references(PLUGIN_ROOT)
        self.assertEqual(
            [],
            wrong,
            "prefixed references/ directives that do not resolve at their prefix base: "
            + ", ".join(f"{s} -> {r}" for s, r in wrong),
        )

    def test_valid_frontmatter(self):
        """Every SKILL.md has well-formed YAML frontmatter.

        The file must begin with a standalone ``---`` line, have a second
        standalone ``---`` line that closes the frontmatter, no frontmatter
        value line may carry a trailing run of 6+ dashes glued to the value
        (the H->corruption where the closing delimiter merged into the last
        value as a trailing ``------``), and a body must follow the closing
        delimiter. Catches the O-frontmatter-validity defect where 10 skills
        lost their standalone closing ``---`` to a merged trailing ``------``.
        """
        bad = _malformed_frontmatter(PLUGIN_ROOT)

        self.assertEqual(
            [],
            bad,
            "SKILL.md files with malformed frontmatter: "
            + "; ".join(f"{s}: {msg}" for s, msg in bad),
        )

    def test_no_bare_scripts_reference(self):
        """No SKILL.md may use a bare scripts/<file> path into the plugin scripts/.

        A bare scripts/<file> path is ambiguous between the skill-local
        scripts/ and the plugin scripts/ when the file lives in the plugin
        scripts/ dir. Catches M18 bare refs like scripts/build_hub.py written
        where the reader cannot tell which scripts/ is meant. Prefix with
        ${CLAUDE_SKILL_DIR}/scripts/ (skill-local) or ${CLAUDE_PLUGIN_ROOT}/scripts/
        (plugin-level) to disambiguate.
        """
        bare = _bare_plugin_scripts_references(PLUGIN_ROOT)
        self.assertEqual(
            [],
            bare,
            "bare scripts/<file> refs into the plugin scripts/ dir (ambiguous "
            "between skill-local and plugin scripts/ - prefix with "
            "${CLAUDE_SKILL_DIR}/scripts/ or ${CLAUDE_PLUGIN_ROOT}/scripts/): "
            + ", ".join(f"{s} -> {r}" for s, r in bare),
        )


class TestSyntheticDetection(unittest.TestCase):
    """Exercise the detection-failure branches with synthetic malformed SKILL.md files.

    The shipped skill corpus is clean, so the conformance tests above never
    reach the detection-failure branches of the four checkers. These tests feed
    synthetic malformed SKILL.md files through each checker via a tmp
    plugin_root so a regression of the detection logic itself is caught.
    """

    def _make_root(self, skills: dict[str, str]) -> pathlib.Path:
        """Build a tmp plugin_root with skills/<name>/SKILL.md and empty top dirs."""
        root = pathlib.Path(tempfile.mkdtemp(prefix="atlas_conf_"))
        (root / "references").mkdir()
        (root / "scripts").mkdir()
        for name, text in skills.items():
            sdir = root / "skills" / name
            sdir.mkdir(parents=True)
            (sdir / "SKILL.md").write_text(text, encoding="utf-8")
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        return root

    def test_dangling_references_detects_unresolved_directive(self):
        skill = (
            "---\nname: x\n---\n\nSee "
            "${CLAUDE_PLUGIN_ROOT}/references/ghost.md\n"
        )
        root = self._make_root({"atlas-x": skill})
        self.assertEqual(
            _dangling_references(root),
            [("skills/atlas-x/SKILL.md", "references/ghost.md")],
        )

    def test_dangling_skill_references_detects_missing_ref_and_script(self):
        skill = (
            "---\nname: x\n---\n\nSee references/ghost.md and "
            "${CLAUDE_SKILL_DIR}/scripts/ghost.py\n"
        )
        root = self._make_root({"atlas-x": skill})
        dangling = _dangling_skill_references(root)
        self.assertIn(
            ("skills/atlas-x/SKILL.md", "references/ghost.md"), dangling
        )
        self.assertIn(("skills/atlas-x/SKILL.md", "scripts/ghost.py"), dangling)

    def test_wrong_prefix_references_detects_unresolved(self):
        skill = (
            "---\nname: x\n---\n\nSee "
            "${CLAUDE_SKILL_DIR}/references/ghost.md\n"
        )
        root = self._make_root({"atlas-x": skill})
        self.assertEqual(
            _wrong_prefix_references(root),
            [("skills/atlas-x/SKILL.md",
              "${CLAUDE_SKILL_DIR}/references/ghost.md")],
        )

    def test_bare_plugin_scripts_references_detects_ambiguity(self):
        root = self._make_root(
            {"atlas-x": "---\nname: x\n---\n\nRun scripts/build_hub.py\n"}
        )
        (root / "scripts" / "build_hub.py").write_text(
            "#!/usr/bin/env python3\n", encoding="utf-8"
        )
        self.assertEqual(
            _bare_plugin_scripts_references(root),
            [("skills/atlas-x/SKILL.md", "scripts/build_hub.py")],
        )

    def test_frontmatter_detects_missing_opening(self):
        root = self._make_root({"atlas-x": "name: x\n---\nbody\n"})
        self.assertEqual(
            _malformed_frontmatter(root),
            [("skills/atlas-x/SKILL.md",
              "missing opening standalone '---' line")],
        )

    def test_frontmatter_detects_missing_closing(self):
        root = self._make_root({"atlas-x": "---\nname: x\nbody\n"})
        self.assertEqual(
            _malformed_frontmatter(root),
            [("skills/atlas-x/SKILL.md",
              "no standalone closing '---' delimiter")],
        )

    def test_frontmatter_detects_trailing_dashes(self):
        root = self._make_root(
            {"atlas-x": "---\nname: x------\n---\nbody\n"}
        )
        bad = _malformed_frontmatter(root)
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0][0], "skills/atlas-x/SKILL.md")
        self.assertIn("trailing 6+ dashes glued to value", bad[0][1])

    def test_frontmatter_detects_no_body(self):
        root = self._make_root({"atlas-x": "---\nname: x\n---\n"})
        self.assertEqual(
            _malformed_frontmatter(root),
            [("skills/atlas-x/SKILL.md",
              "no body after closing '---' delimiter")],
        )


# Anthropic tools-reference names that skills/agents should not treat as current.
_STALE_PRIMARY_TOOLS = ("MultiEdit",)
_KNOWN_CLAUDE_TOOLS = {
    "Agent",
    "AskUserQuestion",
    "Bash",
    "Edit",
    "Glob",
    "Grep",
    "NotebookEdit",
    "Read",
    "Skill",
    "Task",  # legacy alias still matched by hooks
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskUpdate",
    "TodoWrite",
    "Write",
    "WebFetch",
    "WebSearch",
}


def _parse_allowed_tools(raw: str):
    """Split an allowed-tools frontmatter value into bare tool names."""
    if not raw:
        return []
    names = []
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        # Bash(python3:*) / Write(docs/**) -> Bash / Write
        name = re.split(r"[(\s]", part, maxsplit=1)[0].strip()
        if name:
            names.append(name)
    return names


def _frontmatter_fields(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    if not m:
        return {}
    fields = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        fields[k.strip()] = v.strip().strip("\"'" )
    return fields


class TestToolNameHygiene(unittest.TestCase):
    """Keep agent/skill tool names aligned with current Claude Code tools.

    MultiEdit is no longer a primary tool in Anthropic's tools reference.
    Skills that need mutation should allow Edit and/or Write instead.
    """

    def test_no_skill_allows_multiedit_as_primary(self):
        bad = []
        for skill_md in sorted((PLUGIN_ROOT / "skills").glob("*/SKILL.md")):
            fm = _frontmatter_fields(skill_md.read_text(encoding="utf-8"))
            allowed = _parse_allowed_tools(fm.get("allowed-tools", ""))
            if "MultiEdit" in allowed:
                bad.append(str(skill_md.relative_to(PLUGIN_ROOT)))
        self.assertEqual(
            [],
            bad,
            "skills still listing MultiEdit in allowed-tools (use Edit/Write): "
            + ", ".join(bad),
        )

    def test_skill_allowed_tools_are_known_or_namespaced(self):
        bad = []
        for skill_md in sorted((PLUGIN_ROOT / "skills").glob("*/SKILL.md")):
            fm = _frontmatter_fields(skill_md.read_text(encoding="utf-8"))
            for name in _parse_allowed_tools(fm.get("allowed-tools", "")):
                if name in _KNOWN_CLAUDE_TOOLS:
                    continue
                if name.startswith("mcp__"):
                    continue
                bad.append(f"{skill_md.parent.name}:{name}")
        self.assertEqual(
            [],
            bad,
            "skills reference unknown tool names: " + ", ".join(bad),
        )

    def test_read_only_agents_deny_write_edit(self):
        writable = {"docs-curator.md", "implementer.md"}
        missing = []
        for path in sorted((PLUGIN_ROOT / "agents").glob("*.md")):
            if path.name in writable:
                continue
            fm = _frontmatter_fields(path.read_text(encoding="utf-8"))
            declared = fm.get("disallowedTools", "")
            for tool in ("Write", "Edit"):
                if tool not in declared:
                    missing.append(f"{path.name}->{tool}")
        self.assertEqual(
            [],
            missing,
            "read-only agents missing Write/Edit denies: " + ", ".join(missing),
        )

    def test_claude_plugin_manifest_exists(self):
        import json

        path = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
        self.assertTrue(path.is_file(), "claude plugin manifest missing")
        claude = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(claude.get("name"), "atlas")
        self.assertTrue(claude.get("version"), "atlas plugin version required")
        # Kimi dual-manifest support was removed; ensure it stays gone.
        self.assertFalse(
            (PLUGIN_ROOT / ".kimi-plugin").exists(),
            "kimi plugin manifest must not ship with atlas",
        )


if __name__ == "__main__":
    unittest.main()
