import 'dart:convert';

import 'package:flutter/services.dart';

import 'api.dart';

/// Demo build (--dart-define=DEMO=true), for checking the screens without signing in.
/// The app opens signed in as the demo host (Mitesh Ranka) and every API call is answered from
/// assets/demo/demo.json, recorded from the real API by functions/tool/demo-fixtures.js.
/// Nothing is sent anywhere and changes are not kept.
class Demo {
  Demo._();

  static const on = bool.fromEnvironment('DEMO');

  static Json _get = {};
  static Json _post = {};

  static Future<void> load() async {
    final raw = asJson(jsonDecode(await rootBundle.loadString('assets/demo/demo.json')));
    // the recording's dates moved to today, so upcoming functions stay upcoming
    final at = DateTime.parse('${raw['capturedAt']}').toLocal();
    final now = DateTime.now();
    final days = DateTime(now.year, now.month, now.day).difference(DateTime(at.year, at.month, at.day)).inDays;
    _get = asJson(_shift(raw['get'], days));
    _post = asJson(_shift(raw['post'], days));
  }

  static Json get me => asJson(_copy(asJson(_post['/v1/auth/otp/verify'])['me']));

  static dynamic answer(String method, String path, Map<String, dynamic>? query) {
    if (method != 'GET') return _copy(_post[path]) ?? <String, dynamic>{};
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) q[k] = '$v';
    });
    final keyed = q.entries.where((e) => e.key != 'limit' && e.key != 'q').toList()..sort((a, b) => a.key.compareTo(b.key));
    final key = keyed.isEmpty ? path : '$path?${keyed.map((e) => '${e.key}=${e.value}').join('&')}';
    final found = _get[key] ?? _get[path];
    if (found == null) throw ApiException('DEMO', 'This is not part of the demo.', status: 404);
    final r = _copy(found);
    // guest lists: search and page on the device
    if (r is Map && r['guests'] is List) {
      var gs = r['guests'] as List;
      final s = (q['q'] ?? '').toLowerCase();
      if (s.isNotEmpty) gs = gs.where((g) => '${g['name']} ${g['phone']}'.toLowerCase().contains(s)).toList();
      final limit = int.tryParse(q['limit'] ?? '');
      if (limit != null && gs.length > limit) gs = gs.take(limit).toList();
      r['guests'] = gs;
    }
    return r;
  }

  static dynamic _copy(dynamic v) => v == null ? null : jsonDecode(jsonEncode(v));

  static final _instant = RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$');
  static final _date = RegExp(r'^\d{4}-\d{2}-\d{2}$');

  static dynamic _shift(dynamic v, int days) {
    if (days == 0) return v;
    if (v is Map) return v.map((k, x) => MapEntry('$k', _shift(x, days)));
    if (v is List) return v.map((x) => _shift(x, days)).toList();
    if (v is String) {
      if (_instant.hasMatch(v)) return DateTime.parse(v).add(Duration(days: days)).toUtc().toIso8601String();
      if (_date.hasMatch(v)) {
        final d = DateTime.utc(int.parse(v.substring(0, 4)), int.parse(v.substring(5, 7)), int.parse(v.substring(8, 10))).add(Duration(days: days));
        return d.toIso8601String().substring(0, 10);
      }
    }
    return v;
  }
}
