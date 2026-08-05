"""SSE streaming endpoints for background generation and inpainting."""

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import logging
import os
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError, as_completed
from typing import Annotated, Any, Literal, Protocol

import io

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response as FastAPIResponse
from PIL import Image, ImageDraw, ImageFilter
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from levelbuilder.hitboxes import Hitbox
from levelbuilder.image_ops import _crop_box, _extract_dog_pixels, evaluate_hitboxes
from merceka_core.image import generate_image, edit_image, inpaint as mask_inpaint

from . import session as S
from .job_store import TERMINAL_STATUSES, JobEvent, JobRecord, JobStore
from .job_worker import JobWorker, TerminalJobError, get_default_job_worker
from .layer_provider import (
    LayerEstimate,
    estimate_layer_background,
    generate_layer_background,
    is_layer_model,
)
from .routes import INPAINT_MODEL_IDS

# Eager scipy import: session.py's lazy `from scipy.optimize import ...` can
# race this module's worker threads on the importlib module lock and deadlock
# (`_DeadlockError: _ModuleLock('scipy.linalg.cython_blas')` — flaky
# test_magenta_recompose failures, 3 occurrences 2026-08-01..03). Importing at
# module load, before any executor thread exists, removes the race.
try:
    import scipy.linalg  # noqa: F401
    import scipy.optimize  # noqa: F401
except ImportError:  # scipy is a hard dep in practice; stay import-safe anyway
    pass

logger = logging.getLogger("levelbuilder.inpaint")

router = APIRouter(prefix="/api")
JOB_STORE = JobStore()

CropInpaintMode = Literal["crop"]
InpaintMode = Literal["crop", "magenta"]


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("invalid %s=%r; using default %s", name, raw, default)
        return default
    return max(minimum, min(maximum, value))


