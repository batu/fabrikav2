/**
 * Ambient type shims for the OPTIONAL Capacitor peer dependencies.
 *
 * `@capacitor/core` and `@capacitor/haptics` are declared as OPTIONAL
 * peerDependencies (see package.json) — they are NOT installed in this
 * monorepo. The real modules arrive with a game's native shell. These
 * shims let `tsc --noEmit` resolve the static imports in the haptics
 * carry, and unit tests supply the runtime behavior via `vi.mock(...)`.
 *
 * Shapes are minimal — only the surface the carry actually touches. If
 * Capacitor renames an enum member, the carry breaks at compile time
 * here (the property the shim's consumers read no longer exists), which
 * is the compile-time-safety property the v1 module was designed for.
 */

declare module '@capacitor/core' {
  export const Capacitor: {
    getPlatform(): 'web' | 'ios' | 'android';
    isNativePlatform(): boolean;
  };
  // Used by the attribution carry to obtain the native `AdjustAttribution`
  // bridge (`registerPlugin<AdjustAttributionPlugin>('AdjustAttribution')`).
  export function registerPlugin<T>(name: string): T;
}

declare module '@capacitor/haptics' {
  export enum ImpactStyle {
    Heavy = 'HEAVY',
    Medium = 'MEDIUM',
    Light = 'LIGHT',
  }
  export enum NotificationType {
    Success = 'SUCCESS',
    Warning = 'WARNING',
    Error = 'ERROR',
  }
  export const Haptics: {
    impact(options: { style: ImpactStyle }): Promise<void>;
    notification(options: { type: NotificationType }): Promise<void>;
  };
}
