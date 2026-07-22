"""FTD paid generation: durable handlers behind the provider trust boundary."""

from __future__ import annotations

from typing import Any, Callable, Mapping

from ..jobs.worker import JobContext
from ..sessions.store import SessionStore
from .animation import sprite_animate_handler, sprite_animate_resume_handler
from .composition import (
    background_generate_handler,
    band_generate_handler,
    multi_scene_generate_handler,
    sequence_workflow_handler,
)
from .crop import crop_inpaint_handler, dog_regenerate_handler, retry_failed_dogs_handler
from .magenta import magenta_inpaint_handler
from .paid import PaidRuntime
from .upscale import upscale_handler


def build_ftd_paid_handlers(
    sessions: SessionStore, now: Callable[[], str]
) -> tuple[
    dict[str, Callable[[JobContext], Mapping[str, Any] | None]],
    dict[str, Callable[[JobContext, str], Mapping[str, Any] | None]],
]:
    """Handlers and resume handlers for every registered FTD paid kind."""

    runtime = PaidRuntime(sessions=sessions, now=now)
    handlers = {
        "ftd.dog_variant_upscale": upscale_handler(runtime),
        "ftd.background_generate": background_generate_handler(runtime),
        "ftd.sprite_animate": sprite_animate_handler(runtime),
        "ftd.crop_inpaint": crop_inpaint_handler(runtime),
        "ftd.retry_failed_dogs": retry_failed_dogs_handler(runtime),
        "ftd.band_generate": band_generate_handler(runtime),
        "ftd.sequence_workflow": sequence_workflow_handler(runtime),
        "ftd.multi_scene_generate": multi_scene_generate_handler(runtime),
        "ftd.magenta_inpaint": magenta_inpaint_handler(runtime),
        "ftd.dog_regenerate": dog_regenerate_handler(runtime),
    }
    resume_handlers = {
        "ftd.sprite_animate": sprite_animate_resume_handler(runtime),
    }
    return handlers, resume_handlers
