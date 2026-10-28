import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';

import 'api.dart';
import 'fb.dart';
import 'session.dart';

/// Push notifications through Firebase Cloud Messaging.
/// Stays switched off until the Firebase keys are passed at build time (see Config).
class Push {
  Push._();
  static bool _ready = false;
  static StreamSubscription<String>? _tokenSub;

  /// a tapped notification's action, for the app shell to open
  static final StreamController<Json> taps = StreamController<Json>.broadcast();

  /// a notification that arrived while the app was open
  static final StreamController<RemoteMessage> foreground = StreamController<RemoteMessage>.broadcast();

  static String get _platform => Platform.isIOS ? 'ios' : 'android';

  static Future<void> init() async {
    if (_ready) return;
    await Fb.init();
    if (!Fb.ready) return;
    try {
      _ready = true;
      FirebaseMessaging.onMessage.listen(foreground.add);
      FirebaseMessaging.onMessageOpenedApp.listen((m) => taps.add(actionOf(m)));
      final first = await FirebaseMessaging.instance.getInitialMessage();
      if (first != null) Timer(const Duration(milliseconds: 800), () => taps.add(actionOf(first)));
    } catch (_) {
      _ready = false;
    }
  }

  /// The server sends `{ cat, action: '<json>' }` as data.
  static Json actionOf(RemoteMessage m) {
    final a = m.data['action'];
    if (a is String && a.isNotEmpty) {
      try {
        return asJson(jsonDecode(a));
      } catch (_) {}
    }
    return {'type': 'screen', 'screen': 'notifs'};
  }

  /// ask permission and send this phone's token to the server
  static Future<void> register(Session s) async {
    if (!_ready || !s.signedIn) return;
    try {
      final m = FirebaseMessaging.instance;
      final perm = await m.requestPermission(alert: true, badge: true, sound: true);
      if (perm.authorizationStatus == AuthorizationStatus.denied) return;
      if (Platform.isIOS) await m.getAPNSToken();
      final token = await m.getToken();
      if (token != null) await s.api.post('/v1/me/devices', {'fcmToken': token, 'platform': _platform});
      await _tokenSub?.cancel();
      _tokenSub = m.onTokenRefresh.listen((t) {
        s.api.post('/v1/me/devices', {'fcmToken': t, 'platform': _platform}).catchError((_) => null);
      });
    } catch (_) {}
  }

  static Future<void> unregister(Session s) async {
    if (!_ready) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await s.api.delete('/v1/me/devices', {'fcmToken': token});
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }
}
