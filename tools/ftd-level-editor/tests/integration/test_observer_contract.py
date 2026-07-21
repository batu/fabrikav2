"""R20-R23 / AE4-AE7: the polling observer contract against the durable backend.

Connection state lives entirely in the browser observer; these tests prove the
backend side of that contract: reads are side-effect-free, events are a
monotonic replayable cursor, completion never depends on an attached observer,
and reload can rediscover work by session or Request ID alone.
"""

from __future__ import annotations

import re
from pathlib import Path

KIND = "ftd.background_generate"
TOOL_ROOT = Path(__file__).resolve().parent.parent.parent


def _start(jobs_client, jobs_headers, ftd_session, request_id: str) -> dict:
    response = jobs_client.post(
        f"/api/jobs/actions/{KIND}",
        json={
            "requestId": request_id,
            "sessionId": ftd_session.session_id,
            "revision": ftd_session.revision,
            "inputs": {"sceneKey": "scene-1"},
        },
        headers=jobs_headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_repeating_a_lost_start_returns_the_same_job(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    # AE4: the browser lost the first response and repeats the POST verbatim.
    first = _start(jobs_client, jobs_headers, ftd_session, "req-observer-ae4")
    second = _start(jobs_client, jobs_headers, ftd_session, "req-observer-ae4")
    assert second["jobId"] == first["jobId"]
    assert len(jobs_env.jobs.list_jobs(session_id=ftd_session.session_id)) == 1


def test_reload_rediscovers_jobs_by_request_id_and_session(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    # AE5a/R20: reload with cleared browser storage keeps only Request ID or
    # the session; both lookups must find the durable jobs.
    job_a = _start(jobs_client, jobs_headers, ftd_session, "req-observer-reload-a")
    job_b = _start(jobs_client, jobs_headers, ftd_session, "req-observer-reload-b")

    by_request = jobs_client.get(
        "/api/jobs", params={"requestId": "req-observer-reload-a"}, headers=jobs_headers
    ).json()
    assert [job["jobId"] for job in by_request] == [job_a["jobId"]]

    by_session = jobs_client.get(
        "/api/jobs", params={"sessionId": ftd_session.session_id}, headers=jobs_headers
    ).json()
    assert {job["jobId"] for job in by_session} == {job_a["jobId"], job_b["jobId"]}


def test_observer_reads_are_side_effect_free_and_never_change_job_state(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    # AE6/R21: any number of snapshot/event reads (an observer reconnecting)
    # leaves status, events, and timestamps untouched.
    job = _start(jobs_client, jobs_headers, ftd_session, "req-observer-idempotent-read")
    before = jobs_client.get(f"/api/jobs/{job['jobId']}", headers=jobs_headers).json()
    for _ in range(5):
        jobs_client.get(f"/api/jobs/{job['jobId']}", headers=jobs_headers)
        jobs_client.get(f"/api/jobs/{job['jobId']}/events", headers=jobs_headers)
    after = jobs_client.get(f"/api/jobs/{job['jobId']}", headers=jobs_headers).json()
    assert after == before


def test_events_replay_from_cursor_ordered_and_exactly_once(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    job = _start(jobs_client, jobs_headers, ftd_session, "req-observer-cursor")

    def handler(context):
        context.store.append_event(job["jobId"], "job.progress", message="step 1")
        context.store.append_event(job["jobId"], "job.progress", message="step 2")
        return {"scene": "done"}

    worker = jobs_env.make_worker({KIND: handler})
    assert worker.run_once()

    events = jobs_client.get(
        f"/api/jobs/{job['jobId']}/events", headers=jobs_headers
    ).json()
    ids = [event["id"] for event in events]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    types = [event["eventType"] for event in events]
    assert types[0] == "job.created"
    assert types.count("job.progress") == 2

    # Two concurrent observers replaying from any cursor see identical suffixes.
    cursor = ids[1]
    replay_one = jobs_client.get(
        f"/api/jobs/{job['jobId']}/events", params={"after": cursor}, headers=jobs_headers
    ).json()
    replay_two = jobs_client.get(
        f"/api/jobs/{job['jobId']}/events", params={"after": cursor}, headers=jobs_headers
    ).json()
    assert replay_one == replay_two
    assert [event["id"] for event in replay_one] == ids[2:]
    # replay past the tail is empty, not an error
    assert (
        jobs_client.get(
            f"/api/jobs/{job['jobId']}/events",
            params={"after": ids[-1]},
            headers=jobs_headers,
        ).json()
        == []
    )


def test_completion_needs_no_attached_observer(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    # AE7: the browser started the job and went away entirely; the worker
    # still commits the terminal result and a later read finds it.
    job = _start(jobs_client, jobs_headers, ftd_session, "req-observer-ae7")
    worker = jobs_env.make_worker({KIND: lambda context: {"scene": "committed"}})
    assert worker.run_once()

    record = jobs_env.jobs.get_job(job["jobId"])
    assert record.status == "succeeded"
    assert record.completed_at is not None

    resumed = jobs_client.get(f"/api/jobs/{job['jobId']}", headers=jobs_headers).json()
    assert resumed["status"] == "succeeded"
    assert resumed["result"] == {"scene": "committed", "application": "applied"}


def test_start_and_get_expose_one_equivalent_job_contract(
    jobs_env, ftd_session, jobs_client, jobs_headers
) -> None:
    # Scenario 8: the UI adapter and a direct HTTP agent share one contract —
    # the POST response is byte-equivalent to an immediate GET of the resource.
    started = _start(jobs_client, jobs_headers, ftd_session, "req-observer-equiv")
    fetched = jobs_client.get(f"/api/jobs/{started['jobId']}", headers=jobs_headers).json()
    assert fetched == started


FORBIDDEN_MIGRATED_PATTERNS = (
    re.compile(r"\bEventSource\b"),
    re.compile(r"sse_starlette"),
    re.compile(r"_active_generations"),
    re.compile(r"generation-status"),
    re.compile(r"\blocalStorage\b"),
    re.compile(r"\bsessionStorage\b"),
)


def test_no_migrated_sse_or_shadow_storage_path_exists() -> None:
    # R22: source proof that no EventSource, start-on-GET stream, module-global
    # generation registry, or browser shadow-storage ledger was migrated.
    this_file = Path(__file__).resolve()
    sources = [
        path
        for pattern in ("backend/**/*.py", "ui/src/**/*.ts", "ui/src/**/*.tsx", "ui/src/**/*.mjs")
        for path in TOOL_ROOT.glob(pattern)
    ]
    assert sources, "expected editor sources to scan"
    offenders = [
        f"{path}: {pattern.pattern}"
        for path in sources
        if path != this_file
        for pattern in FORBIDDEN_MIGRATED_PATTERNS
        if pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
