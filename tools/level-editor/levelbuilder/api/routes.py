"""REST API routes for the level editor.

All endpoints return JSON. SSE streaming endpoints are in inpaint.py.
"""

import hashlib
import asyncio
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import FileResponse

import httpx

logger = logging.getLogger("levelbuilder.routes")

from levelbuilder.prompts import (
    ENTITIES,
    ENTITY_PROMPT_TEMPLATE,
    SCENE_DESCRIPTIONS,
    SETTINGS,
    STYLES,
    VIEWS,
)

from . import prompts as P
from . import public_levels as PublicLevels
from . import layer_provider as Layer
from . import sequence_activation as SequenceActivation
from . import sequence_workflow as SequenceWorkflow
from . import session as S
from . import smart_hitboxes as SmartHitboxes
from .job_store import JobArtifact, JobEvent, JobRecord, JobStore, is_failed_terminal_status
from .job_worker import JobWorker, RetryableJobError, TerminalJobError, get_default_job_worker
from .remote_config_publisher import DisabledRemoteConfigPublisher
from .layer_provider import LAYER_MODEL_OPTIONS, is_layer_model, layer_configured

REMOTE_CONFIG_PUBLISHER_FACTORY = DisabledRemoteConfigPublisher
JOB_STORE = JobStore()

SCALE_PRESETS = {
    "none": {
        "label": "No scale",
        "description": "Keep the current prompt unchanged.",
        "prompt": "",
    },
    "close_ad": {
        "label": "Close / Ad",
        "description": "Larger landmarks and props with tighter framing.",
        "prompt": (
            "Use close, ad-style level framing with larger landmarks and props. "
            "Show fewer major areas at once, keep important objects large and immediately readable, "
            "and preserve enough open pockets around props for hidden-object placement."
        ),
    },
    "standard": {
        "label": "Standard",
        "description": "Balanced gameplay framing and prop size.",
        "prompt": (
            "Use balanced gameplay framing. Show a moderate amount of the environment with landmarks "
            "and props at a comfortably readable phone-screen size, balancing exploration with clear "
            "hidden-object placement pockets."
        ),
    },
    "wide_dense": {
        "label": "Wide / Dense",
        "description": "More environment with smaller landmarks and props.",
        "prompt": (
            "Use a wider, denser level framing that shows more of the environment at once. Landmarks "
            "and props may be smaller, but must remain individually readable and separated enough for "
            "reliable hidden-object placement."
        ),
    },
}


class RecipePromptRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    setting: str = Field(..., max_length=64)
    scene: str = Field(..., max_length=128)
    entity: str = Field(..., max_length=64)
    view: str = Field(..., max_length=64)
    style: str = Field(..., max_length=100)
    scale: str = Field("none", max_length=64)


class RecipePromptResponse(BaseModel):
    scenePrompt: str
    dogPrompt: str
    promptContext: dict[str, Any]


def _prompt_library_default(kind: str, fallback: str) -> str:
    prompt = P.get_prompt(kind)
    if prompt is None or prompt.default_version == 0:
        return fallback
    for version in prompt.versions:
        if version.version == prompt.default_version:
            return version.text
    return fallback


def _settings_with_prompt_library_defaults() -> dict[str, dict[str, Any]]:
    settings: dict[str, dict[str, Any]] = {}
    for setting_key, setting in SETTINGS.items():
        scenes = {
            scene_key: _prompt_library_default(f"scene:{setting_key}.{scene_key}", scene_prompt)
            for scene_key, scene_prompt in setting["scenes"].items()
        }
        settings[setting_key] = {
            "label": setting["label"],
            "scenes": scenes,
            "shortDescriptions": {
                scene_key: SCENE_DESCRIPTIONS.get(scene_key, "")
                for scene_key in setting["scenes"]
            },
        }
    return settings


def _scene_title(setting: str, scene: str) -> str:
    short = scene[len(setting) + 1:] if scene.startswith(f"{setting}_") else scene
    return " ".join(word.capitalize() for word in short.split("_") if word)


def _short_scene_description(content_prompt: str, title: str) -> str:
    first_sentence = content_prompt.split(". ", 1)[0].strip() or title
    return f"{first_sentence.split(' — ', 1)[0].removesuffix('.')} arranged as an organic isometric hidden-object scene."


def _build_scene_prompt(
    *,
    content_prompt: str,
    view_prompt: str,
    style_prompt: str,
    scale_prompt: str,
    title: str,
) -> str:
    short_description = _short_scene_description(content_prompt, title)
    blocks = [
        f"[Purpose]\nCreate a full-bleed portrait mobile-game background for Find the Dog. Title: {title}.",
        f"[Short Description]\n{short_description}",
        f"[Scene] {content_prompt}",
        f"[View] {view_prompt}",
    ]
    if scale_prompt:
        blocks.append(f"[Scale]\n{scale_prompt}")
    blocks.extend([
        f"[Style] {style_prompt}",
        "[Gameplay Composition]\nDesign this as a production hidden-object background where dogs will be added later. Create many plausible hiding pockets on walkable/contact surfaces or open gaps beside props, plants, rocks, furniture, railings, crates, planters, benches, roots, tools, shelves, stalls, boats, carts, market goods, or other readable foreground objects. Near props is ideal; inside solid objects, on blank walls, on roofs, floating over water, or on decorative vertical faces is not useful. Use theme-specific spatial logic such as rings, islands, terraces, nested rooms, clearings, bridges, piers, shelves, courtyards, side alleys, garden pockets, or clustered market zones. Keep open pockets between prop clusters so hitboxes can sit near objects without excessive overlap.",
        "[Constraints]\nNo people, no live animals, no birds, no insects, no mascots, no dogs, no readable text, no logos, no watermarks. Market food and fishing props are allowed when the scene calls for them. Avoid huge blank walls, roof-dominated compositions, empty lawns, empty sand, empty floors, long straight roads, and noisy micro-texture camouflage. Every visible ground, floor, or water-edge region should read as a clear material appropriate to the scene; no untextured blank areas.",
    ])
    return "\n\n".join(blocks)


def _render_entity_prompt(
    *,
    text: str,
    entity_slug: str,
    entity_noun: str,
    fallback_template: str,
) -> str:
    fallback = fallback_template.replace("{entity}", entity_noun)
    if "{entity}" in text:
        return text.replace("{entity}", entity_noun)
    saved = text.lower()
    noun = entity_noun.lower()
    slug_words = entity_slug.replace("_", " ").lower()
    if noun in saved or slug_words in saved:
        return text
    return fallback


def _assemble_recipe_prompts(req: RecipePromptRequest) -> RecipePromptResponse:
    extra_fields = set(req.model_extra or {})
    requested_mode = (req.model_extra or {}).get("mode")
    if requested_mode is not None and requested_mode != "portrait":
        raise HTTPException(400, detail={
            "error": "Landscape recipe generation is retired from the editor action layer.",
            "code": "retired_generation_mode",
        })
    if requested_mode == "portrait":
        extra_fields.discard("mode")
    if extra_fields:
        field = sorted(extra_fields)[0]
        raise HTTPException(400, detail={
            "error": f"Unexpected recipe prompt field: {field}",
            "code": "invalid_request_field",
        })
    settings = _settings_with_prompt_library_defaults()
    setting_def = settings.get(req.setting)
    if setting_def is None:
        raise HTTPException(400, detail={"error": f"Invalid setting: {req.setting}", "code": "invalid_recipe"})
    content_prompt = setting_def["scenes"].get(req.scene)
    if not isinstance(content_prompt, str):
        raise HTTPException(400, detail={"error": f"Invalid scene: {req.scene}", "code": "invalid_recipe"})
    if req.view not in VIEWS:
        raise HTTPException(400, detail={"error": f"Invalid view: {req.view}", "code": "invalid_recipe"})
    if req.style not in STYLES:
        raise HTTPException(400, detail={"error": f"Invalid style: {req.style}", "code": "invalid_recipe"})
    scale_def = SCALE_PRESETS.get(req.scale)
    if scale_def is None:
        raise HTTPException(400, detail={"error": f"Invalid scale: {req.scale}", "code": "invalid_recipe"})
    entity_noun = ENTITIES.get(req.entity)
    if entity_noun is None:
        raise HTTPException(400, detail={"error": f"Invalid entity: {req.entity}", "code": "invalid_recipe"})

    view_prompt = _prompt_library_default(f"view:{req.view}", VIEWS[req.view])
    style_prompt = _prompt_library_default(f"style:{req.style}", STYLES[req.style])
    entity_template = _prompt_library_default("inpaint:default", ENTITY_PROMPT_TEMPLATE)
    title = _scene_title(req.setting, req.scene)
    scene_prompt = _build_scene_prompt(
        content_prompt=content_prompt,
        view_prompt=view_prompt,
        style_prompt=style_prompt,
        scale_prompt=scale_def["prompt"],
        title=title,
    )
    dog_prompt = _render_entity_prompt(
        text=entity_template,
        entity_slug=req.entity,
        entity_noun=entity_noun,
        fallback_template=ENTITY_PROMPT_TEMPLATE,
    )
    scene_description = SCENE_DESCRIPTIONS.get(req.scene, "")
    return RecipePromptResponse(
        scenePrompt=scene_prompt,
        dogPrompt=dog_prompt,
        promptContext={
            "source": "server-recipe-prompt-v1",
            "view": req.view,
            "style": req.style,
            "scale": req.scale,
            "setting": req.setting,
            "scene": req.scene,
            "entity": req.entity,
            "mode": "portrait",
            "sceneDescription": scene_description,
            "promptKinds": {
                "view": f"view:{req.view}",
                "style": f"style:{req.style}",
                "scene": f"scene:{req.setting}.{req.scene}",
                "entity": "inpaint:default",
            },
            "breedPolicy": "per-dog-generation",
        },
    )

# Builder-created sessions use 8-hex UUIDs; CLI/script-generated sessions
# (e.g. japanese_riverside_dusk) use descriptive snake_case ids. Allow both.
SESSION_ID_RE = re.compile(r"^[a-z0-9_-]{3,64}$")


def _validate_session_id(session_id: str) -> None:
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(400, detail={"error": "Invalid session ID format"})


def _safe_provider_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        host = exc.request.url.host if exc.request is not None else "provider"
        return f"Layer provider HTTP {exc.response.status_code} from {host}"
    if isinstance(exc, httpx.HTTPError):
        return exc.__class__.__name__
    return str(exc)


router = APIRouter(prefix="/api")


# ── Request/Response models ───────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Limits sized for the 4-block [Scene]/[View]/[Style]/[Constraints] prompts
    # the library now emits. Full spec-shape scenes (dense Japan market, etc)
    # land around 4–6 KB; 8000 gives headroom without accepting arbitrarily
    # large payloads.
    scenePrompt: str | None = Field(None, max_length=8000)
    dogPrompt: str | None = Field(None, max_length=4000)
    style: str = Field(..., max_length=100)
    # Legacy single-model field. When present, it seeds both bg + inpaint
    # models unless the split fields override one side.
    model: str | None = Field(None, max_length=200)
    bgModel: str | None = Field(None, max_length=200)
    inpaintModel: str | None = Field(None, max_length=200)
    nDogs: int = Field(..., ge=1, le=40)
    aspectRatio: str = "9:16"
    imageSize: str = "1K"
    upscaleEnabled: bool = False
    upscaleModel: str | None = Field(None, max_length=100)
    upscaleTargetLongEdge: int = Field(3840, ge=1024, le=7680)
    # Session id ingredients. When all three are present, the backend builds
    # a human-readable id `{setting}_{scene_short}_{entity}_{seed}` instead
    # of the legacy 8-char uuid. All are optional for backward compat with
    # older clients that post only prompt strings.
    setting: str | None = Field(None, max_length=64)
    scene: str | None = Field(None, max_length=128)
    entity: str | None = Field(None, max_length=64)
    view: str | None = Field(None, max_length=64)
    scale: str = Field("none", max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=20)


