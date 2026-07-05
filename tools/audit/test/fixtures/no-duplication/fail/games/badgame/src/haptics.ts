// v1's failure: a game re-declares an export whose name the shared package
// already owns (core/haptics existed, games rewrote it anyway).
export function safeImpact(): void {
  // local reimplementation instead of importing @fabrikav2/sdk
}
