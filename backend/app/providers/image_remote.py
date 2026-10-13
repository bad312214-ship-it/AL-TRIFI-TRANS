"""Remote image engines: OpenAI Images, Replicate (Flux), Stability AI."""
from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import httpx

from .. import config
from .base import Capability, GenerationResult, ImageProvider, ProviderError, ProviderNotConfigured

POLL_INTERVAL = 3.0
POLL_TIMEOUT = 600


class _HttpImageBase(ImageProvider):
    def _key(self) -> str:
        raise NotImplementedError

    async def _ensure(self) -> None:
        if not self._key():
            raise ProviderNotConfigured(f"{self.name} API key missing")

    async def test_connection(self) -> Capability:
        ok = bool(self._key())
        return Capability(
            name=self.name,
            label=self.label,
            kind="image",
            configured=ok,
            details={"note": "المفتاح مضبوط" if ok else "أضف المفتاح في الإعدادات", "resolutions": ["1024x1024", "1792x1024"]},
        )


class OpenAIImages(_HttpImageBase):
    name = "openai"
    label = "OpenAI Images (gpt-image-1 / dall-e-3)"

    def _key(self) -> str:
        return config.OPENAI_API_KEY

    async def generate(self, prompt, out_path, *, size, seed=0, negative="") -> GenerationResult:
        await self._ensure()
        w, h = size
        api_size = "1024x1024" if abs(w - h) < 8 else ("1792x1024" if w > h else "1024x1792")
        payload = {"model": "dall-e-3", "prompt": prompt[:4000], "size": api_size, "quality": "hd", "n": 1, "response_format": "b64_json"}
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {self._key()}"},
                json=payload,
            )
        if resp.status_code >= 400:
            raise ProviderError(f"OpenAI images error {resp.status_code}: {resp.text[:300]}")
        b64 = resp.json()["data"][0]["b64_json"]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(base64.b64decode(b64))
        return GenerationResult(path=out_path, meta={"engine": "openai-dalle3", "size": api_size})


class ReplicateImages(_HttpImageBase):
    name = "replicate"
    label = "Replicate — Flux 1.1 Pro"

    def _key(self) -> str:
        return config.REPLICATE_API_TOKEN

    async def generate(self, prompt, out_path, *, size, seed=0, negative="") -> GenerationResult:
        await self._ensure()
        w, h = size
        payload = {
            "input": {
                "prompt": prompt,
                "aspect_ratio": "16:9" if w > h else ("9:16" if h > w else "1:1"),
                "seed": seed,
                "output_format": "png",
            }
        }
        headers = {"Authorization": f"Bearer {self._key()}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
                headers={**headers, "Prefer": "wait=60"},
                json=payload,
            )
            if resp.status_code >= 400:
                raise ProviderError(f"Replicate error {resp.status_code}: {resp.text[:300]}")
            pred = resp.json()
            url = pred.get("urls", {}).get("get")
            deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT
            while pred.get("status") not in ("succeeded", "failed", "canceled"):
                if asyncio.get_event_loop().time() > deadline:
                    raise ProviderError("Replicate image timeout")
                await asyncio.sleep(POLL_INTERVAL)
                resp = await client.get(url, headers=headers)
                pred = resp.json()
            if pred.get("status") != "succeeded":
                raise ProviderError(f"Replicate image failed: {str(pred.get('error'))[:200]}")
            out_url = pred["output"]
            if isinstance(out_url, list):
                out_url = out_url[0]
            img = await client.get(out_url)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(img.content)
        return GenerationResult(path=out_path, meta={"engine": "replicate-flux", "seed": seed})


class StabilityImages(_HttpImageBase):
    name = "stability"
    label = "Stability AI — Stable Image Core"

    def _key(self) -> str:
        return config.STABILITY_API_KEY

    async def generate(self, prompt, out_path, *, size, seed=0, negative="") -> GenerationResult:
        await self._ensure()
        w, h = size
        aspect = "16:9" if w > h else ("9:16" if h > w else "1:1")
        data = {
            "prompt": (prompt + (f" — avoid: {negative}" if negative else ""))[:10000],
            "aspect_ratio": aspect,
            "seed": seed % 4294967294,
            "output_format": "png",
        }
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                "https://api.stability.ai/v2beta/stable-image/generate/core",
                headers={"Authorization": f"Bearer {self._key()}", "Accept": "image/*"},
                data=data,
                files={"none": ""},
            )
        if resp.status_code >= 400:
            raise ProviderError(f"Stability error {resp.status_code}: {resp.text[:300]}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(resp.content)
        return GenerationResult(path=out_path, meta={"engine": "stability-core", "aspect": aspect})
