import XCTest

/// Opt-in physical-input journey. Never runs against the installed player identity.
final class FindBirdOnboardingTests: XCTestCase {
    private func shot(_ name: String) {
        autoreleasepool {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private func motion(_ name: String) {
        for frame in 0..<8 {
            shot("\(name)-\(String(format: "%02d", frame))")
            RunLoop.current.run(until: Date().addingTimeInterval(0.12))
        }
    }

    private func settledShot(_ name: String) {
        // Existing page rows stagger for up to 1.2 s; camera recenter takes 350 ms.
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        shot(name)
    }

    private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func testFirstRunWithPhysicalInput() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["FTB_ONBOARDING_QA"] == "1",
              let bundle = env["TARGET_BUNDLE_ID"],
              ["com.basegamelab.findthebird.onboardingqa", "com.basegamelab.findthebird.onboardingfresh"].contains(bundle) else {
            throw XCTSkip("Requires dedicated onboarding QA app; never reset player progress")
        }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: bundle)
        app.activate()
        shot("00-launch")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let notifications = springboard.buttons["Don’t Allow"]
        if notifications.waitForExistence(timeout: 3) { shot("notification-permission"); notifications.tap() }
        let explanation = text(app, "PERSONALIZED ADS")
        if explanation.waitForExistence(timeout: 8) {
            settledShot("01-tracking-explanation")
            app.buttons["Continue"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let deny = springboard.buttons["Ask App Not to Track"]
            if deny.waitForExistence(timeout: 8) { shot("02-native-att"); deny.tap() }
            XCTAssertFalse(explanation.exists, "Continue must dismiss the explanation")
        }
        let play = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Play'")).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 40), "Home play button must appear")
        shot("03-home")
        play.tap()
        let target = app.images["Tutorial target"]
        for (index, label) in ["Tap this bird", "Can you find this one?", "Each bird you find counts here"].enumerated() {
            XCTAssertTrue(text(app, label).waitForExistence(timeout: 40), label)
            XCTAssertTrue(target.waitForExistence(timeout: 5), "Real target bounds must be exposed")
            motion("guided-\(index)")
            if index == 0 {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.43)).tap()
                XCTAssertTrue(text(app, "0/19").exists, "Instruction-stage wrong tap must not advance")
            }
            if index == 1 {
                XCUIDevice.shared.press(.home)
                app.activate()
                XCTAssertTrue(text(app, label).waitForExistence(timeout: 5))
                shot("guided-resumed")
            }
            target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(text(app, "Need a closer look? Pinch to zoom in").waitForExistence(timeout: 10))
        motion("pinch-instruction")
        app.webViews.firstMatch.pinch(withScale: 2.0, velocity: 1.0)
        XCTAssertTrue(text(app, "Drag left to explore the scene").waitForExistence(timeout: 10))
        motion("pan-left-instruction")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.55)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.55)))
        XCTAssertTrue(text(app, "Now drag right").waitForExistence(timeout: 10), "Actual leftward drag must advance")
        motion("pan-right-instruction")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.55)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.55)))
        XCTAssertTrue(text(app, "Now tap this bird").waitForExistence(timeout: 10), "Real pinch must advance lesson")
        settledShot("zoomed-target")
        target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(text(app, "Need help? Tap the hint").waitForExistence(timeout: 10))
        shot("hint-lesson")
        target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(text(app, "Tap the bird inside the hint").waitForExistence(timeout: 10))
        motion("hinted-target")
        target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let handoff = app.buttons["Let’s play"]
        XCTAssertTrue(handoff.waitForExistence(timeout: 10))
        shot("objective")
        handoff.tap()
        XCTAssertFalse(target.exists)
        shot("normal-gameplay")
        app.terminate()
        app.launch()
        if notifications.waitForExistence(timeout: 3) { shot("returning-notification-permission"); notifications.tap() }
        XCTAssertTrue(play.waitForExistence(timeout: 40))
        play.tap()
        XCTAssertTrue(text(app, "0/19").waitForExistence(timeout: 40), "Returning player must actually enter gameplay")
        XCTAssertFalse(text(app, "Tap this bird").exists, "Completed player must skip tutorial on relaunch")
        settledShot("returning-player")
    }

    func testOrdinaryFeedbackAndSettings() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["FTB_ORDINARY_QA"] == "1",
              let bundle = env["TARGET_BUNDLE_ID"],
              ["com.basegamelab.findthebird.onboardingqa", "com.basegamelab.findthebird.onboardingfresh"].contains(bundle) else {
            throw XCTSkip("Requires dedicated QA app after completed onboarding")
        }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: bundle)
        app.activate()
        let notifications = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Don’t Allow"]
        if notifications.waitForExistence(timeout: 3) { notifications.tap() }
        let play = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Play'")).firstMatch
        if play.exists { play.tap() }
        XCTAssertTrue(text(app, "0/19").waitForExistence(timeout: 40))
        XCTAssertFalse(app.images["Tutorial target"].exists)
        // Observed on this QA level at the returning-player 390×844 viewport.
        // These are physical taps; no harness find/win shortcut is invoked.
        for (index, point) in [(0.75, 0.52), (0.19, 0.52), (0.40, 0.36)].enumerated() {
            app.coordinate(withNormalizedOffset: CGVector(dx: point.0, dy: point.1)).tap()
            motion("ordinary-praise-\(index)")
            XCTAssertTrue(text(app, "\(index + 1)/19").exists, "Physical tap must find the visible bird")
        }
        app.buttons["Settings"].tap()
        settledShot("settings-open")
        XCTAssertTrue(text(app, "Settings").waitForExistence(timeout: 5))
        app.buttons["Go back"].tap()
        // Existing page-close behavior returns to Home, then starts a new level attempt.
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        play.tap()
        XCTAssertTrue(text(app, "0/19").waitForExistence(timeout: 40))
        app.buttons["3"].tap()
        XCTAssertTrue(app.buttons["2"].waitForExistence(timeout: 5), "Ordinary hint must consume one wallet hint")
        shot("ordinary-hint")
        app.buttons["Buy more coins"].tap()
        XCTAssertTrue(text(app, "Shop").waitForExistence(timeout: 5))
        settledShot("shop-open")
        app.buttons["Go back"].tap()
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        shot("shop-return")
    }
}
