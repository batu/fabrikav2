import XCTest

/// Committed XCUITest runner template for `verify-device` — the on-device
/// capture lane, generalised from games/marble_run/.work/insitu-runner (the
/// proven pattern, docs/retros/insitu-testing-capability-notes.md). This is a
/// standalone UI-testing bundle: it launches the ALREADY-INSTALLED game app by
/// bundle id and captures a true device screenshot (XCUIScreen) per canonical
/// state, attached to the .xcresult for extraction.
///
/// GENERIC ACROSS GAMES: the target bundle id is injected at run time, not
/// hardcoded, so every game reuses this exact file. `xcodebuild test` forwards
/// env vars prefixed `TEST_RUNNER_` to this process with the prefix stripped, so
/// the CLI passes `TEST_RUNNER_TARGET_BUNDLE_ID=<appId>` and we read
/// `TARGET_BUNDLE_ID` here.
final class InsituTourTests: XCTestCase {
    /// Screenshot dwell cadence — MUST match the allstates insitu tour's
    /// DWELL_MS (6s) in games/<g>/src/testing/insituTour.ts. The tour drives
    /// menu->level->settings->pause->win->fail, dwelling 6s on each; we shoot on
    /// the same beat and stamp the intended canonical state name.
    private let dwellSeconds: UInt32 = 6

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testAllStates() {
        guard let bundleId = ProcessInfo.processInfo.environment["TARGET_BUNDLE_ID"], !bundleId.isEmpty else {
            XCTFail("TARGET_BUNDLE_ID not set — pass TEST_RUNNER_TARGET_BUNDLE_ID=<appId> to xcodebuild test")
            return
        }
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.launch()

        // The allstates tour marks body[data-tour-state] on each state, but
        // XCUITest can't read that WKWebView DOM attr reliably across the bridge,
        // so we capture on the tour's dwell cadence and stamp the intended state.
        // Canonical order mirrors insituTour.ts states + CANONICAL_STATES.
        let order = ["1-menu", "2-level", "3-settings", "4-pause", "5-win", "6-fail"]
        sleep(4) // initial menu dwell before the first shot
        for name in order {
            shot(name)
            sleep(dwellSeconds)
        }
        shot("7-final")
    }
}