def _dynamic_provider_concurrency() -> int:
    try:
        cpu_count = os.cpu_count() or 2
    except Exception:
        cpu_count = 2
    try:
        mem_kb = 0
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    mem_kb = int(line.split()[1])
                    break
    except Exception:
        mem_kb = 0

    by_cpu = max(2, min(6, cpu_count // 2))
    if mem_kb <= 0:
        return by_cpu
    mem_gb = mem_kb / (1024 * 1024)
    by_mem = 2 if mem_gb < 4 else 3 if mem_gb < 8 else 4 if mem_gb < 16 else 6
    return max(2, min(by_cpu, by_mem))


# Local dev machines run the editor, browser, SSH editor, Codex, and image
# post-processing in the same memory budget. Keep defaults conservative; CI or
# a beefier workstation can opt up with env vars.
_INPAINT_WORKERS = _env_int("FTD_INPAINT_WORKERS", 4, 1, 20)
_CROP_PASS_PARALLEL = os.environ.get("FTD_CROP_PASS_PARALLEL", "0") == "1"
_TIMEOUT_WORKERS = _env_int("FTD_INPAINT_TIMEOUT_WORKERS", 8, 1, 32)
_GEMINI_MAX_CONCURRENCY = _env_int("FTD_PROVIDER_CONCURRENCY", _dynamic_provider_concurrency(), 1, 11)
# Fork default: ON. Weak-alpha birds silently shipping without pickup
# sprites cost a full debugging loop overnight; opt OUT with =0.
_SPRITE_REPAIR_ENABLED = os.environ.get("FTD_SPRITE_REPAIR", "1") == "1"
_SPRITE_REPAIR_SEMAPHORE = threading.BoundedSemaphore(_env_int("FTD_SPRITE_REPAIR_CONCURRENCY", 1, 1, 4))
_SPRITE_EXPORT_PADDING_PX = 4
_SPRITE_CLEANUP_PADDING_PX = 8

# Shared executor — owned by the FastAPI lifespan (see server.py shutdown
# hook). max_workers intentionally stays below the per-level animal cap so
# large 40-animal levels queue locally instead of opening 40 provider calls.
# Gemini concurrency is bounded separately via the
# GEMINI_SEMAPHORE below to stay under provider rate limits regardless of
# how many executor slots are free.
executor = ThreadPoolExecutor(max_workers=_INPAINT_WORKERS)

# Long-lived pool used for per-attempt timeout wrapping in
# `_with_retries_and_timeout`. Pre-fix, every attempt spun up a fresh
# ThreadPoolExecutor(max_workers=1) just to be able to `fut.cancel()` on
# timeout; 3 attempts × N dogs × uvicorn-reload-every-edit thrashed
# thread creation. The shared pool avoids the per-call churn; its bounded,
# configurable size defaults to 8 and can opt up to 32 on larger hosts.
# Every timed-out attempt still holds its worker until the upstream actually
# unwedges, but the outer retry loop no longer spends milliseconds per attempt
# on executor bookkeeping.
_timeout_executor = ThreadPoolExecutor(
    max_workers=_TIMEOUT_WORKERS, thread_name_prefix="ftd-timeout"
)
_TIMEOUT_EXECUTOR_LOCK = threading.Lock()


def _ensure_timeout_executor() -> ThreadPoolExecutor:
    global _timeout_executor
    if not getattr(_timeout_executor, "_shutdown", False):
        return _timeout_executor
    with _TIMEOUT_EXECUTOR_LOCK:
        if getattr(_timeout_executor, "_shutdown", False):
            _timeout_executor = ThreadPoolExecutor(
                max_workers=_TIMEOUT_WORKERS,
                thread_name_prefix="ftd-timeout",
            )
    return _timeout_executor


def reset_executors_after_shutdown() -> None:
    """Recreate module executors after FastAPI TestClient lifespan shutdown.

    Uvicorn process shutdown exits after draining these pools, but tests can
    instantiate and close the app lifespan while continuing to call route
    helpers in the same Python process.
    """
    global executor, _timeout_executor
    executor = ThreadPoolExecutor(max_workers=_INPAINT_WORKERS)
    _timeout_executor = ThreadPoolExecutor(
        max_workers=_TIMEOUT_WORKERS,
        thread_name_prefix="ftd-timeout",
    )


# Model-provider concurrency ceiling. Each generate_image / edit_image /
# mask_inpaint call takes one permit across Gemini, OpenAI, and fal. 11
# defaults low enough that image post-processing does not OOM the dev box.
GEMINI_SEMAPHORE = threading.BoundedSemaphore(_GEMINI_MAX_CONCURRENCY)

# Per-call timeout for edit_image / generate_image. Keep this longer than
# merceka_core.image's patched httpx read timeout so the inner provider
# request returns or fails before our outer Future timeout can retry. If the
# outer cap fires first, the old HTTP request may keep running server-side
# while we start a duplicate attempt, which is both confusing and cost-risky.
_GEMINI_CALL_TIMEOUT_S = 360.0

# Retry policy for transient upstream errors (429, 5xx, network). Applied
# in-thread inside _inpaint_one / _gen so each dog or bg self-recovers
# without the client seeing an error.
_MAX_ATTEMPTS = 3
_BACKOFF_BASE_S = 1.5

# Semantic pickup sprite repair. This is intentionally lazy: normal inpaint
# server startup should not load ONNX Runtime or download a model unless the
# diff-based sprite mask is too noisy/tiny to be animal-only.
_PICKUP_CUTOUT_MODEL = "isnet-general-use"
_PICKUP_SAM_MODEL = "sam"
_PICKUP_SAM_MODEL_NAME = "sam_vit_b_01ec64"
_PICKUP_CUTOUT_SESSION = None
_PICKUP_SAM_SESSION = None
_PICKUP_SAM2_PREDICTOR = None
_PICKUP_SAM2_FAILED = False
_PICKUP_CUTOUT_LOCK = threading.RLock()
_PICKUP_SAM2_LOCK = threading.RLock()


class Sam2Predictor(Protocol):
    def set_image(self, image: np.ndarray) -> None: ...

    def predict(
        self,
        *,
        point_coords: np.ndarray,
        point_labels: np.ndarray,
        box: np.ndarray,
        multimask_output: bool,
    ) -> tuple[np.ndarray, np.ndarray, Any]: ...

_active_generation_lock = threading.Lock()
_active_generations: dict[str, dict] = {}


def _set_active_generation(session_id: str, data: dict | None) -> None:
    with _active_generation_lock:
        if data is None:
            _active_generations.pop(session_id, None)
            return
        existing = _active_generations.get(session_id)
        if existing and "startedAt" not in data:
            data = {"startedAt": existing.get("startedAt"), **data}
        _active_generations[session_id] = data


def _generation_status_payload() -> dict:
    with _active_generation_lock:
        sessions = {
            session_id: {key: value for key, value in data.items() if key != "nOptions"}
            for session_id, data in _active_generations.items()
        }
    # Include QUEUED/RUNNING durable background jobs (ledger 054 #15):
    # _active_generations is only populated when the job HANDLER starts, so a
    # genuinely queued job (batch bigger than worker concurrency) was invisible
    # here — and the BatchPage poll's "generating_bg but not in the active set"
    # heuristic then flipped the card to 'failed' for ANY batch >= 2. Queued
    # counts as active for liveness purposes.
    for job in JOB_STORE.list_jobs(kind="background_generation", statuses=("queued", "running"), include_children=False):
        if job.session_id and job.session_id not in sessions:
            sessions[job.session_id] = {"kind": "background", "queued": True, "jobId": job.id}
    return {
        "backgrounds": {
            "active": len(sessions),
            "sessions": sessions,
        },
    }


_BG_FILE_RE = re.compile(r"^bg_(\d{2})\.png$")


def _resolve_selected_bg(session_id: str, raw: dict) -> int | None:
    """Return selected bg, falling back to bg_NN.png files on disk.

    Background generation can succeed in the provider thread, write bg_00.png,
    then lose the SSE/client flow before select-bg persists. The wizard's
    hydrate path already self-heals this for display; inpaint must use the
    same fallback or it rejects a visible background as "not selected".
    """
    selected_bg = raw.get("selected_bg")
    if selected_bg is not None:
        return int(selected_bg)

    sdir = S.session_dir(session_id)
    if not sdir.exists():
        return None

    indices = sorted(
        int(match.group(1))
        for path in sdir.iterdir()
        if path.is_file() and (match := _BG_FILE_RE.match(path.name))
    )
    if not indices:
        return None

    selected_bg = indices[0]
    try:
        S.update_session_field(session_id, selected_bg=selected_bg)
    except Exception:
        logger.exception("failed to self-heal selected_bg for %s", session_id)
    return selected_bg


# Retry-worthy HTTP status codes, matched only in an HTTP-ish context.
# merceka_core always raises these as `"<Provider> API error <code>: ..."`
# so anchoring on `api error` is both necessary and sufficient. A plain
# `\b500\b` match would false-positive on prose like "500 tokens"; that
# was retrying real application bugs three times before the user ever
# saw them, masking root causes behind minutes of silence.
_TRANSIENT_STATUS_RE = re.compile(
    r"\bapi\s+error\s+(?:429|500|502|503|504)\b",
    re.IGNORECASE,
)

# Exception class names that always mean "transient": explicit timeout
# and connection errors from httpx / stdlib / asyncio. Matching on the
# class name avoids importing httpx here (merceka_core owns that
# dependency surface); the names are stable enough for this check.
_TRANSIENT_EXC_NAMES = frozenset({
    "TimeoutError",
    "TimeoutException",
    "ReadTimeout",
    "WriteTimeout",
    "ConnectTimeout",
    "PoolTimeout",
    "ConnectError",
    "NetworkError",
    "RemoteProtocolError",
})


def _is_transient(exc: BaseException) -> bool:
    """Classify upstream failures as retry-worthy.

    Retries: explicit timeout/connection exception classes, or a message
    containing a rate-limit signal or a 429/5xx HTTP status at a word
    boundary. Substring hits like `"500 items"` or prose mentioning
    `"connection string"` no longer force 3 × silent retries.
    """
    if type(exc).__name__ in _TRANSIENT_EXC_NAMES:
        return True
    msg = str(exc).lower()
    if "no image in openrouter response" in msg:
        return True
    if "rate limit" in msg or "rate_limit" in msg:
        return True
    return _TRANSIENT_STATUS_RE.search(msg) is not None


def _sanitized_error(exc: BaseException) -> str:
    """Prepare upstream exception messages for SSE. Strips credential-ish
    tokens AND absolute filesystem paths before echoing to the client.
    Full detail still goes to server logs.

    Scrub coverage (widened 030 — security-reviewer finding):
    - Authorization / Bearer / api_key= / x-api-key style headers
    - sk- + sk-ant- Anthropic keys
    - x-*-api-key header-style custom keys
    - ?api-key=, ?key=, ?token= query-string forms
    - /home/..., /Users/... absolute paths (backend directory layout)
    """
    name = type(exc).__name__
    msg = str(exc) or repr(exc)
    logger.warning("inpaint/gen error %s: %s", name, msg)
    scrubbed = msg
    # `Bearer <token>` (and `bearer`) with or without a preceding label
    # — catches both `Authorization: Bearer X` and bare `Bearer X`.
    scrubbed = re.sub(
        r"(?i)\b(bearer)\s+\S+",
        r"\1 <redacted>",
        scrubbed,
    )
    # Header-style tokens: `Authorization: X`, `x-api-key: X`, etc.
    scrubbed = re.sub(
        r"(?i)(authorization|x-[a-z-]*api[_-]?key|x-[a-z-]*key|api[_-]?key)\s*[:=]\s*\S+",
        r"\1: <redacted>",
        scrubbed,
    )
    # Query-string tokens: `?api-key=...`, `?key=...`, `?token=...`, `&key=...`.
    scrubbed = re.sub(
        r"(?i)([?&])(api[_-]?key|key|token)=[^&\s\"]+",
        r"\1\2=<redacted>",
        scrubbed,
    )
    # Raw key-shaped tokens: sk-... and sk-ant-... specifically.
    scrubbed = re.sub(r"sk-ant-[A-Za-z0-9_\-]{10,}", "<redacted-key>", scrubbed)
    scrubbed = re.sub(r"sk-[A-Za-z0-9_\-]{10,}", "<redacted-key>", scrubbed)
    # Absolute filesystem paths — backend directory layout leak.
    scrubbed = re.sub(r"/home/[A-Za-z0-9_\-./]+", "<redacted-path>", scrubbed)
    scrubbed = re.sub(r"/Users/[A-Za-z0-9_\-./]+", "<redacted-path>", scrubbed)
    if len(scrubbed) > 400:
        scrubbed = scrubbed[:400] + "\u2026"
    return f"{name}: {scrubbed}"


def _startup_error_event(message: str, *, code: str = "startup_error") -> dict:
    return {
        "event": "inpaint_error",
        "data": json.dumps({"error": message, "code": code}),
    }


class OperationCancelled(Exception):
    """Raised from `_with_retries_and_timeout` when `cancel_event` fires
    between retry attempts. Not an error: signals cooperative cancellation
    when the client disconnects. Orchestrators translate this into an
    'orphaned' dog status (distinct from 'error') so the UI can tell a
    user-interrupted run apart from a provider failure."""


class SemaphoreExhaustedError(RuntimeError):
    """Raised when the GEMINI_SEMAPHORE timed acquire expires. Distinct
    class (not a TimeoutError subclass) so it isn't caught by the outer
    `except FutureTimeoutError` and doesn't spuriously retry — a wedged
    upstream will not unwedge from a client retry, so surfacing fast is
    the right behaviour. In Python 3.11+ `concurrent.futures.TimeoutError`
    IS the builtin `TimeoutError`, so a subclass chain would collide."""


def _with_retries_and_timeout(
    fn,
    *args,
    on_attempt=None,
    cancel_event: threading.Event | None = None,
    **kwargs,
):
    """Run `fn(*args, **kwargs)` with per-attempt timeout + backoff retry.
    Intended for the sync Gemini calls that execute inside the thread
    pool. Raises the last exception if all attempts fail.

    `on_attempt`, if provided, is called as `on_attempt(attempt_idx, exc)`
    just before each backoff sleep (i.e. once per failure that will be
    retried). Callers use this to surface retry progress to the SSE
    stream so the UI can render "retrying 2/3" instead of silent dead
    air during the up-to-9-minute retry window.

    `cancel_event`, if provided, enables cooperative cancellation between
    retry attempts. `Event.wait(timeout=sleep_s)` replaces `time.sleep`,
    so a disconnect during a 6 s backoff wake interrupts immediately
    instead of burning the full window. Raises `OperationCancelled` on
    fire — callers distinguish this from real errors to mark the item
    as 'orphaned' rather than 'error'.
    """
    last_exc = None
    for attempt in range(_MAX_ATTEMPTS):
        if cancel_event is not None and cancel_event.is_set():
            raise OperationCancelled()
        try:
            # Acquire the provider permit in THIS thread, BEFORE the timeout
            # clock starts (ledger 054 #17): queueing + calling inside one
            # future made the outer 360s clock include semaphore WAIT, so
            # after a long queue the inner 300s httpx call could outlive the
            # outer cap — breaking the documented inner<outer invariant and
            # letting the retry start a DUPLICATE PAID call while the old one
            # kept running server-side. Queue wait keeps its own timed
            # acquire (so the 9th/10th dog of a batch still queues instead of
            # failing, and a genuinely wedged upstream still surfaces).
            provider_permit = GEMINI_SEMAPHORE
            if not provider_permit.acquire(timeout=_GEMINI_CALL_TIMEOUT_S):
                raise SemaphoreExhaustedError(
                    "gemini concurrency exhausted — upstream likely wedged"
                )

            def _held_call():
                # The permit is released by the WORKER when the call truly
                # finishes — a timed-out-but-still-running call keeps its
                # permit so we never over-admit into a wedged provider.
                try:
                    return fn(*args, **kwargs)
                finally:
                    provider_permit.release()

            # Submit to the shared long-lived timeout pool and wait with
            # a per-call cap. Do NOT use the pool as a context manager
            # here: we don't want to block on the submit-site when the
            # provider wedges — fut.cancel() + move on is the point.
            try:
                fut = _ensure_timeout_executor().submit(_held_call)
            except BaseException:
                provider_permit.release()  # _held_call never ran
                raise
            return fut.result(timeout=_GEMINI_CALL_TIMEOUT_S)
        except FutureTimeoutError as exc:
            # Permit accounting: exactly one release per acquire. cancel()
            # returning True means the future never STARTED, so _held_call's
            # finally will never run — release here. False means it is
            # running/finished and the worker releases.
            if fut.cancel():
                provider_permit.release()
            last_exc = TimeoutError(f"provider call timed out after {_GEMINI_CALL_TIMEOUT_S:.0f}s")
            exc = last_exc
            if attempt + 1 >= _MAX_ATTEMPTS:
                raise last_exc
            sleep_s = _BACKOFF_BASE_S * (2 ** attempt) + random.uniform(0, 0.5)
            logger.warning(
                "transient error on attempt %d/%d: %s — retrying in %.1fs",
                attempt + 1, _MAX_ATTEMPTS, exc, sleep_s,
            )
            if on_attempt is not None:
                try:
                    on_attempt(attempt, exc)
                except Exception:  # noqa: BLE001
                    # Progress-reporting must never fail the underlying call.
                    logger.exception("on_attempt callback raised; ignoring")
            if cancel_event is not None:
                if cancel_event.wait(timeout=sleep_s):
                    raise OperationCancelled()
            else:
                time.sleep(sleep_s)
        except OperationCancelled:
            raise
        except Exception as exc:  # noqa: BLE001 — we do want broad catch
            last_exc = exc
            if attempt + 1 >= _MAX_ATTEMPTS or not _is_transient(exc):
                raise
            sleep_s = _BACKOFF_BASE_S * (2 ** attempt) + random.uniform(0, 0.5)
            logger.warning(
                "transient error on attempt %d/%d: %s — retrying in %.1fs",
                attempt + 1, _MAX_ATTEMPTS, exc, sleep_s,
            )
            if on_attempt is not None:
                try:
                    on_attempt(attempt, exc)
                except Exception:  # noqa: BLE001
                    logger.exception("on_attempt callback raised; ignoring")
            if cancel_event is not None:
                if cancel_event.wait(timeout=sleep_s):
                    raise OperationCancelled()
            else:
                time.sleep(sleep_s)
    # unreachable, but satisfy type checkers
    raise last_exc  # type: ignore[misc]

# See routes.py for the same pattern + rationale (UUIDs vs script-generated ids).
SESSION_ID_RE = re.compile(r"^[a-z0-9_-]{3,120}$")


def _validate_session_id(session_id: str) -> None:
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(400, detail={"error": "Invalid session ID format"})


class InpaintError(Exception):
    """Wraps inpaint/generate failures with the source item index for
    error reporting. Used for both background generation (index = bg
    slot) and per-dog inpaint (index = dog index). Module-scoped so
    `except InpaintError` can be used instead of duck-typing the
    index attribute. Renamed from `dog_index` to `item_index` because
    the exception class is shared between bg and dog code paths.
    """
    def __init__(self, item_index: int, cause: BaseException, item_indices: list[int] | None = None):
        self.item_index = item_index
        self.item_indices = item_indices or [item_index]
        self.cause = cause
        super().__init__(str(cause))


def _atomic_save_image(img: Image.Image, path) -> None:
    """Save a PIL image via a tmp sibling + os.replace so readers never
    see a truncated PNG mid-write. Path may be str or pathlib.Path.

    The tmp suffix includes pid + a uuid fragment so concurrent callers
    don't collide on the same tmp name (same fix as save_hitboxes in
    commit 8afd02ba — overlapping `recomposite_color` invocations from
    regen + variant swaps were corrupting
    color.png via tmp-dentry races).
    """
    from pathlib import Path as _P
    p = _P(path)
    ext = p.suffix.lstrip(".") or "tmp"
    # e.g. color.png → color.tmp-png-{pid}-{uuid4}. Keeps a recognisable
    # image suffix so PIL's format-from-extension inference still works.
    tmp = p.with_suffix(f".tmp-{ext}-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    fmt = ext.upper().replace("JPG", "JPEG") if ext else None
    try:
        if fmt:
            img.save(tmp, format=fmt)
        else:
            img.save(tmp)
        tmp.replace(p)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            logger.warning("failed to cleanup tmp file %s", tmp)


def _atomic_copy_file(src, dst) -> None:
    """Byte-copy an already-encoded file with the same tmp+replace discipline
    as _atomic_save_image — used where two artifacts are byte-identical so the
    second doesn't pay a fresh PNG encode."""
    import shutil
    from pathlib import Path as _P
    s, d = _P(src), _P(dst)
    ext = d.suffix.lstrip(".") or "tmp"
    tmp = d.with_suffix(f".tmp-{ext}-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        shutil.copyfile(s, tmp)
        tmp.replace(d)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            logger.warning("failed to cleanup tmp file %s", tmp)


def _isolate_variant_crop(
    clean_crop: Image.Image,
    painted: Image.Image,
    dog_mask: Image.Image,
) -> Image.Image:
    """Return a single-dog variant crop against the clean background.

    Sequential passes intentionally let later crops see earlier dogs as
    context. The variant saved for one hitbox must not permanently include
    those neighboring dogs, otherwise selecting "No variant" for the neighbor
    cannot remove it during recomposite.
    """
    isolated = clean_crop.convert("RGB").copy()
    isolated.paste(painted, (0, 0), mask=dog_mask)
    return isolated


def _subject_only_composite_mask(
    *,
    clean_crop: Image.Image,
    painted: Image.Image,
    dog_mask: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image | None:
    """Replace a broad provider diff with a compact subject-only mask.

    Image-edit providers may redraw most of a crop. Pasting that diff creates
    rectangular panels, seams, guide fragments, and cut-off scenery. Compact
    diffs can pass through; broad or edge-touching diffs must be semantically
    isolated or fail closed.
    """
    stats = _alpha_stats(dog_mask)
    if not bool(stats["fullCropLike"]) and int(stats["edgeTouches"]) < 2:
        return dog_mask

    repairers = (
        lambda: _sam2_sprite_alpha(painted, hitbox, box, relaxed=True),
        lambda: _semantic_sprite_alpha(
            clean_crop, painted, hitbox, box, relaxed=True
        ),
        lambda: _color_seeded_sprite_alpha(clean_crop, painted, hitbox, box),
        lambda: _sam_sprite_alpha(painted, hitbox, box, relaxed=True),
        lambda: _seeded_grabcut_sprite_alpha(
            clean_crop, painted, hitbox, box
        ),
        lambda: _localized_hitbox_sprite_alpha(
            clean_crop, painted, hitbox, box
        ),
    )
    for repair in repairers:
        repaired = repair()
        if repaired is not None:
            dog_mask.close()
            return repaired
    return None


def _clean_sprite_alpha(
    dog_mask: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image:
    """Return a tighter alpha mask for the pickup sprite.

    The inpaint diff mask is intentionally broad enough to preserve the
    composited dog, but model edits can include tiny background speckles. For
    the collected sprite we keep connected components that overlap the hitbox
    core and discard isolated flecks before trimming the transparent bounds.
    """
    alpha = dog_mask.convert("L").filter(ImageFilter.MedianFilter(size=3))
    arr = np.array(alpha, dtype=np.uint8) > 0
    if not arr.any():
        return alpha

    height, width = arr.shape
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    yy, xx = np.ogrid[:height, :width]
    core_radius = max(4.0, float(hitbox.radius) * 1.15)
    core = ((xx - local_cx) ** 2 + (yy - local_cy) ** 2) <= core_radius ** 2
    # Tightened (plan 2026-07-31-002 U7): the 2.6r / 0.025r² zone admitted
    # crumb specks (droppings, detached feet, paint flecks) that shipped in
    # pickup sprites across the audited corpus. Held tools survive because
    # they touch the hitbox core; only detached debris rides on these limits.
    max_component_distance = max(8.0, float(hitbox.radius) * 1.8)
    min_component_area = max(24, int(float(hitbox.radius) * float(hitbox.radius) * 0.06))

    visited = np.zeros(arr.shape, dtype=bool)
    keep = np.zeros(arr.shape, dtype=bool)
    starts = np.argwhere(arr)
    for start_y, start_x in starts:
        if visited[start_y, start_x]:
            continue

        stack = [(int(start_y), int(start_x))]
        ys: list[int] = []
        xs: list[int] = []
        touches_core = False
        visited[start_y, start_x] = True

        while stack:
            y, x = stack.pop()
            ys.append(y)
            xs.append(x)
            if core[y, x]:
                touches_core = True
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if visited[ny, nx] or not arr[ny, nx]:
                        continue
                    visited[ny, nx] = True
                    stack.append((ny, nx))

        area = len(xs)
        centroid_x = sum(xs) / area
        centroid_y = sum(ys) / area
        distance = ((centroid_x - local_cx) ** 2 + (centroid_y - local_cy) ** 2) ** 0.5
        if touches_core or (area >= min_component_area and distance <= max_component_distance):
            keep[ys, xs] = True

    if not keep.any():
        keep = arr

    cleaned = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
    return cleaned.filter(ImageFilter.GaussianBlur(radius=0.45))


def _core_connected_sprite_alpha(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image:
    arr = np.array(alpha.convert("L"), dtype=np.uint8) >= 18
    if not arr.any():
        return alpha

    height, width = arr.shape
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    yy, xx = np.ogrid[:height, :width]
    core_radius = max(4.0, float(hitbox.radius) * 0.82)
    core = ((xx - local_cx) ** 2 + (yy - local_cy) ** 2) <= core_radius ** 2

    visited = np.zeros(arr.shape, dtype=bool)
    keep = np.zeros(arr.shape, dtype=bool)
    starts = np.argwhere(arr)
    for start_y, start_x in starts:
        if visited[start_y, start_x]:
            continue

        stack = [(int(start_y), int(start_x))]
        ys: list[int] = []
        xs: list[int] = []
        touches_core = False
        visited[start_y, start_x] = True

        while stack:
            y, x = stack.pop()
            ys.append(y)
            xs.append(x)
            if core[y, x]:
                touches_core = True
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if visited[ny, nx] or not arr[ny, nx]:
                        continue
                    visited[ny, nx] = True
                    stack.append((ny, nx))

        if touches_core:
            keep[ys, xs] = True

    if not keep.any():
        return alpha

    alpha.close()
    cleaned = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
    return cleaned.filter(ImageFilter.GaussianBlur(radius=0.45)).point(lambda v: 0 if v < 18 else v)


def _limit_alpha_to_hitbox_extent(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    scale_x: float = 1.15,
    scale_y: float = 1.32,
) -> Image.Image:
    arr = np.array(alpha.convert("L"), dtype=np.uint8)
    if not arr.any():
        return alpha

    height, width = arr.shape
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius))
    yy, xx = np.ogrid[:height, :width]
    extent = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * scale_x) ** 2)
        + ((yy - local_cy) ** 2) / max(1.0, (radius * scale_y) ** 2)
    ) <= 1.0
    arr[~extent] = 0
    alpha.close()
    return Image.fromarray(arr, mode="L").filter(ImageFilter.GaussianBlur(radius=0.35)).point(lambda v: 0 if v < 18 else v)


def _alpha_overlaps_hitbox_core(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    radius_scale: float = 1.05,
) -> bool:
    arr = np.array(alpha.convert("L"), dtype=np.uint8) >= 24
    if not arr.any():
        return False

    height, width = arr.shape
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    yy, xx = np.ogrid[:height, :width]
    radius = max(4.0, float(hitbox.radius) * radius_scale)
    core = ((xx - local_cx) ** 2 + (yy - local_cy) ** 2) <= radius ** 2
    return bool((arr & core).any())


def _alpha_stats(alpha: Image.Image) -> dict[str, float | int | bool]:
    arr = np.array(alpha.convert("L"), dtype=np.uint8)
    visible = arr >= 24
    strong = arr >= 180
    bbox = Image.fromarray((visible.astype(np.uint8) * 255), mode="L").getbbox()
    area = max(1, arr.shape[0] * arr.shape[1])
    if bbox is None:
        return {
            "visibleCoverage": 0.0,
            "strongCoverage": 0.0,
            "bboxCoverage": 0.0,
            "edgeTouches": 0,
            "fullCropLike": False,
        }

    bbox_area = max(1, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    edge_touches = int(bbox[0] <= 0) + int(bbox[1] <= 0) + int(bbox[2] >= arr.shape[1]) + int(bbox[3] >= arr.shape[0])
    visible_coverage = float(visible.sum()) / area
    strong_coverage = float(strong.sum()) / area
    bbox_coverage = float(bbox_area) / area
    return {
        "visibleCoverage": visible_coverage,
        "strongCoverage": strong_coverage,
        "bboxCoverage": bbox_coverage,
        "edgeTouches": edge_touches,
        "fullCropLike": bool(edge_touches >= 4 and (strong_coverage >= 0.55 or visible_coverage >= 0.85)),
    }


def _soft_sprite_alpha(
    clean_crop: Image.Image,
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image:
    """Return adaptive alpha for crops where binary diff grabs the scenery.

    Some image edits repaint leaves, paths, or water across the whole padded
    crop. A binary diff then lifts an opaque square. For pickup animation,
    preserve strong changes as opaque pixels, fade weaker changes, and apply a
    soft spatial prior around the hitbox only when the mask is full-crop-like.
    This is intentionally conservative: it does not claim perfect semantic
    segmentation, but it prevents exported sprites from becoming opaque crop
    cards.
    """
    before = np.array(clean_crop.convert("RGB"), dtype=np.int16)
    after = np.array(painted.convert("RGB"), dtype=np.int16)
    if before.shape != after.shape:
        return Image.new("L", painted.size, 0)

    diff = np.abs(after - before).max(axis=2).astype(np.float32)
    changed = diff[diff > 5]
    if changed.size == 0:
        return Image.new("L", painted.size, 0)

    low = max(18.0, float(np.percentile(changed, 42)))
    high = max(low + 16.0, float(np.percentile(changed, 96)))
    strength = np.clip((diff - low) / (high - low), 0.0, 1.0) ** 0.72

    rough = Image.fromarray((strength * 255).astype(np.uint8), mode="L")
    if _alpha_stats(rough)["fullCropLike"]:
        height, width = diff.shape
        local_cx = float(hitbox.x - box[0])
        local_cy = float(hitbox.y - box[1])
        yy, xx = np.ogrid[:height, :width]
        dist = np.sqrt((xx - local_cx) ** 2 + (yy - local_cy) ** 2)
        radius = max(1.0, float(hitbox.radius))
        falloff = np.clip(1.0 - (dist / (radius * 2.35)) ** 2, 0.0, 1.0)
        strength *= np.maximum(falloff, 0.22)

    alpha_arr = (strength * 255).astype(np.uint8)
    alpha_arr[alpha_arr < 18] = 0
    alpha = Image.fromarray(alpha_arr, mode="L")
    alpha = alpha.filter(ImageFilter.MedianFilter(size=3)).filter(ImageFilter.GaussianBlur(radius=0.45))
    return alpha.point(lambda v: 0 if v < 14 else v)


def _is_cutout_alpha_usable(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> bool:
    bbox = alpha.getbbox()
    if bbox is None:
        return False

    stats = _alpha_stats(alpha)
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    radius = max(4.0, float(hitbox.radius))
    # The old absolute 90/96px caps were tuned for legacy r~30 hitboxes and
    # rejected every correctly-sized bird on 4K levels (r=136), silently
    # routing all cutouts through the relaxed repair lane (U7 finding). The
    # radius-relative caps below are the real oversize guard.
    if bbox_width > radius * 2.45 or bbox_height > radius * 2.55:
        return False
    if bool(stats["fullCropLike"]):
        return False
    if int(stats["edgeTouches"]) >= 3:
        return False
    if float(stats["bboxCoverage"]) >= 0.62:
        return False
    if float(stats["visibleCoverage"]) >= 0.42:
        return False
    return _alpha_overlaps_hitbox_core(alpha, hitbox, box)


def _is_openai_cutout_alpha_usable(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> bool:
    """OpenAI masked edits produce broader but still centered diffs.

    The standard cutout gate was tuned around tighter Gemini/Fal masks and
    rejects normal full-body dogs from OpenAI as "too large". Keep the same
    center/edge/full-crop protections, but allow a larger silhouette.
    """
    bbox = alpha.getbbox()
    if bbox is None:
        return False

    stats = _alpha_stats(alpha)
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    radius = max(4.0, float(hitbox.radius))
    if bool(stats["fullCropLike"]):
        return False
    if int(stats["edgeTouches"]) >= 3:
        return False
    if bbox_width < radius * 0.55 or bbox_height < radius * 0.55:
        return False
    if bbox_width > radius * 3.4 or bbox_height > radius * 3.6:
        return False
    if float(stats["bboxCoverage"]) >= 0.52:
        return False
    if float(stats["visibleCoverage"]) >= 0.24:
        return False
    return _alpha_overlaps_hitbox_core(alpha, hitbox, box, radius_scale=1.45)


def _is_provider_cutout_alpha_usable(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    model: str | None,
) -> bool:
    if model is not None and model.startswith("openai/"):
        return _is_openai_cutout_alpha_usable(alpha, hitbox, box)
    return _is_cutout_alpha_usable(alpha, hitbox, box)


def _openai_inpaint_prompt(prompt: str) -> str:
    return (
        f"{prompt}\n\n"
        "For masked editing, treat the transparent area as placement room, not as a shape to fill. "
        "Keep exactly one subject centered on the hitbox, but make the subject occupy roughly 55-70% of the editable area "
        "and leave surrounding background visible where the subject's body does not cover it. "
        "Preserve the source background exactly everywhere the subject's body is not visible. "
        "Do not repaint, replace, redesign, stylize, blur, clean up, or add scenery, props, vegetation, rocks, shadows, paths, water, or texture. "
        "Only add the subject; all visible non-subject pixels should remain the original background."
    )


def _draw_provider_inpaint_mask(
    draw: ImageDraw.ImageDraw,
    hitboxes: list[Hitbox],
    box: tuple[int, int, int, int],
    *,
    model: str,
) -> None:
    for hb in hitboxes:
        cx = hb.x - box[0]
        cy = hb.y - box[1]
        if model.startswith("openai/"):
            rx = hb.radius * 1.28
            ry = hb.radius * 1.65
            center_y = cy - hb.radius * 0.08
            draw.ellipse((cx - rx, center_y - ry, cx + rx, center_y + ry), fill=255)
        else:
            draw.ellipse(
                (cx - hb.radius, cy - hb.radius, cx + hb.radius, cy + hb.radius),
                fill=255,
            )








def _is_extracted_alpha_usable(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> bool:
    bbox = alpha.getbbox()
    if bbox is None:
        return False

    stats = _alpha_stats(alpha)
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    radius = max(4.0, float(hitbox.radius))
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    center_slack = max(3.0, radius * 0.12)
    if (
        local_cx < bbox[0] - center_slack
        or local_cx > bbox[2] + center_slack
        or local_cy < bbox[1] - center_slack
        or local_cy > bbox[3] + center_slack
    ):
        return False
    center_margin = max(2.0, radius * 0.06)
    if (
        local_cx <= bbox[0] + center_margin
        or local_cx >= bbox[2] - center_margin
        or local_cy <= bbox[1] + center_margin
        or local_cy >= bbox[3] - center_margin
    ):
        return False
    if bbox_width < radius * 0.7 or bbox_height < radius * 0.7:
        return False
    if bool(stats["fullCropLike"]):
        return False
    if int(stats["edgeTouches"]) >= 3:
        return False
    if bbox_width > max(92.0, radius * 3.2) or bbox_height > max(104.0, radius * 3.4):
        return False
    if float(stats["bboxCoverage"]) >= 0.52:
        return False
    if float(stats["visibleCoverage"]) >= 0.34:
        return False
    return _alpha_overlaps_hitbox_core(alpha, hitbox, box, radius_scale=1.55)


def _pickup_cutout_session():
    global _PICKUP_CUTOUT_SESSION
    if _PICKUP_CUTOUT_SESSION is None:
        from rembg import new_session

        _PICKUP_CUTOUT_SESSION = new_session(_PICKUP_CUTOUT_MODEL)
    return _PICKUP_CUTOUT_SESSION


def _pickup_sam_session():
    global _PICKUP_SAM_SESSION
    if _PICKUP_SAM_SESSION is None:
        from rembg import new_session

        _PICKUP_SAM_SESSION = new_session(
            _PICKUP_SAM_MODEL,
            sam_model=_PICKUP_SAM_MODEL_NAME,
            sam_quant=True,
        )
    return _PICKUP_SAM_SESSION


class RemoteSam2Predictor:
    """SAM2 over HTTP (the pato 4090 service, scripts/pato-judge/sam2_server.py).

    Satisfies the Sam2Predictor protocol so _sam2_sprite_alpha works unchanged
    on hosts without a local sam2 install. Reach the service through an SSH
    tunnel: `ssh -f -N -L 8977:localhost:8977 ubuntu-server`, then set
    FTD_SAM2_URL=http://localhost:8977.
    """

    def __init__(self, base_url: str, timeout_s: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._image: np.ndarray | None = None

    def set_image(self, image: np.ndarray) -> None:
        self._image = image

    def predict(
        self,
        *,
        point_coords: np.ndarray,
        point_labels: np.ndarray,
        box: np.ndarray,
        multimask_output: bool = True,
    ):
        import base64
        import io

        import httpx

        if self._image is None:
            raise RuntimeError("set_image was not called")
        buffer = io.BytesIO()
        Image.fromarray(self._image).save(buffer, format="PNG")
        response = httpx.post(
            f"{self.base_url}/predict",
            json={
                "image_png_b64": base64.b64encode(buffer.getvalue()).decode(),
                "point": point_coords.tolist(),
                "point_labels": [int(v) for v in np.asarray(point_labels).ravel()],
                "box": [float(v) for v in np.asarray(box).ravel()],
                "multimask_output": multimask_output,
            },
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        payload = response.json()
        shape = tuple(payload["shape"])
        packed = np.frombuffer(
            base64.b64decode(payload["masks_packed_b64"]), dtype=np.uint8
        )
        total = int(np.prod(shape))
        masks = np.unpackbits(packed, count=total).reshape(shape).astype(bool)
        return masks, np.array(payload["scores"], dtype=np.float32), None


def _pickup_sam2_predictor() -> Sam2Predictor | None:
    global _PICKUP_SAM2_FAILED, _PICKUP_SAM2_PREDICTOR
    if _PICKUP_SAM2_FAILED:
        return None
    if _PICKUP_SAM2_PREDICTOR is not None:
        return _PICKUP_SAM2_PREDICTOR

    remote_url = os.environ.get("FTD_SAM2_URL")
    if remote_url:
        with _PICKUP_SAM2_LOCK:
            if _PICKUP_SAM2_PREDICTOR is None:
                _PICKUP_SAM2_PREDICTOR = RemoteSam2Predictor(remote_url)
            return _PICKUP_SAM2_PREDICTOR

    checkpoint = os.environ.get("FTD_PICKUP_SAM2_CHECKPOINT")
    if not checkpoint:
        return None
    with _PICKUP_SAM2_LOCK:
        if _PICKUP_SAM2_PREDICTOR is not None:
            return _PICKUP_SAM2_PREDICTOR
        if _PICKUP_SAM2_FAILED:
            return None
        try:
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
        except ModuleNotFoundError:
            logger.warning("SAM2 is unavailable; cannot run SAM2 pickup cutout")
            _PICKUP_SAM2_FAILED = True
            return None

        model_config = os.environ.get("FTD_PICKUP_SAM2_MODEL_CONFIG", "configs/sam2.1/sam2.1_hiera_l.yaml")
        device = os.environ.get("FTD_PICKUP_SAM2_DEVICE", "cuda")
        try:
            model = build_sam2(model_config, checkpoint, device=device)
            _PICKUP_SAM2_PREDICTOR = SAM2ImagePredictor(model)
        except Exception:
            logger.exception("SAM2 pickup cutout initialization failed")
            _PICKUP_SAM2_FAILED = True
            return None
        return _PICKUP_SAM2_PREDICTOR


def _sam2_predict_timeout_s() -> float:
    raw = os.environ.get("FTD_PICKUP_SAM2_TIMEOUT_S")
    if raw is None:
        return 120.0
    try:
        return max(0.01, float(raw))
    except ValueError:
        logger.warning("invalid FTD_PICKUP_SAM2_TIMEOUT_S=%r; using default", raw)
        return 120.0


def _disable_sam2_pickup() -> None:
    global _PICKUP_SAM2_FAILED
    with _PICKUP_SAM2_LOCK:
        _PICKUP_SAM2_FAILED = True


def _sam2_prompt_box(
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    box_scale: float = 0.75,
) -> tuple[np.ndarray, np.ndarray]:
    width, height = painted.size
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius)) * box_scale
    point = np.array(
        [[min(float(width - 1), max(0.0, local_cx)), min(float(height - 1), max(0.0, local_cy))]],
        dtype=np.float32,
    )
    prompt_box = np.array(
        [
            max(0.0, local_cx - radius),
            max(0.0, local_cy - radius),
            min(float(width - 1), local_cx + radius),
            min(float(height - 1), local_cy + radius),
        ],
        dtype=np.float32,
    )
    if prompt_box[2] <= prompt_box[0]:
        prompt_box[2] = min(float(width - 1), prompt_box[0] + 1.0)
    if prompt_box[3] <= prompt_box[1]:
        prompt_box[3] = min(float(height - 1), prompt_box[1] + 1.0)
    return point, prompt_box


def _keep_prompt_component(mask: np.ndarray, point: np.ndarray) -> np.ndarray:
    if mask.ndim != 2:
        return mask
    height, width = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    point_x = int(round(float(point[0][0])))
    point_y = int(round(float(point[0][1])))
    best_component: list[tuple[int, int]] = []
    best_distance: int | None = None
    for start_y in range(height):
        for start_x in range(width):
            if visited[start_y, start_x] or not mask[start_y, start_x]:
                continue
            stack = [(start_x, start_y)]
            visited[start_y, start_x] = True
            component: list[tuple[int, int]] = []
            component_distance: int | None = None
            contains_point = False
            while stack:
                x, y = stack.pop()
                component.append((x, y))
                if x == point_x and y == point_y:
                    contains_point = True
                distance = (x - point_x) ** 2 + (y - point_y) ** 2
                if component_distance is None or distance < component_distance:
                    component_distance = distance
                for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and not visited[next_y, next_x]
                        and mask[next_y, next_x]
                    ):
                        visited[next_y, next_x] = True
                        stack.append((next_x, next_y))
            if contains_point:
                best_component = component
                best_distance = 0
                break
            if component_distance is not None and (
                best_distance is None
                or component_distance < best_distance
                or (component_distance == best_distance and len(component) > len(best_component))
            ):
                best_component = component
                best_distance = component_distance
        if best_distance == 0:
            break

    cleaned = np.zeros(mask.shape, dtype=bool)
    for x, y in best_component:
        cleaned[y, x] = True
    return cleaned


def _sam2_sprite_alpha(
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    relaxed: bool = False,
    box_scale: float = 0.75,
    point_override: tuple[float, float] | None = None,
) -> Image.Image | None:
    predictor = _pickup_sam2_predictor()
    if predictor is None:
        return None

    point, prompt_box = _sam2_prompt_box(painted, hitbox, box, box_scale=box_scale)
    if point_override is not None:
        width, height = painted.size
        point = np.array(
            [[min(float(width - 1), max(0.0, point_override[0])),
              min(float(height - 1), max(0.0, point_override[1]))]],
            dtype=np.float32,
        )
    rgb = np.array(painted.convert("RGB"))

    def _predict() -> tuple[np.ndarray, np.ndarray, Any]:
        with _PICKUP_SAM2_LOCK:
            predictor.set_image(rgb)
            return predictor.predict(
                point_coords=point,
                point_labels=np.array([1], dtype=np.int32),
                box=prompt_box,
                multimask_output=True,
            )

    try:
        future = _timeout_executor.submit(_predict)
        masks, scores, _ = future.result(timeout=_sam2_predict_timeout_s())
    except FutureTimeoutError:
        future.cancel()
        if isinstance(predictor, RemoteSam2Predictor):
            # A remote predictor timeout is a per-call network transient, not a
            # broken local model — latching here silently degraded a whole
            # 280-dog recut batch to weak fallbacks after one tunnel hiccup.
            logger.warning("remote SAM2 predict timed out; retry next call")
            return None
        logger.exception("SAM2 pickup sprite cutout timed out; disabling SAM2 fallback")
        _disable_sam2_pickup()
        return None
    except Exception:
        logger.exception("SAM2 pickup sprite cutout failed")
        return None

    if masks.size == 0:
        return None
    mask_index = int(np.argmax(scores)) if getattr(scores, "size", 0) else 0
    mask = masks[mask_index].astype(bool)
    mask = _keep_prompt_component(mask, point)
    alpha = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    alpha = alpha.filter(ImageFilter.MedianFilter(size=3))
    alpha = alpha.point(lambda v: 0 if v < 18 else v)
    cleaned = _clean_sprite_alpha(alpha, hitbox, box)
    alpha.close()
    usable = (
        _is_extracted_alpha_usable(cleaned, hitbox, box)
        if relaxed
        else _is_cutout_alpha_usable(cleaned, hitbox, box)
    )
    if not usable:
        cleaned.close()
        return None
    return cleaned


def _semantic_sprite_alpha(
    clean_crop: Image.Image | None,
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    relaxed: bool = False,
) -> Image.Image | None:
    """Return an animal-only alpha using a semantic background remover.

    Diff masks fail when the inpaint model repaints the local scenery around
    the animal. In those cases color/geometry alone can keep the branch or
    leaf the dog is sitting on. The semantic pass is only used as a repair
    layer for those failed masks, then still goes through our hitbox-overlap
    and compactness gates before becoming exported metadata.
    """
    try:
        from rembg import remove
    except ImportError:
        logger.warning("rembg is unavailable; cannot repair pickup sprite cutout")
        return None

    source = painted.convert("RGB")
    try:
        with _PICKUP_CUTOUT_LOCK:
            result = remove(
                source,
                session=_pickup_cutout_session(),
                alpha_matting=False,
                post_process_mask=True,
            )
    except Exception:
        logger.exception("semantic pickup sprite cutout failed")
        return None
    finally:
        source.close()

    if not isinstance(result, Image.Image):
        return None

    try:
        alpha = result.convert("RGBA").getchannel("A")
    finally:
        result.close()

    if alpha.size != painted.size:
        alpha = alpha.resize(painted.size, Image.LANCZOS)

    alpha = alpha.filter(ImageFilter.MedianFilter(size=3))
    alpha = alpha.point(lambda v: 0 if v < 18 else v)
    if clean_crop is not None:
        alpha = _refine_semantic_alpha_with_diff(clean_crop, painted, alpha)
    alpha = _core_connected_sprite_alpha(alpha, hitbox, box)
    cleaned = _clean_sprite_alpha(alpha, hitbox, box)
    alpha.close()
    usable = (
        _is_extracted_alpha_usable(cleaned, hitbox, box)
        if relaxed
        else _is_cutout_alpha_usable(cleaned, hitbox, box)
    )
    if not usable:
        cleaned.close()
        return None
    return cleaned


def _sam_prompt_variants(
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> list[list[dict]]:
    width, height = painted.size
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius))

    def clamp_point(x: float, y: float) -> list[float]:
        return [
            min(float(width - 1), max(0.0, x)),
            min(float(height - 1), max(0.0, y)),
        ]

    def prompt(rect_scale_x: float, rect_scale_y: float, points: list[tuple[float, float]]) -> list[dict]:
        prompt_items: list[dict] = [{
            "type": "rectangle",
            "label": 1,
            "data": [
                max(0.0, local_cx - radius * rect_scale_x),
                max(0.0, local_cy - radius * rect_scale_y),
                min(float(width - 1), local_cx + radius * rect_scale_x),
                min(float(height - 1), local_cy + radius * rect_scale_y),
            ],
        }]
        prompt_items.extend(
            {"type": "point", "label": 1, "data": clamp_point(local_cx + x * radius, local_cy + y * radius)}
            for x, y in points
        )
        negative_points = [
            (0.0, 0.0),
            (float(width - 1), 0.0),
            (0.0, float(height - 1)),
            (float(width - 1), float(height - 1)),
            (local_cx - radius * 1.55, local_cy),
            (local_cx + radius * 1.55, local_cy),
            (local_cx, local_cy - radius * 1.55),
            (local_cx, local_cy + radius * 1.55),
        ]
        prompt_items.extend(
            {"type": "point", "label": 0, "data": clamp_point(x, y)}
            for x, y in negative_points
        )
        return prompt_items

    return [
        prompt(1.05, 1.05, [(0.0, 0.0), (0.0, -0.35), (0.0, 0.35), (-0.3, 0.0), (0.3, 0.0)]),
        prompt(0.8, 0.95, [(0.0, 0.0), (0.0, -0.25), (0.0, 0.25)]),
        prompt(0.65, 0.75, [(0.0, 0.0)]),
        prompt(1.2, 1.2, [(0.0, 0.0), (-0.45, -0.15), (0.45, -0.15), (0.0, 0.45)]),
    ]


def _score_sprite_alpha(
    alpha: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> float:
    bbox = alpha.getbbox()
    if bbox is None:
        return -1.0

    stats = _alpha_stats(alpha)
    bbox_width = bbox[2] - bbox[0]
    bbox_height = bbox[3] - bbox[1]
    radius = max(4.0, float(hitbox.radius))
    expected_width = max(1.0, radius * 1.8)
    expected_height = max(1.0, radius * 2.1)
    width_penalty = abs(bbox_width - expected_width) / expected_width
    height_penalty = abs(bbox_height - expected_height) / expected_height
    return (
        1.0
        - float(stats["bboxCoverage"]) * 0.8
        - float(stats["edgeTouches"]) * 0.12
        - width_penalty * 0.12
        - height_penalty * 0.12
    )


def _sam_sprite_alpha(
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    *,
    relaxed: bool = False,
) -> Image.Image | None:
    """Prompt SAM around the hitbox to split the animal from attached props."""
    try:
        from rembg import remove
    except ImportError:
        logger.warning("rembg is unavailable; cannot run SAM pickup repair")
        return None

    best: tuple[float, Image.Image] | None = None
    for prompt in _sam_prompt_variants(painted, hitbox, box):
        source = painted.convert("RGB")
        try:
            with _PICKUP_CUTOUT_LOCK:
                result = remove(
                    source,
                    session=_pickup_sam_session(),
                    alpha_matting=False,
                    post_process_mask=False,
                    sam_prompt=prompt,
                )
        except Exception:
            logger.exception("SAM pickup sprite cutout failed")
            continue
        finally:
            source.close()

        if not isinstance(result, Image.Image):
            continue

        try:
            alpha = result.convert("RGBA").getchannel("A")
        finally:
            result.close()

        if alpha.size != painted.size:
            alpha = alpha.resize(painted.size, Image.LANCZOS)

        alpha = alpha.filter(ImageFilter.MedianFilter(size=3))
        alpha = alpha.point(lambda v: 0 if v < 18 else v)
        alpha = _core_connected_sprite_alpha(alpha, hitbox, box)
        alpha = _limit_alpha_to_hitbox_extent(alpha, hitbox, box)
        cleaned = _clean_sprite_alpha(alpha, hitbox, box)
        alpha.close()
        usable = (
            _is_extracted_alpha_usable(cleaned, hitbox, box)
            if relaxed
            else _is_cutout_alpha_usable(cleaned, hitbox, box)
        )
        if not usable:
            cleaned.close()
            continue
        score = _score_sprite_alpha(cleaned, hitbox, box)
        if best is None or score > best[0]:
            if best is not None:
                best[1].close()
            best = (score, cleaned)
        else:
            cleaned.close()

    return best[1] if best is not None else None


def _localized_hitbox_sprite_alpha(
    clean_crop: Image.Image,
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image | None:
    before = np.array(clean_crop.convert("RGB"), dtype=np.int16)
    after = np.array(painted.convert("RGB"), dtype=np.int16)
    if before.shape != after.shape:
        return None

    height, width = before.shape[:2]
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius))
    yy, xx = np.ogrid[:height, :width]
    prior = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * 1.05) ** 2)
        + ((yy - local_cy) ** 2) / max(1.0, (radius * 1.28) ** 2)
    ) <= 1.0
    diff = np.abs(after - before).max(axis=2).astype(np.float32)
    changed_pixels = diff[diff > 5]
    threshold = max(12.0, float(np.percentile(changed_pixels, 45)) if changed_pixels.size else 12.0)
    keep = prior & (diff >= threshold)
    if int(keep.sum()) < max(18, int(radius * radius * 0.01)):
        keep = prior

    alpha = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
    alpha = alpha.filter(ImageFilter.MaxFilter(size=3)).filter(ImageFilter.MedianFilter(size=3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.45)).point(lambda v: 0 if v < 18 else v)
    cleaned = _clean_sprite_alpha(alpha, hitbox, box)
    alpha.close()
    if not _alpha_overlaps_hitbox_core(cleaned, hitbox, box, radius_scale=1.55):
        cleaned.close()
        return None
    return cleaned


def _refine_semantic_alpha_with_diff(
    clean_crop: Image.Image,
    painted: Image.Image,
    alpha: Image.Image,
) -> Image.Image:
    before = np.array(clean_crop.convert("RGB"), dtype=np.int16)
    after = np.array(painted.convert("RGB"), dtype=np.int16)
    alpha_arr = np.array(alpha.convert("L"), dtype=np.uint8)
    if before.shape != after.shape or alpha_arr.shape != before.shape[:2]:
        return alpha

    visible = alpha_arr >= 24
    if not visible.any():
        return alpha

    diff = np.abs(after - before).max(axis=2).astype(np.float32)
    visible_diff = diff[visible]
    low = max(12.0, min(42.0, float(np.percentile(visible_diff, 8))))
    keep = visible & (diff >= low)
    if int(keep.sum()) < int(visible.sum() * 0.45):
        return alpha

    refined = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
    refined = refined.filter(ImageFilter.MaxFilter(size=3)).filter(ImageFilter.MinFilter(size=3))
    refined = refined.filter(ImageFilter.GaussianBlur(radius=0.45))
    alpha.close()
    return refined.point(lambda v: 0 if v < 18 else v)


def _color_seeded_sprite_alpha(
    clean_crop: Image.Image,
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image | None:
    """Recover small warm animal components when semantic cutout selects scenery."""
    try:
        import cv2
    except ImportError:
        logger.warning("opencv-python-headless is unavailable; cannot run color-seeded pickup repair")
        return None

    before = np.array(clean_crop.convert("RGB"), dtype=np.uint8)
    after = np.array(painted.convert("RGB"), dtype=np.uint8)
    if before.shape != after.shape:
        return None

    height, width = after.shape[:2]
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius))
    yy, xx = np.ogrid[:height, :width]

    diff = np.abs(after.astype(np.int16) - before.astype(np.int16)).max(axis=2).astype(np.float32)
    hsv = cv2.cvtColor(after, cv2.COLOR_RGB2HSV)
    saturation = hsv[:, :, 1].astype(np.float32)
    rgb = after.astype(np.int16)
    warm = (
        (rgb[:, :, 0] > rgb[:, :, 2] + 10)
        & (rgb[:, :, 0] > 80)
        & (saturation > 28)
    )
    extent = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * 1.45) ** 2)
        + ((yy - (local_cy + radius * 0.32)) ** 2) / max(1.0, (radius * 1.45) ** 2)
    ) <= 1.0
    lower_half = yy >= local_cy - radius * 0.35
    threshold = max(18.0, float(np.percentile(diff[extent], 60)) if extent.any() else 18.0)
    candidate = extent & lower_half & (diff >= threshold) & warm

    component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        candidate.astype(np.uint8),
        8,
    )
    min_area = max(8, int(radius * radius * 0.006))
    max_area = int(radius * radius * 1.2)
    components: list[tuple[float, int]] = []
    for component_index in range(1, component_count):
        area = int(stats[component_index, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        comp_width = int(stats[component_index, cv2.CC_STAT_WIDTH])
        comp_height = int(stats[component_index, cv2.CC_STAT_HEIGHT])
        elongation = max(comp_width, comp_height) / max(1, min(comp_width, comp_height))
        centroid_x, centroid_y = centroids[component_index]
        distance = ((centroid_x - local_cx) ** 2 + (centroid_y - local_cy) ** 2) ** 0.5
        score = (
            1.0
            / (1.0 + distance * 0.18)
            * min(1.0, area / max(1.0, radius * radius * 0.18))
            / (1.0 + max(0.0, elongation - 3.0) * 0.5)
        )
        components.append((float(score), component_index))

    if not components:
        return None

    _, anchor_index = max(components)
    anchor_x, anchor_y = centroids[anchor_index]
    keep = np.zeros(candidate.shape, dtype=bool)
    for _, component_index in components:
        centroid_x, centroid_y = centroids[component_index]
        distance = ((centroid_x - anchor_x) ** 2 + (centroid_y - anchor_y) ** 2) ** 0.5
        if component_index == anchor_index or distance <= radius * 0.55:
            keep |= labels == component_index

    alpha = Image.fromarray((keep.astype(np.uint8) * 255), mode="L")
    alpha = alpha.filter(ImageFilter.MaxFilter(size=5)).filter(ImageFilter.MinFilter(size=3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.55))
    alpha = _limit_alpha_to_hitbox_extent(alpha, hitbox, box, scale_x=1.05, scale_y=1.2)
    cleaned = _clean_sprite_alpha(alpha.point(lambda v: 0 if v < 18 else v), hitbox, box)
    alpha.close()
    if not _is_extracted_alpha_usable(cleaned, hitbox, box):
        cleaned.close()
        return None
    return cleaned


def _seeded_grabcut_sprite_alpha(
    clean_crop: Image.Image,
    painted: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
) -> Image.Image | None:
    """Return a compact seeded foreground mask without lifting scene padding."""
    try:
        import cv2
    except ImportError:
        logger.warning("opencv-python-headless is unavailable; cannot run GrabCut pickup repair")
        return None

    before = np.array(clean_crop.convert("RGB"), dtype=np.int16)
    after = np.array(painted.convert("RGB"), dtype=np.int16)
    if before.shape != after.shape:
        return None

    height, width = after.shape[:2]
    local_cx = float(hitbox.x - box[0])
    local_cy = float(hitbox.y - box[1])
    radius = max(4.0, float(hitbox.radius))
    yy, xx = np.ogrid[:height, :width]
    center_y = local_cy - radius * 0.12

    object_extent = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * 1.18) ** 2)
        + ((yy - center_y) ** 2) / max(1.0, (radius * 1.32) ** 2)
    ) <= 1.0
    core = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * 0.58) ** 2)
        + ((yy - center_y) ** 2) / max(1.0, (radius * 0.72) ** 2)
    ) <= 1.0
    inner = (
        ((xx - local_cx) ** 2) / max(1.0, (radius * 0.82) ** 2)
        + ((yy - center_y) ** 2) / max(1.0, (radius * 0.96) ** 2)
    ) <= 1.0

    diff = np.abs(after - before).max(axis=2).astype(np.float32)
    changed = diff > max(20.0, float(np.percentile(diff[diff > 5], 60)) if (diff > 5).any() else 20.0)

    mask = np.full((height, width), cv2.GC_PR_BGD, dtype=np.uint8)
    mask[object_extent] = cv2.GC_PR_FGD
    mask[~object_extent] = cv2.GC_BGD
    mask[core | (inner & changed)] = cv2.GC_FGD

    if not np.any(mask == cv2.GC_FGD):
        return None

    image_bgr = after.astype(np.uint8)[:, :, ::-1].copy()
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(
            image_bgr,
            mask,
            None,
            bgd_model,
            fgd_model,
            5,
            cv2.GC_INIT_WITH_MASK,
        )
    except cv2.error:
        logger.exception("GrabCut pickup sprite repair failed")
        return None

    foreground = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)) & object_extent
    foreground = foreground.astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=2)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel, iterations=1)
    alpha = Image.fromarray(foreground, mode="L")
    cleaned = _clean_sprite_alpha(alpha, hitbox, box)
    alpha.close()
    if not _is_extracted_alpha_usable(cleaned, hitbox, box):
        cleaned.close()
        return None
    return cleaned


