"""Screenplay construction: planner prompts, normalization, validation."""
from __future__ import annotations

from typing import Any

SYSTEM_PROMPT_AR = """أنت مخرج سينمائي وكاتب سيناريو محترف. حوّل فكرة المستخدم إلى خطة فيلم مترابطة بصيغة JSON فقط.
البنية المطلوبة تمامًا:
{
  "title": "عنوان الفيلم",
  "logline": "سطر واحد",
  "synopsis": "ملخص",
  "style_notes": "ملاحظات الأسلوب البصري",
  "characters": [{"name":"", "role":"", "appearance":"", "personality":"", "palette":{"primary":"#hex","accent":"#hex"}, "voice":{"gender":"","pitch":1.0,"speed":1.0}}],
  "scenes": [{"index":1, "title":"", "summary":"", "environment":"", "lighting":"", "mood":"", "narration":"", "dialogue":[{"character":"","text":""}], "shots":[{"index":1,"description":"","camera":"","motion":"","duration_sec":6.0}], "duration_sec":8.0}]
}
قواعد: المشاهد مترابطة (بداية/تصاعد/ذروة/نهاية)، مجموع duration_sec يساوي المدة المطلوبة تقريبًا، كل مشهد له لقطات، الحوارات قصيرة. لا تخرج عن JSON."""

SYSTEM_PROMPT_EN = """You are a professional film director and screenwriter. Convert the user's idea into a coherent film plan as JSON only.
Exact structure:
{
  "title": "", "logline": "", "synopsis": "", "style_notes": "",
  "characters": [{"name":"","role":"","appearance":"","personality":"","palette":{"primary":"#hex","accent":"#hex"},"voice":{"gender":"","pitch":1.0,"speed":1.0}}],
  "scenes": [{"index":1,"title":"","summary":"","environment":"","lighting":"","mood":"","narration":"","dialogue":[{"character":"","text":""}],"shots":[{"index":1,"description":"","camera":"","motion":"","duration_sec":6.0}],"duration_sec":8.0}]
}
Rules: scenes form a coherent arc (setup/rising/climax/resolution); shot durations sum near the target; short dialogue; JSON only."""


def build_planner_prompt(
    *,
    idea: str,
    language: str,
    genre: str,
    visual_style: str,
    duration_sec: int,
    aspect: str,
    voice_style: str,
    music_mood: str,
    ending: str = "",
    tone: str = "",
) -> tuple[str, str]:
    system = SYSTEM_PROMPT_AR if language == "ar" else SYSTEM_PROMPT_EN
    user = (
        f"language: {language}\n"
        f"genre: {genre}\n"
        f"visual_style: {visual_style}\n"
        f"duration_sec: {duration_sec}\n"
        f"aspect: {aspect}\n"
        f"voice_style: {voice_style}\n"
        f"music_mood: {music_mood}\n"
        f"ending: {ending}\n"
        f"tone: {tone}\n"
        f"title: \n"
        f"idea: {idea}\n"
    )
    return system, user


