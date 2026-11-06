"""Tests for make_fx.py: WAV synthesis (header, length, fade, clipping, error wrapping) and tone shapes."""

import importlib.util
import math
import os
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

_SRC = Path(__file__).resolve().parent / "make_fx.py"
_spec = importlib.util.spec_from_file_location("make_fx_under_test", _SRC)
mf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mf)


def _samples(path):
    with wave.open(str(path), "rb") as w:
        raw = w.readframes(w.getnframes())
        params = (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes())
    return params, struct.unpack("<%dh" % (len(raw) // 2), raw)


class SynthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.object(mf, "OUT", self.tmp.name)
        p.start()
        self.addCleanup(p.stop)

    def test_header_and_length(self):
        mf.synth("a.wav", 100, lambda t, total: 0.5)
        (ch, width, rate, n), _ = _samples(Path(self.tmp.name) / "a.wav")
        self.assertEqual((ch, width, rate), (1, 2, 22050))
        self.assertEqual(n, int(22050 * 0.1))

    def test_amplitude_scaled_to_int16(self):
        mf.synth("a.wav", 100, lambda t, total: 0.5)
        _, s = _samples(Path(self.tmp.name) / "a.wav")
        self.assertEqual(s[0], int(0.5 * 32767))

    def test_clipping_both_directions(self):
        mf.synth("hi.wav", 100, lambda t, total: 7.0)
        mf.synth("lo.wav", 100, lambda t, total: -7.0)
        _, hi = _samples(Path(self.tmp.name) / "hi.wav")
        _, lo = _samples(Path(self.tmp.name) / "lo.wav")
        self.assertEqual(hi[0], 32767)
        self.assertEqual(lo[0], -32767)

    def test_tail_fades_to_silence_and_body_is_untouched(self):
        mf.synth("a.wav", 100, lambda t, total: 1.0)
        _, s = _samples(Path(self.tmp.name) / "a.wav")
        self.assertEqual(s[1000], 32767)  # well before the 10 ms fade window
        self.assertLess(abs(s[-1]), 32767 // 4)  # last sample nearly silent
        fade_start = len(s) - int(22050 * 0.01)
        tail = [abs(x) for x in s[fade_start + 5 :]]
        self.assertEqual(tail, sorted(tail, reverse=True))  # monotone decay

    def test_tone_receives_time_and_total_seconds(self):
        seen = []
        mf.synth("a.wav", 200, lambda t, total: seen.append((t, total)) or 0.0)
        self.assertEqual(seen[0], (0.0, 0.2))
        self.assertAlmostEqual(seen[1][0], 1 / 22050)
        self.assertEqual(len(seen), int(22050 * 0.2))

    def test_failure_is_wrapped_with_name_and_duration(self):
        def boom(t, total):
            raise ValueError("bad tone")

        with self.assertRaises(RuntimeError) as cm:
            mf.synth("x.wav", 50, boom)
        msg = str(cm.exception)
        self.assertIn("'x.wav'", msg)
        self.assertIn("50ms", msg)
        self.assertIn("bad tone", msg)
        self.assertIsInstance(cm.exception.__cause__, ValueError)
        self.assertFalse((Path(self.tmp.name) / "x.wav").exists())


class ToneTests(unittest.TestCase):
    def test_spawn_sweeps_up_and_caps_frequency(self):
        self.assertEqual(mf.spawn(0.0, 0.12), 0.0)
        # past the end the frequency is clamped at 900 Hz
        t = 0.3
        self.assertAlmostEqual(mf.spawn(t, 0.12), 0.8 * math.sin(2 * math.pi * 900 * t))
        t = 0.06
        self.assertAlmostEqual(mf.spawn(t, 0.12), 0.8 * math.sin(2 * math.pi * 750 * t))

    def test_done_is_two_tone_decaying(self):
        t = 0.001
        expect = 0.6 * math.exp(-3 * t) * (math.sin(2 * math.pi * 660 * t) + math.sin(2 * math.pi * 880 * t))
        self.assertAlmostEqual(mf.done(t, 0.3), expect)
        self.assertLess(abs(mf.done(1.0, 0.3)), 0.6 * math.exp(-3) * 2 + 1e-9)

    def test_fail_is_low_decaying_sine(self):
        t = 0.002
        self.assertAlmostEqual(mf.fail(t, 0.25), 0.9 * math.exp(-4 * t) * math.sin(2 * math.pi * 110 * t))

    def test_advance_steps_through_four_notes(self):
        total = 0.4
        # at the start of each quarter the local time is 0 -> silence
        for k in range(4):
            self.assertAlmostEqual(mf.advance(k * 0.1 + 1e-12, total), 0.0, places=6)
        local = 0.01
        for k, f in enumerate((400, 500, 625, 781)):
            t = k * 0.1 + local
            expect = 0.8 * math.exp(-2 * local) * math.sin(2 * math.pi * f * local)
            self.assertAlmostEqual(mf.advance(t, total), expect, places=6)

    def test_advance_clamps_index_past_the_end(self):
        total = 0.4
        t = 0.45
        local = t - 3 * 0.1
        expect = 0.8 * math.exp(-2 * local) * math.sin(2 * math.pi * 781 * local)
        self.assertAlmostEqual(mf.advance(t, total), expect)

    def test_all_tones_stay_within_unit_range_over_their_duration(self):
        for fn, ms in ((mf.spawn, 120), (mf.done, 300), (mf.fail, 250), (mf.advance, 400)):
            total = ms / 1000
            peak = max(abs(fn(i / mf.RATE, total)) for i in range(int(mf.RATE * total)))
            self.assertLessEqual(peak, 1.2, fn.__name__)
            self.assertGreater(peak, 0.1, fn.__name__)


class MainTests(unittest.TestCase):
    def test_main_writes_four_named_wavs_with_expected_durations(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(mf, "OUT", d):
                # run the __main__ block against the patched module globals
                src = _SRC.read_text()
                block = src.split('if __name__ == "__main__":')[1]
                import textwrap

                code = textwrap.dedent(block)
                with mock.patch("builtins.print") as pr:
                    exec(compile(code, str(_SRC), "exec"), vars(mf))
                self.assertEqual(sorted(os.listdir(d)), ["advance.wav", "done.wav", "fail.wav", "spawn.wav"])
                for name, ms in (("spawn", 120), ("done", 300), ("fail", 250), ("advance", 400)):
                    (_, _, _, n), _ = _samples(Path(d) / (name + ".wav"))
                    self.assertEqual(n, int(22050 * ms / 1000), name)
                pr.assert_called_once_with("generated 4 wavs in", d)

    def test_committed_wavs_are_valid_mono_16bit(self):
        for name in ("spawn", "done", "fail", "advance"):
            (ch, width, rate, n), _ = _samples(_SRC.parent / (name + ".wav"))
            self.assertEqual((ch, width, rate), (1, 2, 22050), name)
            self.assertGreater(n, 0)


if __name__ == "__main__":
    unittest.main()
