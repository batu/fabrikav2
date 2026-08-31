import { describe, expect, it, vi } from 'vitest';

import { getFirebaseApp } from '../../src/analytics/firebaseApp';

const completeEnv = {
  VITE_FIREBASE_API_KEY: 'api-key',
  VITE_FIREBASE_PROJECT_ID: 'find-the-dog-basegamelab',
  VITE_FIREBASE_APP_ID: 'firebase-app-id',
  VITE_FIREBASE_AUTH_DOMAIN: 'find-the-dog-basegamelab.firebaseapp.com',
  VITE_FIREBASE_STORAGE_BUCKET: 'find-the-dog-basegamelab.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '575881533603',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-EXAMPLE',
};

describe('Firebase app composition', () => {
  it('stays disabled when required Firebase configuration is incomplete', () => {
    const initializeApp = vi.fn();
    const app = getFirebaseApp({}, { getApps: () => [], initializeApp });

    expect(app).toBeNull();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('initializes the default Firebase app from the configured FTD project', () => {
    const initialized = { name: '[DEFAULT]' };
    const initializeApp = vi.fn(() => initialized);
    const app = getFirebaseApp(completeEnv, { getApps: () => [], initializeApp });

    expect(app).toBe(initialized);
    expect(initializeApp).toHaveBeenCalledWith({
      apiKey: 'api-key',
      projectId: 'find-the-dog-basegamelab',
      appId: 'firebase-app-id',
      authDomain: 'find-the-dog-basegamelab.firebaseapp.com',
      storageBucket: 'find-the-dog-basegamelab.firebasestorage.app',
      messagingSenderId: '575881533603',
      measurementId: 'G-EXAMPLE',
    });
  });

  it('reuses the initialized default app', () => {
    const existing = { name: '[DEFAULT]' };
    const initializeApp = vi.fn();
    const app = getFirebaseApp(completeEnv, {
      getApps: () => [{ name: 'diagnostic' }, existing],
      initializeApp,
    });

    expect(app).toBe(existing);
    expect(initializeApp).not.toHaveBeenCalled();
  });
});