def normalize_screenplay(raw: dict[str, Any], *, duration_sec: int, language: str) -> dict[str, Any]:
    """Fill missing fields, clamp durations to the target, fix indexes."""
    raw = dict(raw or {})
    scenes_raw = raw.get("scenes") or []
    if not scenes_raw:
        raise ValueError("screenplay has no scenes")
    scenes: list[dict[str, Any]] = []
    total = 0.0
    for i, s in enumerate(scenes_raw):
        shots = []
        s_dur = float(s.get("duration_sec") or 0) or max(4.0, duration_sec / len(scenes_raw))
        shot_list = s.get("shots") or []
        if not shot_list:
            shot_list = [{"index": 1, "description": s.get("summary", ""), "camera": "", "motion": "", "duration_sec": s_dur}]
        shot_total = sum(float(sh.get("duration_sec") or 0) for sh in shot_list) or s_dur
        for j, sh in enumerate(shot_list):
            shots.append(
                {
                    "index": j + 1,
                    "description": str(sh.get("description") or s.get("summary") or ""),
                    "camera": str(sh.get("camera") or ""),
                    "motion": str(sh.get("motion") or ""),
                    "duration_sec": round(float(sh.get("duration_sec") or s_dur / len(shot_list)) * (s_dur / shot_total), 2),
                }
            )
        dialogue = [
            {"character": str(d.get("character", "")), "text": str(d.get("text", ""))}
            for d in (s.get("dialogue") or [])
            if str(d.get("text", "")).strip()
        ]
        scenes.append(
            {
                "index": i + 1,
                "title": str(s.get("title") or f"مشهد {i + 1}" if language == "ar" else f"Scene {i + 1}"),
                "summary": str(s.get("summary") or ""),
                "environment": str(s.get("environment") or ""),
                "lighting": str(s.get("lighting") or ""),
                "mood": str(s.get("mood") or ""),
                "narration": str(s.get("narration") or ""),
                "dialogue": dialogue,
                "shots": shots,
                "duration_sec": round(s_dur, 2),
            }
        )
        total += s_dur

    # rescale scene durations to match the project target exactly
    if total > 0 and abs(total - duration_sec) > 0.5:
        factor = duration_sec / total
        for s in scenes:
            s["duration_sec"] = round(s["duration_sec"] * factor, 2)
            for sh in s["shots"]:
                sh["duration_sec"] = round(sh["duration_sec"] * factor, 2)

    characters = raw.get("characters") or []
    norm_chars = []
    for c in characters:
        norm_chars.append(
            {
                "name": str(c.get("name") or "Character"),
                "role": str(c.get("role") or ""),
                "appearance": str(c.get("appearance") or ""),
                "personality": str(c.get("personality") or ""),
                "palette": c.get("palette") or {"primary": "#2b4c7e", "accent": "#f4b860"},
                "voice": c.get("voice") or {"gender": "neutral", "pitch": 1.0, "speed": 1.0},
            }
        )

    return {
        "title": str(raw.get("title") or "Untitled" if language == "en" else raw.get("title") or "فيلم بدون عنوان"),
        "logline": str(raw.get("logline") or ""),
        "synopsis": str(raw.get("synopsis") or ""),
        "style_notes": str(raw.get("style_notes") or ""),
        "language": language,
        "engine": raw.get("engine", "llm"),
        "characters": norm_chars,
        "scenes": scenes,
    }


def screenplay_as_text(screenplay: dict[str, Any]) -> str:
    """Readable script text (used for downloads & TTS)."""
    lines = [screenplay.get("title", ""), "", screenplay.get("logline", ""), ""]
    for s in screenplay.get("scenes", []):
        lines.append(f"━━ {s['index']}. {s['title']} ━━")
        if s.get("environment"):
            lines.append(f"[{s['environment']}]")
        if s.get("narration"):
            lines.append(f"({s['narration']})")
        for d in s.get("dialogue", []):
            lines.append(f"{d['character']}: {d['text']}")
        lines.append("")
    return "\n".join(lines)


def scene_subtitle_lines(scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Build timed subtitle cues for a scene's narration + dialogue."""
    duration = float(scene.get("duration_sec") or 6)
    cues: list[dict[str, Any]] = []
    parts: list[str] = []
    if scene.get("narration"):
        parts.append(scene["narration"])
    for d in scene.get("dialogue") or []:
        t = d.get("text", "").strip()
        if t:
            parts.append(f"{d.get('character', '')}: {t}" if d.get("character") else t)
    if not parts:
        return cues
    total_chars = sum(len(p) for p in parts) or 1
    t = 0.0
    for p in parts:
        seg = max(1.5, duration * (len(p) / total_chars))
        cues.append({"start": round(t, 2), "end": round(min(t + seg, duration), 2), "text": p})
        t += seg
    return cues
