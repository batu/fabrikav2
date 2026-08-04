"""Agentic CLI for the level editor.

A thin httpx client over the same HTTP API the wizard UI uses (KTD2): one
server, two clients, one live session store. Every verb supports `--json`
(stable machine-readable output, KTD8) and exits non-zero on failure with
`{"error": {"code", "stage", "message"}}` in json mode.

Parity contract: WIZARD_OPERATIONS maps each wizard-reachable operation to the
verb that covers it; `tests/test_cli_parity.py` guards drift.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

DEFAULT_URL = os.environ.get("LEVEL_EDITOR_URL", "http://127.0.0.1:5192")

# Wizard-operation inventory (curated; the parity claim). Keys are operations a
# human can perform in the UI; values are the CLI verb that covers them.
WIZARD_OPERATIONS: dict[str, str] = {
    "config": "config",
    "assemble-recipe-prompts": "create",
    "create-session": "create",
    "list-sessions": "sessions",
    "get-session": "session",
    "background-generation-job": "generate-bg",
    "select-background": "select-bg",
    "upscale-background-job": "upscale",
    "auto-hitboxes": "auto-hitboxes",
    "save-hitboxes": "set-hitboxes",
    "visibility-check": "visibility-check",
    "inpaint-job": "inpaint",
    "retry-failed-dogs-job": "inpaint",
    "single-dog-regenerate": "regenerate",
    "dog-set-active-variant": "dogs",
    "dog-delete": "dogs",
    "list-jobs": "jobs",
    "get-job": "job",
    "sequence-state": "export",
    "sequence-draft": "export",
    "sequence-dry-run": "export",
    "sequence-start-job": "export",
    "session-archive": "archive",
    "approve-catalog": "approve",
    "sprite-gaps": "repair-sprites",
    "compare-inpaint": "compare",
    "bundle-starter": "export",
    "prompt-library": "prompts",
    "generation-status": "status",
}

# Endpoints that write session.json. Catalog/bundle/sequence calls legitimately
# leave the session untouched, so warning on them is a false alarm.
SESSION_MUTATING_SUFFIXES = (
    "hitboxes", "select-bg", "fix-hitboxes", "recomposite", "archive",
    "active", "regen", "extension/accept", "extension/clear",
)

TERMINAL_JOB_STATUSES = {
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancelled",
}


class CliError(Exception):
    def __init__(self, code: str, message: str, stage: str = "cli", context: dict | None = None) -> None:
        self.code = code
        self.stage = stage
        self.message = message
        # Extra operator-facing state (e.g. the session id you already paid
        # for, and how to resume) merged into the single error envelope.
        self.context = context or {}
        super().__init__(message)


class Client:
    def __init__(self, base_url: str, token: str | None) -> None:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        # Sync endpoints legitimately run minutes (smart hitbox vision scoring,
        # 4x lanczos upscale of a 4K canvas); 60s produced spurious
        # transport_error failures mid-author.
        self._http = httpx.Client(base_url=base_url, headers=headers, timeout=600.0)
        self.base_url = base_url
        self.last_session_revision: str | None = None

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.ConnectError as error:
            raise CliError(
                "server_unreachable",
                f"cannot reach {self.base_url} — start it with `level-editor serve`",
            ) from error
        if response.status_code >= 400:
            detail: Any
            try:
                detail = response.json()
            except ValueError:
                detail = response.text[:500]
            raise CliError(
                f"http_{response.status_code}",
                json.dumps(detail) if not isinstance(detail, str) else detail,
                stage=f"{method} {path}",
            )
        revision = response.headers.get("X-Session-Revision")
        if revision:
            if (
                method in ("POST", "PATCH", "DELETE", "PUT")
                and any(path.endswith(suffix) or f"/{suffix}/" in path for suffix in SESSION_MUTATING_SUFFIXES)
                and self.last_session_revision
                and revision == self.last_session_revision
            ):
                print(
                    "warning: session revision unchanged after mutation — another actor may have raced this write",
                    file=sys.stderr,
                )
            self.last_session_revision = revision
        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
        return response.content

    def get(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> Any:
        return self.request("POST", path, **kw)


def _emit(args: argparse.Namespace, payload: Any) -> None:
    if getattr(args, "json", False):
        print(json.dumps(payload, indent=2, default=str))
    else:
        if isinstance(payload, (dict, list)):
            print(json.dumps(payload, indent=2, default=str))
        else:
            print(payload)


def _wait_for_job(client: Client, job_id: str | None, *, timeout_s: float, quiet: bool) -> dict:
    if not job_id:
        raise CliError("job_id_missing", "server response carried no job id", stage="wait")
    deadline = time.monotonic() + timeout_s
    last_status = None
    transient_failures = 0
    while True:
        try:
            job = client.get(f"/api/jobs/{job_id}")
        except (httpx.TransportError, CliError) as error:
            if isinstance(error, CliError) and error.code.startswith("http_4"):
                raise
            transient_failures += 1
            if transient_failures > 30:
                raise CliError("poll_unreachable", f"lost the server while waiting on job {job_id}: {error}", stage="wait") from error
            time.sleep(4.0)
            continue
        transient_failures = 0
        status = job.get("status")
        if status != last_status and not quiet:
            print(f"job {job_id}: {status}", file=sys.stderr)
            last_status = status
        if status in TERMINAL_JOB_STATUSES:
            return job
        if time.monotonic() > deadline:
            raise CliError(
                "wait_timeout",
                f"job {job_id} still {status!r} after {timeout_s:.0f}s — resume with `level-editor job {job_id}`",
                stage="wait",
            )
        time.sleep(2.0)


def _require_success(job: dict) -> dict:
    if job.get("status") != "succeeded":
        raise CliError(
            job.get("errorCode") or "job_failed",
            job.get("errorMessage") or f"job ended {job.get('status')!r}",
            stage=job.get("stage") or job.get("kind") or "job",
        )
    return job


def _session_recipe(session: dict) -> dict:
    return {
        "setting": session.get("setting") or "",
        "scene": session.get("scene") or "",
        "entity": session.get("entity") or "dog",
        "view": session.get("view") or "isometric",
        "style": session.get("style") or "",
        **({"scale": session["scale"]} if session.get("scale") else {}),
    }


# ── verbs ────────────────────────────────────────────────────────────────────


DISK_FLOOR_GIB = float(os.environ.get("LEVEL_EDITOR_DISK_FLOOR_GIB", "5"))


def _check_disk(force: bool) -> None:
    import shutil as _shutil

    free_gib = _shutil.disk_usage(Path.cwd()).free / 2**30
    if free_gib < DISK_FLOOR_GIB and not force:
        raise CliError(
            "disk_floor",
            f"only {free_gib:.1f} GiB free (< {DISK_FLOOR_GIB:.0f} GiB floor); "
            "clear space or pass --force-disk",
            stage="preflight",
        )


def cmd_serve(args: argparse.Namespace) -> None:
    argv = [sys.executable, "-m", "levelbuilder.api.server", "--port", str(args.port)]
    if args.game:
        argv += ["--game", args.game]
    os.execv(sys.executable, argv)


def cmd_doctor(args: argparse.Namespace) -> None:
    """Server-free workspace census: orphaned sessions, stuck jobs, stale
    locks, disk usage. Reports; never mutates."""
    import shutil as _shutil
    import sqlite3

    from levelbuilder.settings import resolve_game

    profile = resolve_game(args.game)
    workspace = profile.workspace
    report: dict[str, Any] = {"game": profile.name, "workspace": str(workspace)}
    levels = workspace / "levels"
    orphaned = [
        d.name for d in sorted(levels.iterdir())
        if d.is_dir() and not (d / "session.json").is_file()
    ] if levels.is_dir() else []
    report["orphanedSessions"] = orphaned
    stuck: list[dict] = []
    jobs_db = workspace / "state" / "jobs.sqlite"
    if jobs_db.is_file():
        conn = sqlite3.connect(jobs_db)
        try:
            rows = conn.execute(
                "SELECT id, kind, status, updated_at FROM jobs "
                "WHERE status NOT IN ('succeeded','failed_retryable','failed_terminal','orphaned_unknown','cancelled')"
            ).fetchall()
            stuck = [
                {"id": r[0], "kind": r[1], "status": r[2], "updatedAt": r[3]} for r in rows
            ]
        finally:
            conn.close()
    report["nonTerminalJobs"] = stuck
    lock = workspace / "state" / "jobs.worker.lock"
    report["workerLockPresent"] = lock.exists()
    usage = _shutil.disk_usage(workspace if workspace.exists() else Path.cwd())
    report["disk"] = {
        "freeGiB": round(usage.free / 2**30, 1),
        "floorGiB": DISK_FLOOR_GIB,
        "belowFloor": usage.free / 2**30 < DISK_FLOOR_GIB,
    }
    du = 0
    if workspace.exists():
        for f in workspace.rglob("*"):
            if f.is_file():
                du += f.stat().st_size
    report["workspaceSizeGiB"] = round(du / 2**30, 2)
    report["healthy"] = not orphaned and not stuck and not report["disk"]["belowFloor"]
    _emit(args, report)


def cmd_status(client: Client, args: argparse.Namespace) -> None:
    config = client.get("/api/config")
    generation = client.get("/api/generation-status")
    _emit(args, {"server": client.base_url, "game": config.get("game"), "generation": generation})


def cmd_config(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.get("/api/config"))


def cmd_sessions(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.get("/api/sessions"))


def cmd_session(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.get(f"/api/sessions/{args.session_id}"))


def cmd_create(client: Client, args: argparse.Namespace) -> None:
    if args.template:
        config = client.get("/api/config")
        templates = {t["id"]: t for t in config.get("templates", [])}
        if args.template not in templates:
            raise CliError(
                "unknown_template",
                f"template {args.template!r} not found; available: {', '.join(sorted(templates)) or '(none)'}",
            )
        template = templates[args.template]
        recipe = {
            "setting": template["setting"],
            "scene": template["scene"],
            "entity": template["entity"],
            "view": template["view"],
            "style": template["style"],
            "scale": args.scale or template.get("scale") or "none",
        }
        model = template.get("model")
        n_dogs = args.count if args.count is not None else int(template.get("nDogs", 20))
    else:
        required = ["setting", "scene", "style", "view", "entity"]
        missing = [name for name in required if not getattr(args, name.replace("-", "_"), None)]
        if missing:
            raise CliError("missing_axes", f"--template or all of: {', '.join('--' + m for m in missing)}")
        recipe = {
            "setting": args.setting,
            "scene": args.scene,
            "entity": args.entity,
            "view": args.view,
            "style": args.style,
            "scale": args.scale,
        }
        model = args.model
        n_dogs = args.count if args.count is not None else 20
    prompts = client.post("/api/actions/assemble-recipe-prompts", json=recipe)
    body = {
        **recipe,
        "scenePrompt": prompts["scenePrompt"],
        "dogPrompt": prompts["dogPrompt"],
        "bgModel": model or args.model or "google/gemini-3.1-flash-image-preview",
        "inpaintModel": model or args.model or "google/gemini-3.1-flash-image-preview",
        "nDogs": n_dogs,
        "aspectRatio": args.aspect_ratio,
        "imageSize": "1K",
        "oneShot": args.one_shot,
    }
    if args.aspect_ratio == "1:1":
        # Square campaign levels ship at 4096: bake the deterministic upscale
        # policy in at create time so author's upscale step can satisfy the
        # route's session-policy check.
        body.update({
            "upscaleEnabled": True,
            "upscaleModel": "deterministic-lanczos-4x",
            "upscaleTargetLongEdge": 4096,
        })
    created = client.post("/api/sessions", json=body)
    _emit(args, created)


def cmd_generate_bg(client: Client, args: argparse.Namespace) -> None:
    _check_disk(args.force_disk)
    job = client.post(f"/api/sessions/{args.session_id}/background-generation/jobs")
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job.get("jobId") or job.get("id"), timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_select_bg(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(f"/api/sessions/{args.session_id}/select-bg", json={"bgIndex": args.index}))


def cmd_upscale(client: Client, args: argparse.Namespace) -> None:
    _check_disk(args.force_disk)
    job = client.post(f"/api/sessions/{args.session_id}/upscale-bg/jobs")
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job.get("jobId") or job.get("id"), timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_auto_hitboxes(client: Client, args: argparse.Namespace) -> None:
    # Default to the session's own target count so the verb works bare; the
    # server requires nDogs >= 1 and would 422 on None.
    count = args.count
    if count is None:
        session = client.get(f"/api/sessions/{args.session_id}")
        count = int(session.get("nDogs") or len(session.get("hitboxes") or []) or 20)
    # Placement fails closed when it cannot fit `count` non-overlapping
    # hitboxes at the requested radius, and the right radius depends on the
    # scene's density — hand-tuning it (50 -> 26 -> 24) was a papercut on every
    # level. Shrink and retry down to a floor, then report what actually fit.
    if args.shrink_step < 1:
        raise CliError("bad_shrink_step", "--shrink-step must be >= 1 (0 would retry forever)")
    radius = args.radius or 30
    if radius < args.min_radius:
        raise CliError("bad_radius", f"--radius {radius} is below --min-radius {args.min_radius}")
    attempts: list[dict] = []
    while True:
        body = {"nDogs": count, "strategy": args.strategy, "radius": radius}
        try:
            result = client.post(f"/api/sessions/{args.session_id}/auto-hitboxes", json=body)
            placed = len(result.get("hitboxes", []) if isinstance(result, dict) else [])
            if placed < count:
                # The random placer returns 200 with FEWER hitboxes instead of
                # failing, so a partial level would otherwise pass silently.
                raise CliError("placement_partial", f"placed {placed} of {count}", stage="auto-hitboxes")
        except CliError as error:
            if not any(token in error.message or token in error.code
                       for token in ("smart_hitboxes_failed", "non-overlapping", "placement_partial")):
                raise
            attempts.append({"radius": radius, "outcome": "did not fit"})
            radius -= args.shrink_step
            if radius < args.min_radius:
                raise CliError(
                    "placement_did_not_fit",
                    f"could not fit {count} hitboxes down to radius {args.min_radius}; "
                    "lower --count or raise --min-radius",
                    stage="auto-hitboxes",
                ) from error
            continue
        result = dict(result) if isinstance(result, dict) else {"result": result}
        result["radiusUsed"] = radius
        if attempts:
            result["radiusAttempts"] = attempts
        _emit(args, result)
        return


def cmd_set_hitboxes(client: Client, args: argparse.Namespace) -> None:
    hitboxes = json.loads(Path(args.file).read_text())
    _emit(
        args,
        client.post(
            f"/api/sessions/{args.session_id}/hitboxes",
            json={"hitboxes": hitboxes, "action": "edit"},
        ),
    )


def cmd_visibility_check(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.get(f"/api/sessions/{args.session_id}/visibility-check"))


def cmd_inpaint(client: Client, args: argparse.Namespace) -> None:
    _check_disk(args.force_disk)
    session = client.get(f"/api/sessions/{args.session_id}")
    hitboxes = session.get("hitboxes") or []
    if not hitboxes:
        raise CliError("no_hitboxes", "session has no hitboxes; run auto-hitboxes or set-hitboxes first")
    if args.retry_failed:
        job = client.post(f"/api/sessions/{args.session_id}/dogs/retry-inpaint/jobs", json={})
    else:
        if getattr(args, "ring_radius", None):
            if args.mode != "ring":
                raise CliError("invalid_flag", "--ring-radius requires --mode ring")
            hitboxes = [{**hb, "r": int(args.ring_radius)} for hb in hitboxes]
        prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
        body = {
            "hitboxes": hitboxes,
            "dogPrompt": prompts["dogPrompt"],
            "padding": args.padding,
            "hardDogPercent": args.hard_percent,
            "inpaintMode": args.mode,
            "inpaintModel": args.model,
        }
        job = client.post(f"/api/sessions/{args.session_id}/inpaint/jobs", json=body)
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job.get("jobId") or job.get("id"), timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_regenerate(client: Client, args: argparse.Namespace) -> None:
    session = client.get(f"/api/sessions/{args.session_id}")
    prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/dogs/by-id/{args.dog}/regen",
        json={"prompt": prompts["dogPrompt"]},
    ))


def cmd_dogs(client: Client, args: argparse.Namespace) -> None:
    if args.set_active is not None and args.variant is None:
        raise CliError("variant_required", "--set-active requires --variant (activeVariant null means 'no variant')")
    if args.set_active is not None:
        result = client.request(
            "PATCH",
            f"/api/sessions/{args.session_id}/dogs/by-id/{args.set_active}/active",
            json={"activeVariant": args.variant},
        )
    elif args.delete is not None:
        result = client.request(
            "DELETE", f"/api/sessions/{args.session_id}/dogs/by-id/{args.delete}"
        )
    else:
        session = client.get(f"/api/sessions/{args.session_id}")
        result = session.get("dogs") or []
    _emit(args, result)


AUTHOR_STEPS = (
    "create", "generate-bg", "select-bg", "upscale", "auto-hitboxes",
    "inpaint", "repair-sprites", "fix-hitboxes", "export",
)


def cmd_author(client: Client, args: argparse.Namespace) -> None:
    """Run the whole proven authoring flow for one level.

    Every step below was learned the hard way over two sessions; encoding the
    order (and the repair/recenter steps that are easy to forget) means a level
    is one command instead of eight, for a human or an agent. Each step prints
    a progress line to stderr; --stop-after resumes-friendly partial runs.
    """
    steps = list(AUTHOR_STEPS)
    if args.start_from:
        if args.start_from not in steps:
            raise CliError("unknown_step", f"--start-from must be one of: {', '.join(steps)}")
        steps = steps[steps.index(args.start_from):]
    if args.stop_after:
        if args.stop_after not in steps:
            raise CliError("unknown_step", f"--stop-after must be one of: {', '.join(steps)}")
        steps = steps[: steps.index(args.stop_after) + 1]
    if args.dry_run:
        _emit(args, {"plan": steps, "template": args.template, "session": args.session_id})
        return

    _check_disk(args.force_disk)
    trace: list[dict] = []

    def note(step: str, detail: Any) -> None:
        trace.append({"step": step, "detail": detail})
        print(f"[author] {step}: {json.dumps(detail, default=str)[:160]}", file=sys.stderr)

    session_id = None
    # Resume safety: rerunning with --session-id must not redo paid work. The
    # natural recovery action after a partial run is exactly this command, so
    # skipping already-satisfied steps is what keeps it from double-spending.
    session_id = args.session_id
    existing = client.get(f"/api/sessions/{session_id}") if session_id else {}
    already_has_bg = bool(existing.get("backgrounds") or existing.get("selectedBgIndex") is not None)
    already_painted = any(
        isinstance(dog, dict) and dog.get("activeVariant") is not None
        for dog in (existing.get("dogs") or [])
    )

    try:
        for step in steps:
            if step == "generate-bg" and already_has_bg and not args.redo:
                note("generate-bg", {"skipped": "session already has backgrounds (use --redo)"})
                continue
            if step == "inpaint" and already_painted and not args.redo:
                note("inpaint", {"skipped": "dogs already painted (use --redo)"})
                continue
            if step == "auto-hitboxes" and already_painted and not args.redo:
                # Re-placing hitboxes under painted art moves every tap target
                # away from its bird — the export gate then refuses the level.
                note("auto-hitboxes", {"skipped": "session already painted; re-placing would orphan the art"})
                continue
            if step == "create":
                if session_id:
                    note("create", {"reused": session_id})
                    continue
                if not args.template:
                    raise CliError("template_required", "author needs --template or an existing --session-id")
                config = client.get("/api/config")
                template = next((t for t in config.get("templates", []) if t["id"] == args.template), None)
                if template is None:
                    raise CliError("unknown_template", f"no template {args.template!r}")
                recipe = {k: template[k] for k in ("setting", "scene", "entity", "view", "style")}
                prompts = client.post("/api/actions/assemble-recipe-prompts", json=recipe)
                model = template.get("model")
                created = client.post("/api/sessions", json={
                    **recipe,
                    "scenePrompt": prompts["scenePrompt"],
                    "dogPrompt": prompts["dogPrompt"],
                    "bgModel": model,
                    "inpaintModel": model,
                    "nDogs": args.count,
                    "aspectRatio": "9:16",
                    "imageSize": "1K",
                })
                session_id = created["sessionId"]
                note("create", {"sessionId": session_id, "template": args.template})
            elif step == "generate-bg":
                job = client.post(f"/api/sessions/{session_id}/background-generation/jobs")
                job = _require_success(_wait_for_job(client, job.get("jobId") or job.get("id"),
                                                     timeout_s=args.timeout, quiet=True))
                note("generate-bg", {"status": job.get("status")})
            elif step == "select-bg":
                session = client.get(f"/api/sessions/{session_id}")
                current = session.get("selectedBgIndex")
                if current is not None and not args.redo:
                    # Rerun safety: re-selecting index 0 after an upscale
                    # silently downgrades the session back to the 1K original
                    # and everything downstream (hitboxes, paint) runs at the
                    # wrong scale.
                    note("select-bg", {"skipped": f"selection already {current}"})
                else:
                    client.post(f"/api/sessions/{session_id}/select-bg", json={"bgIndex": args.bg_index})
                    note("select-bg", {"index": args.bg_index})
            elif step == "upscale":
                session = client.get(f"/api/sessions/{session_id}")
                bg_w = session.get("bgWidth") or session.get("bg_width") or 0
                if bg_w and int(bg_w) >= 4096:
                    note("upscale", {"skipped": f"background already {bg_w}px"})
                else:
                    # The route enforces the session's stored upscale policy;
                    # echo it back rather than assuming one.
                    job = client.post(f"/api/sessions/{session_id}/upscale-bg/jobs", json={
                        "model": session.get("upscaleModel") or "deterministic-lanczos-4x",
                        "targetLongEdge": int(session.get("upscaleTargetLongEdge") or 4096),
                        "select": True,
                    })
                    job = _require_success(_wait_for_job(
                        client, job.get("jobId") or job.get("id"),
                        timeout_s=args.timeout, quiet=True,
                    ))
                    note("upscale", job.get("result", {}) or {"status": job.get("status")})
                    # The job's select can be refused (downstream-artifact
                    # guard) or the request may have deduped to an existing
                    # upscaled background without touching selection — make
                    # the upscaled index the selection explicitly.
                    up_bg = (job.get("result") or {}).get("background") or {}
                    up_index = up_bg.get("index")
                    session = client.get(f"/api/sessions/{session_id}")
                    if up_index is not None and session.get("selectedBgIndex") != up_index:
                        client.post(f"/api/sessions/{session_id}/select-bg", json={"bgIndex": int(up_index)})
                        note("upscale-select", {"index": up_index})
            elif step == "auto-hitboxes":
                radius = args.radius or 30
                while True:
                    try:
                        result = client.post(f"/api/sessions/{session_id}/auto-hitboxes",
                                             json={"nDogs": args.count, "strategy": args.strategy, "radius": radius})
                        note("auto-hitboxes", {"placed": len(result.get("hitboxes", [])), "radius": radius})
                        break
                    except CliError as error:
                        if "non-overlapping" not in error.message and "smart_hitboxes_failed" not in error.message:
                            raise
                        radius -= args.shrink_step
                        if radius < args.min_radius:
                            raise CliError("placement_did_not_fit",
                                           f"could not fit {args.count} hitboxes at radius >= {args.min_radius}",
                                           stage="auto-hitboxes") from error
            elif step == "inpaint":
                session = client.get(f"/api/sessions/{session_id}")
                prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
                job = client.post(f"/api/sessions/{session_id}/inpaint/jobs", json={
                    "hitboxes": session.get("hitboxes") or [],
                    "dogPrompt": prompts["dogPrompt"],
                    "padding": 2.75,
                    "hardDogPercent": args.hard_percent,
                    "inpaintMode": args.inpaint_mode,
                })
                job = _require_success(_wait_for_job(client, job.get("jobId") or job.get("id"),
                                                     timeout_s=args.inpaint_timeout, quiet=True))
                note("inpaint", job.get("result", {}))
            elif step == "repair-sprites":
                budget = args.max_repairs
                regen_failures: list[dict] = []
                for _pass in range(args.repair_passes):
                    gaps = client.get(f"/api/sessions/{session_id}/sprite-gaps").get("missing", [])
                    if not gaps or budget <= 0:
                        break
                    session = client.get(f"/api/sessions/{session_id}")
                    prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
                    for entry in gaps:
                        if budget <= 0:
                            break
                        budget -= 1
                        try:
                            client.post(f"/api/sessions/{session_id}/dogs/by-id/{entry['dogId']}/regen",
                                        json={"prompt": prompts["dogPrompt"]})
                        except CliError as error:
                            regen_failures.append({"index": entry["index"], "error": error.message[:120]})
                remaining = client.get(f"/api/sessions/{session_id}/sprite-gaps").get("missing", [])
                if remaining and args.drop_unrepairable:
                    for entry in remaining:
                        client.request("DELETE", f"/api/sessions/{session_id}/dogs/by-id/{entry['dogId']}")
                    remaining = client.get(f"/api/sessions/{session_id}/sprite-gaps").get("missing", [])
                note("repair-sprites", {
                    "remaining": [e["index"] for e in remaining],
                    "regenBudgetLeft": budget,
                    "regenFailures": regen_failures,
                })
            elif step == "fix-hitboxes":
                moved = client.post(f"/api/sessions/{session_id}/fix-hitboxes",
                                    params={"maxOffsetFraction": args.max_offset})
                note("fix-hitboxes", {"moved": len(moved.get("moved", []))})
            elif step == "export":
                export_args = argparse.Namespace(**{
                    **vars(args),
                    "session_id": session_id,
                    "skip_approve": False,
                    "force_reapprove": False,
                    "acknowledge_destructive": False,
                    "note": args.changelog,
                    "wait": True,
                })
                try:
                    job = _run_export(client, export_args)
                    note("export", {"packaged": True, "status": job.get("status")})
                except CliError as error:
                    # The RC-activation refusal is expected and NOT a failure: the
                    # package and manifests are already installed by then.
                    if "Remote Config publisher" not in error.message:
                        raise
                    note("export", {"packaged": True, "remoteActivation": "refused by design"})
    except CliError as error:
        # The session id is the operator's handle for resuming; losing it to a
        # stderr-only note after paying for a background is unacceptable.
        error.context = {
            **error.context,
            "sessionId": session_id,
            "trace": trace,
            **({"resume": f"level-editor author --session-id {session_id} --start-from <step>"}
               if session_id else {}),
        }
        raise
    _emit(args, {"sessionId": session_id, "trace": trace})


def cmd_compare(client: Client, args: argparse.Namespace) -> None:
    """Queue several inpaint approaches on clones of one session and wait for
    all of them, reporting the clone ids to inspect side by side."""
    _check_disk(args.force_disk)
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    models = [m.strip() for m in (args.models or "").split(",") if m.strip()]
    body = {"modes": modes, "models": models, "hardDogPercent": args.hard_percent}
    started = client.post(f"/api/sessions/{args.session_id}/compare-inpaint", json=body)
    results = []
    for entry in started["comparisons"]:
        outcome = dict(entry)
        if args.wait:
            job = _wait_for_job(client, entry["jobId"], timeout_s=args.timeout, quiet=args.json)
            outcome["status"] = job.get("status")
            if job.get("status") != "succeeded":
                outcome["error"] = job.get("errorMessage")
        results.append(outcome)
    _emit(args, {"sessionId": args.session_id, "comparisons": results,
                 "hint": "review each comparison session (color.png/eval.png), or open it in the wizard"})


def cmd_repair_sprites(client: Client, args: argparse.Namespace) -> None:
    """Regenerate birds that came out of inpaint without a pickup sprite.

    Provider output sometimes yields an alpha the cutout pipeline can't use;
    those dogs ship without sprite metadata and the export gate refuses the
    whole level. Regeneration reliably produces a usable variant, so loop the
    stragglers instead of making a human find them (done by hand twice).
    """
    session = client.get(f"/api/sessions/{args.session_id}")
    missing = client.get(f"/api/sessions/{args.session_id}/sprite-gaps")
    repaired, failed = [], []
    for entry in missing.get("missing", []):
        if len(repaired) >= args.max_repairs:
            break
        dog_id = entry["dogId"]
        try:
            prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
            client.post(
                f"/api/sessions/{args.session_id}/dogs/by-id/{dog_id}/regen",
                json={"prompt": prompts["dogPrompt"]},
            )
            repaired.append(entry["index"])
        except CliError as error:
            failed.append({"index": entry["index"], "error": error.message[:160]})
    still = client.get(f"/api/sessions/{args.session_id}/sprite-gaps")
    remaining = still.get("missing", [])
    attempted = {entry["index"] for entry in missing.get("missing", [])[: args.max_repairs]}
    truncated = len(missing.get("missing", [])) > args.max_repairs
    dropped = []
    if remaining and args.drop_unrepairable and truncated:
        raise CliError(
            "drop_would_include_unattempted",
            f"--max-repairs {args.max_repairs} truncated the repair loop; "
            "rerun without the cap before dropping, or dropping would delete birds never retried",
            stage="repair-sprites",
        )
    if remaining and args.drop_unrepairable:
        remaining = [entry for entry in remaining if entry["index"] in attempted] or remaining
        # Some placements simply cannot yield a usable cutout (bird lands on
        # water/sky, or the diff is too flat). Dropping is an EXPLICIT choice
        # here — the export path refuses to drop painted dogs silently.
        for entry in remaining:
            client.request("DELETE", f"/api/sessions/{args.session_id}/dogs/by-id/{entry['dogId']}")
            dropped.append(entry["index"])
        remaining = client.get(f"/api/sessions/{args.session_id}/sprite-gaps").get("missing", [])
    still_missing = {entry["index"] for entry in remaining}
    _emit(args, {
        "regenerated": repaired,
        "repaired": [index for index in repaired if index not in still_missing],
        "failed": failed,
        "dropped": dropped,
        "remaining": [e["index"] for e in remaining],
        "hint": (
            "unrepairable placements remain — rerun to retry, or pass "
            "--drop-unrepairable to remove them explicitly"
            if remaining else None
        ),
    })


def cmd_fix_hitboxes(client: Client, args: argparse.Namespace) -> None:
    """Recenter hitboxes onto their birds' visible sprite centers (server-side:
    sprite metadata lives on the server filesystem, not in the session API)."""
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/fix-hitboxes",
        params={"maxOffsetFraction": args.max_offset},
    ))


def cmd_materialize_hitbox_sprites(client: Client, args: argparse.Namespace) -> None:
    """Cut pickup sprites at the session's (typically hand-placed) hitboxes.

    No detection, no reconcile: each hitbox IS the bird, so the detection fed
    to materialize is just a padded square around it. Flat-key recreate is the
    primary extractor server-side; the free chain is the fallback."""
    session = client.get(f"/api/sessions/{args.session_id}")
    hitboxes = session.get("hitboxes") or []
    if not hitboxes:
        raise CliError("no_hitboxes", "session has no hitboxes")
    detections = []
    for hb in hitboxes:
        r = float(hb.get("r") or hb.get("radius") or 58)
        pad = r * args.pad_factor
        detections.append({
            "x": int(hb["x"] - pad), "y": int(hb["y"] - pad),
            "width": int(2 * pad), "height": int(2 * pad),
            "confidence": 1.0,
        })
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/materialize-detection-sprites",
        json={"detections": detections, "minimumConfidence": 0.5},
    ))


def cmd_recenter_hitboxes_local(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(f"/api/sessions/{args.session_id}/recenter-hitboxes-local"))


def cmd_finalize_magenta_hitboxes(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/finalize-magenta-hitboxes",
        params={"topN": args.top_n} if args.top_n else None,
    ))


def cmd_reconcile_magenta_hitboxes(client: Client, args: argparse.Namespace) -> None:
    detections = json.loads(Path(args.file).read_text())
    if isinstance(detections, dict):
        detections = detections.get("detections")
    if not isinstance(detections, list):
        raise CliError("invalid_detections", "file must contain a detection array")
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/reconcile-magenta-hitboxes",
        json={
            "detections": detections,
            "minimumConfidence": args.minimum_confidence,
        },
    ))


def cmd_materialize_detection_sprites(client: Client, args: argparse.Namespace) -> None:
    detections = json.loads(Path(args.file).read_text())
    if isinstance(detections, dict):
        detections = detections.get("detections")
    if not isinstance(detections, list):
        raise CliError("invalid_detections", "file must contain a detection array")
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/materialize-detection-sprites",
        json={
            "detections": detections,
            "minimumConfidence": args.minimum_confidence,
        },
        timeout=args.timeout,
    ))


def cmd_finalize_one_shot(client: Client, args: argparse.Namespace) -> None:
    detections = json.loads(Path(args.file).read_text())
    if isinstance(detections, dict):
        detections = detections.get("detections")
    if not isinstance(detections, list):
        raise CliError("invalid_detections", "file must contain a detection array")
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/finalize-one-shot",
        json={
            "detections": detections,
            "minimumConfidence": args.minimum_confidence,
        },
    ))


def cmd_review(client: Client, args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    session_id = args.session_id
    written: list[str] = []
    for name in ("color.png", "inpainted.png", "eval.png"):
        try:
            payload = client.get(f"/levels/{session_id}/{name}")
        except CliError:
            continue
        (out / name).write_bytes(payload)
        written.append(name)
    index = 0
    while True:
        try:
            payload = client.get(f"/levels/{session_id}/bg_{index:02d}.png")
        except CliError:
            break
        (out / f"bg_{index:02d}.png").write_bytes(payload)
        written.append(f"bg_{index:02d}.png")
        index += 1
    session = client.get(f"/api/sessions/{session_id}")
    for dog in session.get("dogs") or []:
        for rel in dog.get("variants") or []:
            try:
                payload = client.get(f"/levels/{session_id}/{rel}")
            except CliError:
                continue
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            written.append(rel)
    (out / "session.json").write_text(json.dumps(session, indent=2))
    written.append("session.json")
    try:
        generations = client.get(f"/api/sessions/{session_id}/generations")
        (out / "generations.json").write_text(json.dumps(generations, indent=2))
        written.append("generations.json")
    except CliError:
        pass  # older server; review still delivers the images
    _emit(args, {"out": str(out), "files": written})


def cmd_watch(client: Client, args: argparse.Namespace) -> None:
    last: dict[str, str] = {}
    last_revision: str | None = None
    print(f"watching session {args.session_id} (ctrl-c to stop)", file=sys.stderr)
    while True:
        client.get(f"/api/sessions/{args.session_id}")
        if client.last_session_revision != last_revision:
            if last_revision is not None:
                print(json.dumps({"sessionRevision": client.last_session_revision}))
            last_revision = client.last_session_revision
        jobs = client.get("/api/jobs", params={"sessionId": args.session_id})
        for job in jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs:
            key = job.get("jobId") or job.get("id")
            status = job.get("status", "")
            if last.get(key) != status:
                last[key] = status
                print(json.dumps({"job": key, "kind": job.get("kind"), "status": status}))
        time.sleep(args.interval)


def cmd_approve(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(
        f"/api/sessions/{args.session_id}/approve-catalog",
        params={"requestId": str(uuid.uuid4())},
    ))


def _run_export(client: Client, args: argparse.Namespace) -> dict:
    """Export composition shared by `export` and `author` (author must not
    double-emit: `--json` promises exactly one JSON document)."""
    if args.session_id and not args.skip_approve:
        already = False
        if not args.force_reapprove:
            listing = client.get("/api/sessions")
            entry = next(
                (x for x in listing if isinstance(x, dict) and x.get("id") == args.session_id),
                None,
            ) if isinstance(listing, list) else None
            already = bool(entry and entry.get("catalogUploaded"))
        if not already:
            client.post(
                f"/api/sessions/{args.session_id}/approve-catalog",
                params={"requestId": str(uuid.uuid4())},
            )
    if args.session_id:
        client.post(f"/api/sessions/{args.session_id}/bundle")
    state = client.get("/api/sequence-workflow")
    live = state.get("liveSequence") or {}
    draft_state = state.get("draft") or {}
    base_version = live.get("sequenceVersion") or ""
    # The draft's catalog base tracks the CATALOG authority, which advances on
    # approve-catalog; the live sequence's catalogRevision lags until a
    # sequence ships.
    base_catalog = (state.get("catalog") or {}).get("catalogRevision") or live.get("catalogRevision") or ""
    lineup = list(draft_state.get("levelIds") or live.get("levelIds") or [])
    if args.session_id and args.session_id not in lineup:
        lineup.append(args.session_id)
    draft = client.request(
        "PUT",
        "/api/sequence-workflow/draft",
        json={
            "levelIds": lineup,
            "baseLiveSequenceVersion": base_version,
            "baseCatalogRevision": base_catalog,
            "draftRevision": draft_state.get("draftRevision") or "",
        },
    )
    new_draft = (draft.get("draft") or {}).get("draftRevision") or draft.get("draftRevision") or ""
    job = client.post(
        "/api/sequence-workflow/start",
        json={
            "changelogNote": args.note,
            "baseLiveSequenceVersion": base_version,
            "baseCatalogRevision": base_catalog,
            "draftRevision": new_draft,
            "destructiveWarningAcknowledged": bool(args.acknowledge_destructive),
            "requestId": str(uuid.uuid4()),
            "dynamicBundle": False,
        },
    )
    job_id = job.get("jobId") or job.get("id")
    if args.wait and job_id:
        job = _require_success(
            _wait_for_job(client, job_id, timeout_s=args.timeout, quiet=args.json)
        )
    return job


def cmd_export(client: Client, args: argparse.Namespace) -> None:
    _emit(args, _run_export(client, args))


def cmd_validate(args: argparse.Namespace) -> None:
    # Local, server-free: same engine as the export gate.
    from levelbuilder.api.export_gate import ExportGateError, validate_corpus
    from levelbuilder.settings import available_games, repo_root, resolve_game

    if args.all_games:
        root_dir = repo_root()
        names = [
            name for name in available_games()
            if (root_dir / "games" / name / "public" / "levels").is_dir()
        ] if root_dir else []
    else:
        if not args.game:
            raise CliError("game_required", "pass --game <name> or --all-games")
        names = [args.game]

    results = []
    for name in names:
        root = resolve_game(name).game_root / "public" / "levels"
        try:
            summary = validate_corpus(root)
        except ExportGateError as error:
            raise CliError("validation_failed", f"{name}: {error}", stage="validate") from error
        results.append({"game": name, "root": str(root), **summary})
    _emit(args, {"ok": True, "games": results})


def cmd_evaluate_sprites(args: argparse.Namespace) -> None:
    # Local, server-free: deterministic sprite-quality axes over an exported corpus.
    from levelbuilder.api.sprite_eval import evaluate_corpus, evaluate_level_dir
    from levelbuilder.settings import resolve_game

    if not args.game:
        raise CliError("game_required", "pass --game <name>")
    root = resolve_game(args.game).game_root / "public" / "levels"
    if not root.is_dir():
        raise CliError("corpus_missing", f"no public/levels corpus at {root}")
    if args.level:
        report = {
            "levels": [evaluate_level_dir(root / level_id) for level_id in args.level],
        }
        report["summary"] = {
            "levels": len(report["levels"]),
            "birds": sum(lv["summary"]["birds"] for lv in report["levels"]),
            "fail": sum(lv["summary"]["fail"] for lv in report["levels"]),
            "warn": sum(lv["summary"]["warn"] for lv in report["levels"]),
        }
    else:
        report = evaluate_corpus(root)
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1))
        _emit(args, {"ok": True, "out": args.out, "summary": report["summary"]})
    else:
        _emit(args, report)


def cmd_jobs(client: Client, args: argparse.Namespace) -> None:
    params = {"sessionId": args.session} if args.session else {}
    _emit(args, client.get("/api/jobs", params=params))


def cmd_job(client: Client, args: argparse.Namespace) -> None:
    job = client.get(f"/api/jobs/{args.job_id}")
    if args.events:
        job["events"] = client.get(f"/api/jobs/{args.job_id}/events")
    _emit(args, job)


def cmd_archive(client: Client, args: argparse.Namespace) -> None:
    _emit(
        args,
        client.request(
            "PATCH", f"/api/sessions/{args.session_id}/archive", json={"archived": not args.restore}
        ),
    )


def cmd_templates(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.get("/api/config").get("templates", []))


def cmd_prompts(client: Client, args: argparse.Namespace) -> None:
    path = f"/api/prompts/{args.kind}" if args.kind else "/api/prompts"
    _emit(args, client.get(path))


# ── wiring ───────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="level-editor", description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--token", default=os.environ.get("LEVEL_EDITOR_TOKEN"))
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    sub = parser.add_subparsers(dest="verb", required=True)

    def verb(name: str, func: Any, needs_client: bool = True) -> argparse.ArgumentParser:
        p = sub.add_parser(name)
        p.set_defaults(func=func, needs_client=needs_client)
        return p

    p = verb("serve", cmd_serve, needs_client=False)
    p.add_argument("--game")
    p.add_argument("--port", type=int, default=5192)

    p = verb("doctor", cmd_doctor, needs_client=False)
    p.add_argument("--game", required=True)

    verb("status", cmd_status)
    verb("config", cmd_config)
    verb("sessions", cmd_sessions)
    verb("session", cmd_session).add_argument("session_id")

    p = verb("create", cmd_create)
    p.add_argument("--template")
    for axis in ("setting", "scene", "style", "view", "entity", "model", "scale"):
        p.add_argument(f"--{axis}")
    p.set_defaults(scale="none")
    p.add_argument("--count", type=int, default=None)
    p.add_argument(
        "--aspect-ratio",
        choices=("9:16", "1:1"),
        default="9:16",
        help="generated background aspect ratio",
    )
    p.add_argument(
        "--one-shot",
        action="store_true",
        help="paint the requested entities directly into the generated background",
    )

    for name, func in (("generate-bg", cmd_generate_bg), ("upscale", cmd_upscale)):
        p = verb(name, func)
        p.add_argument("session_id")
        p.add_argument("--wait", action="store_true")
        p.add_argument("--timeout", type=float, default=900.0)
        p.add_argument("--force-disk", action="store_true")

    p = verb("select-bg", cmd_select_bg)
    p.add_argument("session_id")
    p.add_argument("index", type=int)

    p = verb("auto-hitboxes", cmd_auto_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--count", type=int, default=None)
    p.add_argument("--strategy", default="random")
    p.add_argument("--radius", type=int, help="starting radius (shrinks on failure)")
    p.add_argument("--min-radius", type=int, default=18)
    p.add_argument("--shrink-step", type=int, default=2)

    p = verb("set-hitboxes", cmd_set_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--file", required=True)

    verb("visibility-check", cmd_visibility_check).add_argument("session_id")

    p = verb("inpaint", cmd_inpaint)
    p.add_argument("session_id")
    p.add_argument("--wait", action="store_true")
    p.add_argument("--timeout", type=float, default=3600.0)
    p.add_argument("--padding", type=float, default=2.75)
    p.add_argument("--hard-percent", type=int, default=0)
    p.add_argument("--mode", choices=("crop", "crop_reference", "ring", "magenta"), default="crop")
    p.add_argument("--model", help="override the session's configured inpaint model")
    p.add_argument(
        "--ring-radius", type=int,
        help="ring mode: uniform marker/tap radius in scene pixels applied to every hitbox before painting",
    )
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--force-disk", action="store_true")

    p = verb("regenerate", cmd_regenerate)
    p.add_argument("session_id")
    p.add_argument("--dog", required=True)

    p = verb("dogs", cmd_dogs)
    p.add_argument("session_id")
    p.add_argument("--set-active")
    p.add_argument("--variant", type=int)
    p.add_argument("--delete")

    p = verb("author", cmd_author)
    p.add_argument("--template")
    p.add_argument("--session-id", dest="session_id")
    p.add_argument("--count", type=int, default=20)
    p.add_argument("--bg-index", type=int, default=0)
    p.add_argument("--strategy", default="smart")
    p.add_argument("--radius", type=int)
    p.add_argument("--min-radius", type=int, default=18)
    p.add_argument("--shrink-step", type=int, default=2)
    p.add_argument("--hard-percent", type=int, default=0)
    p.add_argument(
        "--inpaint-mode", choices=("crop", "crop_reference", "ring", "magenta"), default="crop",
        help="paint lane for the inpaint step (magenta = full-scene disc lane; ring = outline markers)",
    )
    p.add_argument("--max-offset", type=float, default=0.5)
    p.add_argument("--repair-passes", type=int, default=2)
    p.add_argument("--drop-unrepairable", action="store_true")
    p.add_argument("--changelog", default="authored by level-editor CLI")
    p.add_argument("--timeout", type=float, default=900.0)
    p.add_argument("--inpaint-timeout", type=float, default=3600.0)
    p.add_argument("--force-disk", action="store_true")
    p.add_argument("--start-from", choices=list(AUTHOR_STEPS))
    p.add_argument("--stop-after", choices=list(AUTHOR_STEPS))
    p.add_argument("--max-repairs", type=int, default=25)
    p.add_argument("--redo", action="store_true",
                   help="regenerate even when the session already has backgrounds/painted dogs")
    p.add_argument("--dry-run", action="store_true")

    p = verb("compare", cmd_compare)
    p.add_argument("session_id")
    p.add_argument("--modes", default="crop,crop_reference,magenta")
    p.add_argument("--models", help="comma-separated magenta models to compare on identical cloned inputs")
    p.add_argument("--hard-percent", type=int, default=0)
    p.add_argument("--wait", action="store_true")
    p.add_argument("--timeout", type=float, default=3600.0)
    p.add_argument("--force-disk", action="store_true")

    p = verb("repair-sprites", cmd_repair_sprites)
    p.add_argument("session_id")
    p.add_argument("--max-repairs", type=int, default=25)
    p.add_argument("--drop-unrepairable", action="store_true",
                   help="explicitly delete dogs that still lack a pickup sprite")

    p = verb("fix-hitboxes", cmd_fix_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--max-offset", type=float, default=0.5)

    p = verb("materialize-hitbox-sprites", cmd_materialize_hitbox_sprites)
    p.add_argument("session_id")
    p.add_argument("--pad-factor", type=float, default=2.2)

    p = verb("recenter-hitboxes-local", cmd_recenter_hitboxes_local)
    p.add_argument("session_id")

    p = verb("finalize-magenta-hitboxes", cmd_finalize_magenta_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--top-n", type=int, default=0)

    p = verb("reconcile-magenta-hitboxes", cmd_reconcile_magenta_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--file", required=True)
    p.add_argument("--minimum-confidence", type=float, default=0.5)

    p = verb("materialize-detection-sprites", cmd_materialize_detection_sprites)
    p.add_argument("session_id")
    p.add_argument("--file", required=True)
    p.add_argument("--minimum-confidence", type=float, default=0.5)
    p.add_argument("--timeout", type=float, default=900.0)

    p = verb("finalize-one-shot", cmd_finalize_one_shot)
    p.add_argument("session_id")
    p.add_argument("--file", required=True)
    p.add_argument("--minimum-confidence", type=float, default=0.5)

    p = verb("review", cmd_review)
    p.add_argument("session_id")
    p.add_argument("--out", required=True)

    p = verb("watch", cmd_watch)
    p.add_argument("session_id")
    p.add_argument("--interval", type=float, default=2.0)

    p = verb("approve", cmd_approve)
    p.add_argument("session_id")

    p = verb("export", cmd_export)
    p.add_argument("session_id", nargs="?")
    p.add_argument("--skip-approve", action="store_true")
    p.add_argument("--force-reapprove", action="store_true", help="approve again even when already cataloged (mints a new catalog revision)")
    p.add_argument("--note", default="level-editor CLI export")
    p.add_argument("--wait", action="store_true")
    p.add_argument("--timeout", type=float, default=1800.0)
    p.add_argument("--acknowledge-destructive", action="store_true")

    p = verb("validate", cmd_validate, needs_client=False)
    p.add_argument("--game")
    p.add_argument("--all-games", action="store_true",
                   help="validate every game with a public/levels corpus")

    p = verb("evaluate-sprites", cmd_evaluate_sprites, needs_client=False)
    p.add_argument("--game")
    p.add_argument("--level", action="append", help="limit to specific level id(s)")
    p.add_argument("--out", help="write full report JSON to this path")

    p = verb("jobs", cmd_jobs)
    p.add_argument("--session")

    p = verb("job", cmd_job)
    p.add_argument("job_id")
    p.add_argument("--events", action="store_true")

    p = verb("archive", cmd_archive)
    p.add_argument("session_id")
    p.add_argument("--restore", action="store_true")

    verb("templates", cmd_templates)
    verb("prompts", cmd_prompts).add_argument("kind", nargs="?")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if not args.needs_client:
            args.func(args)
        else:
            client = Client(args.url, args.token)
            args.func(client, args)
        return 0
    except httpx.TransportError as error:
        payload = {"error": {"code": "transport_error", "stage": "http", "message": str(error) or type(error).__name__}}
        if getattr(args, "json", False):
            print(json.dumps(payload))
        else:
            print(f"error [transport_error]: {payload['error']['message']}", file=sys.stderr)
        return 2
    except CliError as error:
        payload = {"error": {"code": error.code, "stage": error.stage, "message": error.message},
                   **error.context}
        if getattr(args, "json", False):
            print(json.dumps(payload))
        else:
            print(f"error [{error.code} @ {error.stage}]: {error.message}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
