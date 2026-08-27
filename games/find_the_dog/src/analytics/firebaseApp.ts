import {
  getApps as firebaseGetApps,
  initializeApp as firebaseInitializeApp,
  type FirebaseOptions,
} from 'firebase/app';

export interface FirebaseApp {
  readonly name: string;
}

export type FirebaseEnv = Record<string, string | boolean | undefined>;

export interface FirebaseAppRuntime {
  getApps(): readonly FirebaseApp[];
  initializeApp(options: FirebaseOptions): FirebaseApp;
}

const defaultRuntime: FirebaseAppRuntime = {
  getApps: () => firebaseGetApps(),
  initializeApp: (options) => firebaseInitializeApp(options),
};

export function getFirebaseApp(
  env: FirebaseEnv = import.meta.env,
  runtime: FirebaseAppRuntime = defaultRuntime,
): FirebaseApp | null {
  const options = firebaseOptions(env);
  if (options === null) return null;
  return runtime.getApps().find((app) => app.name === '[DEFAULT]')
    ?? runtime.initializeApp(options);
}

function firebaseOptions(env: FirebaseEnv): FirebaseOptions | null {
  const apiKey = envString(env.VITE_FIREBASE_API_KEY);
  const projectId = envString(env.VITE_FIREBASE_PROJECT_ID);
  const appId = envString(env.VITE_FIREBASE_APP_ID);
  if (apiKey === null || projectId === null || appId === null) return null;

  return {
    apiKey,
    projectId,
    appId,
    ...optionalOption('authDomain', env.VITE_FIREBASE_AUTH_DOMAIN),
    ...optionalOption('storageBucket', env.VITE_FIREBASE_STORAGE_BUCKET),
    ...optionalOption('messagingSenderId', env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    ...optionalOption('measurementId', env.VITE_FIREBASE_MEASUREMENT_ID),
  };
}

function optionalOption(key: string, value: string | boolean | undefined): Record<string, string> {
  const resolved = envString(value);
  return resolved === null ? {} : { [key]: resolved };
}

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
