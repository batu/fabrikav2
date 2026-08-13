"""Vision-guided hitbox placement for the Find the Dog levelbuilder.

The current random auto-placer knows geometry but not image semantics: it can
avoid HUD/ad/dead-zone rectangles while still choosing walls, roofs, or sky.
This module keeps the geometry rules deterministic and asks a vision model only
to score numbered candidate crops. The final hitboxes are selected by code, not
by trusting free-form model coordinates.
"""

from __future__ import annotations

import logging
import os
import random
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps
import json

from pydantic import BaseModel, Field, ValidationError, field_validator

from levelbuilder.hitboxes import Rect

logger = logging.getLogger(__name__)

# Verified against the live OpenRouter catalog 2026-08-13. This model scores
# numbered image candidates; deterministic geometry still selects hitboxes.
SMART_PLACEMENT_MODEL = "google/gemini-3.6-flash"
DEFAULT_CANDIDATE_COUNT = 36
DEFAULT_SCORE_THRESHOLD = 45
SCORING_CHUNK_SIZE = 20
CONTACT_CELL_SIZE = 176
CONTACT_LABEL_HEIGHT = 26
CONTACT_COLUMNS = 4


@dataclass(frozen=True)
class PlacementCandidate:
    id: int
    x: int
    y: int
    r: int


@dataclass(frozen=True)
class ScoredPlacementCandidate:
    id: int
    x: int
    y: int
    r: int
    score: int
    reason: str


class CandidateScore(BaseModel):
    id: int = Field(ge=1)
    score: int = Field(ge=0, le=100)
    reason: str = Field(max_length=500)


class CandidateScoreResponse(BaseModel):
    candidates: list[CandidateScore]

    @field_validator("candidates", mode="before")
    @classmethod
    def _unwrap_string_items(cls, value):
        """The vision model sometimes returns list items as STRINGS of JSON
        (observed live 2026-08-13, gemini-3.5-flash-lite). Unwrap them before
        validation instead of failing the whole placement; genuinely malformed
        strings still fail loudly downstream."""
        if isinstance(value, str):
            value = json.loads(value)
        if isinstance(value, list):
            unwrapped = []
            for item in value:
                if isinstance(item, str):
                    try:
                        item = json.loads(item)
                    except json.JSONDecodeError:
                        pass  # leave it; pydantic names the offender
                unwrapped.append(item)
            return unwrapped
        return value


def _candidate_box(candidate: PlacementCandidate | ScoredPlacementCandidate, padding: float) -> tuple[float, float, float, float]:
    half = candidate.r * padding
    return (candidate.x - half, candidate.y - half, candidate.x + half, candidate.y + half)


