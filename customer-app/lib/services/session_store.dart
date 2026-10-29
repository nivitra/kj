import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persistent token storage that works reliably on Flutter Web.
///
/// On web, `flutter_secure_storage` can be flaky or session-scoped depending
/// on the browser. We treat [SharedPreferences] (localStorage) as the source
/// of truth on web, and dual-write on all platforms so a hard refresh keeps
/// the session.
class SessionStore {
  SessionStore._();
  static final SessionStore instance = SessionStore._();

  static const customerTokenKey = 'customer_token';

  static const FlutterSecureStorage _secure = FlutterSecureStorage(
    webOptions: WebOptions(
      dbName: 'sj_studio_auth',
      publicKey: 'sj_studio_auth_pk',
    ),
  );

  Future<void> write(String key, String value) async {
    // Always persist to SharedPreferences first (localStorage on web).
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, value);
    } catch (_) {}
    try {
      await _secure.write(key: key, value: value);
    } catch (_) {}
  }

  Future<String?> read(String key) async {
    // Web: prefer localStorage so hard-refresh restores the session.
    if (kIsWeb) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final v = prefs.getString(key);
        if (v != null && v.isNotEmpty) return v;
      } catch (_) {}
      try {
        final v = await _secure.read(key: key);
        if (v != null && v.isNotEmpty) {
          // Migrate into localStorage for next load.
          try {
            final prefs = await SharedPreferences.getInstance();
            await prefs.setString(key, v);
          } catch (_) {}
          return v;
        }
      } catch (_) {}
      return null;
    }

    try {
      final v = await _secure.read(key: key);
      if (v != null && v.isNotEmpty) return v;
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  Future<void> delete(String key) async {
    try {
      await _secure.delete(key: key);
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(key);
    } catch (_) {}
  }

  Future<void> writeCustomerToken(String token) => write(customerTokenKey, token);
  Future<String?> readCustomerToken() => read(customerTokenKey);
  Future<void> clearCustomerToken() => delete(customerTokenKey);
}
