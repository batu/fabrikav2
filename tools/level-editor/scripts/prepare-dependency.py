"""Reproduce the editor's existing local merceka-core attribution dependency.

Public core ccba881 lacks local commit 927f3f5 (costs.attribution), which the
editor already requires. Apply exactly that costs.py delta in this gate's own
venv; never touch the developer's editable sibling. Remove when upstream ships
the attribution API. Both source states and the installed Git revision are pinned.
"""
import hashlib
import importlib.metadata
import json
import os
import sys
from pathlib import Path

REVISION = "ccba881b3b1367fbb72ec1119a1bc553e09cc848"
BEFORE_SHA256 = "966f7cb2049db5626f7e34a8630a58bd22a281f7971f5f98eb8aedf65d8d4e85"
AFTER_SHA256 = "e48540c1dcd0569bd0bdfe7ee54cd83390da27c9de859699a299b59af445da34"

CONTEXT_VAR = '''import contextvars

_attribution_var: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
  "merceka_cost_attribution", default=None,
)


'''
ATTRIBUTION = '''def attribution(meta: dict):
  """Context manager: every cost recorded inside the block carries `meta`
  (merged under the record's own meta). Lets callers attribute provider
  spend to a session/bird/operation without threading parameters through
  every image-API signature."""
  import contextlib

  @contextlib.contextmanager
  def _ctx():
    token = _attribution_var.set({**(_attribution_var.get() or {}), **meta})
    try:
      yield
    finally:
      _attribution_var.reset(token)
  return _ctx()


'''


def corrected_source(source: bytes) -> bytes:
    digest = hashlib.sha256(source).hexdigest()
    if digest == AFTER_SHA256:
        return source
    if digest != BEFORE_SHA256:
        raise RuntimeError("merceka-core costs.py drifted; review dependency correction before proceeding")
    text = source.decode()
    text = text.replace("def _usd_from_rates(", CONTEXT_VAR + "def _usd_from_rates(", 1)
    text = text.replace("def record(\n", ATTRIBUTION + "def record(\n", 1)
    text = text.replace('    if meta:\n      row["meta"] = meta', '    ambient = _attribution_var.get()\n    merged = {**(ambient or {}), **(meta or {})}\n    if merged:\n      row["meta"] = merged', 1)
    result = text.encode()
    if hashlib.sha256(result).hexdigest() != AFTER_SHA256:
        raise RuntimeError("merceka-core correction did not produce the exact approved source")
    return result


def main() -> None:
    output = os.environ.get("EDITOR2_VERIFY_DIR")
    if not output or Path(sys.prefix).resolve() != (Path(output) / "venv").resolve():
        raise RuntimeError("dependency correction requires the editor gate's isolated venv")
    dist = importlib.metadata.distribution("merceka-core")
    provenance = json.loads(dist.read_text("direct_url.json") or "{}")
    if dist.version != "0.1.0" or provenance.get("vcs_info", {}).get("commit_id") != REVISION:
        raise RuntimeError("merceka-core version/revision mismatch; refusing dependency correction")
    target = Path(dist.locate_file("merceka_core/costs.py")).resolve()
    if not target.is_relative_to(Path(sys.prefix).resolve()):
        raise RuntimeError("refusing to modify an editable or external merceka-core checkout")
    source = target.read_bytes()
    patched = corrected_source(source)
    if source != patched:
        target.write_bytes(patched)
    print(f"merceka-core attribution: verified {AFTER_SHA256}")


if __name__ == "__main__":
    main()
