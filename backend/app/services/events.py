"""In-process pub/sub feeding the per-project SSE progress stream."""
from __future__ import annotations

import asyncio
from typing import Any

_subscribers: dict[str, list[asyncio.Queue]] = {}
_lock = asyncio.Lock()


async def publish(project_id: str, event: dict[str, Any]) -> None:
    async with _lock:
        queues = list(_subscribers.get(project_id, []))
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def subscribe(project_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    async with _lock:
        _subscribers.setdefault(project_id, []).append(q)
    return q


async def unsubscribe(project_id: str, q: asyncio.Queue) -> None:
    async with _lock:
        subs = _subscribers.get(project_id, [])
        if q in subs:
            subs.remove(q)
