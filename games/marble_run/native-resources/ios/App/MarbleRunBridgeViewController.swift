import Capacitor

@objc(MarbleRunBridgeViewController)
public class MarbleRunBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
        bridge?.registerPluginInstance(AppLovinMaxPlugin())
        bridge?.registerPluginInstance(AppsFlyerAttributionPlugin())
        bridge?.registerPluginInstance(MetaEventsPlugin())
    }
}
