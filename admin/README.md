# Invite Karoo — Admin Dashboard

The team console (host applications, wedding setup, guest-list import, media, family access,
support, users, team). Next.js (App Router) built as a **static site** in `out/`. The Vercel project in
`functions/` builds it and serves it next to the API, on the same address. There is no server of its own: the
browser talks to Firestore and Storage directly (`src/data.ts`), and `firestore.rules` + `storage.rules` decide
what each team member may do. Team accounts, Excel work and changes that have to tell someone go through the
API (`functions/src/team/team.routes.ts`).

## Run

```bash
cp .env.example .env.local     # fill in the Firebase web-app values
npm install
npm run dev                    # http://localhost:5173
```

The dev server has no API of its own: set `NEXT_PUBLIC_API_URL` to a running one (e.g. `http://127.0.0.1:3000`
from `npm run dev` in `functions/`), and add `http://localhost:5173` to that API's `CORS_ORIGINS`.

To work without touching the real project, set `NEXT_PUBLIC_FIREBASE_EMULATORS=1` and
`NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-invitekaroo`, and run `firebase emulators:start` from the repo root.

## Build

```bash
npm run typecheck && npm run build    # → out/
```

Pages with an id are static pages that read it from the query string:
`/weddings/view/?id=…&tab=guests`, `/applications/view/?id=…`, `/support/view/?id=…`, `/lookup/?phone=…`.

## Sign-in

Firebase Authentication, **Email/Password** provider (turn it on in the Firebase console).
Team accounts are created from the **Team** screen (admin role), which asks the API to create the
Firebase user. After sign-in the dashboard reads the `admins/{uid}` record; an account that is not on
the team is signed out again.

**The first admin**, on a new project: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` on the API, open the
sign-in page and follow **Create the first admin** (`/setup/`). The page only takes that exact email and
password, and closes for good once an admin exists. Then remove both values from the API.

"Forgot password?" sends Firebase's reset email; "My account" changes the password in the browser
(re-entering the current one). The site's domain must be under Firebase → Authentication → Settings →
**Authorized domains**, or sign-in fails.

## Deploy

Nothing to do here: the Vercel project in `functions/` builds and serves this site (see `functions/README.md`).
Set the `NEXT_PUBLIC_FIREBASE_*` values from `.env.example` on that project, and leave `NEXT_PUBLIC_API_URL`
empty so the dashboard calls the API on its own address.
