# INVITE KAROO — Flutter app (Android + iOS)

One app, two sides:
- **Guest** — every wedding you are invited to, reply per function, reminders, your own events (typed or scanned with AI), notifications, support.
- **Host** — the wedding console: functions, guests, RSVP, WhatsApp invitations and reminders, gift desk with QR scanner, family access.

Languages: English, हिन्दी, தமிழ், ગુજરાતી (Settings → Language).

## How it is built

The `android/` and `ios/` folders are **not** kept in the repo. GitHub Actions creates them with
`flutter create`, then `tool/prepare_platforms.py` sets the app ID (`com.invitekaroo.app`), the name,
permissions, iOS 15 minimum and signing. See `.github/workflows/app.yml`.

| What | Where it comes out |
| --- | --- |
| Android APK | Actions → App → the run → **Artifacts** → `invite-karoo-android-…` (download, unzip, install on the phone) |
| Play Store bundle (.aab) | Same artifact, only when the release keystore secrets are set |
| iOS | Uploaded straight to **App Store Connect → TestFlight** |

## GitHub settings the build reads

Settings → Secrets and variables → Actions.

**Variables** (not secret):

| Name | Example |
| --- | --- |
| `API_URL` | `https://invite-karoo-api.up.railway.app` (the backend, no trailing slash) |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_IOS_APP_ID`, `FIREBASE_STORAGE_BUCKET` | From Firebase → Project settings → Your apps. Push stays off until these are set. |
| `IOS_PUSH` | `true` once Push Notifications is enabled on the App ID |
| `IOS_ON_PUSH` | `true` to send every push to `main` to TestFlight (otherwise run it by hand) |
| `PRIVACY_URL`, `TERMS_URL` | Your published policy pages |

**Secrets**:

| Name | What |
| --- | --- |
| `APPLE_TEAM_ID` | developer.apple.com → Membership → Team ID |
| `ASC_KEY_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API → the key's ID |
| `ASC_ISSUER_ID` | Same page, "Issuer ID" at the top |
| `ASC_KEY_P8` | The contents of the downloaded `AuthKey_XXXX.p8` file (paste the whole text) |
| `ANDROID_KEYSTORE_BASE64` | Optional: `base64 -i upload-keystore.jks` output |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Optional: the keystore's passwords and alias |

The App Store Connect key needs the **Admin** role so the build can create the signing certificate and profile by itself.

### Make the Android release key (once, keep it safe forever)

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
base64 -i upload-keystore.jks | pbcopy     # macOS; on Windows: certutil -encode upload-keystore.jks out.txt
```

Losing this file means you can never update the app on the Play Store. Keep two copies.

## Running it on a computer (developers)

```bash
flutter create --org com.invitekaroo --project-name invite_karoo --platforms android,ios .
rm -rf test && python3 tool/prepare_platforms.py
ALLOW_CLEARTEXT=1 python3 tool/prepare_platforms.py   # only to talk to a local http backend
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

Demo sign-ins with the backend's demo data (OTP `1234`): `98644 55120` (host + guest), `91234 56780` (guest only).