def _padded_bbox(
    bbox: tuple[int, int, int, int],
    size: tuple[int, int],
    padding: int,
) -> tuple[int, int, int, int]:
    return (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(size[0], bbox[2] + padding),
        min(size[1], bbox[3] + padding),
    )


def _clear_transparent_rgb(sprite: Image.Image) -> Image.Image:
    rgba = sprite.convert("RGBA")
    arr = np.array(rgba, dtype=np.uint8)
    rgba.close()
    transparent = arr[:, :, 3] == 0
    arr[transparent, :3] = 0
    return Image.fromarray(arr, mode="RGBA")


def _sprite_repair_reason(
    *,
    too_noisy: bool,
    too_tiny: bool,
    empty_alpha: bool,
    poor_cutout: bool,
) -> str:
    if too_noisy:
        return "noisy_full_crop"
    if too_tiny or empty_alpha:
        return "tiny_or_empty_mask"
    if poor_cutout:
        return "oversized_or_scene_mask"
    return "actual_inpaint_sprite_extraction"


def _save_sprite_assets(
    *,
    dog_dir,
    variant_idx: int,
    painted: Image.Image,
    dog_mask: Image.Image,
    hitbox: Hitbox,
    box: tuple[int, int, int, int],
    clean_crop: Image.Image | None = None,
    model: str | None = None,
    prevalidated: bool = False,
) -> dict | None:
    """Save transparent pickup sprite + debug mask next to a dog variant."""
    alpha: Image.Image | None = None
    sprite_source: Image.Image | None = None
    technique = "flatkey-recreate-v1" if prevalidated else "diff-mask-connected-components-v1"
    # SAM2-primary (plan 2026-07-31-002 U7): when a SAM2 predictor is reachable
    # (remote FTD_SAM2_URL or local checkpoint), segment the subject directly
    # instead of trusting the provider diff — the diff ships truncated birds
    # (missing feet/wings) that pass every geometry gate. Diff-clean remains
    # the fallback. Opt out with FTD_SAM2_PRIMARY=0.
    if (
        not prevalidated  # a prevalidated mask (flat-key recreate) is authoritative
        and os.environ.get("FTD_SAM2_PRIMARY", "1").strip().lower() not in {"0", "false", "no"}
        and (os.environ.get("FTD_SAM2_URL") or os.environ.get("FTD_PICKUP_SAM2_CHECKPOINT"))
    ):
        alpha = _sam2_sprite_alpha(painted, hitbox, box)
        if alpha is not None:
            technique = "sam2-primary-cutout-v1"
    if alpha is None:
        alpha = _clean_sprite_alpha(dog_mask, hitbox, box)
    stats = _alpha_stats(alpha)
    if clean_crop is not None and stats["fullCropLike"]:
        alpha.close()
        alpha = _soft_sprite_alpha(clean_crop, painted, hitbox, box)
        technique = "soft-diff-alpha-v2"
        stats = _alpha_stats(alpha)
    too_noisy_for_pickup = (
        float(stats["bboxCoverage"]) >= 0.9
        and (
            float(stats["visibleCoverage"]) >= 0.12
            or float(stats["strongCoverage"]) >= 0.09
        )
    )
    too_tiny_for_pickup = (
        float(stats["visibleCoverage"]) < 0.02
        and float(stats["bboxCoverage"]) < 0.04
    )
    poor_animal_cutout = (
        False
        if prevalidated
        else not _is_provider_cutout_alpha_usable(alpha, hitbox, box, model=model)
    )
    repair_reason: str | None = None
    empty_alpha = alpha.getbbox() is None
    needs_repair = too_noisy_for_pickup or too_tiny_for_pickup or poor_animal_cutout or empty_alpha
    if clean_crop is not None and needs_repair and _SPRITE_REPAIR_ENABLED:
        repair_reason = _sprite_repair_reason(
            too_noisy=too_noisy_for_pickup,
            too_tiny=too_tiny_for_pickup,
            empty_alpha=empty_alpha,
            poor_cutout=poor_animal_cutout,
        )
        with _SPRITE_REPAIR_SEMAPHORE:
            repaired = _sam2_sprite_alpha(painted, hitbox, box, relaxed=True)
            if repaired is not None:
                technique = "sam2-box075-component-cutout-v1"
            if repaired is None:
                repaired = _semantic_sprite_alpha(clean_crop, painted, hitbox, box, relaxed=True)
                if repaired is not None:
                    technique = "semantic-rembg-isnet-cutout-v1"
            if repaired is None:
                repaired = _color_seeded_sprite_alpha(clean_crop, painted, hitbox, box)
                if repaired is not None:
                    technique = "color-seeded-cutout-v1"
            if repaired is None:
                repaired = _sam_sprite_alpha(painted, hitbox, box, relaxed=True)
                if repaired is not None:
                    technique = "sam-prompted-cutout-v1"
            if repaired is None:
                repaired = _seeded_grabcut_sprite_alpha(clean_crop, painted, hitbox, box)
                if repaired is not None:
                    technique = "seeded-grabcut-cutout-v1"
            if repaired is None:
                repaired = _localized_hitbox_sprite_alpha(clean_crop, painted, hitbox, box)
                if repaired is not None:
                    technique = "localized-hitbox-cutout-v1"

        if repaired is not None:
            alpha.close()
            alpha = repaired
            stats = _alpha_stats(alpha)
            poor_animal_cutout = not _is_provider_cutout_alpha_usable(alpha, hitbox, box, model=model)
            if poor_animal_cutout:
                alpha.close()
                return None
    elif needs_repair:
        alpha.close()
        return None
    pickup_usable = alpha.getbbox() is not None

    bbox = alpha.getbbox()
    if bbox is None:
        alpha.close()
        return None

    sprite_bbox = _padded_bbox(bbox, alpha.size, padding=_SPRITE_EXPORT_PADDING_PX)
    cleanup_bbox = _padded_bbox(bbox, alpha.size, padding=_SPRITE_CLEANUP_PADDING_PX)
    painted_rgba = sprite_source if sprite_source is not None else painted.convert("RGBA")
    sprite = painted_rgba.crop(sprite_bbox)
    sprite_alpha = alpha.crop(sprite_bbox)
    sprite.putalpha(sprite_alpha)
    cleaned_sprite = _clear_transparent_rgb(sprite)
    sprite.close()
    sprite = cleaned_sprite
    painted_rgba.close()

    sprite_path = dog_dir / f"sprite_{variant_idx:03d}.png"
    mask_path = dog_dir / f"sprite_mask_{variant_idx:03d}.png"
    meta_path = dog_dir / f"sprite_{variant_idx:03d}.json"

    _atomic_save_image(sprite, sprite_path)
    _atomic_save_image(sprite_alpha, mask_path)

    level_box = [
        int(box[0] + sprite_bbox[0]),
        int(box[1] + sprite_bbox[1]),
        int(box[0] + sprite_bbox[2]),
        int(box[1] + sprite_bbox[3]),
    ]
    cleanup_box = [
        int(box[0] + cleanup_bbox[0]),
        int(box[1] + cleanup_bbox[1]),
        int(box[0] + cleanup_bbox[2]),
        int(box[1] + cleanup_bbox[3]),
    ]
    sprite_width = max(1, level_box[2] - level_box[0])
    sprite_height = max(1, level_box[3] - level_box[1])
    anchor_x = min(1.0, max(0.0, (float(hitbox.x) - level_box[0]) / sprite_width))
    anchor_y = min(1.0, max(0.0, (float(hitbox.y) - level_box[1]) / sprite_height))
    rel_dir = f"dogs/{dog_dir.name}"
    metadata = {
        "version": 1,
        "image": f"{rel_dir}/{sprite_path.name}",
        "mask": f"{rel_dir}/{mask_path.name}",
        "sourceVariant": f"{rel_dir}/variant_{variant_idx:03d}.png",
        "sourceBox": [int(v) for v in box],
        "spriteBox": level_box,
        "cleanupBox": cleanup_box,
        "width": sprite_width,
        "height": sprite_height,
        "anchorX": round(anchor_x, 4),
        "anchorY": round(anchor_y, 4),
        "technique": technique,
        "quality": {
            "visibleCoverage": round(float(stats["visibleCoverage"]), 4),
            "strongCoverage": round(float(stats["strongCoverage"]), 4),
            "bboxCoverage": round(float(stats["bboxCoverage"]), 4),
            "edgeTouches": int(stats["edgeTouches"]),
            "fullCropLike": bool(stats["fullCropLike"]),
            "pickupUsable": pickup_usable,
            "backgroundFallback": False,
            "templateFallback": technique == "template-animal-cutout-v1",
            **({"repairReason": repair_reason} if repair_reason is not None else {}),
        },
    }
    _atomic_write_json(metadata, meta_path)

    sprite.close()
    sprite_alpha.close()
    alpha.close()
    return metadata


def _save_variant_box(variant_path, box) -> None:
    """Write a sidecar JSON next to a variant PNG recording its crop box.

    The variant was painted over bg pixels [left:right, upper:lower]. compose
    needs these exact coordinates to paste back correctly — inferring them
    from variant size alone fails when the original crop was clipped at an
    image edge (e.g. wide-crop regen for a dog near the left border), because
    two different (hitbox, padding) pairs can produce the same clipped width.

    Sidecar name is `<variant>.box.json` so it lives alongside the PNG and
    moves/dies with it. Format: {"box": [left, upper, right, lower]}.
    """
    from pathlib import Path as _P
    p = _P(variant_path).with_suffix(".box.json")
    data = {"box": [int(box[0]), int(box[1]), int(box[2]), int(box[3])]}
    _atomic_write_json(data, p)


def _load_variant_box(variant_path):
    """Read the sidecar crop box if present. Returns None for legacy
    variants saved before sidecars existed — caller falls back to
    size-based inference."""
    from pathlib import Path as _P
    p = _P(variant_path).with_suffix(".box.json")
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        b = data.get("box")
        if not (isinstance(b, list) and len(b) == 4):
            return None
        return tuple(int(x) for x in b)
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def _inpaint_jobs(
    hitbox_list: list[dict],
    width: int,
    height: int,
    *,
    padding: float = 2.75,
    dog_indices: list[int] | None = None,
) -> list[dict]:
    hitboxes = [
        Hitbox(x=hb["x"], y=hb["y"], radius=hb.get("r", hb.get("radius", 30)))
        for hb in hitbox_list
    ]
    resolved_dog_indices = dog_indices or list(range(len(hitboxes)))
    boxes = [_crop_box(hb, width, height, padding=padding) for hb in hitboxes]
    return [
        {
            "indices": [resolved_dog_indices[i]],
            "box": boxes[i],
            "hitboxes": [hitboxes[i]],
            "hitboxIndex": i,
            "hitboxId": str(hitbox_list[i].get("id") or ""),
            "promptHint": str(hitbox_list[i].get("promptHint") or hitbox_list[i].get("prompt_hint") or "").strip(),
        }
        for i in range(len(hitboxes))
    ]


def _boxes_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _inpaint_passes(
    hitbox_list: list[dict],
    width: int,
    height: int,
    *,
    padding: float = 2.75,
    dog_indices: list[int] | None = None,
) -> list[list[dict]]:
    """Split per-hitbox inpaint jobs into ordered concurrent passes.

    Jobs in the same pass have non-overlapping padded crop boxes, so they can
    run against the same source image. A later pass uses the composite produced
    by earlier passes, letting overlapping crops see already-painted neighbors.
    """
    passes: list[list[dict]] = []
    for job in _inpaint_jobs(hitbox_list, width, height, padding=padding, dog_indices=dog_indices):
        box = tuple(job["box"])
        for pass_jobs in passes:
            if all(not _boxes_overlap(box, tuple(existing["box"])) for existing in pass_jobs):
                pass_jobs.append(job)
                break
        else:
            passes.append([job])
    return passes


def _resolve_inpaint_dog_indices(raw: dict[str, Any], hitbox_list: list[dict[str, Any]]) -> list[int]:
    dogs = [dog for dog in raw.get("dogs", []) if isinstance(dog, dict)]
    dogs_by_id = {
        str(dog["id"]): dog
        for dog in dogs
        if dog.get("id") and isinstance(dog.get("index"), int)
    }
    used_indices = {
        int(dog["index"])
        for dog in dogs
        if isinstance(dog.get("index"), int)
    }
    next_index = max(used_indices, default=-1) + 1
    resolved: list[int] = []
    for position, hitbox in enumerate(hitbox_list):
        hitbox_id = str(hitbox.get("id") or "") if isinstance(hitbox, dict) else ""
        existing = dogs_by_id.get(hitbox_id) if hitbox_id else None
        if existing is not None:
            dog_index = int(existing["index"])
        elif position not in used_indices:
            dog_index = position
            used_indices.add(dog_index)
        else:
            while next_index in used_indices:
                next_index += 1
            dog_index = next_index
            used_indices.add(dog_index)
            next_index += 1
        resolved.append(dog_index)
    return resolved


def write_generation_sidecar(image_path, *, kind: str, prompt: str, model: str,
                             params: dict | None = None, extra: dict | None = None) -> None:
    """Persist the full prompt + parameters of a paid generation next to its
    image as `<stem>.gen.json`. Reference material, never authority — a
    sidecar failure must not fail the generation that just succeeded, and
    unserializable provider extras degrade to strings."""
    from pathlib import Path as _P

    target = _P(image_path)
    payload = {
        "kind": kind,
        "prompt": prompt,
        "model": model,
        "params": params or {},
        "createdAt": datetime.now(timezone.utc).isoformat(),
        **({"extra": extra} if extra else {}),
    }
    try:
        serializable = json.loads(json.dumps(payload, default=str))
        _atomic_write_json(serializable, target.with_name(f"{target.stem}.gen.json"))
    except Exception:
        logger.warning("failed to write generation sidecar for %s", target, exc_info=True)


