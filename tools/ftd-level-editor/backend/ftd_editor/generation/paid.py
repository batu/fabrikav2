"""Shared durable execution skeleton for FTD paid provider actions.

Every paid kind runs the same spend-safe sequence inside the U4 worker:
record submission intent, submit, checkpoint the provider identity the
moment one exists, poll with the durable ledger (never a request), fetch
the output through the trust boundary, register the artifact, then apply
under the job's bound session revision. A stale revision keeps the paid
artifact and the current session (ApplicationConflict); a cancel racing a
late output retains the artifact without applying it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping, Protocol

from ..jobs.models import ArtifactRecord, ExecutionSpec
from ..jobs.worker import (
    ApplicationConflict,
    JobCancelled,
    JobContext,
    RetryableJobError,
    TerminalJobError,
)
from ..prompts.intents import IntentError, forbid_client_prompt_keys
from ..sessions.store import SessionRevisionConflict, SessionStore
from .boundary import (
    FTD_OUTPUT_POLICIES,
    OutputPolicy,
    OutputTransport,
    ProviderOutputRejected,
    fetch_validated_output,
)


@dataclass(frozen=True, slots=True)
class ProviderSubmission:
    """What one provider submit call durably yields before any polling."""

    provider_job_id: str | None = None
    output_url: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderPoll:
    status: str  # "running" | "succeeded" | "failed"
    output_url: str | None = None
    error: str | None = None


class PaidProvider(Protocol):
    """Scripted or real adapter; it performs exactly one query or submission."""

    def submit(self, kind: str, inputs: Mapping[str, Any], provider_options: Mapping[str, Any]) -> ProviderSubmission: ...

    def poll(self, provider_job_id: str) -> ProviderPoll: ...


class ProviderCallFailed(RuntimeError):
    """A provider transport/API failure with no definitive provider verdict."""


@dataclass(frozen=True, slots=True)
class PaidRuntime:
    """Composition-supplied collaborators shared by every paid handler."""

    sessions: SessionStore
    now: Callable[[], str]

    def clock_seconds(self) -> float:
        return datetime.fromisoformat(self.now()).timestamp()


def load_spec(context: JobContext) -> ExecutionSpec:
    return ExecutionSpec.from_mapping(context.job.execution_spec)


def require_input(spec: ExecutionSpec, name: str) -> Any:
    value = spec.inputs.get(name)
    if value is None or value == "":
        raise TerminalJobError("invalid_inputs", f"required input {name!r} is missing")
    return value


def resolve_prompt_intent(inputs: Mapping[str, Any], resolver: Callable[[], str]) -> str:
    """Translate malformed FTD prompt intent into the worker's terminal error contract."""

    try:
        forbid_client_prompt_keys(inputs)
        return resolver()
    except IntentError as error:
        raise TerminalJobError("invalid_inputs", str(error)) from error


def provider_for(context: JobContext, name: str) -> PaidProvider:
    return context.providers.require(name)


def transport_for(context: JobContext) -> OutputTransport:
    return context.providers.require("ftd.output_transport")


def submit_and_obtain_output_url(
    context: JobContext,
    runtime: PaidRuntime,
    provider_name: str,
    policy: OutputPolicy,
    inputs: Mapping[str, Any],
    provider_options: Mapping[str, Any],
) -> str:
    """Submit once with durable intent, then poll to one output URL."""

    provider = provider_for(context, provider_name)
    context.raise_if_cancel_requested()
    context.record_submission_intent()
    context.set_stage("submitted", stage="provider_submission")
    try:
        submission = provider.submit(context.job.kind, inputs, provider_options)
    except ProviderCallFailed as error:
        # Intent is recorded and no identity exists: containment orphans this
        # attempt behind the force-new gate rather than risking double spend.
        raise RetryableJobError("provider_submit_failed", str(error)) from error
    if submission.provider_job_id is not None:
        context.record_provider_job_id(submission.provider_job_id)
    if submission.output_url is not None:
        return submission.output_url
    if submission.provider_job_id is None:
        raise TerminalJobError(
            "provider_submission_ambiguous",
            "provider returned neither an output nor a resumable identity",
        )
    return poll_until_output(context, runtime, provider_name, policy, submission.provider_job_id)


