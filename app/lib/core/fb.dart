import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import 'api.dart';
import 'config.dart';

/// Firebase for the whole app: sign-in (Firebase Auth) and push (FCM).
/// The keys come in at build time (--dart-define, see Config).
class Fb {
  Fb._();
  static bool ready = false;

  static Future<void> init() async {
    if (ready || !Config.firebaseConfigured) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: Platform.isIOS && Config.fbIosApiKey.isNotEmpty ? Config.fbIosApiKey : Config.fbApiKey,
            appId: Platform.isIOS ? Config.fbIosAppId : Config.fbAndroidAppId,
            messagingSenderId: Config.fbSenderId,
            projectId: Config.fbProjectId,
            storageBucket: Config.fbStorageBucket.isEmpty ? null : Config.fbStorageBucket,
            iosBundleId: Platform.isIOS ? 'com.invitekaroo.app' : null,
          ),
        );
      }
      ready = true;
    } catch (_) {
      ready = false;
    }
  }

  static User? get user => ready ? FirebaseAuth.instance.currentUser : null;
}

/// The bearer token every API call carries: the signed-in user's Firebase ID token.
/// Firebase keeps it fresh; [refresh] forces a new one (after a 401).
class FirebaseTokens implements TokenSource {
  @override
  Future<String?> idToken({bool refresh = false}) async {
    final u = Fb.user;
    if (u == null) return null;
    try {
      return await u.getIdToken(refresh);
    } catch (_) {
      return null;
    }
  }

  /// what /v1/auth/otp/verify and /v1/auth/signup hand back
  Future<void> signInWithCustomToken(String token) async {
    if (!Fb.ready) {
      throw ApiException('APP_NOT_SET_UP', 'This build of the app cannot sign in yet (Firebase is not set up). Please update the app.');
    }
    try {
      await FirebaseAuth.instance.signInWithCustomToken(token);
    } on FirebaseAuthException catch (e) {
      if (e.code == 'network-request-failed') throw ApiException('NETWORK', 'No internet connection. Check your network and try again.');
      throw ApiException('SIGN_IN_FAILED', 'We could not sign you in. Please try again.');
    }
  }

  Future<void> signOut() async {
    if (Fb.ready) await FirebaseAuth.instance.signOut();
  }

  bool get signedIn => Fb.user != null;
}
