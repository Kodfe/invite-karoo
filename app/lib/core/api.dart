import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'config.dart';

typedef Json = Map<String, dynamic>;

Json asJson(dynamic v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};
List<Json> asList(dynamic v) => v is List ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : <Json>[];

/// What the API returns on any error: { error: { code, message, fields? } }
class ApiException implements Exception {
  ApiException(this.code, this.message, {this.status = 0, this.fields = const {}});
  final String code;
  final String message;
  final int status;
  final Map<String, String> fields;

  bool get isNetwork => code == 'NETWORK';
  bool get isAuth => status == 401;

  @override
  String toString() => message;
}

/// Where the tokens live (secure storage), kept in memory for fast access.
abstract class TokenStore {
  String? get access;
  String? get refresh;
  Future<void> save(String access, String refresh);
  Future<void> clear();
}

/// One HTTP client for the whole app. Adds the bearer token, refreshes it once on a 401,
/// and turns every failure into an [ApiException] with a message fit to show a person.
class Api {
  Api({required this.tokens, required this.onSignedOut});

  final TokenStore tokens;
  final void Function() onSignedOut;
  final http.Client _client = http.Client();
  Future<bool>? _refreshing;

  Uri uri(String path, [Map<String, dynamic>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) q[k] = '$v';
    });
    return Uri.parse('${Config.apiUrl}$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) => _send('GET', path, query: query);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body: body ?? const <String, dynamic>{});
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body: body ?? const <String, dynamic>{});
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body ?? const <String, dynamic>{});
  Future<dynamic> delete(String path, [Object? body]) => _send('DELETE', path, body: body);

  Future<dynamic> _send(String method, String path, {Map<String, dynamic>? query, Object? body, bool retried = false}) async {
    final req = http.Request(method, uri(path, query));
    req.headers['Accept'] = 'application/json';
    final t = tokens.access;
    if (t != null) req.headers['Authorization'] = 'Bearer $t';
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 25)));
    } on TimeoutException {
      throw ApiException('NETWORK', 'The connection is slow. Please try again.');
    } on SocketException {
      throw ApiException('NETWORK', 'No internet connection. Check your network and try again.');
    } on http.ClientException {
      throw ApiException('NETWORK', 'Could not reach Invite Karoo. Please try again.');
    }
    if (res.statusCode == 401 && !retried && tokens.refresh != null && !path.startsWith('/v1/auth/')) {
      if (await _refresh()) return _send(method, path, query: query, body: body, retried: true);
    }
    return _decode(res);
  }

  /// multipart upload. [files] maps the form field name to a local file path.
  Future<dynamic> upload(String path,
      {Map<String, String> files = const {}, Map<String, String> fields = const {}, Map<String, dynamic>? query, bool retried = false}) async {
    final req = http.MultipartRequest('POST', uri(path, query));
    final t = tokens.access;
    if (t != null) req.headers['Authorization'] = 'Bearer $t';
    req.fields.addAll(fields);
    for (final e in files.entries) {
      req.files.add(await http.MultipartFile.fromPath(e.key, e.value, contentType: _mime(e.value)));
    }
    http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 90)));
    } on TimeoutException {
      throw ApiException('NETWORK', 'The upload took too long. Please try again.');
    } on SocketException {
      throw ApiException('NETWORK', 'No internet connection. Check your network and try again.');
    }
    if (res.statusCode == 401 && !retried && tokens.refresh != null) {
      if (await _refresh()) return upload(path, files: files, fields: fields, query: query, retried: true);
    }
    return _decode(res);
  }

  /// raw bytes (card PDF, spreadsheet template)
  Future<List<int>> bytes(String path) async {
    Future<http.Response> go() => _client.get(uri(path), headers: {if (tokens.access != null) 'Authorization': 'Bearer ${tokens.access}'});
    var res = await go();
    if (res.statusCode == 401 && await _refresh()) res = await go();
    if (res.statusCode >= 400) _decode(res);
    return res.bodyBytes;
  }

  dynamic _decode(http.Response res) {
    dynamic data;
    try {
      data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;
    final err = (data is Map && data['error'] is Map) ? data['error'] as Map : const {};
    final fields = <String, String>{};
    if (err['fields'] is Map) {
      (err['fields'] as Map).forEach((k, v) => fields['$k'] = '$v');
    }
    throw ApiException(
      '${err['code'] ?? 'HTTP_${res.statusCode}'}',
      '${err['message'] ?? 'Something went wrong. Please try again.'}',
      status: res.statusCode,
      fields: fields,
    );
  }

  Future<bool> _refresh() {
    return _refreshing ??= () async {
      try {
        final r = tokens.refresh;
        if (r == null) return false;
        final res = await _client
            .post(uri('/v1/auth/refresh'), headers: {'Content-Type': 'application/json'}, body: jsonEncode({'refreshToken': r}))
            .timeout(const Duration(seconds: 20));
        if (res.statusCode != 200) {
          if (res.statusCode == 401) {
            await tokens.clear();
            onSignedOut();
          }
          return false;
        }
        final j = jsonDecode(res.body) as Map;
        await tokens.save('${j['accessToken']}', '${j['refreshToken']}');
        return true;
      } catch (_) {
        return false;
      } finally {
        _refreshing = null;
      }
    }();
  }

  static MediaType? _mime(String path) {
    final p = path.toLowerCase();
    if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return MediaType('image', 'jpeg');
    if (p.endsWith('.png')) return MediaType('image', 'png');
    if (p.endsWith('.webp')) return MediaType('image', 'webp');
    if (p.endsWith('.heic')) return MediaType('image', 'heic');
    if (p.endsWith('.pdf')) return MediaType('application', 'pdf');
    if (p.endsWith('.xlsx')) return MediaType('application', 'vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (p.endsWith('.xls')) return MediaType('application', 'vnd.ms-excel');
    if (p.endsWith('.csv')) return MediaType('text', 'csv');
    return null;
  }
}
