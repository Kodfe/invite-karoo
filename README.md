# INVITE KAROO

Every wedding invitation, every function, one place.

| Folder | What |
| --- | --- |
| `backend/` | Node.js API (NestJS + PostgreSQL). Serves the app and the Admin Dashboard. See `backend/README.md`. |
| `app/` | Flutter app for Android and iOS — guest side and the host's wedding console. See `app/README.md`. |
| `admin/` | Admin Dashboard (React + Vite) for the Invite Karoo team: applications, weddings, guest-list import, card & photos, support, team. The API serves it at `/admin` — deploy the repo root on Railway (root `Dockerfile` + `railway.json`) to get both. Local: `cd admin && npm i && npm run dev` (proxies the API on :3000). |
| `.github/workflows/` | `backend.yml` runs the API tests · `admin.yml` builds the dashboard · `app.yml` builds the Android APK and uploads iOS builds to TestFlight. |
