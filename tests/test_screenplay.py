"""Unit tests for the local screenplay planner and helpers."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.providers.llm_local import plan_from_prompt  # noqa: E402
from app.services.screenplay import normalize_screenplay, scene_subtitle_lines  # noqa: E402


def test_planner_builds_coherent_plan():
    raw = plan_from_prompt(
        "language: ar\ngenre: adventure\nduration_sec: 60\nidea: طفل يكتشف مدينة سحر\nending: نهاية سعيدة\n"
    )
    assert raw["scenes"]
    assert raw["characters"]
    total = sum(s["duration_sec"] for s in raw["scenes"])
    assert abs(total - 60) < 6


def test_normalize_rescales_to_target():
    raw = {"title": "t", "scenes": [{"duration_sec": 5}, {"duration_sec": 5}, {"duration_sec": 5}], "characters": []}
    out = normalize_screenplay(raw, duration_sec=60, language="ar")
    total = sum(s["duration_sec"] for s in out["scenes"])
    assert abs(total - 60) < 0.5
    assert all(s["shots"] for s in out["scenes"])


def test_subtitle_lines_covers_narration_and_dialogue():
    scene = {
        "duration_sec": 8.0,
        "narration": "كان هناك طفل صغير",
        "dialogue": [{"character": "الطفل", "text": "هل هذه المدينة حقيقية؟"}],
    }
    cues = scene_subtitle_lines(scene)
    assert len(cues) == 2
    assert cues[0]["start"] == 0.0
    assert cues[-1]["end"] <= 8.01
