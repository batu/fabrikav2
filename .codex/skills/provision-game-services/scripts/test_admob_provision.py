import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name("admob_provision.py")
SPEC = importlib.util.spec_from_file_location("admob_provision", MODULE_PATH)
admob = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(admob)

APP_ID = "ca-app-pub-1234567890123456~1234567890"


def app():
    return {"platform": "IOS", "appId": APP_ID, "linkedAppInfo": {"appStoreId": "6796698146"}}


def unit(kind):
    definitions = admob.FORMATS[kind]
    return {
        "appId": APP_ID,
        "adUnitId": f"ca-app-pub-1234567890123456/{'1' if kind == 'banner' else '2' if kind == 'interstitial' else '3':0>10}",
        "displayName": f"find-the-bird-ios-{kind}",
        "adFormat": definitions["adFormat"],
    }


class FakeClient:
    def __init__(self, apps=None, units=None):
        self.apps = apps or []
        self.units = units or []

    def request(self, method, path, body=None):
        if path.startswith("/v1beta/accounts/example/apps"):
            return {"apps": self.apps}
        if path.startswith("/v1beta/accounts/example/adUnits"):
            return {"adUnits": self.units}
        raise AssertionError(path)


class AdMobProvisionTests(unittest.TestCase):
    def test_missing_app_and_units_are_planned(self):
        state = admob.discover(FakeClient(), "accounts/example", "6796698146", "IOS", "find-the-bird")
        self.assertEqual(admob.classify(state), {
            "blocked": None,
            "createApp": True,
            "createUnits": ["banner", "interstitial", "rewarded"],
        })

    def test_partial_inventory_creates_only_missing_unit(self):
        state = admob.discover(
            FakeClient([app()], [unit("banner"), unit("rewarded")]),
            "accounts/example", "6796698146", "IOS", "find-the-bird",
        )
        self.assertEqual(admob.classify(state)["createUnits"], ["interstitial"])

    def test_converged_inventory_is_idempotent(self):
        state = admob.discover(
            FakeClient([app()], [unit(kind) for kind in admob.FORMATS]),
            "accounts/example", "6796698146", "IOS", "find-the-bird",
        )
        self.assertEqual(admob.classify(state), {"blocked": None, "createApp": False, "createUnits": []})

    def test_duplicate_canonical_unit_fails_closed(self):
        duplicate = unit("banner")
        state = admob.discover(
            FakeClient([app()], [duplicate, {**duplicate, "adUnitId": "ca-app-pub-1234567890123456/9999999999"}]),
            "accounts/example", "6796698146", "IOS", "find-the-bird",
        )
        self.assertEqual(admob.classify(state)["blocked"], "multiple canonical banner units exist")

    def test_wrong_format_fails_closed(self):
        wrong = {**unit("banner"), "adFormat": "INTERSTITIAL"}
        state = admob.discover(
            FakeClient([app()], [wrong]), "accounts/example", "6796698146", "IOS", "find-the-bird",
        )
        self.assertEqual(admob.classify(state)["blocked"], "canonical banner name has the wrong format")

    def test_manifest_contains_public_ids_and_stable_names(self):
        state = admob.discover(
            FakeClient([app()], [unit(kind) for kind in admob.FORMATS]),
            "accounts/example", "6796698146", "IOS", "find-the-bird",
        )
        manifest = admob.public_manifest("find-the-bird", "IOS", "6796698146", state)
        self.assertEqual(manifest["appId"], APP_ID)
        self.assertEqual(manifest["placements"]["rewarded"], "find-the-bird-ios-rewarded")
        self.assertNotIn("access_token", manifest)
        self.assertNotIn("refresh_token", manifest)

    def test_diagnosis_reports_unverified_storefront_with_provider_inventory(self):
        state = admob.discover(FakeClient([app()], [unit("banner")]), "accounts/example", "6796698146", "IOS", "find-the-bird")
        summary = admob.redacted_summary(state, admob.classify(state), storefront_verified=False)
        self.assertFalse(summary["storefront_verified"])
        self.assertEqual(summary["matching_app_count"], 1)
        self.assertEqual(summary["canonical_units"]["banner"], 1)

    def test_apply_rejects_missing_manifest_before_mutation(self):
        with self.assertRaisesRegex(admob.ProvisionError, "apply requires --manifest"):
            admob.validate_apply_preconditions("IOS", "6796698146", "6796698146", None)

    def test_android_apply_fails_closed_without_authoritative_store_verification(self):
        with self.assertRaisesRegex(admob.ProvisionError, "Android linking is blocked"):
            admob.validate_apply_preconditions(
                "ANDROID", "com.example.game", "com.example.game", Path("admob.public.json"),
            )

    def test_limited_create_access_has_an_actionable_error(self):
        error = admob.HttpError(403, {"error": {"status": "PERMISSION_DENIED"}})
        self.assertEqual(
            admob.actionable_error(error),
            "AdMob v1beta mutation access is not enabled; contact the AdMob account manager",
        )

    def test_pending_receipt_preserves_created_object_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / ".admob.provision-receipt.json"
            admob.record_pending(receipt, "app", {"name": "accounts/example/apps/1", "appId": APP_ID})
            payload = __import__("json").loads(receipt.read_text())
            self.assertEqual(payload["pending"], [{"kind": "app", "name": "accounts/example/apps/1", "appId": APP_ID, "adUnitId": None}])

    def test_visible_pending_receipt_is_reconciled_and_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            admob.record_pending(receipt, "app", {"name": "accounts/example/apps/1", "appId": APP_ID})
            state = {"matchingApps": [{**app(), "name": "accounts/example/apps/1"}], "canonicalUnits": {}}
            self.assertTrue(admob.reconcile_receipt(receipt, state))
            self.assertFalse(receipt.exists())

    def test_receipt_does_not_match_a_different_unit_with_the_same_name(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            expected = unit("banner")
            admob.record_pending(receipt, "banner", expected)
            other = {**expected, "adUnitId": "ca-app-pub-1234567890123456/9999999999"}
            state = {"matchingApps": [app()], "canonicalUnits": {"banner": [other]}}
            self.assertFalse(admob.reconcile_receipt(receipt, state))
            self.assertTrue(receipt.exists())

    def test_invisible_pending_receipt_keeps_retry_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            admob.record_pending(receipt, "app", {"name": "accounts/example/apps/1", "appId": APP_ID})
            state = {"matchingApps": [], "canonicalUnits": {}}
            self.assertFalse(admob.reconcile_receipt(receipt, state))
            self.assertTrue(receipt.exists())

    def test_manifest_write_is_atomic_and_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "admob.public.json"
            payload = {"schemaVersion": 1, "enabled": False}
            admob.write_manifest(path, payload)
            first = path.read_text()
            admob.write_manifest(path, payload)
            self.assertEqual(path.read_text(), first)
            self.assertTrue(first.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
