#!/usr/bin/env python3
"""Atlas asset/context auditor — the context-cost lens of atlas-argus.

Run telemetry answers "is atlas behaving?"; this answers "is the session
carrying weight it does not need here?". It inventories every context-loaded
asset (skills, agents, enabled plugins), estimates each one's context cost,
detects the current project's tech profile, scores each asset's relevance to
THIS project, and decides the most effective LEVEL to act at:

  - irrelevant here but used in other known projects -> disable at PROJECT level
    (settings.local.json), never globally.
  - irrelevant to every known project -> propose a GLOBAL relocate.
  - clearly-universal (general dev/git/docs) -> always keep.

Output is an action plan split by risk: AUTO (low-risk, project-scoped,
reversible) vs CONFIRM (relocations, anything global). Stdlib-only. Reads
files and the live settings; the only mutation it performs itself is writing
project-level enabledPlugins=false for AUTO actions, and only when --apply is
passed. Relocations are always left for confirmation.

Token estimates are chars/4 — a deliberate approximation, surfaced as
estimates, not measurements.
"""

import json
import os
import re
import sys

HOME = os.path.expanduser("~")
USER_SKILLS = os.path.join(HOME, ".claude", "skills")
USER_AGENTS = os.path.join(HOME, ".claude", "agents")
USER_SETTINGS = os.path.join(HOME, ".claude", "settings.json")

# tag -> regexes that mark an asset (by name+desc) or a project (by files/deps)
# as belonging to that technology/vertical. An asset with NO tag is treated as
# universal (general-purpose) and is never flagged.
TAXONOMY = {
    "frontend": r"react|vue|nuxt|next\.?js|angular|svelte|tailwind|frontend|css|ui-?ux|accessibility|wcag|figma|storybook",
    "dotnet": r"\bdotnet\b|\.net|csharp|c#|nuget|blazor|maui|winforms|winui|efcore|ef-core|xunit|nunit|mstest",
    "python": r"\bpython\b|pytest|pyproject|django|flask|fastapi|pydantic|ruff|pip\b|uv\b",
    "node-ts": r"typescript|tsconfig|node\b|npm\b|pnpm|yarn|jest|vitest|eslint",
    "mcp": r"\bmcp\b|model context protocol|mcpb|stdio server",
    "java": r"\bjava\b|kotlin|spring|gradle|maven|graalvm|jakarta|junit",
    "ruby": r"\bruby\b|rails|rspec|gem\b",
    "rust": r"\brust\b|cargo|clippy",
    "go": r"\bgolang\b|\bgo\b mcp|go module",
    "php": r"\bphp\b|laravel|drupal|pimcore|composer",
    "salesforce": r"salesforce|apex|visualforce|lwc\b|aura\b|sfdx",
    "powerbi": r"power ?bi|\bdax\b|powerbi",
    "powerplatform": r"power ?automate|power ?apps|dataverse|flowstudio|copilot studio",
    "azure": r"\bazure\b|\baz-?\b|bicep|avm\b|arm template|app service|container app",
    "aws": r"\baws\b|cloudformation|lambda|dynamodb|s3 bucket",
    "terraform": r"terraform|\.tf\b|hcl\b|terratest",
    "k8s": r"kubernetes|k8s|helm|kubectl|kubestellar",
    "m365": r"m365|microsoft ?365|entra|msgraph|intune|exchange online|sharepoint|defender",
    "db-vendor": r"oracle|postgres|mysql|mongodb|neo4j|cosmos|qdrant|pinecone|snowflake|bigquery",
    "saas-vendor": r"clerk|stackhawk|jfrog|pagerduty|new relic|dynatrace|octopus|amplitude|apify|lingo|sentry|sonarqube|monarch|ramp|asana|fireflies",
    "gtm": r"\bgtm\b|go-to-market|investor|pricing strategy|product-led",
    "novelty": r"from-the-other-side|caveman|gilfoyle|beast mode|songwriting|minecraft|rhino3d|freecad|comfyui|manim|polymarket|openhue|ascii-art",
}

# project tags that should NOT, on their own, pull in heavy verticals.
# (kept for future weighting; unused in v1 scoring)
UNIVERSAL_HINT = r"git|commit|refactor|review|docs?|readme|changelog|test|debug|skill|plugin|agent|prompt|memory|markdown"


