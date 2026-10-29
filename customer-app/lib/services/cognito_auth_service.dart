import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';
import 'session_store.dart';
import 'share_links.dart';
import 'web_redirect_stub.dart'
    if (dart.library.html) 'web_redirect_web.dart' as web_redirect;

/// Amazon Cognito Authorization Code + PKCE client for Flutter (Web + mobile).
///
/// Tokens stored:
///   - access_token
///   - id_token
///   - refresh_token
/// Never stores passwords.
class CognitoAuthService {
  CognitoAuthService._();
  static final CognitoAuthService instance = CognitoAuthService._();

  static final _store = SessionStore.instance;

  static const _kAccess = 'cognito_access_token';
  static const _kId = 'cognito_id_token';
  static const _kRefresh = 'cognito_refresh_token';
  static const _kExpiresAt = 'cognito_expires_at';
  static const _kVerifier = 'cognito_pkce_verifier';
  static const _kState = 'cognito_oauth_state';

  Map<String, dynamic>? _config;

  bool get isConfigured =>
      _config != null &&
      _config!['enabled'] == true &&
      (_config!['clientId'] as String?)?.isNotEmpty == true &&
      (_config!['domain'] as String?)?.isNotEmpty == true;

  Map<String, dynamic>? get config => _config;

  Future<Map<String, dynamic>> loadConfig() async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 15),
    )).get('/auth/cognito/config');
    final body = res.data;
    final data = body is Map && body['data'] != null ? body['data'] : body;
    _config = Map<String, dynamic>.from(data as Map);
    return _config!;
  }

  Future<String?> getAccessToken() async {
    await _refreshIfNeeded();
    return _store.read(_kAccess);
  }

  Future<bool> get hasSession async {
    final t = await _store.read(_kAccess);
    final r = await _store.read(_kRefresh);
    return (t != null && t.isNotEmpty) || (r != null && r.isNotEmpty);
  }

  // ── PKCE helpers ────────────────────────────────────────────────────────

  String _randomUrlSafe(int length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    final rnd = Random.secure();
    return List.generate(length, (_) => chars[rnd.nextInt(chars.length)]).join();
  }

  String _codeChallenge(String verifier) {
    final digest = sha256.convert(utf8.encode(verifier));
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }

  String get _redirectUri {
    final fromConfig = _config?['redirectUri'] as String?;
    if (fromConfig != null && fromConfig.isNotEmpty) return fromConfig;
    if (kIsWeb) {
      // Default: current origin + /auth/callback
      // ignore: avoid_web_libraries_in_flutter
      return '${Uri.base.origin}/auth/callback';
    }
    return 'sjstudio://auth/callback';
  }

  /// Start Hosted UI login (Authorization Code + PKCE).
  Future<void> beginLogin({bool signUp = false}) async {
    if (_config == null) await loadConfig();
    if (!isConfigured) {
      throw StateError('Cognito is not configured on the server');
    }

    final verifier = _randomUrlSafe(64);
    final challenge = _codeChallenge(verifier);
    final state = _randomUrlSafe(32);

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kVerifier, verifier);
    await prefs.setString(_kState, state);
    final location = Uri.base.fragment.startsWith('/') ? Uri.parse(Uri.base.fragment) : Uri.base;
    await prefs.setString('auth_return_path', safeReturnPath(location.queryParameters['from']) ?? '/app');

    final domain = _config!['domain'] as String;
    final clientId = _config!['clientId'] as String;
    final scopes = (_config!['scopes'] as List?)?.join(' ') ?? 'openid email profile';

    final params = <String, String>{
      'client_id': clientId,
      'response_type': 'code',
      'scope': scopes,
      'redirect_uri': _redirectUri,
      'state': state,
      'code_challenge_method': 'S256',
      'code_challenge': challenge,
      // Force the interactive login / signup surface (not silent SSO).
      'prompt': 'login',
      if (signUp) 'screen_hint': 'signup',
    };

    // Hosted UI authorize endpoint (supports screen_hint=signup for Create account).
    final uri = Uri.https(domain, '/oauth2/authorize', params);
    if (kIsWeb) {
      // Full-page redirect for Flutter Web
      // ignore: avoid_web_libraries_in_flutter
      // Using universal approach via Uri launch is flaky on web; location.assign is reliable.
      // ignore: undefined_prefixed_name
      _webAssign(uri.toString());
    } else {
      // Mobile: open external browser / ASWebAuthenticationSession via url_launcher
      throw UnsupportedError('Use url_launcher to open: $uri');
    }
  }

  void _webAssign(String url) => web_redirect.WebRedirect.go(url);

  /// Handle /auth/callback?code=&state=
  Future<void> completeLoginFromCallback(Uri callbackUri) async {
    if (_config == null) await loadConfig();
    final code = callbackUri.queryParameters['code'];
    final state = callbackUri.queryParameters['state'];
    final err = callbackUri.queryParameters['error'];
    if (err != null) {
      throw StateError(callbackUri.queryParameters['error_description'] ?? err);
    }
    if (code == null || code.isEmpty) throw StateError('Missing authorization code');

    final prefs = await SharedPreferences.getInstance();
    final savedState = prefs.getString(_kState);
    final verifier = prefs.getString(_kVerifier);
    if (savedState == null || verifier == null || savedState != state) {
      throw StateError('Invalid OAuth state');
    }

    await _exchangeCode(code, verifier);
    await prefs.remove(_kVerifier);
    await prefs.remove(_kState);

    // Provision / sync local customer via backend
    final access = await _store.read(_kAccess);
    if (access != null) {
      await ApiService.establishCognitoSession(access);
    }
  }

  Future<void> _exchangeCode(String code, String verifier) async {
    final domain = _config!['domain'] as String;
    final clientId = _config!['clientId'] as String;
    final tokenUrl = Uri.https(domain, '/oauth2/token');

    final res = await http.post(
      tokenUrl,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: {
        'grant_type': 'authorization_code',
        'client_id': clientId,
        'code': code,
        'redirect_uri': _redirectUri,
        'code_verifier': verifier,
      },
    );
    if (res.statusCode >= 300) {
      throw StateError('Token exchange failed (${res.statusCode}): ${res.body}');
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    await _persistTokens(json);
  }

  Future<void> _persistTokens(Map<String, dynamic> json) async {
    final access = json['access_token'] as String?;
    final id = json['id_token'] as String?;
    final refresh = json['refresh_token'] as String?;
    final expiresIn = json['expires_in'];
    if (access != null) await _store.write(_kAccess, access);
    if (id != null) await _store.write(_kId, id);
    if (refresh != null) await _store.write(_kRefresh, refresh);
    if (expiresIn != null) {
      final exp = DateTime.now().millisecondsSinceEpoch +
          ((expiresIn is int ? expiresIn : int.tryParse('$expiresIn') ?? 3600) - 60) * 1000;
      await _store.write(_kExpiresAt, '$exp');
    }
  }

  Future<void> _refreshIfNeeded() async {
    final expStr = await _store.read(_kExpiresAt);
    final exp = expStr != null ? int.tryParse(expStr) : null;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (exp != null && now < exp) return;
    final refresh = await _store.read(_kRefresh);
    if (refresh == null || refresh.isEmpty) return;
    try {
      await refreshTokens();
    } catch (_) {
      // leave existing access token; next 401 will force re-login
    }
  }

  Future<void>? _refreshInFlight;
  Future<void> refreshTokens() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<void> _performRefresh() async {
    if (_config == null) await loadConfig();
    if (!isConfigured) return;
    final refresh = await _store.read(_kRefresh);
    if (refresh == null) throw StateError('No refresh token');

    final domain = _config!['domain'] as String;
    final clientId = _config!['clientId'] as String;
    final res = await http.post(
      Uri.https(domain, '/oauth2/token'),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: {
        'grant_type': 'refresh_token',
        'client_id': clientId,
        'refresh_token': refresh,
      },
    );
    if (res.statusCode >= 300) {
      await logout(localOnly: true);
      throw StateError('Refresh failed (${res.statusCode})');
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    // Cognito refresh responses often omit refresh_token — keep existing.
    if (json['refresh_token'] == null) json['refresh_token'] = refresh;
    await _persistTokens(json);
  }

  /// Cognito Hosted UI logout + clear local tokens.
  Future<void> logout({bool localOnly = false}) async {
    await _store.delete(_kAccess);
    await _store.delete(_kId);
    await _store.delete(_kRefresh);
    await _store.delete(_kExpiresAt);
    await ApiService.clearLocalSession();

    if (localOnly || !kIsWeb) return;
    if (_config == null) {
      try {
        await loadConfig();
      } catch (_) {
        return;
      }
    }
    if (!isConfigured) return;
    final domain = _config!['domain'] as String;
    final clientId = _config!['clientId'] as String;
    final logoutUri = (_config!['logoutUri'] as String?) ?? Uri.base.origin;
    final uri = Uri.https(domain, '/logout', {
      'client_id': clientId,
      'logout_uri': logoutUri,
    });
    web_redirect.WebRedirect.go(uri.toString());
  }

  /// Hosted UI forgot-password is part of the same login page.
  Future<void> beginForgotPassword() => beginLogin();
}
