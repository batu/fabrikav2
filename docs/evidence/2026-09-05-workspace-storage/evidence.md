# Workspace storage integration evidence

The Bird-only pilot at `3dbd5bebcd861bbd422b4311b893d0cc76a3d236`
passed typecheck and 418 unit tests (three skipped). Native install, device
build and release-path tests passed 39 cases. Owning tool lint and shell syntax
checks passed. Independent reviewers verified the shared output lock and the
required sparse tooling cones after their findings were fixed.

The installed Agency runner built Debug iOS output outside the checkout at
`~/.local/share/agency/build-outputs/2071f226751e2447/find_the_bird-ios-debug-uw0_p56j/DerivedData/Build/Products/Debug-iphoneos/App.app`.
Its ownership manifest identifies the same source commit and successful build.
The canonical verify-device lane installed that exact artifact on the physical
iPhone 12 and completed its XCUITest run. Menu, level, settings, pause, win and
fail captures were gated by their state markers. Menu and gameplay captures
were opened and visually inspected. This verifies the changed output lookup,
install and launch behavior.

Private evidence is retained at
`/Users/base/dev/appletolye/.work/storage-lifecycle/bird-device-evidence-3/`.
The exploratory visual-reference verdict is NO-APPLICABLE-EVIDENCE: there are
no trusted references for these states, the paid panel was explicitly skipped,
and achievement captures were absent. This is not a visual fidelity approval.

Fresh pilots require the existing private native environment and Firebase
plist. Initial attempts lacked those ignored inputs and did not pass device
verification. The final attempt copied the existing release checkout's files,
verified identical bytes and retained restrictive permissions. No secret
contents were logged or committed; no game source fix was required.

The Bird profile omits Dog asset payloads while including its small public
identity config, shared packages, shell fixtures and required editor fixtures.
Existing release staging and rollback reference contracts remain unchanged.
Release builds are durable; Debug builds are scratch with retention review.
No store upload, deployment, branch deletion or automatic cleanup occurred.
