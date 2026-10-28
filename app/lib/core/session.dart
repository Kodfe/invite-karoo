import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'fb.dart';

/// The signed-in person, which side of the app they are on, and their language.
class Session extends ChangeNotifier {
  Session() {
    api = Api(tokens: tokens, onSignedOut: _forceSignOut);
  }

  final FirebaseTokens tokens = FirebaseTokens();
  late final Api api;
  SharedPreferences? _prefs;

  bool ready = false;
  bool onboarded = false;
  Json? me;
  String lang = 'en';

  /// 'guest' (My agenda) or 'host' (a wedding console)
  String mode = 'guest';
  String? hostWeddingId;

  /// where a notification wanted to take the person before they signed in
  Json? pendingAction;

  /// bumps whenever something changed that open lists should reload for
  int dataVersion = 0;

  bool get signedIn => tokens.signedIn && me != null;

  List<Json> get hosting => asList(asJson(me?['host'])['weddings']);
  String get hostAccess => '${asJson(me?['host'])['access'] ?? 'none'}';
  Json? get activeHosting {
    for (final h in hosting) {
      if (h['weddingId'] == hostWeddingId) return h;
    }
    return hosting.isEmpty ? null : hosting.first;
  }

  String get role => '${activeHosting?['role'] ?? ''}';
  bool get isOwner => role == 'owner';
  bool get isGiftDesk => role == 'giftdesk';
  String get firstName => '${me?['firstName'] ?? ''}';
  String get fullName => '${me?['firstName'] ?? ''} ${me?['familyName'] ?? ''}'.trim();
  int get unread => (asJson(me?['counts'])['unreadNotifications'] as num?)?.toInt() ?? 0;

  static Session of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<SessionScope>()!.notifier!;
  static Session read(BuildContext context) => context.getInheritedWidgetOfExactType<SessionScope>()!.notifier!;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    onboarded = _prefs!.getBool('onboarded') ?? false;
    lang = _prefs!.getString('lang') ?? 'en';
    mode = _prefs!.getString('mode') ?? 'guest';
    hostWeddingId = _prefs!.getString('hostWeddingId');
    final cached = _prefs!.getString('me');
    if (cached != null) {
      try {
        me = asJson(jsonDecode(cached));
      } catch (_) {}
    }
    // Firebase Auth keeps the sign-in on the device
    if (!tokens.signedIn) {
      me = null;
    } else {
      try {
        await refreshMe(notify: false);
      } on ApiException catch (e) {
        if (e.isAuth) await _clearLocal();
      } catch (_) {
        // offline: keep the cached profile, the app still opens
      }
    }
    if (mode == 'host' && hosting.isEmpty) mode = 'guest';
    ready = true;
    notifyListeners();
  }

  Future<void> setOnboarded() async {
    onboarded = true;
    await _prefs?.setBool('onboarded', true);
    notifyListeners();
  }

  Future<void> setLang(String l) async {
    lang = l;
    await _prefs?.setString('lang', l);
    notifyListeners();
    if (signedIn) {
      try {
        await api.patch('/v1/me', {'lang': l});
      } catch (_) {}
    }
  }

  /// the body of /auth/otp/verify or /auth/signup when status == signed_in
  Future<void> applySignIn(Json r) async {
    await tokens.signInWithCustomToken('${r['customToken']}');
    _setMe(asJson(r['me']));
    // a fresh sign-in always starts on the guest side
    mode = 'guest';
    await _prefs?.setString('mode', mode);
    notifyListeners();
  }

  Future<void> refreshMe({bool notify = true}) async {
    final m = await api.get('/v1/me');
    _setMe(asJson(m));
    if (notify) notifyListeners();
  }

  /// after a number change the server hands back a new sign-in for the new number
  Future<void> reSignIn(String customToken) async {
    await tokens.signInWithCustomToken(customToken);
  }

  void updateMe(Json m) {
    _setMe(m);
    notifyListeners();
  }

  void touch() {
    dataVersion++;
    notifyListeners();
  }

  void _setMe(Json m) {
    me = m;
    final l = '${m['lang'] ?? ''}';
    if (l.isNotEmpty) lang = l;
    _prefs?.setString('me', jsonEncode(m));
    _prefs?.setString('lang', lang);
  }

  Future<void> enterHost(String weddingId) async {
    mode = 'host';
    hostWeddingId = weddingId;
    await _prefs?.setString('mode', mode);
    await _prefs?.setString('hostWeddingId', weddingId);
    notifyListeners();
  }

  Future<void> enterGuest() async {
    mode = 'guest';
    await _prefs?.setString('mode', mode);
    notifyListeners();
  }

  Future<void> signOut() async {
    await _clearLocal();
    notifyListeners();
  }

  /// after the account was deleted on the server
  Future<void> forget() async {
    await _clearLocal();
    notifyListeners();
  }

  Future<void> _clearLocal() async {
    try {
      await tokens.signOut();
    } catch (_) {}
    me = null;
    mode = 'guest';
    hostWeddingId = null;
    await _prefs?.remove('me');
    await _prefs?.remove('hostWeddingId');
    await _prefs?.setString('mode', 'guest');
  }

  void _forceSignOut() {
    _clearLocal().then((_) => notifyListeners());
  }
}

class SessionScope extends InheritedNotifier<Session> {
  const SessionScope({super.key, required Session session, required super.child}) : super(notifier: session);
}
