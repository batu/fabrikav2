"""Comparison clone ids are `<base>__cmp_<mode>`; with a descriptive scene slug
the base alone approaches 64 chars, and the 64-cap regex 400'd every API read
of `__cmp_magenta` / `__cmp_crop_reference` clones while their files sat
perfectly healthy on disk (live, 2026-07-29). The validators must accept any
id the tool itself can mint."""

LONG_BASE = "pirate_shipwreck_island_treasure_cove_camp_bird_93f3"


def test_validators_accept_comparison_clone_ids():
    from levelbuilder.api import inpaint, routes
    from levelbuilder.api.session import _SESSION_ID_RE

    for mode in ("crop", "crop_reference", "magenta"):
        sid = f"{LONG_BASE}__cmp_{mode}"
        assert inpaint.SESSION_ID_RE.match(sid), sid
        assert routes.SESSION_ID_RE.match(sid), sid
        assert _SESSION_ID_RE.match(sid), sid
