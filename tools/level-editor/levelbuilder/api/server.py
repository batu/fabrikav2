"""FastAPI server for the level editor.

Usage:
    uv run --project tools/level-editor python -m levelbuilder.api.server
"""

import hmac
import logging
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

import dotenv

# Env loading: every .env on the ancestor chain, parent-first so deeper files
# override (worktrees sit under <base>/<repo>/.worktrees/<wt>, and provider
# keys live in the outer <base>/.env). No cross-repo git worktree walking —
# that was fabrika-specific machinery the fork drops.
_app_dir = Path(__file__).resolve().parent
_tool_dir = _app_dir.parent.parent  # tools/level-editor

def _env_chain(tool_dir: Path) -> list[Path]:
    """Ancestor .env files, parent-first (deeper overrides).

    Bounded at the user's home directory: shared provider keys live a couple of
    levels up (<base>/.env), but /Users/.env and /.env are not ours to read.
    NOTE: do not stop at the first `.git` — in a git worktree that is a FILE at
    the worktree root, two levels below the shared env (regression 2026-07-29:
    OPENROUTER_API_KEY silently unset, background generation failed).
    """
    home = Path.home().resolve()
    chain: list[Path] = []
    for ancestor in tool_dir.resolve().parents:
        if ancestor == home or home not in [ancestor, *ancestor.parents]:
            break
        chain.append(ancestor / ".env")
    return list(reversed(chain))


_env_candidates = [*_env_chain(_tool_dir), _tool_dir / ".env"]
_loaded_envs: set[Path] = set()
for _env in _env_candidates:
    _resolved_env = _env.resolve()
    if _resolved_env in _loaded_envs or not _env.is_file():
        continue
    _loaded_envs.add(_resolved_env)
    dotenv.load_dotenv(_env, override=True)
if not os.environ.get("OPENROUTER_API_KEY") and os.environ.get("OPEN_ROUTER_API_KEY"):
    os.environ["OPENROUTER_API_KEY"] = os.environ["OPEN_ROUTER_API_KEY"]
if not os.environ.get("OPENROUTER_API_KEY") and os.environ.get("OPEN_ROUTER_KEY"):
    os.environ["OPENROUTER_API_KEY"] = os.environ["OPEN_ROUTER_KEY"]
if not os.environ.get("FAL_KEY") and os.environ.get("FAL_API_KEY"):
    os.environ["FAL_KEY"] = os.environ["FAL_API_KEY"]

# Ensure pipeline modules are importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from contextlib import asynccontextmanager

# Resolve the per-game profile BEFORE the route/session imports below: the
# forked v1 modules bind their filesystem roots at import time. When run as
# `python -m levelbuilder.api.server`, `--game` must be parsed HERE — the
# bottom `__main__` block runs only after the session module has already
# cached its roots (observed live: `--game` silently ignored, sessions landing
# in the tool dir).
from levelbuilder.settings import apply_game_from_env, resolve_game

_CLI_ARGS = None
if __name__ == "__main__":
    import argparse as _argparse

    _parser = _argparse.ArgumentParser(description="Level editor server")
    _parser.add_argument("--game", help="game name under games/ (or absolute game path)")
    _parser.add_argument("--port", type=int, default=5192)
    _CLI_ARGS = _parser.parse_args()
    if _CLI_ARGS.game:
        resolve_game(_CLI_ARGS.game).apply()

ACTIVE_GAME = apply_game_from_env()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .routes import register_job_handlers as register_rest_job_handlers, router as rest_router
from .inpaint import _sanitized_error
from . import inpaint as _inpaint_mod
from .inpaint import (
    router as sse_router,
    register_job_handlers as register_inpaint_job_handlers,
)
from . import session as _session_mod
from .session import LEVELS_DIR
from .job_worker import get_default_job_worker

logger = logging.getLogger("levelbuilder.server")


