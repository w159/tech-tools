#!/usr/bin/env python3
"""Build the atlas knowledge-graph hub for an audit run dir (WS4).

Given a run dir (e.g. docs/audits/atlas-athena-<date>/) that holds `handoffs/<id>.md`
remediation prompts and optional `report.md`/`findings/*.md`, plus one or more graphify
`graph.json` graphs, produce:

  <run_dir>/hub/manifest.json  - the node<->finding bridge: one entry per handoff, each
                                 mapped to its file's representative (container) node.
                                 graphify nodes are SUB-FILE (one per symbol/key) and carry
                                 no line spans, so the bridge is file-granular, not exact.
  <run_dir>/hub/index.html     - a branded Atlas "expedition map": actionable nodes as
                                 cards with severity, the finding, the handoff excerpt,
                                 and the exact `atlas-launch <id>` command to remediate.

Pure stdlib. Safe to run repeatedly (overwrites hub/). Tolerates missing fields.

Usage:
  python3 build_hub.py <run_dir> [graph.json ...]
  # with no graph paths, auto-discovers graphify-out/graph.json under the repo root.
"""

import html
import json
import os
import re
import sys

SEVERITY_RANK = {"HIGH": 0, "MED": 1, "MEDIUM": 1, "LOW": 2}
_FILE_LINE = re.compile(r"`?([\w./\-]+\.\w+):(\d+)`?")
# Case-SENSITIVE: severity labels are written uppercase (HIGH/MED/LOW), so lowercase
# prose like "low-level API" is ignored while a real "HIGH severity"/"MED"/"Severity: LOW"
# label is read. Avoids prose flipping the badge without needing the word "severity".
_SEVERITY = re.compile(r"\b(HIGH|MEDIUM|MED|LOW)\b")


def _index_file_nodes(graph_paths):
    """Map source_file -> the file's REPRESENTATIVE (container) node id.

    Graphify emits SUB-FILE nodes (one per symbol/import/JSON key), so a single file
    owns many nodes (e.g. package.json -> ~40 nodes). The manifest is file-granular: we
    keep the first node seen for each file, which is graphify's file-container node
    (verified on the auvik fixture: package.json -> `package_json`, not `..._bugs_url`).
    We do NOT claim node-level precision - there are no line spans to match against."""
    by_file = {}
    for gp in graph_paths:
        try:
            with open(gp) as fh:
                g = json.load(fh)
        except Exception:
            continue
        for n in g.get("nodes", []):
            sf = n.get("source_file")
            if sf:
                by_file.setdefault(sf, n.get("id"))  # first wins = file-container node
    return by_file


def _match_node(file_path, by_file):
    """(node_id, match_kind) mapping a finding's file path to that file's container node.
    match_kind is about how the PATH matched the graph's file set, never node precision:
      'file'        - the finding path equals a graph source_file
      'file-suffix' - one is a multi-segment path-suffix of the other (graphify paths are
                      relative to their own scan root, so mcp_servers/x/src/a.ts matches a
                      node source_file src/a.ts). Bare basenames are rejected to avoid a
                      foo/index.ts vs bar/index.ts false match.
      'none'        - the file is absent from the graph (never guessed)."""
    if not file_path:
        return None, "none"
    if file_path in by_file:
        return by_file[file_path], "file"
    best, best_len = None, 0
    for sf, nid in by_file.items():
        shorter = sf if len(sf) <= len(file_path) else file_path
        if "/" not in shorter:
            continue  # require a multi-segment suffix; a bare basename is not a path match
        if (file_path.endswith("/" + sf) or sf.endswith("/" + file_path)) and len(
            sf
        ) > best_len:
            best, best_len = nid, len(sf)
    return (best, "file-suffix") if best else (None, "none")


def _summarize(text):
    """First meaningful line of a handoff prompt as a one-line summary."""
    for line in text.splitlines():
        s = line.strip().lstrip("#").strip()
        if s and not s.startswith("```"):
            return s[:160]
    return "(no summary)"


