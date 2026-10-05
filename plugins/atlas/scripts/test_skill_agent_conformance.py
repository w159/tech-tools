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
            if re.search(r"-{6,}$", lines[i]) and lines[i].rstrip().endswith("-" * 6):
                bad.append((rel, f"trailing 6+ dashes glued to value: {lines[i]!r}"))
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
        skill = "---\nname: x\n---\n\nSee ${CLAUDE_PLUGIN_ROOT}/references/ghost.md\n"
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
        self.assertIn(("skills/atlas-x/SKILL.md", "references/ghost.md"), dangling)
        self.assertIn(("skills/atlas-x/SKILL.md", "scripts/ghost.py"), dangling)

    def test_wrong_prefix_references_detects_unresolved(self):
        skill = "---\nname: x\n---\n\nSee ${CLAUDE_SKILL_DIR}/references/ghost.md\n"
        root = self._make_root({"atlas-x": skill})
        self.assertEqual(
            _wrong_prefix_references(root),
            [("skills/atlas-x/SKILL.md", "${CLAUDE_SKILL_DIR}/references/ghost.md")],
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
            [("skills/atlas-x/SKILL.md", "missing opening standalone '---' line")],
        )

    def test_frontmatter_detects_missing_closing(self):
        root = self._make_root({"atlas-x": "---\nname: x\nbody\n"})
        self.assertEqual(
            _malformed_frontmatter(root),
            [("skills/atlas-x/SKILL.md", "no standalone closing '---' delimiter")],
        )

    def test_frontmatter_detects_trailing_dashes(self):
        root = self._make_root({"atlas-x": "---\nname: x------\n---\nbody\n"})
        bad = _malformed_frontmatter(root)
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0][0], "skills/atlas-x/SKILL.md")
        self.assertIn("trailing 6+ dashes glued to value", bad[0][1])

    def test_frontmatter_detects_no_body(self):
        root = self._make_root({"atlas-x": "---\nname: x\n---\n"})
        self.assertEqual(
            _malformed_frontmatter(root),
            [("skills/atlas-x/SKILL.md", "no body after closing '---' delimiter")],
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
        fields[k.strip()] = v.strip().strip("\"'")
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


# --- Anthropic skill-authoring best-practices checklist -----------------------
# Source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
# These pin the measurable rules so a regression fails CI instead of silently
# bloating the preloaded skill metadata or hiding a reference file from Claude.

_DESC_MAX = 1024  # Anthropic hard limit for a skill description
_DESC_TARGET = 400  # atlas target: metadata of all skills is preloaded every session
_META_MAX = 1536  # description + when_to_use cap Claude Code applies to the listing
_BODY_MAX_LINES = 500  # Anthropic: keep SKILL.md body under 500 lines
_REF_TOC_MIN_LINES = 100  # Anthropic: reference files longer than this need a TOC
_RESERVED_WORDS = ("anthropic", "claude")
_WHEN_RE = re.compile(r"\b(use (when|for|to|after|before|if)|when |whenever)", re.I)
_PERSON_RE = re.compile(r"\b(I |I'|I’|you |your )", re.I)
_XML_RE = re.compile(r"</?[A-Za-z][^>]*>")
_TOC_RE = re.compile(r"^#{1,3}\s*(contents|table of contents|toc)\b", re.I | re.M)
# Non-content files that live in a skill dir but are not skill resources.
_IGNORED_PARTS = ("__pycache__",)
_IGNORED_SUFFIXES = (".pyc",)


def _skill_meta(skill_md: pathlib.Path) -> dict:
    """Parse SKILL.md / agent frontmatter with the stdlib only (hooks and scripts
    are stdlib-only, so PyYAML is not a dependency).

    Supports exactly the shapes atlas ships: ``#`` comment lines, and one
    ``key: value`` per line where the value is a double-quoted JSON-compatible
    string, a single-quoted string (``''`` escapes ``'``), an inline flow list
    (kept as its raw text), or a bare scalar. Anything else (block scalars
    ``>``/``|``, folded continuation lines) raises, so a future frontmatter
    shape fails the suite loudly instead of being half-parsed and passing a
    rule by accident.
    """
    import json

    text = skill_md.read_text(encoding="utf-8")
    block = text.split("---", 2)[1]
    meta: dict = {}
    for raw in block.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[0] in " \t":
            raise AssertionError(
                f"{skill_md}: continuation line not supported: {raw!r}"
            )
        key, sep, value = raw.partition(":")
        if not sep or not key.strip():
            raise AssertionError(f"{skill_md}: not a 'key: value' line: {raw!r}")
        key, value = key.strip(), value.strip()
        if value in (">", ">-", "|", "|-"):
            raise AssertionError(f"{skill_md}: block scalar not supported for {key!r}")
        if value.startswith('"'):
            try:
                meta[key] = json.loads(value)
            except ValueError as exc:
                raise AssertionError(
                    f"{skill_md}: {key!r} is not a valid quoted string: {exc}"
                ) from exc
        elif value.startswith("'"):
            if len(value) < 2 or not value.endswith("'"):
                raise AssertionError(
                    f"{skill_md}: {key!r} has an unterminated single-quoted string"
                )
            meta[key] = value[1:-1].replace("''", "'")
        else:
            meta[key] = value
    return meta


def _skill_resource_files(skill_dir: pathlib.Path):
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file() or path.name == "SKILL.md":
            continue
        if any(part in path.parts for part in _IGNORED_PARTS):
            continue
        if path.suffix in _IGNORED_SUFFIXES:
            continue
        yield path


class TestAnthropicSkillChecklist(unittest.TestCase):
    """Core-quality items from Anthropic's 'Checklist for effective Skills'."""

    @classmethod
    def setUpClass(cls):
        cls.skills = sorted((PLUGIN_ROOT / "skills").glob("*/SKILL.md"))
        cls.meta = {p.parent.name: _skill_meta(p) for p in cls.skills}

    def test_there_are_skills_to_check(self):
        self.assertGreater(len(self.skills), 0)

    def test_name_matches_directory_and_is_valid(self):
        bad = []
        for name, meta in self.meta.items():
            n = str(meta.get("name", ""))
            if n != name:
                bad.append(f"{name}: name={n!r} != directory")
            if len(n) > 64 or not re.fullmatch(r"[a-z0-9-]+", n):
                bad.append(f"{name}: name must be <=64 chars of [a-z0-9-]")
            if any(w in n for w in _RESERVED_WORDS):
                bad.append(f"{name}: name contains a reserved word")
        self.assertEqual([], bad, "; ".join(bad))

    def test_description_present_and_within_limit(self):
        bad = []
        for name, meta in self.meta.items():
            d = str(meta.get("description", "")).strip()
            if not d:
                bad.append(f"{name}: empty description")
            elif len(d) > _DESC_MAX:
                bad.append(f"{name}: {len(d)} chars > {_DESC_MAX}")
        self.assertEqual([], bad, "; ".join(bad))

    def test_description_stays_concise(self):
        # Every skill's metadata is preloaded into the system prompt each session.
        bad = [
            f"{n}: {len(str(m.get('description', '')))} chars"
            for n, m in self.meta.items()
            if len(str(m.get("description", ""))) > _DESC_TARGET
        ]
        self.assertEqual(
            [],
            bad,
            f"descriptions over the {_DESC_TARGET}-char atlas target "
            "(move mechanism detail into the SKILL.md body): " + "; ".join(bad),
        )

    def test_description_says_what_and_when(self):
        bad = [
            n
            for n, m in self.meta.items()
            if not _WHEN_RE.search(str(m.get("description", "")))
        ]
        self.assertEqual(
            [],
            bad,
            "descriptions with no 'Use when ...' trigger clause: " + ", ".join(bad),
        )

    def test_description_is_third_person(self):
        bad = []
        for n, m in self.meta.items():
            hit = _PERSON_RE.search(str(m.get("description", "")))
            if hit:
                bad.append(f"{n}: {hit.group(0).strip()!r}")
        self.assertEqual([], bad, "first/second-person descriptions: " + "; ".join(bad))

    def test_description_and_when_to_use_have_no_xml_tags(self):
        bad = [
            n
            for n, m in self.meta.items()
            if _XML_RE.search(f"{m.get('description', '')} {m.get('when_to_use', '')}")
        ]
        self.assertEqual([], bad, "XML-like tags in skill metadata: " + ", ".join(bad))

    def test_listing_text_fits_claude_code_cap(self):
        bad = [
            f"{n}: {len(str(m.get('description', ''))) + len(str(m.get('when_to_use', '') or ''))}"
            for n, m in self.meta.items()
            if len(str(m.get("description", "")))
            + len(str(m.get("when_to_use", "") or ""))
            > _META_MAX
        ]
        self.assertEqual(
            [], bad, f"description + when_to_use over {_META_MAX}: " + "; ".join(bad)
        )

    def test_skill_body_under_500_lines(self):
        bad = []
        for p in self.skills:
            lines = p.read_text(encoding="utf-8").count("\n") + 1
            if lines > _BODY_MAX_LINES:
                bad.append(f"{p.parent.name}: {lines} lines")
        self.assertEqual([], bad, "; ".join(bad))

    def test_no_windows_style_paths(self):
        win = re.compile(
            r"(?<![\w/\\])(?:[\w.-]+\\)+[\w.-]+\.(?:py|md|json|sh|ts|sql)\b"
        )
        bad = []
        for p in self.skills:
            hit = win.search(p.read_text(encoding="utf-8"))
            if hit:
                bad.append(f"{p.parent.name}: {hit.group(0)}")
        self.assertEqual(
            [], bad, "backslash paths (use forward slashes): " + "; ".join(bad)
        )

    def test_long_reference_files_have_a_table_of_contents(self):
        bad = []
        for p in self.skills:
            for ref in _skill_resource_files(p.parent):
                if ref.suffix != ".md":
                    continue
                text = ref.read_text(encoding="utf-8")
                if text.count("\n") + 1 > _REF_TOC_MIN_LINES and not _TOC_RE.search(
                    text
                ):
                    bad.append(str(ref.relative_to(PLUGIN_ROOT)))
        self.assertEqual(
            [],
            bad,
            f"reference files over {_REF_TOC_MIN_LINES} lines need a '## Contents' list: "
            + ", ".join(bad),
        )

    def test_every_skill_resource_is_reachable_from_its_skill_md(self):
        # A file Claude cannot discover from SKILL.md is dead weight. Every
        # resource must be named individually: a bare "references/" mention
        # would otherwise exempt every file under it, which is exactly how an
        # orphaned reference slips through.
        bad = []
        for p in self.skills:
            body = p.read_text(encoding="utf-8")
            skill_dir = p.parent
            for ref in _skill_resource_files(skill_dir):
                rel = ref.relative_to(skill_dir).as_posix()
                if ref.name in body or rel in body:
                    continue
                bad.append(f"{skill_dir.name}/{rel}")
        self.assertEqual(
            [], bad, "resources never named in their SKILL.md: " + ", ".join(bad)
        )

    def test_references_are_one_level_deep(self):
        # Claude previews nested references with head -N and loses the tail.
        link = re.compile(r"\]\((?!https?:|#|mailto:)([^)\s#]+\.md)")
        bad = []
        for p in self.skills:
            for ref in _skill_resource_files(p.parent):
                if ref.suffix != ".md":
                    continue
                for target in link.findall(ref.read_text(encoding="utf-8")):
                    bad.append(f"{ref.relative_to(PLUGIN_ROOT)} -> {target}")
        self.assertEqual([], bad, "reference files linking onward: " + "; ".join(bad))


class TestAnthropicAgentChecklist(unittest.TestCase):
    """Agents are auto-delegated by description, so the same discovery rules apply."""

    def test_agent_descriptions_say_when_and_are_third_person(self):
        bad = []
        for path in sorted((PLUGIN_ROOT / "agents").glob("*.md")):
            d = str(_skill_meta(path).get("description", ""))
            if not re.search(r"\buse when\b", d, re.I):
                bad.append(f"{path.name}: no 'Use when ...' clause")
            if _PERSON_RE.search(d):
                bad.append(f"{path.name}: first/second person")
            if len(d) > _DESC_MAX:
                bad.append(f"{path.name}: {len(d)} chars")
        self.assertEqual([], bad, "; ".join(bad))


class TestChecklistDetectors(unittest.TestCase):
    """The checklist regexes must reject the bad examples Anthropic names."""

    def test_when_detector_accepts_good_and_rejects_vague(self):
        self.assertTrue(
            _WHEN_RE.search("Extract PDF text. Use when working with PDF files.")
        )
        self.assertFalse(_WHEN_RE.search("Helps with documents"))

    def test_person_detector_flags_first_and_second_person(self):
        for bad in (
            "I can help you process Excel files",
            "You can use this to process Excel files",
            "Use when you need a map",
        ):
            self.assertTrue(_PERSON_RE.search(bad), bad)
        self.assertFalse(
            _PERSON_RE.search("Processes Excel files and generates reports")
        )

    def test_xml_detector_ignores_plain_angle_comparisons(self):
        self.assertTrue(_XML_RE.search("do <thing>x</thing>"))
        self.assertFalse(_XML_RE.search("keep size < 10 and > 2"))

    def test_toc_detector(self):
        self.assertTrue(_TOC_RE.search("# T\n\n## Contents\n- a\n"))
        self.assertFalse(_TOC_RE.search("# T\n\n## Overview\n"))


if __name__ == "__main__":
    unittest.main()