# Optional bearer-token gate for tunneled deployments. Local dev leaves
# FTD_BUILDER_TOKEN unset and everything works as before. When set, every
# /api and /levels request must include `Authorization: Bearer <token>`
# OR `?token=<token>` (for SSE EventSource, which can't set headers).
_AUTH_TOKEN = os.environ.get("FTD_BUILDER_TOKEN", "").strip()


class _TokenAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not _AUTH_TOKEN:
            return await call_next(request)
        path = request.url.path
        # Only gate the API and level-asset mount; let CORS preflight through.
        if request.method == "OPTIONS":
            return await call_next(request)
        # /public-levels serves the SHIPPED game assets and was added after
        # this gate — when the token is set it must be covered like /levels
        # (fresh-review, ledger 054 #41; the http-surface reviewer died before
        # assessing it, self-verified).
        if not (path.startswith("/api") or path.startswith("/levels") or path.startswith("/public-levels")):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        token = ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        else:
            token = request.query_params.get("token", "")
        # Constant-time compare so byte-wise timing differences don't
        # leak token prefix info to a patient network attacker. The
        # Cloudflare-tunnel jitter largely dwarfs this in practice, but
        # the fix is one line and removes the whole concern.
        if not hmac.compare_digest(token, _AUTH_TOKEN):
            return JSONResponse(
                status_code=401,
                content={"error": "Missing or invalid token", "code": "unauthorized"},
            )
        return await call_next(request)


def _patch_merceka_httpx_timeouts() -> None:
    """Replace `merceka_core.image.httpx.Client` with a subclass that
    injects phase-aware `httpx.Timeout(connect=5, read=330, write=5, pool=5)`
    into every Client(...) constructor, ignoring the scalar `timeout=300`
    that merceka_core passes.

    Pre-fix: merceka_core uses `httpx.Client(timeout=300)` everywhere,
    which httpx interprets as *all four* phases being 300 s — meaning a
    DNS resolution hang or TCP connect hang could block 300 s before the
    retry loop sees a timeout. 5 min of silence per attempt × 3 attempts
    = ~15 min of silent wedging per session before anything surfaced.

    With phase-aware timeouts, connect/write/pool issues surface in
    5 s each, the retry loop kicks in fast, and our own
    `_GEMINI_CALL_TIMEOUT_S=360` still caps the end-to-end budget.
    read=330 leaves more headroom for slow GPT Image 2 generations while
    still failing before the outer cap can start a duplicate retry.

    Scoped to merceka_core.image — we don't touch the global `httpx`
    module object, so other callers (like routes.py:62 which uses
    httpx.Client(timeout=30) for the short image-data proxy) keep their
    own timeouts. The patch mutates merceka_core's module-level `httpx`
    attribute only.
    """
    import types
    import httpx as _real_httpx
    import merceka_core.image as _merceka_image

    # write=120 (not 5): upscale-bg uploads multi-MB backgrounds to the
    # provider; a 5 s write budget times out mid-upload (observed as 502
    # WriteTimeout on /upscale-bg, 2026-07-28). Connect/pool stay tight —
    # they are the hang-detection phases the patch exists for.
    _phase_aware = _real_httpx.Timeout(
        connect=5.0, read=330.0, write=120.0, pool=5.0,
    )
    _original_client = _real_httpx.Client

    class _TimeoutPatchedClient(_original_client):
        def __init__(self, *args, **kwargs):
            kwargs["timeout"] = _phase_aware
            super().__init__(*args, **kwargs)

    # Build a proxy namespace that mirrors the real httpx module but
    # overrides Client. Replaces merceka_core.image's `httpx` reference
    # only; other modules continue to see the real httpx.
    _httpx_proxy = types.ModuleType("httpx_patched_for_merceka_image")
    for _attr in dir(_real_httpx):
        if not _attr.startswith("_"):
            setattr(_httpx_proxy, _attr, getattr(_real_httpx, _attr))
    _httpx_proxy.Client = _TimeoutPatchedClient

    _merceka_image.httpx = _httpx_proxy


