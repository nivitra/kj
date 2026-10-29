import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/cognito_auth_service.dart';
import '../services/session_store.dart';

final authStateProvider = AsyncNotifierProvider<AuthNotifier, Customer?>(() => AuthNotifier());

class AuthNotifier extends AsyncNotifier<Customer?> {
  @override
  Future<Customer?> build() async {
    // Prefer Cognito session; fall back to password-session token.
    final cognito = CognitoAuthService.instance;
    try {
      await cognito.loadConfig();
    } catch (_) {}

    if (await cognito.hasSession) {
      try {
        return await ApiService.getMe();
      } catch (e) {
        // Only wipe Cognito session on real auth failure.
        if (_isUnauthorized(e)) {
          await cognito.logout(localOnly: true);
        } else {
          // Transient / server bug — keep tokens, treat as logged out this load only.
          return null;
        }
      }
    }

    final token = await SessionStore.instance.readCustomerToken();
    if (token == null || token.isEmpty) return null;
    try {
      return await ApiService.getMe();
    } catch (e) {
      if (_isUnauthorized(e)) {
        await SessionStore.instance.clearCustomerToken();
        return null;
      }
      // Transient / server bug — keep token and retry once after a short delay.
      // Do not wipe session; refresh must not force logout on 5xx.
      try {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        return await ApiService.getMe();
      } catch (e2) {
        if (_isUnauthorized(e2)) {
          await SessionStore.instance.clearCustomerToken();
          return null;
        }
        // Still keep token in storage; user can pull-to-refresh or retry login.
        return null;
      }
    }
  }

  bool _isUnauthorized(Object e) {
    if (e is DioException && e.response?.statusCode == 401) return true;
    return false;
  }

  /// Phone (or legacy loginId) + password.
  Future<void> login(String phoneOrLoginId, String password) async {
    state = const AsyncLoading();
    try {
      final data = await ApiService.login(phoneOrLoginId, password);
      final customer = Customer.fromJson(
        Map<String, dynamic>.from(data['customer'] as Map),
      );
      state = AsyncData(customer);
    } catch (e, st) {
      state = AsyncError(e, st);
      rethrow;
    }
  }

  /// Passwordless WhatsApp OTP login.
  Future<void> loginWithOtp({required String phone, required String code}) async {
    state = const AsyncLoading();
    try {
      final data = await ApiService.loginWithOtp(phone: phone, code: code);
      final customer = Customer.fromJson(
        Map<String, dynamic>.from(data['customer'] as Map),
      );
      state = AsyncData(customer);
    } catch (e, st) {
      state = AsyncError(e, st);
      rethrow;
    }
  }

  Future<void> register({
    required String name,
    required String phone,
    required String password,
  }) async {
    state = const AsyncLoading();
    try {
      final data = await ApiService.register(
        name: name,
        phone: phone,
        password: password,
      );
      final customer = Customer.fromJson(
        Map<String, dynamic>.from(data['customer'] as Map),
      );
      state = AsyncData(customer);
    } catch (e, st) {
      state = AsyncError(e, st);
      rethrow;
    }
  }

  /// WhatsApp OTP signup (name + phone + code).
  Future<void> registerWithOtp({
    required String name,
    required String phone,
    required String code,
  }) async {
    state = const AsyncLoading();
    try {
      final data = await ApiService.verifySignupOtp(
        phone: phone,
        code: code,
        name: name,
      );
      final customer = Customer.fromJson(
        Map<String, dynamic>.from(data['customer'] as Map),
      );
      state = AsyncData(customer);
    } catch (e, st) {
      state = AsyncError(e, st);
      rethrow;
    }
  }

  Future<void> completeCognitoLogin(Uri callbackUri) async {
    state = const AsyncLoading();
    try {
      await CognitoAuthService.instance.completeLoginFromCallback(callbackUri);
      final me = await ApiService.getMe();
      state = AsyncData(me);
    } catch (e, st) {
      state = AsyncError(e, st);
      rethrow;
    }
  }

  Future<void> beginCognitoLogin({bool signUp = false}) async {
    await CognitoAuthService.instance.beginLogin(signUp: signUp);
  }

  Future<void> logout() async {
    try {
      await CognitoAuthService.instance.logout(localOnly: true);
    } catch (_) {}
    await ApiService.clearLocalSession();
    state = const AsyncData(null);
  }

  void setCustomer(Customer customer) {
    state = AsyncData(customer);
  }

  Future<void> refresh() async {
    try {
      final me = await ApiService.getMe();
      state = AsyncData(me);
    } catch (_) {}
  }

  /// Force reload profile from network (e.g. after admin enables wedding mode).
  Future<Customer?> reloadProfile() async {
    try {
      final me = await ApiService.getMe();
      state = AsyncData(me);
      return me;
    } catch (_) {
      return state.valueOrNull;
    }
  }
}
