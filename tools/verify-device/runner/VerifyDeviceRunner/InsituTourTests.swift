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
    /// games/<g>/src/testing/insituTour.ts, #__tourstate__). We WAIT for that
    /// label before shooting, so the frame we capture is guaranteed to BE the
    /// state we stamp it with — never the previous/next frame. Budget covers the
    /// tour's slowest transition (driveTo is variable-time) plus dwell.
    private let stateTimeout: TimeInterval = 25

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
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", exactLabel))
            .firstMatch
        let failedMarker = app.descendants(matching: .any)
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
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
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
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            if marker.exists {
                return marker.label
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
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
                XCTFail("state '\(state)' never published tourstate:\(state) within \(Int(stateTimeout))s — "
                    + "the tour did not reach it (or the harness/tour flag is off). "
                    + "A missing state is a loud failure, not a silent wrong frame.")
            }
        }
    }
}
