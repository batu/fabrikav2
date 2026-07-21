"""Pure model-option registry; availability is supplied by composition."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True, slots=True)
class ModelOption:
    id: str
    label: str


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    layer: bool = False
    fal: bool = False


BASE_MODELS = (
    ModelOption("openai/gpt-image-2", "GPT Image 2 (OpenAI direct)"),
    ModelOption("openai/gpt-image-1", "GPT Image 1 (OpenAI direct)"),
    ModelOption("google/gemini-3.1-flash-image-preview", "Gemini 3.1 Flash"),
    ModelOption("google/gemini-3-pro-image-preview", "Gemini 3 Pro"),
    ModelOption("google/gemini-2.5-flash-image", "Gemini 2.5 Flash"),
)
LAYER_MODELS = (ModelOption("layer/cartoon-2d", "Layer Cartoon 2D"),)
FAL_INPAINT_MODELS = (ModelOption("fal-ai/flux-pro/v1/fill", "fal Flux Pro Fill"),)
FAL_UPSCALE_MODELS = (
    ModelOption("fal-ai/esrgan", "fal ESRGAN (conservative)"),
    ModelOption("fal-ai/aura-sr", "fal AuraSR (4x quality test)"),
)


def available_model_options(capabilities: ProviderCapabilities) -> dict[str, tuple[ModelOption, ...]]:
    background = BASE_MODELS + (LAYER_MODELS if capabilities.layer else ())
    inpaint = BASE_MODELS + (FAL_INPAINT_MODELS if capabilities.fal else ())
    upscale = FAL_UPSCALE_MODELS if capabilities.fal else ()
    return {"background": background, "inpaint": inpaint, "upscale": upscale}


def model_option_snapshot() -> dict[str, list[dict[str, str]]]:
    return {
        "base": [asdict(option) for option in BASE_MODELS],
        "layer": [asdict(option) for option in LAYER_MODELS],
        "falInpaint": [asdict(option) for option in FAL_INPAINT_MODELS],
        "falUpscale": [asdict(option) for option in FAL_UPSCALE_MODELS],
    }