def _atomic_write_json(obj, path) -> None:
    """Same contract as _atomic_save_image for JSON payloads — unique tmp
    suffix so concurrent writers to the same target (e.g. level.json
    from regen + recomposite_apply simultaneously) don't race on the
    shared tmp dentry."""
    from pathlib import Path as _P
    p = _P(path)
    tmp = p.with_suffix(f"{p.suffix}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=2)
        tmp.replace(p)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            logger.warning("failed to cleanup tmp file %s", tmp)


# ── Background generation (SSE) ──────────────────────────────────────────────

@router.get("/generation-status")
def generation_status():
    """Return backend-authoritative in-flight generation streams."""
    return _generation_status_payload()



class BackgroundGenerationJobResponse(BaseModel):
    jobId: str
    status: str
    succeeded: int = 0
    failed: int = 0
    backgrounds: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


def _background_generation_inputs(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "scenePrompt": raw["scene_prompt"],
        "model": raw.get("bg_model") or raw["model"],
        "backgroundCount": raw["n_options"],
        "aspectRatio": raw.get("aspect_ratio", "1:1"),
        "imageSize": raw.get("image_size", "1K"),
        "promptContext": raw.get("prompt_context") or {},
    }


def _background_generation_idempotency_key(session_id: str, inputs: dict[str, Any]) -> str:
    payload = json.dumps(inputs, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"background-generation:{session_id}:{digest}"


def _background_job_response(job: JobRecord) -> BackgroundGenerationJobResponse:
    backgrounds = job.result.get("backgrounds")
    return BackgroundGenerationJobResponse(
        jobId=job.id,
        status=job.status,
        succeeded=int(job.result.get("succeeded") or 0),
        failed=int(job.result.get("failed") or 0),
        backgrounds=backgrounds if isinstance(backgrounds, list) else [],
        error=job.error_message,
    )


def _should_requeue_failed_generation_job(job: JobRecord) -> bool:
    if job.status != "failed_retryable":
        return False
    has_result = int(job.result.get("failed") or 0) > 0 or int(job.result.get("succeeded") or 0) > 0
    safe_to_requeue = job.metadata.get("safeToRequeue") is True
    provider_started = bool(job.metadata.get("providerSubmissionStarted"))
    return has_result or (safe_to_requeue and not provider_started)


def _start_background_generation_job_record(session_id: str) -> JobRecord:
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    inputs = _background_generation_inputs(raw)
    key = _background_generation_idempotency_key(session_id, inputs)
    existing = JOB_STORE.get_job_by_idempotency_key(kind="background_generation", idempotency_key=key)
    if existing is not None:
        if _should_requeue_failed_generation_job(existing):
            return JOB_STORE.requeue_job(existing.id, reason="Retry requested through background generation start endpoint.")
        return existing
    return JOB_STORE.create_job(
        kind="background_generation",
        session_id=session_id,
        idempotency_key=key,
        input_hash=key,
        metadata={**inputs, "safeToRequeue": True},
    )


@router.post("/sessions/{session_id}/background-generation/jobs", response_model=BackgroundGenerationJobResponse)
def start_background_generation_job(session_id: str) -> BackgroundGenerationJobResponse:
    return _background_job_response(_start_background_generation_job_record(session_id))


@router.get("/sessions/{session_id}/background-generation/jobs/{job_id}", response_model=BackgroundGenerationJobResponse)
def get_background_generation_job(session_id: str, job_id: str) -> BackgroundGenerationJobResponse:
    _validate_session_id(session_id)
    job = JOB_STORE.get_job(job_id)
    if job is None or job.session_id != session_id or job.kind != "background_generation":
        raise HTTPException(404, detail={"error": "Job not found"})
    return _background_job_response(job)


def _append_background_event(store: JobStore, job_id: str, event_type: str, data: dict[str, Any]) -> JobEvent:
    return store.append_event(job_id, event_type, data=data)


_BACKGROUND_GENERATION_UNIT_KIND = "background_generation_unit"


def _prepare_background_generation_unit_jobs(
    job: JobRecord,
    store: JobStore,
    *,
    n_options: int,
    model: str,
) -> dict[int, JobRecord]:
    child_jobs: dict[int, JobRecord] = {}
    for index in range(n_options):
        child = store.create_job(
            kind=_BACKGROUND_GENERATION_UNIT_KIND,
            session_id=job.session_id,
            parent_job_id=job.id,
            idempotency_key=f"{job.id}:background:{index}",
            metadata={
                "index": index,
                "model": model,
                "safeToRequeue": True,
            },
        )
        if child.status != "queued":
            child = store.requeue_job(
                child.id,
                reason="Parent background generation job started a fresh attempt.",
            )
        child_jobs[index] = child
    return child_jobs


def _mark_background_generation_unit_running(
    child_jobs: dict[int, JobRecord],
    index: int,
    *,
    parent: JobRecord,
    store: JobStore,
) -> None:
    child = child_jobs.get(index)
    if child is None:
        return
    child_jobs[index] = store.transition_job(
        child.id,
        status="running",
        stage="generating",
        worker_owner=parent.worker_owner,
        heartbeat_at=parent.heartbeat_at,
    )


def _mark_background_generation_unit_succeeded(
    child_jobs: dict[int, JobRecord],
    index: int,
    *,
    bg_info: dict[str, Any],
    store: JobStore,
) -> None:
    child = child_jobs.get(index)
    if child is None:
        return
    child_jobs[index] = store.transition_job(
        child.id,
        status="succeeded",
        stage="done",
        result={
            "index": index,
            "file": bg_info.get("file"),
            "width": bg_info.get("width"),
            "height": bg_info.get("height"),
        },
    )


def _mark_background_generation_unit_failed(
    child_jobs: dict[int, JobRecord],
    index: int,
    *,
    error_message: str,
    store: JobStore,
) -> None:
    child = child_jobs.get(index)
    if child is None:
        return
    child_jobs[index] = store.transition_job(
        child.id,
        status="failed_retryable",
        stage="error",
        retryable=True,
        error_code="background_generation_failed",
        error_message=error_message,
        result={"index": index},
    )


def _run_background_generation_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    metadata = job.metadata
    session_id = job.session_id
    prompt = str(metadata["scenePrompt"])
    model = str(metadata["model"])
    n_options = int(metadata.get("backgroundCount", metadata.get("nOptions", 1)))
    aspect_ratio = str(metadata["aspectRatio"])
    image_size = str(metadata["imageSize"])
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise TerminalJobError("session_not_found", "Session not found")
    sdir = S.session_dir(session_id)
    succeeded = 0
    failed = 0
    failure_messages: list[str] = []
    backgrounds: list[dict[str, Any]] = []
    child_jobs = _prepare_background_generation_unit_jobs(job, store, n_options=n_options, model=model)
    _set_active_generation(session_id, {
        "kind": "background",
        "startedAt": time.time(),
        "total": n_options,
        "model": model,
        "succeeded": succeeded,
        "failed": failed,
    })
    try:
        if is_layer_model(model):
            for i in range(n_options):
                store.update_heartbeat(job.id, owner=job.worker_owner or "background-generation")
                _mark_background_generation_unit_running(child_jobs, i, parent=job, store=store)
                estimate: LayerEstimate | None = None
                try:
                    estimate = estimate_layer_background(
                        prompt=prompt,
                        model=model,
                        aspect_ratio=aspect_ratio,
                        image_size=image_size,
                    )
                    _append_background_event(store, job.id, "bg_cost_estimate", {
                        "index": i,
                        "provider": "layer",
                        "model": model,
                        "estimatedCreativeUnits": estimate.creative_units,
                        "costStatus": "estimated" if estimate.creative_units is not None else "unknown",
                    })
                except Exception as exc:  # noqa: BLE001
                    _append_background_event(store, job.id, "bg_cost_estimate", {
                        "index": i,
                        "provider": "layer",
                        "model": model,
                        "estimatedCreativeUnits": None,
                        "costStatus": "unknown",
                        "warning": _sanitized_error(exc),
                    })
                store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})
                try:
                    result = generate_layer_background(
                        prompt=prompt,
                        model=model,
                        aspect_ratio=aspect_ratio,
                        image_size=image_size,
                        estimate=estimate,
                    )
                    elapsed = float(result.metadata.get("providerElapsed") or 0.0)
                    path = sdir / f"bg_{i:02d}.png"
                    width, height = result.image.size
                    result_metadata = {
                        **result.metadata,
                        "promptContext": raw.get("prompt_context") or {},
                    }
                    _atomic_save_image(result.image, path)
                    write_generation_sidecar(
                        path, kind="background", prompt=prompt, model=model,
                        params={"aspectRatio": aspect_ratio, "imageSize": image_size},
                        extra={"providerElapsed": elapsed},
                    )
                    S.record_generated_background(
                        session_id,
                        bg_index=i,
                        generation_time=elapsed,
                        bg_width=width,
                        bg_height=height,
                        metadata=result_metadata,
                    )
                    result.image.close()
                    bg_info = {
                        "index": i,
                        "file": f"bg_{i:02d}.png",
                        "generationTime": round(elapsed, 1),
                        "width": width,
                        "height": height,
                        **result_metadata,
                    }
                    store.record_artifact(
                        job.id,
                        artifact_type="background",
                        path=bg_info["file"],
                        content_type=str(result_metadata.get("contentType") or "image/png"),
                        metadata={"index": i, "width": width, "height": height},
                    )
                    _append_background_event(store, job.id, "bg_ready", bg_info)
                    _mark_background_generation_unit_succeeded(child_jobs, i, bg_info=bg_info, store=store)
                    backgrounds.append(bg_info)
                    succeeded += 1
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    error_message = _sanitized_error(exc)
                    failure_messages.append(error_message)
                    _append_background_event(store, job.id, "bg_error", {
                        "index": i,
                        "provider": "layer",
                        "model": model,
                        "selectable": False,
                        "error": error_message,
                    })
                    _mark_background_generation_unit_failed(child_jobs, i, error_message=error_message, store=store)
                _set_active_generation(session_id, {
                    "kind": "background",
                    "total": n_options,
                    "model": model,
                    "succeeded": succeeded,
                    "failed": failed,
                })
        else:
            cancel_event = threading.Event()
            for i in range(n_options):
                store.update_heartbeat(job.id, owner=job.worker_owner or "background-generation")
                _mark_background_generation_unit_running(child_jobs, i, parent=job, store=store)

                def _emit_retry(attempt: int, exc: BaseException, index: int = i) -> None:
                    _append_background_event(store, job.id, "bg_retry", {
                        "index": index,
                        "attempt": attempt + 1,
                        "maxAttempts": _MAX_ATTEMPTS,
                        "error": _sanitized_error(exc),
                    })

                store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})
                try:
                    t0 = time.perf_counter()
                    img = _with_retries_and_timeout(
                        generate_image,
                        prompt,
                        on_attempt=_emit_retry,
                        cancel_event=cancel_event,
                        model=model,
                        aspect_ratio=aspect_ratio,
                        image_size=image_size,
                    )
                    elapsed = time.perf_counter() - t0
                    path = sdir / f"bg_{i:02d}.png"
                    width, height = img.size
                    _atomic_save_image(img, path)
                    S.record_generated_background(
                        session_id,
                        bg_index=i,
                        generation_time=elapsed,
                        bg_width=width,
                        bg_height=height,
                    )
                    img.close()
                    bg_info = {
                        "index": i,
                        "file": f"bg_{i:02d}.png",
                        "generationTime": round(elapsed, 1),
                        "width": width,
                        "height": height,
                    }
                    store.record_artifact(
                        job.id,
                        artifact_type="background",
                        path=bg_info["file"],
                        content_type="image/png",
                        metadata={"index": i, "width": width, "height": height},
                    )
                    _append_background_event(store, job.id, "bg_ready", bg_info)
                    _mark_background_generation_unit_succeeded(child_jobs, i, bg_info=bg_info, store=store)
                    backgrounds.append(bg_info)
                    succeeded += 1
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    error_message = _sanitized_error(exc)
                    failure_messages.append(error_message)
                    _append_background_event(store, job.id, "bg_error", {
                        "index": i,
                        "error": error_message,
                    })
                    _mark_background_generation_unit_failed(child_jobs, i, error_message=error_message, store=store)
                _set_active_generation(session_id, {
                    "kind": "background",
                    "total": n_options,
                    "model": model,
                    "succeeded": succeeded,
                    "failed": failed,
                })
        if backgrounds:
            S.merge_background_records(session_id, backgrounds)
        result = {"succeeded": succeeded, "failed": failed, "backgrounds": backgrounds}
        store.update_result(job.id, result)
        _append_background_event(store, job.id, "generate_complete", {"succeeded": succeeded, "failed": failed})
        if failed > 0:
            failure_summary = (
                f"{failed} background option(s) failed: {failure_messages[0]}"
                if failure_messages
                else f"{failed} background option(s) failed; retry to generate a fresh attempt."
            )
            store.transition_job(
                job.id,
                status="failed_retryable",
                stage="partial_background_failed_retryable",
                retryable=True,
                error_code="background_generation_failed",
                error_message=failure_summary,
                result=result,
            )
        return result
    finally:
        # Unresolved-child sweep (todo 042). If the handler raises before the
        # per-option loop resolves every child — session load, provider-client
        # construction, or a crash between options — children for not-yet-reached
        # options stay queued/running forever: stale recovery skips them (they
        # have a parent) and they are not independently claimable, so a UI summing
        # child statuses sees `queued` units under a failed_retryable parent. The
        # crop_inpaint path already closes this with a finally sweep; mirror it
        # here. Only reconciles CHILD bookkeeping — the worker owns the parent's
        # terminal transition. A no-op on the success path (all children resolved).
        for index, child in list(child_jobs.items()):
            if child is None or child.status not in ("queued", "running"):
                continue
            error_message = "Background generation did not complete for this option."
            try:
                store.append_event(job.id, "bg_error", data={
                    "index": index,
                    "status": "error",
                    "error": error_message,
                })
                _mark_background_generation_unit_failed(
                    child_jobs, index, error_message=error_message, store=store,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "failed to sweep background-generation child %d for job %s", index, job.id,
                )
        _set_active_generation(session_id, None)


async def _stream_background_job_events(job_id: str):
    semantic_events = {"bg_cost_estimate", "bg_ready", "bg_retry", "bg_error", "generate_complete"}
    last_event_id = _last_requeue_event_id(job_id)
    while True:
        events = JOB_STORE.list_events(job_id, after_id=last_event_id)
        for event in events:
            last_event_id = event.id
            if event.event_type in semantic_events:
                yield {"event": event.event_type, "data": json.dumps(event.data)}
        job = JOB_STORE.get_job(job_id)
        if job is not None and job.status in TERMINAL_STATUSES:
            # The worker may commit its final semantic events between the
            # list_events() call above and this terminal-state read. Drain that
            # gap before returning or a fast job can produce an empty/truncated
            # SSE replay.
            tail_events = JOB_STORE.list_events(job_id, after_id=last_event_id)
            for event in tail_events:
                last_event_id = event.id
                if event.event_type in semantic_events:
                    yield {"event": event.event_type, "data": json.dumps(event.data)}
            return
        await asyncio.sleep(0.25)

@router.get("/sessions/{session_id}/generate")
async def generate_backgrounds(request: Request, session_id: str):
    job = _start_background_generation_job_record(session_id)
    worker = get_default_job_worker()
    register_job_handlers(worker)
    worker.start()

    async def stream():
        # EventSourceResponse owns the ASGI receive channel and cancels this
        # generator on disconnect. Calling request.is_disconnected() here would
        # race its listener for the same http.disconnect message.
        async for event in _stream_background_job_events(job.id):
            yield event

    return EventSourceResponse(stream(), ping=15)


# ── Inpainting (SSE) ─────────────────────────────────────────────────────────

_MAX_HITBOXES = 40  # matches AutoHitboxesRequest.nDogs upper bound



class CropInpaintJobRequest(BaseModel):
    hitboxes: list[dict[str, Any]]
    dogPrompt: str = Field(..., max_length=4000)
    inpaintModel: str | None = Field(None, max_length=200)
    inpaintMode: InpaintMode = "crop"
    hardDogPrompt: str | None = Field(None, max_length=8000)
    hardDogPercent: int = Field(0, ge=0, le=100)  # default all-easy; hard is opt-in
    padding: float = Field(2.75, ge=1.0, le=5.0)


class CropInpaintJobResponse(BaseModel):
    jobId: str
    status: str
    succeeded: int = 0
    failed: int = 0
    colorFile: str | None = None
    evalFile: str | None = None
    error: str | None = None


def _validate_crop_inpaint_inputs(
    session_id: str,
    *,
    hitboxes_raw: str | None = None,
    hitboxes_list: list[dict[str, Any]] | None = None,
    dog_prompt: str,
    inpaint_model: str | None,
    hard_dog_prompt: str | None,
    hard_dog_percent: int,
    padding: float,
) -> tuple[dict[str, Any], int, list[dict[str, Any]], str, str | None]:
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})

    selected_bg = _resolve_selected_bg(session_id, raw)
    if selected_bg is None:
        raise HTTPException(400, detail={"error": "No background selected", "code": "startup_error"})
    bg_path = S.session_dir(session_id) / f"bg_{selected_bg:02d}.png"
    if not bg_path.exists():
        raise HTTPException(400, detail={"error": "Background file not found", "code": "startup_error"})

    if hitboxes_list is None:
        try:
            decoded_hitboxes = json.loads(hitboxes_raw or "")
        except json.JSONDecodeError as exc:
            raise HTTPException(400, detail={"error": "hitboxes must be JSON", "code": "startup_error"}) from exc
    else:
        decoded_hitboxes = hitboxes_list
    if not isinstance(decoded_hitboxes, list) or len(decoded_hitboxes) == 0:
        raise HTTPException(400, detail={"error": "hitboxes must be a non-empty array", "code": "startup_error"})
    if len(decoded_hitboxes) > _MAX_HITBOXES:
        raise HTTPException(400, detail={"error": f"too many hitboxes (max {_MAX_HITBOXES})", "code": "startup_error"})
    hitbox_list = [dict(item) for item in decoded_hitboxes]

    model = inpaint_model or raw.get("inpaint_model") or raw["model"]
    if model not in INPAINT_MODEL_IDS:
        raise HTTPException(
            400,
            detail={
                "error": f"Invalid inpaint model: {model}. Allowed models: {', '.join(sorted(INPAINT_MODEL_IDS))}",
                "code": "invalid_model",
            },
        )

    if not (0 <= hard_dog_percent <= 100):
        raise HTTPException(400, detail={"error": "hardDogPercent must be in [0, 100]", "code": "startup_error"})
    if not (1.0 <= padding <= 5.0):
        raise HTTPException(400, detail={"error": "padding must be in [1.0, 5.0]", "code": "startup_error"})

    return raw, selected_bg, hitbox_list, str(model), hard_dog_prompt


