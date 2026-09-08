import XCTest

/// Companion to the Find The Dog ad-lifecycle device drive
/// (games/find_the_dog/src/testing/AdLifecycleDrive.ts). Launches the already
/// installed game by bundle id, then for `AD_CLOSER_SECONDS` (default 300):
///   - reads the drive's `addrive:<seq>:<line>` accessibility marker (same
///     mechanism as the insitu tour's `tourstate:` marker) and journals every
///     new line with a wall-clock timestamp;
///   - every other cycle looks for a native full-screen ad close / skip button
///     and taps it, attaching a device screenshot before and after;
///   - attaches a periodic tick screenshot.
///
/// Accessibility interrogation is deliberately sparse (one `staticTexts` or
/// one `buttons` query per ~1.2 s) because every `.exists` forces a hierarchy
/// snapshot served by the app's main thread; a dense scan of the WKWebView
/// tree starved the app and got the runner killed on the first attempt.
///
/// Inputs (forwarded by xcodebuild with the TEST_RUNNER_ prefix stripped):
///   TARGET_BUNDLE_ID   required
///   AD_CLOSER_SECONDS  optional, total babysit duration
final class AdCloserTests: XCTestCase {
    private var journal: [String] = []

    private func stamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func note(_ line: String) {
        let entry = "\(stamp()) \(line)"
        journal.append(entry)
        NSLog("[ad-closer] %@", entry)
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    override func setUp() {
        super.setUp()
        // A marker that vanishes between `exists` and `label` (scene change,
        // modal hiding the body-level element) must not end the babysit.
        continueAfterFailure = true
    }

    func testCloseFullScreenAdsWhileDriveRuns() {
        guard let bundleId = ProcessInfo.processInfo.environment["TARGET_BUNDLE_ID"], !bundleId.isEmpty else {
            XCTFail("TARGET_BUNDLE_ID not set — pass TEST_RUNNER_TARGET_BUNDLE_ID=<appId> to xcodebuild test")
            return
        }
        let seconds = Double(ProcessInfo.processInfo.environment["AD_CLOSER_SECONDS"] ?? "") ?? 300
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.launch()
        note("launched \(bundleId); babysitting for \(Int(seconds))s")
        // Let the WebView boot (Phaser + level load) before the first snapshot.
        RunLoop.current.run(until: Date().addingTimeInterval(8.0))
        shot("00-launch")

        let closePredicate = NSPredicate(format: "label CONTAINS[c] 'close' OR label CONTAINS[c] 'skip'")
        let deadline = Date().addingTimeInterval(seconds)
        var closes = 0
        var ticks = 0
        var cycle = 0
        var lastSeq = 0
        var lastTick = Date()
        while Date() < deadline {
            cycle += 1
            if cycle % 2 == 1 {
                if let label = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'addrive:'")).allElementsBoundByIndex.first?.label {
                    let parts = label.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
                    if parts.count == 3, let seq = Int(parts[1]), seq != lastSeq {
                        lastSeq = seq
                        note("drive#\(seq) \(parts[2])")
                    }
                }
            } else {
                let button = app.buttons.matching(closePredicate).firstMatch
                if button.exists && button.isHittable {
                    closes += 1
                    let label = button.label
                    note("close control visible: '\(label)' (#\(closes))")
                    shot(String(format: "ad-%02d-before-close", closes))
                    button.tap()
                    note("tapped '\(label)' (#\(closes))")
                    RunLoop.current.run(until: Date().addingTimeInterval(1.5))
                    shot(String(format: "ad-%02d-after-close", closes))
                }
            }
            if Date().timeIntervalSince(lastTick) >= 20 {
                ticks += 1
                lastTick = Date()
                shot(String(format: "tick-%02d", ticks))
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        }
        note("done: closes=\(closes) ticks=\(ticks) lastDriveSeq=\(lastSeq)")
        let attachment = XCTAttachment(string: journal.joined(separator: "\n"))
        attachment.name = "ad-closer-journal"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
