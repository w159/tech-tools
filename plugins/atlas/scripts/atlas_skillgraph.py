#!/usr/bin/env python3
"""Skill graph check: compile a skill's prose into a step graph and query it.

"Which steps change something outside this machine with no human approval
before them?" becomes a deterministic query instead of a code-review hope.
Stdlib only; the graph is plain JSON (nodes + edges), so any graph store can
load it later, but nothing here needs one.

Graph shape (compile):
  nodes  Skill      {id, type, name}
         Step       {id, type, file, line, quote, kind, effect, pattern,
                     has_approval, gated_inline, structural}
         Reference  {id, type, file}
  edges  HAS_STEP   Skill -> Step
         THEN       Step -> Step, in document order (SKILL.md first; a linked
                    references/*.md is spliced in right after the line that
                    links it, once)
         USES       Step -> Reference (the step's line links that file)

What becomes a Step: a numbered step (`1.`, `1)`), a `Step N` / numbered
heading, an ordered list item, and any other line that matches a REMOTE or
APPROVAL pattern or links a reference. `quote` is the stripped source line and
is verified to exist at `file:line` (validate_quotes); a planted step whose
quote is not in the file is rejected.

Classification (explicit regexes below, evaluated per sentence):
  remote   REMOTE_RES: git push (incl. --delete), gh pr create/merge/edit/
           comment/review (+close/reopen/ready), gh release, gh api with
           -X/--method POST|PATCH|PUT|DELETE, gh issue create/comment/close
           (+edit/reopen/delete/lock/transfer), npm/pnpm/yarn publish, twine
           upload, docker push, MCP create_pull_request / push_files /
           create_or_update_file / merge_pull_request, and the xd://github
           device ops (`op: pr_create`, `device ... pr_push`, ...; a bare `pr_comment`
           is a feedback type, not an op).
  approval APPROVAL_RES: AskUserQuestion, "ask the user", "ask first", "stop
           and ask", the user's (explicit) yes/approval/consent, explicit
           approval/confirmation/yes, "confirm with the user", "stop for their
           confirmation", "only on explicit user request", "wait for (the
           user's) answer", `atlas_git.py allow`, "only if the user
           (explicitly) asked", and a reference to git-policy.md. A bare
           prohibition ("Never push ...") is not an approval; "never ...
           without the user's yes" is.
  action classes  An approval gates only remote steps of a class it names:
           push (git push, push_files, create_or_update_file, pr_push), pr
           (gh pr *, create/merge_pull_request, pr_* ops), release (gh release,
           npm/pnpm/yarn publish, twine, docker push), issue (gh issue *), api
           (gh api -X/--method POST|PATCH|PUT|DELETE). A sentence naming
           several classes gates those classes; git-policy.md gates push and pr;
           atlas_git.py allow gates push; "any remote write" / "externally
           visible" gates all; the per-source `approved: true|false` flag gates
           only the step (list item) it sits on and is never carried forward.
  local_write  LOCAL_WRITE_RE: git commit/add/merge/checkout/branch, Write/
           Edit, "write(s) ...". read  READ_RE. Otherwise judgment.
  Not a remote step: a remote match inside a negated sentence (NEGATION_RE:
  never / do not / don't / must not / forbidden / out of scope / ...) or a
  hand-off sentence the user runs themselves (USER_RUNS_RE), or a sentence
  describing what a hook/guard does on that command (HOOK_DESC_RE). "never
  ask the user" (NO_ASK_RE) is not an approval step.
  Gated inline: the same sentence (or an earlier sentence of the same line)
  also matches an approval pattern.

Query (query_ungated_remote): remote steps that are not gated inline and whose
action class is not named by an approval step earlier on the THEN path of the
same skill. Known limit: a skill that states a class-naming consent rule early
gates every later step of that class; the check proves a consent rule precedes
the action, not that this particular step honours it.

CLI:
  atlas_skillgraph.py compile <skill> [--json]      <skill> = name or dir
  atlas_skillgraph.py check [--skills-dir DIR] [--allow FILE] [--json]
  atlas_skillgraph.py dot <skill>                    Graphviz text
check exits 1 if any ungated remote step is outside the allowlist
(contracts/skillgraph-allow.json: "skill:file:line-quote-prefix" -> reason).
"""

