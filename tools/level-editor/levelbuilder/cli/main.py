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
    "prompt-library": "prompts",
    "generation-status": "status",
}

TERMINAL_JOB_STATUSES = {
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancelled",
}


class CliError(Exception):
    def __init__(self, code: str, message: str, stage: str = "cli") -> None:
        self.code = code
        self.stage = stage
        self.message = message
        super().__init__(message)


class Client:
    def __init__(self, base_url: str, token: str | None) -> None:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._http = httpx.Client(base_url=base_url, headers=headers, timeout=60.0)
        self.base_url = base_url

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


def _wait_for_job(client: Client, job_id: str, *, timeout_s: float, quiet: bool) -> dict:
    deadline = time.monotonic() + timeout_s
    last_status = None
    while True:
        job = client.get(f"/api/jobs/{job_id}")
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
        }
        model = template.get("model")
        n_dogs = int(template.get("nDogs", 20))
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
        }
        model = args.model
        n_dogs = args.count
    prompts = client.post("/api/actions/assemble-recipe-prompts", json=recipe)
    body = {
        **recipe,
        "scenePrompt": prompts["scenePrompt"],
        "dogPrompt": prompts["dogPrompt"],
        "bgModel": model or args.model or "google/gemini-3.1-flash-image-preview",
        "inpaintModel": model or args.model or "google/gemini-3.1-flash-image-preview",
        "nDogs": n_dogs,
        "aspectRatio": "9:16",
        "imageSize": "1K",
    }
    created = client.post("/api/sessions", json=body)
    _emit(args, created)


def cmd_generate_bg(client: Client, args: argparse.Namespace) -> None:
    _check_disk(args.force_disk)
    job = client.post(f"/api/sessions/{args.session_id}/background-generation/jobs")
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job["jobId"], timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_select_bg(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(f"/api/sessions/{args.session_id}/select-bg", json={"bgIndex": args.index}))


def cmd_upscale(client: Client, args: argparse.Namespace) -> None:
    _check_disk(args.force_disk)
    job = client.post(f"/api/sessions/{args.session_id}/upscale-bg/jobs")
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job["jobId"], timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_auto_hitboxes(client: Client, args: argparse.Namespace) -> None:
    body = {"nDogs": args.count, "strategy": args.strategy}
    _emit(args, client.post(f"/api/sessions/{args.session_id}/auto-hitboxes", json=body))


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
        prompts = client.post("/api/actions/assemble-recipe-prompts", json=_session_recipe(session))
        body = {
            "hitboxes": hitboxes,
            "dogPrompt": prompts["dogPrompt"],
            "padding": args.padding,
            "hardDogPercent": args.hard_percent,
            "inpaintMode": "crop",
        }
        job = client.post(f"/api/sessions/{args.session_id}/inpaint/jobs", json=body)
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job["jobId"], timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_regenerate(client: Client, args: argparse.Namespace) -> None:
    _emit(args, client.post(f"/api/sessions/{args.session_id}/dogs/by-id/{args.dog}/regen", json={}))


def cmd_dogs(client: Client, args: argparse.Namespace) -> None:
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
    (out / "session.json").write_text(json.dumps(session, indent=2))
    written.append("session.json")
    _emit(args, {"out": str(out), "files": written})


def cmd_watch(client: Client, args: argparse.Namespace) -> None:
    last: dict[str, str] = {}
    print(f"watching session {args.session_id} (ctrl-c to stop)", file=sys.stderr)
    while True:
        jobs = client.get("/api/jobs", params={"sessionId": args.session_id})
        for job in jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs:
            key = job.get("jobId") or job.get("id")
            status = job.get("status", "")
            if last.get(key) != status:
                last[key] = status
                print(json.dumps({"job": key, "kind": job.get("kind"), "status": status}))
        time.sleep(args.interval)


def cmd_export(client: Client, args: argparse.Namespace) -> None:
    state = client.get("/api/sequence-workflow")
    lineup = list(state.get("draft", {}).get("levelIds") or state.get("liveLevelIds") or [])
    if args.session_id and args.session_id not in lineup:
        lineup.append(args.session_id)
    draft = client.request(
        "PUT",
        "/api/sequence-workflow/draft",
        json={
            "levelIds": lineup,
            "baseLiveSequenceVersion": state.get("liveSequenceVersion") or "",
            "baseCatalogRevision": state.get("catalogRevision") or "",
            "draftRevision": state.get("draft", {}).get("draftRevision") or "",
        },
    )
    job = client.post(
        "/api/sequence-workflow/start",
        json={
            "changelogNote": args.note,
            "baseLiveSequenceVersion": state.get("liveSequenceVersion") or "",
            "baseCatalogRevision": state.get("catalogRevision") or "",
            "draftRevision": draft.get("draft", {}).get("draftRevision") or draft.get("draftRevision") or "",
            "destructiveWarningAcknowledged": bool(args.acknowledge_destructive),
            "requestId": str(uuid.uuid4()),
            "dynamicBundle": False,
        },
    )
    if args.wait:
        job = _require_success(
            _wait_for_job(client, job["jobId"], timeout_s=args.timeout, quiet=args.json)
        )
    _emit(args, job)


def cmd_validate(args: argparse.Namespace) -> None:
    # Local, server-free: same engine as the export gate.
    from levelbuilder.api.export_gate import ExportGateError, validate_corpus
    from levelbuilder.settings import resolve_game

    profile = resolve_game(args.game)
    root = profile.game_root / "public" / "levels"
    try:
        summary = validate_corpus(root)
    except ExportGateError as error:
        raise CliError("validation_failed", str(error), stage="validate") from error
    _emit(args, {"root": str(root), **summary, "ok": True})


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
    for axis in ("setting", "scene", "style", "view", "entity", "model"):
        p.add_argument(f"--{axis}")
    p.add_argument("--count", type=int, default=20)

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
    p.add_argument("--count", type=int, default=20)
    p.add_argument("--strategy", default="random")

    p = verb("set-hitboxes", cmd_set_hitboxes)
    p.add_argument("session_id")
    p.add_argument("--file", required=True)

    verb("visibility-check", cmd_visibility_check).add_argument("session_id")

    p = verb("inpaint", cmd_inpaint)
    p.add_argument("session_id")
    p.add_argument("--wait", action="store_true")
    p.add_argument("--timeout", type=float, default=3600.0)
    p.add_argument("--padding", type=float, default=2.75)
    p.add_argument("--hard-percent", type=int, default=30)
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

    p = verb("review", cmd_review)
    p.add_argument("session_id")
    p.add_argument("--out", required=True)

    p = verb("watch", cmd_watch)
    p.add_argument("session_id")
    p.add_argument("--interval", type=float, default=2.0)

    p = verb("export", cmd_export)
    p.add_argument("session_id", nargs="?")
    p.add_argument("--note", default="level-editor CLI export")
    p.add_argument("--wait", action="store_true")
    p.add_argument("--timeout", type=float, default=1800.0)
    p.add_argument("--acknowledge-destructive", action="store_true")

    p = verb("validate", cmd_validate, needs_client=False)
    p.add_argument("--game", required=True)

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
    except CliError as error:
        payload = {"error": {"code": error.code, "stage": error.stage, "message": error.message}}
        if getattr(args, "json", False):
            print(json.dumps(payload))
        else:
            print(f"error [{error.code} @ {error.stage}]: {error.message}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
