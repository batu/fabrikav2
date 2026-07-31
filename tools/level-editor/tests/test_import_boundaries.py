"""The fork is self-contained: no module may import the fabrika packages it
was forked from. The vendored copies under `levelbuilder.*` are the only
allowed source for prompts/hitboxes/image-ops/sections."""

from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = ("dog_pipeline", "fabrika.games")


def test_no_fabrika_imports() -> None:
    offenders: list[str] = []
    for path in (TOOL_ROOT / "levelbuilder").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN:
            for line_no, line in enumerate(text.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith(("import ", "from ")) and token in stripped:
                    offenders.append(f"{path.relative_to(TOOL_ROOT)}:{line_no}: {stripped}")
    assert not offenders, "forbidden fabrika imports:\n" + "\n".join(offenders)


def test_remote_config_publisher_disabled() -> None:
    from levelbuilder.api import routes
    from levelbuilder.api.remote_config_publisher import (
        DisabledRemoteConfigPublisher,
        RemoteConfigPublishUnavailable,
    )

    assert routes.REMOTE_CONFIG_PUBLISHER_FACTORY is DisabledRemoteConfigPublisher
    publisher = DisabledRemoteConfigPublisher()
    assert publisher.status()["mode"] == "disabled"
    try:
        publisher.publish_sequence(raw_payload="{}", sha256_hex="0", request_metadata={})
    except RemoteConfigPublishUnavailable:
        pass
    else:
        raise AssertionError("publish_sequence must raise in the fork")
