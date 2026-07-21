"""Lossless, revisioned FTD authoring-session boundaries."""

from .dogs import DogBundlePayload
from .model import AuthoringDog, AuthoringSession
from .store import (
    DogBundlePublication,
    ReservationRejected,
    SessionAlreadyExists,
    SessionCommitIndeterminate,
    SessionRevisionConflict,
    SessionReadError,
    SessionSnapshot,
    SessionStore,
)

__all__ = [
    "AuthoringDog",
    "AuthoringSession",
    "DogBundlePayload",
    "DogBundlePublication",
    "ReservationRejected",
    "SessionAlreadyExists",
    "SessionCommitIndeterminate",
    "SessionRevisionConflict",
    "SessionReadError",
    "SessionSnapshot",
    "SessionStore",
]
