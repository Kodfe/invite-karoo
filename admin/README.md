# Invite Karoo — Admin Dashboard

The team console (host applications, wedding setup, guest-list import, media, family access,
support, users, team). Next.js (App Router) built as a **static site** in `out/`, served by
Vercel at **https://admin.invitekaroo.com**. There is no server of its own: the browser
talks to Firestore and Storage directly (`src/data.ts`), and `firestore.rules` + `storage.rules` decide
what each team member may do. Team accounts, Excel work and changes that have to tell someone go through
the API at `NEXT_PUBLIC_API_URL` (`functions/src/team/team.routes.ts`).

## Run

```bash
cp .env.example .env.local     # fill in the Firebase web-app values
npm install
npm run dev                    # http://localhost:5173
```

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
password, and closes for good once an admin exists. Then remove both values from the API. "Forgot password?" sends Firebase's reset email; "My account" changes
the password in the browser (re-entering the current one).

Add `admin.invitekaroo.com` under Authentication → Settings → **Authorized domains**.

## Deploy

The API's Vercel project builds and serves this site too (see `functions/README.md`), so the dashboard and
the API share one address and `NEXT_PUBLIC_API_URL` stays empty. Set the `NEXT_PUBLIC_FIREBASE_*` values from
`.env.example` on that project, and add its domain under Firebase → Authentication → Settings →
**Authorized domains**, or sign-in fails.

To host the site on its own instead (Root Directory `admin`, using `vercel.json` here), set
`NEXT_PUBLIC_API_URL` to the API's address and add this site's address to the API's `CORS_ORIGINS`.
