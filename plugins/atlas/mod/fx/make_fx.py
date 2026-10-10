#!/usr/bin/env python3
"""stdlib-only generator for atlas mod UI sound effects (16-bit mono 22.05kHz WAVs)."""

import math
import os
import struct
import wave

RATE = 22050
OUT = os.path.dirname(os.path.abspath(__file__))


def synth(name, ms, tone):
    """Generate one WAV; guarded so a bad tone function fails loudly, not silently."""
    try:
        total = ms / 1000.0
        n = int(RATE * total)
        frames = bytearray()
        for i in range(n):
            t = i / RATE
            s = max(-1.0, min(1.0, tone(t, total)))
            fade = total - t
            if fade < 0.01:
                s *= max(0.0, fade) / 0.01
            frames += struct.pack("<h", int(s * 32767))
        with wave.open(os.path.join(OUT, name), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(bytes(frames))
    except Exception as e:
        raise RuntimeError(f"synth({name!r}, {ms}ms) failed: {e}") from e


def spawn(t, total):
    f = 600 + 300 * min(1.0, t / total)
    return 0.8 * math.sin(2 * math.pi * f * t)


def done(t, total):
    env = math.exp(-3 * t)
    s = math.sin(2 * math.pi * 660 * t) + math.sin(2 * math.pi * 880 * t)
    return 0.6 * env * s


def fail(t, total):
    return 0.9 * math.exp(-4 * t) * math.sin(2 * math.pi * 110 * t)


def advance(t, total):
    freqs = (400, 500, 625, 781)
    step = total / len(freqs)
    idx = t // step
    if idx >= len(freqs):
        idx = len(freqs) - 1
    local = t - idx * step
    env = math.exp(-2 * local)
    return 0.8 * env * math.sin(2 * math.pi * freqs[idx] * local)


if __name__ == "__main__":
    for fn in (spawn, done, fail, advance):
        ms = {spawn: 120, done: 300, fail: 250, advance: 400}[fn]
        synth(fn.__name__ + ".wav", ms, fn)
    print("generated 4 wavs in", OUT)
