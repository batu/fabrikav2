// VIOLATION (a): a LOCAL withTimeout shadows the shared sdk export — the
// finding-2 footgun (this local resolves-void, the shared one rejects).
const withTimeout = async (promise: Promise<unknown>): Promise<void> => {
  await promise;
};
export function runCoordinator(): void { void withTimeout; }
