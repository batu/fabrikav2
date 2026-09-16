"""Out-of-process Extract All for FTB intake sessions (2026-09-16).

Runs the editor's own bulk_extract job body (inpaint._run_bulk_extract_job) directly in
this process, so the code and env are the ones on the checked-out branch rather than
whatever the long-running backend loaded at start. Session writes go through the same
canonical commit lock, so the backend can stay up.

Usage:
  set -a; source ~/dev/appletolye/.env; set +a
  LEVEL_EDITOR_GAME=find_the_bird FTD_FLATKEY_MODEL=openai/gpt-image-2.5-sunburst \
  FTD_FLATKEY_QUALITY=low FTD_FLATKEY_OCCLUSION=visible FTD_SPRITE_WORKERS=5 \
  uv run --project tools/level-editor python docs/solutions/<this dir>/extract_all.py <session_id>...

Stale single-call staging (.canonical/staging/singles) is moved aside, never deleted, so
old-keying cutouts are not silently reused.
"""
import hashlib, json, os, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "level-editor"))
os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
for key in ("FTD_FLATKEY_MODEL", "FTD_FLATKEY_QUALITY", "FTD_FLATKEY_OCCLUSION"):
    print(f"{key}={os.environ.get(key)}", file=sys.stderr)

from levelbuilder.api import inpaint as I  # noqa: E402
from levelbuilder.api import session as S  # noqa: E402
from levelbuilder.api.job_store import JobRecord  # noqa: E402

STAMP = "2026-09-16"


def run(session_id: str) -> dict:
    sdir = S.session_dir(session_id)
    singles = sdir / ".canonical" / "staging" / "singles"
    if os.environ.get("FORCE","1")=="1" and singles.is_dir() and any(singles.iterdir()):
        aside = singles.with_name(f"singles_pre_intake_{STAMP}")
        n = 0
        while aside.exists():
            n += 1
            aside = singles.with_name(f"singles_pre_intake_{STAMP}_{n}")
        singles.rename(aside)
        print(f"{session_id}: moved stale staging -> {aside.name}", file=sys.stderr)
    hb_path = sdir / "hitboxes.json"
    hb_sha = hashlib.sha256(hb_path.read_bytes()).hexdigest()
    now = S.now_iso()
    job = JobRecord(
        id=f"oop-{session_id[:16]}-{int(time.time())}", parent_job_id=None, kind="bulk_extract",
        session_id=session_id, idempotency_key=None, input_hash=None, status="running", stage=None,
        retryable=False, error_code=None, error_message=None,
        metadata={"force": os.environ.get("FORCE","1")=="1", "padFactor": 1.6, "safeToRequeue": False, "hitboxesSha": hb_sha},
        result={}, worker_owner="extract_all.py", heartbeat_at=now, created_at=now, updated_at=now,
        completed_at=None,
    )
    t0 = time.time()
    result = I._run_bulk_extract_job(job, None)
    dt = time.time() - t0
    out = {"sessionId": session_id, "seconds": round(dt, 1), "result": result}
    odir = sdir / f"intake_{STAMP}"
    odir.mkdir(exist_ok=True)
    (odir / "extract_result.json").write_text(json.dumps(out, indent=1, default=str))
    return out


if __name__ == "__main__":
    for sid in sys.argv[1:]:
        try:
            out = run(sid)
            r = out["result"]
            summary = {k: v for k, v in r.items() if not isinstance(v, (list, dict))}
            print(json.dumps({"sessionId": sid, "seconds": out["seconds"], **summary}), flush=True)
        except Exception as exc:  # keep the batch going; the failure is in the log
            print(json.dumps({"sessionId": sid, "error": f"{type(exc).__name__}: {exc}"}), flush=True)