class SelectBgRequest(BaseModel):
    bgIndex: int


class LevelSectionResponse(BaseModel):
    xStart: int
    xEnd: int


class SelectBgResponse(BaseModel):
    bgWidth: int
    bgHeight: int
    selectedBgIndex: int | None
    sections: list[LevelSectionResponse] = Field(default_factory=list)


class UpscaleBgRequest(BaseModel):
    bgIndex: int | None = None
    model: str = Field("fal-ai/esrgan", max_length=100)
    targetLongEdge: int = Field(3840, ge=1024, le=7680)
    select: bool = True


class BackgroundResponse(BaseModel):
    index: int
    file: str
    generationTime: float
    width: int | None = None
    height: int | None = None
    kind: str | None = None
    sourceIndex: int | None = None
    sourceWidth: int | None = None
    sourceHeight: int | None = None
    sourceImageHash: str | None = None
    upscaleModel: str | None = None
    upscaleScale: float | None = None
    targetLongEdge: int | None = None


class JobArtifactResponse(BaseModel):
    id: int
    jobId: str
    artifactType: str
    path: str
    checksum: str | None = None
    contentType: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    createdAt: str


class JobEventResponse(BaseModel):
    id: int
    jobId: str
    eventType: str
    message: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    createdAt: str


class JobResponse(BaseModel):
    id: str
    parentJobId: str | None = None
    kind: str
    sessionId: str
    idempotencyKey: str | None = None
    inputHash: str | None = None
    status: str
    stage: str | None = None
    retryable: bool
    errorCode: str | None = None
    errorMessage: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    workerOwner: str | None = None
    heartbeatAt: str | None = None
    createdAt: str
    updatedAt: str
    completedAt: str | None = None
    artifacts: list[JobArtifactResponse] = Field(default_factory=list)


class JobEventsResponse(BaseModel):
    events: list[JobEventResponse]


class JobListResponse(BaseModel):
    jobs: list[JobResponse]


class BuildArtifactResponse(BaseModel):
    path: str
    kind: str
    buildType: Literal["release", "debug", "unknown"]
    sizeBytes: int
    modifiedAt: float
    overLimit: bool
    budgetApplies: bool
    storeBudgetOverLimit: bool


class BuildSizeResponse(BaseModel):
    limitBytes: int
    artifact: BuildArtifactResponse | None
    distSizeBytes: int | None
    androidPublicAssetsSizeBytes: int | None
    levelAssetsSizeBytes: int | None


class UpscaleBgResponse(BaseModel):
    background: BackgroundResponse
    bgWidth: int
    bgHeight: int
    sourceWidth: int
    sourceHeight: int
    scale: float
    selectedBgIndex: int | None
    sections: list[LevelSectionResponse] = Field(default_factory=list)


class UpscaleBgJobResponse(BaseModel):
    jobId: str
    status: Literal["queued", "running", "succeeded", "failed"]
    rawStatus: str
    stage: str | None = None
    retryable: bool
    errorCode: str | None = None
    background: BackgroundResponse | None = None
    selectedBgIndex: int | None = None
    sections: list[LevelSectionResponse] = Field(default_factory=list)
    error: str | None = None


class SaveHitboxesRequest(BaseModel):
    hitboxes: list[dict]
    action: str = "edit"


class VisibilityChecksRequest(BaseModel):
    sessionIds: list[str] = Field(..., min_length=1, max_length=500)


class CreateAnimationJobRequest(BaseModel):
    sourceCandidateId: str = Field(..., max_length=128)
    prompt: str = Field(..., min_length=1, max_length=4000)
    motionPreset: str | None = Field(None, max_length=80)
    customPrompt: str | None = Field(None, max_length=4000)
    durationSeconds: float = Field(3.0, ge=1.0, le=10.0)
    fps: int = Field(24, ge=8, le=60)


def _job_artifact_response(artifact: JobArtifact) -> JobArtifactResponse:
    return JobArtifactResponse(
        id=artifact.id,
        jobId=artifact.job_id,
        artifactType=artifact.artifact_type,
        path=artifact.path,
        checksum=artifact.checksum,
        contentType=artifact.content_type,
        metadata=artifact.metadata,
        createdAt=artifact.created_at,
    )


def _job_event_response(event: JobEvent) -> JobEventResponse:
    return JobEventResponse(
        id=event.id,
        jobId=event.job_id,
        eventType=event.event_type,
        message=event.message,
        data=event.data,
        createdAt=event.created_at,
    )


def _job_response(job: JobRecord) -> JobResponse:
    return JobResponse(
        id=job.id,
        parentJobId=job.parent_job_id,
        kind=job.kind,
        sessionId=job.session_id,
        idempotencyKey=job.idempotency_key,
        inputHash=job.input_hash,
        status=job.status,
        stage=job.stage,
        retryable=job.retryable,
        errorCode=job.error_code,
        errorMessage=job.error_message,
        metadata=job.metadata,
        result=job.result,
        workerOwner=job.worker_owner,
        heartbeatAt=job.heartbeat_at,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
        completedAt=job.completed_at,
        artifacts=[_job_artifact_response(artifact) for artifact in JOB_STORE.list_artifacts(job.id)],
    )


# ── Config ────────────────────────────────────────────────────────────────────

BASE_MODELS = [
    # OpenAI direct — routes through merceka_core.image's `openai/` dispatch
    # which hits https://api.openai.com/v1/images/{generations,edits} with
    # OPENAI_API_KEY. Org-verification may be required on the OpenAI side
    # before this model will accept requests (first 403 → check
    # platform.openai.com → Settings → Organization).
    {"id": "openai/gpt-image-2", "label": "GPT Image 2 (OpenAI direct)"},
    {"id": "openai/gpt-image-1", "label": "GPT Image 1 (OpenAI direct)"},
    {"id": "google/gemini-3.1-flash-image-preview", "label": "Gemini 3.1 Flash"},
    {"id": "google/gemini-3-pro-image-preview", "label": "Gemini 3 Pro"},
    {"id": "google/gemini-2.5-flash-image", "label": "Gemini 2.5 Flash"},
]

MODELS = [
    *BASE_MODELS,
    *(LAYER_MODEL_OPTIONS if layer_configured() else []),
]

INPAINT_MODELS = [
    *BASE_MODELS,
]
if os.environ.get("FAL_KEY"):
    INPAINT_MODELS.append({"id": "fal-ai/flux-pro/v1/fill", "label": "fal Flux Pro Fill"})

UPSCALE_MODELS = []
if os.environ.get("FAL_KEY"):
    UPSCALE_MODELS = [
        {"id": "fal-ai/esrgan", "label": "fal ESRGAN (conservative)"},
        {"id": "fal-ai/aura-sr", "label": "fal AuraSR (4x quality test)"},
    ]

MODEL_IDS = {m["id"] for m in [*BASE_MODELS, *LAYER_MODEL_OPTIONS]}
INPAINT_MODEL_IDS = {m["id"] for m in INPAINT_MODELS}
UPSCALE_MODEL_IDS = {m["id"] for m in UPSCALE_MODELS}
_UPSCALE_LOCKS_GUARD = threading.Lock()
_UPSCALE_LOCKS: dict[tuple[str, int, str, int, str], threading.Lock] = {}
_STORE_BUILD_SIZE_LIMIT_BYTES = 200_000_000


def _build_artifact_type(path: Path, outputs_root: Path) -> Literal["release", "debug", "unknown"]:
    try:
        parts = {part.lower() for part in path.relative_to(outputs_root).parts}
    except ValueError:
        parts = {part.lower() for part in path.parts}
    if "release" in parts:
        return "release"
    if "debug" in parts:
        return "debug"
    return "unknown"


def _build_artifact_priority(path: Path, outputs_root: Path) -> tuple[int, float]:
    suffix = path.suffix.lower()
    build_type = _build_artifact_type(path, outputs_root)
    if build_type == "release" and suffix == ".aab":
        bucket = 0
    elif build_type == "release" and suffix == ".apk":
        bucket = 1
    elif suffix == ".aab":
        bucket = 2
    elif suffix == ".apk":
        bucket = 3
    else:
        bucket = 4
    return (bucket, -path.stat().st_mtime)


def _select_build_artifact(outputs_root: Path) -> Path | None:
    artifacts = [
        path
        for pattern in ("**/*.apk", "**/*.aab")
        for path in outputs_root.glob(pattern)
        if path.is_file()
    ]
    return min(artifacts, key=lambda path: _build_artifact_priority(path, outputs_root), default=None)


def _upscale_lock_for(key: tuple[str, int, str, int, str]) -> threading.Lock:
    with _UPSCALE_LOCKS_GUARD:
        lock = _UPSCALE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _UPSCALE_LOCKS[key] = lock
        return lock


async def _watch_request_disconnect(request: Request, cancel_event: threading.Event) -> None:
    while not cancel_event.is_set():
        if await request.is_disconnected():
            cancel_event.set()
            return
        await asyncio.sleep(0.5)


def _load_templates_for_config() -> list[dict]:
    from levelbuilder.templates import load_templates

    # LEVELS_DIR sits inside the workspace; templates.json lives beside it.
    return load_templates(S.LEVELS_DIR.parent)


@router.get("/config")
def get_config():
    return {
        "game": {
            "name": S.GAME_ROOT.name,
            "label": S.GAME_ROOT.name.replace("_", " ").title(),
        },
        "templates": _load_templates_for_config(),
        "views": {
            key: _prompt_library_default(f"view:{key}", value)
            for key, value in VIEWS.items()
        },
        "styles": {
            key: _prompt_library_default(f"style:{key}", value)
            for key, value in STYLES.items()
        },
        "settings": _settings_with_prompt_library_defaults(),  # grouped: {setting_key: {label, scenes: {scene_key: prompt}}}
        "scales": SCALE_PRESETS,
        "entities": ENTITIES,
        "entityPromptTemplate": _prompt_library_default("inpaint:default", ENTITY_PROMPT_TEMPLATE),
        "models": MODELS,
        "inpaintModels": INPAINT_MODELS,
        "upscaleModels": UPSCALE_MODELS,
    }


@router.get("/config/geometry")
def get_geometry_config():
    """Canonical dead-zone / section geometry constants (plan -004 U1/U2).

    The single server-authoritative source the auto-placer, the publish-time
    visibility gate, and the builder canvas all derive their dead zones from.
    Exposed so an agent can compute identical placement geometry without
    re-deriving the constants, and so a cross-language parity test can pin the
    TS canvas constants to this payload (they must never drift).
    """
    from levelbuilder import sections as G
    return {
        "hudFraction": G.HUD_FRACTION,
        "bannerFraction": G.BANNER_FRACTION,
        "sectionBoundaryBuffer": G.SECTION_BOUNDARY_BUFFER,
        "landscapeEdgeSafeArea": G.LANDSCAPE_EDGE_SAFE_AREA,
        "viewportSafeFraction": G.VIEWPORT_SAFE_FRACTION,
        "nSections": G.N_SECTIONS,
        "portraitReference": {
            "width": G.PORTRAIT_REF_WIDTH,
            "height": G.PORTRAIT_REF_HEIGHT,
            "deadzones": [
                {"label": label, "x": x, "y": y, "w": w, "h": h}
                for (label, x, y, w, h) in G.PORTRAIT_REFERENCE_DEADZONES
            ],
        },
    }


def _directory_size(path: Path) -> int | None:
    if not path.exists():
        return None
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


