import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'config.dart';
import 'demo.dart';

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

/// Where the bearer token comes from (the signed-in user's Firebase ID token).
abstract class TokenSource {
  Future<String?> idToken({bool refresh = false});
}

/// One HTTP client for the whole app. Adds the bearer token, gets a fresh one once on a 401,
/// and turns every failure into an [ApiException] with a message fit to show a person.
class Api {
  Api({required this.tokens, required this.onSignedOut});

  final TokenSource tokens;
  final void Function() onSignedOut;
  final http.Client _client = http.Client();

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
    if (Demo.on) return Demo.answer(method, path, query);
    final req = http.Request(method, uri(path, query));
    req.headers['Accept'] = 'application/json';
    final t = await tokens.idToken(refresh: retried);
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
    if (res.statusCode == 401 && t != null && !path.startsWith('/v1/auth/')) {
      if (!retried) return _send(method, path, query: query, body: body, retried: true);
      onSignedOut();
    }
    return _decode(res);
  }

  /// multipart upload. [files] maps the form field name to a local file path.
  Future<dynamic> upload(String path,
      {Map<String, String> files = const {}, Map<String, String> fields = const {}, Map<String, dynamic>? query, bool retried = false}) async {
    if (Demo.on) throw ApiException('DEMO', 'Uploads are not part of the demo.');
    final req = http.MultipartRequest('POST', uri(path, query));
    final t = await tokens.idToken(refresh: retried);
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
    if (res.statusCode == 401 && t != null) {
      if (!retried) return upload(path, files: files, fields: fields, query: query, retried: true);
      onSignedOut();
    }
    return _decode(res);
  }

  /// raw bytes (card PDF, spreadsheet template)
  Future<List<int>> bytes(String path) async {
    if (Demo.on) throw ApiException('DEMO', 'Downloads are not part of the demo.');
    Future<http.Response> go(bool fresh) async {
      final t = await tokens.idToken(refresh: fresh);
      return _client.get(uri(path), headers: {if (t != null) 'Authorization': 'Bearer $t'});
    }

    var res = await go(false);
    if (res.statusCode == 401) res = await go(true);
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
