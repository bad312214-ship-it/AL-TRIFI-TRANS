"""TRIFI Cinema Studio — FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from . import config
from .api import routes_projects, routes_settings
from .db import init_db
from .services import jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("trifi")


class TokenAuth(BaseHTTPMiddleware):
    """Optional bearer-token protection for /api/* (APP_API_TOKEN)."""

    async def dispatch(self, request: Request, call_next):
        if config.API_TOKEN and request.url.path.startswith("/api/"):
            auth = request.headers.get("authorization", "")
            token = request.headers.get("x-api-token", "")
            if auth.removeprefix("Bearer ").strip() != config.API_TOKEN and token != config.API_TOKEN:
                return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    jobs.start_worker()
    log.info("TRIFI Cinema Studio up — db: %s", config.DB_PATH)
    yield
    await jobs.stop_worker()


app = FastAPI(title=config.APP_NAME, lifespan=lifespan)
app.add_middleware(TokenAuth)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_projects.router)
app.include_router(routes_settings.router)

config.ensure_dirs()
app.mount("/media", StaticFiles(directory=config.MEDIA_DIR), name="media")
if config.FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIR / "assets"), name="assets")


@app.get("/")
async def index():
    index_file = config.FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse({"app": config.APP_NAME, "docs": "/docs"})


@app.get("/{path:path}")
async def spa(path: str):
    """Serve the SPA (with its static modules) and fall back to index.html."""
    candidate = (config.FRONTEND_DIR / path).resolve()
    try:
        candidate.relative_to(config.FRONTEND_DIR.resolve())
    except ValueError:
        raise HTTPException(404)
    if candidate.is_file():
        return FileResponse(candidate)
    index_file = config.FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(404)
