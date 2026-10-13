"""Local deterministic screenplay planner.

Real structured planning without any external LLM: splits the user's idea
into a coherent three-act film plan. Clearly labelled in the UI as
"local planner" so nobody mistakes it for a generative model."""
from __future__ import annotations

import re
from typing import Any

from .base import Capability, LLMProvider

GENRE_PROFILES: dict[str, dict[str, Any]] = {
    "adventure": {
        "ar": {"moods": ["حماس", "اكتشاف", "دهشة", "شجاعة"], "envs": ["جبال", "وادٍ مخفي", "ممر صخري", "مدينة قديمة"]},
        "en": {"moods": ["excitement", "discovery", "wonder", "courage"], "envs": ["mountains", "hidden valley", "cliff path", "ancient city"]},
    },
    "fantasy": {
        "ar": {"moods": ["سحر", "غموض", "بهاء", "أسطورة"], "envs": ["غابة مسحورة", "قلعة عائمة", "سماء النجوم", "بحيرة الضوء"]},
        "en": {"moods": ["magic", "mystery", "splendor", "legend"], "envs": ["enchanted forest", "floating castle", "star sky", "lake of light"]},
    },
    "historical": {
        "ar": {"moods": ["فخر", "حنين", "وقار", "مصير"], "envs": ["سوق قديم", "قلعة ترابية", "قافلة صحراوية", "مكتبة عتيقة"]},
        "en": {"moods": ["pride", "nostalgia", "dignity", "fate"], "envs": ["old market", "mud fortress", "desert caravan", "ancient library"]},
    },
    "drama": {
        "ar": {"moods": ["شجن", "أمل", "ترابط", "لم شمل"], "envs": ["بيت متواضع", "شارع ممطر", "ساحة مدينة", "شاطئ عند الغروب"]},
        "en": {"moods": ["poignancy", "hope", "bond", "reunion"], "envs": ["humble home", "rainy street", "city square", "sunset beach"]},
    },
    "comedy": {
        "ar": {"moods": ["مرح", "خفة", "طاقة", "مفاجأة"], "envs": ["حي نابض", "مطبخ فوضوي", "حديقة", "مهرجان"]},
        "en": {"moods": ["fun", "lighthearted", "energy", "surprise"], "envs": ["lively neighborhood", "chaotic kitchen", "garden", "festival"]},
    },
    "family": {
        "ar": {"moods": ["دفء", "براءة", "مغامرة", "محبة"], "envs": ["قرية هادئة", "غابة مشرقة", "مدينة مضيئة", "بيت الجدة"]},
        "en": {"moods": ["warmth", "innocence", "adventure", "love"], "envs": ["quiet village", "bright forest", "glowing city", "grandma's house"]},
    },
    "documentary": {
        "ar": {"moods": ["معرفة", "تأمل", "واقعية", "إلهام"], "envs": ["مختبر", "مصنع", "طبيعة", "مدينة"]},
        "en": {"moods": ["knowledge", "contemplation", "realism", "inspiration"], "envs": ["laboratory", "factory", "nature", "city"]},
    },
    "educational": {
        "ar": {"moods": ["وضوح", "فضول", "فهم", "ثقة"], "envs": ["فصل دراسي", "مختبر", "مكتبة", "فضاء"]},
        "en": {"moods": ["clarity", "curiosity", "understanding", "confidence"], "envs": ["classroom", "laboratory", "library", "space"]},
    },
    "scifi": {
        "ar": {"moods": ["دهشة", "غموض", "مستقبل", "تحدي"], "envs": ["محطة فضائية", "مدينة مستقبلية", "كوكب بعيد", "مختبر ذكاء"]},
        "en": {"moods": ["wonder", "mystery", "future", "challenge"], "envs": ["space station", "future city", "distant planet", "AI lab"]},
    },
}

CAMERAS = [
    {"ar": "لقطة واسعة تأسيسية", "en": "wide establishing shot"},
    {"ar": "لقطة متوسطة", "en": "medium shot"},
    {"ar": "لقطة قريبة", "en": "close-up"},
    {"ar": "لقطة علوية", "en": "overhead shot"},
    {"ar": "لقطة تتبع حركة", "en": "tracking shot"},
    {"ar": "لقطة منخفضة ملحمية", "en": "low-angle hero shot"},
]

MOTIONS = [
    {"ar": "اقتراب بطيء (Dolly in)", "en": "slow dolly in"},
    {"ar": "انزلاق جانبي (Pan)", "en": "lateral pan"},
    {"ar": "تصعيد (Crane up)", "en": "crane up"},
    {"ar": "ثابت مع تحرك داخل الكادر", "en": "static with in-frame motion"},
    {"ar": "تبع الكاميرا (Tracking)", "en": "camera tracking"},
]

ACT_BEATS = [
    {"ar": "الافتتاحية: تعريف العالم والشخصية", "en": "opening: world and character"},
    {"ar": "ال inciting incident: الحدث المغيّر", "en": "inciting incident"},
    {"ar": "التصاعد: التحديات تكبر", "en": "rising action"},
    {"ar": "الذروة: المواجهة الحاسمة", "en": "climax: the decisive confrontation"},
    {"ar": "الحل: نهاية مرضية", "en": "resolution: a satisfying end"},
]


def _split_idea(text: str, parts: int) -> list[str]:
    """Split the user's idea into sentences/clauses distributed across scenes."""
    text = text.strip()
    sentences = [s.strip() for s in re.split(r"[.。!！?？؟\n؛;]+", text) if s.strip()]
    if not sentences:
        sentences = [text]
    out: list[str] = []
    for i in range(parts):
        out.append(sentences[i % len(sentences)])
    return out


