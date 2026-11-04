import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, Firestore, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, Functions, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, FirebaseStorage, getStorage } from 'firebase/storage';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};
const REGION = 'asia-south1';
/** a local build against `firebase emulators:start` */
const EMULATORS = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1';

export const firebaseConfigured = () => !!config.apiKey && !!config.projectId;

type Services = { app: FirebaseApp; db: Firestore; storage: FirebaseStorage; functions: Functions };
let services: Services | null = null;

/** created on first use in the browser, never during the static build */
export function firebase(): Services {
  if (services) return services;
  const app = getApps().length ? getApp() : initializeApp(config);
  const made = { app, db: getFirestore(app), storage: getStorage(app), functions: getFunctions(app, REGION) };
  if (EMULATORS) {
    connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(made.db, '127.0.0.1', 8080);
    connectStorageEmulator(made.storage, '127.0.0.1', 9199);
    connectFunctionsEmulator(made.functions, '127.0.0.1', 5001);
  }
  services = made;
  return made;
}