def _crop_inpaint_idempotency_key(
    session_id: str,
    *,
    selected_bg: int,
    hitbox_list: list[dict[str, Any]],
    dog_prompt: str,
    model: str,
    inpaint_mode: CropInpaintMode,
    hard_dog_prompt: str | None,
    hard_dog_percent: int,
    padding: float,
) -> str:
    # Hash only the GEOMETRY of each hitbox — the A1 stable `id` is identity
    # metadata, not a generation parameter, so its presence/absence must not
    # change idempotency (else stamping ids would spuriously re-submit a paid job).
    geometry_hitboxes = [
        {k: v for k, v in hb.items() if k != "id"} if isinstance(hb, dict) else hb
        for hb in hitbox_list
    ]
    payload_data: dict[str, Any] = {
        "selectedBg": selected_bg,
        "hitboxes": geometry_hitboxes,
        "dogPrompt": dog_prompt,
        "model": model,
        "hardDogPrompt": hard_dog_prompt or "",
        "hardDogPercent": hard_dog_percent,
        "padding": padding,
    }
    if inpaint_mode != "crop":
        payload_data["inpaintMode"] = inpaint_mode
    payload = json.dumps(
        payload_data,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"crop-inpaint:{session_id}:{digest}"


def _crop_inpaint_job_response(job: JobRecord) -> CropInpaintJobResponse:
    return CropInpaintJobResponse(
        jobId=job.id,
        status=job.status,
        succeeded=int(job.result.get("succeeded") or 0),
        failed=int(job.result.get("failed") or 0),
        colorFile=job.result.get("colorFile") if isinstance(job.result.get("colorFile"), str) else None,
        evalFile=job.result.get("evalFile") if isinstance(job.result.get("evalFile"), str) else None,
        error=job.error_message,
    )


def _start_crop_inpaint_job_record(
    session_id: str,
    *,
    hitbox_list: list[dict[str, Any]],
    dog_prompt: str,
    model: str,
    selected_bg: int,
    hard_dog_prompt: str | None,
    hard_dog_percent: int,
    padding: float,
    inpaint_mode: CropInpaintMode = "crop",
) -> JobRecord:
    idempotency_key = _crop_inpaint_idempotency_key(
        session_id,
        selected_bg=selected_bg,
        hitbox_list=hitbox_list,
        dog_prompt=dog_prompt,
        model=model,
        inpaint_mode=inpaint_mode,
        hard_dog_prompt=hard_dog_prompt,
        hard_dog_percent=hard_dog_percent,
        padding=padding,
    )
    existing = JOB_STORE.get_job_by_idempotency_key(kind="crop_inpaint", idempotency_key=idempotency_key)
    if existing is not None:
        if _should_requeue_failed_generation_job(existing):
            return JOB_STORE.requeue_job(existing.id, reason="Retry requested through crop inpaint start endpoint.")
        raw = S.load_session_raw(session_id) or {}
        if existing.status == "succeeded" and raw.get("inpaint_mode") == "magenta":
            return JOB_STORE.requeue_job(existing.id, reason="Crop inpaint requested after magenta mode changed session artifacts.")
        return existing
    persisted_hitboxes = S.save_hitboxes(session_id, hitbox_list) or hitbox_list
    return JOB_STORE.create_job(
        kind="crop_inpaint",
        session_id=session_id,
        idempotency_key=idempotency_key,
        input_hash=idempotency_key,
        metadata={
            "selectedBg": selected_bg,
            "hitboxes": persisted_hitboxes,
            "dogPrompt": dog_prompt,
            "model": model,
            "inpaintMode": inpaint_mode,
            "hardDogPrompt": hard_dog_prompt or "",
            "hardDogPercent": hard_dog_percent,
            "padding": padding,
            "safeToRequeue": True,
        },
    )


@router.post("/sessions/{session_id}/inpaint/jobs", response_model=CropInpaintJobResponse)
def start_crop_inpaint_job(session_id: str, req: CropInpaintJobRequest) -> CropInpaintJobResponse:
    _raw, selected_bg, hitbox_list, model, hard_dog_prompt = _validate_crop_inpaint_inputs(
        session_id,
        hitboxes_list=req.hitboxes,
        dog_prompt=req.dogPrompt,
        inpaint_model=req.inpaintModel,
        hard_dog_prompt=req.hardDogPrompt,
        hard_dog_percent=req.hardDogPercent,
        padding=req.padding,
    )
    if req.inpaintMode == "magenta":
        if model.startswith("fal-ai/"):
            raise HTTPException(
                400,
                detail={
                    "error": "magenta mode requires an image-edit model; fal masked inpaint models are not supported.",
                    "code": "invalid_model",
                },
            )
        idempotency_key = _crop_inpaint_idempotency_key(
            session_id,
            selected_bg=selected_bg,
            hitbox_list=hitbox_list,
            dog_prompt=req.dogPrompt,
            model=model,
            inpaint_mode="magenta",
            hard_dog_prompt=None,
            hard_dog_percent=0,
            padding=req.padding,
        ).replace("crop-inpaint:", "magenta-inpaint:", 1)
        job = JOB_STORE.get_job_by_idempotency_key(
            kind="magenta_inpaint",
            idempotency_key=idempotency_key,
        )
        if job is None:
            persisted_hitboxes = S.save_hitboxes(session_id, hitbox_list) or hitbox_list
            job = JOB_STORE.create_job(
                kind="magenta_inpaint",
                session_id=session_id,
                idempotency_key=idempotency_key,
                input_hash=idempotency_key,
                metadata={
                    "selectedBg": selected_bg,
                    "hitboxes": persisted_hitboxes,
                    "dogPrompt": req.dogPrompt,
                    "model": model,
                    "inpaintMode": "magenta",
                    "safeToRequeue": True,
                },
            )
        return _crop_inpaint_job_response(job)
    job = _start_crop_inpaint_job_record(
        session_id,
        hitbox_list=hitbox_list,
        dog_prompt=req.dogPrompt,
        model=model,
        inpaint_mode=req.inpaintMode,
        selected_bg=selected_bg,
        hard_dog_prompt=hard_dog_prompt,
        hard_dog_percent=req.hardDogPercent,
        padding=req.padding,
    )
    return _crop_inpaint_job_response(job)


@router.get("/sessions/{session_id}/inpaint/jobs/{job_id}", response_model=CropInpaintJobResponse)
def get_crop_inpaint_job(session_id: str, job_id: str) -> CropInpaintJobResponse:
    _validate_session_id(session_id)
    job = JOB_STORE.get_job(job_id)
    if job is None or job.session_id != session_id or job.kind != "crop_inpaint":
        raise HTTPException(404, detail={"error": "Job not found"})
    return _crop_inpaint_job_response(job)


_CROP_INPAINT_UNIT_KIND = "crop_inpaint_unit"


def _prepare_crop_inpaint_unit_jobs(
    job: JobRecord,
    store: JobStore,
    passes: list[list[dict[str, Any]]],
) -> dict[int, JobRecord]:
    child_jobs: dict[int, JobRecord] = {}
    for pass_index, pass_jobs in enumerate(passes):
        for pass_job in pass_jobs:
            dog_index = int(pass_job["indices"][0])
            box = [int(value) for value in pass_job["box"]]
            prompt_hint = str(pass_job.get("promptHint") or "")
            child = store.create_job(
                kind=_CROP_INPAINT_UNIT_KIND,
                session_id=job.session_id,
                parent_job_id=job.id,
                idempotency_key=f"{job.id}:dog:{dog_index}",
                metadata={
                    "dogIndex": dog_index,
                    "passIndex": pass_index,
                    "box": box,
                    "promptHint": prompt_hint,
                    "safeToRequeue": True,
                },
            )
            if child.status != "queued":
                child = store.requeue_job(
                    child.id,
                    reason="Parent crop inpaint job started a fresh attempt.",
                )
            child_jobs[dog_index] = child
    return child_jobs


def _mark_crop_inpaint_unit_running(
    child_jobs: dict[int, JobRecord],
    dog_index: int,
    *,
    parent: JobRecord,
    store: JobStore,
) -> None:
    child = child_jobs.get(dog_index)
    if child is None:
        return
    child_jobs[dog_index] = store.transition_job(
        child.id,
        status="running",
        stage="generating",
        worker_owner=parent.worker_owner,
        heartbeat_at=parent.heartbeat_at,
    )


def _mark_crop_inpaint_unit_succeeded(
    child_jobs: dict[int, JobRecord],
    dog_index: int,
    *,
    file_name: str,
    variant_idx: int,
    pass_index: int,
    store: JobStore,
) -> None:
    child = child_jobs.get(dog_index)
    if child is None:
        return
    child_jobs[dog_index] = store.transition_job(
        child.id,
        status="succeeded",
        stage="done",
        result={
            "dogIndex": dog_index,
            "file": file_name,
            "variantIndex": variant_idx,
            "passIndex": pass_index,
        },
    )


def _mark_crop_inpaint_unit_failed(
    child_jobs: dict[int, JobRecord],
    dog_index: int,
    *,
    error_message: str,
    pass_index: int,
    store: JobStore,
) -> None:
    child = child_jobs.get(dog_index)
    if child is None:
        return
    child_jobs[dog_index] = store.transition_job(
        child.id,
        status="failed_retryable",
        stage="error",
        retryable=True,
        error_code="crop_inpaint_failed",
        error_message=error_message,
        result={"dogIndex": dog_index, "passIndex": pass_index},
    )


def _run_crop_inpaint_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    metadata = job.metadata
    session_id = job.session_id
    hitbox_list = list(metadata["hitboxes"])
    dog_prompt = str(metadata["dogPrompt"])
    model = str(metadata["model"])
    selected_bg = int(metadata["selectedBg"])
    inpaint_mode: CropInpaintMode = "crop"
    hard_dog_prompt = str(metadata.get("hardDogPrompt") or "")
    hard_dog_percent = int(metadata.get("hardDogPercent", 30))
    padding = float(metadata.get("padding") or 2.75)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise TerminalJobError("session_not_found", "Session not found")

    sdir = S.session_dir(session_id)
    level_path = sdir / "level.json"
    if level_path.exists():
        level_path.unlink()
    bg_path = sdir / f"bg_{selected_bg:02d}.png"
    if not bg_path.exists():
        raise TerminalJobError("background_not_found", "Background file not found")

    with Image.open(bg_path) as bg_src:
        bg_src.load()
        bg = bg_src.copy()
    result = bg.copy()
    w, h = bg.size
    dog_indices = _resolve_inpaint_dog_indices(raw, hitbox_list)
    passes = _inpaint_passes(hitbox_list, w, h, padding=padding, dog_indices=dog_indices)
    all_dog_indices = set(dog_indices)
    dog_id_by_index = {
        dog_index: str(hitbox.get("id") or "")
        for dog_index, hitbox in zip(dog_indices, hitbox_list, strict=True)
        if isinstance(hitbox, dict) and hitbox.get("id")
    }
    hard_indices: set[int] = set()
    if hard_dog_prompt.strip():
        hard_count = round(len(dog_indices) * (hard_dog_percent / 100.0))
        hard_count = min(len(dog_indices), hard_count)
        if hard_count > 0:
            hard_indices = set(random.sample(dog_indices, hard_count))
    store.append_event(job.id, "inpaint_init", data={
        "hitboxes": len(hitbox_list),
        "passCount": len(passes),
        "passSizes": [len(pass_jobs) for pass_jobs in passes],
        "hardDogIndices": sorted(hard_indices),
        "hardDogPercent": hard_dog_percent,
        "padding": padding,
        "inpaintMode": inpaint_mode,
    })
    child_jobs = _prepare_crop_inpaint_unit_jobs(job, store, passes)
    for pass_index, pass_jobs in enumerate(passes):
        for pass_job in pass_jobs:
            dog_index = int(pass_job["indices"][0])
            store.append_event(job.id, "dog_queued", data={
                "dogIndex": dog_index,
                "status": "queued",
                "passIndex": pass_index,
            })

    succeeded = 0
    failed = 0
    completed_indices: set[int] = set()
    failed_indices: set[int] = set()
    cancel_event = threading.Event()

    def emit_retry(dog_index: int, attempt: int, exc: BaseException) -> None:
        store.append_event(job.id, "dog_retry", data={
            "dogIndex": dog_index,
            "attempt": attempt + 1,
            "maxAttempts": _MAX_ATTEMPTS,
            "error": _sanitized_error(exc),
        })

    def paint_crop(pass_job: dict, crop_before: Image.Image, clean_crop: Image.Image) -> dict[str, Any]:
        indices = list(pass_job["indices"])
        box = tuple(pass_job["box"])
        hitboxes_for_job = list(pass_job["hitboxes"])
        hitbox_id = str(pass_job.get("hitboxId") or "")
        try:
            prompt_for_job = hard_dog_prompt if indices[0] in hard_indices and hard_dog_prompt else dog_prompt
            prompt_hint = str(pass_job.get("promptHint") or "").strip()
            if prompt_hint:
                prompt_for_job = f"{prompt_for_job}\n\nCharacter variation for this dog: {prompt_hint}"
            store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})
            # crop_reference and ring modes deleted 2026-08-05 (PIPELINE.md
            # "eliminated"): crop_reference shipped 16/16 empty paints before
            # the no-op gate existed; ring lost to magenta on evidence. Git
            # history has the implementations if they're ever relitigated.
            if model.startswith("fal-ai/") or model.startswith("openai/"):
                mask = Image.new("L", crop_before.size, 0)
                draw = ImageDraw.Draw(mask)
                _draw_provider_inpaint_mask(draw, hitboxes_for_job, box, model=model)
                inpaint_prompt = _openai_inpaint_prompt(prompt_for_job) if model.startswith("openai/") else prompt_for_job
                painted = _with_retries_and_timeout(
                    mask_inpaint,
                    crop_before,
                    mask,
                    inpaint_prompt,
                    on_attempt=lambda a, e, di=indices[0]: emit_retry(di, a, e),
                    cancel_event=cancel_event,
                    model=model,
                )
                mask.close()
            else:
                painted = _with_retries_and_timeout(
                    edit_image,
                    crop_before,
                    prompt_for_job,
                    on_attempt=lambda a, e, di=indices[0]: emit_retry(di, a, e),
                    cancel_event=cancel_event,
                    model=model,
                )
            if painted.size != crop_before.size:
                painted = painted.resize(crop_before.size, Image.LANCZOS)
            dog_mask = _extract_dog_pixels(crop_before, painted, threshold=30)
            hitbox = hitboxes_for_job[0]
            # No-op gate (2026-08-05): crop_reference runs shipped 16/16
            # "success" with EMPTY paints — the model returned the reference
            # sheet unchanged, the diff mask was near-zero, and nothing
            # checked. A painted subject must cover a meaningful fraction of
            # its hitbox disc; below that the paint call was a no-op and the
            # job must fail loudly instead of recording an invisible dog.
            _hb_area = 3.14159 * float(getattr(hitbox, "r", 0) or (hitbox.get("r") if isinstance(hitbox, dict) else 0) or 58) ** 2
            _mask_px = sum(dog_mask.point(lambda v: 1 if v > 0 else 0).getdata())
            if _mask_px < max(200.0, 0.02 * _hb_area):
                dog_mask.close()
                raise RuntimeError(
                    f"paint no-op: subject mask {_mask_px}px is below 2% of the hitbox disc — model returned the crop unchanged"
                )
            repaired_mask = _subject_only_composite_mask(
                clean_crop=clean_crop,
                painted=painted,
                dog_mask=dog_mask,
                hitbox=hitbox,
                box=box,
            )
            if repaired_mask is None:
                dog_mask.close()
                raise RuntimeError(
                    "provider changed too much of the crop and the subject "
                    "could not be isolated safely"
                )
            dog_mask = repaired_mask
            isolated_variant = _isolate_variant_crop(clean_crop, painted, dog_mask)
            dog_index = indices[0]
            dog_dir = S.dogs_dir(session_id) / f"dog_{dog_index:02d}"
            dog_dir.mkdir(parents=True, exist_ok=True)
            with S._session_lock:
                variant_idx = S.get_next_variant_index(session_id, dog_index)
            variant_path = dog_dir / f"variant_{variant_idx:03d}.png"
            _atomic_save_image(isolated_variant, variant_path)
            write_generation_sidecar(
                variant_path, kind="crop_inpaint", prompt=prompt_for_job, model=model,
                params={"hitbox": vars(hitbox) if hasattr(hitbox, "__dict__") else dict(hitbox),
                        "dogIndex": dog_index},
            )
            _save_variant_box(variant_path, box)
            _save_sprite_assets(
                dog_dir=dog_dir,
                variant_idx=variant_idx,
                painted=painted,
                dog_mask=dog_mask,
                hitbox=hitbox,
                box=box,
                clean_crop=clean_crop,
                model=model,
            )
            isolated_variant.close()
            # Ring mode composites the FULL feathered ring interior — the
            # model painted shadow/occlusion/light into those pixels with the
            # scene visible, and soft shading falls below the diff threshold
            # of the subject mask. Outside-ring drift is discarded by the
            # mask; sprite assets above still use the subject-only mask.
            composite_mask = dog_mask
            return {
                "indices": indices,
                "variantIndex": variant_idx,
                "file": f"dogs/dog_{dog_index:02d}/variant_{variant_idx:03d}.png",
                "box": box,
                "painted": painted,
                "mask": composite_mask,
            }
        except OperationCancelled:
            raise
        except Exception as exc:
            raise InpaintError(indices[0], exc, item_indices=indices) from exc
        finally:
            crop_before.close()
            clean_crop.close()

    try:
        for pass_index, pass_jobs in enumerate(passes):
            source_image = result.copy()
            try:
                for pass_job in pass_jobs:
                    dog_index = int(pass_job["indices"][0])
                    hitbox_id = dog_id_by_index.get(dog_index, "")
                    S.update_dog_status(session_id, dog_index, "generating", id_override=hitbox_id or None)
                    _mark_crop_inpaint_unit_running(child_jobs, dog_index, parent=job, store=store)
                    store.append_event(job.id, "dog_start", data={
                        "dogIndex": dog_index,
                        "status": "generating",
                        "passIndex": pass_index,
                    })
                if _CROP_PASS_PARALLEL:
                    future_to_pass_job = {
                        executor.submit(
                            paint_crop,
                            pass_job,
                            source_image.crop(tuple(pass_job["box"])),
                            bg.crop(tuple(pass_job["box"])),
                        ): pass_job
                        for pass_job in pass_jobs
                    }
                    pass_work_items = list(as_completed(future_to_pass_job))
                else:
                    pass_work_items = pass_jobs

                for pass_work_item in pass_work_items:
                    try:
                        if _CROP_PASS_PARALLEL:
                            job_result = pass_work_item.result()
                        else:
                            job_result = paint_crop(
                                pass_work_item,
                                source_image.crop(tuple(pass_work_item["box"])),
                                bg.crop(tuple(pass_work_item["box"])),
                            )
                        indices = job_result["indices"]
                        variant_idx = int(job_result["variantIndex"])
                        file_name = str(job_result["file"])
                        box = tuple(job_result["box"])
                        painted = job_result["painted"]
                        dog_mask = job_result["mask"]
                        try:
                            result.paste(painted, (box[0], box[1]), mask=dog_mask)
                        finally:
                            painted.close()
                            dog_mask.close()
                        _atomic_save_image(result, sdir / "color.png")
                        for dog_index in indices:
                            hitbox_id = dog_id_by_index.get(dog_index, "")
                            S.update_dog_status(
                                session_id,
                                dog_index,
                                "done",
                                activeVariant=variant_idx,
                                id_override=hitbox_id or None,
                            )
                            store.record_artifact(
                                job.id,
                                artifact_type="dog_variant",
                                path=file_name,
                                content_type="image/png",
                                metadata={"dogIndex": dog_index, "variantIndex": variant_idx, "passIndex": pass_index},
                            )
                            store.append_event(job.id, "dog_complete", data={
                                "dogIndex": dog_index,
                                "status": "done",
                                "file": file_name,
                                "variantIndex": variant_idx,
                                "passIndex": pass_index,
                            })
                            _mark_crop_inpaint_unit_succeeded(
                                child_jobs,
                                dog_index,
                                file_name=file_name,
                                variant_idx=variant_idx,
                                pass_index=pass_index,
                                store=store,
                            )
                            completed_indices.add(dog_index)
                            succeeded += 1
                    except OperationCancelled:
                        pass
                    except InpaintError as exc:
                        for item_index in exc.item_indices:
                            if item_index in failed_indices:
                                continue
                            failed_hitbox_id = dog_id_by_index.get(item_index, "")
                            S.update_dog_status(
                                session_id,
                                item_index,
                                "error",
                                id_override=failed_hitbox_id or None,
                            )
                            store.append_event(job.id, "dog_error", data={
                                "dogIndex": item_index,
                                "status": "error",
                                "error": _sanitized_error(exc.cause),
                                "passIndex": pass_index,
                            })
                            _mark_crop_inpaint_unit_failed(
                                child_jobs,
                                item_index,
                                error_message=_sanitized_error(exc.cause),
                                pass_index=pass_index,
                                store=store,
                            )
                            failed_indices.add(item_index)
                            failed += 1
                    except Exception as exc:  # noqa: BLE001
                        store.append_event(job.id, "dog_error", data={
                            "dogIndex": -1,
                            "status": "error",
                            "error": _sanitized_error(exc),
                            "passIndex": pass_index,
                        })
            finally:
                source_image.close()
    finally:
        unresolved = all_dog_indices - completed_indices - failed_indices
        if unresolved:
            for idx in unresolved:
                try:
                    S.update_dog_status(
                        session_id,
                        idx,
                        "error",
                        id_override=dog_id_by_index.get(idx) or None,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("failed to mark dog %d as error for session %s", idx, session_id)
                child = child_jobs.get(idx)
                pass_index = int(child.metadata.get("passIndex") or 0) if child is not None else 0
                error_message = "Crop inpaint did not complete for this dog."
                store.append_event(job.id, "dog_error", data={
                    "dogIndex": idx,
                    "status": "error",
                    "error": error_message,
                    "passIndex": pass_index,
                })
                _mark_crop_inpaint_unit_failed(
                    child_jobs,
                    idx,
                    error_message=error_message,
                    pass_index=pass_index,
                    store=store,
                )
                failed_indices.add(idx)
                failed += 1

        if succeeded > 0:
            _atomic_save_image(result, sdir / "inpainted.png")
            _atomic_save_image(result, sdir / "color.png")
            S.update_session_field(session_id, inpaint_mode=inpaint_mode)
            bw = bg.convert("L").convert("RGB")
            _atomic_save_image(bw, sdir / "bw.png")
            bw.close()
            hb_objects = [Hitbox(x=hb_entry["x"], y=hb_entry["y"], radius=hb_entry["r"]) for hb_entry in hitbox_list]
            eval_img = evaluate_hitboxes(result, hb_objects, opacity=0.3)
            _atomic_save_image(eval_img, sdir / "eval.png")
            eval_img.close()
            S.synthesise_level_json(session_id)
        bg.close()
        result.close()

    result_data = {
        "succeeded": succeeded,
        "failed": failed,
        "colorFile": "color.png" if succeeded > 0 else None,
        "evalFile": "eval.png" if succeeded > 0 else None,
    }
    store.update_result(job.id, result_data)
    store.append_event(job.id, "inpaint_complete", data=result_data)
    if failed > 0:
        store.transition_job(
            job.id,
            status="failed_retryable",
            stage="partial_failed_retryable",
            retryable=True,
            error_code="partial_inpaint_failed",
            error_message=f"{failed} dog(s) failed during crop inpaint; retry to generate a fresh attempt.",
            result=result_data,
        )
    return result_data


# ── Band generation (vertical scene extension) durable job ──────────────────
#
# Generates the dog-free top/bottom scenery bands for a finished level via the
# same durable JobStore/JobWorker machinery as crop inpaint. One job kind with a
# `sides` param: first Generate does both sides; a per-side Regen re-runs one. On
# a terminal existing job the same request requeues (a fresh generation) — regen;
# a changed prompt is a new idempotency key → a new job. Bands land in the
# session's `extension/` dir; the accept endpoint (U3) promotes them.

BandSide = Literal["top", "bottom"]


class BandGenJobRequest(BaseModel):
    sides: list[BandSide] = Field(..., min_length=1, max_length=2)
    topPrompt: str | None = Field(None, max_length=4000)
    bottomPrompt: str | None = Field(None, max_length=4000)


class BandGenJobResponse(BaseModel):
    jobId: str
    status: str
    top: bool = False
    bottom: bool = False
    error: str | None = None


def _band_extension_dir(session_id: str) -> Path:
    return S.session_dir(session_id) / "extension"


def _band_side_path(session_id: str, side: str) -> Path:
    return _band_extension_dir(session_id) / f"{side}.png"


def _dedup_sides(sides: list[str]) -> list[str]:
    seen: list[str] = []
    for s in sides:
        if s not in seen:
            seen.append(s)
    return seen


def _band_gen_idempotency_key(
    session_id: str, sides: list[str], top_prompt: str, bottom_prompt: str
) -> str:
    # Deliberately NOT keyed on color.png content: the handler always reads the
    # CURRENT scene at execution time, so bands match the current scene regardless.
    # Folding a color mtime/hash in here would defeat in-flight dedup when the scene
    # changes mid-flight (two concurrent paid jobs racing the same band files) and
    # rotate the key after every export's color refresh (orphaned jobs), for no
    # correctness gain.
    payload = json.dumps(
        {"s": sorted(sides), "t": top_prompt or "", "b": bottom_prompt or ""},
        sort_keys=True,
    )
    return f"bandgen:{session_id}:" + hashlib.sha256(payload.encode()).hexdigest()[:16]


def _band_gen_job_response(job: JobRecord) -> BandGenJobResponse:
    result = job.result or {}
    return BandGenJobResponse(
        jobId=job.id,
        status=job.status,
        top=bool(result.get("top")),
        bottom=bool(result.get("bottom")),
        error=job.error_message,
    )


def _start_band_gen_job_record(
    session_id: str, *, sides: list[str], top_prompt: str | None, bottom_prompt: str | None
) -> JobRecord:
    sides = _dedup_sides(sides)
    idem = _band_gen_idempotency_key(session_id, sides, top_prompt or "", bottom_prompt or "")
    existing = JOB_STORE.get_job_by_idempotency_key(kind="band_generation", idempotency_key=idem)
    if existing is not None:
        if existing.status in TERMINAL_STATUSES:
            # Same request on a finished job = regenerate: fresh attempt (requeue
            # clears result_json + attempt-scoped metadata).
            return JOB_STORE.requeue_job(existing.id, reason="band regeneration requested")
        return existing  # in-flight: don't double-submit
    return JOB_STORE.create_job(
        kind="band_generation",
        session_id=session_id,
        idempotency_key=idem,
        input_hash=idem,
        metadata={
            "sides": sides,
            "topPrompt": top_prompt or "",
            "bottomPrompt": bottom_prompt or "",
            "safeToRequeue": True,
        },
    )


@router.post("/sessions/{session_id}/band-generation/jobs", response_model=BandGenJobResponse)
def start_band_generation_job(session_id: str, req: BandGenJobRequest) -> BandGenJobResponse:
    _validate_session_id(session_id)
    if not (S.session_dir(session_id) / "color.png").exists():
        raise HTTPException(
            status_code=409,
            detail={
                "error": "level scene not ready — finish inpainting before extending",
                "code": "band_scene_not_ready",
            },
        )
    job = _start_band_gen_job_record(
        session_id, sides=req.sides, top_prompt=req.topPrompt, bottom_prompt=req.bottomPrompt
    )
    return _band_gen_job_response(job)


@router.get("/sessions/{session_id}/band-generation/jobs/{job_id}", response_model=BandGenJobResponse)
def get_band_generation_job(session_id: str, job_id: str) -> BandGenJobResponse:
    _validate_session_id(session_id)
    job = JOB_STORE.get_job(job_id)
    if job is None or job.session_id != session_id or job.kind != "band_generation":
        raise HTTPException(
            status_code=404,
            detail={"error": "band generation job not found", "code": "band_job_not_found"},
        )
    return _band_gen_job_response(job)


def _run_band_generation_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    from . import band_generation as BG

    session_id = job.session_id
    meta = job.metadata or {}
    sides = _dedup_sides(meta.get("sides") or [])
    color_path = S.session_dir(session_id) / "color.png"
    if not color_path.exists():
        raise TerminalJobError("band_scene_missing", "level scene color.png missing")

    raw = S.load_session_raw(session_id) or {}
    scene_meta = {
        "setting": raw.get("setting"),
        "scene": raw.get("scene"),
        "scene_prompt": raw.get("scene_prompt"),
    }
    native = Image.open(color_path).convert("RGB")
    top_h, bot_h = BG.compute_band_heights(native.width, native.height)
    heights = {"top": top_h, "bottom": bot_h}
    prompts = {"top": meta.get("topPrompt") or "", "bottom": meta.get("bottomPrompt") or ""}

    # Validate EVERY requested side up front, before spending any provider money.
    # Otherwise an asymmetric near-target scene (e.g. top=1, bottom=0) would charge
    # for the first side and then dead-end — accept requires BOTH bands, so the
    # level could never be accepted despite the paid call.
    zero_sides = [s for s in sides if heights[s] <= 0]
    if zero_sides:
        raise TerminalJobError(
            "band_zero_height",
            f"native scene already meets the target aspect; no {', '.join(zero_sides)} "
            f"band needed",
        )

    _band_extension_dir(session_id).mkdir(parents=True, exist_ok=True)

    def retrying_inpaint(image, mask, prompt, *, model):
        return _with_retries_and_timeout(mask_inpaint, image, mask, prompt, model=model)

    # Paid-provider checkpoint (mirrors every other paid handler in this file):
    # once we're about to spend money, this job is NOT safe to blindly requeue on
    # worker-restart recovery — recover_stale_jobs routes it to orphaned_unknown
    # instead of re-charging the provider for already-generated bands.
    store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})

    for side in sides:
        prompt = prompts[side] or BG.derive_band_prompt(side, scene_meta)
        store.append_event(job.id, "band_generating", data={"side": side})
        band = BG.generate_band(native, side, heights[side], prompt, inpaint=retrying_inpaint)
        _atomic_save_image(band, _band_side_path(session_id, side))
        store.update_result(job.id, {side: True})

    # Result reflects whichever bands currently exist on disk (this run + any
    # prior accepted side we didn't regenerate).
    return {s: _band_side_path(session_id, s).exists() for s in ("top", "bottom")}


class ExtensionStateResponse(BaseModel):
    extension: dict[str, Any] | None = None


@router.post("/sessions/{session_id}/extension/accept", response_model=ExtensionStateResponse)
def accept_extension(session_id: str) -> ExtensionStateResponse:
    """Promote the current candidate bands: require both sides present, then write
    raw['extension'] so export/publish produce an extension level."""
    from .band_generation import TARGET_ASPECT

    _validate_session_id(session_id)
    for side in ("top", "bottom"):
        if not _band_side_path(session_id, side).exists():
            raise HTTPException(
                status_code=409,
                detail={
                    "error": f"cannot accept extension — {side} band not generated yet",
                    "code": "band_not_ready",
                },
            )
    ext = {"targetAspect": TARGET_ASPECT, "bandsRef": session_id}
    S.update_session_field(session_id, extension=ext)
    return ExtensionStateResponse(extension=ext)


@router.post("/sessions/{session_id}/extension/clear", response_model=ExtensionStateResponse)
def clear_extension(session_id: str) -> ExtensionStateResponse:
    """Un-accept: drop raw['extension']. The #338 export revert path then returns
    the shipped level to native-only. Candidate bands stay on disk for a re-accept."""
    _validate_session_id(session_id)
    S.update_session_field(session_id, extension=None)
    return ExtensionStateResponse(extension=None)


def _run_magenta_inpaint_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    """Durable wrapper over run_magenta_inpaint: reads its inputs from the
    session's own files, so a queued job survives restarts with no request
    state. Job-ifies the last SSE-only paid path."""
    session_id = job.session_id
    raw = S.load_session_raw(session_id) or {}
    hb_path = S.session_dir(session_id) / "hitboxes.json"
    hitbox_list = json.loads(hb_path.read_text()) if hb_path.exists() else []
    if not hitbox_list:
        raise RuntimeError("magenta inpaint requires hitboxes")
    metadata = job.metadata or {}
    dog_prompt = metadata.get("dogPrompt") or raw.get("dog_prompt") or ""
    model = metadata.get("model") or raw.get("inpaint_model") or raw.get("model")
    return run_magenta_inpaint(
        session_id,
        hitbox_list=hitbox_list,
        dog_prompt=dog_prompt,
        model=model,
        magenta_override=str(metadata.get("magentaOverride") or ""),
    )


def register_job_handlers(worker: JobWorker) -> None:
    worker.register_handler("magenta_inpaint", _run_magenta_inpaint_job)
    worker.register_handler("background_generation", _run_background_generation_job)
    worker.register_handler("crop_inpaint", _run_crop_inpaint_job)
    worker.register_handler("crop_inpaint_retry", _run_retry_failed_dogs_job)
    worker.register_handler("band_generation", _run_band_generation_job)