@router.get("/build-size", response_model=BuildSizeResponse)
def get_build_size() -> BuildSizeResponse:
    outputs_root = S.GAME_ROOT / "android" / "app" / "build" / "outputs"
    selected = _select_build_artifact(outputs_root)
    dist_size = _directory_size(S.GAME_ROOT / "dist")
    android_public_size = _directory_size(S.GAME_ROOT / "android" / "app" / "src" / "main" / "assets" / "public")
    level_assets_size = _directory_size(S.GAME_ROOT / "dist" / "levels")
    artifact_size = selected.stat().st_size if selected is not None else None
    build_type = _build_artifact_type(selected, outputs_root) if selected is not None else None
    over_limit = artifact_size is not None and artifact_size > _STORE_BUILD_SIZE_LIMIT_BYTES
    budget_applies = build_type != "debug"
    artifact = None if selected is None else BuildArtifactResponse(
        path=str(selected.relative_to(S.GAME_ROOT)),
        kind=selected.suffix.lstrip("."),
        buildType=build_type,
        sizeBytes=artifact_size,
        modifiedAt=selected.stat().st_mtime,
        overLimit=over_limit,
        budgetApplies=budget_applies,
        storeBudgetOverLimit=budget_applies and over_limit,
    )
    return BuildSizeResponse(
        limitBytes=_STORE_BUILD_SIZE_LIMIT_BYTES,
        artifact=artifact,
        distSizeBytes=dist_size,
        androidPublicAssetsSizeBytes=android_public_size,
        levelAssetsSizeBytes=level_assets_size,
    )


@router.post("/actions/assemble-recipe-prompts", response_model=RecipePromptResponse)
def assemble_recipe_prompts(req: RecipePromptRequest) -> RecipePromptResponse:
    """Shared UI/agent prompt assembly for recipe-based level generation."""
    return _assemble_recipe_prompts(req)


# ── Durable Jobs ──────────────────────────────────────────────────────────────

_CHILD_JOB_KINDS = {
    "background_generation_unit",
    "crop_inpaint_unit",
}


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(
    sessionId: str | None = Query(None, max_length=128),
    kind: str | None = Query(None, max_length=80),
    status: list[str] | None = Query(None),
    parentJobId: str | None = Query(None, max_length=128),
    includeChildren: bool = Query(False),
) -> JobListResponse:
    if sessionId is not None:
        _validate_session_id(sessionId)
    include_child_rows = includeChildren or kind in _CHILD_JOB_KINDS
    jobs = JOB_STORE.list_jobs(
        session_id=sessionId,
        kind=kind,
        statuses=status,
        parent_job_id=parentJobId,
        include_children=include_child_rows,
    )
    return JobListResponse(jobs=[_job_response(job) for job in jobs])


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str) -> JobResponse:
    job = JOB_STORE.get_job(job_id)
    if job is None:
        raise HTTPException(404, detail={"error": "Job not found"})
    return _job_response(job)


@router.get("/jobs/{job_id}/events", response_model=JobEventsResponse)
def list_job_events(job_id: str, afterId: int = Query(0, ge=0)) -> JobEventsResponse:
    if JOB_STORE.get_job(job_id) is None:
        raise HTTPException(404, detail={"error": "Job not found"})
    return JobEventsResponse(
        events=[_job_event_response(event) for event in JOB_STORE.list_events(job_id, after_id=afterId)],
    )


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/sessions")
def list_sessions(include_public: bool = Query(False)):
    """List all available sessions/levels that can be loaded."""
    return S.list_sessions(include_public=include_public)


