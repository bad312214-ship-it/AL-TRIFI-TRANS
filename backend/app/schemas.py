"""Pydantic schemas for the HTTP API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Aspect = Literal["16:9", "9:16", "1:1"]
Resolution = Literal["720p", "1080p", "4k"]
Fps = Literal[24, 30, 60]


class ProjectCreate(BaseModel):
    prompt: str = Field(min_length=3, max_length=8000)
    title: str = Field(default="", max_length=255)
    language: Literal["ar", "en"] = "ar"
    genre: str = "adventure"
    visual_style: str = "cinematic_3d"
    duration_sec: int = Field(default=60, ge=15, le=300)
    aspect: Aspect = "16:9"
    resolution: Resolution = "1080p"
    fps: Fps = 24
    voice_style: str = "warm_narrator"
    music_mood: str = "emotional"
    subtitles: bool = True
    title_cards: bool = True
    llm_provider: str = ""
    image_provider: str = ""
    video_provider: str = ""
    tts_provider: str = ""


class ProjectUpdate(BaseModel):
    title: str | None = None
    prompt: str | None = None
    language: Literal["ar", "en"] | None = None
    genre: str | None = None
    visual_style: str | None = None
    duration_sec: int | None = Field(default=None, ge=15, le=300)
    aspect: Aspect | None = None
    resolution: Resolution | None = None
    fps: Fps | None = None
    voice_style: str | None = None
    music_mood: str | None = None
    subtitles: bool | None = None
    title_cards: bool | None = None
    llm_provider: str | None = None
    image_provider: str | None = None
    video_provider: str | None = None
    tts_provider: str | None = None


class SceneBase(BaseModel):
    title: str = ""
    summary: str = ""
    environment: str = ""
    lighting: str = ""
    mood: str = ""
    narration: str = ""
    dialogue: list[dict[str, Any]] = []
    shots: list[dict[str, Any]] = []
    duration_sec: float = Field(default=6.0, ge=1.0, le=60.0)


class SceneUpdate(SceneBase):
    pass


class ScreenplayUpdate(BaseModel):
    title: str | None = None
    logline: str | None = None
    synopsis: str | None = None
    style_notes: str | None = None
    scenes: list[SceneUpdate] | None = None
    characters: list[dict[str, Any]] | None = None


class RenderRequest(BaseModel):
    regenerate_scenes: list[int] | None = None  # scene indexes to (re)build
    include_audio: bool = True
    include_subtitles: bool | None = None
    include_title_cards: bool | None = None
    variant_seed: int | None = None


class EstimateRequest(BaseModel):
    duration_sec: int = 60
    resolution: Resolution = "1080p"
    aspect: Aspect = "16:9"
    fps: Fps = 24
    llm_provider: str = "local"
    image_provider: str = "local"
    video_provider: str = "local"
    tts_provider: str = "local"
    include_audio: bool = True


class SettingsUpdate(BaseModel):
    values: dict[str, Any]


class ProjectOut(BaseModel):
    id: str
    title: str
    prompt: str
    language: str
    genre: str
    visual_style: str
    duration_sec: int
    aspect: str
    resolution: str
    fps: int
    voice_style: str
    music_mood: str
    subtitles: bool
    title_cards: bool
    llm_provider: str
    image_provider: str
    video_provider: str
    tts_provider: str
    status: str
    stage: str
    progress: float
    error: str
    warnings: list | None = None
    has_script: bool = False
    scene_count: int = 0
    final_video_path: str = ""
    srt_path: str = ""
    poster_path: str = ""
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectOut):
    screenplay: dict | None = None
    manifest: dict | None = None
    cost_estimate: dict | None = None
    characters: list[dict[str, Any]] = []
    scenes: list[dict[str, Any]] = []
    jobs: list[dict[str, Any]] = []
