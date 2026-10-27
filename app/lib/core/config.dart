/// Build-time settings, passed with --dart-define (see .github/workflows/app.yml).
class Config {
  Config._();

  /// e.g. --dart-define=API_URL=https://invite-karoo-api.up.railway.app
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');

  /// Firebase (push notifications). Push stays off until these are set.
  static const fbApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const fbProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const fbSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const fbAndroidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const fbIosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const fbStorageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');

  static bool get pushConfigured => fbApiKey.isNotEmpty && fbProjectId.isNotEmpty && fbSenderId.isNotEmpty;

  static const privacyUrl = String.fromEnvironment('PRIVACY_URL', defaultValue: 'https://invitekaroo.com/privacy');
  static const termsUrl = String.fromEnvironment('TERMS_URL', defaultValue: 'https://invitekaroo.com/terms');
  static const supportEmail = String.fromEnvironment('SUPPORT_EMAIL', defaultValue: 'support@invitekaroo.com');
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');
}
