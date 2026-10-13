"""End-to-end smoke tests: idea → screenplay → film file (local engines)."""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

os.environ.setdefault("APP_API_TOKEN", "")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _wait_status(client, project_id: str, wanted: set[str], timeout: float = 240.0) -> dict:
    deadline = time.time() + timeout
    data = {}
    while time.time() < deadline:
        data = client.get(f"/api/projects/{project_id}").json()
        if data["status"] in wanted:
            return data
        time.sleep(1.5)
    raise AssertionError(f"timeout waiting for {wanted}; last={data.get('status')} stage={data.get('stage')}")


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_providers_capabilities(client):
    res = client.get("/api/providers")
    assert res.status_code == 200
    data = res.json()
    for kind in ("llm", "image", "video", "tts", "music"):
        assert kind in data
        assert any(p["name"] == "local" for p in data[kind])
        assert any(p["configured"] for p in data[kind])


def test_estimate_free_local(client):
    res = client.post(
        "/api/estimate",
        json={"duration_sec": 60, "image_provider": "local", "video_provider": "local", "tts_provider": "local"},
    )
    assert res.status_code == 200
    assert res.json()["total"] == 0.0


def test_full_pipeline_local(client):
    """Create → plan → render → real MP4 + SRT on disk."""
    res = client.post(
        "/api/projects",
        json={
            "prompt": "طفل يكتشف مدينة سحرية مخفية خلف الجبال، نهاية مفاجئة",
            "duration_sec": 15,
            "resolution": "720p",
            "fps": 24,
            "genre": "fantasy",
            "llm_provider": "local",
            "image_provider": "local",
            "video_provider": "local",
            "tts_provider": "local",
        },
    )
    assert res.status_code == 200
    pid = res.json()["id"]

    assert client.post(f"/api/projects/{pid}/plan", json={}).status_code == 200
    data = _wait_status(client, pid, {"planned", "done"}, timeout=120)
    assert data["scene_count"] >= 3
    assert data["screenplay"]["scenes"]

    assert client.post(f"/api/projects/{pid}/render", json={}).status_code == 200
    data = _wait_status(client, pid, {"done", "failed"}, timeout=300)
    assert data["status"] == "done", data.get("error")

    assert data["final_video_path"]
    assert data["srt_path"]
    assert data["manifest"]["duration_real_sec"] > 5

    # download endpoint serves the actual mp4
    dl = client.get(f"/api/projects/{pid}/download")
    assert dl.status_code == 200
    assert len(dl.content) > 50_000

    # scene regeneration bumps variant and keeps the project healthy
    assert client.post(f"/api/projects/{pid}/scenes/1/regenerate", json={}).status_code == 200
    deadline = time.time() + 300
    scene1 = {}
    while time.time() < deadline:
        data = client.get(f"/api/projects/{pid}").json()
        scene1 = [s for s in data["scenes"] if s["idx"] == 1][0]
        if scene1["variant_index"] >= 1 and data["status"] in {"done", "failed"}:
            break
        time.sleep(1.5)
    assert data["status"] == "done"
    assert scene1["variant_index"] >= 1

    client.delete(f"/api/projects/{pid}")


def test_script_edit_persists(client):
    res = client.post(
        "/api/projects",
        json={"prompt": "رجل يسافر عبر الزمن", "duration_sec": 15, "llm_provider": "local"},
    )
    pid = res.json()["id"]
    client.post(f"/api/projects/{pid}/plan", json={})
    data = _wait_status(client, pid, {"planned"}, timeout=120)
    scenes = data["screenplay"]["scenes"]
    scenes[0]["narration"] = "نص معدل للمشهد الأول"
    put = client.put(f"/api/projects/{pid}/script", json={"logline": "logline جديد", "scenes": scenes})
    assert put.status_code == 200
    data = client.get(f"/api/projects/{pid}").json()
    assert data["screenplay"]["logline"] == "logline جديد"
    assert data["scenes"][0]["narration"] == "نص معدل للمشهد الأول"
    client.delete(f"/api/projects/{pid}")
