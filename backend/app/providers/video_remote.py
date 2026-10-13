"""Remote generative video engines: Replicate (Kling / Wan / Minimax) and fal.ai.

Clip-length reality (documented in docs/PROVIDERS.md):
- no engine produces 5 minutes in one call;
- the pipeline generates 5–10 s clips per shot and assembles them locally."""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from .. import config
from .base import Capability, GenerationResult, ProviderError, ProviderNotConfigured, VideoProvider

POLL_INTERVAL = 5.0
POLL_TIMEOUT = 1500

REPLICATE_MODELS = {
    "kling": "kwaivgi/kling-v2.1",
    "wan": "wan-video/wan-2.2-t2v-fast",
    "minimax": "minimax/video-01",
}
FAL_MODELS = {
    "kling": "fal-ai/kling-video/v2.1/standard/text-to-video",
    "veo": "fal-ai/veo3/text-to-video",
}


class ReplicateVideo(VideoProvider):
    name = "replicate"

    def __init__(self, model: str = "kling") -> None:
        self.model_key = model

    def _key(self) -> str:
        return config.REPLICATE_API_TOKEN

    async def generate(self, prompt, out_path, *, duration_sec, size, fps=24, image_path=None, seed=0) -> GenerationResult:
        if not self._key():
            raise ProviderNotConfigured("REPLICATE_API_TOKEN missing")
        w, h = size
        model = REPLICATE_MODELS.get(self.model_key, REPLICATE_MODELS["kling"])
        payload = {
            "input": {
                "prompt": prompt[:1500],
                "duration": 5 if duration_sec <= 6 else 10,
                "aspect_ratio": "16:9" if w > h else ("9:16" if h > w else "1:1"),
            }
        }
        if image_path and Path(image_path).exists() and self.model_key == "kling":
            import base64

            b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
            payload["input"]["start_image"] = f"data:image/png;base64,{b64}"

        headers = {"Authorization": f"Bearer {self._key()}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(
                f"https://api.replicate.com/v1/models/{model}/predictions",
                headers={**headers, "Prefer": "wait=30"},
                json=payload,
            )
            if resp.status_code >= 400:
                raise ProviderError(f"Replicate video error {resp.status_code}: {resp.text[:300]}")
            pred = resp.json()
            url = pred.get("urls", {}).get("get")
            deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT
            while pred.get("status") not in ("succeeded", "failed", "canceled"):
                if asyncio.get_event_loop().time() > deadline:
                    raise ProviderError("Replicate video timeout")
                await asyncio.sleep(POLL_INTERVAL)
                pred = (await client.get(url, headers=headers)).json()
            if pred.get("status") != "succeeded":
                raise ProviderError(f"Replicate video failed: {str(pred.get('error'))[:200]}")
            out_url = pred["output"]
            if isinstance(out_url, list):
                out_url = out_url[0]
            data = await client.get(out_url)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data.content)
        return GenerationResult(path=out_path, meta={"engine": f"replicate-{self.model_key}", "model": model})

    async def test_connection(self) -> Capability:
        ok = bool(self._key())
        return Capability(
            name=self.name,
            label=f"Replicate Video ({self.model_key})",
            kind="video",
            configured=ok,
            details={
                "max_clip_seconds": 10,
                "resolutions": ["720p", "1080p"],
                "fps": [24, 30],
                "note": "كل مقطع 5–10 ثوانٍ؛ الفيلم الطويل يُبنى من عدة مقاطع وتجميع محلي.",
            },
        )


class FalVideo(VideoProvider):
    name = "fal"

    def __init__(self, model: str = "kling") -> None:
        self.model_key = model

    def _key(self) -> str:
        return config.FAL_KEY

    async def generate(self, prompt, out_path, *, duration_sec, size, fps=24, image_path=None, seed=0) -> GenerationResult:
        if not self._key():
            raise ProviderNotConfigured("FAL_KEY missing")
        w, h = size
        model = FAL_MODELS.get(self.model_key, FAL_MODELS["kling"])
        payload = {
            "prompt": prompt[:1500],
            "duration": "5" if duration_sec <= 6 else "10",
            "aspect_ratio": "16:9" if w > h else ("9:16" if h > w else "1:1"),
        }
        headers = {"Authorization": f"Key {self._key()}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(f"https://fal.run/{model}", headers=headers, json=payload)
            if resp.status_code >= 400:
                raise ProviderError(f"fal video error {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            videos = data.get("video") or data.get("videos") or []
            url = videos[0].get("url") if isinstance(videos, list) and videos else None
            if not url:
                raise ProviderError(f"fal video: no output URL in {str(data)[:200]}")
            blob = await client.get(url)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(blob.content)
        return GenerationResult(path=out_path, meta={"engine": f"fal-{self.model_key}", "model": model})

    async def test_connection(self) -> Capability:
        ok = bool(self._key())
        return Capability(
            name=self.name,
            label=f"fal.ai Video ({self.model_key})",
            kind="video",
            configured=ok,
            details={
                "max_clip_seconds": 10,
                "resolutions": ["720p", "1080p"],
                "fps": [24],
                "note": "مقاطع توليدية قصيرة تُجمع محليًا لفيلم كامل.",
            },
        )
