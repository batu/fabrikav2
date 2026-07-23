import Capacitor

@objc(ShellTemplateBridgeViewController)
public class ShellTemplateBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
        bridge?.registerPluginInstance(AppLovinMaxPlugin())
        bridge?.registerPluginInstance(AppsFlyerAttributionPlugin())
        bridge?.registerPluginInstance(MetaEventsPlugin())
    }
}
