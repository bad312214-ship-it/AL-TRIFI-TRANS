"""ORM models: projects, characters, scenes, jobs, settings."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(255), default="مشروع جديد")
    prompt: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(8), default="ar")
    genre: Mapped[str] = mapped_column(String(64), default="adventure")
    visual_style: Mapped[str] = mapped_column(String(64), default="cinematic_3d")
    duration_sec: Mapped[int] = mapped_column(Integer, default=60)
    aspect: Mapped[str] = mapped_column(String(8), default="16:9")
    resolution: Mapped[str] = mapped_column(String(8), default="1080p")
    fps: Mapped[int] = mapped_column(Integer, default=24)
    voice_style: Mapped[str] = mapped_column(String(64), default="warm_narrator")
    music_mood: Mapped[str] = mapped_column(String(64), default="emotional")
    subtitles: Mapped[bool] = mapped_column(Boolean, default=True)
    title_cards: Mapped[bool] = mapped_column(Boolean, default=True)

    llm_provider: Mapped[str] = mapped_column(String(32), default="local")
    image_provider: Mapped[str] = mapped_column(String(32), default="local")
    video_provider: Mapped[str] = mapped_column(String(32), default="local")
    tts_provider: Mapped[str] = mapped_column(String(32), default="local")

    # lifecycle: draft -> planning -> planned -> rendering -> done | failed
    status: Mapped[str] = mapped_column(String(16), default="draft")
    stage: Mapped[str] = mapped_column(String(32), default="idle")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")

    screenplay: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    manifest: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    cost_estimate: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    warnings: Mapped[list | None] = mapped_column(JSON, nullable=True)

    final_video_path: Mapped[str] = mapped_column(String(512), default="")
    srt_path: Mapped[str] = mapped_column(String(512), default="")
    poster_path: Mapped[str] = mapped_column(String(512), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    characters: Mapped[list["Character"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Scene.idx",
    )
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(128), default="")
    appearance: Mapped[str] = mapped_column(Text, default="")
    personality: Mapped[str] = mapped_column(Text, default="")
    palette: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    voice: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    image_path: Mapped[str] = mapped_column(String(512), default="")

    project: Mapped[Project] = relationship(back_populates="characters")


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idx: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(255), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    environment: Mapped[str] = mapped_column(Text, default="")
    lighting: Mapped[str] = mapped_column(String(255), default="")
    mood: Mapped[str] = mapped_column(String(128), default="")
    narration: Mapped[str] = mapped_column(Text, default="")
    dialogue: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [{character, text}]
    shots: Mapped[list | None] = mapped_column(JSON, nullable=True)
    duration_sec: Mapped[float] = mapped_column(Float, default=6.0)

    image_path: Mapped[str] = mapped_column(String(512), default="")
    clip_path: Mapped[str] = mapped_column(String(512), default="")
    audio_path: Mapped[str] = mapped_column(String(512), default="")
    variant_index: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error: Mapped[str] = mapped_column(Text, default="")

    project: Mapped[Project] = relationship(back_populates="scenes")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))  # plan | render | scene | character
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/running/done/failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="jobs")


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
