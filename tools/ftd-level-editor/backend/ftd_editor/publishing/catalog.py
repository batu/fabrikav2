"""FTD catalog validation: immutable packages, cohorts, tombstones, retention."""

from __future__ import annotations

import hashlib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Retention(BaseModel):
    model_config = ConfigDict(extra="ignore")

    active_sequence_versions: tuple[str, ...] = Field(alias="activeSequenceVersions")
    rollback_eligible_sequence_versions: tuple[str, ...] = Field(
        alias="rollbackEligibleSequenceVersions"
    )


class PackageAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    path: str = Field(min_length=1)
    size: int = Field(ge=0)
    hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class PackageRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")

    complete: bool
    required_bytes: int = Field(alias="requiredBytes", ge=0)
    required_assets: tuple[PackageAsset, ...] = Field(alias="requiredAssets", min_length=1)

    @model_validator(mode="after")
    def valid_total(self):
        if not self.complete:
            raise ValueError("catalog package must be complete")
        paths = [asset.path for asset in self.required_assets]
        if len(paths) != len(set(paths)):
            raise ValueError("catalog package contains duplicate required asset paths")
        if sum(asset.size for asset in self.required_assets) != self.required_bytes:
            raise ValueError("catalog package required byte total is inconsistent")
        return self


class CatalogLevel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level_id: str = Field(alias="id", min_length=1)
    package_id: str = Field(alias="packageId", min_length=1)
    listable: bool
    bundled_in_app: bool = Field(alias="bundledInApp")
    cohort_buckets: tuple[str | tuple[int, int], ...] = Field(alias="cohortBuckets")
    tombstoned_at: str | None = Field(alias="tombstonedAt")
    retention: Retention
    package: PackageRecord | None = None

    @model_validator(mode="after")
    def valid_visibility(self):
        if self.tombstoned_at is not None and self.listable:
            raise ValueError(f"tombstoned level {self.level_id} cannot remain listable")
        if not self.cohort_buckets:
            raise ValueError(f"level {self.level_id} requires a cohort")
        if "all" in self.cohort_buckets and len(self.cohort_buckets) != 1:
            raise ValueError(f"level {self.level_id} mixes all with ranged cohorts")
        for bucket in self.cohort_buckets:
            if bucket == "all":
                continue
            if len(bucket) != 2 or bucket[0] < 0 or bucket[1] > 99 or bucket[0] > bucket[1]:
                raise ValueError(f"level {self.level_id} has an invalid cohort range")
        return self


class CatalogManifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    catalog_revision: str = Field(alias="catalogRevision", min_length=1)
    levels: tuple[CatalogLevel, ...]

    @model_validator(mode="after")
    def unique_levels(self):
        ids = [level.level_id for level in self.levels]
        if len(ids) != len(set(ids)):
            raise ValueError("catalog contains duplicate level ids")
        packages = [level.package_id for level in self.levels]
        if len(packages) != len(set(packages)):
            raise ValueError("catalog contains duplicate immutable package ids")
        return self


def validate_catalog(value: dict) -> CatalogManifest:
    return CatalogManifest.model_validate(value)


def verify_catalog_assets(manifest: CatalogManifest, public_root: Path) -> None:
    """Verify every catalog-declared required byte before selection or CI succeeds."""

    root = public_root.resolve(strict=True)
    for level in manifest.levels:
        if level.package is None:
            raise ValueError(f"catalog level {level.level_id} has no package asset record")
        total = 0
        for asset in level.package.required_assets:
            relative = Path(asset.path)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"catalog asset path escapes public root: {asset.path}")
            path = root.joinpath(relative)
            try:
                resolved = path.resolve(strict=True)
            except FileNotFoundError as error:
                raise ValueError(f"catalog asset is missing: {asset.path}") from error
            current = root
            traverses_symlink = False
            for part in relative.parts:
                current /= part
                traverses_symlink = traverses_symlink or current.is_symlink()
            if (
                not resolved.is_relative_to(root)
                or traverses_symlink
                or not path.is_file()
            ):
                raise ValueError(f"catalog asset is not a regular public file: {asset.path}")
            content = path.read_bytes()
            if len(content) != asset.size:
                raise ValueError(f"catalog asset size mismatch: {asset.path}")
            if hashlib.sha256(content).hexdigest() != asset.hash:
                raise ValueError(f"catalog asset hash mismatch: {asset.path}")
            total += len(content)
        if total != level.package.required_bytes:
            raise ValueError(f"catalog package byte total mismatch: {level.level_id}")