def _start_gallery_derivative_prewarm() -> None:
    if os.environ.get("FTD_GALLERY_PREWARM", "1") == "0":
        logger.info("gallery derivative prewarm disabled by FTD_GALLERY_PREWARM=0")
        return

    def run() -> None:
        try:
            logger.info("gallery derivative prewarm started")
            result = _session_mod.prewarm_gallery_derivatives()
            logger.info(
                "gallery derivative prewarm finished: sessions=%s variants=%s thumbnails=%s previews=%s missing=%s errors=%s",
                result["sessions"],
                result["variants"],
                result["thumbnails"],
                result["previews"],
                result["missing"],
                result["errors"],
            )
        except Exception:
            logger.exception("gallery derivative prewarm failed")

    threading.Thread(target=run, name="ftd-gallery-prewarm", daemon=True).start()


@asynccontextmanager
def _start_sprite_model_prewarm() -> None:
    if os.environ.get("FTD_SPRITE_REPAIR", "1") != "1":
        return

    def _warm() -> None:
        for builder_name in ("_pickup_cutout_session", "_pickup_sam_session"):
            builder = getattr(_inpaint_mod, builder_name, None)
            if builder is None:
                continue
            try:
                builder()
            except Exception:  # model weights unavailable: repair degrades, boot does not
                logger.warning("sprite model prewarm failed for %s", builder_name, exc_info=True)

    threading.Thread(target=_warm, name="sprite-model-prewarm", daemon=True).start()


async def lifespan(app: FastAPI):
    # Startup: apply phase-aware httpx timeout to merceka_core.image
    # so provider hangs surface in seconds, not minutes.
    _patch_merceka_httpx_timeouts()
    # Warm gallery derivatives in the background so first review opens don't
    # pay the PNG -> WebP conversion cost.
    _start_gallery_derivative_prewarm()
    # Sprite repair defaults ON in the fork, and its rembg/SAM sessions
    # download model weights lazily with no timeout — observed live as an
    # 8.8 MB download running INSIDE a request, next to a client reset. Warm
    # them off the request path; failures here are non-fatal (repair degrades).
    _start_sprite_model_prewarm()
    job_worker = get_default_job_worker()
    register_rest_job_handlers(job_worker)
    register_inpaint_job_handlers(job_worker)
    job_worker.start()
    yield
    job_worker.stop()
    # Shutdown: drain the inpaint thread pool so in-flight Gemini jobs have
    # a chance to finish and don't leak threads on uvicorn --reload.
    # cancel_futures=True stops queued work from starting (3.9+).
    _inpaint_mod.executor.shutdown(wait=True, cancel_futures=True)
    # Shared timeout pool also needs draining so uvicorn --reload doesn't
    # leak 32 idle workers per reload cycle.
    _inpaint_mod._timeout_executor.shutdown(wait=True, cancel_futures=True)
    _inpaint_mod.reset_executors_after_shutdown()


app = FastAPI(title="Level Editor API", lifespan=lifespan)


@app.exception_handler(_session_mod.LevelNotReadyError)
async def _level_not_ready(request: Request, exc: Exception) -> JSONResponse:
    """A refused export is the author's problem to fix, not a server fault:
    409, with the actionable reason, rather than a bare 500."""
    return JSONResponse(
        status_code=409,
        content={
            "error": str(exc),
            "code": "level_not_ready",
            "stage": f"{request.method} {request.url.path}",
        },
    )


