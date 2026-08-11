"""Dormant canonical level store for the levelbuilder migration.

This module intentionally mirrors the small SQLite style used by
``job_store.py``: per-call connections, WAL, explicit transactions, frozen
record dataclasses, and JSON columns for structured authoring data. Nothing in
the live editor reads this store yet; the migration will populate it first and
future slices will cut readers over once parity is proven.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, Sequence

from levelbuilder.settings import require_game_from_env

LEVELS_DB_PATH = require_game_from_env().workspace / "state" / "levels.sqlite"
_SCHEMA_LOCK = threading.Lock()
_PUBLIC_DOG_ID_RE = re.compile(r"^dog_\d{2,}$")

LevelStage = Literal["bg_only", "placed", "painted", "complete"]
LevelSourceKind = Literal["live_session", "public_package"]
VALID_LEVEL_STAGES: set[str] = {"bg_only", "placed", "painted", "complete"}
VALID_SOURCE_KINDS: set[str] = {"live_session", "public_package"}


@dataclass(frozen=True)
class LevelInput:
    id: str
    name: str
    width: int
    height: int
    stage: LevelStage
    source_kind: LevelSourceKind
    schema_version: int = 1
    recipe: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    draft_revision: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class DogInput:
    stable_id: str
    public_id: str
    x: int
    y: int
    r: int
    breed: str | None = None
    chosen_generation_id: str | None = None
    bind_provenance: dict[str, Any] = field(default_factory=dict)
    created_at: str | None = None


@dataclass(frozen=True)
class GenerationInput:
    id: str
    dog_stable_id: str
    variant_index: int
    variant_path: str
    box: list[int]
    sprite_path: str | None = None
    sprite_meta: dict[str, Any] = field(default_factory=dict)
    source_content_hash: str | None = None
    created_at: str | None = None


@dataclass(frozen=True)
class LevelRecord:
    id: str
    schema_version: int
    name: str
    stage: LevelStage
    recipe: dict[str, Any]
    tags: list[str]
    width: int
    height: int
    source_kind: LevelSourceKind
    draft_revision: str | None
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class DogRecord:
    stable_id: str
    level_id: str
    public_id: str
    x: int
    y: int
    r: int
    breed: str | None
    chosen_generation_id: str | None
    bind_provenance: dict[str, Any]
    created_at: str


@dataclass(frozen=True)
class GenerationRecord:
    id: str
    dog_stable_id: str
    variant_index: int
    variant_path: str
    box: list[int]
    sprite_path: str | None
    sprite_meta: dict[str, Any]
    source_content_hash: str | None
    created_at: str


@dataclass(frozen=True)
class LevelEvent:
    id: int
    level_id: str
    event_type: str
    message: str | None
    data: dict[str, Any]
    created_at: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dump(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _json_load(value: str | None) -> Any:
    if not value:
        return {}
    return json.loads(value)


def _json_load_dict(value: str | None) -> dict[str, Any]:
    parsed = _json_load(value)
    return parsed if isinstance(parsed, dict) else {}


def _json_load_list(value: str | None) -> list[Any]:
    parsed = _json_load(value)
    return parsed if isinstance(parsed, list) else []


def _row_to_level(row: sqlite3.Row) -> LevelRecord:
    return LevelRecord(
        id=str(row["id"]),
        schema_version=int(row["schema_version"]),
        name=str(row["name"]),
        stage=row["stage"],
        recipe=_json_load_dict(row["recipe_json"]),
        tags=[str(item) for item in _json_load_list(row["tags_json"])],
        width=int(row["width"]),
        height=int(row["height"]),
        source_kind=row["source_kind"],
        draft_revision=row["draft_revision"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _row_to_dog(row: sqlite3.Row) -> DogRecord:
    return DogRecord(
        stable_id=str(row["stable_id"]),
        level_id=str(row["level_id"]),
        public_id=str(row["public_id"]),
        x=int(row["x"]),
        y=int(row["y"]),
        r=int(row["r"]),
        breed=row["breed"],
        chosen_generation_id=row["chosen_generation_id"],
        bind_provenance=_json_load_dict(row["bind_provenance_json"]),
        created_at=str(row["created_at"]),
    )


def _row_to_generation(row: sqlite3.Row) -> GenerationRecord:
    return GenerationRecord(
        id=str(row["id"]),
        dog_stable_id=str(row["dog_stable_id"]),
        variant_index=int(row["variant_index"]),
        variant_path=str(row["variant_path"]),
        box=[int(value) for value in _json_load_list(row["box_json"])],
        sprite_path=row["sprite_path"],
        sprite_meta=_json_load_dict(row["sprite_meta_json"]),
        source_content_hash=row["source_content_hash"],
        created_at=str(row["created_at"]),
    )


def _row_to_event(row: sqlite3.Row) -> LevelEvent:
    return LevelEvent(
        id=int(row["id"]),
        level_id=str(row["level_id"]),
        event_type=str(row["event_type"]),
        message=row["message"],
        data=_json_load_dict(row["data_json"]),
        created_at=str(row["created_at"]),
    )


def _require_unique(values: Sequence[str], label: str) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if duplicates:
        raise ValueError(f"duplicate {label}: {', '.join(sorted(duplicates))}")


def _validate_level_input(level: LevelInput) -> None:
    if not level.id:
        raise ValueError("level id is required")
    if not level.name:
        raise ValueError("level name is required")
    if level.schema_version < 1:
        raise ValueError("schema_version must be >= 1")
    if level.width < 1 or level.height < 1:
        raise ValueError("level width/height must be positive")
    if level.stage not in VALID_LEVEL_STAGES:
        raise ValueError(f"invalid level stage: {level.stage}")
    if level.source_kind not in VALID_SOURCE_KINDS:
        raise ValueError(f"invalid source kind: {level.source_kind}")


def _validate_graph(dogs: Sequence[DogInput], generations: Sequence[GenerationInput]) -> None:
    _require_unique([dog.stable_id for dog in dogs], "stable dog id")
    _require_unique([dog.public_id for dog in dogs], "public dog id")
    _require_unique([generation.id for generation in generations], "generation id")

    dog_ids = {dog.stable_id for dog in dogs}
    generation_owner = {generation.id: generation.dog_stable_id for generation in generations}

    for dog in dogs:
        if not dog.stable_id:
            raise ValueError("dog stable_id is required")
        if not _PUBLIC_DOG_ID_RE.match(dog.public_id):
            raise ValueError(f"invalid public dog id: {dog.public_id}")
        if dog.r < 1:
            raise ValueError(f"dog {dog.public_id} radius must be positive")
        if dog.chosen_generation_id is not None:
            owner = generation_owner.get(dog.chosen_generation_id)
            if owner != dog.stable_id:
                raise ValueError(
                    f"chosen generation {dog.chosen_generation_id} does not belong to {dog.public_id}"
                )

    for generation in generations:
        if not generation.id:
            raise ValueError("generation id is required")
        if generation.dog_stable_id not in dog_ids:
            raise ValueError(f"generation {generation.id} references unknown dog {generation.dog_stable_id}")
        if generation.variant_index < 0:
            raise ValueError(f"generation {generation.id} variant_index must be >= 0")
        if not generation.variant_path:
            raise ValueError(f"generation {generation.id} variant_path is required")
        if len(generation.box) != 4:
            raise ValueError(f"generation {generation.id} box must have four coordinates")


class LevelStore:
    def __init__(self, db_path: Path = LEVELS_DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()

    def initialize(self) -> None:
        with _SCHEMA_LOCK:
            with self.connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS levels (
                        id TEXT PRIMARY KEY,
                        schema_version INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        recipe_json TEXT NOT NULL DEFAULT '{}',
                        tags_json TEXT NOT NULL DEFAULT '[]',
                        width INTEGER NOT NULL,
                        height INTEGER NOT NULL,
                        source_kind TEXT NOT NULL,
                        draft_revision TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS dogs (
                        stable_id TEXT PRIMARY KEY,
                        level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
                        public_id TEXT NOT NULL,
                        x INTEGER NOT NULL,
                        y INTEGER NOT NULL,
                        r INTEGER NOT NULL,
                        breed TEXT,
                        chosen_generation_id TEXT,
                        bind_provenance_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL,
                        UNIQUE(level_id, public_id),
                        FOREIGN KEY(chosen_generation_id)
                            REFERENCES generations(id)
                            ON DELETE SET NULL
                            DEFERRABLE INITIALLY DEFERRED
                    );
                    CREATE INDEX IF NOT EXISTS idx_dogs_level_public
                        ON dogs(level_id, public_id);

                    CREATE TABLE IF NOT EXISTS generations (
                        id TEXT PRIMARY KEY,
                        dog_stable_id TEXT NOT NULL REFERENCES dogs(stable_id) ON DELETE CASCADE,
                        variant_index INTEGER NOT NULL,
                        variant_path TEXT NOT NULL,
                        box_json TEXT NOT NULL,
                        sprite_path TEXT,
                        sprite_meta_json TEXT NOT NULL DEFAULT '{}',
                        source_content_hash TEXT,
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_generations_dog_variant
                        ON generations(dog_stable_id, variant_index);

                    CREATE TABLE IF NOT EXISTS level_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
                        event_type TEXT NOT NULL,
                        message TEXT,
                        data_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_level_events_level_id_id
                        ON level_events(level_id, id);
                    """
                )

    def replace_level(
        self,
        *,
        level: LevelInput,
        dogs: Sequence[DogInput],
        generations: Sequence[GenerationInput] = (),
    ) -> LevelRecord:
        _validate_level_input(level)
        _validate_graph(dogs, generations)
        now = utc_now_iso()
        level_created_at = level.created_at or now
        level_updated_at = level.updated_at or level_created_at
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM levels WHERE id = ?", (level.id,))
            conn.execute(
                """
                INSERT INTO levels (
                    id, schema_version, name, stage, recipe_json, tags_json,
                    width, height, source_kind, draft_revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    level.id,
                    level.schema_version,
                    level.name,
                    level.stage,
                    _json_dump(level.recipe),
                    _json_dump(level.tags),
                    level.width,
                    level.height,
                    level.source_kind,
                    level.draft_revision,
                    level_created_at,
                    level_updated_at,
                ),
            )
            for dog in dogs:
                dog_created_at = dog.created_at or level_created_at
                conn.execute(
                    """
                    INSERT INTO dogs (
                        stable_id, level_id, public_id, x, y, r, breed,
                        chosen_generation_id, bind_provenance_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dog.stable_id,
                        level.id,
                        dog.public_id,
                        dog.x,
                        dog.y,
                        dog.r,
                        dog.breed,
                        dog.chosen_generation_id,
                        _json_dump(dog.bind_provenance),
                        dog_created_at,
                    ),
                )
            for generation in generations:
                generation_created_at = generation.created_at or level_created_at
                conn.execute(
                    """
                    INSERT INTO generations (
                        id, dog_stable_id, variant_index, variant_path, box_json,
                        sprite_path, sprite_meta_json, source_content_hash, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        generation.id,
                        generation.dog_stable_id,
                        generation.variant_index,
                        generation.variant_path,
                        _json_dump(generation.box),
                        generation.sprite_path,
                        _json_dump(generation.sprite_meta),
                        generation.source_content_hash,
                        generation_created_at,
                    ),
                )
            conn.execute(
                """
                INSERT INTO level_events (level_id, event_type, message, data_json, created_at)
                VALUES (?, 'level.replaced', NULL, ?, ?)
                """,
                (
                    level.id,
                    _json_dump({"dogs": len(dogs), "generations": len(generations)}),
                    level_updated_at,
                ),
            )
            row = conn.execute("SELECT * FROM levels WHERE id = ?", (level.id,)).fetchone()
            conn.execute("COMMIT")
        return _row_to_level(row)

    def get_level(self, level_id: str) -> LevelRecord | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM levels WHERE id = ?", (level_id,)).fetchone()
        return _row_to_level(row) if row is not None else None

    def list_levels(self) -> list[LevelRecord]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM levels ORDER BY id").fetchall()
        return [_row_to_level(row) for row in rows]

    def list_dogs(self, level_id: str) -> list[DogRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM dogs WHERE level_id = ? ORDER BY public_id",
                (level_id,),
            ).fetchall()
        return [_row_to_dog(row) for row in rows]

    def list_generations(self, dog_stable_id: str) -> list[GenerationRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM generations WHERE dog_stable_id = ? ORDER BY variant_index, id",
                (dog_stable_id,),
            ).fetchall()
        return [_row_to_generation(row) for row in rows]

    def get_generation(self, generation_id: str) -> GenerationRecord | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM generations WHERE id = ?", (generation_id,)).fetchone()
        return _row_to_generation(row) if row is not None else None

    def list_events(self, level_id: str, *, after_id: int = 0) -> list[LevelEvent]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM level_events
                WHERE level_id = ? AND id > ?
                ORDER BY id
                """,
                (level_id, after_id),
            ).fetchall()
        return [_row_to_event(row) for row in rows]
