"""Provider registry — swap engines here without touching the pipeline."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .base import (  # noqa: F401
    Capability,
    GenerationResult,
    ImageProvider,
    LLMProvider,
    MusicProvider,
    ProviderError,
    ProviderNotConfigured,
    TTSProvider,
    VideoProvider,
)
from .image_local import LocalImageProvider
from .image_remote import OpenAIImages, ReplicateImages, StabilityImages
from .llm_local import LocalPlanner
from .llm_openai import OpenAILLM
from .music_local import LocalMusicProvider
from .tts_local import LocalTTSProvider
from .tts_remote import ElevenLabsTTS, OpenAITTS
from .video_local import LocalVideoProvider
from .video_remote import FalVideo, ReplicateVideo


def _llm(name: str, db: Session | None = None) -> LLMProvider:
    from ..services import appsettings

    if name in ("openai", "llm_openai", "remote"):
        p = OpenAILLM()
        if db is not None:
            p.configure(
                api_key=str(appsettings.get_value(db, "llm_api_key", "")),
                base_url=str(appsettings.get_value(db, "llm_base_url", "")),
                model=str(appsettings.get_value(db, "llm_model", "")),
            )
        return p
    return LocalPlanner()


def _image(name: str) -> ImageProvider:
    if name in ("openai", "dalle", "dall-e"):
        return OpenAIImages()
    if name in ("replicate", "flux"):
        return ReplicateImages()
    if name in ("stability", "stable"):
        return StabilityImages()
    return LocalImageProvider()


def _video(name: str) -> VideoProvider:
    if name.startswith("replicate"):
        return ReplicateVideo(model=name.split(":", 1)[1] if ":" in name else "kling")
    if name.startswith("fal"):
        return FalVideo(model=name.split(":", 1)[1] if ":" in name else "kling")
    return LocalVideoProvider()


def _tts(name: str) -> TTSProvider:
    if name in ("openai", "openai-tts"):
        return OpenAITTS()
    if name in ("elevenlabs", "11labs"):
        return ElevenLabsTTS()
    return LocalTTSProvider()


def _music(name: str) -> MusicProvider:
    return LocalMusicProvider()


def get_llm(name: str, db: Session | None = None) -> LLMProvider:
    return _llm(name or "local", db)


def get_image(name: str) -> ImageProvider:
    return _image(name or "local")


def get_video(name: str) -> VideoProvider:
    return _video(name or "local")


def get_tts(name: str) -> TTSProvider:
    return _tts(name or "local")


def get_music(name: str = "local") -> MusicProvider:
    return _music(name or "local")


async def capabilities(db: Session | None = None) -> dict[str, list[Capability]]:
    llms = [LocalPlanner(), OpenAILLM()]
    if db is not None:
        from ..services import appsettings

        OpenAILLM().configure(
            api_key=str(appsettings.get_value(db, "llm_api_key", "")),
            base_url=str(appsettings.get_value(db, "llm_base_url", "")),
            model=str(appsettings.get_value(db, "llm_model", "")),
        )
    images = [LocalImageProvider(), OpenAIImages(), ReplicateImages(), StabilityImages()]
    videos = [LocalVideoProvider(), ReplicateVideo(), FalVideo()]
    ttss = [LocalTTSProvider(), OpenAITTS(), ElevenLabsTTS()]
    musics = [LocalMusicProvider()]

    async def _cap(p) -> Capability:
        try:
            return await p.test_connection()
        except Exception as exc:  # noqa: BLE001
            return Capability(name=p.name, label=p.name, kind="?", configured=False, details={"note": str(exc)[:120]})

    out: dict[str, list[Capability]] = {}
    for kind, group in (("llm", llms), ("image", images), ("video", videos), ("tts", ttss), ("music", musics)):
        caps = []
        for p in group:
            c = await _cap(p)
            if kind == "llm" and isinstance(p, OpenAILLM):
                pass
            caps.append(c)
        out[kind] = caps
    return out
