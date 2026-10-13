"""Local TTS: espeak-ng when installed, otherwise a real silent track.

The silent track keeps exact narration timing so subtitles/animatic stay
synced — labelled honestly in the project manifest as silent narration."""
from __future__ import annotations

import asyncio
import math
import shutil
import struct
import wave
from pathlib import Path

from .base import Capability, GenerationResult, TTSProvider

# rough speaking rates (chars/sec) used to estimate duration when silent
RATE = {"ar": 11.0, "en": 14.0}


class LocalTTSProvider(TTSProvider):
    name = "local"

    async def synthesize(
        self,
        text: str,
        out_path: Path,
        *,
        language: str = "ar",
        voice: dict | None = None,
    ) -> GenerationResult:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        espeak = shutil.which("espeak-ng") or shutil.which("espeak")
        if espeak:
            voice_name = (voice or {}).get("espeak", "ar" if language == "ar" else "en")
            speed = int(150 * float((voice or {}).get("speed", 1.0)))
            proc = await asyncio.create_subprocess_exec(
                espeak, "-v", voice_name, "-s", str(speed), "-w", str(out_path), text,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 100:
                return GenerationResult(path=out_path, meta={"engine": "espeak-ng", "silent": False})

        # fallback: timed silence with a faint room tone so players show duration
        chars = max(len(text.strip()), 1)
        duration = max(1.2, chars / RATE.get(language, 12.0))
        self._write_silence(out_path, duration)
        return GenerationResult(
            path=out_path,
            meta={"engine": "local-silence", "silent": True, "duration_sec": round(duration, 2)},
        )

    @staticmethod
    def _write_silence(path: Path, duration_sec: float, sample_rate: int = 22050) -> None:
        n = int(duration_sec * sample_rate)
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            # very low-level dither instead of pure zeros (avoids player glitches)
            frames = bytearray()
            for i in range(n):
                v = int(20 * math.sin(i * 0.001))
                frames += struct.pack("<h", v)
            w.writeframes(bytes(frames))

    async def test_connection(self) -> Capability:
        espeak = bool(shutil.which("espeak-ng") or shutil.which("espeak"))
        return Capability(
            name=self.name,
            label="الصوت المحلي / Local TTS",
            kind="tts",
            configured=True,
            details={
                "engine": "espeak-ng" if espeak else "silent-track",
                "languages": ["ar", "en"],
                "note": (
                    "يستخدم espeak-ng المتوفر محليًا."
                    if espeak
                    else "لا يوجد مُحوّل كلام محلي — تُضبط مدة النطق بدقة مع ترجمة نصية. اربط OpenAI TTS أو ElevenLabs لأصوات حقيقية."
                ),
            },
        )
