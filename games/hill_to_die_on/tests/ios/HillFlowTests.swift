import XCTest

/// Runs inside the repository's VerifyDeviceRunner, against the installed app.
/// Touches are native XCUITest events; snapshots come from the shared testkit marker.
final class HillFlowTests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.basegamelab.hilltodieon")
    override func setUpWithError() throws {
        continueAfterFailure = false
        // The optional capture tunnel can request a redundant wireless pairing.
        // Decline it; the existing USB trust is sufficient for these tests.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts["Trust This Computer?"]
        if alert.exists && alert.buttons["Don’t Trust"].exists { alert.buttons["Don’t Trust"].tap() }
        let notice = springboard.alerts.firstMatch
        if notice.exists && notice.staticTexts["Device Added to Your Account"].exists && notice.buttons["OK"].exists {
            notice.buttons["OK"].tap()
        }
    }

    func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let text = XCTAttachment(string: marker())
        text.name = name + "-state"; text.lifetime = .keepAlways; add(text)
    }
    func marker() -> String {
        let element = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "tourstate:")).firstMatch
        return element.exists ? element.label : "missing"
    }
    func state() -> [String: Any] {
        let label = marker()
        guard let split = label.firstIndex(of: ";"), let data = String(label[label.index(after: split)...]).data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return json
    }
    func wait(_ seconds: Double) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
    func tap(_ label: String) {
        let button = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 10), "Missing button: \(label)")
        button.tap()
    }
    func aim(_ angle: Double, left: Bool = false) {
        let frame = app.frame
        let x = frame.width * (left ? 0.28 : 0.70), y = frame.height * 0.79
        let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
        let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x + cos(angle) * 42, dy: y + sin(angle) * 42))
        from.press(forDuration: 0.12, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.15)
    }
    func tapContaining(_ label: String) {
        let button = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
        for _ in 0..<5 {
            let nav = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "DEPLOY")).firstMatch
            let isNav = ["DEPLOY", "STRONGHOLD", "UPGRADES", "CHARACTERS"].contains(label)
            // WKWebView may report a partially clipped row as hittable even
            // though its center lies under the fixed bottom navigation.
            let fullyVisible = isNav || !nav.exists || button.frame.maxY < nav.frame.minY - 2
            if button.exists && button.isHittable && fullyVisible { button.tap(); return }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.79))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52)))
        }
        XCTFail("Missing reachable button: \(label)")
    }
    func saved() -> [String: Any] { state()["save"] as? [String: Any] ?? [:] }
    func testMetaProgression() throws {
        app.launch(); wait(3)
        XCTAssertEqual(state()["profile"] as? String, "qa", "Never spend the player's save in a fixture test")
        XCTAssertNotNil(saved()["salvage"], "Requires the separate QA fixture profile")
        let initialUpgrades = saved()["upgrades"] as? [String: Int] ?? [:]
        tapContaining("UPGRADES")
        for _ in (initialUpgrades["power"] ?? 0)..<5 { tapContaining("Heavy ammunition") }
        if initialUpgrades["learning"] == 0 { tapContaining("Field experience") }
        if initialUpgrades["fortune"] == 0 { tapContaining("Lucky charm") }
        for _ in (initialUpgrades["towers"] ?? 0)..<2 { tapContaining("Tower permit") }
        wait(3); capture("meta-01-upgrades")
        let upgrades = saved()["upgrades"] as? [String: Int] ?? [:]
        XCTAssertEqual(upgrades["power"], 5); XCTAssertEqual(upgrades["towers"], 2)
        tapContaining("CHARACTERS")
        if !(saved()["characters"] as? [Int] ?? []).contains(1) { tapContaining("The Firebrand") }
        tapContaining("The Firebrand")
        if !(saved()["characters"] as? [Int] ?? []).contains(2) { tapContaining("The Engineer") }
        tapContaining("The Engineer")
        wait(3); XCTAssertEqual(saved()["character"] as? Int, 2)
        capture("meta-02-engineer")
        tapContaining("The Firebrand"); wait(3)
        XCTAssertEqual(saved()["character"] as? Int, 1)
        capture("meta-03-firebrand")
        tapContaining("STRONGHOLD")
        if !(saved()["weapons"] as? [Int] ?? []).contains(2) { tapContaining("Arc caster") }
        if !(saved()["weapons"] as? [Int] ?? []).contains(3) { tapContaining("Mortar") }
        wait(3); XCTAssertTrue((saved()["weapons"] as? [Int] ?? []).contains(2))
        // Changing slots returns the panel to its top; all changes are real taps.
        tapContaining("DEPLOY"); tapContaining("STRONGHOLD"); tap("3"); tapContaining("Arc caster")
        tapContaining("DEPLOY"); tapContaining("STRONGHOLD"); tap("5"); tapContaining("Mortar")
        tapContaining("DEPLOY"); tapContaining("STRONGHOLD"); tap("2"); tapContaining("Empty this position")
        tapContaining("DEPLOY"); tapContaining("STRONGHOLD"); tap("4"); tapContaining("Wall section")
        wait(3); capture("meta-04-defense-placement")
        XCTAssertEqual((saved()["weapons"] as? [Int])?.sorted(), [0, 1, 2, 3])
        XCTAssertEqual(saved()["layout"] as? [Int], [0, -2, 2, -1, 3, -2, -2, -1])
        let before = saved(), balance = before["salvage"] as? Int
        app.terminate(); app.launch(); wait(3)
        XCTAssertEqual(saved()["salvage"] as? Int, balance)
        XCTAssertEqual(saved()["layout"] as? [Int], before["layout"] as? [Int])
        XCTAssertEqual(saved()["character"] as? Int, 1)
        capture("meta-05-persistent-loadout")
    }
    func testTenWaveLevel() throws {
        app.launch(); wait(3)
        XCTAssertEqual(state()["profile"] as? String, "qa")
        tap("Defend this hill →")
        var won = false
        for step in 0..<180 {
            let snapshot = state(), phase = snapshot["phase"] as? String ?? ""
            let wave = snapshot["wave"] as? Int ?? 1
            if phase == "cards" {
                if wave == 5 || wave == 10 { capture("level-card-wave-\(wave)") }
                let offers = snapshot["offers"] as? [[String: Any]] ?? []
                func score(_ card: [String: Any]) -> Double {
                    let stat = card["stat"] as? String ?? "", scope = card["scope"] as? String ?? ""
                    let offensive = stat == "damage" || stat == "rate"
                    let matchesFlame = scope == "all" || scope == "fire" || scope == "beam" || card["scope"] as? Int == 1
                    return (card["amount"] as? Double ?? 0) * (offensive ? (matchesFlame ? 12 : 6) : stat == "area" ? 3 : stat == "health" ? 2 : 0.01)
                }
                let best = offers.max { score($0) < score($1) }
                tapContaining(best?["name"] as? String ?? "◆"); wait(2.1)
            } else if phase == "ready" {
                XCTAssertTrue((snapshot["towerHp"] as? [Double] ?? []).allSatisfy { $0 == 90 })
                capture("level-repaired-wave-\(wave)"); tap("Defend wave \(wave + 1) →"); wait(2.1)
            } else if phase == "victory" { won = true; capture("level-victory"); break }
            else if phase == "defeat" { capture("level-defeat"); break }
            else {
                aim(snapshot["threatAngle"] as? Double ?? (-Double.pi / 2 + Double(wave - 1) * Double.pi / 2))
                if step % 12 == 0 { capture("level-combat-\(step)") }
                wait(2)
            }
        }
        XCTAssertTrue(won, "Upgraded fixture must be able to clear all ten real-time waves")
        XCTAssertEqual(saved()["unlockedLevel"] as? Int, 2)
        tap("Back to the stronghold →"); tapContaining("Ember Ridge"); tap("Defend this hill →"); wait(5)
        XCTAssertEqual(state()["level"] as? Int, 2); capture("level-two-unlocked")
        tap("Pause"); tap("End run · keep banked salvage")
    }
    func testRealTouchFlow() throws {
        app.launch(); wait(3); capture("01-home")
        tap("Defend this hill →"); wait(4); capture("02-autofire")
        let initialShots = state()["shots"] as? Int ?? 0
        XCTAssertGreaterThan(initialShots, 0, "Autofire must work before any joystick input")
        aim(0); wait(3)
        let aimed = state()["aim"] as? Double ?? -10
        XCTAssertEqual(aimed, 0, accuracy: 0.2, "Native drag must aim right")
        let shots = state()["shots"] as? Int ?? 0
        wait(3); XCTAssertGreaterThan(state()["shots"] as? Int ?? 0, shots, "Release must not stop firing")
        XCTAssertEqual(state()["aim"] as? Double ?? -10, aimed, accuracy: 0.01)
        aim(-Double.pi / 2, left: true); wait(3); capture("03-left-hand-aim")
        tap("Pause"); wait(3); capture("04-paused")
        let pausedShots = state()["shots"] as? Int ?? -1
        wait(3); XCTAssertEqual(state()["shots"] as? Int ?? -2, pausedShots)
        tap("Keep firing →")
        XCUIDevice.shared.press(.home); wait(3); app.activate(); wait(3)
        XCTAssertEqual(state()["paused"] as? Bool, true, "Returning from the background must show a paused run")
        capture("04-background-paused"); tap("Keep firing →")
        for step in 0..<36 {
            let snapshot = state(), phase = snapshot["phase"] as? String ?? ""
            if phase == "cards" {
                capture("05-card-draft")
                let card = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "◆")).firstMatch
                XCTAssertTrue(card.exists); card.tap(); wait(3)
            } else if phase == "ready" {
                capture("06-repaired-wave")
                let wave = snapshot["wave"] as? Int ?? 1
                if wave >= 2 { break }
                tap("Defend wave \(wave + 1) →"); wait(3)
            } else if phase == "defeat" { capture("07-defeat"); break }
            else {
                let wave = snapshot["wave"] as? Int ?? 1
                aim(-Double.pi / 2 + Double(wave - 1) * Double.pi / 2 + sin(Double(step)) * 0.75, left: step % 2 == 0)
                wait(2)
            }
        }
        capture("08-run-state")
        let snapshot = state(); XCTAssertGreaterThan(snapshot["kills"] as? Int ?? 0, 20)
        XCTAssertEqual(snapshot["phase"] as? String, "ready")
        XCTAssertGreaterThanOrEqual(snapshot["wave"] as? Int ?? 0, 2)
        if snapshot["phase"] as? String == "combat" { tap("Pause"); wait(2); tap("End run · keep banked salvage") }
        else if snapshot["phase"] as? String == "ready" { tap("Return home · keep salvage") }
        else if snapshot["phase"] as? String == "defeat" { tap("Back to the stronghold →") }
        wait(3); capture("09-returned-home")
        let banked = state()["salvage"] as? Int ?? 0
        app.terminate(); app.launch(); wait(3)
        XCTAssertEqual(state()["salvage"] as? Int ?? -1, banked, "Banked salvage must survive relaunch")
        capture("10-save-reloaded")
    }

    func testCrowdPerformance() throws {
        app.launch(); wait(5); capture("stress-05s")
        XCTAssertEqual(state()["stress"] as? Bool, true, "Requires an explicit stress build")
        wait(20); capture("stress-25s")
        wait(20); capture("stress-45s")
        let snapshot=state()
        XCTAssertGreaterThan(snapshot["enemies"] as? Int ?? 0, 400)
        XCTAssertGreaterThan(snapshot["shots"] as? Int ?? 0, 30)
        XCTAssertEqual(snapshot["droppedSpawns"] as? Int ?? -1, 0)
        // Timing is attached as measured evidence, not forced into a pass threshold.
        for frame in 0..<12 {
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = String(format: "motion-%02d", frame); image.lifetime = .keepAlways; add(image)
            wait(0.08)
        }
    }
}