import argparse
import json
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SKILLS = PLUGIN_ROOT / "skills"
DEFAULT_ALLOW = PLUGIN_ROOT / "contracts" / "skillgraph-allow.json"
QUOTE_KEY_LEN = 40

_I = re.I

# --- classification regexes (documented in the module docstring) -------------

REMOTE_RES = [
    ("git push", re.compile(r"\bgit\s+push\b", _I)),
    (
        "gh pr",
        re.compile(
            r"\bgh\s+pr\s+(?:create|merge|edit|comment|review|close|reopen|ready)\b",
            _I,
        ),
    ),
    ("gh release", re.compile(r"\bgh\s+release\b", _I)),
    (
        "gh api write",
        re.compile(
            r"\bgh\s+api\b[^\n]*?(?:-X\s*|--method[ =]+)(?:POST|PATCH|PUT|DELETE)\b",
            _I,
        ),
    ),
    (
        "gh issue",
        re.compile(
            r"\bgh\s+issue\s+(?:create|comment|close|edit|reopen|delete|lock|transfer)\b",
            _I,
        ),
    ),
    (
        "publish",
        re.compile(r"\b(?:npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b", _I),
    ),
    ("docker push", re.compile(r"\bdocker\s+push\b", _I)),
    (
        "mcp github write",
        re.compile(
            r"\b(?:create_pull_request|push_files|create_or_update_file|merge_pull_request)\b"
        ),
    ),
    (
        "github device op",
        re.compile(
            r"\bop\b[`:\s\"'=]{1,4}pr_(?:create|push|merge|edit|comment)\b"
            r"|\bdevice\b[^.\n]{0,25}\bpr_(?:create|push|merge|edit)\b"
            r"|\bpr_(?:create|push|merge|edit)\b`?\s+op\b"
        ),
    ),
]

APPROVAL_RES = [
    ("AskUserQuestion", re.compile(r"\bAskUserQuestion\b")),
    ("ask the user", re.compile(r"\bask(?:ing)?\s+(?:the\s+)?user\b", _I)),
    ("ask first", re.compile(r"\bask\s+first\b|\bstop\s+and\s+ask\b", _I)),
    (
        "user's yes",
        re.compile(
            r"\buser(?:'s|’s)?\s+(?:explicit\s+)?(?:yes|approval|consent|confirmation)\b"
            r"|\bexplicit\s+(?:user\s+)?(?:approval|confirmation|consent|yes)\b"
            r"|\bexplicit\s+user\s+(?:yes|confirmation)\b",
            _I,
        ),
    ),
    (
        "stop for confirmation",
        re.compile(
            r"\bstop\s+(?:here\s+)?for\s+(?:their|the\s+user(?:'s|\u2019s)?)\s+(?:confirmation|answer|yes|approval)\b"
            r"|\bonly\s+on\s+explicit\s+user\s+request\b",
            _I,
        ),
    ),
    (
        "confirm with the user",
        re.compile(r"\bconfirm(?:ation)?\s+with\s+the\s+user\b", _I),
    ),
    (
        "wait for answer",
        re.compile(
            r"\bwait(?:s|ing)?\s+for\s+(?:the\s+)?(?:user(?:'s|’s)?\s+)?(?:answer|reply|response|yes)\b",
            _I,
        ),
    ),
    ("atlas_git allow", re.compile(r"\batlas_git\.py[\"']?\s+allow\b")),
    (
        "only if the user asked",
        re.compile(
            r"\bonly\s+(?:if|when|after)\s+the\s+user\s+(?:explicitly\s+)?(?:asked|says|said)\b",
            _I,
        ),
    ),
    ("git-policy.md", re.compile(r"\bgit-policy\.md\b")),
]

