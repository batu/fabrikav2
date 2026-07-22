"""U7 import-boundary contract: every forbidden dependency edge is rejected.

The rules are the plan's exact boundary sentences, checked statically over
the real source tree so a regression cannot hide behind lazy imports:
- Job core (jobs/models, jobs/store, jobs/worker) imports no FTD domain
  module and no FastAPI.
- Domain/image/prompt code (domain/, prompts/, models/, generation/) imports
  no FastAPI, no UI, and no JobStore.
- Route modules (app, jobs/actions, sessions/routes) own no persistence or
  provider machinery (no sqlite3, no low-level fs module, no generation).
- Only SessionStore owns session locking: fcntl/threading stay confined to
  the known lock owners.
- No package __init__ re-exports anything (no compatibility barrels).
"""

from __future__ import annotations

import ast
from pathlib import Path

import ftd_editor

PACKAGE_ROOT = Path(ftd_editor.__file__).parent

FTD_DOMAIN_PACKAGES = ("sessions", "generation", "prompts", "domain", "models")
LOCK_OWNER_MODULES = {"fs.py", "jobs/store.py", "jobs/worker.py", "sessions/store.py"}


def _imports(path: Path) -> set[str]:
    """Absolute and package-relative import targets of one module."""

    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                found.add("." * node.level + module)
            else:
                found.add(module)
    return found


def _module_map() -> dict[str, set[str]]:
    return {
        path.relative_to(PACKAGE_ROOT).as_posix(): _imports(path)
        for path in sorted(PACKAGE_ROOT.rglob("*.py"))
    }


def _touches(imports: set[str], *needles: str) -> set[str]:
    """Imports that reach a needle package; a module's own sibling imports
    (single-dot relative) never cross a package boundary and are ignored
    when the needle names an FTD package."""

    found: set[str] = set()
    for imported in imports:
        sibling = imported.startswith(".") and not imported.startswith("..")
        normalized = imported.lstrip(".")
        for needle in needles:
            if needle in FTD_DOMAIN_PACKAGES and sibling:
                continue
            if needle in normalized:
                found.add(imported)
    return found


def test_job_core_imports_no_ftd_domain_module() -> None:
    modules = _module_map()
    for name in ("jobs/models.py", "jobs/store.py", "jobs/worker.py"):
        forbidden = _touches(modules[name], *FTD_DOMAIN_PACKAGES, "fastapi")
        assert not forbidden, f"{name} must stay FTD-agnostic, found {sorted(forbidden)}"


def test_domain_and_image_code_imports_no_fastapi_ui_or_jobstore() -> None:
    modules = _module_map()
    for name, imports in modules.items():
        if not name.startswith(("domain/", "prompts/", "models/", "generation/")):
            continue
        forbidden = _touches(imports, "fastapi", "starlette", "pydantic", "jobs.store")
        assert not forbidden, f"{name} crosses the domain boundary: {sorted(forbidden)}"


def test_routes_own_no_persistence_or_provider_machinery() -> None:
    modules = _module_map()
    for name in ("app.py", "jobs/actions.py", "sessions/routes.py"):
        forbidden = _touches(modules[name], "sqlite3", "generation", "fcntl", ".fs")
        assert not forbidden, f"{name} must delegate persistence/providers: {sorted(forbidden)}"


def test_session_locking_is_confined_to_known_owners() -> None:
    modules = _module_map()
    for name, imports in modules.items():
        if "fcntl" in imports or "threading" in imports:
            assert name in LOCK_OWNER_MODULES, f"{name} imports process-lock machinery"


def test_no_package_init_re_exports_anything() -> None:
    for init in sorted(PACKAGE_ROOT.rglob("__init__.py")):
        name = init.relative_to(PACKAGE_ROOT).as_posix()
        if name == "generation/__init__.py":
            # Handler-registry composition root, not a re-export barrel.
            continue
        assert not _imports(init), f"{name} is a re-export barrel"
