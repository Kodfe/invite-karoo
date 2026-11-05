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
the team is signed out again. "Forgot password?" sends Firebase's reset email; "My account" changes
the password in the browser (re-entering the current one).

Add `admin.invitekaroo.com` under Authentication → Settings → **Authorized domains**.

## Deploy

On Vercel: import the repository, set **Root Directory** to `admin`, add `NEXT_PUBLIC_API_URL` and the
`NEXT_PUBLIC_FIREBASE_*` values from `.env.example`, and deploy. Add the site's domain under Firebase →
Authentication → Settings → **Authorized domains** and to the API's `CORS_ORIGINS`, or sign-in and the
API calls fail.