def _parse_handoff(path):
    """Pull file:line, severity, and a summary out of one handoff prompt."""
    try:
        with open(path) as fh:
            text = fh.read()
    except Exception:
        text = ""
    fm = _FILE_LINE.search(text)
    sev = _SEVERITY.search(
        text
    )  # uppercase-only, so lowercase prose can't flip the badge
    return {
        "file": fm.group(1) if fm else None,
        "line": int(fm.group(2)) if fm else None,
        "severity": (sev.group(1).replace("MEDIUM", "MED") if sev else "LOW"),
        "prompt_summary": _summarize(text),
    }


def build_manifest(run_dir, graph_paths):
    """Build the manifest list (does not write). One entry per handoffs/<id>.md."""
    by_file = _index_file_nodes(graph_paths)
    handoff_dir = os.path.join(run_dir, "handoffs")
    entries = []
    if os.path.isdir(handoff_dir):
        for fn in sorted(os.listdir(handoff_dir)):
            if not fn.endswith(".md"):
                continue
            hid = fn[:-3]
            hp = os.path.join(handoff_dir, fn)
            parsed = _parse_handoff(hp)
            node_id, match = _match_node(parsed["file"], by_file)
            entries.append(
                {
                    "id": hid,
                    "kind": "finding",
                    "file": parsed["file"],
                    "line": parsed["line"],
                    "severity": parsed["severity"],
                    "node_id": node_id,
                    "node_match": match,
                    "handoff_path": os.path.relpath(hp, run_dir),
                    "prompt_summary": parsed["prompt_summary"],
                }
            )
    entries.sort(key=lambda e: (SEVERITY_RANK.get(e["severity"], 3), e["id"]))
    return entries


# --- branded Atlas "expedition map" HTML -------------------------------------

_ATLAS_CSS = """
:root{--ink:#0b1f2a;--parchment:#f4ecd8;--sea:#1b4965;--compass:#c9a227;
--high:#b3261e;--med:#c9a227;--low:#5a7d7c;--line:#9db4c0}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--parchment);
font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:28px 32px;border-bottom:2px solid var(--compass);
background:linear-gradient(135deg,#0b1f2a,#13344a)}
h1{margin:0;font-size:24px;letter-spacing:.5px}
.sub{color:var(--line);margin-top:6px}
.legend{display:flex;gap:18px;margin:14px 32px 0;flex-wrap:wrap;color:var(--line)}
.legend b{color:var(--parchment)}
main{padding:24px 32px;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr))}
.card{background:#0f2836;border:1px solid var(--sea);border-left:5px solid var(--low);
border-radius:8px;padding:16px}
.card.HIGH{border-left-color:var(--high)}.card.MED{border-left-color:var(--med)}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;
font-weight:700;color:#0b1f2a}
.badge.HIGH{background:var(--high);color:#fff}.badge.MED{background:var(--med)}
.badge.LOW{background:var(--low);color:#fff}
.file{color:var(--compass);font-size:13px;margin:8px 0;word-break:break-all}
.summary{margin:8px 0}
.node{color:var(--line);font-size:12px}
.cmd{margin-top:12px;background:#06141c;border:1px dashed var(--compass);border-radius:6px;
padding:8px 10px;color:var(--parchment);display:flex;justify-content:space-between;gap:8px}
.cmd code{color:var(--compass)}
.empty{color:var(--line);padding:24px 32px}
footer{padding:18px 32px;color:var(--line);border-top:1px solid var(--sea);font-size:12px}
"""

_ATLAS_JS = """
function copyCmd(el){navigator.clipboard&&navigator.clipboard.writeText(el.dataset.cmd);
el.textContent='copied';setTimeout(function(){el.textContent='copy'},1200);}
"""