@router.get("/sessions/{session_id}/gallery-thumb/{variant}")
def gallery_thumbnail(session_id: str, variant: str):
    """Small cached thumbnail for gallery grids.

    The full color/background PNGs are several MB each; this endpoint keeps
    card grids responsive while review/download paths still use originals.
    """
    _validate_session_id(session_id)
    if variant not in S.gallery_thumb_variants():
        raise HTTPException(404, detail={"error": "Unknown gallery variant"})
    thumb_path = S.ensure_gallery_thumbnail(session_id, variant)
    if thumb_path is None:
        raise HTTPException(404, detail={"error": "Gallery thumbnail source not found"})
    return FileResponse(
        thumb_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/sessions/{session_id}/gallery-preview/{variant}")
def gallery_preview(session_id: str, variant: str):
    """Medium cached WebP preview for the gallery review modal."""
    _validate_session_id(session_id)
    if variant not in S.gallery_thumb_variants():
        raise HTTPException(404, detail={"error": "Unknown gallery variant"})
    preview_path = S.ensure_gallery_preview(session_id, variant)
    if preview_path is None:
        raise HTTPException(404, detail={"error": "Gallery preview source not found"})
    return FileResponse(
        preview_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


_SLUG_SAFE_RE = re.compile(r"[^a-z0-9_]+")


def _build_readable_session_id(setting: str, scene: str, entity: str) -> str:
    """Compose a session id of shape `{setting}_{scene_short}_{entity}_{seed}`.

    Scene keys already carry their setting prefix (e.g. `japan_morning_market`);
    strip it so the id doesn't read "japan_japan_morning_market_...". Seed is
    a 4-char hex suffix so repeated runs of the same config don't collide.
    Final id is re-validated against SESSION_ID_RE — a crafted input that
    slipped through slug-normalisation is rejected rather than written to disk.
    """
    scene_short = scene[len(setting) + 1:] if scene.startswith(f"{setting}_") else scene
    seed = secrets.token_hex(2)  # 4 hex chars
    raw = f"{setting}_{scene_short}_{entity}_{seed}".lower()
    slug = _SLUG_SAFE_RE.sub("_", raw).strip("_")[:64]
    if not SESSION_ID_RE.match(slug):
        raise HTTPException(400, detail={"error": "Could not build a valid session id", "code": "invalid_session_id"})
    return slug


@router.post("/sessions")
def create_session(req: CreateSessionRequest):
    extra_fields = set(req.model_extra or {})
    requested_mode = (req.model_extra or {}).get("mode")
    if requested_mode is not None and requested_mode != "portrait":
        raise HTTPException(400, detail={
            "error": "Landscape generation is retired from the editor action layer.",
            "code": "retired_generation_mode",
        })
    if requested_mode == "portrait":
        extra_fields.discard("mode")
    if "nOptions" in extra_fields:
        n_options = (req.model_extra or {}).get("nOptions")
        try:
            requested_options = int(n_options)
        except (TypeError, ValueError):
            requested_options = -1
        if requested_options != 1:
            raise HTTPException(400, detail={
                "error": "N-option generation is retired; create one session per recipe or scene.",
                "code": "retired_n_options",
            })
        extra_fields.discard("nOptions")
    if extra_fields:
        field = sorted(extra_fields)[0]
        raise HTTPException(400, detail={
            "error": f"Unexpected create-session field: {field}",
            "code": "invalid_request_field",
        })
    recipe_values = [req.setting, req.scene, req.entity, req.view]
    has_recipe = all(value for value in recipe_values)
    has_partial_recipe = any(value for value in recipe_values) and not has_recipe
    if has_partial_recipe:
        raise HTTPException(400, detail={"error": "setting, scene, entity, and view are required together", "code": "invalid_recipe"})
    if has_recipe:
        assembled = _assemble_recipe_prompts(RecipePromptRequest(
            setting=req.setting or "",
            scene=req.scene or "",
            entity=req.entity or "",
            view=req.view or "",
            style=req.style,
            scale=req.scale,
        ))
        scene_prompt = assembled.scenePrompt
        dog_prompt = assembled.dogPrompt
        prompt_context = assembled.promptContext
    else:
        if not req.scenePrompt or not req.dogPrompt:
            raise HTTPException(400, detail={"error": "recipe fields or legacy scenePrompt/dogPrompt are required", "code": "invalid_prompt"})
        scene_prompt = req.scenePrompt
        dog_prompt = req.dogPrompt
        prompt_context = {
            "source": "legacy-client-prompts",
            "view": req.view,
            "style": req.style,
            "setting": req.setting,
            "scene": req.scene,
            "entity": req.entity,
            "sceneDescription": SCENE_DESCRIPTIONS.get(req.scene or "", ""),
        }

    bg_model = req.bgModel or req.model
    inpaint_model = req.inpaintModel or req.model or bg_model
    if not bg_model:
        raise HTTPException(400, detail={"error": "bgModel is required", "code": "invalid_model"})
    if bg_model not in MODEL_IDS:
        raise HTTPException(400, detail={"error": f"Invalid bg model: {bg_model}", "code": "invalid_model"})
    if is_layer_model(bg_model) and not layer_configured():
        raise HTTPException(503, detail={"error": "LAYER_TOKEN not configured", "code": "missing_api_key"})
    if not inpaint_model:
        raise HTTPException(400, detail={"error": "inpaintModel is required", "code": "invalid_model"})
    if inpaint_model not in INPAINT_MODEL_IDS:
        raise HTTPException(400, detail={"error": f"Invalid inpaint model: {inpaint_model}", "code": "invalid_model"})
    upscale_model = req.upscaleModel or "fal-ai/esrgan"
    if req.upscaleEnabled:
        if not UPSCALE_MODEL_IDS:
            raise HTTPException(503, detail={"error": "FAL_KEY not configured", "code": "missing_api_key"})
        if upscale_model not in UPSCALE_MODEL_IDS:
            raise HTTPException(400, detail={"error": f"Invalid upscale model: {upscale_model}", "code": "invalid_model"})

    if req.setting and req.scene and req.entity:
        session_id = _build_readable_session_id(req.setting, req.scene, req.entity)
    else:
        # Legacy fallback — clients predating setting/scene/entity plumbing.
        session_id = str(uuid.uuid4())[:8]

    S.create_session(
        session_id,
        scene_prompt=scene_prompt,
        dog_prompt=dog_prompt,
        style=req.style,
        model=bg_model,
        bg_model=bg_model,
        inpaint_model=inpaint_model,
        n_options=1,
        n_dogs=req.nDogs,
        mode="portrait",
        aspect_ratio=req.aspectRatio,
        image_size=req.imageSize,
        upscale_enabled=req.upscaleEnabled,
        upscale_model=upscale_model if req.upscaleEnabled else None,
        upscale_target_long_edge=req.upscaleTargetLongEdge,
        # Persist the recipe ingredients so list_sessions can return them
        # directly without re-parsing the id string.
        setting=req.setting,
        scene=req.scene,
        entity=req.entity,
        tags=req.tags,
        bg_provider="layer" if is_layer_model(bg_model) else "merceka",
        prompt_context=prompt_context,
    )
    return {"sessionId": session_id, "scenePrompt": scene_prompt, "dogPrompt": dog_prompt, "promptContext": prompt_context}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    _validate_session_id(session_id)
    data = S.hydrate_session(session_id)
    if data is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    return data


@router.get("/sessions/{session_id}/sprite-candidates")
def list_sprite_candidates(session_id: str) -> dict[str, list[dict[str, Any]]]:
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    return {"candidates": S.sprite_animation_candidates(session_id)}


@router.get("/sessions/{session_id}/animation-jobs")
def list_animation_jobs(session_id: str) -> dict[str, list[dict[str, Any]]]:
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    return {"jobs": S.list_sprite_animation_jobs(session_id)}


@router.get("/sessions/{session_id}/animation-jobs/{job_id}")
def get_animation_job(session_id: str, job_id: str) -> dict[str, Any]:
    _validate_session_id(session_id)
    if not SESSION_ID_RE.match(job_id):
        raise HTTPException(400, detail={"error": "Invalid job ID format"})
    job = S.get_sprite_animation_job(session_id, job_id)
    if job is None:
        raise HTTPException(404, detail={"error": "Animation job not found"})
    return job


@router.post("/sessions/{session_id}/animation-jobs")
def create_animation_job(session_id: str, req: CreateAnimationJobRequest) -> dict[str, Any]:
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    try:
        candidate = S.require_ready_sprite_animation_candidate(session_id, req.sourceCandidateId)
    except ValueError as exc:
        raise HTTPException(400, detail={"error": str(exc)}) from exc

    job = S.create_sprite_animation_job(
        session_id,
        source_candidate=candidate,
        prompt=req.prompt,
        motion_preset=req.motionPreset,
        custom_prompt=req.customPrompt,
        duration_seconds=req.durationSeconds,
        fps=req.fps,
    )
    source_image = candidate["image"]
    source_path = S.session_dir(session_id) / source_image
    resolved_prompt = "\n\n".join(
        part.strip()
        for part in [req.prompt, req.customPrompt]
        if part and part.strip()
    )
    try:
        result = Layer.generate_layer_sprite_animation(
            source_image_path=source_path,
            prompt=resolved_prompt,
            motion_preset=req.motionPreset,
            duration_seconds=req.durationSeconds,
            fps=req.fps,
        )
    except (Layer.LayerProviderError, httpx.HTTPError, RuntimeError) as exc:
        safe_error = _safe_provider_error(exc)
        failed = S.fail_sprite_animation_job(session_id, job, safe_error)
        raise HTTPException(502, detail={"error": safe_error, "job": failed}) from exc

    return S.complete_sprite_animation_job(
        session_id,
        job,
        content=result.content,
        extension=result.extension,
        content_type=result.content_type,
        metadata=result.metadata,
    )


@router.post("/sessions/{session_id}/select-bg", response_model=SelectBgResponse)
def select_background(session_id: str, req: SelectBgRequest) -> SelectBgResponse:
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id) or {}
    for bg in raw.get("backgrounds") or []:
        if isinstance(bg, dict) and bg.get("index") == req.bgIndex and bg.get("selectable") is False:
            raise HTTPException(400, detail={"error": "Background candidate is not selectable", "code": "not_selectable"})
    sdir = S.session_dir(session_id)
    bg_path = sdir / f"bg_{req.bgIndex:02d}.png"
    if not bg_path.exists():
        raise HTTPException(404, detail={"error": "Background image not found"})

    img = Image.open(bg_path)
    bg_width, bg_height = img.size
    img.close()

    # All session-state decisions (including landscape sections recompute on
    # width change) happen atomically under session lock in session.py.
    selection = S.select_background(session_id, req.bgIndex, bg_width, bg_height)
    if selection is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    return SelectBgResponse(**selection)


def _resize_to_long_edge(img: Image.Image, target_long_edge: int) -> Image.Image:
    width, height = img.size
    current_long_edge = max(width, height)
    if current_long_edge == target_long_edge:
        return img
    ratio = target_long_edge / current_long_edge
    new_size = (
        max(1, int(round(width * ratio))),
        max(1, int(round(height * ratio))),
    )
    resized = img.resize(new_size, Image.Resampling.LANCZOS)
    img.close()
    return resized


def _matching_upscaled_background(
    raw: dict[str, Any],
    bg_index: int,
    model: str,
    target_long_edge: int,
    source_image_hash: str,
) -> dict[str, Any] | None:
    for bg in raw.get("backgrounds") or []:
        if not isinstance(bg, dict):
            continue
        if (
            bg.get("kind") == "upscaled"
            and bg.get("sourceIndex") == bg_index
            and bg.get("upscaleModel") == model
            and bg.get("targetLongEdge") == target_long_edge
            and bg.get("sourceImageHash") == source_image_hash
        ):
            return dict(bg)
    return None


def _validate_upscale_source(raw: dict[str, Any], bg_index: int) -> None:
    bg_info = S.background_info(raw, bg_index)
    if bg_info and bg_info.get("kind") == "upscaled":
        raise HTTPException(
            400,
            detail={"error": "Upscaled backgrounds cannot be used as upscale sources", "code": "source_already_upscaled"},
        )
    try:
        n_options = int(raw.get("n_options") or 0)
    except (TypeError, ValueError):
        n_options = 0
    if bg_info is None and n_options > 0 and bg_index >= n_options:
        raise HTTPException(
            400,
            detail={"error": "Only generated background slots can be upscaled", "code": "invalid_upscale_source"},
        )


def _validate_upscale_policy(raw: dict[str, Any], req: UpscaleBgRequest) -> int:
    try:
        target_long_edge = S.upscale_target_long_edge(raw)
    except ValueError as exc:
        raise HTTPException(500, detail={"error": str(exc), "code": "invalid_session_upscale_policy"}) from exc
    expected_model = raw.get("upscale_model") or "fal-ai/esrgan"
    if req.model != expected_model:
        raise HTTPException(
            400,
            detail={
                "error": f"model must match this session's configured upscale model ({expected_model})",
                "code": "invalid_upscale_model",
            },
        )
    if req.targetLongEdge != target_long_edge:
        raise HTTPException(
            400,
            detail={
                "error": f"targetLongEdge must match this session's configured target ({target_long_edge})",
                "code": "invalid_upscale_target",
            },
        )
    return target_long_edge


def _selection_from_raw(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "selectedBgIndex": raw.get("selected_bg"),
        "sections": raw.get("sections") or [],
    }


def _legacy_upscale_status(status: str) -> Literal["queued", "running", "succeeded", "failed"]:
    if status == "queued":
        return "queued"
    if status == "succeeded":
        return "succeeded"
    if is_failed_terminal_status(status):
        return "failed"
    return "running"


def _upscale_job_response_from_record(job: JobRecord) -> UpscaleBgJobResponse:
    background = job.result.get("background")
    sections = job.result.get("sections")
    return UpscaleBgJobResponse(
        jobId=job.id,
        status=_legacy_upscale_status(job.status),
        rawStatus=job.status,
        stage=job.stage,
        retryable=job.retryable,
        errorCode=job.error_code,
        background=BackgroundResponse(**background) if isinstance(background, dict) else None,
        selectedBgIndex=job.result.get("selectedBgIndex") if isinstance(job.result.get("selectedBgIndex"), int) else None,
        sections=[LevelSectionResponse(**section) for section in sections] if isinstance(sections, list) else [],
        error=job.error_message,
    )


def _hash_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _upscale_source_image_hash(session_id: str, bg_index: int) -> str:
    bg_path = S.session_dir(session_id) / f"bg_{bg_index:02d}.png"
    if not bg_path.exists():
        raise HTTPException(404, detail={"error": "Background image not found"})
    return _hash_file_sha256(bg_path)


def _upscale_idempotency_key(
    session_id: str,
    bg_index: int,
    model: str,
    target_long_edge: int,
    select: bool,
    source_image_hash: str,
) -> str:
    return f"upscale-bg:{session_id}:{bg_index}:{model}:{target_long_edge}:select-{int(select)}:{source_image_hash}"


def _run_upscale_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    session_id = job.session_id
    metadata = job.metadata
    bg_index = int(metadata["bgIndex"])
    model = str(metadata["model"])
    target_long_edge = int(metadata["targetLongEdge"])
    should_select = bool(metadata.get("select", True))
    req = UpscaleBgRequest(
        bgIndex=bg_index,
        model=model,
        targetLongEdge=target_long_edge,
        select=should_select,
    )

    def mark_provider_submission_started() -> None:
        store.update_metadata(job.id, {"providerSubmissionStarted": True, "safeToRequeue": False})

    try:
        result = _upscale_background_sync(session_id, req, None, mark_provider_submission_started)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
        message = str(detail.get("error") or exc.detail)
        code = str(detail.get("code") or "upscale_failed")
        if exc.status_code >= 500 or exc.status_code == 499:
            raise RetryableJobError(code, message) from exc
        raise TerminalJobError(code, message) from exc
    background = result.background.model_dump()
    store.record_artifact(
        job.id,
        artifact_type="upscaled_background",
        path=str(background.get("file") or ""),
        content_type="image/png",
        metadata={
            "width": result.bgWidth,
            "height": result.bgHeight,
            "sourceWidth": result.sourceWidth,
            "sourceHeight": result.sourceHeight,
            "scale": result.scale,
        },
    )
    return {
        "background": background,
        "selectedBgIndex": result.selectedBgIndex,
        "sections": [section.model_dump() for section in result.sections],
    }


def register_job_handlers(worker: JobWorker) -> None:
    worker.register_handler("upscale_background", _run_upscale_job)
    worker.register_handler(_SEQUENCE_START_JOB_KIND, _run_sequence_start_job)


@router.post("/sessions/{session_id}/upscale-bg/jobs", response_model=UpscaleBgJobResponse)
def start_upscale_background_job(session_id: str, req: UpscaleBgRequest) -> UpscaleBgJobResponse:
    _validate_session_id(session_id)
    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})
    bg_index = req.bgIndex if req.bgIndex is not None else raw.get("selected_bg")
    if bg_index is None:
        raise HTTPException(400, detail={"error": "No background selected yet"})
    bg_index = int(bg_index)
    target_long_edge = _validate_upscale_policy(raw, req)
    _validate_upscale_source(raw, bg_index)
    source_image_hash = _upscale_source_image_hash(session_id, bg_index)
    idempotency_key = _upscale_idempotency_key(
        session_id,
        bg_index,
        req.model,
        target_long_edge,
        bool(req.select),
        source_image_hash,
    )
    existing_job = JOB_STORE.get_job_by_idempotency_key(
        kind="upscale_background",
        idempotency_key=idempotency_key,
    )
    if existing_job is not None:
        if req.select and not bool(existing_job.metadata.get("select")):
            existing_job = JOB_STORE.update_metadata(existing_job.id, {"select": True})
        if existing_job.status == "failed_retryable":
            existing_job = JOB_STORE.requeue_job(existing_job.id, reason="Retry requested through upscale job start endpoint.")
        if existing_job.status == "succeeded" and req.select and not S.has_downstream_artifacts(session_id):
            background = existing_job.result.get("background")
            if isinstance(background, dict):
                selection = S.select_background(
                    session_id,
                    int(background["index"]),
                    int(background.get("width") or 0),
                    int(background.get("height") or 0),
                )
                if selection is not None:
                    existing_job = JOB_STORE.update_result(
                        existing_job.id,
                        {
                            "selectedBgIndex": selection.get("selectedBgIndex"),
                            "sections": selection.get("sections") or [],
                        },
                    )
        return _upscale_job_response_from_record(existing_job)

    existing = _matching_upscaled_background(raw, bg_index, req.model, target_long_edge, source_image_hash)
    if existing is not None and (S.session_dir(session_id) / str(existing.get("file", ""))).exists():
        selected_bg_index = raw.get("selected_bg") if isinstance(raw.get("selected_bg"), int) else None
        sections = raw.get("sections", [])
        if req.select and not S.has_downstream_artifacts(session_id):
            selection = S.select_background(
                session_id,
                int(existing["index"]),
                int(existing.get("width") or 0),
                int(existing.get("height") or 0),
            )
            if selection is not None:
                selected_bg_index = selection.get("selectedBgIndex") if isinstance(selection.get("selectedBgIndex"), int) else None
                sections = selection.get("sections") or []
        return UpscaleBgJobResponse(
            jobId=f"existing-{session_id}-{bg_index}-{target_long_edge}-{source_image_hash[:12]}",
            status="succeeded",
            rawStatus="succeeded",
            stage="succeeded",
            retryable=False,
            errorCode=None,
            background=BackgroundResponse(**existing),
            selectedBgIndex=selected_bg_index,
            sections=[LevelSectionResponse(**section) for section in sections],
        )

    job = JOB_STORE.create_job(
        kind="upscale_background",
        session_id=session_id,
        idempotency_key=idempotency_key,
        input_hash=source_image_hash,
        metadata={
            "bgIndex": bg_index,
            "model": req.model,
            "targetLongEdge": target_long_edge,
            "select": bool(req.select),
            "sourceImageHash": source_image_hash,
            "safeToRequeue": True,
        },
    )
    if req.select and not bool(job.metadata.get("select")):
        job = JOB_STORE.update_metadata(job.id, {"select": True})
    if job.status == "failed_retryable":
        job = JOB_STORE.requeue_job(job.id, reason="Retry requested through upscale job start endpoint.")
    if job.status == "succeeded" and req.select and not S.has_downstream_artifacts(session_id):
        background = job.result.get("background")
        if isinstance(background, dict):
            selection = S.select_background(
                session_id,
                int(background["index"]),
                int(background.get("width") or 0),
                int(background.get("height") or 0),
            )
            if selection is not None:
                job = JOB_STORE.update_result(
                    job.id,
                    {
                        "selectedBgIndex": selection.get("selectedBgIndex"),
                        "sections": selection.get("sections") or [],
                    },
                )
    return _upscale_job_response_from_record(job)


