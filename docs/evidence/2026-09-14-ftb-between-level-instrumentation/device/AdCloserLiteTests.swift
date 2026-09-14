import XCTest

/// Scratch variant of tools/verify-device/runner AdCloserTests for the Find the
/// Bird between-level proof (2026-09-14): no marker scan, one sparse `buttons`
/// query per cycle, screenshots only around a close tap. Keeps the phone awake
/// and taps native full-screen ad close/skip controls while the JS relay drive
/// plays levels.
final class AdCloserLiteTests: XCTestCase {
    private var journal: [String] = []
    private func stamp() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func note(_ line: String) { let e = "\(stamp()) \(line)"; journal.append(e); NSLog("[ad-closer] %@", e) }
    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    override func setUp() { super.setUp(); continueAfterFailure = true }

    func testCloseFullScreenAds() {
        guard let bundleId = ProcessInfo.processInfo.environment["TARGET_BUNDLE_ID"], !bundleId.isEmpty else {
            XCTFail("TARGET_BUNDLE_ID not set"); return
        }
        let seconds = Double(ProcessInfo.processInfo.environment["AD_CLOSER_SECONDS"] ?? "") ?? 600
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.activate()
        note("activated \(bundleId); babysitting for \(Int(seconds))s; queries only while relay flag wants a close")
        RunLoop.current.run(until: Date().addingTimeInterval(10.0))
        let closePredicate = NSPredicate(format: "label CONTAINS[c] 'close' OR label CONTAINS[c] 'skip'")
        let deadline = Date().addingTimeInterval(seconds)
        var closes = 0
        var ticks = 0
        var lastTick = Date()
        let flagURL = URL(string: ProcessInfo.processInfo.environment["FLAG_URL"] ?? "http://192.168.1.98:5321/flag")!
        var lastWant = false
        // First LAN request raises the Local Network privacy prompt for this
        // runner bundle; accept it from SpringBoard (cheap query, not the game).
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        URLSession.shared.dataTask(with: flagURL) { _, _, _ in }.resume()
        RunLoop.current.run(until: Date().addingTimeInterval(3.0))
        for _ in 0..<3 {
            let alert = springboard.alerts.firstMatch
            if alert.exists {
                let allow = alert.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'allow' OR label CONTAINS[c] 'ok'")).firstMatch
                note("springboard alert: '\(alert.label)'")
                shot("local-network-prompt")
                if allow.exists { allow.tap(); note("accepted local network prompt") }
                RunLoop.current.run(until: Date().addingTimeInterval(1.5))
            } else { break }
        }
        var lastFlagError = ""
        while Date() < deadline {
            var want = false
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: flagURL) { data, _, err in
                if let d = data, let s = String(data: d, encoding: .utf8) { want = s.contains("\"want\": true") || s.contains("\"want\":true") }
                if let e = err { let m = e.localizedDescription; if m != lastFlagError { lastFlagError = m; NSLog("[ad-closer] flag fetch error: %@", m) } }
                else if lastFlagError != "" { lastFlagError = ""; NSLog("[ad-closer] flag fetch recovered") }
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 3)
            if want != lastWant { note("flag want=\(want)"); lastWant = want }
            if !want { RunLoop.current.run(until: Date().addingTimeInterval(2.0)); continue }
            let button = app.buttons.matching(closePredicate).firstMatch
            if button.exists && button.isHittable {
                closes += 1
                let label = button.label
                note("close control visible: '\(label)' (#\(closes))")
                shot(String(format: "ad-%02d-before-close", closes))
                button.tap()
                note("tapped '\(label)' (#\(closes))")
                RunLoop.current.run(until: Date().addingTimeInterval(2.0))
                shot(String(format: "ad-%02d-after-close", closes))
            }
            if Date().timeIntervalSince(lastTick) >= 30 {
                ticks += 1; lastTick = Date(); shot(String(format: "tick-%02d", ticks))
            }
            RunLoop.current.run(until: Date().addingTimeInterval(2.0))
        }
        note("done: closes=\(closes) ticks=\(ticks)")
        let a = XCTAttachment(string: journal.joined(separator: "\n")); a.name = "ad-closer-journal"; a.lifetime = .keepAlways; add(a)
    }
}