@app.exception_handler(Exception)
async def _structured_internal_error(request: Request, exc: Exception) -> JSONResponse:
    """R5: no bare 500s — every unhandled failure reaches clients as a
    structured, redacted error. Full detail still lands in server logs."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": _sanitized_error(exc),
            "code": "internal_error",
            "stage": f"{request.method} {request.url.path}",
        },
    )


# uvicorn percent-decodes scope["path"], so a traversal payload can reach a
# path join; only plain session ids are allowed to touch the filesystem here.
_SESSION_ID_SAFE = re.compile(r"^[A-Za-z0-9_\-]{1,120}$")


class _SessionRevisionMiddleware(BaseHTTPMiddleware):
    """Collision visibility (KTD6): every /api/sessions/{id}... response
    carries `X-Session-Revision` (session.json mtime_ns). Two actors on one
    session can compare stamps instead of silently last-write-winning."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        parts = request.url.path.split("/")
        if (
            response.status_code < 400
            and len(parts) >= 4
            and parts[1] == "api"
            and parts[2] == "sessions"
            and parts[3]
            and _SESSION_ID_SAFE.fullmatch(parts[3])
        ):
            session_json = LEVELS_DIR / parts[3] / "session.json"
            try:
                response.headers["X-Session-Revision"] = str(session_json.stat().st_mtime_ns)
            except OSError:
                pass
        return response

# CORS for React dev server — override via FTD_CORS_ORIGINS (comma-sep) for
# tunneled access. allow_credentials=False because we have no cookie auth.
import os as _os
_cors_origins = [o.strip() for o in _os.environ.get(
    "FTD_CORS_ORIGINS",
    "http://localhost:5193,http://localhost:5173",
).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
# Order matters: Starlette makes the LAST added the outermost, so the revision
# middleware must be added FIRST — otherwise it wraps auth and stamps
# X-Session-Revision onto 401s, leaking session existence + mtime to
# unauthenticated callers on tunneled deployments.
app.add_middleware(_SessionRevisionMiddleware)
app.add_middleware(_TokenAuthMiddleware)

# Include route modules
app.include_router(rest_router)
app.include_router(sse_router)

# Static file serving for generated images (must be after middleware).
# A fresh per-game workspace has neither directory yet; the mounts require
# them to exist, so create them here rather than failing boot.
LEVELS_DIR.mkdir(parents=True, exist_ok=True)
_session_mod.GAME_PUBLIC_LEVELS.mkdir(parents=True, exist_ok=True)
app.mount("/levels", StaticFiles(directory=str(LEVELS_DIR)), name="levels")
# Parallel mount for the SHIPPED game assets (bundled-manifest paths are
# rooted here \u2014 e.g. levels/<id>/styles/<style>/color.png). The authoring
# workspace lacks the published style variants so /levels/ alone 404s.
app.mount("/public-levels", StaticFiles(directory=str(_session_mod.GAME_PUBLIC_LEVELS)), name="public-levels")


if __name__ == "__main__":
    import uvicorn
    import logging

    _cli_args = _CLI_ARGS  # parsed at module top, before session-root binding

    # SSE auth fallback: clients that can't set Authorization headers
    # (EventSource) pass the token via `?token=...`. Without scrubbing,
    # uvicorn's access log echoes the full query string, which leaks the
    # master FTD_BUILDER_TOKEN into logs + any upstream proxy (e.g.
    # Cloudflare tunnel). Filter it here so `?token=secret` becomes
    # `?token=<redacted>` in access logs.
    class _ScrubTokenFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            if "token=" in msg:
                record.args = None
                record.msg = re.sub(r"([?&])token=[^ &\"]*", r"\1token=<redacted>", msg)
            return True

    logging.getLogger("uvicorn.access").addFilter(_ScrubTokenFilter())

    reload_enabled = _os.environ.get("FTD_API_RELOAD", "0") == "1"
    print(
        f"Level Editor API starting on http://127.0.0.1:{_cli_args.port} "
        f"game={_cli_args.game or 'env-default'} reload={reload_enabled}"
    )
    uvicorn.run(
        "levelbuilder.api.server:app",
        host="127.0.0.1",
        port=_cli_args.port,
        reload=reload_enabled,
        reload_dirs=[str(Path(__file__).resolve().parent.parent)] if reload_enabled else None,
    )
