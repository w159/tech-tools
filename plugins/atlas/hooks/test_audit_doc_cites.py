import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
PLUGIN = HERE.parent
ROOT = PLUGIN.parent.parent
DOCS = ["CLAUDE.md", "AGENTS.md", "docs/architecture/atlas-harness-parity.md"]
CITE = re.compile(r"\b([A-Za-z0-9_]+\.py) ?:(\d+)(?:-(\d+))?")


def _resolve(name):
    for sub in ("hooks", "scripts"):
        p = PLUGIN / sub / name
        if p.is_file():
            return p
    return None


def _bad_cites(doc):
    text = (ROOT / doc).read_text(encoding="utf-8")
    counts = {}
    bad = []
    for no, line in enumerate(text.splitlines(), 1):
        for m in CITE.finditer(line):
            path = _resolve(m.group(1))
            if path is None:
                continue
            if path not in counts:
                counts[path] = len(path.read_text(encoding="utf-8").splitlines())
            for g in (m.group(2), m.group(3)):
                if g is not None and int(g) > counts[path]:
                    bad.append(f"{doc}:{no}: {m.group(0)} > {counts[path]} lines")
    return bad


class DocCitesInRange(unittest.TestCase):
    def test_cites_do_not_point_past_end_of_file(self):
        bad = []
        for doc in DOCS:
            bad.extend(_bad_cites(doc))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
