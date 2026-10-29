import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';

/// Studio-controlled appearance (from admin Settings) + optional local mode override.
class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.system) {
    _loadLocal();
  }

  static const _key = 'customer_theme_mode';
  bool _localOverride = false;

  bool get hasLocalOverride => _localOverride;

  Future<void> _loadLocal() async {
    try {
      final p = await SharedPreferences.getInstance();
      final v = p.getString(_key);
      if (v == 'light') {
        _localOverride = true;
        state = ThemeMode.light;
      } else if (v == 'dark') {
        _localOverride = true;
        state = ThemeMode.dark;
      } else if (v == 'system') {
        _localOverride = true;
        state = ThemeMode.system;
      }
    } catch (_) {}
  }

  /// Apply studio default when user hasn't overridden.
  void applyStudioMode(String mode) {
    if (_localOverride) return;
    switch (mode) {
      case 'light':
        state = ThemeMode.light;
        break;
      case 'dark':
        state = ThemeMode.dark;
        break;
      default:
        state = ThemeMode.system;
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    _localOverride = true;
    state = mode;
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(
        _key,
        mode == ThemeMode.light
            ? 'light'
            : mode == ThemeMode.dark
                ? 'dark'
                : 'system',
      );
    } catch (_) {}
  }

  Future<void> toggleDark(bool dark) async {
    await setMode(dark ? ThemeMode.dark : ThemeMode.light);
  }

  Future<void> cycle() async {
    final next = state == ThemeMode.light
        ? ThemeMode.dark
        : state == ThemeMode.dark
            ? ThemeMode.system
            : ThemeMode.light;
    await setMode(next);
  }

  Future<void> clearOverride() async {
    _localOverride = false;
    try {
      final p = await SharedPreferences.getInstance();
      await p.remove(_key);
    } catch (_) {}
  }
}

final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, ThemeMode>((ref) => ThemeModeNotifier());

/// Loads studio app theme from portal profile / home.
class StudioAppearanceNotifier extends StateNotifier<StudioAppearance> {
  StudioAppearanceNotifier() : super(const StudioAppearance()) {
    refresh();
  }

  Future<void> refresh() async {
    try {
      Map? profile;
      try {
        final home = await PortalApi.home();
        profile = home['profile'] is Map ? home['profile'] as Map : null;
      } catch (_) {}
      if (profile == null) {
        try {
          final c = await PortalApi.contact();
          profile = c;
        } catch (_) {}
      }
      if (profile != null) {
        state = StudioAppearance.fromProfile(profile);
      }
    } catch (_) {}
  }

  void applyFromMap(Map? profile) {
    if (profile == null) return;
    state = StudioAppearance.fromProfile(profile);
  }
}

final studioAppearanceProvider =
    StateNotifierProvider<StudioAppearanceNotifier, StudioAppearance>(
  (ref) => StudioAppearanceNotifier(),
);
