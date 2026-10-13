"""Production pipeline: idea → screenplay → assets → clips → audio → final film.

Every stage is idempotent and persisted, so a crashed render resumes where
it stopped instead of regenerating finished work."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from .. import config
from ..models import Character, Job, Project, Scene
from ..providers import (
    ProviderError,
    get_image,
    get_llm,
    get_music,
    get_tts,
    get_video,
)
from . import assembly, events, screenplay as sp
from .costs import estimate

TITLE_CARD_SEC = 3.0
END_CARD_SEC = 3.0


# ------------------------------------------------------------------ helpers
def project_dir(db: Session, project_id: str) -> Path:
    d = config.MEDIA_DIR / "projects" / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _save_project(db: Session, project: Project) -> None:
    db.add(project)
    db.commit()
    db.refresh(project)


async def _emit(project_id: str, **event: Any) -> None:
    await events.publish(project_id, {"ts": time.time(), **event})


async def _stage(
    db: Session,
    project: Project,
    stage: str,
    progress: float,
    message: str = "",
    *,
    status: str | None = None,
) -> None:
    project.stage = stage
    project.progress = round(max(0.0, min(1.0, progress)), 4)
    if status:
        project.status = status
    _save_project(db, project)
    await _emit(project.id, type="stage", stage=stage, progress=project.progress, message=message, status=project.status)


def _add_warning(project: Project, warning: str) -> None:
    warnings = list(project.warnings or [])
    if warning not in warnings:
        warnings.append(warning)
        project.warnings = warnings


def _size(project: Project) -> tuple[int, int]:
    return assembly.resolution_size(project.resolution, project.aspect)


def scene_to_dict(scene: Scene) -> dict[str, Any]:
    return {
        "idx": scene.idx,
        "title": scene.title,
        "summary": scene.summary,
        "environment": scene.environment,
        "lighting": scene.lighting,
        "mood": scene.mood,
        "narration": scene.narration,
        "dialogue": scene.dialogue or [],
        "shots": scene.shots or [],
        "duration_sec": float(scene.duration_sec),
    }


# ------------------------------------------------------------------ plan
async def run_plan(db: Session, project_id: str, payload: dict | None = None) -> dict:
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("project not found")
    if not project.prompt.strip():
        raise ValueError("project has no prompt/idea")

    await _stage(db, project, "planning", 0.15, "تحليل الفكرة وكتابة السيناريو", status="planning")
    system, user = sp.build_planner_prompt(
        idea=project.prompt,
        language=project.language,
        genre=project.genre,
        visual_style=project.visual_style,
        duration_sec=project.duration_sec,
        aspect=project.aspect,
        voice_style=project.voice_style,
        music_mood=project.music_mood,
        ending=(payload or {}).get("ending", ""),
        tone=(payload or {}).get("tone", ""),
    )

    engine_name = project.llm_provider or "local"
    llm = get_llm(engine_name, db)
    raw: dict | None = None
    used_engine = engine_name
    try:
        raw = await llm.complete_json(system, user)
    except ProviderError as exc:
        if engine_name == "local":
            raise
        _add_warning(project, f"تعذّر الاتصال بمزود LLM ({engine_name}): {str(exc)[:160]} — تم استخدام المخطط المحلي.")
        llm = get_llm("local")
        raw = await llm.complete_json(system, user)
        used_engine = "local-fallback"

    plan = sp.normalize_screenplay(raw, duration_sec=project.duration_sec, language=project.language)
    plan["engine"] = used_engine

    # persist screenplay + rebuild scenes/characters
    project.screenplay = plan
    if plan.get("title"):
        project.title = plan["title"][:255]
    db.query(Scene).filter(Scene.project_id == project.id).delete()
    db.query(Character).filter(Character.project_id == project.id).delete()
    for c in plan.get("characters", []):
        db.add(Character(project_id=project.id, **c))
    for s in plan["scenes"]:
        db.add(
            Scene(
                project_id=project.id,
                idx=s["index"],
                title=s["title"],
                summary=s["summary"],
                environment=s["environment"],
                lighting=s["lighting"],
                mood=s["mood"],
                narration=s["narration"],
                dialogue=s["dialogue"],
                shots=s["shots"],
                duration_sec=s["duration_sec"],
                status="pending",
            )
        )
    project.cost_estimate = estimate(
        db,
        duration_sec=project.duration_sec,
        resolution=project.resolution,
        llm_provider=project.llm_provider,
        image_provider=project.image_provider,
        video_provider=project.video_provider,
        tts_provider=project.tts_provider,
        include_audio=True,
        n_scenes=len(plan["scenes"]),
    )
    project.error = ""
    await _stage(db, project, "planned", 1.0, "اكتمل السيناريو — جاهز للمراجعة قبل التوليد", status="planned")
    return {"scenes": len(plan["scenes"]), "engine": used_engine}


# ------------------------------------------------------------------ render
async def run_render(db: Session, project_id: str, payload: dict | None = None) -> dict:
    payload = payload or {}
    only_scenes: set[int] | None = None
    if payload.get("regenerate_scenes"):
        only_scenes = set(payload["regenerate_scenes"])

    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("project not found")
    if not project.screenplay:
        raise ValueError("لا يوجد سيناريو — اكتب السيناريو أولًا")

    project.status = "rendering"
    project.error = ""
    _save_project(db, project)

    include_audio = bool(payload.get("include_audio", True))
    subtitles_on = project.subtitles if payload.get("include_subtitles") is None else bool(payload["include_subtitles"])
    cards_on = project.title_cards if payload.get("include_title_cards") is None else bool(payload["include_title_cards"])
    seed = int(payload.get("variant_seed") or int(time.time()) % 100000)

    base = project_dir(db, project_id)
    for sub in ("characters", "scenes", "clips", "audio", "final", "subs"):
        (base / sub).mkdir(exist_ok=True)

    scenes: list[Scene] = (
        db.query(Scene).filter(Scene.project_id == project.id).order_by(Scene.idx).all()
    )
    if not scenes:
        raise ValueError("لا توجد مشاهد")
    size = _size(project)
    fps = project.fps

    # ---------------------------------------------------------- characters
    await _stage(db, project, "characters", 0.03, "تثبيت هوية الشخصيات", status="rendering")
    characters: list[Character] = (
        db.query(Character).filter(Character.project_id == project.id).all()
    )
    char_desc = ""
    for i, ch in enumerate(characters):
        if not ch.image_path or only_scenes is None:
            out = base / "characters" / f"{i:02d}.png"
            try:
                if project.image_provider == "local":
                    from ..providers.image_local import render_character_sheet

                    render_character_sheet(
                        out,
                        name=ch.name,
                        appearance=ch.appearance,
                        palette=ch.palette,
                        seed=seed + i * 17,
                    )
                else:
                    img = get_image(project.image_provider)
                    res = await img.generate(
                        f"character reference sheet, full body, neutral background, "
                        f"{ch.appearance}, consistent design, cinematic lighting",
                        out,
                        size=(768, 1024),
                        seed=seed + i * 17,
                    )
                    out = res.path
                ch.image_path = str(out.relative_to(config.MEDIA_DIR))
                db.add(ch)
            except ProviderError as exc:
                _add_warning(project, f"تعذّر توليد صورة الشخصية {ch.name}: {str(exc)[:120]}")
        char_desc += f"- {ch.name}: {ch.appearance}\n"
    db.commit()

    # ---------------------------------------------------------- environments
    await _stage(db, project, "environments", 0.10, "بناء بيئات المشاهد وإضاءتها", status="rendering")
    img_provider = get_image(project.image_provider)
    for scene in scenes:
        if only_scenes is not None and scene.idx not in only_scenes and scene.image_path:
            continue
        out = base / "scenes" / f"{scene.idx:02d}_v{scene.variant_index}.png"
        prompt = (
            f"{scene.environment}. {scene.lighting}. mood: {scene.mood}. "
            f"style: {project.visual_style}, cinematic composition, film still, {sp.screenplay_as_text(project.screenplay)[:0]}"
            f"characters: {char_desc}"
        )
        try:
            if project.image_provider == "local":
                from ..providers.image_local import render_scene_still

                render_scene_still(
                    out,
                    size=size,
                    seed=seed + scene.idx * 101,
                    mood=scene.mood,
                    environment=scene.environment,
                    lighting=scene.lighting,
                    style=project.visual_style,
                    figure=bool(characters),
                )
            else:
                res = await img_provider.generate(prompt, out, size=size, seed=seed + scene.idx * 101)
                out = res.path
            scene.image_path = str(out.relative_to(config.MEDIA_DIR))
            scene.status = "imaged"
            db.add(scene)
            db.commit()
            await _emit(project.id, type="scene", index=scene.idx, status="imaged")
        except ProviderError as exc:
            scene.status = "failed"
            scene.error = str(exc)[:300]
            db.add(scene)
            db.commit()
            _add_warning(project, f"مشهد {scene.idx}: فشل توليد الصورة — {str(exc)[:120]}")
            raise
        await _stage(db, project, "environments", 0.10 + 0.25 * scene.idx / len(scenes), "", status="rendering")

    # ---------------------------------------------------------- shots (video)
    await _stage(db, project, "shots", 0.38, "توليد لقطات الفيديو", status="rendering")
    video_provider = get_video(project.video_provider)
    for scene in scenes:
        scene_needed = only_scenes is None or scene.idx in only_scenes or not scene.clip_path
        if not scene_needed:
            continue
        shot_clips: list[Path] = []
        shots = scene.shots or [{"index": 1, "description": scene.summary, "duration_sec": scene.duration_sec}]
        for j, shot in enumerate(shots):
            clip = base / "clips" / f"s{scene.idx:02d}_v{scene.variant_index}_shot{j + 1}.mp4"
            still = config.MEDIA_DIR / scene.image_path
            shot_dur = float(shot.get("duration_sec") or scene.duration_sec / len(shots))
            prompt = (
                f"{shot.get('description') or scene.summary}. camera: {shot.get('camera', '')}, "
                f"{shot.get('motion', '')}. style: {project.visual_style}. {scene.environment}. "
                f"cinematic, consistent characters: {char_desc}"
            )
            try:
                if project.video_provider == "local":
                    res = await video_provider.generate(
                        prompt, clip, duration_sec=shot_dur, size=size, fps=fps,
                        image_path=still, seed=seed + scene.idx * 31 + j,
                    )
                else:
                    res = await video_provider.generate(
                        prompt, clip, duration_sec=shot_dur, size=size, fps=fps,
                        image_path=still, seed=seed + scene.idx * 31 + j,
                    )
                shot_clips.append(Path(res.path))
            except ProviderError as exc:
                _add_warning(project, f"مشهد {scene.idx} لقطة {j + 1}: فشل توليد الفيديو ({str(exc)[:100]}) — استُخدمت نسخة الحركة المحلية.")
                # honest fallback: animatic from the still so the film stays complete
                res = await get_video("local").generate(
                    prompt, clip, duration_sec=shot_dur, size=size, fps=fps,
                    image_path=still, seed=seed + scene.idx * 31 + j,
                )
                shot_clips.append(Path(res.path))

        if len(shot_clips) == 1:
            scene_clip_raw = shot_clips[0]
        else:
            scene_clip_raw = base / "clips" / f"s{scene.idx:02d}_v{scene.variant_index}_raw.mp4"
            await assembly.concat_clips(shot_clips, scene_clip_raw, reencode=True)

        # polish: subtitles + fades, exact scene duration
        scene_master = base / "clips" / f"s{scene.idx:02d}_v{scene.variant_index}.mp4"
        sub_pngs: list[tuple[Path, float, float]] = []
        if subtitles_on:
            for k, cue in enumerate(sp.scene_subtitle_lines(scene_to_dict(scene))):
                png = base / "subs" / f"s{scene.idx:02d}_c{k}.png"
                assembly.render_subtitle_png(cue["text"], png, size)
                sub_pngs.append((png, cue["start"], cue["end"]))
        await assembly.polish_clip(
            Path(scene_clip_raw), scene_master,
            duration_sec=float(scene.duration_sec), size=size, fps=fps,
            subtitle_pngs=sub_pngs,
        )
        scene.clip_path = str(scene_master.relative_to(config.MEDIA_DIR))
        scene.status = "clipped"
        db.add(scene)
        db.commit()
        await _emit(project.id, type="scene", index=scene.idx, status="clipped")
        await _stage(db, project, "shots", 0.38 + 0.27 * scene.idx / len(scenes), "", status="rendering")

    # ---------------------------------------------------------- voice
    voice_parts: list[tuple[Path, float]] = []
    tts_engine_note = ""
    if include_audio:
        await _stage(db, project, "voice", 0.66, "توليد التعليق الصوتي والحوارات", status="rendering")
        tts = get_tts(project.tts_provider)
        title_offset = TITLE_CARD_SEC if cards_on else 0.0
        cursor = title_offset
        for scene in scenes:
            scene_start = cursor
            t_cursor = scene_start + 0.35
            texts: list[tuple[str, dict | None]] = []
            if scene.narration.strip():
                texts.append((scene.narration, None))
            for d in scene.dialogue or []:
                line = d.get("text", "").strip()
                if line:
                    texts.append((line, {"speed": 1.0, "pitch": 1.0}))
            for k, (text, voice) in enumerate(texts):
                out = base / "audio" / f"s{scene.idx:02d}_{k}.wav"
                try:
                    res = await tts.synthesize(
                        text, out, language=project.language, voice={**(voice or {}), "style": project.voice_style}
                    )
                    a_path = Path(res.path)
                    if res.meta.get("silent"):
                        tts_engine_note = "silent-tts"
                    dur = float(res.meta.get("duration_sec") or await assembly.probe_duration(a_path) or 2.0)
                    voice_parts.append((a_path, t_cursor))
                    t_cursor += dur + 0.25
                except ProviderError as exc:
                    _add_warning(project, f"مشهد {scene.idx}: فشل توليد الصوت ({str(exc)[:100]})")
                    raise
            cursor += float(scene.duration_sec)
        if tts_engine_note == "silent-tts":
            _add_warning(
                project,
                "لا يوجد مزود تحويل نص لكلام مُفعّل — استُخدم مسار صوتي صامت مُزامن مع الترجمة النصية. اربط OpenAI TTS أو ElevenLabs لأصوات حقيقية.",
            )

    # ---------------------------------------------------------- music + sfx
    music_path: Path | None = None
    sfx_points: list[tuple[Path, float]] = []
    total = (TITLE_CARD_SEC if cards_on else 0) + sum(float(s.duration_sec) for s in scenes) + (END_CARD_SEC if cards_on else 0)
    if include_audio:
        await _stage(db, project, "music", 0.76, "تأليف الموسيقى التصويرية والمؤثرات", status="rendering")
        music_path = base / "audio" / "score.wav"
        try:
            await get_music("local").generate(music_path, mood=project.music_mood, duration_sec=total)
        except Exception as exc:  # noqa: BLE001
            _add_warning(project, f"تعذّر توليد الموسيقى: {str(exc)[:100]}")
            music_path = None
        whoosh = assembly.write_sfx_whoosh(base / "audio" / "whoosh.wav", 0.9)
        offset = TITLE_CARD_SEC if cards_on else 0.0
        for scene in scenes:
            sfx_points.append((whoosh, max(0.0, offset - 0.15)))
            offset += float(scene.duration_sec)

    # ---------------------------------------------------------- assembly
    await _stage(db, project, "assembly", 0.80, "المونتاج الذكي وتجميع الفيلم", status="rendering")
    film_clips: list[Path] = []
    if cards_on:
        tcard = base / "final" / "title_card.png"
        assembly.render_title_card(
            project.title or "TRIFI",
            (project.screenplay or {}).get("logline", ""),
            tcard, size,
            footer="إنتاج استوديو تريفي — TRIFI Cinema Studio",
        )
        film_clips.append(await assembly.image_to_clip(tcard, base / "final" / "title.mp4", duration_sec=TITLE_CARD_SEC, size=size, fps=fps))

    offsets: list[float] = []
    cursor = TITLE_CARD_SEC if cards_on else 0.0
    for scene in scenes:
        clip = config.MEDIA_DIR / scene.clip_path
        if not clip.exists():
            raise RuntimeError(f"مشهد {scene.idx}: ملف المقطع مفقود ({scene.clip_path})")
        film_clips.append(Path(clip))
        offsets.append(cursor)
        cursor += float(scene.duration_sec)

    if cards_on:
        ecard = base / "final" / "end_card.png"
        assembly.render_title_card(
            "النهاية" if project.language == "ar" else "THE END",
            project.title or "",
            ecard, size,
            footer="TRIFI TRANS — AI Film Studio",
        )
        film_clips.append(await assembly.image_to_clip(ecard, base / "final" / "end.mp4", duration_sec=END_CARD_SEC, size=size, fps=fps))

    silent_film = base / "final" / "film_silent.mp4"
    await assembly.concat_clips(film_clips, silent_film, reencode=True)

    final = base / "final" / "film.mp4"
    if include_audio:
        speech_bus = base / "audio" / "mix.wav"
        await assembly.mix_audio(
            voice_parts, music_path, speech_bus,
            total_duration=total, sfx_points=sfx_points,
        )
        await assembly.mux(silent_film, speech_bus, final)
    else:
        final = silent_film

    project.final_video_path = str(final.relative_to(config.MEDIA_DIR))
    if subtitles_on:
        srt = base / "final" / "film.srt"
        assembly.write_srt([scene_to_dict(s) for s in scenes], srt, start_offsets=offsets)
        project.srt_path = str(srt.relative_to(config.MEDIA_DIR))

    # ---------------------------------------------------------- QC + finalize
    await _stage(db, project, "qc", 0.93, "مراجعة الجودة والاتساق", status="rendering")
    problems: list[str] = []
    for scene in scenes:
        if not scene.clip_path:
            problems.append(f"مشهد {scene.idx} بلا مقطع")
        clip = config.MEDIA_DIR / scene.clip_path if scene.clip_path else None
        if clip and (not clip.exists() or clip.stat().st_size < 1000):
            problems.append(f"مشهد {scene.idx}: ملف المقطع غير صالح")
    if not final.exists():
        problems.append("الملف النهائي غير موجود")
    if problems:
        raise RuntimeError("فشل التحقق النهائي: " + "; ".join(problems))

    poster = base / "final" / "poster.jpg"
    try:
        await assembly.make_poster(final, poster)
        project.poster_path = str(poster.relative_to(config.MEDIA_DIR))
    except Exception:  # noqa: BLE001
        pass

    duration_real = await assembly.probe_duration(final)
    project.manifest = {
        "title": project.title,
        "duration_target_sec": project.duration_sec,
        "duration_real_sec": round(duration_real, 2),
        "resolution": project.resolution,
        "aspect": project.aspect,
        "fps": fps,
        "size": list(size),
        "providers": {
            "llm": project.llm_provider,
            "image": project.image_provider,
            "video": project.video_provider,
            "tts": project.tts_provider,
            "music": "local-score",
            "assembly": "ffmpeg",
        },
        "tts_silent": tts_engine_note == "silent-tts",
        "subtitles": subtitles_on,
        "scenes": [
            {"index": s.idx, "title": s.title, "duration_sec": s.duration_sec, "clip": s.clip_path, "still": s.image_path}
            for s in scenes
        ],
        "warnings": project.warnings or [],
    }
    await _stage(db, project, "done", 1.0, "اكتمل الفيلم — جاهز للمعاينة والتنزيل", status="done")
    return {"video": project.final_video_path, "duration_sec": round(duration_real, 2)}


# ------------------------------------------------------------------ single scene
async def run_scene(db: Session, project_id: str, payload: dict | None = None) -> dict:
    """Regenerate one scene (new variant) and re-assemble the film."""
    payload = payload or {}
    idx = int(payload.get("scene_index", -1))
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("project not found")
    scene = db.query(Scene).filter(Scene.project_id == project.id, Scene.idx == idx).first()
    if scene is None:
        raise ValueError(f"scene {idx} not found")

    scene.variant_index += 1
    scene.status = "pending"
    scene.error = ""
    db.add(scene)
    db.commit()
    await _emit(project.id, type="scene", index=idx, status="regenerating", variant=scene.variant_index)

    if payload.get("narration") is not None:
        scene.narration = str(payload["narration"])
    if payload.get("summary") is not None:
        scene.summary = str(payload["summary"])
    if payload.get("environment") is not None:
        scene.environment = str(payload["environment"])
    if payload.get("duration_sec") is not None:
        scene.duration_sec = float(payload["duration_sec"])
    if payload.get("shots") is not None:
        scene.shots = payload["shots"]
    db.add(scene)
    db.commit()

    result = await run_render(db, project_id, {"regenerate_scenes": [idx], **{k: v for k, v in payload.items() if k in ("include_audio", "include_subtitles", "include_title_cards", "variant_seed")}})
    return {"scene": idx, "variant": scene.variant_index, **result}


# ------------------------------------------------------------------ characters
async def run_character(db: Session, project_id: str, payload: dict | None = None) -> dict:
    payload = payload or {}
    char_id = payload.get("character_id")
    project = db.get(Project, project_id)
    if project is None:
        raise ValueError("project not found")
    ch = db.get(Character, char_id) if char_id else None
    if ch is None or ch.project_id != project.id:
        raise ValueError("character not found")
    base = project_dir(db, project_id)
    out = base / "characters" / f"{ch.id}_v{int(payload.get('variant', 0)) + 1}.png"
    if project.image_provider == "local":
        from ..providers.image_local import render_character_sheet

        render_character_sheet(out, name=ch.name, appearance=ch.appearance or payload.get("appearance", ""), palette=ch.palette, seed=int(time.time()) % 99999)
    else:
        img = get_image(project.image_provider)
        res = await img.generate(
            f"character reference sheet, {ch.appearance or payload.get('appearance', ch.name)}, consistent design, cinematic",
            out, size=(768, 1024),
        )
        out = Path(res.path)
    ch.image_path = str(out.relative_to(config.MEDIA_DIR))
    if payload.get("appearance"):
        ch.appearance = str(payload["appearance"])
    db.add(ch)
    db.commit()
    await _emit(project.id, type="character", id=ch.id, status="done")
    return {"character_id": ch.id, "image": ch.image_path}


HANDLERS = {
    "plan": run_plan,
    "render": run_render,
    "scene": run_scene,
    "character": run_character,
}
