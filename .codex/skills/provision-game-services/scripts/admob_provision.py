#!/usr/bin/env python3
"""Discover and converge one AdMob platform app without exposing OAuth material."""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

MONETIZATION_SCOPE = "https://www.googleapis.com/auth/admob.monetization"
READONLY_SCOPE = "https://www.googleapis.com/auth/admob.readonly"
APP_ID_RE = re.compile(r"^ca-app-pub-\d{16}~\d{10}$")
UNIT_ID_RE = re.compile(r"^ca-app-pub-\d{16}/\d{10}$")
FORMATS = {
    "banner": {"adFormat": "BANNER", "adTypes": ["RICH_MEDIA"]},
    "interstitial": {"adFormat": "INTERSTITIAL", "adTypes": ["RICH_MEDIA", "VIDEO"]},
    "rewarded": {
        "adFormat": "REWARDED",
        "adTypes": ["RICH_MEDIA", "VIDEO"],
        "rewardSettings": {"unitAmount": "1", "unitType": "reward"},
    },
}


class ProvisionError(RuntimeError):
    pass


class HttpError(ProvisionError):
    def __init__(self, status: int, payload: dict):
        self.status = status
        self.payload = payload
        code = payload.get("error", {}).get("status", "HTTP_ERROR")
        super().__init__(f"{code} ({status})")


class AdMobClient:
    def __init__(self, token: str, base_url: str = "https://admob.googleapis.com"):
        self.token = token
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            try:
                payload = json.loads(error.read())
            except (json.JSONDecodeError, UnicodeError):
                payload = {"error": {"status": "HTTP_ERROR"}}
            raise HttpError(error.code, payload) from None


def protected_file(path: Path) -> None:
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ProvisionError(f"credential file must be owner-only, regular, and non-symlinked: {path.name}")


