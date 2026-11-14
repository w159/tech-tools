#!/usr/bin/env python3
"""Cheap local guard: shipped armada MCP bundles must match their recorded provenance.

plugins/armada/mcp/bundles.lock.json is written by scripts/rebuild_armada_bundles.mjs. For every
plugins/armada/mcp/<svc>/server.mjs it records the sha256 of the sources it was built from and of
the built file, plus the toolchain pin (tsup, esbuild, Node major). This test recomputes both
without Node or npm and fails when a source change was not followed by a rebuild, when a bundle
was edited or replaced by hand, or when the toolchain pin moved without a rebuild.

It does not rebuild (that needs network + npm); .github/workflows/armada-bundles.yml does, and
fails on any diff. Fix a failure here with:

    node scripts/rebuild_armada_bundles.mjs

The source-hash algorithm mirrors sourceHash() in scripts/rebuild_armada_bundles.mjs.
"""

import hashlib
import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MCP = REPO / "plugins/armada/mcp"
LOCK = MCP / "bundles.lock.json"
SERVERS = REPO / "mcp_servers"
NODE_LIBS = REPO / "mcp_node"
TOOLCHAIN = SERVERS / "_toolchain"
SKIP_DIRS = {"node_modules", "dist", ".git", "__tests__", "tests", "coverage"}
EXPECTED_NODE_MAJOR = 22
# Services that ship a prebuilt server.mjs but are NOT built from mcp_servers/ (none today).
NOT_FROM_SOURCE = set()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def walk(directory):
    out = []
    if not directory.is_dir():
        return out
    for child in sorted(directory.iterdir(), key=lambda p: p.name):
        if child.name in SKIP_DIRS:
            continue
        if child.is_dir():
            out.extend(walk(child))
        elif child.is_file():
            out.append(child)
    return out


def local_libs(pkg_dir):
    pkg = json.loads((pkg_dir / "package.json").read_text("utf-8"))
    libs = []
    for name, spec in {
        **pkg.get("dependencies", {}),
        **pkg.get("devDependencies", {}),
    }.items():
        if isinstance(spec, str) and spec.startswith("file:"):
            libs.append(NODE_LIBS / name)
    return libs


def source_hash(pkg_dir):
    files = walk(pkg_dir / "src")
    for name in (
        "tsup.bundle.config.ts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
    ):
        if (pkg_dir / name).exists():
            files.append(pkg_dir / name)
    for lib in local_libs(pkg_dir):
        files.extend(walk(lib / "src"))
        for name in (
            "tsup.config.ts",
            "package.json",
            "package-lock.json",
            "tsconfig.json",
        ):
            if (lib / name).exists():
                files.append(lib / name)
    shared = SERVERS / "_shared"
    files.extend(
        p for p in sorted(shared.iterdir(), key=lambda p: p.name) if p.is_file()
    )
    lines = sorted(
        (p.relative_to(REPO).as_posix(), sha256(p.read_bytes())) for p in files
    )
    return sha256(
        "".join(f"{rel}\0{digest}\n" for rel, digest in lines).encode("utf-8")
    )


def bundle_sources():
    """svc -> package dir, discovered from each tsup.bundle.config.ts outDir like the script does."""
    found = {}
    for cfg in sorted(SERVERS.glob("*/tsup.bundle.config.ts")):
        m = re.search(r"plugins/armada/mcp/([a-z0-9_-]+)'", cfg.read_text("utf-8"))
        if m:
            found[m.group(1)] = cfg.parent
    return found


class ArmadaBundleProvenance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert LOCK.is_file(), (
            f"{LOCK.relative_to(REPO)} missing - run: node scripts/rebuild_armada_bundles.mjs"
        )
        cls.lock = json.loads(LOCK.read_text("utf-8"))
        cls.sources = bundle_sources()

    def test_toolchain_pin_matches_lock_record(self):
        pkg = json.loads((TOOLCHAIN / "package.json").read_text("utf-8"))
        lock = json.loads((TOOLCHAIN / "package-lock.json").read_text("utf-8"))
        want = {
            "node_major": EXPECTED_NODE_MAJOR,
            "tsup": pkg["devDependencies"]["tsup"],
            "esbuild": pkg["devDependencies"]["esbuild"],
        }
        for name in ("tsup", "esbuild"):
            self.assertRegex(
                want[name], r"^\d+\.\d+\.\d+$", f"{name} pin must be an exact version"
            )
            self.assertEqual(
                lock["packages"][f"node_modules/{name}"]["version"],
                want[name],
                f"{name}: toolchain lockfile drifted from package.json",
            )
        self.assertEqual(
            self.lock["toolchain"],
            want,
            "bundles.lock.json was built with a different toolchain pin; run: node scripts/rebuild_armada_bundles.mjs",
        )

    def test_every_shipped_bundle_is_recorded_and_buildable(self):
        shipped = {p.parent.name for p in MCP.glob("*/server.mjs")} - NOT_FROM_SOURCE
        self.assertEqual(
            shipped,
            set(self.sources),
            "shipped server.mjs set differs from mcp_servers/*/tsup.bundle.config.ts targets",
        )
        self.assertEqual(
            set(self.lock["bundles"]),
            shipped,
            "bundles.lock.json service set differs from shipped bundles",
        )

    def test_bundle_file_matches_recorded_hash(self):
        for svc, rec in sorted(self.lock["bundles"].items()):
            data = (MCP / svc / "server.mjs").read_bytes()
            with self.subTest(svc=svc):
                self.assertEqual(
                    sha256(data),
                    rec["bundle_sha256"],
                    f"{svc}/server.mjs was changed outside the rebuild script",
                )
                self.assertEqual(len(data), rec["bytes"])

    def test_source_hash_is_current(self):
        for svc, rec in sorted(self.lock["bundles"].items()):
            with self.subTest(svc=svc):
                self.assertEqual(
                    source_hash(self.sources[svc]),
                    rec["source_sha256"],
                    f"{svc}: sources changed since the bundle was built; run: node scripts/rebuild_armada_bundles.mjs",
                )


if __name__ == "__main__":
    unittest.main()
