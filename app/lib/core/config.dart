/// Build-time settings, passed with --dart-define (see .github/workflows/app.yml).
class Config {
  Config._();

  /// the API (Firebase Cloud Functions behind Firebase Hosting)
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'https://api.invitekaroo.com');

  /// Firebase — sign-in and push notifications. The app cannot sign in until these are set.
  static const fbApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  /// iOS has its own key in Firebase (GoogleService-Info.plist → API_KEY); falls back to the Android one
  static const fbIosApiKey = String.fromEnvironment('FIREBASE_IOS_API_KEY');
  static const fbProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const fbSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const fbAndroidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const fbIosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const fbStorageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');

  static bool get firebaseConfigured => fbApiKey.isNotEmpty && fbProjectId.isNotEmpty && fbSenderId.isNotEmpty;
  static bool get pushConfigured => firebaseConfigured;

  static const privacyUrl = String.fromEnvironment('PRIVACY_URL', defaultValue: 'https://invitekaroo.com/privacy');
  static const termsUrl = String.fromEnvironment('TERMS_URL', defaultValue: 'https://invitekaroo.com/terms');
  static const supportEmail = String.fromEnvironment('SUPPORT_EMAIL', defaultValue: 'support@invitekaroo.com');
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');
}
