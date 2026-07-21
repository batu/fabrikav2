"""Immutable editor settings and operational workspace paths."""

from __future__ import annotations

import ipaddress
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Self


class SettingsError(ValueError):
    """Raised when composition would violate the local-authority boundary."""


def _resolved(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def _is_below(path: Path, root: Path) -> bool:
    return path == root or path.is_relative_to(root)


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class WorkspacePaths:
    """All mutable editor roots, fixed for the lifetime of one app."""

    root: Path
    authoring: Path
    public: Path
    state: Path
    artifacts: Path
    cache: Path
    locks: Path

    @classmethod
    def below(cls, root: Path, *, authoring_root: Path | None = None) -> Self:
        resolved_root = _resolved(root)
        return cls(
            root=resolved_root,
            authoring=_resolved(authoring_root or resolved_root / "authoring"),
            public=_resolved(resolved_root / "public"),
            state=_resolved(resolved_root / "state"),
            artifacts=_resolved(resolved_root / "artifacts"),
            cache=_resolved(resolved_root / "cache"),
            locks=_resolved(resolved_root / "locks"),
        )

    def operational_roots(self) -> tuple[Path, ...]:
        return (
            self.authoring,
            self.public,
            self.state,
            self.artifacts,
            self.cache,
            self.locks,
        )

    def prepare(self) -> None:
        for path in (self.root, *self.operational_roots()):
            path.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True, slots=True)
class EditorSettings:
    """One startup-time settings value; never discovered from module location."""

    workspace: WorkspacePaths
    environment: str
    bind_host: str
    bind_port: int
    allowed_hosts: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    forbidden_roots: tuple[Path, ...]
    prewarm: bool = False
    remote_enabled: bool = False

    @classmethod
    def for_test(
        cls,
        root: Path,
        *,
        authoring_root: Path | None = None,
        allowed_hosts: tuple[str, ...] = ("testserver",),
        allowed_origins: tuple[str, ...] = ("http://testserver",),
        forbidden_roots: tuple[Path, ...] = (),
    ) -> Self:
        settings = cls(
            workspace=WorkspacePaths.below(root, authoring_root=authoring_root),
            environment="test",
            bind_host="127.0.0.1",
            bind_port=5192,
            allowed_hosts=allowed_hosts,
            allowed_origins=allowed_origins,
            forbidden_roots=tuple(_resolved(path) for path in forbidden_roots),
        )
        settings.validate(require_disposable_root=True)
        return settings

    @classmethod
    def for_development(
        cls,
        root: Path | None = None,
        *,
        bind_host: str = "127.0.0.1",
        bind_port: int = 5192,
    ) -> Self:
        development_root = root or Path(tempfile.mkdtemp(prefix="ftd-editor-dev-"))
        hosts = (f"{bind_host}:{bind_port}", bind_host)
        origins = (f"http://{bind_host}:{bind_port}",)
        settings = cls(
            workspace=WorkspacePaths.below(development_root),
            environment="development",
            bind_host=bind_host,
            bind_port=bind_port,
            allowed_hosts=hosts,
            allowed_origins=origins,
            forbidden_roots=(),
        )
        settings.validate(require_disposable_root=True)
        return settings

    @classmethod
    def for_production(
        cls,
        data_root: Path,
        *,
        bind_host: str = "127.0.0.1",
        bind_port: int = 5192,
        allowed_hosts: tuple[str, ...] | None = None,
        allowed_origins: tuple[str, ...] | None = None,
        forbidden_roots: tuple[Path, ...] = (),
        remote_enabled: bool = False,
    ) -> Self:
        if not data_root.is_absolute():
            raise SettingsError("production data root must be an explicit absolute path")
        resolved_root = _resolved(data_root)
        if ".twf-worktrees" in resolved_root.parts:
            raise SettingsError("production data root must be outside Git worktrees")
        defaults_hosts = (f"{bind_host}:{bind_port}", bind_host)
        defaults_origins = (f"http://{bind_host}:{bind_port}",)
        settings = cls(
            workspace=WorkspacePaths.below(resolved_root),
            environment="production",
            bind_host=bind_host,
            bind_port=bind_port,
            allowed_hosts=allowed_hosts or defaults_hosts,
            allowed_origins=allowed_origins or defaults_origins,
            forbidden_roots=tuple(_resolved(path) for path in forbidden_roots),
            remote_enabled=remote_enabled,
        )
        settings.validate(require_disposable_root=False)
        return settings

    def validate(self, *, require_disposable_root: bool) -> None:
        root = _resolved(self.workspace.root)
        paths = self.workspace.operational_roots()
        for forbidden in self.forbidden_roots:
            for path in (root, *paths):
                if _is_below(path, forbidden) or _is_below(forbidden, path):
                    raise SettingsError(f"editor path overlaps forbidden root: {forbidden}")
        if require_disposable_root and any(not _is_below(path, root) for path in paths):
            raise SettingsError("test/development operational roots must share one disposable root")
        if not _is_loopback(self.bind_host) and not self.remote_enabled:
            raise SettingsError("editor binds to loopback unless secure remote mode is explicit")
        if not self.allowed_hosts or not self.allowed_origins:
            raise SettingsError("exact allowed Host and Origin values are required")
        if any("*" in value for value in (*self.allowed_hosts, *self.allowed_origins)):
            raise SettingsError("wildcard Host or Origin values are forbidden")

    def with_workspace(self, workspace: WorkspacePaths) -> Self:
        updated = replace(self, workspace=workspace)
        updated.validate(require_disposable_root=self.environment != "production")
        return updated