def poll_until_output(
    context: JobContext,
    runtime: PaidRuntime,
    provider_name: str,
    policy: OutputPolicy,
    provider_job_id: str,
) -> str:
    provider = provider_for(context, provider_name)
    context.set_stage("polling", stage="provider_polling")
    deadline = runtime.clock_seconds() + policy.poll_deadline_seconds
    while True:
        context.raise_if_cancel_requested()
        try:
            poll = provider.poll(provider_job_id)
        except ProviderCallFailed as error:
            # Identity exists, so the paid attempt stays resumable: containment
            # returns it to polling instead of ever resubmitting.
            raise RetryableJobError("provider_poll_failed", str(error)) from error
        if poll.status == "succeeded":
            if not poll.output_url:
                raise TerminalJobError(
                    "provider_output_missing", "provider succeeded without an output URL"
                )
            return poll.output_url
        if poll.status == "failed":
            raise TerminalJobError(
                "provider_reported_failure", poll.error or "provider reported a failed job"
            )
        context.heartbeat()
        if runtime.clock_seconds() > deadline:
            # Late results stay recoverable: the resumable identity survives and
            # containment parks the attempt back in polling.
            raise RetryableJobError(
                "provider_poll_deadline",
                f"provider poll exceeded {policy.poll_deadline_seconds}s deadline",
            )


def fetch_output(context: JobContext, url: str, policy: OutputPolicy):
    context.set_stage("downloading", stage="output_quarantine")
    try:
        return fetch_validated_output(transport_for(context), url, policy)
    except ProviderOutputRejected as error:
        raise TerminalJobError(error.code, str(error)) from error


def register_output_artifact(
    context: JobContext, payload: bytes, *, display_name: str, media_type: str
) -> ArtifactRecord:
    context.set_stage("finalizing", stage="artifact_registration")
    return context.register_artifact(
        context.job.id, payload, display_name=display_name, media_type=media_type
    )


def retain_if_cancelled(context: JobContext, payload: bytes, *, display_name: str, media_type: str) -> None:
    """A cancel racing late output retains the paid bytes but never applies them."""

    if context.cancel_requested():
        register_output_artifact(
            context, payload, display_name=display_name, media_type=media_type
        )
        raise JobCancelled()


def apply_session_mutation(
    runtime: PaidRuntime,
    spec: ExecutionSpec,
    mutation: Callable[[Any], Any],
    *,
    retained_result: Mapping[str, Any],
) -> str:
    """Revision-bound apply; a stale session keeps the paid bundle unapplied."""

    try:
        snapshot = runtime.sessions.mutate(
            spec.session_id,
            expected_revision=spec.source_revision,
            mutation=mutation,
        )
    except SessionRevisionConflict as conflict:
        raise ApplicationConflict(dict(retained_result)) from conflict
    return snapshot.revision


def policy_for(provider_name: str) -> OutputPolicy:
    return FTD_OUTPUT_POLICIES[provider_name]


def completed_items_from_prior_attempts(
    context: JobContext, event_type: str, key: str
) -> dict[str, dict[str, Any]]:
    """Per-item completion checkpoints from this job's linked-attempt chain.

    Batch kinds append one durable event per published item; a retry or
    granted force-new attempt walks its previous_attempt_id chain and skips
    every item a prior attempt already paid for and published, so recovery
    only spends for items that never completed.
    """

    completed: dict[str, dict[str, Any]] = {}
    attempt_id = context.job.previous_attempt_id
    while attempt_id:
        for event in context.store.list_events(attempt_id):
            if event.event_type == event_type:
                item = str(event.data.get(key) or "")
                if item and item not in completed:
                    completed[item] = dict(event.data)
        attempt_id = context.store.get_job(attempt_id).previous_attempt_id
    return completed
