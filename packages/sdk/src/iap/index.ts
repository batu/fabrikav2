/**
 * `@fabrikav2/sdk/iap` — game-agnostic in-app-purchase mechanism, generalized
 * from Find The Dog's shop backend (READ-ONLY v1). The SDK ships the mechanism
 * (catalog schema, purchase/restore service + provider seam, fulfill-once safety,
 * restore state algebra); each game supplies its own grant semantics via injected
 * mappers, wallet, and analytics ports.
 */
export * from './catalog.ts';
export * from './service.ts';
export * from './fake-provider.ts';
export * from './revenuecat-provider.ts';
export * from './fulfillment.ts';
export * from './restore-machine.ts';
