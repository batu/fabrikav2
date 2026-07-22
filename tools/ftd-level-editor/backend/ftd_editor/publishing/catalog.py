"""FTD catalog validation: immutable packages, cohorts, tombstones, retention."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Retention(BaseModel):
    model_config = ConfigDict(extra="ignore")

    active_sequence_versions: tuple[str, ...] = Field(alias="activeSequenceVersions")
    rollback_eligible_sequence_versions: tuple[str, ...] = Field(
        alias="rollbackEligibleSequenceVersions"
    )


class CatalogLevel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level_id: str = Field(alias="id", min_length=1)
    package_id: str = Field(alias="packageId", min_length=1)
    listable: bool
    bundled_in_app: bool = Field(alias="bundledInApp")
    cohort_buckets: tuple[str | tuple[int, int], ...] = Field(alias="cohortBuckets")
    tombstoned_at: str | None = Field(alias="tombstonedAt")
    retention: Retention

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
