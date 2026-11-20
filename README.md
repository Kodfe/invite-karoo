# INVITE KAROO

Every wedding invitation, every function, one place.

## Where things run

| Part | Runs on |
| --- | --- |
| The API and the Admin Dashboard | **Vercel**, one project (Root Directory `functions`), one address |
| Reminders and WhatsApp sending | **Vercel Cron**, every minute |
| Data | **Firebase**: Firestore (database), Firebase Auth (sign-in), Storage (files), Cloud Messaging (push) |
| The phone app | built on a computer with Flutter; see `app/README.md` |

There is no other CI: every Vercel deploy typechecks and tests the API, builds the dashboard, and only goes
live if all of that passes.

## Folders

| Folder | What |
| --- | --- |
| `app/` | Flutter app for Android and iOS — guest side and the host's wedding console. See `app/README.md`. |
| `functions/` | The API, plus the Vercel project that serves it and the dashboard (`vercel.json`). See `functions/README.md`. |
| `admin/` | Admin Dashboard (Next.js, static) for the Invite Karoo team. The browser works in Firestore and Storage under the security rules; the rest goes through the API. See `admin/README.md`. |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Who may read and write what in Firebase. Deployed from a computer: `npx firebase-tools deploy --only firestore,storage`. |
| `firebase.json` | Those rules, plus the local emulators the tests use. |

How sign-in works: the app asks the API for a WhatsApp code; the API checks it and returns a Firebase
custom token; the app signs in to Firebase Auth with it and sends the Firebase ID token on every call.
The team signs in to the dashboard with Firebase email/password accounts listed in `admins/{uid}`.
