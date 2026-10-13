"""OpenAI-compatible chat provider (works with OpenAI, Ollama, LM Studio, Groq…)."""
from __future__ import annotations

import json

import httpx

from .. import config
from .base import Capability, LLMProvider, ProviderError, ProviderNotConfigured


class OpenAILLM(LLMProvider):
    name = "openai"

    def __init__(self) -> None:
        self._settings: dict = {}

    def configure(self, *, api_key: str, base_url: str, model: str) -> None:
        self._settings = {"api_key": api_key, "base_url": base_url.rstrip("/"), "model": model}

    def _cfg(self) -> dict:
        if self._settings:
            return self._settings
        return {
            "api_key": config.LLM_API_KEY,
            "base_url": config.LLM_BASE_URL.rstrip("/"),
            "model": config.LLM_MODEL,
        }

    def _headers(self) -> dict:
        cfg = self._cfg()
        if not cfg["api_key"]:
            raise ProviderNotConfigured("LLM API key missing (LLM_API_KEY / OPENAI_API_KEY)")
        return {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}

    async def complete_json(self, system: str, user: str) -> dict:
        cfg = self._cfg()
        payload = {
            "model": cfg["model"],
            "temperature": 0.8,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=180) as client:
            try:
                resp = await client.post(f"{cfg['base_url']}/chat/completions", headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise ProviderError(f"LLM request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise ProviderError(f"LLM error {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start, end = content.find("{"), content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(content[start : end + 1])
            raise ProviderError("LLM did not return valid JSON")

    async def test_connection(self) -> Capability:
        cfg = self._cfg()
        configured = bool(cfg["api_key"])
        ok = False
        note = ""
        if configured:
            async with httpx.AsyncClient(timeout=30) as client:
                try:
                    resp = await client.get(f"{cfg['base_url']}/models", headers=self._headers())
                    ok = resp.status_code < 400
                    if not ok:
                        note = f"HTTP {resp.status_code}"
                except httpx.HTTPError as exc:
                    note = str(exc)[:120]
        return Capability(
            name=self.name,
            label=f"LLM: {cfg['model']}",
            kind="llm",
            configured=configured and ok,
            details={"base_url": cfg["base_url"], "model": cfg["model"], "note": note or ("متصل" if ok else "غير مُفعّل")},
        )
