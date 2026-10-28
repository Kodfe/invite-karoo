# Invite Karoo — Admin Dashboard

The team console (host applications, wedding setup, guest-list import, media, family access,
support, users, team). Next.js (App Router) built as a **static site** in `out/`, served by
Firebase Hosting at **https://admin.invitekaroo.com**. It talks to the API at
`https://api.invitekaroo.com/v1/admin/…` with the signed-in team member's Firebase ID token.

## Run

```bash
cp .env.example .env.local     # fill in the Firebase web-app values
npm install
npm run dev                    # http://localhost:5173
```

## Build

```bash
npm run typecheck && npm run build    # → out/
```

Pages with an id are static pages that read it from the query string:
`/weddings/view/?id=…&tab=guests`, `/applications/view/?id=…`, `/support/view/?id=…`, `/lookup/?phone=…`.

## Sign-in

Firebase Authentication, **Email/Password** provider (turn it on in the Firebase console).
Team accounts are created from the **Team** screen (admin role), which asks the API to create the
Firebase user. After sign-in the dashboard calls `GET /v1/admin/me`; an account that is not on the
team is signed out again. "Forgot password?" sends Firebase's reset email; "My account" changes
the password in the browser (re-entering the current one).

Add `admin.invitekaroo.com` under Authentication → Settings → **Authorized domains**.

## Deploy

Firebase Hosting site with target **`admin`**, `public: "admin/out"`, `cleanUrls` off,
`trailingSlash: true`, and a fallback `404.html` (already in `out/`). Build with the real
`NEXT_PUBLIC_*` values first, then `firebase deploy --only hosting:admin`.
Connect the custom domain under Hosting → `admin` site → Add custom domain → `admin.invitekaroo.com`.
