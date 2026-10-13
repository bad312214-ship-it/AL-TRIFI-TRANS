"""Procedural ambient score generator (real WAV via NumPy).

Chord pads + soft noise wash + slow LFO, mixed later under narration."""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from .base import Capability, GenerationResult, MusicProvider

MOODS = {
    "emotional": {"root": 220.0, "chords": [(0, 4, 7), (-3, 0, 4), (2, 5, 9), (0, 4, 7)], "brightness": 0.5},
    "epic": {"root": 174.6, "chords": [(0, 3, 7), (0, 3, 7), (-2, 2, 5), (0, 3, 7)], "brightness": 0.8},
    "mysterious": {"root": 146.8, "chords": [(0, 3, 6), (0, 3, 7), (-1, 2, 5), (0, 3, 6)], "brightness": 0.35},
    "happy": {"root": 261.6, "chords": [(0, 4, 7), (5, 9, 12), (2, 5, 9), (0, 4, 7)], "brightness": 0.9},
    "calm": {"root": 196.0, "chords": [(0, 4, 7), (0, 4, 9), (2, 5, 9), (0, 4, 7)], "brightness": 0.4},
    "tense": {"root": 155.6, "chords": [(0, 3, 7), (0, 3, 6), (-1, 2, 6), (0, 3, 7)], "brightness": 0.55},
}
ALIAS = {
    "مؤثر": "emotional", "مشوق": "epic", "غموض": "mysterious", "مرح": "happy", "هادئ": "calm", "توتر": "tense",
    "emotional": "emotional", "epic": "epic", "mysterious": "mysterious", "happy": "happy", "calm": "calm", "tense": "tense",
}


class LocalMusicProvider(MusicProvider):
    name = "local"

    async def generate(
        self, out_path: Path, *, mood: str = "emotional", duration_sec: float = 60.0
    ) -> GenerationResult:
        spec = MOODS[ALIAS.get(mood, "emotional")]
        sr = 44100
        duration_sec = min(max(duration_sec, 4.0), 360.0)
        n = int(sr * duration_sec)
        t = np.arange(n) / sr

        mix = np.zeros(n, dtype=np.float64)
        chord_dur = 6.0
        steps = int(np.ceil(duration_sec / chord_dur))
        for s in range(steps):
            chord = spec["chords"][s % len(spec["chords"])]
            start = int(s * chord_dur * sr)
            end = min(n, start + int(chord_dur * sr))
            seg = t[start:end] - t[start]
            env = np.minimum(seg / 1.2, 1.0) * np.minimum((chord_dur - seg) / 1.5, 1.0).clip(0, 1)
            for semi in chord:
                f = spec["root"] * (2 ** (semi / 12))
                for harmonic, amp in ((1.0, 1.0), (2.0, 0.32 * spec["brightness"]), (3.0, 0.12 * spec["brightness"])):
                    mix[start:end] += amp * env * np.sin(2 * np.pi * f * harmonic * seg)
        # slow shimmer LFO + airy noise
        mix *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.08 * t)
        rng = np.random.default_rng(7)
        noise = rng.normal(0, 0.012, n)
        kernel = np.ones(48) / 48
        mix += np.convolve(noise, kernel, mode="same")
        # fades
        fade = int(sr * 1.2)
        mix[:fade] *= np.linspace(0, 1, fade)
        mix[-fade:] *= np.linspace(1, 0, fade)
        mix /= max(np.abs(mix).max(), 1e-9)
        pcm = (mix * 0.32 * 32767).astype(np.int16)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm.tobytes())
        return GenerationResult(path=out_path, meta={"engine": "local-score", "mood": mood, "duration_sec": duration_sec})

    async def test_connection(self) -> Capability:
        return Capability(
            name=self.name,
            label="الموسيقى المحلية (توليد إجرائي) / Local procedural score",
            kind="music",
            configured=True,
            details={"moods": list(MOODS.keys()), "note": "موسيقى أجواء مولّدة محليًا بصيغة WAV."},
        )