def credentials_from_keychain(service: str, account: str | None) -> dict:
    command = ["security", "find-generic-password", "-s", service]
    if account:
        command += ["-a", account]
    command += ["-w"]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise ProvisionError(f"Keychain item not found for service {service}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ProvisionError("Keychain credential payload is not JSON") from None


def credentials_from_file(path: Path) -> dict:
    protected_file(path)
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        raise ProvisionError(f"credential file is not valid JSON: {path.name}") from None


def normalize_credentials(payload: dict) -> dict[str, str]:
    client = payload.get("installed") or payload.get("web") or payload
    required = ("client_id", "client_secret", "refresh_token")
    missing = [key for key in required if not isinstance(client.get(key), str) or not client[key]]
    if missing:
        raise ProvisionError(f"credential payload lacks: {', '.join(missing)}")
    return {key: client[key] for key in required}


def refresh_access_token(credentials: dict[str, str]) -> str:
    form = urllib.parse.urlencode({
        "client_id": credentials["client_id"],
        "client_secret": credentials["client_secret"],
        "refresh_token": credentials["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    request = urllib.request.Request("https://oauth2.googleapis.com/token", data=form, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            reason = json.loads(error.read()).get("error", "oauth_error")
        except json.JSONDecodeError:
            reason = "oauth_error"
        raise ProvisionError(f"OAuth refresh failed: {reason}") from None
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise ProvisionError("OAuth refresh returned no access token")
    return token


def oauth2l_credentials(credentials_file: Path, cache_file: Path) -> dict[str, str]:
    """Adopt an oauth2l refresh token without printing it."""
    protected_file(credentials_file)
    protected_file(cache_file)
    client_payload = json.loads(credentials_file.read_text())
    client = client_payload.get("installed") or client_payload.get("web") or {}
    cache = json.loads(cache_file.read_text())
    for encoded_key, encoded_value in cache.items():
        key = json.loads(encoded_key)
        cached_client = json.loads(key["CredentialsJSON"]).get("installed", {})
        scopes = set(key.get("Scope", "").split())
        if (
            cached_client.get("client_id") == client.get("client_id")
            and cached_client.get("client_secret") == client.get("client_secret")
            and {READONLY_SCOPE, MONETIZATION_SCOPE}.issubset(scopes)
        ):
            token_payload = json.loads(base64.b64decode(encoded_value))
            return normalize_credentials({**client, "refresh_token": token_payload.get("refresh_token")})
    raise ProvisionError("oauth2l cache has no matching AdMob monetization refresh grant")


def storefront_bundle(store_id: str, country: str) -> str | None:
    url = "https://itunes.apple.com/lookup?" + urllib.parse.urlencode({"id": store_id, "country": country})
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.loads(response.read())
    if payload.get("resultCount") != 1:
        return None
    bundle = payload["results"][0].get("bundleId")
    return bundle if isinstance(bundle, str) else None


def verified_store_identity(platform: str, store_id: str, bundle_id: str, country: str) -> str:
    if platform != "IOS":
        raise ProvisionError("Android linking is blocked until authoritative Google Play identity verification is implemented")
    bundle = storefront_bundle(store_id, country)
    if bundle is None:
        raise ProvisionError("storefront listing has not propagated")
    if bundle != bundle_id:
        raise ProvisionError("storefront bundle identity does not match the requested game")
    return bundle


def list_all(client: AdMobClient, path: str, field: str) -> list[dict]:
    result: list[dict] = []
    token: str | None = None
    while True:
        suffix = f"{'&' if '?' in path else '?'}pageToken={urllib.parse.quote(token)}" if token else ""
        payload = client.request("GET", path + suffix)
        result.extend(payload.get(field, []))
        token = payload.get("nextPageToken")
        if not token:
            return result


def canonical_names(game_slug: str, platform: str) -> dict[str, str]:
    return {kind: f"{game_slug}-{platform.lower()}-{kind}" for kind in FORMATS}


def discover(client: AdMobClient, account: str, store_id: str, platform: str, game_slug: str) -> dict:
    apps = list_all(client, f"/v1beta/{account}/apps?pageSize=100", "apps")
    units = list_all(client, f"/v1beta/{account}/adUnits?pageSize=100", "adUnits")
    matching_apps = [
        app for app in apps
        if app.get("platform") == platform and app.get("linkedAppInfo", {}).get("appStoreId") == store_id
    ]
    names = canonical_names(game_slug, platform)
    app_ids = {app.get("appId") for app in matching_apps}
    canonical_units = {
        kind: [unit for unit in units if unit.get("appId") in app_ids and unit.get("displayName") == name]
        for kind, name in names.items()
    }
    return {
        "matchingApps": matching_apps,
        "canonicalUnits": canonical_units,
        "extraUnitCount": len([unit for unit in units if unit.get("appId") in app_ids and unit.get("displayName") not in names.values()]),
    }


def classify(state: dict) -> dict:
    if len(state["matchingApps"]) > 1:
        return {"blocked": "multiple linked apps match the exact store identity"}
    for kind, units in state["canonicalUnits"].items():
        if len(units) > 1:
            return {"blocked": f"multiple canonical {kind} units exist"}
        if units and units[0].get("adFormat") != FORMATS[kind]["adFormat"]:
            return {"blocked": f"canonical {kind} name has the wrong format"}
    return {
        "blocked": None,
        "createApp": len(state["matchingApps"]) == 0,
        "createUnits": [kind for kind, units in state["canonicalUnits"].items() if not units],
    }


def create_app(client: AdMobClient, account: str, store_id: str, platform: str) -> dict:
    return client.request("POST", f"/v1beta/{account}/apps", {
        "platform": platform,
        "linkedAppInfo": {"appStoreId": store_id},
    })


def create_unit(client: AdMobClient, account: str, app_id: str, name: str, kind: str) -> dict:
    return client.request("POST", f"/v1beta/{account}/adUnits", {
        "appId": app_id,
        "displayName": name,
        **FORMATS[kind],
    })


def public_manifest(game_slug: str, platform: str, store_id: str, state: dict) -> dict:
    app = state["matchingApps"][0]
    units = {kind: matches[0]["adUnitId"] for kind, matches in state["canonicalUnits"].items()}
    if not APP_ID_RE.fullmatch(app.get("appId", "")) or not all(UNIT_ID_RE.fullmatch(value) for value in units.values()):
        raise ProvisionError("provider readback returned malformed public identifiers")
    return {
        "schemaVersion": 1,
        "game": game_slug,
        "platform": platform.lower(),
        "storeId": store_id,
        "enabled": True,
        "appId": app["appId"],
        "adUnits": units,
        "placements": canonical_names(game_slug, platform),
    }


def write_manifest(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def receipt_path(manifest: Path) -> Path:
    return manifest.parent.parent / ".work" / "admob-provision-receipt.json"


def record_pending(receipt: Path, kind: str, provider_object: dict) -> None:
    existing = json.loads(receipt.read_text()) if receipt.exists() else {"pending": []}
    existing["pending"].append({
        "kind": kind,
        "name": provider_object.get("name"),
        "appId": provider_object.get("appId"),
        "adUnitId": provider_object.get("adUnitId"),
    })
    write_manifest(receipt, existing)


def reconcile_receipt(receipt: Path, state: dict) -> bool:
    if not receipt.exists():
        return True
    payload = json.loads(receipt.read_text())
    for pending in payload.get("pending", []):
        candidates = state["matchingApps"] if pending.get("kind") == "app" else state["canonicalUnits"].get(pending.get("kind"), [])
        expected = {field: pending.get(field) for field in ("name", "appId", "adUnitId") if pending.get(field) is not None}
        if not expected:
            return False
        if not any(all(item.get(field) == value for field, value in expected.items()) for item in candidates):
            return False
    receipt.unlink()
    return True


def wait_for_state(client: AdMobClient, account: str, store_id: str, platform: str, game_slug: str, predicate) -> dict:
    for attempt in range(6):
        state = discover(client, account, store_id, platform, game_slug)
        if predicate(state):
            return state
        if attempt < 5:
            time.sleep(2)
    raise ProvisionError("created provider object is not visible yet; preserve the provision receipt and retry diagnosis later")


def actionable_error(error: Exception) -> str:
    if isinstance(error, HttpError):
        status = error.payload.get("error", {}).get("status", "HTTP_ERROR")
        if error.status == 403 and status == "PERMISSION_DENIED":
            return "AdMob v1beta mutation access is not enabled; contact the AdMob account manager"
        if error.status == 401:
            return "AdMob rejected the refreshed credential; repeat OAuth consent for the required scopes"
    return str(error)


def validate_apply_preconditions(platform: str, store_id: str, confirm_link: str | None, manifest: Path | None) -> None:
    if manifest is None:
        raise ProvisionError("apply requires --manifest")
    if confirm_link != store_id:
        raise ProvisionError("apply requires --confirm-link equal to the exact store ID")
    if platform != "IOS":
        raise ProvisionError("Android linking is blocked until authoritative Google Play identity verification is implemented")


def redacted_summary(state: dict, plan: dict, storefront_verified: bool | None = None) -> dict:
    return {
        "storefront_verified": storefront_verified,
        "matching_app_count": len(state["matchingApps"]),
        "canonical_units": {kind: len(units) for kind, units in state["canonicalUnits"].items()},
        "extra_unit_count": state["extraUnitCount"],
        "blocked": plan.get("blocked"),
        "create_app": plan.get("createApp", False),
        "create_units": plan.get("createUnits", []),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("diagnose", "apply"))
    parser.add_argument("--account", required=True, help="AdMob account resource, e.g. accounts/pub-...")
    parser.add_argument("--game-slug", required=True)
    parser.add_argument("--platform", choices=("IOS", "ANDROID"), required=True)
    parser.add_argument("--store-id", required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--country", default="us")
    parser.add_argument("--manifest", type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--credentials-file", type=Path)
    source.add_argument("--keychain-service")
    source.add_argument("--oauth2l-credentials", type=Path)
    parser.add_argument("--oauth2l-cache", type=Path, default=Path("~/.oauth2l").expanduser())
    parser.add_argument("--keychain-account")
    parser.add_argument("--confirm-link", help="Must equal the store ID for apply")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        if args.oauth2l_credentials:
            credentials = oauth2l_credentials(args.oauth2l_credentials, args.oauth2l_cache)
        elif args.credentials_file:
            credentials = normalize_credentials(credentials_from_file(args.credentials_file))
        else:
            credentials = normalize_credentials(credentials_from_keychain(args.keychain_service, args.keychain_account))
        client = AdMobClient(refresh_access_token(credentials))
        storefront_verified: bool | None = None
        if args.platform == "IOS":
            try:
                verified_store_identity(args.platform, args.store_id, args.bundle_id, args.country)
                storefront_verified = True
            except ProvisionError:
                storefront_verified = False
        state = discover(client, args.account, args.store_id, args.platform, args.game_slug)
        plan = classify(state)
        print(json.dumps(redacted_summary(state, plan, storefront_verified), sort_keys=True))
        if args.command == "diagnose":
            return
        validate_apply_preconditions(args.platform, args.store_id, args.confirm_link, args.manifest)
        if storefront_verified is not True:
            raise ProvisionError("storefront identity is not verified; apply is blocked")
        receipt = receipt_path(args.manifest)
        if not reconcile_receipt(receipt, state):
            raise ProvisionError(f"pending provision receipt is not visible in provider readback: {receipt.name}; retry diagnosis later")
        if plan.get("blocked"):
            raise ProvisionError(plan["blocked"])
        if plan["createApp"]:
            created_app = create_app(client, args.account, args.store_id, args.platform)
            record_pending(receipt, "app", created_app)
            state = wait_for_state(
                client, args.account, args.store_id, args.platform, args.game_slug,
                lambda candidate: len(candidate["matchingApps"]) == 1,
            )
        else:
            state = discover(client, args.account, args.store_id, args.platform, args.game_slug)
        plan = classify(state)
        if plan.get("blocked") or len(state["matchingApps"]) != 1:
            raise ProvisionError(plan.get("blocked") or "created app was not readable by exact identity")
        app_id = state["matchingApps"][0]["appId"]
        names = canonical_names(args.game_slug, args.platform)
        for kind in plan["createUnits"]:
            created_unit = create_unit(client, args.account, app_id, names[kind], kind)
            record_pending(receipt, kind, created_unit)
            state = wait_for_state(
                client, args.account, args.store_id, args.platform, args.game_slug,
                lambda candidate, unit_kind=kind: len(candidate["canonicalUnits"][unit_kind]) == 1,
            )
            after = classify(state)
            if after.get("blocked") or len(state["canonicalUnits"][kind]) != 1:
                raise ProvisionError(f"created {kind} unit was not readable by exact identity")
        state = discover(client, args.account, args.store_id, args.platform, args.game_slug)
        final_plan = classify(state)
        if final_plan.get("blocked") or final_plan["createApp"] or final_plan["createUnits"]:
            raise ProvisionError("provider did not converge to the canonical state")
        write_manifest(args.manifest, public_manifest(args.game_slug, args.platform, args.store_id, state))
        receipt.unlink(missing_ok=True)
        print(json.dumps({"ok": True, "manifest": str(args.manifest), "converged": True}, sort_keys=True))
    except (ProvisionError, OSError, urllib.error.URLError) as error:
        print(json.dumps({"ok": False, "error": actionable_error(error)}), file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
