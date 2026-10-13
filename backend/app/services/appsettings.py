"""App settings store (DB key/value, env fallback). Secrets stay server-side."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import config
from ..models import Setting

SECRET_KEYS = {
    "llm_api_key",
    "openai_api_key",
    "replicate_api_token",
    "fal_key",
    "stability_api_key",
    "elevenlabs_api_key",
    "runway_api_key",
}

ENV_DEFAULTS: dict[str, Any] = {
    "llm_api_key": config.LLM_API_KEY,
    "llm_base_url": config.LLM_BASE_URL,
    "llm_model": config.LLM_MODEL,
    "openai_api_key": config.OPENAI_API_KEY,
    "replicate_api_token": config.REPLICATE_API_TOKEN,
    "fal_key": config.FAL_KEY,
    "stability_api_key": config.STABILITY_API_KEY,
    "elevenlabs_api_key": config.ELEVENLABS_API_KEY,
    "runway_api_key": config.RUNWAY_API_KEY,
    "default_llm_provider": config.DEFAULT_LLM_PROVIDER,
    "default_image_provider": config.DEFAULT_IMAGE_PROVIDER,
    "default_video_provider": config.DEFAULT_VIDEO_PROVIDER,
    "default_tts_provider": config.DEFAULT_TTS_PROVIDER,
    "price_image": 0.04,
    "price_video_second": 0.05,
    "price_tts_1k_chars": 0.015,
    "price_llm_1k_tokens": 0.001,
}


def get_value(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(Setting, key)
    if row is not None and row.value is not None:
        return row.value.get("v") if isinstance(row.value, dict) and "v" in row.value else row.value
    if key in ENV_DEFAULTS and ENV_DEFAULTS[key] != "":
        return ENV_DEFAULTS[key]
    return default


def set_value(db: Session, key: str, value: Any) -> None:
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value={"v": value})
        db.add(row)
    else:
        row.value = {"v": value}
    db.commit()


def get_many(db: Session, keys: list[str]) -> dict[str, Any]:
    return {k: get_value(db, k) for k in keys}


def public_settings(db: Session) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in get_many(db, list(ENV_DEFAULTS)).items():
        out[k] = config.mask_secret(v) if (k in SECRET_KEYS and isinstance(v, str)) else v
        if k in SECRET_KEYS:
            out[f"{k}_set"] = bool(v)
    return out


def apply_overrides(db: Session, values: dict[str, Any]) -> None:
    for k, v in values.items():
        if k not in ENV_DEFAULTS:
            continue
        if k in SECRET_KEYS and isinstance(v, str) and set(v) <= {"*"}:
            continue  # masked echo — keep existing secret
        if v in ("", None) and k in SECRET_KEYS:
            set_value(db, k, "")
            continue
        set_value(db, k, v)
