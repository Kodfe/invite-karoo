# INVITE KAROO — Flutter app (Android + iOS)

One app, two sides:
- **Guest** — every wedding you are invited to, reply per function, reminders, your own events (typed or scanned with AI), notifications, support.
- **Host** — the wedding console: functions, guests, RSVP, WhatsApp invitations and reminders, gift desk with QR scanner, family access.

Languages: English, हिन्दी, தமிழ், ગુજરાતી (Settings → Language).

## Build settings

The app takes its settings at build time. Put them in `app/firebase.local.json` (git ignores it):

```json
{
  "API_URL": "https://invite-karoo.vercel.app",
  "FIREBASE_API_KEY": "…",
  "FIREBASE_PROJECT_ID": "invitekaroo-new",
  "FIREBASE_SENDER_ID": "…",
  "FIREBASE_ANDROID_APP_ID": "…",
  "FIREBASE_IOS_APP_ID": "…",
  "FIREBASE_STORAGE_BUCKET": "invitekaroo-new.firebasestorage.app"
}
```

`API_URL` is the Vercel project's address. The Firebase values are in Firebase → Project settings → Your apps;
sign-in and push both need them. Optional: `FIREBASE_IOS_API_KEY`, `PRIVACY_URL`, `TERMS_URL`.

## Build it

The `android/` and `ios/` folders are **not** kept in the repo. Make them once with `flutter create`; then
`tool/prepare_platforms.py` sets the app ID (`com.invitekaroo.app`), the name, permissions, iOS 15 minimum and
signing. Needs Flutter, Java 17+ and the Android SDK (Android Studio has both).

```bash
cd app
flutter create --org com.invitekaroo --project-name invite_karoo --platforms android,ios .
rm -rf test && python3 tool/prepare_platforms.py
flutter pub get && dart run flutter_launcher_icons
```

**Android APK** (to install on a phone):

```bash
flutter build apk --release --target-platform android-arm,android-arm64 --dart-define-from-file=firebase.local.json
```

It lands in `build/app/outputs/flutter-apk/app-release.apk`. Without a release key it is signed with a debug key:
fine for testing, not for the Play Store.

**Play Store** (`.aab`): make the release key once (below), put its passwords in `android/key.properties`, then
`flutter build appbundle --release --dart-define-from-file=firebase.local.json`.

**iOS** needs a Mac with Xcode: `flutter build ipa --release --dart-define-from-file=firebase.local.json`, then
upload with Xcode or Transporter. Run `prepare_platforms.py --push` once Push Notifications is enabled on the App ID.

**Demo build** that opens without signing in, for checking the screens: add `--dart-define=DEMO=true`. It answers
from `assets/demo/demo.json`, recorded by `functions/tool/demo-fixtures.js`.

### Make the Android release key (once, keep it safe forever)

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`android/key.properties` then holds `storeFile=upload-keystore.jks`, `storePassword`, `keyAlias` and `keyPassword`.
Losing this file means you can never update the app on the Play Store. Keep two copies.

## Running it on a computer (developers)

```bash
flutter run --dart-define-from-file=firebase.local.json
ALLOW_CLEARTEXT=1 python3 tool/prepare_platforms.py   # only to talk to a local http API
```

Sign-in: the WhatsApp code is checked by the API, which hands back a Firebase custom token; the app signs in to
Firebase Auth with it and sends the Firebase ID token on every request. With `DEV_OTP=1234` on a test project,
the demo numbers (`npm run seed:demo`) are `98644 55120` (host + guest) and `91234 56780` (guest only).