def _box_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _overlap_area(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    overlap_width = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    overlap_height = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    return overlap_width * overlap_height


def _overlaps_forbidden(candidate: PlacementCandidate | ScoredPlacementCandidate, forbidden: list[Rect], padding: float) -> bool:
    left, top, right, bottom = _candidate_box(candidate, padding)
    return any(
        rect.contains_circle(candidate.x, candidate.y, candidate.r)
        or rect.overlaps_box(left, top, right, bottom)
        for rect in forbidden
    )


def _overlaps_selected_too_much(
    candidate: PlacementCandidate | ScoredPlacementCandidate,
    selected: list[ScoredPlacementCandidate],
    padding: float,
    max_pair_overlap_fraction: float,
    max_total_overlap_fraction: float,
) -> bool:
    candidate_box = _candidate_box(candidate, padding)
    candidate_area = _box_area(candidate_box)
    total_overlap = 0.0
    for existing in selected:
        existing_box = _candidate_box(existing, padding)
        overlap = _overlap_area(candidate_box, existing_box)
        if overlap == 0:
            continue
        total_overlap += overlap
        smaller_area = min(candidate_area, _box_area(existing_box))
        if smaller_area > 0 and overlap / smaller_area > max_pair_overlap_fraction:
            return True
    return candidate_area > 0 and total_overlap / candidate_area > max_total_overlap_fraction


def generate_geometry_safe_candidates(
    *,
    width: int,
    height: int,
    radius: int,
    forbidden: list[Rect],
    seed: int,
    count: int = DEFAULT_CANDIDATE_COUNT,
    padding: float = 2.75,
) -> list[PlacementCandidate]:
    """Generate deterministic candidates that satisfy geometry-only rules.

    Candidates may overlap each other. The final selector enforces crop overlap
    so the vision model can choose among nearby alternatives instead of the pool
    being prematurely thinned by random order.
    """
    rng = random.Random(seed)
    candidates: list[PlacementCandidate] = []
    margin = max(20, int(radius * padding))
    if width <= margin * 2 or height <= margin * 2:
        return []

    attempts = max(count * 80, 800)
    for _ in range(attempts):
        x = rng.randint(margin, width - margin)
        y = rng.randint(margin, height - margin)
        candidate = PlacementCandidate(id=len(candidates) + 1, x=x, y=y, r=radius)
        if _overlaps_forbidden(candidate, forbidden, padding):
            continue
        # Avoid a contact sheet full of near-identical crops; this is weaker
        # than final crop-overlap rejection and only removes duplicates.
        if any((x - existing.x) ** 2 + (y - existing.y) ** 2 < (radius * 1.5) ** 2 for existing in candidates):
            continue
        candidates.append(candidate)
        if len(candidates) >= count:
            break
    return candidates


def select_scored_candidates(
    *,
    candidates: list[PlacementCandidate],
    scores: list[CandidateScore],
    n: int,
    forbidden: list[Rect],
    padding: float = 2.75,
    score_threshold: int = DEFAULT_SCORE_THRESHOLD,
    max_pair_overlap_fraction: float = 0.20,
    max_total_overlap_fraction: float = 0.35,
) -> list[ScoredPlacementCandidate]:
    """Deterministically select top scored candidates with bounded crop overlap."""
    by_id = {candidate.id: candidate for candidate in candidates}
    scored: list[ScoredPlacementCandidate] = []
    seen: set[int] = set()
    for score in scores:
        candidate = by_id.get(score.id)
        if candidate is None or candidate.id in seen:
            continue
        seen.add(candidate.id)
        scored.append(ScoredPlacementCandidate(
            id=candidate.id,
            x=candidate.x,
            y=candidate.y,
            r=candidate.r,
            score=score.score,
            reason=score.reason.strip(),
        ))

    # The model should score every candidate. If it misses some, keep them as
    # low-score geometric fallbacks so a malformed partial response still has a
    # deterministic terminal state instead of randomly failing the whole run.
    for candidate in candidates:
        if candidate.id in seen:
            continue
        scored.append(ScoredPlacementCandidate(
            id=candidate.id,
            x=candidate.x,
            y=candidate.y,
            r=candidate.r,
            score=0,
            reason="not scored by vision model",
        ))

    selected: list[ScoredPlacementCandidate] = []
    for candidate in sorted(scored, key=lambda item: (-item.score, item.id)):
        if candidate.score < score_threshold and len(selected) > 0:
            continue
        if _overlaps_forbidden(candidate, forbidden, padding):
            continue
        if _overlaps_selected_too_much(
            candidate,
            selected,
            padding,
            max_pair_overlap_fraction,
            max_total_overlap_fraction,
        ):
            continue
        selected.append(candidate)
        if len(selected) >= n:
            return selected

    # If thresholding was too strict, fill from all scored candidates while
    # still preserving geometry invariants. The UI should get usable hitboxes,
    # but the returned reasons/scores make weak choices visible for future UI.
    for candidate in sorted(scored, key=lambda item: (-item.score, item.id)):
        if candidate in selected:
            continue
        if _overlaps_forbidden(candidate, forbidden, padding):
            continue
        if _overlaps_selected_too_much(
            candidate,
            selected,
            padding,
            max_pair_overlap_fraction,
            max_total_overlap_fraction,
        ):
            continue
        selected.append(candidate)
        if len(selected) >= n:
            break
    return selected


def _crop_box(candidate: PlacementCandidate, image_width: int, image_height: int, padding: float) -> tuple[int, int, int, int]:
    half = candidate.r * padding
    return (
        max(0, int(candidate.x - half)),
        max(0, int(candidate.y - half)),
        min(image_width, int(candidate.x + half)),
        min(image_height, int(candidate.y + half)),
    )


def build_candidate_contact_sheet(
    image: Image.Image,
    candidates: list[PlacementCandidate],
    *,
    padding: float = 2.75,
) -> Image.Image:
    """Render numbered candidate crops for the vision scorer."""
    rows = (len(candidates) + CONTACT_COLUMNS - 1) // CONTACT_COLUMNS
    sheet = Image.new(
        "RGB",
        (CONTACT_COLUMNS * CONTACT_CELL_SIZE, rows * (CONTACT_CELL_SIZE + CONTACT_LABEL_HEIGHT)),
        (18, 18, 18),
    )
    draw = ImageDraw.Draw(sheet)
    image_width, image_height = image.size

    for index, candidate in enumerate(candidates):
        col = index % CONTACT_COLUMNS
        row = index // CONTACT_COLUMNS
        origin_x = col * CONTACT_CELL_SIZE
        origin_y = row * (CONTACT_CELL_SIZE + CONTACT_LABEL_HEIGHT)
        box = _crop_box(candidate, image_width, image_height, padding)
        crop = image.crop(box).convert("RGB")
        crop = ImageOps.contain(crop, (CONTACT_CELL_SIZE, CONTACT_CELL_SIZE), Image.Resampling.LANCZOS)
        paste_x = origin_x + (CONTACT_CELL_SIZE - crop.width) // 2
        paste_y = origin_y + CONTACT_LABEL_HEIGHT + (CONTACT_CELL_SIZE - crop.height) // 2
        sheet.paste(crop, (paste_x, paste_y))

        scale_x = crop.width / max(1, box[2] - box[0])
        scale_y = crop.height / max(1, box[3] - box[1])
        circle_x = paste_x + (candidate.x - box[0]) * scale_x
        circle_y = paste_y + (candidate.y - box[1]) * scale_y
        circle_r = max(5, candidate.r * min(scale_x, scale_y))
        draw.ellipse(
            (circle_x - circle_r, circle_y - circle_r, circle_x + circle_r, circle_y + circle_r),
            outline=(255, 80, 210),
            width=3,
        )
        draw.rectangle((origin_x, origin_y, origin_x + CONTACT_CELL_SIZE, origin_y + CONTACT_LABEL_HEIGHT), fill=(0, 0, 0))
        draw.text((origin_x + 8, origin_y + 6), f"#{candidate.id}  x={candidate.x} y={candidate.y}", fill=(255, 255, 255))
        crop.close()

    return sheet


def _score_system_prompt(entity_label: str, n: int) -> str:
    return (
        "You are a mobile hidden-object level designer reviewing numbered candidate crops. "
        f"The author wants to hide {n} small {entity_label} objects in the full scene. "
        "Score each numbered crop for whether its magenta circle marks a plausible hidden-object location.\n\n"
        "High scores: the circle center is on a plausible walkable/contact surface or open gap next to props, with nearby clutter for partial occlusion; good examples include ground beside crates, under stall edges, beside plants, or near furniture without occupying the solid object itself.\n"
        "Low scores: the circle center is inside or on top of a solid object, wall, building face, roof, cart body, crate/barrel mass, canal/water, blank sky, impossible floating position, HUD/ad/crop danger zone, or visually exhausting noise. Near an object is good; inside the object is bad.\n"
        "Return JSON only. Include every visible candidate id with score 0-100 and a brief reason."
    )


def score_candidates_with_vision(
    image: Image.Image,
    candidates: list[PlacementCandidate],
    *,
    entity_label: str,
    n: int,
    model: str = SMART_PLACEMENT_MODEL,
    padding: float = 2.75,
) -> list[CandidateScore]:
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    from merceka_core.llm import LLM

    llm = LLM(
        model_name=f"openrouter/{model}",
        system_prompt=_score_system_prompt(entity_label, n),
        output_schema=CandidateScoreResponse,
    )
    # Contact sheets are built SERIALLY in this thread: PIL images decode
    # lazily and concurrent crop() on the same Image corrupts the shared
    # decode stream (observed live: "broken PNG file"). Only the provider
    # round-trips are parallelized.
    chunk_sheets: list[tuple[int, int, Path]] = []
    for start in range(0, len(candidates), SCORING_CHUNK_SIZE):
        chunk = candidates[start:start + SCORING_CHUNK_SIZE]
        sheet = build_candidate_contact_sheet(image, chunk, padding=padding)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            sheet.save(f, format="PNG")
            chunk_sheets.append((start, len(chunk), Path(f.name)))
        sheet.close()

    raw_llm = LLM(
        model_name=f"openrouter/{model}",
        system_prompt=_score_system_prompt(entity_label, n),
        output_schema=None,
    )

    def _score_chunk(chunk_len: int, tmp_path: Path) -> list[CandidateScore]:
        prompt = "Score the numbered candidate crops for plausible hidden-object placement. Return all ids."
        try:
            response = llm.generate_with_resource(
                prompt,
                resource_path=tmp_path,
                temperature=0.0,
                max_tokens=max(1200, min(4000, chunk_len * 90)),
            )
            return list(response.candidates)
        except ValidationError:
            # The structured-output mode intermittently returns an envelope
            # instead of the schema (live 2026-08-13). Raw mode + fenced-JSON
            # parse is reliable — retry the chunk once that way.
            raw = raw_llm.generate_with_resource(
                prompt + " Respond with JSON only: {\"candidates\": [{\"id\", \"score\", \"reason\"}]}.",
                resource_path=tmp_path,
                temperature=0.0,
                max_tokens=max(1200, min(4000, chunk_len * 90)),
            )
            text = str(raw).strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                text = text.removeprefix("json").strip()
            return list(CandidateScoreResponse.model_validate(json.loads(text)).candidates)

    scores: list[CandidateScore] = []
    last_chunk_error: Exception | None = None
    # Chunks are independent; a bounded pool turns N serial vision round-trips
    # into ~1 wall-clock round-trip. Results are collected in start order so
    # scoring stays deterministic.
    from concurrent.futures import ThreadPoolExecutor
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                (start, pool.submit(_score_chunk, chunk_len, tmp_path))
                for start, chunk_len, tmp_path in chunk_sheets
            ]
            for start, future in futures:
                try:
                    scores.extend(future.result())
                except Exception as exc:  # noqa: BLE001
                    # Salvage partial results (fresh-review P3 — ledger 054 #35): a
                    # later chunk failing used to discard the PAID earlier chunks and
                    # fail the whole request. Unscored candidates simply don't rank;
                    # the caller still enforces its selected >= n gate. Only a total
                    # wipeout (no scores at all) surfaces as a failure.
                    last_chunk_error = exc
                    logger.warning(
                        "vision scoring chunk %d failed (%s); continuing with %d scored so far",
                        start, exc, len(scores),
                    )
    finally:
        for _start, _len, tmp_path in chunk_sheets:
            tmp_path.unlink(missing_ok=True)
    if not scores and last_chunk_error is not None:
        raise last_chunk_error
    return scores