@router.get("/sessions/{session_id}/upscale-bg/jobs/{job_id}", response_model=UpscaleBgJobResponse)
def get_upscale_background_job(session_id: str, job_id: str) -> UpscaleBgJobResponse:
    _validate_session_id(session_id)
    job = JOB_STORE.get_job(job_id)
    if job is None or job.session_id != session_id or job.kind != "upscale_background":
        raise HTTPException(404, detail={"error": "Upscale job not found"})
    return _upscale_job_response_from_record(job)


@router.post("/sessions/{session_id}/upscale-bg", response_model=UpscaleBgResponse)
async def upscale_background(session_id: str, req: UpscaleBgRequest, request: Request) -> UpscaleBgResponse:
    cancel_event = threading.Event()
    watcher = asyncio.create_task(_watch_request_disconnect(request, cancel_event))
    try:
        return await asyncio.to_thread(_upscale_background_sync, session_id, req, cancel_event)
    finally:
        cancel_event.set()
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass


def _upscale_background_sync(
    session_id: str,
    req: UpscaleBgRequest,
    cancel_event: threading.Event | None = None,
    before_provider_submit: Callable[[], None] | None = None,
) -> UpscaleBgResponse:
    _validate_session_id(session_id)
    if not UPSCALE_MODEL_IDS:
        raise HTTPException(503, detail={"error": "FAL_KEY not configured", "code": "missing_api_key"})
    if req.model not in UPSCALE_MODEL_IDS:
        raise HTTPException(400, detail={"error": f"Invalid upscale model: {req.model}", "code": "invalid_model"})

    raw = S.load_session_raw(session_id)
    if raw is None:
        raise HTTPException(404, detail={"error": "Session not found"})

    bg_index = req.bgIndex if req.bgIndex is not None else raw.get("selected_bg")
    if bg_index is None:
        raise HTTPException(400, detail={"error": "No background selected yet"})
    bg_index = int(bg_index)
    target_long_edge = _validate_upscale_policy(raw, req)
    _validate_upscale_source(raw, bg_index)
    source_image_hash = _upscale_source_image_hash(session_id, bg_index)
    should_select = bool(req.select and not S.has_downstream_artifacts(session_id))

    existing = _matching_upscaled_background(raw, bg_index, req.model, target_long_edge, source_image_hash)
    if existing is not None and (S.session_dir(session_id) / str(existing.get("file", ""))).exists():
        selection = _selection_from_raw(raw)
        if should_select:
            selected = S.select_background(
                session_id,
                int(existing["index"]),
                int(existing.get("width") or 0),
                int(existing.get("height") or 0),
            )
            if selected is None:
                raise HTTPException(404, detail={"error": "Session not found"})
            selection = selected
        return UpscaleBgResponse(
            background=BackgroundResponse(**existing),
            bgWidth=int(existing.get("width") or 0),
            bgHeight=int(existing.get("height") or 0),
            sourceWidth=int(existing.get("sourceWidth") or existing.get("width") or 0),
            sourceHeight=int(existing.get("sourceHeight") or existing.get("height") or 0),
            scale=float(existing.get("upscaleScale") or 1.0),
            selectedBgIndex=selection.get("selectedBgIndex"),
            sections=selection.get("sections") or [],
        )

    sdir = S.session_dir(session_id)
    bg_path = sdir / f"bg_{bg_index:02d}.png"
    if not bg_path.exists():
        raise HTTPException(404, detail={"error": "Background image not found"})

    with Image.open(bg_path) as img:
        source_width, source_height = img.size
        source_long_edge = max(source_width, source_height)
        if source_long_edge >= req.targetLongEdge:
            raise HTTPException(
                400,
                detail={
                    "error": f"Background is already {source_long_edge}px on its long edge",
                    "code": "already_large_enough",
                },
            )
        source = img.convert("RGB")
    source_long_edge = max(source_width, source_height)

    scale = min(8.0, max(1.0, target_long_edge / source_long_edge))
    key = (session_id, bg_index, req.model, target_long_edge, source_image_hash)
    upscaled: Image.Image | None = None
    lock = _upscale_lock_for(key)
    with lock:
        raw = S.load_session_raw(session_id)
        if raw is None:
            raise HTTPException(404, detail={"error": "Session not found"})
        _validate_upscale_policy(raw, req)
        _validate_upscale_source(raw, bg_index)
        should_select = bool(req.select and not S.has_downstream_artifacts(session_id))
        existing = _matching_upscaled_background(raw, bg_index, req.model, target_long_edge, source_image_hash)
        if existing is not None and (sdir / str(existing.get("file", ""))).exists():
            selection = _selection_from_raw(raw)
            if should_select:
                selected = S.select_background(
                    session_id,
                    int(existing["index"]),
                    int(existing.get("width") or 0),
                    int(existing.get("height") or 0),
                )
                if selected is None:
                    raise HTTPException(404, detail={"error": "Session not found"})
                selection = selected
            source.close()
            return UpscaleBgResponse(
                background=BackgroundResponse(**existing),
                bgWidth=int(existing.get("width") or 0),
                bgHeight=int(existing.get("height") or 0),
                sourceWidth=source_width,
                sourceHeight=source_height,
                scale=float(existing.get("upscaleScale") or scale),
                selectedBgIndex=selection.get("selectedBgIndex"),
                sections=selection.get("sections") or [],
            )

        t0 = time.perf_counter()
        try:
            from merceka_core.image import upscale_image
            from .inpaint import OperationCancelled, _sanitized_error, _with_retries_and_timeout

            if cancel_event is not None and cancel_event.is_set():
                raise OperationCancelled()
            if before_provider_submit is not None:
                before_provider_submit()
            upscaled = _with_retries_and_timeout(
                upscale_image,
                source,
                cancel_event=cancel_event,
                model=req.model,
                scale=scale,
            )
            upscaled = _resize_to_long_edge(upscaled, req.targetLongEdge)
        except OperationCancelled as exc:
            raise HTTPException(
                499,
                detail={"error": "Client disconnected before upscale completed", "code": "client_disconnected"},
            ) from exc
        except (RuntimeError, TimeoutError, httpx.HTTPError, ValueError, OSError, UnidentifiedImageError) as exc:
            logger.exception("background upscale failed for %s bg %s", session_id, bg_index)
            raise HTTPException(
                502,
                detail={"error": _sanitized_error(exc), "code": "upscale_failed"},
            ) from exc
        finally:
            source.close()

        elapsed = time.perf_counter() - t0
        output_width, output_height = upscaled.size
        metadata = {
            "kind": "upscaled",
            "sourceIndex": bg_index,
            "sourceWidth": source_width,
            "sourceHeight": source_height,
            "sourceImageHash": source_image_hash,
            "upscaleModel": req.model,
            "upscaleScale": round(scale, 3),
            "targetLongEdge": target_long_edge,
        }
        try:
            persisted = S.save_new_background_image(
                session_id,
                upscaled,
                generation_time=elapsed,
                bg_width=output_width,
                bg_height=output_height,
                metadata=metadata,
                select=should_select,
            )
        finally:
            upscaled.close()

    bg_info = {k: v for k, v in persisted.items() if k not in {"selectedBgIndex", "sections"}}
    return UpscaleBgResponse(
        background=BackgroundResponse(**bg_info),
        bgWidth=output_width,
        bgHeight=output_height,
        sourceWidth=source_width,
        sourceHeight=source_height,
        scale=round(scale, 3),
        selectedBgIndex=persisted.get("selectedBgIndex"),
        sections=persisted.get("sections") or [],
    )


@router.post("/sessions/{session_id}/hitboxes")
def save_hitboxes(session_id: str, req: SaveHitboxesRequest):
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    S.save_hitboxes(session_id, req.hitboxes)
    return Response(status_code=204)


@router.get("/sessions/{session_id}/visibility-check")
def visibility_check(session_id: str):
    return _visibility_check_for_session(session_id)


@router.post("/sessions/visibility-checks")
def visibility_checks(req: VisibilityChecksRequest):
    reports: dict[str, Any] = {}
    for session_id in req.sessionIds:
        try:
            reports[session_id] = _visibility_check_for_session(session_id)
        except HTTPException:
            reports[session_id] = {"ok": True, "issues": [], "viewports": []}
    return {"reports": reports}


def _visibility_check_for_session(session_id: str) -> dict[str, Any]:
    _validate_session_id(session_id)
    sdir = S.session_dir(session_id)
    if not sdir.exists():
        raise HTTPException(404, detail={"error": "Session not found"})

    raw = S.load_session_raw(session_id) or {}
    hb_path = sdir / "hitboxes.json"
    if not hb_path.exists():
        raise HTTPException(400, detail={"error": "No hitboxes saved"})
    try:
        import json
        hitboxes = json.loads(hb_path.read_text())
    except (OSError, ValueError) as exc:
        raise HTTPException(400, detail={"error": f"Invalid hitboxes.json: {exc}"})

    width = raw.get("bg_width") or 0
    height = raw.get("bg_height") or 0
    if not width or not height:
        selected_bg = raw.get("selected_bg")
        if selected_bg is not None:
            bg_path = sdir / f"bg_{selected_bg:02d}.png"
            if bg_path.exists():
                with Image.open(bg_path) as img:
                    width, height = img.size
    if not width or not height:
        raise HTTPException(400, detail={"error": "No background selected yet"})

    level_data = S.build_level_dict(
        session_id,
        hitboxes,
        width=width,
        height=height,
        style=raw.get("style"),
    )
    if raw.get("mode") == "landscape":
        sections = raw.get("sections") or []
        S._validate_sections(sections, width)
        level_data["sections"] = sections
    return S.mobile_visibility_report(level_data)


class AutoHitboxesRequest(BaseModel):
    """Auto-place N hitboxes.

    `strategy="random"` preserves the existing geometry-only placer.
    `strategy="smart"` keeps those same geometry guards but asks a vision
    model to score numbered candidate crops before deterministic selection.
    The seed is derived from the session id, optionally mixed with `nonce`.
    """
    nDogs: int = Field(..., ge=1, le=40)
    nonce: int | None = None
    radius: int = Field(50, ge=10, le=200)
    strategy: Literal["random", "smart"] = "random"
    candidateCount: int = Field(36, ge=12, le=80)


# Centre-to-centre spacing multiplier for generate_hitboxes_grounded. The
# square crop overlap check below is the source of truth for padded boxes;
# this distance still keeps circular hitbox centers comfortably separated.
_AUTOPLACE_DISTANCE_MULT = 4.0
_AUTOPLACE_CROP_PADDING = 2.75
_AUTOPLACE_DEFAULT_RADIUS = 50


def _portrait_deadzones(bg_w: int, bg_h: int) -> list:
    """Portrait deadzones — mirrors LevelCanvas.tsx getDeadZones() so the
    auto-placer avoids regions that either get cropped on-device or sit
    behind HUD / ad banner / hint chip. Coords are scaled from the
    reference layout (sections.PORTRAIT_REFERENCE_DEADZONES) to the actual
    background dimensions. The reference rects are the single source of truth
    (plan -004 U1) — this function only scales them.
    """
    from levelbuilder.hitboxes import Rect
    from levelbuilder.sections import (
        PORTRAIT_REF_WIDTH,
        PORTRAIT_REF_HEIGHT,
        PORTRAIT_REFERENCE_DEADZONES,
    )
    sx = bg_w / float(PORTRAIT_REF_WIDTH)
    sy = bg_h / float(PORTRAIT_REF_HEIGHT)
    return [
        Rect(x=int(rx * sx), y=int(ry * sy), w=int(rw * sx), h=int(rh * sy))
        for _label, rx, ry, rw, rh in PORTRAIT_REFERENCE_DEADZONES
    ]


