"""Tests for contrast.py: WCAG math, tint mixing, pair table shape, and main()'s pass/fail exit contract."""

import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from unittest import mock

_SRC = Path(__file__).resolve().parent / "contrast.py"
_spec = importlib.util.spec_from_file_location("contrast_under_test", _SRC)
c = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(c)


def run_main():
    buf = io.StringIO()
    code = None
    with contextlib.redirect_stdout(buf):
        try:
            c.main()
        except SystemExit as e:
            code = e.code
    return code, buf.getvalue()


class ColorMathTests(unittest.TestCase):
    def test_rgb_parses_with_and_without_hash(self):
        self.assertEqual(c.rgb("#0c1215"), (12, 18, 21))
        self.assertEqual(c.rgb("ff8000"), (255, 128, 0))

    def test_hexs_roundtrip_and_padding(self):
        self.assertEqual(c.hexs((0, 5, 255)), "#0005ff")
        for h in ("#154734", "#c49a22", "#000000"):
            self.assertEqual(c.hexs(c.rgb(h)), h)

    def test_luminance_extremes_and_channel_weights(self):
        self.assertEqual(c.lum((0, 0, 0)), 0.0)
        self.assertAlmostEqual(c.lum((255, 255, 255)), 1.0)
        self.assertAlmostEqual(c.lum((255, 0, 0)), 0.2126)
        self.assertAlmostEqual(c.lum((0, 255, 0)), 0.7152)
        self.assertAlmostEqual(c.lum((0, 0, 255)), 0.0722)

    def test_luminance_linear_segment_for_dark_values(self):
        # 10/255 = 0.0392 <= 0.03928 uses the linear branch v/12.92
        v = 10 / 255
        self.assertAlmostEqual(c.lum((10, 10, 10)), v / 12.92)
        # 11/255 = 0.0431 uses the gamma branch
        v = 11 / 255
        self.assertAlmostEqual(c.lum((11, 11, 11)), ((v + 0.055) / 1.055) ** 2.4)

    def test_ratio_black_white_is_21_and_symmetric(self):
        self.assertAlmostEqual(c.ratio((0, 0, 0), (255, 255, 255)), 21.0)
        self.assertAlmostEqual(c.ratio((255, 255, 255), (0, 0, 0)), 21.0)

    def test_ratio_identical_is_one(self):
        self.assertAlmostEqual(c.ratio((10, 200, 30), (10, 200, 30)), 1.0)

    def test_ratio_known_grey_value(self):
        # #767676 on white is the classic 4.54:1 AA threshold grey
        self.assertAlmostEqual(c.ratio(c.rgb("#767676"), (255, 255, 255)), 4.54, places=2)

    def test_mix_alpha_endpoints_and_midpoint(self):
        fg, bg = (200, 100, 0), (0, 100, 200)
        self.assertEqual(c.mix(fg, bg, 1.0), fg)
        self.assertEqual(c.mix(fg, bg, 0.0), bg)
        self.assertEqual(c.mix(fg, bg, 0.5), (100, 100, 100))

    def test_mix_rounds_per_channel(self):
        self.assertEqual(c.mix((255, 255, 255), (0, 0, 0), c.TINT_ALPHA), (41, 41, 41))


class PaletteTests(unittest.TestCase):
    def test_palettes_share_keys_and_are_valid_hex(self):
        self.assertEqual(set(c.DARK), set(c.LIGHT))
        for P in (c.DARK, c.LIGHT):
            for k, v in P.items():
                self.assertRegex(v, r"^#[0-9a-f]{6}$", k)
        for st in c.STATUS:
            self.assertIn(st, c.DARK)

    def test_pairs_shape_and_thresholds(self):
        rows = c.pairs(c.DARK)
        self.assertEqual(len(rows), 50)
        labels = [r[0] for r in rows]
        self.assertEqual(len(set(labels)), len(labels))
        for label, fg, bg, need in rows:
            self.assertEqual(len(fg), 3)
            self.assertEqual(len(bg), 3)
            if "UI 3:1" in label:
                self.assertEqual(need, 3.0, label)
            else:
                self.assertEqual(need, 4.5, label)
        self.assertIn("accent-ink on accent (primary button)", labels)

    def test_pairs_use_palette_values(self):
        by = {r[0]: r for r in c.pairs(c.LIGHT)}
        _, fg, bg, _ = by["text on s1"]
        self.assertEqual(fg, c.rgb(c.LIGHT["text"]))
        self.assertEqual(bg, c.rgb(c.LIGHT["s1"]))
        _, fg, bg, _ = by["fail text on its tint over s2"]
        self.assertEqual(fg, c.rgb(c.LIGHT["fail"]))
        self.assertEqual(bg, c.mix(c.rgb(c.LIGHT["fail"]), c.rgb(c.LIGHT["s2"]), c.TINT_ALPHA))

    def test_surface_sets_per_family(self):
        labels = {r[0] for r in c.pairs(c.DARK)}
        self.assertIn("text on chrome", labels)
        self.assertIn("text-dim on s3", labels)
        self.assertNotIn("text-faint on s3", labels)
        self.assertNotIn("accent-text on s3", labels)
        self.assertIn("focus ring on s3 (UI 3:1)", labels)
        self.assertNotIn("border-strong on s3 (control edge, UI 3:1)", labels)
        for st in c.STATUS:
            self.assertIn(f"{st} text/glyph on s1", labels)
            self.assertIn(f"{st} text on its tint over s2", labels)


class MainTests(unittest.TestCase):
    def test_shipped_palette_passes_every_pair(self):
        code, out = run_main()
        self.assertIsNone(code)
        self.assertIn("ALL PAIRS PASS", out)
        self.assertNotIn("FAILS:", out)
        self.assertNotIn("| FAIL |", out)
        self.assertIn("### Dark", out)
        self.assertIn("### Light", out)
        self.assertEqual(out.count("| pass |"), 100)

    def test_table_row_format(self):
        _, out = run_main()
        self.assertIn("| Pair | fg | bg | ratio | need | result |", out)
        self.assertIn("| text on bg | #e6edf0 | #0c1215 |", out)

    def test_failing_pair_exits_one_and_lists_failure(self):
        bad = dict(c.DARK, text="#0c1215")  # text identical to bg -> ratio 1.00
        with mock.patch.object(c, "DARK", bad):
            code, out = run_main()
        self.assertEqual(code, 1)
        self.assertIn("FAILS:", out)
        self.assertIn("('Dark', 'text on bg', 1.0, 4.5)", out)
        self.assertIn("| FAIL |", out)
        self.assertNotIn("ALL PAIRS PASS", out)

    def test_light_failure_is_attributed_to_light(self):
        bad = dict(c.LIGHT, focus="#ffffff")
        with mock.patch.object(c, "LIGHT", bad):
            code, out = run_main()
        self.assertEqual(code, 1)
        self.assertIn("'Light', 'focus ring on s1 (UI 3:1)'", out)

    def test_exactly_at_threshold_passes(self):
        # ratio >= need is inclusive
        with mock.patch.object(c, "ratio", return_value=4.5), mock.patch.object(
            c, "pairs", return_value=[("p", (0, 0, 0), (0, 0, 0), 4.5)]
        ):
            code, out = run_main()
        self.assertIsNone(code)
        self.assertIn("ALL PAIRS PASS", out)


if __name__ == "__main__":
    unittest.main()