def smart_place_hitboxes(
    *,
    image_path: Path,
    n: int,
    radius: int,
    forbidden: list[Rect],
    seed: int,
    entity_label: str,
    candidate_count: int = DEFAULT_CANDIDATE_COUNT,
    padding: float = 2.75,
) -> list[ScoredPlacementCandidate]:
    """Return smart hitboxes selected from vision-scored candidate crops."""
    with Image.open(image_path) as src:
        src.load()
        image = src.convert("RGB")
    try:
        width, height = image.size
        candidates = generate_geometry_safe_candidates(
            width=width,
            height=height,
            radius=radius,
            forbidden=forbidden,
            seed=seed,
            # Floor of 2 alternatives per requested hitbox; the old n*4 floor
            # silently ballooned a 16-bird level to 64 candidates and doubled
            # the paid scoring calls past the declared default of 36.
            count=max(candidate_count, n * 2),
            padding=padding,
        )
        if len(candidates) < n:
            raise RuntimeError(f"Only found {len(candidates)} geometry-safe candidate spots for {n} hitboxes")
        scores = score_candidates_with_vision(
            image,
            candidates,
            entity_label=entity_label,
            n=n,
            padding=padding,
        )
        selected = select_scored_candidates(
            candidates=candidates,
            scores=scores,
            n=n,
            forbidden=forbidden,
            padding=padding,
        )
        if len(selected) < n:
            raise RuntimeError(f"Only selected {len(selected)} non-overlapping smart hitboxes for {n} requested")
        return selected
    finally:
        image.close()


def hitbox_payload(candidates: list[ScoredPlacementCandidate]) -> list[dict[str, int]]:
    return [{"x": item.x, "y": item.y, "r": item.r} for item in candidates]


def metadata_payload(candidates: list[ScoredPlacementCandidate]) -> list[dict[str, int | str]]:
    return [
        {
            "candidateId": item.id,
            "x": item.x,
            "y": item.y,
            "r": item.r,
            "score": item.score,
            "reason": item.reason,
            "source": "vision_scored_candidate",
        }
        for item in candidates
    ]
