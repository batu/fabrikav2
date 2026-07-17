import Capacitor

@objc(FindTheDogBridgeViewController)
public class FindTheDogBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
        bridge?.registerPluginInstance(AppLovinMaxPlugin())
        bridge?.registerPluginInstance(AdjustAttributionPlugin())
    }
}