def render_html(run_label, entries, communities):
    def esc(x):
        return html.escape(str(x if x is not None else ""))

    cards = []
    for e in entries:
        sev = e["severity"]
        node = (
            "graph node: %s (%s)" % (esc(e["node_id"]), esc(e["node_match"]))
            if e["node_id"]
            else "graph node: unmatched"
        )
        cmd = "atlas-launch %s" % e["id"]
        cards.append(
            '<div class="card %s"><span class="badge %s">%s</span>'
            '<div class="file">%s%s</div><div class="summary">%s</div>'
            '<div class="node">%s</div>'
            '<div class="cmd"><code>%s</code>'
            '<span data-cmd="%s" onclick="copyCmd(this)" style="cursor:pointer">copy</span></div></div>'
            % (
                sev,
                sev,
                sev,
                esc(e["file"]),
                (":" + str(e["line"])) if e["line"] else "",
                esc(e["prompt_summary"]),
                node,
                esc(cmd),
                esc(cmd),
            )
        )
    body = (
        "\n".join(cards)
        if cards
        else '<div class="empty">No actionable nodes in this run.</div>'
    )
    matched = sum(1 for e in entries if e["node_id"])
    legend = (
        "<b>%d</b> actionable nodes &middot; <b>%d</b> mapped to the graph &middot; "
        "<b>%d</b> communities charted" % (len(entries), matched, communities)
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Atlas Hub - %s</title><style>%s</style></head><body>"
        "<header><h1>&#9906; Atlas Expedition Map</h1>"
        "<div class='sub'>%s</div></header>"
        "<div class='legend'>%s</div>"
        "<main>%s</main>"
        "<footer>Each card is a charted finding. Run its <code>atlas-launch &lt;id&gt;</code> to "
        "start a pre-loaded remediation expedition. Graph overlay is file-granular: graphify "
        "nodes are sub-file, so each finding maps to its file's container node.</footer>"
        "<script>%s</script></body></html>"
        % (esc(run_label), _ATLAS_CSS, esc(run_label), legend, body, _ATLAS_JS)
    )


def _count_communities(graph_paths):
    comms = set()
    for gp in graph_paths:
        try:
            with open(gp) as fh:
                g = json.load(fh)
        except Exception:
            continue
        for n in g.get("nodes", []):
            if n.get("community") is not None:
                comms.add((gp, n["community"]))
    return len(comms)


def build_hub(run_dir, graph_paths):
    """Write hub/manifest.json and hub/index.html under run_dir. Returns the manifest."""
    entries = build_manifest(run_dir, graph_paths)
    hub = os.path.join(run_dir, "hub")
    os.makedirs(hub, exist_ok=True)
    with open(os.path.join(hub, "manifest.json"), "w") as fh:
        json.dump(entries, fh, indent=2)
    label = os.path.basename(os.path.normpath(run_dir))
    html_doc = render_html(label, entries, _count_communities(graph_paths))
    with open(os.path.join(hub, "index.html"), "w") as fh:
        fh.write(html_doc)
    return entries


def _discover_graphs(start):
    """Find graphify-out/graph.json under the repo containing start (best-effort)."""
    root = start
    for _ in range(8):
        if os.path.isdir(os.path.join(root, ".git")):
            break
        parent = os.path.dirname(root)
        if parent == root:
            break
        root = parent
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        if "node_modules" in dirpath or "/.git" in dirpath:
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
            continue
        if os.path.basename(dirpath) == "graphify-out" and "graph.json" in filenames:
            found.append(os.path.join(dirpath, "graph.json"))
    return found


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: build_hub.py <run_dir> [graph.json ...]")
        sys.exit(2)
    _run = sys.argv[1]
    _graphs = sys.argv[2:] or _discover_graphs(os.path.abspath(_run))
    _m = build_hub(_run, _graphs)
    print(
        "hub built: %d actionable nodes (%d graph-mapped) -> %s/hub/"
        % (len(_m), sum(1 for e in _m if e["node_id"]), _run)
    )