class LocalPlanner(LLMProvider):
    name = "local"

    async def complete_json(self, system: str, user: str) -> dict:
        # `user` is expected to carry the structured request produced by
        # services.screenplay.build_planner_prompt().
        return plan_from_prompt(user)

    async def test_connection(self) -> Capability:
        return Capability(
            name=self.name,
            label="المخطط المحلي (بدون LLM) / Local planner",
            kind="llm",
            configured=True,
            details={
                "note": "يعمل دائمًا بدون إنترنت؛ للسيناريو الإبداعي اضبط مزود LLM (OpenAI أو متوافق).",
                "note_en": "Always works offline; configure an LLM provider for creative screenplays.",
            },
        )


def plan_from_prompt(user_text: str) -> dict:
    """Deterministic plan extracted from the planner request text."""
    meta: dict[str, str] = {}
    for line in user_text.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip().lower()] = v.strip()

    language = meta.get("language", "ar")
    genre = meta.get("genre", "adventure")
    style = meta.get("visual_style", "cinematic_3d")
    try:
        duration = float(meta.get("duration_sec", "60"))
    except ValueError:
        duration = 60.0
    idea = meta.get("idea", user_text)
    ending = meta.get("ending", "")
    tone = meta.get("tone", "")

    profile = GENRE_PROFILES.get(genre, GENRE_PROFILES["adventure"])
    langs = profile.get(language, profile["ar"])
    moods, envs = langs["moods"], langs["envs"]

    # scene budget: ~12-20 s per scene, min 3, max 12 for up to 5 minutes
    n_scenes = max(3, min(12, round(duration / 15)))
    per_scene = round(duration / n_scenes, 1)

    idea_parts = _split_idea(idea, n_scenes)
    chars = _extract_characters(idea, language)

    scenes = []
    for i in range(n_scenes):
        beat = ACT_BEATS[min(i, len(ACT_BEATS) - 1)]
        cam = CAMERAS[i % len(CAMERAS)]
        motion = MOTIONS[i % len(MOTIONS)]
        env = envs[i % len(envs)]
        mood = moods[i % len(moods)]
        title = f"المشهد {i + 1}: {beat[language if language in beat else 'ar']}" if language == "ar" else f"Scene {i + 1}: {beat['en']}"
        narration = idea_parts[i]
        if ending and i == n_scenes - 1:
            narration = f"{narration} — {ending}"
        shots = []
        shot_count = 2 if per_scene >= 10 else 1
        for s in range(shot_count):
            shots.append(
                {
                    "index": s + 1,
                    "description": narration,
                    "camera": cam[language if language in cam else "ar"],
                    "motion": motion[language if language in motion else "ar"],
                    "duration_sec": round(per_scene / shot_count, 1),
                }
            )
        scenes.append(
            {
                "index": i + 1,
                "title": title,
                "summary": narration,
                "environment": env,
                "lighting": "إضاءة سينمائية متدرجة" if language == "ar" else "cinematic gradient lighting",
                "mood": mood,
                "narration": narration,
                "dialogue": [],
                "shots": shots,
                "duration_sec": per_scene,
            }
        )

    title = meta.get("title") or (
        (idea[:48] + "…") if len(idea) > 48 else idea
    )
    return {
        "title": title,
        "logline": idea,
        "synopsis": idea,
        "style_notes": f"{style}; {tone}".strip("; "),
        "language": language,
        "engine": "local-planner",
        "characters": chars,
        "scenes": scenes,
    }


_NAME_RE = re.compile(
    r"(طفل|طفلة|فتاة|فتى|رجل|امرأة|شخص|بطل|بطلة|queen|king|boy|girl|child|man|woman|hero|robot|dragon)",
    re.IGNORECASE,
)


def _extract_characters(idea: str, language: str) -> list[dict[str, Any]]:
    names_ar = {
        "طفل": "الطفل",
        "طفلة": "الطفلة",
        "فتى": "الفتى",
        "فتاة": "الفتاة",
        "رجل": "الرجل",
        "امرأة": "المرأة",
        "بطل": "البطل",
        "بطلة": "البطلة",
    }
    names_en = {
        "boy": "The Boy",
        "girl": "The Girl",
        "child": "The Child",
        "man": "The Man",
        "woman": "The Woman",
        "hero": "The Hero",
        "queen": "The Queen",
        "king": "The King",
        "robot": "The Robot",
        "dragon": "The Dragon",
    }
    found: list[dict[str, Any]] = []
    for m in _NAME_RE.finditer(idea):
        token = m.group(0).lower() if language == "en" else m.group(0)
        if language == "en":
            label = names_en.get(token, m.group(0))
        else:
            label = names_ar.get(token, m.group(0))
        if any(c["name"] == label for c in found):
            continue
        found.append(
            {
                "name": label,
                "role": "الشخصية الرئيسية" if language == "ar" else "Main character",
                "appearance": idea[:160],
                "personality": "شجاع ومحب للاكتشاف" if language == "ar" else "Brave and curious",
                "palette": {"primary": "#2b4c7e", "accent": "#f4b860"},
                "voice": {"gender": "neutral", "pitch": 1.0, "speed": 1.0},
            }
        )
        if len(found) >= 4:
            break
    if not found:
        found.append(
            {
                "name": "البطل" if language == "ar" else "The Hero",
                "role": "الشخصية الرئيسية" if language == "ar" else "Main character",
                "appearance": idea[:160],
                "personality": "شجاع ومحب للاكتشاف" if language == "ar" else "Brave and curious",
                "palette": {"primary": "#2b4c7e", "accent": "#f4b860"},
                "voice": {"gender": "neutral", "pitch": 1.0, "speed": 1.0},
            }
        )
    return found
