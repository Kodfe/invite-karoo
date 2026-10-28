# INVITE KAROO — Backend API

NestJS 11 + PostgreSQL (Drizzle ORM). One API serves the Flutter app (guest + host) and the Admin Dashboard.

## Run it on your computer

Needs Node 20+ and PostgreSQL 14+.

```bash
cd backend
cp .env.example .env          # then edit DATABASE_URL if needed
npm install
npm run build
npm run db:migrate            # creates all tables
ADMIN_PASSWORD='a-long-password' npm run seed:admin   # first Admin Dashboard login
npm run seed:demo             # optional: the demo wedding from the HTML design
npm start                     # http://localhost:3000, API docs at /docs
```

Demo logins (OTP is always `1234` while `DEV_OTP=1234`):

| Number | Who |
| --- | --- |
| +91 98644 55120 | Mitesh Ranka — hosts *Luveena & Mitesh*, and is a guest at *Rohit & Anika* |
| +91 91234 56780 | Priya Shah — a guest invited to nothing |

Tests (needs a database called `invitekaroo_test`): `npm test`

## Deploy on Railway

1. railway.app → New Project → **Deploy from GitHub repo** → pick this repo. Leave **Root Directory** empty: the root `Dockerfile` builds the API **and** the Admin Dashboard (served at `/admin`). Setting it to `backend` deploys the API alone.
2. In the same project: **New → Database → PostgreSQL**.
3. In the backend service → **Variables**, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `NODE_ENV` = `production`
   - `PUBLIC_URL` = the service's public URL (Settings → Networking → Generate Domain)
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ADMIN_SECRET` = three different long random strings
   - `DEV_OTP` = *(empty)*
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters) = the first dashboard sign-in, created automatically on the first start
   - WhatsApp, Firebase and AI keys below when you have them
4. Deploy. Migrations run on every start, and the first admin is created when there is none. The dashboard is at `https://<your-domain>/admin/`.

With `STORAGE_DRIVER=local` uploads live on the container disk and are lost on redeploy — switch to `firebase` before real use.

## Settings that need your accounts

| Variable | Where it comes from |
| --- | --- |
| `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Meta Business → WhatsApp → API Setup (use a permanent System User token) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase console → Project settings → Service accounts → Generate new private key. Paste the whole JSON on one line. |
| `FIREBASE_STORAGE_BUCKET`, `STORAGE_DRIVER=firebase` | Firebase console → Storage → the bucket name (e.g. `invite-karoo.firebasestorage.app`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (AI card scan) |
| `TEAM_WHATSAPP` | The team number hosts can message from "Host a wedding" |

### WhatsApp templates to create in Meta

Create these three message templates (language: English). Names must match the variables.

| Name | Category | Body |
| --- | --- | --- |
| `ik_login_code` | Authentication | Meta's standard code template, with a **Copy code** button |
| `ik_function_invite` | Utility | `Namaste {{1}}! {{2}} warmly invite you to the {{3}} on {{4}} at {{5}}. Please open the Invite Karoo app to reply.` |
| `ik_function_reminder` | Utility | `Reminder: {{1}}, the {{2}} for {{3}}'s wedding is on {{4}} at {{5}}. See you there!` |

Meta decides the final category; invitations are sometimes moved to Marketing, which costs more per message.

## How it is organised

```
src/
  db/schema.ts            every table (the invite row = one guest × one function)
  common/time.ts          RSVP window (closes 24h before start), timezone helpers
  modules/auth            WhatsApp OTP login, signup, refresh tokens
  modules/me              profile, preferences, devices, change number, export, delete
  modules/guest           invitations list, wedding page, function, RSVP, private reminders, QR
  modules/host            wedding console: guests, replies, WhatsApp blasts, nudges, gifts, scanner, family
  modules/events          the guest's own events + AI card scan
  modules/applications    "Host a wedding" application + guest-list template
  modules/admin           Admin Dashboard API: applications, wedding setup, import, handover, tickets
  modules/reminders       app-default and private reminders (cron, every minute)
  modules/sheets          reads .xlsx / SpreadsheetML / .csv guest lists
```

Rules the code holds (from the design):
- Invites resolve to people by **phone number**, so a guest list can be imported before anyone installs the app.
- A guest only ever sees their own replies; functions they are not on show name, date, time and venue name only.
- Guests get the wedding's **contact number**, never a host's personal number.
- Replies close **24 hours** before a function; a function added later than that never opens for replies (the hosts call).
- Each function's WhatsApp invitation and WhatsApp reminder can go out **once**. In-app nudges are unlimited.
- Taking a guest off the list tells them by app notification only — never WhatsApp.
- Reminders are stored as offsets, so moving a function moves every reminder with it.