def _last_requeue_event_id(job_id: str) -> int:
    last_requeue_id = 0
    for event in JOB_STORE.list_events(job_id):
        if event.event_type == "job.requeued":
            last_requeue_id = event.id
    return last_requeue_id


async def _stream_crop_inpaint_job_events(job_id: str):
    semantic_events = {
        "inpaint_init",
        "dog_start",
        "dog_retry",
        "dog_complete",
        "dog_error",
        "inpaint_complete",
    }
    last_event_id = _last_requeue_event_id(job_id)
    while True:
        events = JOB_STORE.list_events(job_id, after_id=last_event_id)
        for event in events:
            last_event_id = event.id
            if event.event_type in semantic_events:
                yield {"event": event.event_type, "data": json.dumps(event.data)}
        job = JOB_STORE.get_job(job_id)
        if job is not None and job.status in TERMINAL_STATUSES:
            tail_events = JOB_STORE.list_events(job_id, after_id=last_event_id)
            for event in tail_events:
                last_event_id = event.id
                if event.event_type in semantic_events:
                    yield {"event": event.event_type, "data": json.dumps(event.data)}
            return
        await asyncio.sleep(0.25)


@router.get("/sessions/{session_id}/inpaint")
async def inpaint_dogs(
    request: Request,
    session_id: str,
    hitboxes: Annotated[
        str,
        Query(max_length=8000, description="JSON-encoded hitbox array"),
    ],
    dogPrompt: Annotated[
        str,
        Query(max_length=4000, description="Dog prompt for inpainting"),
    ],
    inpaintModel: Annotated[
        str | None,
        Query(max_length=200, description="Optional model override for this inpaint run"),
    ] = None,
    hardDogPrompt: Annotated[
        str | None,
        Query(
            max_length=8000,
            description="Optional hard-hidden prompt for a configurable random share of crops",
        ),
    ] = None,
    hardDogPercent: Annotated[
        int,
        Query(
            ge=0,
            le=100,
            description="Percentage of crops that should use the hard-hidden prompt",
        ),
    ] = 30,
    padding: Annotated[
        float,
        Query(ge=1.0, le=5.0, description="Crop padding multiplier around each hitbox"),
    ] = 2.75,
) -> EventSourceResponse:
    try:
        _raw, selected_bg, hitbox_list, model, hard_dog_prompt = _validate_crop_inpaint_inputs(
            session_id,
            hitboxes_raw=hitboxes,
            dog_prompt=dogPrompt,
            inpaint_model=inpaintModel,
            hard_dog_prompt=hardDogPrompt,
            hard_dog_percent=hardDogPercent,
            padding=padding,
        )
    except HTTPException as exc:
        if exc.status_code == 404:
            raise
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        message = str(detail.get("error") or exc.detail)
        code = str(detail.get("code") or "startup_error")

        async def error_stream():
            yield _startup_error_event(message, code=code)

        return EventSourceResponse(error_stream(), ping=15)

    job = _start_crop_inpaint_job_record(
        session_id,
        hitbox_list=hitbox_list,
        dog_prompt=dogPrompt,
        model=model,
        selected_bg=selected_bg,
        hard_dog_prompt=hard_dog_prompt,
        hard_dog_percent=hardDogPercent,
        padding=padding,
        inpaint_mode="crop",
    )
    worker = get_default_job_worker()
    register_job_handlers(worker)
    worker.start()

    async def stream():
        # EventSourceResponse owns disconnect detection; a second receive
        # consumer here can terminate a valid stream before replay starts.
        async for event in _stream_crop_inpaint_job_events(job.id):
            yield event

    return EventSourceResponse(stream(), ping=15)


# ── Per-dog regeneration ──────────────────────────────────────────────────────

class RegenRequest(BaseModel):
    prompt: str
    inpaintModel: str | None = None
    # Optional crop-padding override. Default 2.75 matches the first-pass
    # inpaint so regen of an intact dog reproduces the same framing. Pass
    # a larger value (e.g. 3.0) for "wide crop" regen when the original
    # tight crop broke — a wider crop gives Gemini more of the surrounding
    # scene as context and often fixes cases where the dog bled into edges
    # or was rendered with wrong scale.
    padding: float = 2.75
    # Batch regeneration can save all dog variants first and then recomposite
    # once. That avoids repeated full-scene PNG decode/compose/encode on large
    # upscaled sessions.
    deferComposite: bool = False


class RetryFailedDogsJobRequest(BaseModel):
    dogIndices: list[int] = Field(..., min_length=1, max_length=_MAX_HITBOXES)
    prompt: str = Field(..., min_length=1, max_length=4000)
    inpaintModel: str | None = Field(None, max_length=200)
    padding: float = Field(2.75, ge=0.5, le=4.0)


class RetryFailedDogUnitResponse(BaseModel):
    dogIndex: int
    status: str
    retryable: bool
    error: str | None = None
    file: str | None = None
    variantIndex: int | None = None


class RetryFailedDogsJobResponse(BaseModel):
    jobId: str
    status: str
    succeeded: int = 0
    failed: int = 0
    units: list[RetryFailedDogUnitResponse] = Field(default_factory=list)
    error: str | None = None


def _resolve_regen_hitbox(dogs: list, hitbox_list: list, dog_index: int) -> dict | None:
    """The hitbox to re-inpaint for dog_index, located by the dog's STABLE ID
    (review P1 #4) — NOT by array position. The regen-by-id route resolves an id
    to dog_index = the creation ordinal (= the dog_{NN} folder), which after a
    delete-by-id tombstone gap is NOT the hitbox's array position; a positional
    `hitbox_list[dog_index]` would re-inpaint the WRONG hitbox into this folder
    (silent paid mis-paint) or miss the top survivor. Falls back to positional
    only for legacy id-less dogs/hitboxes. None if neither resolves (-> 404)."""
    dog_entry = next((d for d in dogs if isinstance(d, dict) and d.get("index") == dog_index), None)
    dog_id = dog_entry.get("id") if dog_entry else None
    if dog_id:
        hb = next((h for h in hitbox_list if isinstance(h, dict) and h.get("id") == dog_id), None)
        if hb is not None:
            return hb
    if 0 <= dog_index < len(hitbox_list):
        return hitbox_list[dog_index]
    return None


def _mark_session_dogs_done(session_id: str, hitbox_list: list) -> None:
    """Mark the dog for every hitbox 'done' (the magenta whole-image path produces
    no per-dog variants). Addresses each hitbox's dog by STABLE ID at its real
    index — NOT `range(len)` + positional (review P2 #5): after a delete-by-id
    tombstone gap a survivor's folder ordinal exceeds the compacted hitbox array,
    so the positional loop created PHANTOM / duplicate-id dogs[] entries that then
    corrupted resolve_dog_index_by_id. A dog-less hitbox is created at a FRESH
    index carrying the hitbox's own id (final-rereview P2 — a positional index
    could clobber a survivor that happens to hold it)."""
    raw = S.load_session_raw(session_id) or {}
    existing_dogs = raw.get("dogs") or []
    dogs_by_id = {d["id"]: d for d in existing_dogs if isinstance(d, dict) and d.get("id")}
    existing_indices = {
        d["index"] for d in existing_dogs
        if isinstance(d, dict) and isinstance(d.get("index"), int)
    }
    next_index = max(existing_indices, default=-1) + 1
    for hb in hitbox_list:
        hb_id = hb.get("id") if isinstance(hb, dict) else None
        existing = dogs_by_id.get(hb_id) if hb_id else None
        if existing is not None:
            # Survivor: mark its existing entry done IN PLACE (at its real index).
            S.update_dog_status(session_id, existing["index"], "done", activeVariant=None)
        else:
            # Dog-less hitbox: create at a FRESH index (never an existing one — a
            # positional index would clobber a tombstone-gap survivor that holds
            # it) and bind the hitbox's OWN id so the by-id routes can still
            # address it. Legacy id-less hitbox -> id_override None -> minted.
            S.update_dog_status(session_id, next_index, "done", activeVariant=None, id_override=hb_id)
            next_index += 1


def _run_single_dog_regen(
    session_id: str,
    dog_index: int,
    *,
    prompt: str,
    padding: float,
    inpaint_model: str | None,
    defer_composite: bool,
) -> dict[str, Any]:
    """Re-inpaint a single hitbox with a (possibly tweaked) prompt.

    Saves the new painting as the next `variant_NNN.png` in the dog's
    directory and sets it as the active variant. color.png is then
    recomposited from every dog's current activeVariant so downstream
    consumers (builder preview, export) see the updated scene.
    """
    _validate_session_id(session_id)
    if not (0.5 <= padding <= 4.0):
        raise HTTPException(400, detail={"error": "padding must be in [0.5, 4.0]"})

    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})

    selected_bg = _resolve_selected_bg(session_id, raw)
    if selected_bg is None:
        raise HTTPException(400, detail={"error": "No background selected"})

    sdir = S.session_dir(session_id)
    bg_path = sdir / f"bg_{selected_bg:02d}.png"
    # Context-manage the bg file handle so the FD doesn't leak across the
    # async gap into the executor.
    with Image.open(bg_path) as bg_src:
        bg_src.load()
        bg = bg_src.copy()
    w, h = bg.size

    hb_path = sdir / "hitboxes.json"
    if not hb_path.exists():
        bg.close()
        raise HTTPException(400, detail={"error": "No hitboxes saved"})
    with open(hb_path) as f:
        hitbox_list = json.load(f)

    hb_data = _resolve_regen_hitbox(raw.get("dogs", []), hitbox_list, dog_index)
    if hb_data is None:
        bg.close()
        raise HTTPException(404, detail={"error": f"Dog {dog_index} not found in hitboxes"})
    hb = Hitbox(x=hb_data["x"], y=hb_data["y"], radius=hb_data.get("r", hb_data.get("radius", 30)))

    dog_dir = S.dogs_dir(session_id) / f"dog_{dog_index:02d}"
    model = inpaint_model or raw.get("inpaint_model") or raw["model"]
    if model not in INPAINT_MODEL_IDS:
        fallback_model = next((m for m in INPAINT_MODEL_IDS if m.startswith("openai/")), None)
        fallback_model = fallback_model or next(iter(INPAINT_MODEL_IDS))
        logger.warning(
            "regen_dog: replacing invalid inpaint model %s with %s for session %s",
            model,
            fallback_model,
            session_id,
        )
        model = fallback_model

    crop_before: Image.Image | None = None
    mask: Image.Image | None = None
    painted: Image.Image | None = None
    dog_mask: Image.Image | None = None
    try:
        box = _crop_box(hb, w, h, padding=padding)
        crop_before = bg.crop(box)
        if model.startswith("fal-ai/") or model.startswith("openai/"):
            mask = Image.new("L", crop_before.size, 0)
            draw = ImageDraw.Draw(mask)
            _draw_provider_inpaint_mask(draw, [hb], box, model=model)
            inpaint_prompt = _openai_inpaint_prompt(prompt) if model.startswith("openai/") else prompt
            painted = _with_retries_and_timeout(mask_inpaint, crop_before, mask, inpaint_prompt, model=model)
        else:
            painted = _with_retries_and_timeout(edit_image, crop_before, prompt, model=model)
        if painted.size != crop_before.size:
            resized = painted.resize(crop_before.size, Image.LANCZOS)
            painted.close()
            painted = resized
        dog_mask = _extract_dog_pixels(crop_before, painted, threshold=30)

        dog_dir.mkdir(parents=True, exist_ok=True)
        with S._session_lock:
            variant_idx = S.get_next_variant_index(session_id, dog_index)
        variant_path = dog_dir / f"variant_{variant_idx:03d}.png"
        _atomic_save_image(painted, variant_path)
        write_generation_sidecar(
            variant_path, kind="dog_regenerate", prompt=prompt, model=model,
            params={"dogIndex": dog_index},
        )
        _save_variant_box(variant_path, box)
        _save_sprite_assets(
            dog_dir=dog_dir,
            variant_idx=variant_idx,
            painted=painted,
            dog_mask=dog_mask,
            hitbox=hb,
            box=box,
            clean_crop=crop_before,
            model=model,
        )
        with S._session_lock:
            # Flip this dog's activeVariant to the just-saved index so
            # the global recompose below picks up the new paint.
            raw_current = S.load_session_raw(session_id)
            if raw_current is not None:
                dogs = raw_current.setdefault("dogs", [])
                dog_entry = next((d for d in dogs if d["index"] == dog_index), None)
                if dog_entry is None:
                    # A1: stamp a stable id on creation, identically to the other
                    # mint sites (set_active_variant / update_dog_status).
                    dogs.append(S._new_dog_meta(
                        session_id, dog_index, status="done", active_variant=variant_idx,
                    ))
                else:
                    dog_entry["status"] = "done"
                    dog_entry["activeVariant"] = variant_idx
                S.save_session(session_id, raw_current)

        # Full recomposite, but with the exact same raw diff-mask paste
        # used by the initial inpaint stream. Radial/feather made regen
        # and variant swaps diverge from first-pass output.
        if not defer_composite:
            recomposite_color(session_id)
    except InpaintError as e:
        raise e
    except Exception as exc:
        raise InpaintError(dog_index, exc) from exc
    finally:
        closed: set[int] = set()
        for image in (mask, crop_before, dog_mask, painted, bg):
            if image is None:
                continue
            image_id = id(image)
            if image_id in closed:
                continue
            closed.add(image_id)
            image.close()

    S.update_dog_status(session_id, dog_index, "done", activeVariant=variant_idx)

    return {
        "variantIndex": variant_idx,
        "file": f"dogs/dog_{dog_index:02d}/variant_{variant_idx:03d}.png",
        "composited": not defer_composite,
    }


async def _regen_dog_at_index(session_id: str, dog_index: int, req: RegenRequest):
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(
            executor,
            lambda: _run_single_dog_regen(
                session_id,
                dog_index,
                prompt=req.prompt,
                padding=req.padding,
                inpaint_model=req.inpaintModel,
                defer_composite=req.deferComposite,
            ),
        )
    except InpaintError as e:
        raise HTTPException(502, detail={"error": _sanitized_error(e.cause)})


@router.post("/sessions/{session_id}/dogs/{dog_index}/regen")
async def regen_dog(session_id: str, dog_index: int, req: RegenRequest):
    return await _regen_dog_at_index(session_id, dog_index, req)


@router.post("/sessions/{session_id}/dogs/by-id/{dog_id}/regen")
async def regen_dog_by_id(session_id: str, dog_id: str, req: RegenRequest):
    """Stable-id adapter for regen (spec -004 §6.9.2). Resolves the id to its
    current index immediately before delegating, so a concurrent reorder can't
    re-bill the wrong dog. 404 if the id resolves to no dog. (The inpaint runs in
    an executor for ~30s — like set_active_variant_by_id this is resolve-then-act,
    acceptable for the single-operator editor; full one-lock regen is deferred.)"""
    dog_index = S.resolve_dog_index_by_id(session_id, dog_id)
    if dog_index is None:
        raise HTTPException(404, detail={"error": f"No dog with id {dog_id}"})
    return await _regen_dog_at_index(session_id, dog_index, req)