def est_tokens(text):
    return max(1, len(text) // 4)


def _read(path, limit=4000):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(limit)
    except OSError:
        return ""


def _frontmatter_desc(skill_md):
    """Pull name+description from a SKILL.md frontmatter (cheap, bounded)."""
    head = _read(skill_md, 2000)
    name = re.search(r"^name:\s*(.+)$", head, re.M)
    desc = re.search(r"^description:\s*(.+)$", head, re.M)
    return (
        name.group(1).strip() if name else os.path.basename(os.path.dirname(skill_md)),
        desc.group(1).strip() if desc else "",
    )


def tags_for(text):
    t = text.lower()
    return {tag for tag, pat in TAXONOMY.items() if re.search(pat, t)}


def inventory():
    """Return list of asset dicts: kind, key, name, tags, est_tokens, path."""
    assets = []
    sdir = os.path.realpath(USER_SKILLS)
    if os.path.isdir(sdir):
        for entry in sorted(os.listdir(sdir)):
            skill_md = os.path.join(sdir, entry, "SKILL.md")
            if not os.path.isfile(skill_md):
                continue
            name, desc = _frontmatter_desc(skill_md)
            blob = entry + " " + name + " " + desc
            assets.append(
                {
                    "kind": "skill",
                    "key": entry,
                    "name": name,
                    "tags": sorted(tags_for(blob)),
                    "est_tokens": est_tokens(name + " " + desc),
                    "path": os.path.join(sdir, entry),
                }
            )
    adir = os.path.realpath(USER_AGENTS)
    if os.path.isdir(adir):
        for fn in sorted(os.listdir(adir)):
            if not fn.endswith(".md"):
                continue
            body = _read(os.path.join(adir, fn), 2000)
            desc = re.search(r"description:\s*(.+)", body)
            desc = desc.group(1).strip() if desc else ""
            blob = fn + " " + desc
            assets.append(
                {
                    "kind": "agent",
                    "key": fn[:-3],
                    "name": fn[:-3],
                    "tags": sorted(tags_for(blob)),
                    "est_tokens": est_tokens(fn + " " + desc),
                    "path": os.path.join(adir, fn),
                }
            )
    return assets


def detect_project_tags(root):
    """Infer the project's tech tags from files present at/near the root."""
    tags = set()
    names = []
    for dirpath, dirs, files in os.walk(root):
        # shallow walk: skip vendored/build trees and go at most 2 levels deep
        depth = dirpath[len(root) :].count(os.sep)
        if depth >= 2:
            dirs[:] = []
        dirs[:] = [
            d
            for d in dirs
            if d
            not in ("node_modules", "dist", "build", ".git", ".venv", "__pycache__")
        ]
        names.extend(files)
    blob = " ".join(names).lower()
    signals = {
        "node-ts": r"package\.json|tsconfig|pnpm-lock|yarn\.lock",
        "python": r"pyproject\.toml|requirements\.txt|\.py$|setup\.cfg",
        "dotnet": r"\.csproj|\.sln|\.cs$",
        "java": r"pom\.xml|build\.gradle",
        "rust": r"cargo\.toml",
        "go": r"go\.mod",
        "php": r"composer\.json",
        "terraform": r"\.tf$",
        "azure": r"azure-pipelines|\.bicep$|azuredeploy",
        "mcp": r"manifest\.json|\.mcpb$|mcp_servers",
    }
    for tag, pat in signals.items():
        if re.search(pat, blob, re.M):
            tags.add(tag)
    # dependency sniff for frontend/mcp from package.json
    pj = _read(os.path.join(root, "package.json"), 8000).lower()
    if re.search(r"react|vue|next|svelte|tailwind|@angular", pj):
        tags.add("frontend")
    if re.search(r"modelcontextprotocol|@modelcontextprotocol", pj):
        tags.add("mcp")
    return tags


def classify(assets, project_tags, other_project_tags):
    """Attach a verdict to each asset for THIS project."""
    for a in assets:
        atags = set(a["tags"])
        if not atags:
            a["verdict"] = "keep"  # universal / general-purpose
            a["reason"] = "no tech tag (general-purpose)"
            continue
        if atags & project_tags:
            a["verdict"] = "keep"
            a["reason"] = "matches project: " + ",".join(sorted(atags & project_tags))
            continue
        # irrelevant here. relevant to another known project?
        if atags & other_project_tags:
            a["verdict"] = "disable-here"
            a["reason"] = "off-stack here; used elsewhere: " + ",".join(
                sorted(atags & other_project_tags)
            )
        else:
            a["verdict"] = "relocate-global"
            a["reason"] = "off-stack here and in all known projects: " + ",".join(
                sorted(atags)
            )
    return assets


def build_plan(assets):
    """Split into AUTO (low-risk) and CONFIRM tiers with savings + reasons."""
    auto, confirm = [], []
    for a in assets:
        if a["verdict"] == "keep":
            continue
        item = {
            k: a[k] for k in ("kind", "key", "verdict", "reason", "est_tokens", "path")
        }
        # AUTO is reserved for the safest, project-scoped, instantly-reversible
        # signal: novelty/clearly-off-stack assets flagged relocate-global with
        # a single dominant tag. Everything else needs eyes.
        if a["verdict"] == "relocate-global" and ("novelty" in a["tags"]):
            auto.append(item)
        else:
            confirm.append(item)
    auto.sort(key=lambda x: -x["est_tokens"])
    confirm.sort(key=lambda x: -x["est_tokens"])
    return {"auto": auto, "confirm": confirm}


def summarize(assets, project_tags, plan):
    keep = sum(1 for a in assets if a["verdict"] == "keep")
    dh = sum(1 for a in assets if a["verdict"] == "disable-here")
    rg = sum(1 for a in assets if a["verdict"] == "relocate-global")
    save_here = sum(a["est_tokens"] for a in assets if a["verdict"] != "keep")
    return {
        "project_tags": sorted(project_tags),
        "assets_total": len(assets),
        "keep": keep,
        "disable_here": dh,
        "relocate_global": rg,
        "est_tokens_reclaimable_here": save_here,
        "auto_actions": len(plan["auto"]),
        "confirm_actions": len(plan["confirm"]),
    }


def _db():
    """Open atlas.db for learning. Fail open: audit works without it."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import atlas_db

        conn = atlas_db.connect()
        atlas_db.init(conn)
        return atlas_db, conn
    except Exception:
        return None, None


DISABLED = {
    "skill": os.path.join(HOME, ".claude", "skills-disabled"),
    "agent": os.path.join(HOME, ".claude", "agents-disabled"),
}
MANIFEST = os.path.join(
    HOME, ".claude", ".context-cleanup-manifests", "sextant-auto.tsv"
)


def apply_auto(plan, db, conn):
    """Relocate AUTO items (move, never delete) and record a restore manifest.
    Returns the list of moved items. Reversible via the manifest."""
    moved = []
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    for d in DISABLED.values():
        os.makedirs(d, exist_ok=True)
    with open(MANIFEST, "a", encoding="utf-8") as man:
        for it in plan["auto"]:
            src = it["path"]
            dest = os.path.join(DISABLED[it["kind"]], os.path.basename(src))
            if os.path.exists(src) and not os.path.exists(dest):
                os.rename(src, dest)
                man.write(f"{dest}\t{src}\n")
                moved.append(it)
                if db:
                    try:
                        db.mark_asset_applied(conn, it["kind"], it["key"])
                    except Exception:
                        pass
    return moved


def main(argv):
    root = (
        os.path.abspath(argv[1])
        if len(argv) > 1 and not argv[1].startswith("-")
        else os.getcwd()
    )
    as_json = "--json" in argv
    do_apply = "--apply" in argv
    assets = inventory()
    project_tags = detect_project_tags(root)
    # other known projects: union of their tags. v1 derives them from the live
    # asset tags themselves (conservative: assume the user touches every vertical
    # they have an asset for) so nothing is proposed for GLOBAL removal unless it
    # is off-stack for the current project AND not novelty. atlas.db wiring (real
    # cross-project history) is layered on below.
    other_project_tags = set(TAXONOMY) - {"novelty"}
    classify(assets, project_tags, other_project_tags)

    # learning loop: never re-flag an asset the user restored before.
    db, conn = _db()
    project_id = None
    if db:
        try:
            suppressed = db.suppressed_assets(conn)
            for a in assets:
                if (a["kind"], a["key"]) in suppressed and a["verdict"] != "keep":
                    a["verdict"] = "keep"
                    a["reason"] = "suppressed (you restored this before)"
            project_id = db.register_project(conn, root)
            db.record_asset_verdicts(conn, project_id, assets)
        except Exception:
            pass

    plan = build_plan(assets)
    applied = apply_auto(plan, db, conn) if do_apply else []
    if applied:
        plan["auto"] = [it for it in plan["auto"] if it not in applied]
    summary = summarize(assets, project_tags, plan)
    summary["applied_now"] = len(applied)
    if as_json:
        print(json.dumps({"summary": summary, "plan": plan}, indent=2))
        return 0
    print("# atlas-argus asset audit")
    print(f"project: {root}")
    print(f"detected stack: {', '.join(summary['project_tags']) or '(none detected)'}")
    print(
        f"assets: {summary['assets_total']}  keep={summary['keep']}  "
        f"disable-here={summary['disable_here']}  relocate-global={summary['relocate_global']}"
    )
    print(
        f"est. reclaimable here: ~{summary['est_tokens_reclaimable_here']} tokens "
        f"(estimate, chars/4)"
    )
    if applied:
        print(
            f"\nAPPLIED now: relocated {len(applied)} low-risk asset(s). "
            f'restore: while IFS=$\'\\t\' read d o; do mv "$d" "$o"; done < {MANIFEST}'
        )
    print(
        f"\nAUTO (low-risk, novelty/off-stack): {len(plan['auto'])}"
        + ("  (use --apply to relocate)" if plan["auto"] and not do_apply else "")
    )
    for it in plan["auto"][:20]:
        print(f"  - {it['kind']}:{it['key']}  ~{it['est_tokens']}t  ({it['reason']})")
    print(f"\nCONFIRM (needs your eyes): {len(plan['confirm'])}")
    for it in plan["confirm"][:30]:
        print(
            f"  - {it['kind']}:{it['key']}  ~{it['est_tokens']}t  [{it['verdict']}] ({it['reason']})"
        )
    if len(plan["confirm"]) > 30:
        print(f"  ... +{len(plan['confirm']) - 30} more (use --json for the full plan)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