NEGATION_RE = re.compile(
    r"\b(?:never|do\s+not|don't|doesn't|does\s+not|must\s+not|mustn't|won't|will\s+not|"
    r"cannot|can't|not\s+allowed|forbidden|out\s+of\s+scope|refuses?|refused)\b"
    r"|\bno\s+(?:`?git\s+push|PRs?\b|pushes\b|merges?\b)",
    _I,
)
# Action classes. An approval gates only remote steps of a class it names.
# The class of a remote step comes from remote_classes(); the classes an
# approval line names come from CLASS_RES (any sentence of that line), plus:
#   git-policy.md reference     -> push, pr (what git-policy covers)
#   atlas_git.py allow          -> push
#   ALL_RE ("any remote write", "externally visible", "nothing leaves this
#   machine")                   -> every class
#   `approved: true|false` flag -> only the step it sits on (same list item),
#                                  never carried to later steps
CLASSES = ("push", "pr", "release", "issue", "api")
CLASS_RES = {
    "push": re.compile(r"\bpush\w*|\bpush_files\b|\bcreate_or_update_file\b", _I),
    "pr": re.compile(r"\bpull\s+requests?\b|\bPRs?\b|\bmerg\w+|\bpr_\w+", _I),
    "release": re.compile(r"\breleas\w+|\bpublish\w*|\bdocker\b|\bnpm\b|\btwine\b", _I),
    "issue": re.compile(r"\bissues?\b", _I),
    "api": re.compile(r"\bgh\s+api\b|\bapi\s+writes?\b|\bgraphql\b", _I),
}
ALL_RE = re.compile(
    r"\b(?:any|every|all)\s+(?:remote|external)\b|\bremote\s+writes?\b"
    r"|\bexternally\s+visible\b|\bleaves?\s+this\s+machine\b"
    r"|\bnothing\s+leaves\b",
    _I,
)
SPECIAL_CLASSES = {
    "git-policy.md": {"push", "pr"},
    "atlas_git allow": {"push"},
}
POLICY_TOPIC_RE = re.compile(r"\bconsent\b|\bpermission\b", _I)
APPROVED_FLAG_RE = re.compile(r"`approved:\s*(?:true|false)`")


def remote_classes(name, text):
    """Action classes of a remote match (name from REMOTE_RES)."""
    if name == "git push":
        return {"push"}
    if name == "gh pr":
        return {"pr"}
    if name in ("gh release", "publish", "docker push"):
        return {"release"}
    if name == "gh issue":
        return {"issue"}
    if name == "gh api write":
        return {"api"}
    if name == "mcp github write":
        return {"push"} if re.search(r"push_files|create_or_update_file", text) else {"pr"}
    if name == "github device op":
        return {"push", "pr"} if "pr_push" in text else {"pr"}
    return set(CLASSES)


def approval_classes(text, names):
    """Classes a line with approval sentences names (see CLASS_RES above)."""
    out = set()
    if ALL_RE.search(text):
        return set(CLASSES)
    for c, rx in CLASS_RES.items():
        if rx.search(text):
            out.add(c)
    for n in names:
        # git-policy.md is a pointer, not a consent sentence: it counts only on
        # a line that is about commit/push/PR/consent (not worktree layout).
        if n == "git-policy.md" and not (out & {"push", "pr"} or POLICY_TOPIC_RE.search(text)):
            continue
        out |= SPECIAL_CLASSES.get(n, set())
    return out


# "never ask the user" is the opposite of an approval step.
NO_ASK_RE = re.compile(r"\b(?:never|do\s+not|don't|no\s+need\s+to|without)\s+ask(?:ing)?\b", _I)
# A sentence that describes what a hook/guard does on a command is not the
# skill running that command.
HOOK_DESC_RE = re.compile(
    r"\bPreToolUse\b|\bPostToolUse\b|\bhooks?/|\bhook\b|\bguard(?:s|ed)?\b", _I
)
CONDITION_RE = re.compile(
    r"\b(?:without|unless|until|except|only\s+(?:after|if|when|on|with)|before|requires?|needs?|"
    r"stop\s+and\s+ask|ask\s+first|yes)\b",
    _I,
)
# A sentence that hands the command to the human to run is not an agent step.
USER_RUNS_RE = re.compile(
    r"\bcommands?\s+to\s+run\s+themselves\b|\bthe\s+user\s+runs?\b|\buser-runnable\b"
    r"|\bfor\s+the\s+user\s+to\s+run\b|\bthe\s+user\s+(?:can|may)\s+run\b"
    r"|\bprints?\s+the\s+exact\b|\brun\s+themselves\b",
    _I,
)
LOCAL_WRITE_RE = re.compile(
    r"\bgit\s+(?:commit|add|merge|checkout|branch|rebase|stash|tag)\b|\b(?:Write|Edit)\b"
    r"|\bwrites?\b|\bcreate[sd]?\b|\bappend|\bmkdir\b|\brm\b|\bsave[sd]?\b|\bmov(?:e|es)\b",
    _I,
)
READ_RE = re.compile(
    r"\b(?:read|reads|list|check|grep|view|search|inspect|fetch|resolve|run|collect|"
    r"compare|detect|parse|load|show|report|print|scan)\b",
    _I,
)

