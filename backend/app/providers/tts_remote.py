"""Remote speech engines: OpenAI TTS and ElevenLabs."""
from __future__ import annotations

import httpx

from .. import config
from .base import Capability, GenerationResult, ProviderError, ProviderNotConfigured, TTSProvider


class OpenAITTS(TTSProvider):
    name = "openai"

    def _key(self) -> str:
        return config.OPENAI_API_KEY

    async def synthesize(self, text, out_path, *, language="ar", voice=None) -> GenerationResult:
        if not self._key():
            raise ProviderNotConfigured("OPENAI_API_KEY missing for TTS")
        v = (voice or {}).get("openai", "alloy")
        payload = {"model": "gpt-4o-mini-tts", "voice": v, "input": text[:4000], "speed": float((voice or {}).get("speed", 1.0))}
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {self._key()}"},
                json=payload,
            )
        if resp.status_code >= 400:
            raise ProviderError(f"OpenAI TTS error {resp.status_code}: {resp.text[:300]}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(resp.content)
        return GenerationResult(path=out_path, meta={"engine": "openai-tts", "voice": v})

    async def test_connection(self) -> Capability:
        ok = bool(self._key())
        return Capability(
            name=self.name,
            label="OpenAI TTS",
            kind="tts",
            configured=ok,
            details={"languages": ["ar", "en", "multi"], "voices": ["alloy", "nova", "onyx", "shimmer"], "note": "متصل" if ok else "أضف OPENAI_API_KEY"},
        )


class ElevenLabsTTS(TTSProvider):
    name = "elevenlabs"

    def _key(self) -> str:
        return config.ELEVENLABS_API_KEY

    async def synthesize(self, text, out_path, *, language="ar", voice=None) -> GenerationResult:
        if not self._key():
            raise ProviderNotConfigured("ELEVENLABS_API_KEY missing")
        voice_id = (voice or {}).get("elevenlabs", "21m00Tcm4TlvDq8ikWAM")  # Rachel
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        payload = {
            "text": text[:4000],
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": float((voice or {}).get("speed", 1.0))},
        }
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(url, headers={"xi-api-key": self._key()}, json=payload)
        if resp.status_code >= 400:
            raise ProviderError(f"ElevenLabs error {resp.status_code}: {resp.text[:300]}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(resp.content)
        return GenerationResult(path=out_path, meta={"engine": "elevenlabs", "voice": voice_id})

    async def test_connection(self) -> Capability:
        ok = False
        note = "أضف ELEVENLABS_API_KEY"
        if self._key():
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get("https://api.elevenlabs.io/v1/user", headers={"xi-api-key": self._key()})
                ok = resp.status_code < 400
                note = "متصل" if ok else f"HTTP {resp.status_code}"
        return Capability(
            name=self.name,
            label="ElevenLabs",
            kind="tts",
            configured=ok,
            details={"languages": ["ar", "en", "multi"], "voices": ["custom"], "note": note},
        )
