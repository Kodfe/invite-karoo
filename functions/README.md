# INVITE KAROO — API (Vercel + Firebase)

The code runs as one **Vercel Function** (`api/index.ts`, region `bom1`), with no web framework: a small
route table in `src/common/http.ts` and routes in `src/modules/*/*.routes.ts`. The data lives in **Firebase**:
Firestore, Firebase Auth, Storage and FCM, reached with a service account.

| What | Where |
| --- | --- |
| The app's API | `/v1/...`, signed-in users |
| The dashboard's API | `/v1/team/...`: team accounts, Excel work, and changes that must tell someone |
| Reminders and stuck WhatsApp sends | Vercel Cron calls `/v1/cron/minute` every minute (`vercel.json`). Needs Vercel Pro. |

A Vercel request or response can be at most 4.5 MB, so large files skip the API: the app PUTs them to a link
from `/v1/uploads`, the dashboard uses the Storage SDK, and card PDFs are fetched from a link (`card-url`).

Data model: `src/db/models.ts`. The app reaches Firestore only through the API. The dashboard reads and
writes it directly under `firestore.rules`, which `test/rules.spec.ts` tests on the emulators.

## Deploy

1. Vercel: a project on this repository with **Root Directory** `functions`. Set the variables below.
2. Firebase rules and indexes, with your own Google login (not the service account):

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore,storage --project invitekaroo-new
   ```

3. The first dashboard account, once: `ADMIN_EMAIL=… ADMIN_PASSWORD=… FIREBASE_SERVICE_ACCOUNT_JSON=… npm run seed:admin`
   after `npm run build`.

## Run the tests

```bash
cd functions && npm ci
npm test                 # in-memory Firestore + Auth, no setup needed
npm run test:emulators   # the real Firebase emulators (needs Java + firebase-tools)
```

## Settings

All of these go in the Vercel project's **Environment Variables** (`functions/.env` locally).

| Name | Kind | What |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | secret | the service account key, on one line |
| `CRON_SECRET` | secret | long random string; Vercel Cron sends it to `/v1/cron/minute` |
| `OTP_SECRET` | secret | long random string; salts the WhatsApp code hashes |
| `WHATSAPP_TOKEN` | secret | Meta WhatsApp Cloud API token (when `WHATSAPP_PROVIDER=meta`) |
| `ANTHROPIC_API_KEY` | secret | the AI card scan |
| `NODE_ENV` | env | `production`, or `development` on a test project together with `DEV_OTP=1234` |
| `WHATSAPP_PROVIDER`, `WHATSAPP_PHONE_NUMBER_ID`, `WA_TEMPLATE_*` | env | WhatsApp sending (`console` logs instead) |
| `TEAM_WHATSAPP` | env | the number on "Host a wedding" |
| `STORAGE_BUCKET` | env | `invitekaroo-new.firebasestorage.app` |
| `CORS_ORIGINS` | env | the dashboard's addresses, comma separated |

`npm run seed:admin` only creates the first account when it does not exist.

Demo data on a test project: `npm run seed:demo -- --force` with `FIREBASE_SERVICE_ACCOUNT_JSON` set.
Demo numbers (with `DEV_OTP=1234`): +91 98644 55120 (host + guest), +91 91234 56780 (guest only).
