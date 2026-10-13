"""Provider interfaces. Every AI engine plugs in behind these classes,
so a vendor can be swapped without touching the pipeline."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ProviderError(Exception):
    """Raised when a provider call fails (network, quota, bad response)."""


class ProviderNotConfigured(ProviderError):
    """Raised when a provider lacks credentials/capabilities."""


@dataclass
class GenerationResult:
    path: Path
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Capability:
    """What a concrete engine can actually do — used for honest UI labels."""

    name: str
    label: str
    kind: str  # llm | image | video | tts | music
    configured: bool
    details: dict[str, Any] = field(default_factory=dict)
    # details keys used by the UI:
    #  video: max_clip_seconds, resolutions, fps, note
    #  image: resolutions, note
    #  tts: languages, voices, note


class LLMProvider(ABC):
    name = "llm"

    @abstractmethod
    async def complete_json(self, system: str, user: str) -> dict:
        """Return a JSON object produced by the model."""

    @abstractmethod
    async def test_connection(self) -> Capability: ...


class ImageProvider(ABC):
    name = "image"

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        out_path: Path,
        *,
        size: tuple[int, int],
        seed: int = 0,
        negative: str = "",
    ) -> GenerationResult: ...

    @abstractmethod
    async def test_connection(self) -> Capability: ...


class VideoProvider(ABC):
    name = "video"

    @abstractmethod
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
    ) -> GenerationResult: ...

    @abstractmethod
    async def test_connection(self) -> Capability: ...


class TTSProvider(ABC):
    name = "tts"

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        out_path: Path,
        *,
        language: str = "ar",
        voice: dict[str, Any] | None = None,
    ) -> GenerationResult: ...

    @abstractmethod
    async def test_connection(self) -> Capability: ...


class MusicProvider(ABC):
    name = "music"

    @abstractmethod
    async def generate(
        self, out_path: Path, *, mood: str = "emotional", duration_sec: float = 60.0
    ) -> GenerationResult: ...

    @abstractmethod
    async def test_connection(self) -> Capability: ...
