import XCTest

/// Drives the Find games shop purchase flow on the installed app:
/// open shop -> tap the first purchasable product -> wait for the StoreKit sheet ->
/// (MODE=cancel) tap Cancel, or (MODE=buy) tap the sheet's confirm control ->
/// read the product button label afterwards. Screenshots at every step.
/// Env: TARGET_BUNDLE_ID (required), PURCHASE_MODE (cancel|buy, default cancel),
///      PRODUCT_LABEL (substring of the product button label, default "No Ads ").
final class PurchaseFlowTests: XCTestCase {
    private var journal: [String] = []
    private func stamp() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func note(_ line: String) { let e = "\(stamp()) \(line)"; journal.append(e); NSLog("[purchase-flow] %@", e) }
    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    private func wait(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }
    override func setUp() { super.setUp(); continueAfterFailure = true }

    private func firstHittable(_ q: XCUIElementQuery, timeout: Double) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let e = q.firstMatch
            if e.exists && e.isHittable { return e }
            wait(1.0)
        }
        return nil
    }

    func testPurchaseFlow() {
        let env = ProcessInfo.processInfo.environment
        guard let bundleId = env["TARGET_BUNDLE_ID"], !bundleId.isEmpty else { XCTFail("TARGET_BUNDLE_ID not set"); return }
        let mode = env["PURCHASE_MODE"] ?? "cancel"
        let productLabel = env["PRODUCT_LABEL"] ?? "No Ads "
        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.activate()
        note("activated \(bundleId) mode=\(mode) product='\(productLabel)'")
        wait(6.0); shot("00-home")

        if let shop = firstHittable(app.buttons.matching(NSPredicate(format: "label == 'Open shop'")), timeout: 12) {
            shop.tap(); note("tapped Open shop"); wait(3.0); shot("02-shop")
        } else {
            note("no 'Open shop' button; assuming the shop is already open"); shot("02-shop-already")
        }

        let product = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS 'Purchase'", productLabel))
        guard let btn = firstHittable(product, timeout: 15) else {
            note("no purchasable product button matching '\(productLabel)'"); shot("03-no-product"); finish(); return
        }
        note("product button label before: '\(btn.label)'")
        btn.tap(); note("tapped product"); wait(4.0); shot("04-after-tap")

        // StoreKit sheet lives in a remote process; look in the app and in springboard.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let cancelPred = NSPredicate(format: "label ==[c] 'Cancel' OR label ==[c] 'Close' OR label ==[c] 'Dismiss' OR label CONTAINS[c] 'close'")
        var sheetSeen = false
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            if app.buttons.matching(cancelPred).firstMatch.exists || springboard.buttons.matching(cancelPred).firstMatch.exists { sheetSeen = true; break }
            wait(1.0)
        }
        note("storekit sheet visible=\(sheetSeen)"); shot("05-sheet")
        note("app buttons: \(app.buttons.allElementsBoundByIndex.prefix(40).map { $0.label })")
        if springboard.state == .runningForeground || springboard.state == .runningBackground { note("springboard buttons: \(springboard.buttons.allElementsBoundByIndex.prefix(40).map { $0.label })") }
        if sheetSeen {
            if mode == "cancel" {
                let c = app.buttons.matching(cancelPred).firstMatch.exists ? app.buttons.matching(cancelPred).firstMatch : springboard.buttons.matching(cancelPred).firstMatch
                c.tap(); note("tapped Cancel")
                for i in 0..<4 {
                    wait(0.6)
                    let q = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", productLabel)).firstMatch
                    note("t+\(Double(i+1)*0.6)s label: '\(q.exists ? q.label : "?")'")
                    shot(String(format: "06-post-cancel-%d", i))
                }
            } else {
                let buyPred = NSPredicate(format: "label CONTAINS[c] 'purchase' OR label CONTAINS[c] 'buy' OR label CONTAINS[c] 'pay'")
                let host = springboard.buttons.matching(buyPred).firstMatch.exists ? springboard : app
                let b = host.buttons.matching(buyPred).firstMatch
                if b.exists { note("confirm control: '\(b.label)' frame=\(b.frame)"); b.tap(); note("tapped confirm") } else { note("no confirm control found") }
                for i in 0..<6 { wait(1.5); shot(String(format: "06-after-confirm-%d", i)) }
            }
        }
        wait(4.0); shot("07-after-sheet")
        let after = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", productLabel)).firstMatch
        if after.exists { note("product button label after: '\(after.label)'") } else { note("product button not found after") }
        wait(2.0); shot("08-final")
        finish()
    }

    private func finish() {
        let a = XCTAttachment(string: journal.joined(separator: "\n")); a.name = "purchase-flow-journal"; a.lifetime = .keepAlways; add(a)
    }
}
