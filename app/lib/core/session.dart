import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

class SecureTokens implements TokenStore {
  static const _s = FlutterSecureStorage();
  String? _access;
  String? _refresh;

  @override
  String? get access => _access;
  @override
  String? get refresh => _refresh;

  Future<void> load() async {
    try {
      _access = await _s.read(key: 'ik_access');
      _refresh = await _s.read(key: 'ik_refresh');
    } catch (_) {
      // a reinstalled iOS app can carry an unreadable keychain entry: start clean
      await clear();
    }
  }

  @override
  Future<void> save(String access, String refresh) async {
    _access = access;
    _refresh = refresh;
    await _s.write(key: 'ik_access', value: access);
    await _s.write(key: 'ik_refresh', value: refresh);
  }

  @override
  Future<void> clear() async {
    _access = null;
    _refresh = null;
    try {
      await _s.delete(key: 'ik_access');
      await _s.delete(key: 'ik_refresh');
    } catch (_) {}
  }
}

/// The signed-in person, which side of the app they are on, and their language.
class Session extends ChangeNotifier {
  Session() {
    api = Api(tokens: tokens, onSignedOut: _forceSignOut);
  }

  final SecureTokens tokens = SecureTokens();
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

  bool get signedIn => tokens.access != null && me != null;

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
    await tokens.load();
    if (tokens.access == null) {
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
    final t = asJson(r['tokens']);
    await tokens.save('${t['accessToken']}', '${t['refreshToken']}');
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
    final r = tokens.refresh;
    if (r != null) {
      try {
        await api.post('/v1/auth/logout', {'refreshToken': r});
      } catch (_) {}
    }
    await _clearLocal();
    notifyListeners();
  }

  /// after the account was deleted on the server
  Future<void> forget() async {
    await _clearLocal();
    notifyListeners();
  }

  Future<void> _clearLocal() async {
    await tokens.clear();
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
