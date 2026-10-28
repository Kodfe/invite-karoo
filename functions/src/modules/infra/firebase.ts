import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { env } from '../../config/env';

/** running on Google Cloud (Cloud Functions) or against the Firebase emulators */
export const onGoogle = () => !!process.env.K_SERVICE || !!process.env.FUNCTION_TARGET || !!process.env.FUNCTIONS_EMULATOR;
export const usingEmulators = () => !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

/** the firebase-admin app. On Cloud Functions it uses the runtime's own credentials. */
export function adminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];
  const json = env().FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const sa = JSON.parse(json);
    return initializeApp({ credential: cert(sa), projectId: sa.project_id, storageBucket: env().FIREBASE_STORAGE_BUCKET || `${sa.project_id}.firebasestorage.app` });
  }
  return initializeApp({
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || (usingEmulators() ? 'demo-invitekaroo' : undefined),
    storageBucket: env().FIREBASE_STORAGE_BUCKET || undefined,
  });
}

/** the app for push + storage, or null in tests / plain local runs (they log instead) */
export function firebaseApp(): App | null {
  if (onGoogle() || env().FIREBASE_SERVICE_ACCOUNT_JSON) return adminApp();
  return null;
}
