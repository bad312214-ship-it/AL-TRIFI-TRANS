"""API routes: provider capabilities (real connection tests) + app settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..providers import capabilities, get_image, get_llm, get_tts, get_video
from ..providers.base import ProviderError
from ..schemas import SettingsUpdate
from ..services import appsettings

router = APIRouter(prefix="/api")


@router.get("/providers")
async def providers_status(db: Session = Depends(get_db)) -> dict:
    caps = await capabilities(db)
    out = {}
    for kind, group in caps.items():
        out[kind] = [
            {
                "name": c.name,
                "label": c.label,
                "configured": c.configured,
                "details": c.details,
            }
            for c in group
        ]
    return out


@router.post("/providers/test")
async def test_provider(body: dict, db: Session = Depends(get_db)) -> dict:
    kind = body.get("kind", "")
    name = body.get("name", "local")
    try:
        if kind == "llm":
            cap = await get_llm(name, db).test_connection()
        elif kind == "image":
            cap = await get_image(name).test_connection()
        elif kind == "video":
            cap = await get_video(name).test_connection()
        elif kind == "tts":
            cap = await get_tts(name).test_connection()
        else:
            raise HTTPException(400, f"unknown kind: {kind}")
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)[:300]}
    return {"ok": cap.configured, "label": cap.label, "details": cap.details}


@router.post("/providers/generate-sample")
async def generate_sample(body: dict, db: Session = Depends(get_db)) -> dict:
    """Real smoke test: generate one tiny asset with the chosen engine."""
    import tempfile
    from pathlib import Path

    kind = body.get("kind", "")
    name = body.get("name", "local")
    tmp = Path(tempfile.mkdtemp(prefix="trifi_sample_"))
    try:
        if kind == "image":
            out = tmp / "sample.png"
            res = await get_image(name).generate("cinematic sunset over mountains, film still", out, size=(768, 432), seed=1)
        elif kind == "video":
            img = tmp / "still.png"
            get_image("local").generate  # ensure import
            from ..providers.image_local import render_scene_still

            render_scene_still(img, size=(640, 360), seed=2, mood="dawn", environment="mountains", figure=True)
            res = await get_video(name).generate("slow cinematic push-in", tmp / "sample.mp4", duration_sec=3.0, size=(640, 360), fps=24, image_path=img)
        elif kind == "tts":
            res = await get_tts(name).synthesize("مرحباً، هذا اختبار الصوت." if body.get("language", "ar") == "ar" else "Hello, this is a voice test.", tmp / "sample.wav", language=body.get("language", "ar"))
        else:
            raise HTTPException(400, f"unsupported kind: {kind}")
        return {"ok": True, "file": res.path.name, "meta": res.meta, "bytes": Path(res.path).stat().st_size}
    except ProviderError as exc:
        return {"ok": False, "error": str(exc)[:300]}


@router.get("/settings")
async def get_settings(db: Session = Depends(get_db)) -> dict:
    return appsettings.public_settings(db)


@router.put("/settings")
async def put_settings(body: SettingsUpdate, db: Session = Depends(get_db)) -> dict:
    appsettings.apply_overrides(db, body.values)
    return appsettings.public_settings(db)
