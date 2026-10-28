# INVITE KAROO — API (Firebase)

NestJS 11 running on **Cloud Functions (2nd gen, asia-south1)** with **Firestore**, **Firebase Auth**,
**Cloud Storage** and **FCM**. One API serves the Flutter app (guest + host) and the Admin Dashboard.

| Function | What |
| --- | --- |
| `api` | the REST API, behind Firebase Hosting at `https://api.invitekaroo.com` |
| `reminders` | every minute: the app's reminders and each guest's own |
| `blastQueued` | Firestore trigger: sends a WhatsApp blast once it is queued |
| `blastSweep` | every 5 minutes: resumes blasts that got stuck |

Data model: `src/db/models.ts`. Firestore is only reached through the API (rules deny all client access).

## Run the tests

```bash
cd functions && npm ci
npm test                 # in-memory Firestore + Auth, no setup needed
npm run test:emulators   # the real Firebase emulators (needs Java + firebase-tools)
```

## Settings

Plain values go in `functions/.env` (the deploy workflow writes it from GitHub variables); secrets live in
Secret Manager (the deploy workflow sets them from GitHub secrets).

| Name | Kind | What |
| --- | --- | --- |
| `OTP_SECRET` | secret | long random string; salts the WhatsApp code hashes |
| `WHATSAPP_TOKEN` | secret | Meta WhatsApp Cloud API token (when `WHATSAPP_PROVIDER=meta`) |
| `ANTHROPIC_API_KEY` | secret | the AI card scan |
| `NODE_ENV` | env | `production`, or `development` on a test project together with `DEV_OTP=1234` |
| `WHATSAPP_PROVIDER`, `WHATSAPP_PHONE_NUMBER_ID`, `WA_TEMPLATE_*` | env | WhatsApp sending (`console` logs instead) |
| `CORS_ORIGINS` | env | `https://admin.invitekaroo.com` |
| `TEAM_WHATSAPP` | env | the number on "Host a wedding" |

The first dashboard account: `ADMIN_EMAIL` / `ADMIN_PASSWORD` → `npm run seed:admin` (the deploy workflow
runs it after every deploy; it only creates the account when it does not exist).

Demo data on a test project: `npm run seed:demo -- --force` with `FIREBASE_SERVICE_ACCOUNT_JSON` set.
Demo numbers (with `DEV_OTP=1234`): +91 98644 55120 (host + guest), +91 91234 56780 (guest only).
