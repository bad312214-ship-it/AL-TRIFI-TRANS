"""Local animatic video engine (real MP4 output via ffmpeg Ken-Burns).

Honest baseline: turns each generated still into a timed, moving clip.
Remote engines (Replicate / fal) drop in behind the same interface and
produce fully generative motion when their keys are configured."""
from __future__ import annotations

import asyncio
from pathlib import Path

from .. import config
from .base import Capability, GenerationResult, ProviderError, VideoProvider

MOTIONS = {
    "in": "z='min(1.0+{rate}*in,1.28)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "out": "z='max(1.28-{rate}*in,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "left": "z='1.12':x='(iw-iw/zoom)*({rate}*in/{frames})':y='ih/2-(ih/zoom/2)'",
    "right": "z='1.12':x='(iw-iw/zoom)*(1-{rate}*in/{frames})':y='ih/2-(ih/zoom/2)'",
    "up": "z='1.12':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-{rate}*in/{frames})'",
}


class LocalVideoProvider(VideoProvider):
    name = "local"

    async def generate(
        self,
        prompt: str,
        out_path: Path,
        *,
        duration_sec: float,
        size: tuple[int, int],
        fps: int = 24,
        image_path: Path | None = None,
        seed: int = 0,
    ) -> GenerationResult:
        if image_path is None or not Path(image_path).exists():
            raise ProviderError("local video engine needs a source still (image_path)")
        w, h = size
        frames = max(int(duration_sec * fps), fps)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        motion_key = ["in", "out", "left", "right", "up"][seed % 5]
        rate = 0.004 if motion_key in ("in", "out") else 1.0
        expr = MOTIONS[motion_key].format(rate=rate, frames=frames)

        vf = (
            f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
            f"crop={w * 2}:{h * 2},"
            f"zoompan={expr}:d={frames}:s={w}x{h}:fps={fps},"
            f"format=yuv420p"
        )
        cmd = [
            config.ffmpeg_exe(), "-y",
            "-i", str(image_path),
            "-vf", vf,
            "-frames:v", str(frames),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-an",
            str(out_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, err = await proc.communicate()
        if proc.returncode != 0 or not out_path.exists():
            raise ProviderError(f"ffmpeg animatic failed: {err.decode()[-400:]}")
        return GenerationResult(
            path=out_path,
            meta={"engine": "local-animatic", "motion": motion_key, "duration_sec": duration_sec, "fps": fps},
        )

    async def test_connection(self) -> Capability:
        return Capability(
            name=self.name,
            label="المحرك المحلي (Animatic حركي) / Local animatic engine",
            kind="video",
            configured=True,
            details={
                "max_clip_seconds": 60,
                "resolutions": ["720p", "1080p"],
                "fps": [24, 30],
                "note": "مقاطع حقيقية بحركة كاميرا فوق صور المشاهد — بدون مفاتيح API. للموليد التوليدي الكامل اربط Replicate أو fal.",
                "note_en": "Real moving clips over scene art, no keys needed. Connect Replicate/fal for fully generative video.",
            },
        )
