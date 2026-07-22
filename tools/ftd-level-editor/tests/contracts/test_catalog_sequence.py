from __future__ import annotations

import pytest

from ftd_editor.publishing.catalog import validate_catalog
from ftd_editor.publishing.sequence import validate_sequence


def catalog() -> dict:
    return {
        "catalogRevision": "catalog-1",
        "levels": [
            {
                "id": "starter",
                "packageId": "starter:sha256-a",
                "listable": True,
                "bundledInApp": True,
                "cohortBuckets": ["all"],
                "tombstonedAt": None,
                "retention": {
                    "activeSequenceVersions": ["seq-1"],
                    "rollbackEligibleSequenceVersions": [],
                },
            },
            {
                "id": "later",
                "packageId": "later:sha256-b",
                "listable": True,
                "bundledInApp": False,
                "cohortBuckets": [[0, 49]],
                "tombstonedAt": None,
                "retention": {
                    "activeSequenceVersions": ["seq-1"],
                    "rollbackEligibleSequenceVersions": ["seq-0"],
                },
            },
        ],
    }


def test_catalog_and_sequence_accept_retention_cohort_and_starter_contracts() -> None:
    manifest = validate_catalog(catalog())
    sequence = validate_sequence(
        {
            "sequenceVersion": "seq-1",
            "catalogRevision": "catalog-1",
            "levelIds": ["starter", "later"],
        },
        catalog=manifest,
        bundled_starter_ids=("starter",),
    )
    assert sequence.level_ids == ("starter", "later")


def test_tombstones_duplicates_and_starter_drift_fail_closed() -> None:
    payload = catalog()
    payload["levels"][1]["tombstonedAt"] = "2026-07-22T00:00:00Z"
    payload["levels"][1]["listable"] = True
    with pytest.raises(ValueError, match="tombstoned"):
        validate_catalog(payload)

    manifest = validate_catalog(catalog())
    with pytest.raises(ValueError, match="duplicate"):
        validate_sequence(
            {
                "sequenceVersion": "seq-2",
                "catalogRevision": "catalog-1",
                "levelIds": ["starter", "starter"],
            },
            catalog=manifest,
            bundled_starter_ids=("starter",),
        )
    with pytest.raises(ValueError, match="starter"):
        validate_sequence(
            {
                "sequenceVersion": "seq-2",
                "catalogRevision": "catalog-1",
                "levelIds": ["later", "starter"],
            },
            catalog=manifest,
            bundled_starter_ids=("starter",),
        )
