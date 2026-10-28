# INVITE KAROO

Every wedding invitation, every function, one place.

| Folder | What |
| --- | --- |
| `app/` | Flutter app for Android and iOS — guest side and the host's wedding console. See `app/README.md`. |
| `functions/` | The API on **Firebase**: NestJS on Cloud Functions, Firestore, Firebase Auth, Storage, FCM. Served at **https://api.invitekaroo.com**. See `functions/README.md`. |
| `admin/` | Admin Dashboard (Next.js, static) for the Invite Karoo team, on Firebase Hosting at **https://admin.invitekaroo.com**. Team members sign in with email + password. |
| `firebase.json` | Hosting sites (`api` → the function, `admin` → `admin/out`), Firestore rules + indexes, Storage rules, emulators. |
| `.github/workflows/` | `functions.yml` API tests (in-memory + Firebase emulators) · `admin.yml` builds the dashboard · `deploy.yml` deploys to Firebase · `app.yml` Android APK + TestFlight. |

How sign-in works: the app asks the API for a WhatsApp code; the API checks it and returns a Firebase
custom token; the app signs in to Firebase Auth with it and sends the Firebase ID token on every call.
The team signs in to the dashboard with Firebase email/password accounts carrying the `ikRole` claim.
