"""Transparent cost estimation (prices editable in Settings)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from . import appsettings


def estimate(
    db: Session,
    *,
    duration_sec: int,
    resolution: str,
    image_provider: str,
    video_provider: str,
    tts_provider: str,
    llm_provider: str = "local",
    include_audio: bool = True,
    n_scenes: int | None = None,
) -> dict[str, Any]:
    if n_scenes is None:
        n_scenes = max(3, min(12, round(duration_sec / 15)))
    shots_per_scene = 2
    n_images = n_scenes + 2  # scenes + title/end cards
    n_clips = n_scenes * shots_per_scene
    tts_chars = duration_sec * 12  # rough narration chars

    price_image = float(appsettings.get_value(db, "price_image", 0.04))
    price_video_sec = float(appsettings.get_value(db, "price_video_second", 0.05))
    price_tts = float(appsettings.get_value(db, "price_tts_1k_chars", 0.015))
    price_llm = float(appsettings.get_value(db, "price_llm_1k_tokens", 0.001))

    image_cost = 0.0 if image_provider == "local" else n_images * price_image
    # remote clips are capped at 10 s each; bill per generated clip-second
    clip_seconds = sum(min(10, max(5, duration_sec / n_scenes * shots_per_scene)) for _ in range(n_clips)) if video_provider != "local" else 0
    video_cost = clip_seconds * price_video_sec
    tts_cost = 0.0
    if include_audio and tts_provider != "local":
        tts_cost = (tts_chars / 1000.0) * price_tts
    llm_cost = 0.0
    if llm_provider != "local":
        llm_cost = (duration_sec * 25 / 1000.0) * price_llm  # ~25 tokens per second of plan

    total = round(image_cost + video_cost + tts_cost + llm_cost, 4)
    return {
        "currency": "USD",
        "breakdown": {
            "llm_script": round(llm_cost, 4),
            "images": round(image_cost, 4),
            "video": round(video_cost, 4),
            "tts": round(tts_cost, 4),
        },
        "units": {
            "n_scenes": n_scenes,
            "n_images": n_images,
            "n_clips": n_clips,
            "clip_seconds": int(clip_seconds),
            "tts_chars": int(tts_chars),
        },
        "total": total,
        "note": "تقدير تقريبي — الأسعار قابلة للتعديل في الإعدادات. المحركات المحلية مجانية.",
    }
