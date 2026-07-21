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
    private enum TourMarkerResult {
        case reached
        case failed
        case missing
    }

    /// Per-state wait budget. The allstates tour drives menu->level->settings->
    /// pause->win->fail with a long dwell on each and, on arrival, publishes an
    /// accessibility element labelled `tourstate:<state>` (see
    /// @fabrikav2/testkit/testing maybeRunInsituTour, #__tourstate__). We WAIT for that
    /// label before shooting, so the frame we capture is guaranteed to BE the
    /// state we stamp it with — never the previous/next frame. Budget covers the
    /// tour's slowest transition (driveTo is variable-time) plus dwell.
    /// 40s, not 25: the wait for state N starts as soon as state N-1 is shot
    /// (early in N-1's dwell), so the budget must absorb the REMAINDER of that
    /// dwell (~11s) plus the slowest drive (fail: home → level load → taps),
    /// which overran 25s on a cold simulator.
    private let stateTimeout: TimeInterval = 40

    /// Canonical states, tour order. The tour label is `tourstate:<state>`; the
    /// attachment name keeps a "<n>-<state>" order prefix so the CLI's
    /// states.mjs maps it back to the same canonical vocab as the reference lane.
    private let states = ["menu", "level", "settings", "pause", "win", "fail"]

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachText(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitForTourMarker(
        app: XCUIApplication,
        state: String,
        timeout: TimeInterval
    ) -> TourMarkerResult {
        let exactLabel = "tourstate:\(state)"
        let failedLabel = "\(exactLabel)-FAILED"
        // Query staticTexts (the marker publishes role="text"), NOT
        // .descendants(matching: .any): every `.exists` poll forces a
        // synchronous accessibility snapshot served by the app's main thread,
        // and an any-descendants scan of a heavy WKWebView tree at a fast
        // cadence starves the web process on real hardware — the tour's own
        // timers stop firing and every later state reads as "missing" (the
        // 2026-07-22 on-device signature; the simulator is fast enough to
        // mask it). staticTexts + a 1s cadence keeps the interrogation load
        // far below the point where it perturbs the thing it measures.
        let marker = app.staticTexts
            .matching(NSPredicate(format: "label == %@", exactLabel))
            .firstMatch
        let failedMarker = app.staticTexts
            .matching(NSPredicate(format: "label == %@", failedLabel))
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if marker.exists {
                return .reached
            }
            if failedMarker.exists {
                return .failed
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1.0))
        }

        if marker.exists {
            return .reached
        }
        if failedMarker.exists {
            return .failed
        }
        return .missing
    }

    private func waitForViewportMetrics(
        app: XCUIApplication,
        state: String,
        timeout: TimeInterval
    ) -> String? {
        let prefix = "viewportmetrics:state=tourstate:\(state);"
        // staticTexts + slow cadence for the same main-thread-starvation
        // reason as waitForTourMarker above.
        let marker = app.staticTexts
            .matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if marker.exists {
                return marker.label
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }

        return marker.exists ? marker.label : nil
    }

    func testAllStates() {
        guard let bundleId = ProcessInfo.processInfo.environment["TARGET_BUNDLE_ID"], !bundleId.isEmpty else {
            XCTFail("TARGET_BUNDLE_ID not set — pass TEST_RUNNER_TARGET_BUNDLE_ID=<appId> to xcodebuild test")
            return
        }
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.launch()

        // SYSTEM-ALERT SWEEP: any OS permission dialog (from THIS app or queued by
        // another app) photobombs every capture and tanks the visual panel. Sweep
        // Springboard for alerts and dismiss them, preferring the non-granting
        // button so a capture run never silently grants a permission.
        dismissSystemAlerts()

        // ELEMENT-GATED CAPTURE (replaces the old fixed-interval sleep cadence).
        // The allstates tour publishes `tourstate:<state>` on a hidden a11y element
        // (#__tourstate__, role=text) as it CONFIRMS each state via the harness
        // snapshot. The WKWebView surfaces that element's aria-label to the native
        // accessibility tree, so we can WAIT for the exact state before shooting.
        // A state that never appears is a LOUD XCTFail — a missing state is never a
        // silent wrong-frame. Proven bug this kills: timed capture shot menu/level
        // while stamping settings/fail (docs/evidence/2026-07-06-2315-paired/ +
        // docs/retros/fidelity-diff-mistakes-ledger.md).
        for (index, state) in states.enumerated() {
            let name = "\(index + 1)-\(state)"
            switch waitForTourMarker(app: app, state: state, timeout: stateTimeout) {
            case .reached:
                if let metrics = waitForViewportMetrics(app: app, state: state, timeout: 2) {
                    attachText("\(name)-viewportmetrics", metrics)
                } else {
                    attachText("\(name)-viewportmetrics-MISSING", "viewportmetrics:state=tourstate:\(state);missing=true")
                    XCTFail("state '\(state)' reached tourstate:\(state), but did not publish viewportmetrics "
                        + "within 2s. Device geometry must be machine-readable in verify-device summary.json.")
                }
                shot(name)
            case .failed:
                shot("\(name)-MISSING")
                XCTFail("state '\(state)' published tourstate:\(state)-FAILED within \(Int(stateTimeout))s — "
                    + "the tour explicitly reported that driveTo('\(state)') did not reach the state. "
                    + "A failed state is a loud failure, not a silent wrong frame.")
            case .missing:
                // Attach whatever is on screen so the failure is inspectable, then
                // fail loudly — the CLI verdict also flags the missing state.
                shot("\(name)-MISSING")
                // The app-side accessibility tree is the difference between "the
                // tour never published" and "it published where XCUITest cannot
                // see it" — attach it so a missing state is self-diagnosing.
                attachText("\(name)-ax-tree", app.debugDescription)
                XCTFail("state '\(state)' never published tourstate:\(state) within \(Int(stateTimeout))s — "
                    + "the tour did not reach it (or the harness/tour flag is off). "
                    + "A missing state is a loud failure, not a silent wrong frame.")
            }
        }
    }

    /// Dismiss any Springboard alert covering the screen. Prefers deny-style
    /// buttons; falls back to the first button so an unknown dialog still clears.
    private func dismissSystemAlerts() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            let alert = springboard.alerts.firstMatch
            guard alert.waitForExistence(timeout: 1.5) else { return }
            let preferred = ["Don’t Allow", "Don't Allow", "Not Now", "Later", "Cancel", "OK", "Dismiss"]
            var tapped = false
            for label in preferred where alert.buttons[label].exists {
                alert.buttons[label].tap()
                tapped = true
                break
            }
            if !tapped {
                let first = alert.buttons.firstMatch
                if first.exists { first.tap() } else { return }
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }
}