def _landscape_deadzones(bg_w: int, bg_h: int) -> list:
    """Landscape deadzones — HUD / ad bands + edge and section buffers.
    Mirrors LevelCanvas.tsx (13.9% HUD, 7.1% banner, 60px safe area at the
    outer edges and each side of every shared section edge). The HUD/banner
    fractions and the buffer width are single-sourced from sections.py
    (plan -004 U1) so the canvas, auto-placer, and gate can't drift on them.
    """
    from levelbuilder.hitboxes import Rect
    from levelbuilder.sections import (
        HUD_FRACTION,
        BANNER_FRACTION,
        SECTION_BOUNDARY_BUFFER,
    )
    hud = int(bg_h * HUD_FRACTION)
    banner = int(bg_h * BANNER_FRACTION)
    buf = SECTION_BOUNDARY_BUFFER
    section_w = bg_w // 3
    return [
        Rect(x=0,                     y=0,                  w=bg_w, h=hud),
        Rect(x=0,                     y=bg_h - banner,      w=bg_w, h=banner),
        Rect(x=0,                     y=0,                  w=buf,  h=bg_h),
        Rect(x=bg_w - buf,            y=0,                  w=buf,  h=bg_h),
        Rect(x=section_w - buf,       y=0,                  w=buf,  h=bg_h),
        Rect(x=section_w,             y=0,                  w=buf,  h=bg_h),
        Rect(x=2 * section_w - buf,   y=0,                  w=buf,  h=bg_h),
        Rect(x=2 * section_w,         y=0,                  w=buf,  h=bg_h),
    ]


@router.post("/sessions/{session_id}/auto-hitboxes")
def auto_place_hitboxes(session_id: str, req: AutoHitboxesRequest) -> dict[str, Any]:
    from levelbuilder.hitboxes import generate_hitboxes_grounded

    _validate_session_id(session_id)
    sdir = S.session_dir(session_id)
    if not sdir.exists():
        raise HTTPException(404, detail={"error": "Session not found"})

    raw = S.load_session_raw(session_id) or {}
    bg_w = raw.get("bg_width")
    bg_h = raw.get("bg_height")
    # Self-heal: if the SSE bg-gen stream died before persisting bg_width /
    # bg_height to session.json but the PNG is on disk, read dims from the
    # file rather than throwing 400. Also writes them back so the next call
    # is fast.
    if not bg_w or not bg_h:
        selected_bg = raw.get("selected_bg")
        if selected_bg is None:
            # No stored selection either \u2014 fall back to bg_00.png if present.
            if (sdir / "bg_00.png").exists():
                selected_bg = 0
        if selected_bg is not None:
            bg_path = sdir / f"bg_{selected_bg:02d}.png"
            if bg_path.exists():
                from PIL import Image as _PIL
                with _PIL.open(bg_path) as _img:
                    bg_w, bg_h = _img.size
                S.update_session_field(
                    session_id,
                    selected_bg=selected_bg,
                    bg_width=bg_w,
                    bg_height=bg_h,
                )
    if not bg_w or not bg_h:
        raise HTTPException(400, detail={"error": "No background selected yet"})

    # Seed derived from session id (so parallel sessions differ and a
    # re-run of the same session is stable), optionally mixed with a
    # client nonce when the user wants a fresh layout.
    # Deterministic cross-restart seed. Python's builtin hash() is salted
    # per-process (PYTHONHASHSEED), so using it here broke the "stable
    # re-run per session" promise across uvicorn reloads — swap to blake2b.
    seed = int(hashlib.blake2b(
        f"{session_id}:{req.nonce or 0}".encode(),
        digest_size=4,
    ).hexdigest(), 16)

    # Deadzones match LevelCanvas.tsx getDeadZones() so auto-placed hitboxes
    # don't land behind the HUD, ad banner, cropped side strips, or (for
    # landscape) on the section boundary buffers.
    # session.json stores the field as `mode`; hydrate_session maps it to
    # `orientation` on the wire. The raw dict keeps the disk-level name,
    # so read `mode` here — previous `raw.get("orientation")` always fell
    # through to the default, silently giving landscape sessions portrait
    # deadzone geometry.
    orientation = raw.get("mode", "portrait")
    forbidden = (
        _landscape_deadzones(bg_w, bg_h) if orientation == "landscape"
        else _portrait_deadzones(bg_w, bg_h)
    )

    radius = int(req.radius or _AUTOPLACE_DEFAULT_RADIUS)

    if req.strategy == "smart":
        selected_bg = raw.get("selected_bg")
        if selected_bg is None:
            selected_bg = 0
        bg_path = sdir / f"bg_{int(selected_bg):02d}.png"
        if not bg_path.exists():
            raise HTTPException(400, detail={"error": "Selected background file not found", "code": "missing_background"})
        entity_key = raw.get("entity") if isinstance(raw.get("entity"), str) else "dog"
        entity_label = ENTITIES.get(entity_key, entity_key or "dog")
        try:
            selected = SmartHitboxes.smart_place_hitboxes(
                image_path=bg_path,
                n=req.nDogs,
                radius=radius,
                forbidden=forbidden,
                seed=seed,
                entity_label=entity_label,
                candidate_count=req.candidateCount,
                padding=_AUTOPLACE_CROP_PADDING,
            )
        except RuntimeError as exc:
            code = "missing_api_key" if "OPENROUTER_API_KEY" in str(exc) else "smart_hitboxes_failed"
            status = 503 if code == "missing_api_key" else 502
            raise HTTPException(status, detail={"error": str(exc), "code": code}) from exc
        except Exception as exc:
            logger.warning("smart hitbox placement failed for %s: %s", session_id, exc)
            raise HTTPException(502, detail={
                "error": "Smart hitbox vision scoring failed",
                "code": "smart_hitboxes_failed",
            }) from exc
        payload = SmartHitboxes.hitbox_payload(selected)
        persisted = S.save_hitboxes(session_id, payload) or payload
        return {
            "hitboxes": persisted,
            "strategy": "smart",
            "placements": SmartHitboxes.metadata_payload(selected),
        }

    # Fixed radius (not a range) so every auto-placed hitbox has the same
    # size. `square_padding_multiplier` matches the dashed inpaint-crop
    # overlay in LevelCanvas.tsx, so auto-place won't create overlapping
    # crop squares or crop squares that cross mobile deadzones.
    hitboxes = generate_hitboxes_grounded(
        n=req.nDogs,
        width=bg_w,
        height=bg_h,
        radius_range=(radius, radius),
        seed=seed,
        min_distance_multiplier=_AUTOPLACE_DISTANCE_MULT,
        square_padding_multiplier=_AUTOPLACE_CROP_PADDING,
        forbidden=forbidden,
    )
    payload = [{"x": hb.x, "y": hb.y, "r": hb.radius} for hb in hitboxes]
    persisted = S.save_hitboxes(session_id, payload) or payload
    return {"hitboxes": persisted, "strategy": "random"}


# ── Per-dog ───────────────────────────────────────────────────────────────────

class SetActiveVariantRequest(BaseModel):
    variantIndex: int | None


@router.patch("/sessions/{session_id}/dogs/{dog_index}/active")
def set_active_variant(session_id: str, dog_index: int, req: SetActiveVariantRequest):
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    S.set_active_variant(session_id, dog_index, req.variantIndex)
    # Recomposite color.png from bg + every dog's currently-active variant,
    # using the same raw diff-mask paste as the initial crop inpaint path.
    from . import inpaint as _inpaint
    _inpaint.recomposite_color(session_id)
    return Response(status_code=204)


@router.patch("/sessions/{session_id}/dogs/by-id/{dog_id}/active")
def set_active_variant_by_id(
    session_id: str, dog_id: str, req: SetActiveVariantRequest, background_tasks: BackgroundTasks,
):
    """Stable-id adapter for set-active (A1). Resolves the id to its current index
    immediately before delegating, so a concurrent reorder can't act on a stale
    index. 404 if the id resolves to no dog (legacy/un-backfilled sessions).

    Recompose split (spec -004 §7): the metadata write is synchronous (so the
    204 reflects the new state), but `recomposite_color` — whose `compose_with_mask`
    is ~seconds of PIL on a dense level — runs AFTER the response as a background
    task. The DogsCanvas shows the change instantly (optimistic + the cutout is
    drawn from per-dog variants, not color.png), and color.png catches up off the
    interaction path. (Coalescing N rapid recomposes is a follow-up; each run
    composes current state, so the editor self-heals.)"""
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    dog_index = S.resolve_dog_index_by_id(session_id, dog_id)
    if dog_index is None:
        raise HTTPException(404, detail={"error": f"No dog with id {dog_id}"})
    S.set_active_variant(session_id, dog_index, req.variantIndex)
    from . import inpaint as _inpaint
    background_tasks.add_task(_inpaint.recomposite_color, session_id)
    return Response(status_code=204)


@router.delete("/sessions/{session_id}/dogs/by-id/{dog_id}")
def delete_dog_by_id(session_id: str, dog_id: str, background_tasks: BackgroundTasks):
    """Delete a dog by stable id (spec -004 §6.9). Removes the hitbox + the
    dogs[] entry carrying the id under one lock (no sibling re-index, no orphan
    hitbox); color.png recomposites from the survivors AFTER the response
    (background task — recompose split, §7). 404 if no dog carries the id."""
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    if not S.delete_dog_by_id(session_id, dog_id):
        raise HTTPException(404, detail={"error": f"No dog with id {dog_id}"})
    from . import inpaint as _inpaint
    background_tasks.add_task(_inpaint.recomposite_color, session_id)
    return Response(status_code=204)


# ── Retired direct package routes ─────────────────────────────────────────────

def _retired_direct_package_route(session_id: str) -> None:
    _validate_session_id(session_id)
    raise HTTPException(410, detail={
        "error": "Direct package endpoints are retired. Use Gallery selection, Lineup validation, and Start.",
        "code": "retired_direct_package_route",
    })


@router.post("/sessions/{session_id}/preview-local")
def preview_level_locally(
    session_id: str,
):
    _retired_direct_package_route(session_id)


@router.post("/sessions/{session_id}/approve-catalog")
def approve_level_for_catalog(session_id: str, requestId: str = Query(..., min_length=8, max_length=200)):
    # Un-retired in the fork: FTD retired this because new-level publishing was
    # to move to the v2 editor at cutover, leaving new levels with NO live path
    # into the production catalog. This tool authors new levels, so the reviewed
    # session → catalog registration path is load-bearing again. The staging
    # export inside runs through the fail-closed export gate.
    return S.approve_level_for_catalog(session_id, request_id=requestId)


@router.post("/sessions/{session_id}/fix-hitboxes")
def fix_session_hitboxes(session_id: str, maxOffsetFraction: float = Query(0.5, ge=0.1, le=1.0)):
    # Fork addition: server-side recenter — sprite metadata lives on the
    # server filesystem, so the client cannot compute this correctly.
    _validate_session_id(session_id)
    return S.recenter_hitboxes_to_sprites(session_id, max_offset_fraction=maxOffsetFraction)


@router.post("/sessions/{session_id}/bundle")
def bundle_level_as_starter(session_id: str):
    # Fork addition: register an installed public package in the bundled
    # manifest (starter set). Pure manifest upsert over already-installed
    # bytes — catalog packages are not mutated. The original v1 flow only
    # bundled at preview-time pre-catalog; a fresh game needs a way to bundle
    # a level that was cataloged first.
    _validate_session_id(session_id)
    if not (S.GAME_PUBLIC_LEVELS / session_id / "level.json").is_file():
        raise HTTPException(404, detail={
            "error": f"no installed public package for {session_id}; export it first",
            "code": "package_not_installed",
        })
    manifest = S.upsert_bundled_manifest_level(session_id)
    S._ensure_levels_index_entry(session_id)
    return {"levelId": session_id, "bundled": True, "manifestRevision": manifest.get("manifestRevision")}