STEP_LINE_RE = re.compile(r"^\s*(?:\d+[.)]|[a-z][.)])\s+\S")
STEP_HEAD_RE = re.compile(r"^#{1,6}\s+(?:Step\s+)?\d+\b", _I)
STEP_WORD_HEAD_RE = re.compile(r"^#{1,6}\s+Step\b", _I)
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
REF_RES = [
    re.compile(r"\]\((?:\./)?(references/[^)#\s]+)"),
    re.compile(r"\$\{CLAUDE_SKILL_DIR\}/(references/[A-Za-z0-9_./-]+)"),
    re.compile(r"(?<![\w/.${}-])(references/[A-Za-z0-9_.-]+\.md)"),
]
SENT_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+(?=[A-Z`*(\"'])")


class GraphError(ValueError):
    """The graph does not match the source (bad quote, missing file)."""


# --- classification ---------------------------------------------------------


def split_sentences(text):
    text = re.sub(r"^\s*(?:[-*+]|\d+[.)]|[a-z][.)])\s+", "", text)
    text = re.sub(r"^\s*\|", "", text)
    return [s for s in SENT_SPLIT_RE.split(text) if s and s.strip()]


def _first(res, text):
    for name, rx in res:
        m = rx.search(text)
        if m:
            return name, m
    return None, None


def _sentence_approvals(sent):
    names = [n for n, rx in APPROVAL_RES if rx.search(sent)]
    if NO_ASK_RE.search(sent):
        names = [n for n in names if n not in ("ask the user", "ask first")]
    # A bare prohibition ("Never push ... see git-policy.md") forbids the action
    # outright; it is not a consent path, so a later remote step is not gated
    # by it. "Never push without the user's yes" is conditional and counts.
    if names and NEGATION_RE.search(sent) and not CONDITION_RE.search(sent):
        return []
    return names


def _approval_names_in(text):
    out = []
    if NEGATION_RE.search(text) and not CONDITION_RE.search(text):
        return out  # whole line is a bare prohibition
    for sent in split_sentences(text):
        out.extend(_sentence_approvals(sent))
    return out


def classify_line(text, context="", item_flag=False):
    """Classify one source line (joined with its continuations).

    context: earlier lines of the same list item/paragraph (their approvals
    can gate this line's remote action). item_flag: the item carries an
    `approved: true|false` flag, which gates the step it sits on.
    Returns dict(kind, effect, pattern, classes, has_approval, gates_classes,
    gated_inline, approval_pattern). Remote wins over approval as the step
    kind; a line that only holds an approval is kind=approval.
    """
    remote_pat = None
    remote_cls = set()
    approval_pat = None
    gated_inline = False
    inline_real = False
    ctx_classes = set()
    if context:
        cnames = _approval_names_in(context)
        if cnames:
            ctx_classes = approval_classes(context, cnames)
    own_names = []
    bare_line = bool(NEGATION_RE.search(text) and not CONDITION_RE.search(text))
    sents = split_sentences(text)
    line_names = _approval_names_in(text)
    line_classes = approval_classes(text, line_names) if line_names else set()
    seen_names = False
    for sent in sents:
        names = [] if bare_line else _sentence_approvals(sent)
        negated = bool(
            NEGATION_RE.search(sent)
            or USER_RUNS_RE.search(sent)
            or HOOK_DESC_RE.search(sent)
        )
        r_name, m = _first(REMOTE_RES, sent)
        if r_name and not negated and remote_pat is None:
            remote_pat = r_name
            remote_cls = remote_classes(r_name, m.group(0))
            # same-sentence approval, an earlier approval sentence on the line
            # that names the class, a context-line approval naming the class,
            # or the item's approved flag
            inline_real = (
                bool(names)
                or (seen_names and bool(remote_cls & line_classes))
                or bool(remote_cls & ctx_classes)
            )
            gated_inline = inline_real or item_flag
        if names:
            seen_names = True
            own_names.extend(names)
            approval_pat = approval_pat or names[0]
    gates = set(line_classes)
    if remote_pat and inline_real:  # an `approved` flag is step-local, not carried
        gates |= remote_cls
    base = {
        "has_approval": bool(own_names),
        "gates_classes": sorted(gates) if own_names or inline_real else [],
        "gated_inline": gated_inline,
        "approval_pattern": approval_pat,
    }
    base["gates_remote"] = bool(base["gates_classes"])
    if remote_pat:
        return dict(
            base, kind="remote", effect="remote", pattern=remote_pat,
            classes=sorted(remote_cls),
        )
    if own_names:
        return dict(
            base, kind="approval", effect="none", pattern=approval_pat, classes=[]
        )
    m = LOCAL_WRITE_RE.search(text)
    if m:
        kind, pat = "local_write", m.group(0)
    else:
        m = READ_RE.search(text)
        kind, pat = ("read", m.group(0)) if m else ("judgment", None)
    return {
        "kind": kind,
        "effect": "local" if kind == "local_write" else "none",
        "pattern": pat,
        "classes": [],
        "has_approval": False,
        "gates_classes": [],
        "gates_remote": False,
        "gated_inline": False,
        "approval_pattern": None,
    }


# --- compile ----------------------------------------------------------------


def _body_start(lines):
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return i + 1
    return 0


def _joined(lines, i):
    """Line i plus its backslash continuations (for gh api ... \\ -X POST)."""
    out = lines[i]
    j = i
    while out.rstrip().endswith("\\") and j + 1 < len(lines):
        j += 1
        out = out.rstrip()[:-1] + " " + lines[j].strip()
    return out


def _is_struct(line):
    return bool(
        STEP_LINE_RE.match(line) or STEP_HEAD_RE.match(line) or STEP_WORD_HEAD_RE.match(line)
    )


def _item_context(lines, i, structural, limit=12):
    """(text of earlier lines in the same list item, item has approved flag)."""
    start = i
    while (
        start > 0
        and i - start < limit
        and lines[start - 1].strip()
        and not FENCE_RE.match(lines[start - 1])
        and not (start == i and structural)
        and not (start < i and _is_struct(lines[start]))
    ):
        start -= 1
    end = i
    while (
        end + 1 < len(lines)
        and end - i < limit
        and lines[end + 1].strip()
        and not FENCE_RE.match(lines[end + 1])
        and not _is_struct(lines[end + 1])
    ):
        end += 1
    ctx = " ".join(x.strip() for x in lines[start:i])
    flag = bool(APPROVED_FLAG_RE.search(" ".join(lines[start : end + 1])))
    return ctx, flag


def _ref_targets(line, skill_dir):
    found = []
    for rx in REF_RES:
        for m in rx.finditer(line):
            rel = m.group(1)
            if (skill_dir / rel).is_file() and rel not in found:
                found.append(rel)
    return found


def _scan_file(skill_dir, rel, skill, nodes, edges, order, seen_refs, depth=0):
    lines = (skill_dir / rel).read_text(encoding="utf-8").splitlines()
    in_fence = False
    for i in range(_body_start(lines) if rel == "SKILL.md" else 0, len(lines)):
        raw = lines[i]
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            continue
        if not raw.strip():
            continue
        structural = (not in_fence) and bool(
            STEP_LINE_RE.match(raw)
            or STEP_HEAD_RE.match(raw)
            or STEP_WORD_HEAD_RE.match(raw)
        )
        ctx, flag = _item_context(lines, i, structural)
        info = classify_line(_joined(lines, i), ctx, flag)
        refs = [] if in_fence else _ref_targets(raw, skill_dir)
        new_refs = [r for r in refs if r not in seen_refs] if depth < 4 else []
        if not (structural or info["kind"] in ("remote", "approval") or refs):
            continue
        sid = "%s:%s:%d" % (skill, rel, i + 1)
        node = {
            "id": sid,
            "type": "Step",
            "file": rel,
            "line": i + 1,
            "quote": raw.strip(),
            "structural": structural,
        }
        node.update(info)
        nodes.append(node)
        edges.append({"type": "HAS_STEP", "from": "skill:" + skill, "to": sid})
        order.append(sid)
        for r in refs:
            rid = "%s:%s" % (skill, r)
            edges.append({"type": "USES", "from": sid, "to": rid})
            if not any(n["id"] == rid for n in nodes):
                nodes.append({"id": rid, "type": "Reference", "file": r})
        for r in new_refs:
            seen_refs.add(r)
            _scan_file(skill_dir, r, skill, nodes, edges, order, seen_refs, depth + 1)


def compile_skill(skill_dir):
    """Compile one skill directory into a graph dict (validated)."""
    skill_dir = Path(skill_dir)
    if not (skill_dir / "SKILL.md").is_file():
        raise GraphError("no SKILL.md in %s" % skill_dir)
    skill = skill_dir.name
    nodes = [{"id": "skill:" + skill, "type": "Skill", "name": skill}]
    edges = []
    order = []
    _scan_file(skill_dir, "SKILL.md", skill, nodes, edges, order, set())
    for a, b in zip(order, order[1:]):
        edges.append({"type": "THEN", "from": a, "to": b})
    graph = {"skill": skill, "nodes": nodes, "edges": edges, "order": order}
    validate_quotes(graph, skill_dir)
    return graph


compile = compile_skill  # spec name; shadows the builtin only inside this module


def validate_quotes(graph, skill_dir):
    """Raise GraphError unless every Step quote is in its file at its line."""
    skill_dir = Path(skill_dir)
    cache = {}
    for n in graph["nodes"]:
        if n.get("type") != "Step":
            continue
        f = n["file"]
        if f not in cache:
            p = skill_dir / f
            if not p.is_file():
                raise GraphError("step %s: file %s missing" % (n["id"], f))
            cache[f] = p.read_text(encoding="utf-8").splitlines()
        lines = cache[f]
        ln = n["line"]
        if (
            not (1 <= ln <= len(lines))
            or not n["quote"]
            or n["quote"] not in lines[ln - 1]
        ):
            raise GraphError("step %s: quote not found at %s:%s" % (n["id"], f, ln))


# --- query ------------------------------------------------------------------


def remote_gates(graph):
    """Every remote step with its gate: 'inline', the id of the earlier
    approval step that covers one of the step's action classes, or None
    (ungated). Returns [(node, gate)]."""
    by_id = {n["id"]: n for n in graph["nodes"] if n["type"] == "Step"}
    out = []
    covered = {}  # class -> id of the latest earlier approval step naming it
    for sid in graph["order"]:
        n = by_id[sid]
        if n["kind"] == "remote":
            if n["gated_inline"]:
                out.append((n, "inline"))
            else:
                hit = [covered[c] for c in n["classes"] if c in covered]
                out.append((n, hit[0] if hit else None))
        for c in n["gates_classes"]:
            covered[c] = n["id"]
    return out


def query_ungated_remote(graph):
    """Remote steps with no approval earlier on the THEN path (or inline)."""
    return [n for n, gate in remote_gates(graph) if gate is None]


def step_key(n, skill):
    return "%s:%s:%d-%s" % (skill, n["file"], n["line"], n["quote"][:QUOTE_KEY_LEN])


def load_allow(path):
    p = Path(path)
    if not p.is_file():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise GraphError("%s must be a JSON object" % p)
    for k, v in data.items():
        if not isinstance(v, str) or not v.strip():
            raise GraphError("allowlist %r needs a written reason" % k)
    return data


def _allowed(key, allow):
    return next((k for k in allow if key.startswith(k)), None)


def check(skills_dir, allow=None):
    """Compile every skill; return the report dict."""
    skills_dir = Path(skills_dir)
    allow = allow or {}
    report = {"skills": 0, "remote_steps": 0, "ungated": [], "allowed": [], "gated": []}
    for d in sorted(p for p in skills_dir.iterdir() if (p / "SKILL.md").is_file()):
        g = compile_skill(d)
        report["skills"] += 1
        report["remote_steps"] += sum(
            1 for n in g["nodes"] if n.get("kind") == "remote"
        )
        for n, gate in remote_gates(g):
            if gate is not None:
                report["gated"].append(
                    {"key": step_key(n, g["skill"]), "gated_by": gate}
                )
                continue
            key = step_key(n, g["skill"])
            row = {
                "skill": g["skill"],
                "file": n["file"],
                "line": n["line"],
                "quote": n["quote"],
                "pattern": n["pattern"],
                "key": key,
            }
            hit = _allowed(key, allow)
            if hit:
                row["reason"] = allow[hit]
                report["allowed"].append(row)
            else:
                report["ungated"].append(row)
    return report


# --- dot --------------------------------------------------------------------


def to_dot(graph):
    ungated = {n["id"] for n in query_ungated_remote(graph)}
    out = ["digraph %s {" % json.dumps(graph["skill"]), "  rankdir=TB;"]
    for n in graph["nodes"]:
        if n["type"] == "Skill":
            label, attrs = n["name"], "shape=box,style=bold"
        elif n["type"] == "Reference":
            label, attrs = n["file"], "shape=note"
        else:
            label = "%s:%d %s" % (n["file"], n["line"], n["kind"])
            attrs = "shape=ellipse"
            if n["id"] in ungated:
                attrs += ",color=red,fontcolor=red"
            elif n["kind"] == "remote":
                attrs += ",color=orange"
            elif n["kind"] == "approval":
                attrs += ",color=green"
        out.append(
            "  %s [label=%s,%s];" % (json.dumps(n["id"]), json.dumps(label), attrs)
        )
    for e in graph["edges"]:
        style = {"THEN": "", "HAS_STEP": ",style=dotted", "USES": ",style=dashed"}[
            e["type"]
        ]
        out.append(
            "  %s -> %s [label=%s%s];"
            % (json.dumps(e["from"]), json.dumps(e["to"]), json.dumps(e["type"]), style)
        )
    out.append("}")
    return "\n".join(out)


# --- cli --------------------------------------------------------------------


def _resolve_skill(arg, skills_dir):
    p = Path(arg)
    if (p / "SKILL.md").is_file():
        return p
    q = Path(skills_dir) / arg
    if (q / "SKILL.md").is_file():
        return q
    raise GraphError("skill not found: %s" % arg)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compile")
    c.add_argument("skill")
    c.add_argument("--skills-dir", default=str(DEFAULT_SKILLS))
    c.add_argument("--json", action="store_true")
    k = sub.add_parser("check")
    k.add_argument("--skills-dir", default=str(DEFAULT_SKILLS))
    k.add_argument("--allow", default=str(DEFAULT_ALLOW))
    k.add_argument("--json", action="store_true")
    d = sub.add_parser("dot")
    d.add_argument("skill")
    d.add_argument("--skills-dir", default=str(DEFAULT_SKILLS))
    a = ap.parse_args(argv)
    try:
        if a.cmd == "check":
            rep = check(a.skills_dir, load_allow(a.allow))
            if a.json:
                print(json.dumps(rep, indent=2))
            else:
                print(
                    "%d skills, %d remote steps, %d ungated, %d allowlisted"
                    % (
                        rep["skills"],
                        rep["remote_steps"],
                        len(rep["ungated"]),
                        len(rep["allowed"]),
                    )
                )
                for r in rep["ungated"]:
                    print(
                        "UNGATED %s:%s:%d [%s] %s"
                        % (
                            r["skill"],
                            r["file"],
                            r["line"],
                            r["pattern"],
                            r["quote"][:120],
                        )
                    )
            return 1 if rep["ungated"] else 0
        g = compile_skill(_resolve_skill(a.skill, a.skills_dir))
        if a.cmd == "dot":
            print(to_dot(g))
        elif a.json:
            print(json.dumps(g, indent=2))
        else:
            bad = {n["id"] for n in query_ungated_remote(g)}
            nodes = {n["id"]: n for n in g["nodes"]}
            for sid in g["order"]:
                n = nodes[sid]
                print(
                    "%s%s:%d %-11s %s"
                    % (
                        "!" if sid in bad else " ",
                        n["file"],
                        n["line"],
                        n["kind"],
                        n["quote"][:90],
                    )
                )
        return 0
    except GraphError as e:
        print("atlas_skillgraph: %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
