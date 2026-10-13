"""Server-side configuration. API keys never leave this process."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
MEDIA_DIR = BASE_DIR / "media"
FRONTEND_DIR = BASE_DIR / "frontend"
FONT_AR_PATH = BASE_DIR / "backend" / "assets" / "fonts" / "NotoSansArabic.ttf"
FONT_LATIN_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_LATIN_BOLD_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
DB_PATH = DATA_DIR / "trifi.db"


def _load_env_file(path: Path) -> None:
    """Minimal .env loader (no extra dependency)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(BASE_DIR / ".env")

APP_NAME = os.getenv("APP_NAME", "TRIFI Cinema Studio — استوديو تريفي للأفلام الذكية")
HOST = os.getenv("APP_HOST", "0.0.0.0")
PORT = int(os.getenv("APP_PORT", "8000"))
# Optional bearer token protecting /api/* (empty = open local studio).
API_TOKEN = os.getenv("APP_API_TOKEN", "").strip()

# Provider credentials (server-side only; masked when echoed by the API).
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", os.getenv("OPENAI_API_KEY", "")).strip()
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "").strip()
FAL_KEY = os.getenv("FAL_KEY", "").strip()
STABILITY_API_KEY = os.getenv("STABILITY_API_KEY", "").strip()
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
RUNWAY_API_KEY = os.getenv("RUNWAY_API_KEY", "").strip()

# Default provider selection ("local" always works without any key).
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "local")
DEFAULT_IMAGE_PROVIDER = os.getenv("DEFAULT_IMAGE_PROVIDER", "local")
DEFAULT_VIDEO_PROVIDER = os.getenv("DEFAULT_VIDEO_PROVIDER", "local")
DEFAULT_TTS_PROVIDER = os.getenv("DEFAULT_TTS_PROVIDER", "local")

MAX_DURATION_SEC = 300  # 5 minutes target ceiling
MIN_DURATION_SEC = 15
MAX_ATTEMPTS = int(os.getenv("JOB_MAX_ATTEMPTS", "3"))


def ffmpeg_exe() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def ffprobe_exe() -> str:
    found = shutil.which("ffprobe")
    return found or ""


def ensure_dirs() -> None:
    for d in (DATA_DIR, MEDIA_DIR, FONT_AR_PATH.parent):
        d.mkdir(parents=True, exist_ok=True)


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:3] + "*" * (len(value) - 7) + value[-4:]