@router.get("/catalog/levels")
def get_catalog_levels(include_tombstoned: bool = Query(False)):
    return {"levels": S.list_catalog_candidates(include_tombstoned=include_tombstoned)}


@router.delete("/catalog/levels/{session_id}")
def tombstone_catalog_level(session_id: str, reason: str = Query("operator cleanup")):
    _validate_session_id(session_id)
    raise HTTPException(410, detail={
        "error": "Direct catalog deletion is retired. Use Gallery selection, Lineup validation, and Start.",
        "code": "retired_catalog_delete_route",
    })


class SaveSequenceDraftRequest(BaseModel):
    levelIds: list[str] = Field(..., max_length=500)
    baseLiveSequenceVersion: str = Field(..., min_length=1, max_length=200)
    baseCatalogRevision: str = Field(..., min_length=1, max_length=200)
    draftRevision: str = Field(..., min_length=1, max_length=200)


class ResetSequenceDraftRequest(BaseModel):
    draftRevision: str = Field(..., min_length=1, max_length=200)
    force: bool = False


class DryRunSequenceDraftRequest(BaseModel):
    changelogNote: str = Field(..., max_length=1000)
    baseLiveSequenceVersion: str = Field(..., min_length=1, max_length=200)
    baseCatalogRevision: str = Field(..., min_length=1, max_length=200)
    draftRevision: str = Field(..., min_length=1, max_length=200)


class ActivateSequenceRequest(BaseModel):
    changelogNote: str = Field(..., max_length=1000)
    baseLiveSequenceVersion: str = Field(..., min_length=1, max_length=200)
    baseCatalogRevision: str = Field(..., min_length=1, max_length=200)
    draftRevision: str = Field(..., min_length=1, max_length=200)
    destructiveWarningAcknowledged: bool = False
    requestId: str = Field(..., min_length=1, max_length=200)


class StartSequenceRequest(ActivateSequenceRequest):
    dynamicBundle: bool = True


def _sequence_stale_response(exc: SequenceWorkflow.SequenceDraftStaleError) -> HTTPException:
    return HTTPException(409, detail={
        "error": str(exc),
        "code": "sequence_draft_stale",
        "state": _maybe_sequence_response(exc.current_state),
    })


def _retired_sequence_write_route() -> None:
    raise HTTPException(410, detail={
        "error": "Direct Lineup write endpoints are retired. Use Start.",
        "code": "retired_sequence_write_route",
    })


def _summarize_sequence_version(version: dict[str, Any]) -> dict[str, Any]:
    raw_payload = version.get("rawPayload")
    return {
        key: value
        for key, value in {
            **version,
            "rawPayload": None,
            "rawPayloadBytes": len(raw_payload.encode("utf-8")) if isinstance(raw_payload, str) else 0,
            "diagnosticsCount": len(version.get("diagnostics") or []),
        }.items()
        if key not in {"rawPayload", "diagnostics"}
    }


def _summarize_audit_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            **event,
            "diagnosticsCount": len(event.get("diagnostics") or []),
        }.items()
        if key != "diagnostics"
    }


def _summarize_pending_attempt(attempt: dict[str, Any]) -> dict[str, Any]:
    raw_payload = attempt.get("rawPayload")
    return {
        key: value
        for key, value in {
            **attempt,
            "rawPayload": None,
            "rawPayloadBytes": len(raw_payload.encode("utf-8")) if isinstance(raw_payload, str) else 0,
        }.items()
        if key != "rawPayload"
    }


def _bounded_activation_state(state: dict[str, Any], *, limit: int = 50) -> dict[str, Any]:
    versions = list(state.get("versions") or [])
    audit_events = list(state.get("auditEvents") or [])
    pending_attempts = list(state.get("pendingAttempts") or [])
    return {
        **state,
        "versions": [_summarize_sequence_version(version) for version in versions[-limit:]],
        "auditEvents": [_summarize_audit_event(event) for event in audit_events[-limit:]],
        "pendingAttempts": [_summarize_pending_attempt(attempt) for attempt in pending_attempts[-limit:]],
        "historyCounts": {
            "versions": len(versions),
            "auditEvents": len(audit_events),
            "pendingAttempts": len(pending_attempts),
        },
        "historyTruncated": len(versions) > limit or len(audit_events) > limit or len(pending_attempts) > limit,
    }


def _sequence_response(state: dict[str, Any]) -> dict[str, Any]:
    return {**state, "activation": _bounded_activation_state(SequenceActivation.get_sequence_activation_state(state))}


def _maybe_sequence_response(state: dict[str, Any]) -> dict[str, Any]:
    if "liveSequence" in state and "draft" in state:
        return _sequence_response(state)
    return state


def _bounded_activation_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        **result,
        "version": _summarize_sequence_version(result["version"]),
        "state": _bounded_activation_state(result["state"]),
    }


_SEQUENCE_START_JOB_KIND = "sequence_start"
_SEQUENCE_START_SESSION_ID = "sequence-workflow"


