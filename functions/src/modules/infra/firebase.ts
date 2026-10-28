import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { env } from '../../config/env';

/** one firebase-admin app for push + storage, or null when not configured */
export function firebaseApp(): App | null {
  const json = env().FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  const existing = getApps();
  if (existing.length) return existing[0];
  const sa = JSON.parse(json);
  return initializeApp({
    credential: cert(sa),
    storageBucket: env().FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com`,
  });
}
