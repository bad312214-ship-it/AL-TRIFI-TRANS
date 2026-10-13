"""API routes: projects, screenplay, scenes, render, jobs, events, estimate."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import config
from ..db import get_db
from ..models import Character, Job, Project, Scene
from ..schemas import (
    EstimateRequest,
    ProjectCreate,
    ProjectDetail,
    ProjectOut,
    RenderRequest,
    ScreenplayUpdate,
)
from ..services import events, jobs, pipeline
from ..services.costs import estimate as estimate_cost

router = APIRouter(prefix="/api")


def _scene_dict(s: Scene) -> dict[str, Any]:
    return {
        "id": s.id,
        "idx": s.idx,
        "title": s.title,
        "summary": s.summary,
        "environment": s.environment,
        "lighting": s.lighting,
        "mood": s.mood,
        "narration": s.narration,
        "dialogue": s.dialogue or [],
        "shots": s.shots or [],
        "duration_sec": s.duration_sec,
        "image_url": f"/media/{s.image_path}" if s.image_path else "",
        "clip_url": f"/media/{s.clip_path}" if s.clip_path else "",
        "status": s.status,
        "variant_index": s.variant_index,
        "error": s.error,
    }


def _char_dict(c: Character) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "role": c.role,
        "appearance": c.appearance,
        "personality": c.personality,
        "palette": c.palette or {},
        "voice": c.voice or {},
        "image_url": f"/media/{c.image_path}" if c.image_path else "",
    }


def _job_dict(j: Job) -> dict[str, Any]:
    return {
        "id": j.id,
        "type": j.type,
        "status": j.status,
        "attempts": j.attempts,
        "max_attempts": j.max_attempts,
        "error": j.error,
        "payload": j.payload or {},
        "result": j.result or {},
        "created_at": j.created_at.isoformat() if j.created_at else "",
        "finished_at": j.finished_at.isoformat() if j.finished_at else "",
    }


def _project_out(p: Project) -> ProjectOut:
    scenes = p.scenes or []
    return ProjectOut(
        id=p.id,
        title=p.title,
        prompt=p.prompt,
        language=p.language,
        genre=p.genre,
        visual_style=p.visual_style,
        duration_sec=p.duration_sec,
        aspect=p.aspect,
        resolution=p.resolution,
        fps=p.fps,
        voice_style=p.voice_style,
        music_mood=p.music_mood,
        subtitles=p.subtitles,
        title_cards=p.title_cards,
        llm_provider=p.llm_provider,
        image_provider=p.image_provider,
        video_provider=p.video_provider,
        tts_provider=p.tts_provider,
        status=p.status,
        stage=p.stage,
        progress=p.progress,
        error=p.error,
        warnings=p.warnings or [],
        has_script=bool(p.screenplay),
        scene_count=len(scenes),
        final_video_path=f"/media/{p.final_video_path}" if p.final_video_path else "",
        srt_path=f"/media/{p.srt_path}" if p.srt_path else "",
        poster_path=f"/media/{p.poster_path}" if p.poster_path else "",
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _get_project(db: Session, project_id: str) -> Project:
    p = db.get(Project, project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return p


# ------------------------------------------------------------------ projects
@router.get("/health")
async def health() -> dict:
    return {"ok": True, "app": config.APP_NAME, "ffmpeg": config.ffmpeg_exe()}


@router.post("/projects", response_model=ProjectOut)
async def create_project(body: ProjectCreate, db: Session = Depends(get_db)) -> ProjectOut:
    from ..services import appsettings

    p = Project(
        title=body.title or (body.prompt[:48] + ("…" if len(body.prompt) > 48 else "")),
        prompt=body.prompt,
        language=body.language,
        genre=body.genre,
        visual_style=body.visual_style,
        duration_sec=body.duration_sec,
        aspect=body.aspect,
        resolution=body.resolution,
        fps=body.fps,
        voice_style=body.voice_style,
        music_mood=body.music_mood,
        subtitles=body.subtitles,
        title_cards=body.title_cards,
        llm_provider=body.llm_provider or str(appsettings.get_value(db, "default_llm_provider", "local")),
        image_provider=body.image_provider or str(appsettings.get_value(db, "default_image_provider", "local")),
        video_provider=body.video_provider or str(appsettings.get_value(db, "default_video_provider", "local")),
        tts_provider=body.tts_provider or str(appsettings.get_value(db, "default_tts_provider", "local")),
        status="draft",
        warnings=[],
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _project_out(p)


@router.get("/projects")
async def list_projects(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Project).order_by(Project.created_at.desc()).all()
    return [json.loads(_project_out(p).model_dump_json()) for p in rows]


@router.get("/projects/{project_id}")
async def get_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    out = json.loads(_project_out(p).model_dump_json())
    out.update(
        {
            "screenplay": p.screenplay,
            "manifest": p.manifest,
            "cost_estimate": p.cost_estimate,
            "characters": [_char_dict(c) for c in (p.characters or [])],
            "scenes": [_scene_dict(s) for s in sorted(p.scenes or [], key=lambda s: s.idx)],
            "jobs": [_job_dict(j) for j in sorted(p.jobs or [], key=lambda j: j.created_at, reverse=True)],
        }
    )
    return out


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: dict, db: Session = Depends(get_db)) -> ProjectOut:
    p = _get_project(db, project_id)
    allowed = {
        "title", "prompt", "language", "genre", "visual_style", "duration_sec",
        "aspect", "resolution", "fps", "voice_style", "music_mood", "subtitles",
        "title_cards", "llm_provider", "image_provider", "video_provider", "tts_provider",
    }
    for k, v in body.items():
        if k in allowed and v is not None:
            setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _project_out(p)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    import shutil

    p = _get_project(db, project_id)
    db.delete(p)
    db.commit()
    d = config.MEDIA_DIR / "projects" / project_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    return {"deleted": project_id}


# ------------------------------------------------------------------ planning
@router.post("/projects/{project_id}/plan")
async def plan_project(project_id: str, body: dict | None = None, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    job = jobs.enqueue(db, p.id, "plan", body or {})
    return {"job_id": job.id, "status": "queued"}


@router.put("/projects/{project_id}/script")
async def update_script(project_id: str, body: ScreenplayUpdate, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    script = dict(p.screenplay or {})
    for field in ("title", "logline", "synopsis", "style_notes"):
        val = getattr(body, field)
        if val is not None:
            script[field] = val
    if body.characters is not None:
        script["characters"] = body.characters
        db.query(Character).filter(Character.project_id == p.id).delete()
        for c in body.characters:
            db.add(Character(project_id=p.id, **{k: c.get(k, "") for k in ("name", "role", "appearance", "personality")}, palette=c.get("palette"), voice=c.get("voice")))
    if body.scenes is not None:
        script["scenes"] = [s.model_dump() for s in body.scenes]
        existing = {s.idx: s for s in db.query(Scene).filter(Scene.project_id == p.id).all()}
        for i, s in enumerate(body.scenes):
            row = existing.get(i + 1) or Scene(project_id=p.id, idx=i + 1)
            row.title = s.title
            row.summary = s.summary
            row.environment = s.environment
            row.lighting = s.lighting
            row.mood = s.mood
            row.narration = s.narration
            row.dialogue = s.dialogue
            row.shots = s.shots
            row.duration_sec = s.duration_sec
            db.add(row)
        for idx, row in existing.items():
            if idx > len(body.scenes):
                db.delete(row)
    p.screenplay = script
    if script.get("title"):
        p.title = script["title"][:255]
    db.add(p)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ render
@router.post("/projects/{project_id}/render")
async def render_project(project_id: str, body: RenderRequest | None = None, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    if not p.screenplay:
        raise HTTPException(400, "لا يوجد سيناريو — خطّط الفيلم أولًا")
    payload = (body.model_dump(exclude_none=True) if body else {})
    job = jobs.enqueue(db, p.id, "render", payload)
    return {"job_id": job.id, "status": "queued"}


@router.post("/projects/{project_id}/scenes/{idx}/regenerate")
async def regenerate_scene(project_id: str, idx: int, body: dict | None = None, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    job = jobs.enqueue(db, p.id, "scene", {"scene_index": idx, **(body or {})})
    return {"job_id": job.id, "status": "queued"}


@router.post("/projects/{project_id}/characters/{char_id}/regenerate")
async def regenerate_character(project_id: str, char_id: str, body: dict | None = None, db: Session = Depends(get_db)) -> dict:
    p = _get_project(db, project_id)
    job = jobs.enqueue(db, p.id, "character", {"character_id": char_id, **(body or {})})
    return {"job_id": job.id, "status": "queued"}


@router.get("/projects/{project_id}/jobs")
async def project_jobs(project_id: str, db: Session = Depends(get_db)) -> list[dict]:
    _get_project(db, project_id)
    rows = db.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at.desc()).all()
    return [_job_dict(j) for j in rows]


@router.get("/projects/{project_id}/events")
async def project_events(project_id: str) -> StreamingResponse:
    async def gen():
        q = await events.subscribe(project_id)
        try:
            yield f"data: {json.dumps({'type': 'hello'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            await events.unsubscribe(project_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ estimate + script text
@router.post("/estimate")
async def estimate_endpoint(body: EstimateRequest, db: Session = Depends(get_db)) -> dict:
    return estimate_cost(
        db,
        duration_sec=body.duration_sec,
        resolution=body.resolution,
        llm_provider=body.llm_provider,
        image_provider=body.image_provider,
        video_provider=body.video_provider,
        tts_provider=body.tts_provider,
        include_audio=body.include_audio,
    )


@router.get("/projects/{project_id}/script.txt")
async def script_text(project_id: str, db: Session = Depends(get_db)) -> FileResponse:
    from ..services.screenplay import screenplay_as_text

    p = _get_project(db, project_id)
    if not p.screenplay:
        raise HTTPException(404, "No screenplay")
    out = config.MEDIA_DIR / "projects" / project_id / "script.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(screenplay_as_text(p.screenplay), encoding="utf-8")
    return FileResponse(out, filename=f"{p.title or 'script'}.txt")


@router.get("/projects/{project_id}/download")
async def download_film(project_id: str, db: Session = Depends(get_db)) -> FileResponse:
    p = _get_project(db, project_id)
    if not p.final_video_path:
        raise HTTPException(404, "لا يوجد فيلم بعد")
    path = config.MEDIA_DIR / p.final_video_path
    if not path.exists():
        raise HTTPException(404, "الملف غير موجود")
    return FileResponse(path, filename=f"{(p.title or 'film').replace(' ', '_')}.mp4", media_type="video/mp4")