def _sequence_start_idempotency_key(req: StartSequenceRequest) -> str:
    payload = {
        "baseCatalogRevision": req.baseCatalogRevision,
        "baseLiveSequenceVersion": req.baseLiveSequenceVersion,
        "destructiveWarningAcknowledged": req.destructiveWarningAcknowledged,
        "draftRevision": req.draftRevision,
        "dynamicBundle": req.dynamicBundle,
        "requestId": req.requestId,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return f"sequence-start:{digest}"


def _sequence_start_job_response(job: JobRecord) -> JobResponse:
    return _job_response(job)


def _job_error_detail(exc: HTTPException) -> tuple[str, str]:
    detail = exc.detail
    if isinstance(detail, dict):
        code = str(detail.get("code") or "sequence_start_failed")
        message = str(detail.get("error") or detail)
        return code, message
    return "sequence_start_failed", str(detail)


def _run_sequence_start_job(job: JobRecord, store: JobStore) -> dict[str, Any]:
    req = StartSequenceRequest(**job.metadata.get("request", {}))
    dry_run_result: dict[str, Any] | None = None
    bundle_result: dict[str, Any] | None = None
    try:
        store.transition_job(job.id, status="running", stage="validating")
        dry_run_result = SequenceWorkflow.dry_run_sequence_draft(
            changelog_note=req.changelogNote,
            base_live_sequence_version=req.baseLiveSequenceVersion,
            base_catalog_revision=req.baseCatalogRevision,
            draft_revision=req.draftRevision,
        )
        dry_run_response = {**dry_run_result, "state": _sequence_response(dry_run_result["state"])}
        store.update_result(job.id, {"dryRun": dry_run_response})
        store.append_event(job.id, "sequence_start.stage_complete", data={"stage": "validating"})

        if req.dynamicBundle:
            store.transition_job(job.id, status="running", stage="packaging")
            bundle_result = _apply_sequence_bundle_projection()
            store.update_result(job.id, {"bundle": bundle_result})
            store.append_event(job.id, "sequence_start.stage_complete", data={"stage": "packaging"})

        store.transition_job(job.id, status="running", stage="publishing")
        activation_result = _bounded_activation_result(SequenceActivation.activate_sequence_draft(
            draft_revision=req.draftRevision,
            base_live_sequence_version=req.baseLiveSequenceVersion,
            base_catalog_revision=req.baseCatalogRevision,
            changelog_note=req.changelogNote,
            destructive_warning_acknowledged=req.destructiveWarningAcknowledged,
            request_id=req.requestId,
            publisher=_publisher_for_sequence_write(),
            actor=_sequence_actor_label(),
        ))
        state = _sequence_response(SequenceWorkflow.get_sequence_editor_state())
        result = {
            "dryRun": dry_run_response,
            "bundle": bundle_result,
            "activation": activation_result,
            "state": state,
        }
        store.update_result(job.id, result)
        store.append_event(job.id, "sequence_start.stage_complete", data={"stage": "publishing"})
        return result
    except SequenceWorkflow.SequenceDraftStaleError as exc:
        store.update_result(job.id, {"state": _maybe_sequence_response(exc.current_state)})
        raise TerminalJobError("sequence_draft_stale", str(exc)) from exc
    except SequenceWorkflow.SequenceValidationError as exc:
        store.update_result(job.id, {"state": _maybe_sequence_response(exc.current_state)})
        raise TerminalJobError("sequence_validation_failed", str(exc)) from exc
    except ValueError as exc:
        raise TerminalJobError("bundle_projection_invalid", str(exc)) from exc
    except SequenceActivation.SequenceActivationValidationError as exc:
        store.update_result(job.id, {
            "diagnostics": exc.diagnostics,
            "state": _maybe_sequence_response(exc.current_state),
        })
        raise TerminalJobError("sequence_activation_validation_failed", str(exc)) from exc
    except SequenceActivation.SequenceActivationConflict as exc:
        store.update_result(job.id, {"state": _maybe_sequence_response(exc.current_state)})
        raise TerminalJobError("sequence_activation_stale", str(exc)) from exc
    except SequenceActivation.SequenceActivationRemoteConflict as exc:
        store.update_result(job.id, {"state": _sequence_response(exc.current_state)})
        raise TerminalJobError("remote_config_conflict", str(exc)) from exc
    except SequenceActivation.SequenceActivationPublishUnavailable as exc:
        store.update_result(job.id, {"state": _maybe_sequence_response(exc.current_state)})
        raise TerminalJobError("remote_config_unconfigured", str(exc)) from exc
    except SequenceActivation.SequenceActivationPublishError as exc:
        store.update_result(job.id, {"state": _maybe_sequence_response(exc.current_state)})
        raise RetryableJobError("remote_config_publish_failed", str(exc)) from exc
    except HTTPException as exc:
        code, message = _job_error_detail(exc)
        raise TerminalJobError(code, message) from exc


def _publisher_for_sequence_write():
    publisher = REMOTE_CONFIG_PUBLISHER_FACTORY()
    if publisher.status().get("configured") is True and not os.environ.get("FTD_BUILDER_TOKEN", "").strip():
        raise HTTPException(403, detail={
            "error": "Sequence publish requires FTD_BUILDER_TOKEN to be configured.",
            "code": "sequence_publish_auth_unconfigured",
        })
    return publisher


def _sequence_actor_label() -> str:
    return os.environ.get("FTD_BUILDER_OPERATOR_LABEL", "authenticated-builder").strip() or "authenticated-builder"


def _assert_sequence_detail_allowed() -> None:
    publisher = REMOTE_CONFIG_PUBLISHER_FACTORY()
    if publisher.status().get("configured") is True and not os.environ.get("FTD_BUILDER_TOKEN", "").strip():
        raise HTTPException(403, detail={
            "error": "Sequence version detail requires FTD_BUILDER_TOKEN to be configured.",
            "code": "sequence_detail_auth_unconfigured",
        })


@router.post("/sequence-workflow/start", response_model=JobResponse)
def start_sequence_workflow(req: StartSequenceRequest) -> JobResponse:
    idempotency_key = _sequence_start_idempotency_key(req)
    existing = JOB_STORE.get_job_by_idempotency_key(kind=_SEQUENCE_START_JOB_KIND, idempotency_key=idempotency_key)
    if existing is not None:
        if existing.status == "failed_retryable" or (is_failed_terminal_status(existing.status) and existing.retryable):
            existing = JOB_STORE.requeue_job(existing.id, reason="Retry requested through sequence Start endpoint.")
        get_default_job_worker().start()
        return _sequence_start_job_response(existing)
    job = JOB_STORE.create_job(
        kind=_SEQUENCE_START_JOB_KIND,
        session_id=_SEQUENCE_START_SESSION_ID,
        idempotency_key=idempotency_key,
        input_hash=idempotency_key,
        metadata={
            "request": req.model_dump(),
            "safeToRequeue": True,
        },
    )
    get_default_job_worker().start()
    return _sequence_start_job_response(job)


@router.get("/sequence-workflow")
def get_sequence_workflow():
    return _sequence_response(SequenceWorkflow.get_sequence_editor_state())


_BUNDLE_CAP_BYTES = 200 * 1024 * 1024  # C1 dynamic-under-200MB policy (Batu, 2026-06-10)


def _bundle_projection() -> dict:
    """Derive the dynamic bundle boundary from the CURRENT sequence draft order:
    cumulative shipped-package size (public/levels/<id>) up to the 200MB cap is
    bundled; the rest streams from CDN. Unexported levels can't bundle and are
    flagged. Read-only — applying it to bundled-manifest.json is a separate
    explicit step (C1 Start)."""
    state = SequenceWorkflow.get_sequence_editor_state()
    level_ids = list(state["draft"]["levelIds"])
    levels: list[dict] = []
    cumulative = 0
    boundary_index = 0
    for level_id in level_ids:
        public_dir = S.GAME_PUBLIC_LEVELS / level_id
        exported = (public_dir / "level.json").exists()
        size = (_directory_size(public_dir) or 0) if exported else 0
        bundled = False
        if exported and cumulative + size <= _BUNDLE_CAP_BYTES and boundary_index == len(levels):
            # contiguous prefix only: the first non-fitting (or unexported)
            # level closes the bundle — the game streams everything after it.
            cumulative += size
            bundled = True
            boundary_index += 1
        levels.append({
            "id": level_id,
            "exported": exported,
            "sizeBytes": size,
            "cumulativeBytes": cumulative if bundled else None,
            "bundled": bundled,
        })
    return {
        "capBytes": _BUNDLE_CAP_BYTES,
        "boundaryIndex": boundary_index,
        "bundledBytes": cumulative,
        "levels": levels,
    }


def _apply_sequence_bundle_projection() -> dict:
    """Apply the current dynamic bundle projection to bundled-manifest.json."""
    projection = _bundle_projection()
    bundled_ids = [lvl["id"] for lvl in projection["levels"] if lvl["bundled"]]
    if not bundled_ids:
        raise ValueError("Projection bundles zero levels — nothing exported in the draft sequence.")
    # Pre-validate EVERY bundled level (read-only) before any manifest write —
    # a mid-list LevelNotReadyError (e.g. missing pickup sprites) would
    # otherwise leave earlier upserts appended but unordered (half-state).
    for level_id in bundled_ids:
        try:
            PublicLevels.public_level_manifest_entry(S.GAME_PUBLIC_LEVELS, level_id)
        except (FileNotFoundError, ValueError) as exc:
            raise ValueError(f"{level_id} cannot join the bundle: {exc}") from exc
    for level_id in bundled_ids:
        S.upsert_bundled_manifest_level(level_id)
    S.reorder_bundled_manifest(bundled_ids)
    return {"applied": True, "bundledIds": bundled_ids, "projection": projection}


@router.get("/sequence-workflow/bundle-projection")
def get_sequence_bundle_projection():
    return _bundle_projection()


@router.post("/sequence-workflow/apply-bundle-projection")
def apply_sequence_bundle_projection():
    """Write bundled-manifest.json (+ levels-index) to the projection's bundled
    prefix: upsert each bundled level then reorder-to-prefix (reorder DROPS
    manifest levels outside the list — that IS the dynamic policy). Returns the
    projection it applied."""
    try:
        return _apply_sequence_bundle_projection()
    except ValueError as exc:
        message = str(exc)
        if message.startswith("Projection bundles zero levels"):
            raise HTTPException(422, detail={"error": message, "code": "empty_bundle_projection"})
        level_id = message.split(" cannot join the bundle:", 1)[0] if " cannot join the bundle:" in message else None
        detail = {"error": message, "code": "bundle_level_not_ready"}
        if level_id:
            detail["levelId"] = level_id
        raise HTTPException(422, detail=detail)


@router.put("/sequence-workflow/draft")
def save_sequence_workflow_draft(req: SaveSequenceDraftRequest):
    try:
        return _sequence_response(SequenceWorkflow.save_sequence_draft(
            level_ids=req.levelIds,
            base_live_sequence_version=req.baseLiveSequenceVersion,
            base_catalog_revision=req.baseCatalogRevision,
            draft_revision=req.draftRevision,
        ))
    except SequenceWorkflow.SequenceDraftStaleError as exc:
        raise _sequence_stale_response(exc)
    except ValueError as exc:
        raise HTTPException(400, detail={"error": str(exc), "code": "sequence_draft_invalid"})


@router.delete("/sequence-workflow/draft")
def reset_sequence_workflow_draft(req: ResetSequenceDraftRequest):
    try:
        return _sequence_response(SequenceWorkflow.reset_sequence_draft(draft_revision=req.draftRevision, force=req.force))
    except SequenceWorkflow.SequenceDraftStaleError as exc:
        raise _sequence_stale_response(exc)


@router.post("/sequence-workflow/dry-run")
def dry_run_sequence_workflow_draft(req: DryRunSequenceDraftRequest):
    try:
        result = SequenceWorkflow.dry_run_sequence_draft(
            changelog_note=req.changelogNote,
            base_live_sequence_version=req.baseLiveSequenceVersion,
            base_catalog_revision=req.baseCatalogRevision,
            draft_revision=req.draftRevision,
        )
        return {**result, "state": _sequence_response(result["state"])}
    except SequenceWorkflow.SequenceDraftStaleError as exc:
        raise _sequence_stale_response(exc)
    except SequenceWorkflow.SequenceValidationError as exc:
        raise HTTPException(422, detail={
            "error": str(exc),
            "code": "sequence_validation_failed",
            "state": _maybe_sequence_response(exc.current_state),
        })


@router.post("/sequence-workflow/activate")
def activate_sequence_workflow_draft():
    _retired_sequence_write_route()


@router.get("/sequence-workflow/versions/{sequence_version}")
def get_sequence_workflow_version_detail(sequence_version: str):
    _assert_sequence_detail_allowed()
    state = SequenceActivation.get_sequence_activation_state(SequenceWorkflow.get_sequence_editor_state())
    for version in state.get("versions") or []:
        if version.get("sequenceVersion") == sequence_version:
            return {"version": version, "active": sequence_version == state.get("activeVersion")}
    raise HTTPException(404, detail={"error": "Sequence version not found", "code": "sequence_version_missing"})


@router.post("/sequence-workflow/rollback")
def rollback_sequence_workflow():
    _retired_sequence_write_route()


@router.post("/sessions/{session_id}/export")
def export_level(
    session_id: str,
):
    _retired_direct_package_route(session_id)


@router.post("/sessions/clear-incomplete")
def clear_incomplete_sessions():
    """Hard-delete session directories that have session.json but never
    produced a color composite or hitboxes (e.g. timed-out batch runs).
    Locally previewed/catalog-packaged sessions are skipped defensively."""
    return S.clear_incomplete_sessions(protect_exported=True)


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    """Hard-delete a single session's source directory. Refuses while a
    public preview/catalog package exists so asset cleanup stays explicit.
    Used by the batch "x" button and individual gallery card deletions."""
    _validate_session_id(session_id)
    sdir = S.session_dir(session_id)
    if not sdir.exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    if (S.GAME_PUBLIC_LEVELS / session_id / "level.json").exists():
        raise HTTPException(409, detail={
            "error": "Session has a public preview/catalog package. Remove local preview or catalog listing before deleting source assets.",
            "code": "public_package_exists",
        })
    import shutil
    shutil.rmtree(sdir)
    return {"deleted": True, "id": session_id}


class SetArchivedRequest(BaseModel):
    archived: bool
    # Optional variant slug. When present we archive/unarchive that
    # variant only \u2014 other variant cards for the same session stay
    # put. When absent we archive the whole session (legacy).
    variant: str | None = None


@router.patch("/sessions/{session_id}/archive")
def set_archived(session_id: str, req: SetArchivedRequest):
    """Archive / unarchive a variant (or the whole session when variant
    is omitted). Archiving the session \u2014 or the variant that matches the
    local preview package \u2014 removes local preview listing so stale levels
    don't linger in levels-index.json."""
    _validate_session_id(session_id)
    if not S.session_dir(session_id).exists():
        raise HTTPException(404, detail={"error": "Session not found"})
    S.set_archived(session_id, req.archived, variant=req.variant)
    # Remove local preview when the user archives the variant currently used
    # by the preview package, or when the whole session is archived.
    if req.archived:
        raw = S.load_session_raw(session_id) or {}
        exported_variant = raw.get("exported_variant", "gemini")
        if req.variant is None or req.variant == exported_variant:
            S.revoke_export(session_id)
    return {"id": session_id, "archived": req.archived, "variant": req.variant}


class ReorderIndexRequest(BaseModel):
    ids: list[str] = Field(..., max_length=500)


@router.get("/bundled-manifest")
def get_bundled_manifest():
    """Return the current `public/levels/bundled-manifest.json`. This is
    the manifest the shipped game reads (`src/data/levels.ts`), not the
    legacy `levels-index.json`."""
    m = S.load_bundled_manifest()
    if m is None:
        return {"version": 1, "manifestRevision": 0, "experimentId": "", "levels": []}
    return m


@router.put("/bundled-manifest/order")
def put_bundled_manifest_order(req: ReorderIndexRequest):
    """Reorder the `levels` array in bundled-manifest.json. Levels whose
    id isn't in the supplied list are dropped from the shipped game."""
    manifest = S.reorder_bundled_manifest(req.ids)
    return {"ok": True, "count": len(manifest.get("levels") or []), "manifest": manifest}


@router.get("/levels-index")
def get_levels_index():
    """Legacy. Return `public/levels/levels-index.json` \u2014 the older
    flat list. Game runtime does NOT read this."""
    return S.load_levels_index()


@router.put("/levels-index")
def put_levels_index(req: ReorderIndexRequest):
    """Rewrite levels-index.json to match the supplied id order. Entries
    whose id is not in the supplied list are dropped. The Game View uses
    this to let the user reorder what ships in the APK."""
    for sid in req.ids:
        if not SESSION_ID_RE.match(sid):
            raise HTTPException(400, detail={"error": f"Invalid id: {sid}"})
    ordered = S.reorder_levels_index(req.ids)
    return {"ok": True, "count": len(ordered), "order": ordered}


@router.delete("/sessions/{session_id}/export")
def revoke_export(session_id: str):
    """Unpublish a level from the game's public/levels tree. Leaves the
    pipeline source at levels/{id}/ intact, so re-exporting restores the
    level with no regeneration."""
    _validate_session_id(session_id)
    # Allow revoke even if session.json is gone \u2014 the source of truth
    # for "is this exported" is public/levels/{id}/.
    return S.revoke_export(session_id)




# ── Prompt library ────────────────────────────────────────────────────────────


class SavePromptRequest(BaseModel):
    text: str


class SetDefaultPromptRequest(BaseModel):
    version: int


@router.get("/prompts")
def list_prompts_endpoint():
    """Whole prompt library (D1 PROMPTS tab). {kind: PromptKind} keyed map."""
    return {kind: p.model_dump(mode="json") for kind, p in P.list_prompts().items()}


@router.get("/prompts/{kind}")
def get_prompt_endpoint(kind: str):
    try:
        p = P.get_prompt(kind)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if p is None:
        return {"default_version": 0, "versions": []}
    return p.model_dump(mode="json")


@router.post("/prompts/{kind}")
def save_prompt_endpoint(kind: str, req: SavePromptRequest):
    if not req.text.strip():
        raise HTTPException(400, detail="prompt text cannot be empty")
    try:
        p = P.save_prompt(kind, req.text)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return p.model_dump(mode="json")


@router.patch("/prompts/{kind}/default")
def set_prompt_default_endpoint(kind: str, req: SetDefaultPromptRequest):
    try:
        p = P.set_default(kind, req.version)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    return p.model_dump(mode="json")