def _retry_failed_dogs_idempotency_key(
    session_id: str,
    *,
    dog_indices: list[int],
    prompt: str,
    model: str | None,
    padding: float,
) -> str:
    payload = json.dumps(
        {
            "dogIndices": dog_indices,
            "prompt": prompt,
            "model": model or "",
            "padding": padding,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"crop-inpaint-retry:{session_id}:{digest}"


def _load_retry_hitboxes(session_id: str) -> list[dict[str, Any]]:
    hb_path = S.session_dir(session_id) / "hitboxes.json"
    if not hb_path.exists():
        raise HTTPException(400, detail={"error": "No hitboxes saved"})
    with open(hb_path) as f:
        hitboxes = json.load(f)
    if not isinstance(hitboxes, list) or not hitboxes:
        raise HTTPException(400, detail={"error": "No hitboxes saved"})
    return [dict(item) for item in hitboxes]


def _normalized_retry_dog_indices(session_id: str, dog_indices: list[int]) -> list[int]:
    hitboxes = _load_retry_hitboxes(session_id)
    raw = S.load_session_raw(session_id) or {}
    dogs = raw.get("dogs") or []
    normalized = sorted(set(int(index) for index in dog_indices))
    if len(normalized) == 0:
        raise HTTPException(400, detail={"error": "dogIndices must be non-empty"})
    invalid = [
        index for index in normalized
        if index < 0 or _resolve_regen_hitbox(dogs, hitboxes, index) is None
    ]
    if invalid:
        raise HTTPException(404, detail={"error": f"Dog index out of range: {invalid[0]}"})
    return normalized


def _start_retry_failed_dogs_job_record(session_id: str, req: RetryFailedDogsJobRequest) -> JobRecord:
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    dog_indices = _normalized_retry_dog_indices(session_id, req.dogIndices)
    model = req.inpaintModel or raw.get("inpaint_model") or raw["model"]
    key = _retry_failed_dogs_idempotency_key(
        session_id,
        dog_indices=dog_indices,
        prompt=req.prompt,
        model=model,
        padding=req.padding,
    )
    existing = JOB_STORE.get_job_by_idempotency_key(kind="crop_inpaint_retry", idempotency_key=key)
    if existing is not None:
        if _should_requeue_failed_generation_job(existing):
            return JOB_STORE.requeue_job(existing.id, reason="Retry requested through failed-dog inpaint endpoint.")
        return existing
    return JOB_STORE.create_job(
        kind="crop_inpaint_retry",
        session_id=session_id,
        idempotency_key=key,
        input_hash=key,
        metadata={
            "dogIndices": dog_indices,
            "prompt": req.prompt,
            "model": model,
            "padding": req.padding,
            "safeToRequeue": True,
        },
    )


def _retry_failed_dogs_job_response(job: JobRecord) -> RetryFailedDogsJobResponse:
    children = sorted(
        JOB_STORE.list_child_jobs(job.id, kind=_CROP_INPAINT_UNIT_KIND),
        key=lambda child: int(child.metadata.get("dogIndex") or 0),
    )
    units = [
        RetryFailedDogUnitResponse(
            dogIndex=int(child.metadata.get("dogIndex") or child.result.get("dogIndex") or 0),
            status=child.status,
            retryable=child.retryable,
            error=child.error_message,
            file=child.result.get("file") if isinstance(child.result.get("file"), str) else None,
            variantIndex=child.result.get("variantIndex") if isinstance(child.result.get("variantIndex"), int) else None,
        )
        for child in children
    ]
    return RetryFailedDogsJobResponse(
        jobId=job.id,
        status=job.status,
        succeeded=int(job.result.get("succeeded") or 0),
        failed=int(job.result.get("failed") or 0),
        units=units,
        error=job.error_message,
    )


def _prepare_retry_failed_dog_unit_jobs(
    job: JobRecord,
    store: JobStore,
    dog_indices: list[int],
) -> dict[int, JobRecord]:
    child_jobs: dict[int, JobRecord] = {}
    for dog_index in dog_indices:
        child = store.create_job(
            kind=_CROP_INPAINT_UNIT_KIND,
            session_id=job.session_id,
            parent_job_id=job.id,
            idempotency_key=f"{job.id}:dog:{dog_index}",
            metadata={
                "dogIndex": dog_index,
                "passIndex": 0,
                "safeToRequeue": True,
                "retryKind": "failed_dog",
            },
        )
        # A child that already succeeded in a prior attempt must keep that state
        # across a parent requeue — requeuing it back to "queued" would cause the
        # run loop to re-submit an already-paid dog to the provider (R3: a per-dog
        # failure must never re-bill the dogs that already succeeded). Only failed
        # or orphaned children are reset for a fresh attempt.
        if child.status not in ("queued", "succeeded"):
            child = store.requeue_job(
                child.id,
                reason="Parent failed-dog retry job started a fresh attempt.",
            )
        child_jobs[dog_index] = child
    return child_jobs


def _run_retry_failed_dogs_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    metadata = job.metadata
    session_id = job.session_id
    dog_indices = [int(index) for index in metadata["dogIndices"]]
    prompt = str(metadata["prompt"])
    model = str(metadata.get("model") or "")
    padding = float(metadata.get("padding") or 2.75)
    child_jobs = _prepare_retry_failed_dog_unit_jobs(job, store, dog_indices)
    succeeded = 0
    failed = 0

    for dog_index in dog_indices:
        child = child_jobs.get(dog_index)
        if child is not None and child.status == "succeeded":
            # Completed and paid for in a prior attempt; skip the provider call on
            # requeue and re-emit completion so the event stream and progress stay
            # coherent without re-billing (R3).
            prior = child.result if isinstance(child.result, dict) else {}
            store.append_event(job.id, "dog_complete", data={
                "dogIndex": dog_index,
                "status": "done",
                "file": prior.get("file"),
                "variantIndex": prior.get("variantIndex"),
                "passIndex": 0,
            })
            succeeded += 1
            continue
        S.update_dog_status(session_id, dog_index, "generating")
        _mark_crop_inpaint_unit_running(child_jobs, dog_index, parent=job, store=store)
        store.append_event(job.id, "dog_start", data={
            "dogIndex": dog_index,
            "status": "generating",
            "passIndex": 0,
        })
        store.update_metadata(job.id, {"safeToRequeue": False, "providerSubmissionStarted": True})
        try:
            result = _run_single_dog_regen(
                session_id,
                dog_index,
                prompt=prompt,
                padding=padding,
                inpaint_model=model,
                defer_composite=True,
            )
            variant_idx = int(result["variantIndex"])
            file_name = str(result["file"])
            _mark_crop_inpaint_unit_succeeded(
                child_jobs,
                dog_index,
                file_name=file_name,
                variant_idx=variant_idx,
                pass_index=0,
                store=store,
            )
            store.append_event(job.id, "dog_complete", data={
                "dogIndex": dog_index,
                "status": "done",
                "file": file_name,
                "variantIndex": variant_idx,
                "passIndex": 0,
            })
            succeeded += 1
        except InpaintError as exc:
            error_message = _sanitized_error(exc.cause)
            S.update_dog_status(session_id, dog_index, "error")
            _mark_crop_inpaint_unit_failed(
                child_jobs,
                dog_index,
                error_message=error_message,
                pass_index=0,
                store=store,
            )
            store.append_event(job.id, "dog_error", data={
                "dogIndex": dog_index,
                "status": "error",
                "error": error_message,
                "passIndex": 0,
            })
            failed += 1

    if succeeded > 0:
        recomposite_color(session_id)
    result_data = {"succeeded": succeeded, "failed": failed, "dogIndices": dog_indices}
    store.update_result(job.id, result_data)
    store.append_event(job.id, "retry_failed_dogs_complete", data=result_data)
    if failed > 0:
        store.transition_job(
            job.id,
            status="failed_retryable",
            stage="partial_failed_retryable",
            retryable=True,
            error_code="failed_dog_retry_failed",
            error_message=f"{failed} failed dog retry attempt(s) did not complete.",
            result=result_data,
        )
    return result_data


@router.post("/sessions/{session_id}/dogs/retry-inpaint/jobs", response_model=RetryFailedDogsJobResponse)
def start_retry_failed_dogs_job(session_id: str, req: RetryFailedDogsJobRequest) -> RetryFailedDogsJobResponse:
    job = _start_retry_failed_dogs_job_record(session_id, req)
    worker = get_default_job_worker()
    register_job_handlers(worker)
    worker.start()
    return _retry_failed_dogs_job_response(job)


@router.get("/sessions/{session_id}/dogs/retry-inpaint/jobs/{job_id}", response_model=RetryFailedDogsJobResponse)
def get_retry_failed_dogs_job(session_id: str, job_id: str) -> RetryFailedDogsJobResponse:
    _validate_session_id(session_id)
    job = JOB_STORE.get_job(job_id)
    if job is None or job.session_id != session_id or job.kind != "crop_inpaint_retry":
        raise HTTPException(404, detail={"error": "Job not found"})
    return _retry_failed_dogs_job_response(job)


# ── Recomposite helper ───────────────────────────────────────────────────────
#
# Rebuild color.png from the clean background + every dog's currently-active
# variant. Called after a variant swap so the scene reflects the chosen
# variant immediately (without waiting for the next regen).

# Sprite-only compositing (plan 2026-07-31-002 U6): the scene receives ONLY the
# validated pickup sprite, not the whole diff-masked variant. Pickup then
# restores pixel-identical background — pop-in impossible by construction.
# Dogs without a usable sprite fall back to the legacy diff paste (they are
# already repair-flagged; export refuses them). Opt out with =0.
def _sprite_only_compose_enabled() -> bool:
    return os.environ.get("FTD_SPRITE_ONLY_COMPOSE", "1").strip().lower() not in {"0", "false", "no"}


def _paste_pickup_sprite(
    result: Image.Image,
    bg_clean: Image.Image,
    dog_dir,
    variant_idx: int,
    *,
    restore_cleanup: bool,
) -> bool:
    """Paste dog_dir's pickup sprite onto result. Returns False when the dog
    has no usable sprite (caller falls back to the legacy diff paste)."""
    meta_path = dog_dir / f"sprite_{variant_idx:03d}.json"
    sprite_path = dog_dir / f"sprite_{variant_idx:03d}.png"
    if not meta_path.exists() or not sprite_path.exists():
        return False
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    if not (meta.get("quality") or {}).get("pickupUsable"):
        return False
    sprite_box = meta.get("spriteBox")
    if not (isinstance(sprite_box, list) and len(sprite_box) == 4):
        return False
    try:
        with Image.open(sprite_path) as simg:
            simg.load()
            sprite = simg.convert("RGBA").copy()
    except (OSError, ValueError):
        return False
    if restore_cleanup:
        # Magenta-mode base is the previous composite; scrub the old broad
        # paste back to clean background before the sprite lands.
        cleanup = meta.get("cleanupBox") or sprite_box
        x0, y0, x1, y1 = (int(v) for v in cleanup)
        region = bg_clean.crop((x0, y0, x1, y1))
        result.paste(region, (x0, y0))
        region.close()
    result.paste(sprite, (int(sprite_box[0]), int(sprite_box[1])), mask=sprite)
    sprite.close()
    return True


def compose_with_mask(session_id: str) -> Image.Image | None:
    """Build the full composite in memory using raw diff-mask paste.
    Pure function \u2014 does not touch disk. Returns a PIL RGB image or None
    if the session is missing its bg / hitboxes.

    Magenta mode uses the existing color.png as its base. Dogs without a
    per-dog variant remain untouched; repaired dogs with an active variant are
    composited over that base.
    """
    from PIL import UnidentifiedImageError
    raw = S.load_session_raw(session_id)
    if raw is None:
        return None
    selected_bg = _resolve_selected_bg(session_id, raw)
    if selected_bg is None:
        return None
    sdir = S.session_dir(session_id)
    bg_path = sdir / f"bg_{selected_bg:02d}.png"
    if not bg_path.exists():
        return None

    inpaint_mode = raw.get("inpaint_mode")
    color_path = sdir / "color.png"

    hb_path = sdir / "hitboxes.json"
    if not hb_path.exists():
        return None
    try:
        hitbox_list = json.loads(hb_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("compose_with_mask: failed to read hitboxes for %s: %s", session_id, exc)
        return None

    with Image.open(bg_path) as bg_src:
        bg_src.load()
        bg_clean = bg_src.convert("RGB").copy()
    if inpaint_mode == "magenta" and color_path.exists():
        with Image.open(color_path) as existing:
            existing.load()
            result = existing.convert("RGB").copy()
    else:
        result = bg_clean.copy()
    w, h = result.size

    raw_dogs = raw.get("dogs", [])
    target_map = S.active_dog_variant_targets(session_id, raw_dogs, hitbox_list)
    if not target_map:
        dogs_meta = {d["index"]: d for d in raw_dogs}
        target_map = {
            i: (i, meta.get("activeVariant"))
            for i, meta in dogs_meta.items()
            if isinstance(i, int) and S.is_painted_dog_meta(meta)
        }
    # Stable-id join (review P1 #2): bind each hitbox to its dog by hitbox.id ==
    # dog.id, NOT by array position. After a delete-by-id tombstone gap a survivor
    # has dog.index >= len(hitbox_list), so the positional/geometric target_map
    # (which needs a .box.json sidecar to remap) silently DROPS it — the id-join
    # binds it straight to its dog_{index} folder. Falls back to target_map for
    # legacy id-less hitboxes/dogs.
    # Only id-join ids that are UNIQUE among painted dogs (fix-rereview P2 #3): a
    # duplicate id (corrupted/legacy session or a future mint collision) would
    # collapse two dogs in this last-wins dict — one silently dropped, the other
    # pasted at BOTH hitboxes. Duplicates fall back to the positional target_map
    # and are logged. CAVEAT (final-rereview P3): the positional path binds them
    # correctly only in a CONTIGUOUS array; a duplicate-id dog behind a tombstone
    # gap can still be dropped — an accepted limit on already-corrupt input, which
    # canonical_migration/backfill quarantine before it reaches here.
    _painted = [d for d in raw_dogs if isinstance(d, dict) and d.get("id") and S.is_painted_dog_meta(d)]
    _id_counts: dict[str, int] = {}
    for _d in _painted:
        _id_counts[_d["id"]] = _id_counts.get(_d["id"], 0) + 1
    _dupe_ids = [k for k, c in _id_counts.items() if c > 1]
    if _dupe_ids:
        logger.warning(
            "compose_with_mask: duplicate dog ids %s (session=%s) — positional fallback for those",
            _dupe_ids, session_id,
        )
    dogs_by_id = {_d["id"]: _d for _d in _painted if _id_counts[_d["id"]] == 1}
    # Targets already bound to their OWN (id) hitbox — the positional fallback must
    # not re-paste them at a second hitbox (fix-rereview P3 #4, the double-paste).
    # Restrict to dogs whose id ACTUALLY matches a hitbox in THIS array (final-
    # rereview P2): on a legacy session (id-less hitboxes + id-stamped dogs) every
    # dog would otherwise land here and the positional fallback — the ONLY path
    # that paints legacy hitboxes — would be skipped for all of them (silent
    # all-blank). With no matching hitbox ids the set is empty and legacy paints.
    _hitbox_ids = {h.get("id") for h in hitbox_list if isinstance(h, dict) and h.get("id")}
    id_bound_targets = {
        (_d["index"], _d.get("activeVariant"))
        for _d in dogs_by_id.values() if _d["id"] in _hitbox_ids
    }

    for i, hb_data in enumerate(hitbox_list):
        hb_id = hb_data.get("id") if isinstance(hb_data, dict) else None
        dog = dogs_by_id.get(hb_id) if hb_id else None
        if dog is not None:
            dog_index, av = dog["index"], dog.get("activeVariant")
        else:
            target = target_map.get(i)
            if target is None:
                continue
            dog_index, av = target
            if (dog_index, av) in id_bound_targets:
                continue
        if av is None:
            continue
        dog_dir = S.dogs_dir(session_id) / f"dog_{dog_index:02d}"
        if _sprite_only_compose_enabled() and _paste_pickup_sprite(
            result, bg_clean, dog_dir, av,
            restore_cleanup=inpaint_mode == "magenta" and color_path.exists(),
        ):
            continue
        variant_path = dog_dir / f"variant_{av:03d}.png"
        if not variant_path.exists():
            continue
        hb = Hitbox(x=hb_data["x"], y=hb_data["y"], radius=hb_data.get("r", hb_data.get("radius", 30)))
        try:
            with Image.open(variant_path) as vimg:
                vimg.load()
                variant = vimg.convert("RGB").copy()
        except (OSError, UnidentifiedImageError) as exc:
            logger.warning("compose_with_mask: bad variant %s for %s/%s: %s", av, session_id, i, exc)
            continue
        # Prefer the sidecar box written at save time — it's authoritative
        # for (left, upper, right, lower) regardless of hitbox proximity to
        # an edge. Without this, a wide-crop regen (padding=3.0) on a dog
        # near an image border produced a clipped crop, and at compose time
        # width-based padding inference gave a DIFFERENT padding → the
        # recomputed box shifted relative to the original paint.
        sidecar_box = _load_variant_box(variant_path)
        if sidecar_box is not None:
            box = sidecar_box
        else:
            # Legacy variant without sidecar. Fall back to size-based
            # inference. Variant files on disk may be at padding=1.5
            # (legacy default), 2.0 (inpaint), or 3.0 (wide-crop regen).
            # Use whatever size the variant actually has — do NOT clamp.
            inferred_padding = max(1.0, variant.size[0] / (2.0 * max(hb.radius, 1)))
            box = _crop_box(hb, w, h, padding=inferred_padding)
        expected = (box[2] - box[0], box[3] - box[1])
        if variant.size != expected:
            resized = variant.resize(expected, Image.LANCZOS)
            variant.close()
            variant = resized
        crop_before = bg_clean.crop(box)
        diff = _extract_dog_pixels(crop_before, variant, threshold=30)

        result.paste(variant, (box[0], box[1]), mask=diff)
        crop_before.close()
        diff.close()
        variant.close()

    bg_clean.close()
    return result


def refresh_color_only(session_id: str) -> None:
    """Recompose ONLY color.png from the current per-dog variants (final-rereview
    P2). Unlike `recomposite_color`, this does NOT touch level.json / bw.png /
    eval.png: the export path authors level.json itself (from
    active_dog_variant_targets), so a full recompose at export time would clobber
    it with the divergent is_painted_dog_meta projection — and running before the
    export's validation gates left a rejected export with a mutated session dir.
    Call this AFTER the gates pass to freshen the gemini color.png the by-id
    recompose split can leave stale. Atomic write, no lock acquisition (so it can
    never deadlock against a lock the caller may hold)."""
    img = compose_with_mask(session_id)
    if img is None:
        return
    _atomic_save_image(img, S.session_dir(session_id) / "color.png")
    img.close()


def recomposite_color(session_id: str) -> None:
    """Disk-writing wrapper around `compose_with_mask`. Writes color.png
    and, if every hitbox now has a valid active variant, bumps level.json
    + bw.png + eval.png so the session becomes exportable.

    The initial inpaint stream only wrote level.json on full success. After
    a partial run (e.g. 9/10), recomposites from per-dog regen updated
    color.png but never level.json — the user could see the full preview
    but got 'missing level.json' on export. Now every recomposite that
    lands on a complete set of variants finalises the export artifacts.

    Concurrency: several entry points can fire this simultaneously
    (`regen_dog`, legacy `recomposite_apply`, `set_active_variant`).
    Pre-fix they raced on the tmp dentry of `color.png` / `level.json`;
    now atomic writes use unique pid+uuid tmp names AND the disk-write
    section is serialised under `S._session_lock` so concurrent calls
    produce a consistent final state. The heavy `compose_with_mask`
    (read-only PIL work) stays OUTSIDE the lock — serialising that block
    would stall every other session-state mutator behind 0.5-1.5s of compute.
    """
    img = compose_with_mask(session_id)
    if img is None:
        return
    sdir = S.session_dir(session_id)

    # Hold the session lock around the disk-write block so concurrent
    # callers don't interleave level.json / bw.png / eval.png writes.
    # Outside the lock: compose_with_mask (already done above). The PIL
    # compute can be several seconds on dense 2K/40-animal levels and would
    # stall every other session-state mutator if locked.
    _lock_t0 = time.perf_counter()
    with S._session_lock:
        _lock_wait_s = time.perf_counter() - _lock_t0
        if _lock_wait_s > 0.2:
            logger.warning(
                "recomposite_color lock wait %.2fs (session=%s) — contention visible",
                _lock_wait_s, session_id,
            )
        _atomic_save_image(img, sdir / "color.png")

        # Finalise export artifacts for whatever dogs DO have variants. A
        # partial run (e.g. 9/10) is still a shippable level — the exported
        # level.json's dogs[] lists only the hitboxes that actually got
        # painted. The user can retry the failed dog later and re-export.
        raw = S.load_session_raw(session_id)
        if raw is not None:
            hb_path = sdir / "hitboxes.json"
            if hb_path.exists():
                try:
                    hitbox_list = json.loads(hb_path.read_text())
                except (OSError, json.JSONDecodeError):
                    hitbox_list = None
                if hitbox_list:
                    dogs_meta = {d["index"]: d for d in raw.get("dogs", [])}
                    painted_hitboxes = [
                        (i, hb) for i, hb in enumerate(hitbox_list)
                        if S.is_painted_dog_meta(dogs_meta.get(i))
                    ]
                    bg_idx = raw.get("selected_bg")
                    bg_path = sdir / f"bg_{bg_idx:02d}.png" if bg_idx is not None else None
                    if bg_path and bg_path.exists():
                        with Image.open(bg_path) as bg_src:
                            bg_src.load()
                            bg_rgb = bg_src.convert("RGB")
                            bw = bg_rgb.convert("L").convert("RGB")
                            _atomic_save_image(bw, sdir / "bw.png")
                            bw.close()
                            bg_rgb.close()
                        if painted_hitboxes:
                            hb_objects = [Hitbox(x=hb["x"], y=hb["y"], radius=hb.get("r", hb.get("radius", 30))) for _, hb in painted_hitboxes]
                            eval_img = evaluate_hitboxes(img, hb_objects, opacity=0.3)
                            _atomic_save_image(eval_img, sdir / "eval.png")
                            eval_img.close()
                        w_img, h_img = img.size
                        level_data = S.build_level_dict(
                            session_id, hitbox_list,
                            width=w_img, height=h_img,
                            style=raw.get("style"),
                            painted_indices=[i for i, _ in painted_hitboxes],
                            sprite_metadata_by_index=S.active_sprite_metadata_map(
                                session_id,
                                raw.get("dogs", []),
                                hitbox_list,
                            ),
                        )
                        _atomic_write_json(level_data, sdir / "level.json")

    img.close()


@router.get("/sessions/{session_id}/recomposite-preview")
def recomposite_preview(
    session_id: str,
    radial: float = Query(0.0, ge=0.0, le=3.0),
    feather: float = Query(0.0, ge=0.0, le=30.0),
    scale: float = Query(0.5, gt=0.0, le=1.0, description="Downscale factor for preview."),
):
    """Return an in-memory raw diff-mask composite (JPEG).
    `radial` / `feather` query params are accepted for legacy callers but ignored."""
    _validate_session_id(session_id)
    try:
        img = compose_with_mask(session_id)
    except Exception as e:  # noqa: BLE001 \u2014 surface compose failures as 500 rather than hiding them behind a bare try
        logger.exception("compose_with_mask failed for %s", session_id)
        raise HTTPException(500, detail={"error": f"compose failed: {type(e).__name__}"})
    if img is None:
        raise HTTPException(400, detail={"error": "session has no bg or hitboxes"})
    if scale < 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    img.close()
    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


class RecompositeRequest(BaseModel):
    radial: float = Field(0.0, ge=0.0, le=3.0)
    feather: float = Field(0.0, ge=0.0, le=30.0)


@router.post("/sessions/{session_id}/recomposite")
def recomposite_apply(session_id: str, req: RecompositeRequest):
    """Rebuild color.png with raw diff-mask paste.

    `radial` / `feather` are accepted for legacy callers but ignored; they
    are persisted as zero so old non-zero values cannot change future output.
    """
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    recomposite_color(session_id)
    S.update_session_field(session_id, mask_params={"radial": 0.0, "feather": 0.0})
    return {"ok": True, "radial": 0.0, "feather": 0.0}


# ── Magenta-overlay inpaint ──────────────────────────────────────────────────
#
# Alternative to per-crop inpaint: paint opaque magenta (#FF00FF) discs over
# the background at every hitbox, send ONE edit_image call asking the model
# to replace each magenta circle with the entity while preserving the rest
# of the scene. One API call per level instead of N. The whole-scene context
# lets the model match scale/lighting across entities more consistently than
# independent crops.
#
# Trade-offs vs per-crop:
#  + Scale/lighting coherence across all entities in one pass
#  + 1 API call, not N (lower latency, lower cost for high N)
#  - No per-dog variants (dogs/ directory is not populated)
#  - Per-dog regeneration falls back to the per-crop path
#  - Model may bleed magenta tint if the prompt doesn't explicitly forbid it

_MAGENTA_RGB = (255, 0, 255)
# Hard-difficulty marker (2026-08-05 experiment): circles for camouflage
# birds are drawn in cyan so the model can treat the two classes differently
# in ONE call. A hitbox opts in via {"difficulty": "hard"}; anything else is
# easy/magenta.
_HARD_RGB = (0, 255, 255)


def _hitbox_is_hard(hb: dict) -> bool:
    return str(hb.get("difficulty") or "").lower() == "hard"


def _build_magenta_overlay(bg: Image.Image, hitboxes: list[dict]) -> Image.Image:
    from PIL import ImageDraw
    overlay = bg.convert("RGB").copy()
    draw = ImageDraw.Draw(overlay)
    for hb in hitboxes:
        cx, cy, r = hb["x"], hb["y"], hb["r"]
        fill = _HARD_RGB if _hitbox_is_hard(hb) else _MAGENTA_RGB
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)
    return overlay


# Fragment strips stay alongside the sentence regexes: styled entity-prompt
# overrides phrase positioning differently and only partially match the
# sentence patterns above.
_POSITIONAL_PHRASES = [
    "at the center of the image",
    "occupying roughly the central third of the frame (not filling it).",
    "occupying roughly the central third of the frame",
    "do not repeat the subject.",
    "Keep all other elements of the image unchanged.",
]

# Whole sentences whose subject-count claims ("exactly one ... to this crop")
# contradict the magenta wrapper's one-per-circle instruction for a
# multi-marker full-scene edit. Stripped as complete sentences so no dangling
# fragments survive into SUBJECT.
_POSITIONAL_SENTENCES = [
    # Loose tail: styled overrides continue past "to this crop" with a comma
    # ("...to this crop, centered on the marked target area.").
    re.compile(r"Add exactly one [^.]*?to this crop[^.]*\.\s*"),
    re.compile(r"Place exactly one [^.]*?(?:—[^.]*)?\.\s*"),
]


def _strip_positional_phrases(entity_prompt: str) -> str:
    """The wizard entity_prompt carries per-crop framing clauses ("at the
    center of the image", ...). Marker-based modes (magenta discs, ring
    outlines) position by marker, so those clauses are stripped while the
    aesthetic/charm/style clauses are kept."""
    cleaned = entity_prompt.strip()
    for rx in _POSITIONAL_SENTENCES:
        cleaned = rx.sub("", cleaned)
    for p in _POSITIONAL_PHRASES:
        cleaned = cleaned.replace(p, "")
    return re.sub(r"\s{2,}", " ", cleaned).replace(" ,", ",").replace(" .", ".").strip()








def _magenta_prompt(entity_prompt: str, *, hard: bool = False) -> str:
    # The entity_prompt from the wizard is tuned for per-crop inpaint
    # ("Add exactly one cute X at the center of the image, occupying
    # roughly the central third of the frame"). Those positional claims
    # conflict with magenta-mode semantics (one instance per circle,
    # scale = circle radius, not frame-relative). Strip the framing
    # clauses that no longer apply, keep the aesthetic clauses.
    cleaned = _strip_positional_phrases(entity_prompt)

    hard_block = ""
    if hard:
        hard_block = (
            "DIFFICULTY: Some circles are bright CYAN (#00FFFF) instead of "
            "magenta. Cyan circles mark CAMOUFLAGE subjects: render that "
            "subject genuinely hidden \u2014 tucked behind or beside a prop, "
            "partially occluded, its colors drawn from the immediate "
            "surroundings so it does not pop out, posed still and low. It must "
            "remain findable by a careful player: keep its outline drawn in "
            "the scene's line style and at least a third of its body visible "
            "(an eye, beak, or wing edge readable on close inspection). Never "
            "erase it, never fade it into pure texture. Magenta circles stay "
            "clearly readable subjects as described above.\n\n"
        )

    return (
        "TASK: This image contains several opaque bright marker circles "
        "painted on top of a scene \u2014 bright magenta (#FF00FF)"
        + (" and bright cyan (#00FFFF)" if hard else "")
        + " circular regions. The circles are "
        "LOCATION MARKERS ONLY \u2014 each one marks roughly where one instance "
        "of the subject should appear. Replace every marker circle with exactly "
        "one instance of the subject described below, centered near that "
        "circle's position.\n\n"
        f"SUBJECT: {cleaned}\n\n"
        + hard_block +
        "SCALE: Do NOT fill the circle. Render the subject at whatever physical "
        "size is realistic for this scene \u2014 compare it to the other visible "
        "objects around that spot (doorways, furniture, crates, stalls, trees, "
        "etc.) and size the subject so it looks like it actually belongs there. "
        "If the subject is a small animal, it should look small relative to "
        "human-scale props in the scene, even when the magenta circle is large. "
        "If the magenta circle is larger than a realistic subject, leave the "
        "remainder of the circle area filled with what the surrounding scene "
        "would plausibly contain at that spot (ground, floor, background texture).\n\n"
        "STYLE: Match the surrounding scene's art style, palette, line weight, "
        "lighting, shadow direction, and level of detail exactly. The subject "
        "must look like it was always part of the illustration.\n\n"
        "HARD CONSTRAINTS: "
        "(1) Every marker region must be fully replaced \u2014 no magenta"
        + (" or cyan" if hard else "")
        + " marker pixels may remain. "
        "(2) Do not create any new marker-color (#FF00FF"
        + (" or #00FFFF" if hard else "")
        + ") pixels anywhere in "
        "the output; legitimate pink or magenta scene art that already exists "
        "outside the circles stays untouched. "
        "(3) Do not alter pixels far from the marker regions \u2014 keep the "
        "rest of the scene pixel-identical. "
        "(4) Produce exactly one subject per circle; do not clone the subject "
        "into the surrounding scene."
    )


def _chrome_band_heights(width: int, height: int) -> tuple[int, int]:
    """Safe-area improvement (issue #31): for square (pan/zoom) scenes the
    HUD band and ad-banner band are cropped out of the image sent to the
    full-scene magenta call, so the model physically cannot paint a subject
    behind chrome — and each call ships ~20-25% fewer pixels. Returns
    (top, bottom) crop heights; (0, 0) disables cropping for non-square
    scenes, whose portrait framing assumptions we don't want to disturb."""
    if not (height > 0 and 0.95 <= width / height <= 1.05):
        return (0, 0)
    from levelbuilder.sections import BANNER_FRACTION, HUD_FRACTION
    return (int(height * HUD_FRACTION), int(height * BANNER_FRACTION))


def _chrome_crop_box(width: int, height: int) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) crop box for the magenta send region.
    The region is SQUARE: height = between the chrome bands, width trimmed
    to match via sections.square_send_side_margin (models honor 1:1 far
    more reliably than odd aspects, and the aspect guard bills every
    refused draw). Full frame for non-square scenes."""
    band_top, band_bottom = _chrome_band_heights(width, height)
    if not (band_top or band_bottom):
        return (0, 0, width, height)
    from levelbuilder.sections import square_send_side_margin
    side = square_send_side_margin(width, height)
    inner_h = height - band_top - band_bottom
    left = side
    right = min(width - side, left + inner_h)
    return (left, band_top, right, height - band_bottom)


def detect_painted_subjects(
    session_id: str,
    *,
    threshold: int = 40,
    min_area: int = 400,
    merge_px: int = 4,
    pad: int = 6,
) -> list[dict]:
    """Deterministic subject detection for magenta-painted scenes: everything
    that differs from the clean selected background IS painted subject matter
    (the chrome bands paste back as pure background, so they never diff).
    Connected components after a small dilation (merges a bird with its
    detached shadow) become detections for reconcile/materialize."""
    import numpy as _np
    from scipy import ndimage as _ndi

    raw = S.load_session_raw(session_id)
    if raw is None:
        raise S.LevelNotReadyError(f"session {session_id} not found")
    sdir = S.session_dir(session_id)
    selected = _resolve_selected_bg(session_id, raw)
    if selected is None:
        raise S.LevelNotReadyError("No background selected")
    bg_path = sdir / f"bg_{selected:02d}.png"
    color_path = sdir / "color.png"
    if not bg_path.exists() or not color_path.exists():
        raise S.LevelNotReadyError("clean background and painted color are both required")
    with Image.open(bg_path) as a_img, Image.open(color_path) as b_img:
        a = _np.asarray(a_img.convert("RGB"), dtype=_np.int16)
        b = _np.asarray(b_img.convert("RGB"), dtype=_np.int16)
    if a.shape != b.shape:
        raise S.LevelNotReadyError(
            f"background {a.shape} and color {b.shape} dimensions differ"
        )
    changed = _np.abs(a - b).sum(axis=2) > threshold
    if merge_px > 0:
        changed = _ndi.binary_dilation(changed, iterations=merge_px)
    labels, n = _ndi.label(changed)
    detections: list[dict] = []
    for sl in _ndi.find_objects(labels):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if w * h < min_area:
            continue
        detections.append({
            "x": max(0, sl[1].start - pad),
            "y": max(0, sl[0].start - pad),
            "width": w + 2 * pad,
            "height": h + 2 * pad,
            "confidence": 1.0,
        })
    detections.sort(key=lambda d: d["width"] * d["height"], reverse=True)
    return detections


def _band_feather_mask(size: tuple[int, int], feather: int = 48, *, sides: bool = False) -> Image.Image:
    """Alpha mask fading the pasted band into the clean background across its
    top/bottom edges (and, with sides=True, all four edges), so model drift
    near its frame edges cannot print a hard seam at the crop boundary
    (#31 watch item, observed on the first band-cropped level)."""
    w, h = size
    mask = Image.new("L", size, 255)
    px = mask.load()
    steps = max(1, min(feather, h // 4))
    for i in range(steps):
        v = int(255 * (i + 1) / (steps + 1))
        for x in range(w):
            px[x, i] = min(px[x, i], v)
            px[x, h - 1 - i] = min(px[x, h - 1 - i], v)
    if sides:
        steps_x = max(1, min(feather, w // 4))
        for i in range(steps_x):
            v = int(255 * (i + 1) / (steps_x + 1))
            for y in range(h):
                px[i, y] = min(px[i, y], v)
                px[w - 1 - i, y] = min(px[w - 1 - i, y], v)
    return mask


def detect_birds_vlm(session_id: str, *, model: str = "gemini-3.6-flash") -> list[dict]:
    """VLM bounding-box bird detection — the calibration winner on the
    10-keeper ground truth (95.5% recall / 96.1% precision, ~53px center
    error before the local-diff snap). One metered call per scene; scales
    Gemini's 0-1000 box space by the ACTUAL scene size (the calibration
    outliers were exactly a hardcoded-4096 mapping on 1K scenes)."""
    import base64 as _b64
    import io as _io
    import httpx as _httpx

    use_openrouter = bool(os.environ.get("MERCEKA_FORCE_OPENROUTER")) or not os.environ.get("GOOGLE_API_KEY")
    api_key = os.environ.get("GOOGLE_API_KEY")
    sdir = S.session_dir(session_id)
    entity = str((S.load_session_raw(session_id) or {}).get("entity") or "bird")
    with Image.open(sdir / "color.png") as _c:
        W, H = _c.size
        scaled = _c.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    buf = _io.BytesIO(); scaled.save(buf, "PNG"); scaled.close()
    payload = {
        "contents": [{"parts": [
            {"inlineData": {"mimeType": "image/png", "data": _b64.b64encode(buf.getvalue()).decode()}},
            {"text": f"Detect every {entity} in this illustrated hidden-object scene. Return bounding boxes for ALL {entity}s."},
        ]}],
        "generationConfig": {"responseMimeType": "application/json",
            "responseSchema": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}},
                "label": {"type": "STRING"}}, "required": ["box_2d"]}}},
    }
    boxes = None
    if not use_openrouter:
        data = None
        for attempt in range(3):
            resp = _httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                json=payload, headers={"x-goog-api-key": api_key}, timeout=180,
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                if "RESOURCE_EXHAUSTED" in resp.text:
                    break  # billing depleted: no point retrying — fall through to OpenRouter
                import time as _t
                _t.sleep(min(60, 5 * (2 ** attempt)))
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        if data is not None:
            try:
                from merceka_core import costs as _mc
                _mc.record(source="google-direct", model=f"google/{model}", usage=data.get("usageMetadata"))
            except Exception:
                pass
            boxes = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
    if boxes is None:
        or_key = os.environ.get("OPENROUTER_API_KEY")
        if not or_key:
            raise S.LevelNotReadyError("no usable vision provider (Google depleted, no OPENROUTER_API_KEY)")
        or_payload = {
            "model": f"google/{model}",
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + _b64.b64encode(buf.getvalue()).decode()}},
                {"type": "text", "text": "Detect every bird in this illustrated hidden-object scene. Return STRICT JSON: an array of objects {\"box_2d\": [ymin,xmin,ymax,xmax]} with coordinates in 0-1000 normalized space. No prose."},
            ]}],
            "usage": {"include": True},
        }
        for attempt in range(4):
            resp = _httpx.post("https://openrouter.ai/api/v1/chat/completions", json=or_payload,
                               headers={"Authorization": f"Bearer {or_key}"}, timeout=180)
            if resp.status_code == 429 or resp.status_code >= 500:
                import time as _t
                _t.sleep(min(60, 5 * (2 ** attempt)))
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        else:
            raise S.LevelNotReadyError("OpenRouter VLM detection rate-limited after retries")
        try:
            from merceka_core import costs as _mc
            usage = data.get("usage") or {}
            _mc.record(source="openrouter", model=f"google/{model}", usage=usage, usd=usage.get("cost"))
        except Exception:
            pass
        txt = data["choices"][0]["message"]["content"]
        txt = txt[txt.find("["): txt.rfind("]") + 1]
        boxes = json.loads(txt)
    dets = []
    for b in boxes:
        y0, x0, y1, x1 = b["box_2d"]  # [ymin,xmin,ymax,xmax] in 0-1000
        dets.append({
            "x": int(x0 * W / 1000), "y": int(y0 * H / 1000),
            "width": int((x1 - x0) * W / 1000), "height": int((y1 - y0) * H / 1000),
            "confidence": 1.0,
        })
    return dets


