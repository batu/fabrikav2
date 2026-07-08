# native-resources/

Source inputs for the Capacitor native shells — app icons, splash screens,
platform resource overlays (e.g. `android-res/`). These are committed **inputs**;
the generated native projects (`ios/`, `android/`) are build artifacts produced
on demand and are **never committed here** (v1's `find_the_dog/ios/` checked in a
2.3GB Xcode build tree — do not repeat it). `capacitor.config.ts` at the game
root points the native build at these resources.
