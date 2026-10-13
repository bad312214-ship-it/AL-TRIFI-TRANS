"""Persistent background job runner (SQLite-backed, retry + resume)."""
from __future__ import annotations

import asyncio
import logging
import traceback
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .. import config
from ..db import SessionLocal
from ..models import Job, Project
from . import events, pipeline

log = logging.getLogger("trifi.jobs")
_task: asyncio.Task | None = None
_stop = asyncio.Event()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def enqueue(db: Session, project_id: str, job_type: str, payload: dict | None = None, max_attempts: int | None = None) -> Job:
    job = Job(
        project_id=project_id,
        type=job_type,
        payload=payload or {},
        status="pending",
        max_attempts=max_attempts or config.MAX_ATTEMPTS,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def recover_stuck_jobs(db: Session) -> int:
    """On startup: requeue jobs that were mid-flight when the server stopped."""
    stuck = db.query(Job).filter(Job.status == "running").all()
    for job in stuck:
        job.status = "pending"
        job.error = "requeued after server restart"
        db.add(job)
    db.commit()
    return len(stuck)


async def _execute(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        project = db.get(Project, job.project_id)
        handler = pipeline.HANDLERS.get(job.type)
        if handler is None:
            job.status = "failed"
            job.error = f"unknown job type: {job.type}"
            db.commit()
            return

        await events.publish(
            job.project_id,
            {"type": "job", "id": job.id, "job_type": job.type, "status": "running", "attempts": job.attempts},
        )
        try:
            result = await handler(db, job.project_id, job.payload or {})
            job.status = "done"
            job.result = result or {}
            job.error = ""
            job.finished_at = _now()
            db.add(job)
            db.commit()
            await events.publish(
                job.project_id,
                {"type": "job", "id": job.id, "job_type": job.type, "status": "done", "result": job.result},
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("job %s failed (attempt %s): %s", job.id, job.attempts, exc)
            job.error = f"{str(exc)[:1000]}"
            job.finished_at = _now()
            if job.attempts < job.max_attempts:
                job.status = "pending"
                db.add(job)
                db.commit()
                await events.publish(
                    job.project_id,
                    {"type": "job", "id": job.id, "job_type": job.type, "status": "retrying", "attempts": job.attempts, "error": job.error},
                )
                await asyncio.sleep(min(2 ** job.attempts, 30))
            else:
                job.status = "failed"
                db.add(job)
                if project is not None:
                    project.status = "failed"
                    project.error = job.error
                    db.add(project)
                db.commit()
                await events.publish(
                    job.project_id,
                    {"type": "job", "id": job.id, "job_type": job.type, "status": "failed", "error": job.error},
                )
            db.commit()
            if config.API_TOKEN == "" and job.status == "failed":
                log.debug("trace: %s", traceback.format_exc())
    finally:
        db.close()


async def _loop() -> None:
    db = SessionLocal()
    try:
        recovered = recover_stuck_jobs(db)
        if recovered:
            log.info("requeued %s interrupted jobs", recovered)
    finally:
        db.close()

    while not _stop.is_set():
        db = SessionLocal()
        try:
            job = (
                db.query(Job)
                .filter(Job.status == "pending")
                .order_by(Job.created_at)
                .first()
            )
            job_id = job.id if job else None
            if job_id:
                job.status = "running"
                job.attempts += 1
                job.started_at = _now()
                db.add(job)
                db.commit()
        finally:
            db.close()
        if job_id:
            await _execute(job_id)
        else:
            try:
                await asyncio.wait_for(_stop.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass


def start_worker() -> None:
    global _task
    _stop.clear()
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_loop())


async def stop_worker() -> None:
    _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