def uniform_hitbox_radius(dim: int) -> int:
    """Tap-generosity radius scaled to scene size: 87px in 4096-space (the
    golden-set convention). The old fixed r=58 under-performs on 4096 scenes
    because the recentre's crop (2.2r) and max-shift (1.6r) scale with r —
    measured on the golden 22: scaled r R.981/P.978 vs raw 58 R.956/P.954
    (eval/FINDINGS.md, 2026-08-05)."""
    return max(18, min(200, round(87 * dim / 4096)))


def place_hitboxes_vlm(session_id: str, *, radius: int | None = None) -> dict:
    """Fully automated placement: VLM detections become the hitboxes (uniform
    radius, scene-scaled unless explicitly given), then the local-diff
    recentre snaps + writes footprint cleanups. Golden-set score:
    recall .978 / precision .978 / 31.9px center err (1-to-1 gate)."""
    dets = detect_birds_vlm(session_id)
    if not dets:
        raise S.LevelNotReadyError("VLM found no birds")
    if radius is None:
        with Image.open(S.session_dir(session_id) / "color.png") as _c:
            radius = uniform_hitbox_radius(_c.width)
    hitboxes = [
        {"x": d["x"] + d["width"] // 2, "y": d["y"] + d["height"] // 2, "r": radius}
        for d in dets
    ]
    persisted = S.save_hitboxes(session_id, hitboxes) or hitboxes
    result = recenter_hitboxes_local_diff(session_id)
    return {"sessionId": session_id, "placed": len(persisted), "recentre": result}


def recenter_hitboxes_local_diff(
    session_id: str,
    *,
    crop_factor: float = 2.2,
    threshold: int = 80,
    min_area: int = 900,
    max_shift_factor: float = 1.6,
    radius_scale: float = 1.0,
    prune_empty: bool = False,
) -> dict:
    """Snap each hitbox to the centroid of the nearest painted-diff component
    inside its own crop. Local scope defeats the scene-wide drift that broke
    global diff detection; a shift beyond max_shift_factor*r is refused
    (protects deliberate manual placements from bad snaps)."""
    import numpy as _np
    from scipy import ndimage as _ndi

    raw = S.load_session_raw(session_id)
    if raw is None:
        raise S.LevelNotReadyError(f"session {session_id} not found")
    sdir = S.session_dir(session_id)
    selected = _resolve_selected_bg(session_id, raw)
    bg = Image.open(sdir / f"bg_{selected:02d}.png").convert("RGB")
    color = Image.open(sdir / "color.png").convert("RGB")
    hb_path = sdir / "hitboxes.json"
    hitboxes = json.loads(hb_path.read_text())
    a_full = _np.asarray(bg, dtype=_np.int16)
    b_full = _np.asarray(color, dtype=_np.int16)
    moved = []
    pruned: list[dict] = []
    footprints: dict[int, tuple[int, int, int, int]] = {}
    overlap_flags: list[dict] = []
    for hb in hitboxes:
        r = int(hb.get("r") or 58)
        pad = int(r * crop_factor)
        x0, y0 = max(0, hb["x"] - pad), max(0, hb["y"] - pad)
        x1, y1 = min(color.width, hb["x"] + pad), min(color.height, hb["y"] + pad)
        diff = _np.abs(a_full[y0:y1, x0:x1] - b_full[y0:y1, x0:x1]).sum(axis=2) > threshold
        diff = _ndi.binary_dilation(diff, iterations=5)
        labels, n = _ndi.label(diff)
        best = None
        for idx, sl in enumerate(_ndi.find_objects(labels), start=1):
            if sl is None:
                continue
            h = sl[0].stop - sl[0].start
            w = sl[1].stop - sl[1].start
            if w * h < min_area:
                continue
            ys, xs = _np.nonzero(labels == idx)
            cy, cx = float(ys.mean()) + y0, float(xs.mean()) + x0
            dist = ((cx - hb["x"]) ** 2 + (cy - hb["y"]) ** 2) ** 0.5
            if best is None or dist < best[0]:
                best = (dist, cx, cy, idx)
        if best is None:
            if prune_empty:
                pruned.append({"id": hb.get("id"), "x": hb["x"], "y": hb["y"]})
            continue
        dist, cx, cy, _comp_idx = best
        if dist <= r * max_shift_factor and dist >= 3:
            moved.append({"id": hb.get("id"), "from": [hb["x"], hb["y"]], "to": [int(cx), int(cy)], "shift": round(dist, 1)})
            hb["x"], hb["y"] = int(cx), int(cy)
        if radius_scale != 1.0:
            hb["r"] = int(round(hb["r"] * radius_scale))
        # Export-gate invariant: the hitbox extent must stay inside the level.
        hb["r"] = max(18, min(hb["r"], hb["x"], hb["y"], color.width - hb["x"], color.height - hb["y"]))
        # Record the measured footprint; cleanup boxes are written after ALL
        # birds are measured so each box can avoid its neighbors' footprints.
        comp_mask = labels == _comp_idx
        ys, xs = _np.nonzero(comp_mask)
        footprints[hitboxes.index(hb)] = (
            int(xs.min()) + x0, int(ys.min()) + y0,
            int(xs.max()) + x0, int(ys.max()) + y0,
        )

    # Neighbor-aware cleanup boxes: full margin per side unless it would bite
    # another bird's footprint — the shipped background is birdless, so a box
    # overlapping neighbor PIXELS would erase that neighbor on pickup.
    # Hitboxes with no measured footprint keep their existing cleanup, which
    # can violate the contain-center gate — expand those minimally.
    for idx2, hb2 in enumerate(hitboxes):
        if idx2 in footprints:
            continue
        meta_path2 = S.dogs_dir(session_id) / f"dog_{idx2:02d}" / "sprite_000.json"
        if not meta_path2.exists():
            continue
        meta2 = json.loads(meta_path2.read_text())
        cu = meta2.get("cleanupBox")
        if not (isinstance(cu, list) and len(cu) == 4):
            continue
        pad_c2 = 20
        cu = [min(cu[0], max(0, hb2["x"] - pad_c2)), min(cu[1], max(0, hb2["y"] - pad_c2)),
              max(cu[2], min(color.width, hb2["x"] + pad_c2)), max(cu[3], min(color.height, hb2["y"] + pad_c2))]
        meta2["cleanupBox"] = cu
        meta_path2.write_text(json.dumps(meta2, indent=2))
    margin = 32
    final_boxes: dict[int, list[int]] = {}
    # Neighbor avoidance must consider both measured footprints AND the
    # neighbors' spriteBoxes: the runtime carves other dogs' sprite rects out
    # of each cleanup area and requires the tap center to survive the carve
    # (GameScene.assertRestorationDogGeometryReady threw on device build 9).
    sprite_boxes: dict[int, tuple[int, int, int, int]] = {}
    for j in range(len(hitboxes)):
        mp = S.dogs_dir(session_id) / f"dog_{j:02d}" / "sprite_000.json"
        if mp.exists():
            try:
                sb = json.loads(mp.read_text()).get("spriteBox")
                if isinstance(sb, list) and len(sb) == 4:
                    sprite_boxes[j] = tuple(int(v) for v in sb)
            except (OSError, ValueError):
                pass
    for idx, fp in footprints.items():
        fx0, fy0, fx1, fy1 = fp
        bx0, by0 = fx0 - margin, fy0 - margin
        bx1, by1 = fx1 + margin, fy1 + margin
        avoid = dict(footprints)
        for j, sb in sprite_boxes.items():
            if j == idx:
                continue
            ox0, oy0, ox1, oy1 = avoid.get(j, sb)
            avoid[j] = (min(ox0, sb[0]), min(oy0, sb[1]), max(ox1, sb[2]), max(oy1, sb[3]))
        for jdx, ofp in avoid.items():
            if jdx == idx:
                continue
            ox0, oy0, ox1, oy1 = ofp
            if bx1 <= ox0 or bx0 >= ox1 or by1 <= oy0 or by0 >= oy1:
                continue  # no overlap with neighbor footprint
            # Own footprints intersecting = inseparable pair; flag for HITL.
            if not (fx1 <= ox0 or fx0 >= ox1 or fy1 <= oy0 or fy0 >= oy1):
                overlap_flags.append({"a": idx, "b": jdx})
                continue
            # Pull back only the sides that reach into the neighbor.
            if fx1 <= ox0:
                bx1 = min(bx1, ox0 - 2)
            if fx0 >= ox1:
                bx0 = max(bx0, ox1 + 2)
            if fy1 <= oy0:
                by1 = min(by1, oy0 - 2)
            if fy0 >= oy1:
                by0 = max(by0, oy1 + 2)
        bx0 = max(0, min(bx0, fx0)); by0 = max(0, min(by0, fy0))
        bx1 = min(color.width, max(bx1, fx1)); by1 = min(color.height, max(by1, fy1))
        # Export-gate invariant: the cleanup box must contain its hitbox
        # center (with a small pad) even when the measured footprint sits
        # off-center from a hand placement the snap refused to move.
        hb_c = hitboxes[idx]
        pad_c = 20
        bx0 = min(bx0, max(0, hb_c["x"] - pad_c)); by0 = min(by0, max(0, hb_c["y"] - pad_c))
        bx1 = max(bx1, min(color.width, hb_c["x"] + pad_c)); by1 = max(by1, min(color.height, hb_c["y"] + pad_c))
        final_boxes[idx] = [int(bx0), int(by0), int(bx1), int(by1)]

    # Runtime contract (restorationDissolveRects): each dog's dissolve area is
    # its cleanup MINUS every other dog's cleanup, and the tap center must
    # survive. Overlapping cleanups mutually destroy each other, so make them
    # pairwise disjoint: split each overlapping pair at the bisector of the
    # two centers along the axis with the larger center separation.
    ids = sorted(final_boxes)
    for a_i in range(len(ids)):
        for b_i in range(a_i + 1, len(ids)):
            ia, ib = ids[a_i], ids[b_i]
            A, B = final_boxes[ia], final_boxes[ib]
            if A[2] <= B[0] or A[0] >= B[2] or A[3] <= B[1] or A[1] >= B[3]:
                continue
            ca = (hitboxes[ia]["x"], hitboxes[ia]["y"])
            cb = (hitboxes[ib]["x"], hitboxes[ib]["y"])
            if abs(ca[0] - cb[0]) >= abs(ca[1] - cb[1]):
                mid = (ca[0] + cb[0]) // 2
                left, right = (ia, ib) if ca[0] < cb[0] else (ib, ia)
                final_boxes[left][2] = min(final_boxes[left][2], mid - 1)
                final_boxes[right][0] = max(final_boxes[right][0], mid + 1)
            else:
                mid = (ca[1] + cb[1]) // 2
                top, bottom = (ia, ib) if ca[1] < cb[1] else (ib, ia)
                final_boxes[top][3] = min(final_boxes[top][3], mid - 1)
                final_boxes[bottom][1] = max(final_boxes[bottom][1], mid + 1)
    for idx, box in final_boxes.items():
        hbx, hby = hitboxes[idx]["x"], hitboxes[idx]["y"]
        box[0] = min(box[0], hbx - 10); box[1] = min(box[1], hby - 10)
        box[2] = max(box[2], hbx + 10); box[3] = max(box[3], hby + 10)
        meta_path = S.dogs_dir(session_id) / f"dog_{idx:02d}" / "sprite_000.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            meta["cleanupBox"] = box
            meta_path.write_text(json.dumps(meta, indent=2))
    if pruned:
        pruned_ids = {p["id"] for p in pruned}
        hitboxes = [h for h in hitboxes if h.get("id") not in pruned_ids]
    S.save_hitboxes(session_id, hitboxes)
    bg.close(); color.close()
    return {"sessionId": session_id, "moved": moved, "total": len(hitboxes), "overlapFlags": overlap_flags, "pruned": pruned}


def run_magenta_inpaint(
    session_id: str,
    *,
    hitbox_list: list[dict],
    dog_prompt: str,
    model: str,
    magenta_override: str = "",
    bg_index: int | None = None,
    cancel_check=None,
) -> dict:
    """Sync magenta-overlay inpaint core: overlay -> single edit_image call ->
    full finalize (color/inpainted/bw/eval/level.json + session flags).

    Extracted from the SSE route so the durable job worker and the comparison
    feature can run magenta without owning an EventSource. `cancel_check` is an
    optional callable raising to abort between phases.
    """
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise S.LevelNotReadyError(f"session {session_id} not found")
    sdir = S.session_dir(session_id)
    selected = bg_index if bg_index is not None else _resolve_selected_bg(session_id, raw)
    if selected is None:
        raise S.LevelNotReadyError("No background selected")
    bg_path = sdir / f"bg_{selected:02d}.png"
    if not bg_path.exists():
        raise S.LevelNotReadyError("Background file not found")

    with Image.open(bg_path) as bg_src:
        bg_src.load()
        bg = bg_src.copy()
    w, h = bg.size
    overlay = _build_magenta_overlay(bg, hitbox_list)
    has_hard = any(_hitbox_is_hard(hb) for hb in hitbox_list)
    prompt = magenta_override.strip() or _magenta_prompt(dog_prompt, hard=has_hard)
    try:
        if cancel_check is not None:
            cancel_check()
        crop_l, crop_t, crop_r, crop_b = _chrome_crop_box(w, h)
        # Every retried draw is a billed call; the count lands in the sidecar
        # so refused-draw burn is measurable at catalog scale.
        retry_count = 0

        def _count_retry(_attempt_idx, _exc):
            nonlocal retry_count
            retry_count += 1

        if (crop_l, crop_t, crop_r, crop_b) != (0, 0, w, h):
            # Send only the inner region; paste it back into the clean bg so
            # chrome bands AND side edge-margins stay exactly the background
            # (no paint possible there, no edge displacement possible there).
            send = overlay.crop((crop_l, crop_t, crop_r, crop_b))
            band = _with_retries_and_timeout(
                edit_image, send, prompt, model=model, on_attempt=_count_retry,
            )
            send.close()
            expected = (crop_r - crop_l, crop_b - crop_t)
            if band.size != expected:
                band = band.resize(expected, Image.LANCZOS)
            result = bg.copy()
            result.paste(band, (crop_l, crop_t), _band_feather_mask(band.size, sides=crop_l > 0))
            band.close()
        else:
            result = _with_retries_and_timeout(
                edit_image, overlay, prompt, model=model, on_attempt=_count_retry,
            )
            if result.size != (w, h):
                result = result.resize((w, h), Image.LANCZOS)
        if cancel_check is not None:
            cancel_check()

        _atomic_save_image(result, sdir / "inpainted.png")
        write_generation_sidecar(
            sdir / "inpainted.png", kind="magenta_inpaint", prompt=prompt, model=model,
            params={
                "hitboxes": len(hitbox_list), "width": w, "height": h,
                "attempts": retry_count + 1,
            },
        )
        # color.png is byte-identical to inpainted.png; copy the encoded file
        # instead of paying a second full-size PNG encode.
        _atomic_copy_file(sdir / "inpainted.png", sdir / "color.png")
        _atomic_save_image(overlay, sdir / "magenta_overlay.png")
        bw = bg.convert("L").convert("RGB")
        _atomic_save_image(bw, sdir / "bw.png")
        bw.close()

        hb_objects = [Hitbox(x=hb["x"], y=hb["y"], radius=hb["r"]) for hb in hitbox_list]
        eval_img = evaluate_hitboxes(result, hb_objects, opacity=0.3)
        _atomic_save_image(eval_img, sdir / "eval.png")
        eval_img.close()

        level_data = S.build_level_dict(
            session_id, hitbox_list, width=w, height=h, style=raw.get("style"),
        )
        _atomic_write_json(level_data, sdir / "level.json")
        _mark_session_dogs_done(session_id, hitbox_list)
        S.update_session_field(session_id, inpaint_mode="magenta")
        return {
            "hitboxes": len(hitbox_list),
            "colorFile": "color.png",
            "overlayFile": "magenta_overlay.png",
        }
    finally:
        bg.close()
        overlay.close()


class CompareInpaintRequest(BaseModel):
    modes: list[CropInpaintMode | Literal["magenta"]] = Field(..., min_length=1, max_length=3)
    models: list[str] = Field(default_factory=list, max_length=3)
    hardDogPercent: int = Field(0, ge=0, le=100)
    padding: float = Field(2.75, ge=1.0, le=5.0)


@router.post("/sessions/{session_id}/compare-inpaint")
def compare_inpaint(session_id: str, req: CompareInpaintRequest):
    """Queue any subset of the three inpaint approaches, each in an isolated
    clone of this session, so results can be compared side by side without
    clobbering each other."""
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    selected_bg = _resolve_selected_bg(session_id, raw)
    hb_path = S.session_dir(session_id) / "hitboxes.json"
    hitbox_list = json.loads(hb_path.read_text()) if hb_path.exists() else []
    if selected_bg is None or not hitbox_list:
        raise HTTPException(409, detail={
            "error": "compare-inpaint needs a selected background and hitboxes",
            "code": "level_not_ready",
        })
    dog_prompt = raw.get("dog_prompt") or ""
    default_model = raw.get("inpaint_model") or raw.get("model")
    requested_models = list(dict.fromkeys(req.models))
    if requested_models and req.modes != ["magenta"]:
        raise HTTPException(400, detail={
            "error": "model comparison currently requires modes=[magenta]",
            "code": "invalid_comparison",
        })
    invalid_models = [
        model for model in requested_models
        if model not in INPAINT_MODEL_IDS or model.startswith("fal-ai/")
    ]
    if invalid_models:
        raise HTTPException(400, detail={
            "error": f"Invalid magenta comparison model: {invalid_models[0]}",
            "code": "invalid_model",
        })
    comparisons = []
    variants = (
        [("magenta", model) for model in requested_models]
        if requested_models
        else [(mode, default_model) for mode in dict.fromkeys(req.modes)]
    )
    for mode, model in variants:
        clone_label = mode
        if requested_models:
            model_slug = re.sub(r"[^a-z0-9]+", "_", str(model).lower()).strip("_")
            clone_label = f"{mode}_{model_slug}"[:48]
        clone_id = S.clone_session_for_comparison(session_id, clone_label)
        if mode == "magenta":
            job = JOB_STORE.create_job(
                kind="magenta_inpaint",
                session_id=clone_id,
                metadata={"dogPrompt": dog_prompt, "model": model,
                          "comparisonOf": session_id, "mode": mode},
            )
        else:
            job = _start_crop_inpaint_job_record(
                clone_id,
                hitbox_list=hitbox_list,
                dog_prompt=dog_prompt,
                model=model,
                selected_bg=selected_bg,
                hard_dog_prompt=None,
                hard_dog_percent=req.hardDogPercent,
                padding=req.padding,
                inpaint_mode=mode,
            )
        comparisons.append({"mode": mode, "model": model, "sessionId": clone_id, "jobId": job.id})
    return {"sessionId": session_id, "comparisons": comparisons}


@router.get("/magenta-prompt-preview")
async def magenta_prompt_preview(dogPrompt: str = Query(..., max_length=4000)):
    """Render what the server would send to the model for a given subject
    prompt under magenta mode. The UI uses this to pre-fill its advanced
    override textarea so users can see what they're editing before they
    change it."""
    return {"prompt": _magenta_prompt(dogPrompt)}


@router.get("/sessions/{session_id}/inpaint/magenta")
async def inpaint_magenta(
    request: Request,
    session_id: str,
    hitboxes: str = Query(..., max_length=8000, description="JSON-encoded hitbox array"),
    dogPrompt: str = Query(..., max_length=4000, description="Entity inpaint prompt"),
    magentaPromptOverride: str = Query("", max_length=8000, description="If non-empty, sent to the model verbatim instead of the auto-wrapped prompt."),
    inpaintModel: str | None = Query(None, max_length=200, description="Optional model override for this inpaint run"),
):
    """Single-call magenta-overlay inpaint. See module-level comment above.
    GET + SSE to match the per-crop endpoint's wire shape so the UI can reuse
    a single EventSource hook."""
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})

    startup_error: str | None = None
    startup_error_code = "startup_error"
    hitbox_list: list[dict] = []
    sdir = S.session_dir(session_id)
    bg_path = sdir / "bg_00.png"
    model = inpaintModel or raw.get("inpaint_model") or raw["model"]

    selected_bg = _resolve_selected_bg(session_id, raw)
    if selected_bg is None:
        startup_error = "No background selected"
    else:
        bg_path = sdir / f"bg_{selected_bg:02d}.png"
        if not bg_path.exists():
            startup_error = "Background file not found"

    if startup_error is None:
        try:
            decoded_hitboxes = json.loads(hitboxes)
        except json.JSONDecodeError:
            startup_error = "hitboxes must be JSON"
        else:
            if not isinstance(decoded_hitboxes, list) or len(decoded_hitboxes) == 0:
                startup_error = "hitboxes must be a non-empty array"
            elif len(decoded_hitboxes) > _MAX_HITBOXES:
                startup_error = f"too many hitboxes (max {_MAX_HITBOXES})"
            elif any(not all(k in hb for k in ("x", "y", "r")) for hb in decoded_hitboxes):
                startup_error = "Each hitbox needs x, y, r"
            else:
                hitbox_list = decoded_hitboxes

    if startup_error is None and (model not in INPAINT_MODEL_IDS or model.startswith("fal-ai/")):
        startup_error = (
            f"Invalid magenta inpaint model: {model}. "
            f"Allowed models: {', '.join(sorted(m for m in INPAINT_MODEL_IDS if not m.startswith('fal-ai/')))}"
        )
        startup_error_code = "invalid_model"

    if startup_error is None:
        # Adopt the id-STAMPED list save_hitboxes returns so the rest of the
        # magenta path (build_level_dict, _mark_session_dogs_done) sees every
        # hitbox's on-disk id — an id-less hitbox left in the in-memory list made
        # _mark mint a divergent dog id -> by-id routes 404 (final-rereview iter3 P1).
        hitbox_list = S.save_hitboxes(session_id, hitbox_list) or hitbox_list

    async def stream():
        if startup_error is not None:
            yield _startup_error_event(startup_error, code=startup_error_code)
            return
        if await request.is_disconnected():
            return
        yield {"event": "magenta_start", "data": json.dumps({"hitboxes": len(hitbox_list)})}
        loop = asyncio.get_running_loop()
        try:
            # Single source of truth: the same sync core the durable job runs.
            summary = await loop.run_in_executor(
                executor,
                lambda: run_magenta_inpaint(
                    session_id,
                    hitbox_list=hitbox_list,
                    dog_prompt=dogPrompt,
                    model=model,
                    magenta_override=magentaPromptOverride,
                    bg_index=selected_bg,
                ),
            )
        except Exception as e:  # noqa: BLE001
            yield {"event": "magenta_error", "data": json.dumps({"error": _sanitized_error(e)})}
            return
        yield {"event": "magenta_complete", "data": json.dumps(summary)}

    return EventSourceResponse(stream(), ping=15)
