import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Palette id chosen by studio admin: warm | zinc | stone | slate
typedef AppPaletteId = String;

/// High-contrast color tokens for one palette + brightness.
class AppPalette {
  final Color canvas;
  final Color surface;
  final Color surfaceSunken;
  final Color ink;
  final Color ink2;
  final Color ink3;
  final Color line;
  final Color line2;
  final Color gold;
  final Color rose;
  final Color green;
  final Color amber;
  final Color blue;

  const AppPalette({
    required this.canvas,
    required this.surface,
    required this.surfaceSunken,
    required this.ink,
    required this.ink2,
    required this.ink3,
    required this.line,
    required this.line2,
    required this.gold,
    required this.rose,
    required this.green,
    required this.amber,
    required this.blue,
  });
}

/// Resolved studio theme (palette + mode).
class StudioAppearance {
  final String palette; // warm | zinc | stone | slate
  final String mode; // light | dark | system
  final Color? brandPrimary;
  final Color? brandAccent;

  const StudioAppearance({
    this.palette = 'warm',
    this.mode = 'system',
    this.brandPrimary,
    this.brandAccent,
  });

  factory StudioAppearance.fromProfile(Map? profile) {
    if (profile == null) return const StudioAppearance();
    Color? parseHex(dynamic v) {
      if (v == null) return null;
      var s = v.toString().trim();
      if (s.isEmpty) return null;
      if (s.startsWith('#')) s = s.substring(1);
      if (s.length == 6) {
        final n = int.tryParse(s, radix: 16);
        if (n != null) return Color(0xFF000000 | n);
      }
      return null;
    }

    return StudioAppearance(
      palette: (profile['appTheme']?.toString() ?? 'warm').toLowerCase(),
      mode: (profile['appThemeMode']?.toString() ?? 'system').toLowerCase(),
      brandPrimary: parseHex(profile['themeColor']),
      brandAccent: parseHex(profile['secondaryColor']),
    );
  }

  ThemeMode get themeMode {
    switch (mode) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}

/// Static fallbacks + helpers that read from ThemeExtension when available.
class AppColors {
  // Light defaults (warm) — admin-aligned calm canvas
  static const canvas = Color(0xFFF9F9F7);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceSunken = Color(0xFFF0F0ED);
  static const ink = Color(0xFF1A1A1A);
  static const ink2 = Color(0xFF6B6B6B);
  static const ink3 = Color(0xFF70706C);
  static const line = Color(0xFFE8E8E5);
  static const line2 = Color(0xFFF0F0ED);
  static const gold = Color(0xFF8B6914);
  static const rose = Color(0xFFC2304A);
  static const green = Color(0xFF2F7A4A);
  static const amber = Color(0xFFA66B1A);
  static const blue = Color(0xFF2F5F8F);

  // Dark defaults — near-black stack + soft gold (admin-aligned)
  static const canvasDark = Color(0xFF0C0C0C);
  static const surfaceDark = Color(0xFF141414);
  static const surfaceSunkenDark = Color(0xFF1C1C1C);
  static const inkDark = Color(0xFFF5F5F3);
  static const ink2Dark = Color(0xFFB8B8B4);
  static const ink3Dark = Color(0xFFA3A39D);
  static const lineDark = Color(0xFF2A2A2A);
  static const goldDark = Color(0xFFE2C07A);

  static AppPalette? _of(BuildContext? c) {
    if (c == null) return null;
    return Theme.of(c).extension<AppPaletteTokens>()?.palette;
  }

  static Color bg(BuildContext c) =>
      _of(c)?.canvas ??
      (Theme.of(c).brightness == Brightness.dark ? canvasDark : canvas);
  static Color card(BuildContext c) =>
      _of(c)?.surface ??
      (Theme.of(c).brightness == Brightness.dark ? surfaceDark : surface);
  static Color sunken(BuildContext c) =>
      _of(c)?.surfaceSunken ??
      (Theme.of(c).brightness == Brightness.dark ? surfaceSunkenDark : surfaceSunken);
  static Color text(BuildContext c) =>
      _of(c)?.ink ??
      (Theme.of(c).brightness == Brightness.dark ? inkDark : ink);
  static Color text2(BuildContext c) =>
      _of(c)?.ink2 ??
      (Theme.of(c).brightness == Brightness.dark ? ink2Dark : ink2);
  static Color text3(BuildContext c) =>
      _of(c)?.ink3 ??
      (Theme.of(c).brightness == Brightness.dark ? ink3Dark : ink3);
  static Color border(BuildContext c) =>
      _of(c)?.line ??
      (Theme.of(c).brightness == Brightness.dark ? lineDark : line);
  static Color accent(BuildContext c) =>
      _of(c)?.gold ??
      (Theme.of(c).brightness == Brightness.dark ? goldDark : gold);
  static Color danger(BuildContext c) => _of(c)?.rose ??
      (Theme.of(c).brightness == Brightness.dark ? const Color(0xFFF87171) : rose);
  static Color success(BuildContext c) => _of(c)?.green ??
      (Theme.of(c).brightness == Brightness.dark ? const Color(0xFF4ADE80) : green);

  /// Text/icon on solid primary fills (buttons, chips).
  static Color onPrimary(BuildContext c) {
    final p = Theme.of(c).colorScheme.primary;
    return p.computeLuminance() > 0.179 ? const Color(0xFF0B0C10) : Colors.white;
  }
}

class AppPaletteTokens extends ThemeExtension<AppPaletteTokens> {
  final AppPalette palette;
  const AppPaletteTokens(this.palette);

  @override
  AppPaletteTokens copyWith({AppPalette? palette}) =>
      AppPaletteTokens(palette ?? this.palette);

  @override
  AppPaletteTokens lerp(ThemeExtension<AppPaletteTokens>? other, double t) {
    if (other is! AppPaletteTokens) return this;
    return t < 0.5 ? this : other;
  }
}

class AppMotion {
  static const fast = Duration(milliseconds: 180);
  static const med = Duration(milliseconds: 280);
  static const slow = Duration(milliseconds: 420);
  static const spring = Curves.easeOutCubic;
  static const bounce = Curves.elasticOut;
  static const soft = Curves.easeInOutCubic;
}

/// Consistent spacing scale — use these instead of ad-hoc 20/24/100 values.
class AppSpace {
  static const xxs = 4.0;
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 16.0;
  static const lg = 20.0;
  static const xl = 24.0;

  /// Horizontal page margin (phone-friendly, matches admin breathing room).
  static const page = 20.0;

  /// Gap between major home sections.
  static const section = 28.0;

  /// Gap between section title and content.
  static const sectionTitle = 12.0;

  /// Bottom inset above nav / FAB.
  static const bottomNav = 80.0;

  /// Corner radii — small, product-UI (not pill cards).
  static const radiusSm = 8.0;
  static const radius = 16.0;
  static const radiusLg = 24.0;

  static EdgeInsets get pagePadding =>
      const EdgeInsets.fromLTRB(page, sm, page, bottomNav);

  static EdgeInsets pageH({double top = 0, double bottom = 0}) =>
      EdgeInsets.fromLTRB(page, top, page, bottom);
}

class AppTheme {
  static AppPalette paletteFor(String id, Brightness brightness) {
    final dark = brightness == Brightness.dark;
    switch (id) {
      case 'zinc':
        return dark
            ? const AppPalette(
                canvas: Color(0xFF0C0C0C),
                surface: Color(0xFF141414),
                surfaceSunken: Color(0xFF1C1C1C),
                ink: Color(0xFFF5F5F3),
                ink2: Color(0xFFB8B8B4),
                ink3: Color(0xFFA3A39D),
                line: Color(0xFF2A2A2A),
                line2: Color(0xFF1C1C1C),
                gold: Color(0xFFF4F4F5),
                rose: Color(0xFFFCA5A5),
                green: Color(0xFF86EFAC),
                amber: Color(0xFFFCD34D),
                blue: Color(0xFF93C5FD),
              )
            : const AppPalette(
                canvas: Color(0xFFF9F9F7),
                surface: Color(0xFFFFFFFF),
                surfaceSunken: Color(0xFFF0F0ED),
                ink: Color(0xFF1A1A1A),
                ink2: Color(0xFF6B6B6B),
                ink3: Color(0xFF70706C),
                line: Color(0xFFE8E8E5),
                line2: Color(0xFFF0F0ED),
                gold: Color(0xFF18181B),
                rose: Color(0xFFDC2626),
                green: Color(0xFF16A34A),
                amber: Color(0xFFCA8A04),
                blue: Color(0xFF2563EB),
              );
      case 'stone':
        return dark
            ? const AppPalette(
                canvas: Color(0xFF0C0C0C),
                surface: Color(0xFF141414),
                surfaceSunken: Color(0xFF1C1C1C),
                ink: Color(0xFFF5F5F3),
                ink2: Color(0xFFB8B8B4),
                ink3: Color(0xFFA3A39D),
                line: Color(0xFF2A2A2A),
                line2: Color(0xFF1C1C1C),
                gold: Color(0xFFFBBF24),
                rose: Color(0xFFFCA5A5),
                green: Color(0xFF86EFAC),
                amber: Color(0xFFFCD34D),
                blue: Color(0xFF93C5FD),
              )
            : const AppPalette(
                canvas: Color(0xFFF9F9F7),
                surface: Color(0xFFFFFFFF),
                surfaceSunken: Color(0xFFF0F0ED),
                ink: Color(0xFF1A1A1A),
                ink2: Color(0xFF6B6B6B),
                ink3: Color(0xFF70706C),
                line: Color(0xFFE8E8E5),
                line2: Color(0xFFF0F0ED),
                gold: Color(0xFFB45309),
                rose: Color(0xFFB91C1C),
                green: Color(0xFF15803D),
                amber: Color(0xFFA16207),
                blue: Color(0xFF1D4ED8),
              );
      case 'slate':
        return dark
            ? const AppPalette(
                canvas: Color(0xFF0C0C0C),
                surface: Color(0xFF141414),
                surfaceSunken: Color(0xFF1C1C1C),
                ink: Color(0xFFF5F5F3),
                ink2: Color(0xFFB8B8B4),
                ink3: Color(0xFFA3A39D),
                line: Color(0xFF2A2A2A),
                line2: Color(0xFF1C1C1C),
                gold: Color(0xFF7DD3FC),
                rose: Color(0xFFFCA5A5),
                green: Color(0xFF86EFAC),
                amber: Color(0xFFFCD34D),
                blue: Color(0xFF7DD3FC),
              )
            : const AppPalette(
                canvas: Color(0xFFF9F9F7),
                surface: Color(0xFFFFFFFF),
                surfaceSunken: Color(0xFFF0F0ED),
                ink: Color(0xFF1A1A1A),
                ink2: Color(0xFF6B6B6B),
                ink3: Color(0xFF70706C),
                line: Color(0xFFE8E8E5),
                line2: Color(0xFFF0F0ED),
                gold: Color(0xFF2563EB),
                rose: Color(0xFFDC2626),
                green: Color(0xFF16A34A),
                amber: Color(0xFFCA8A04),
                blue: Color(0xFF0284C7),
              );
      case 'warm':
      default:
        return dark
            ? const AppPalette(
                canvas: Color(0xFF0C0C0C),
                surface: Color(0xFF141414),
                surfaceSunken: Color(0xFF1C1C1C),
                ink: Color(0xFFF5F5F3),
                ink2: Color(0xFFB8B8B4),
                ink3: Color(0xFFA3A39D),
                line: Color(0xFF2A2A2A),
                line2: Color(0xFF1C1C1C),
                gold: Color(0xFFE2C07A),
                rose: Color(0xFFFCA5A5),
                green: Color(0xFF86EFAC),
                amber: Color(0xFFFCD34D),
                blue: Color(0xFF93C5FD),
              )
            : const AppPalette(
                canvas: Color(0xFFF9F9F7),
                surface: Color(0xFFFFFFFF),
                surfaceSunken: Color(0xFFF0F0ED),
                ink: Color(0xFF1A1A1A),
                ink2: Color(0xFF6B6B6B),
                ink3: Color(0xFF70706C),
                line: Color(0xFFE8E8E5),
                line2: Color(0xFFF0F0ED),
                gold: Color(0xFF8B6914),
                rose: Color(0xFFC2304A),
                green: Color(0xFF2F7A4A),
                amber: Color(0xFFA66B1A),
                blue: Color(0xFF2F5F8F),
              );
    }
  }

  static ThemeData light([StudioAppearance? appearance]) =>
      _build(Brightness.light, appearance ?? const StudioAppearance());

  static ThemeData dark([StudioAppearance? appearance]) =>
      _build(Brightness.dark, appearance ?? const StudioAppearance());

  static ThemeData _build(Brightness brightness, StudioAppearance appearance) {
    final p = paletteFor(appearance.palette, brightness);
    final dark = brightness == Brightness.dark;
    final gold = appearance.brandAccent ?? p.gold;

    // Primary fill must stay high-contrast in both modes.
    Color primary = appearance.brandPrimary ?? p.ink;
    if (appearance.brandPrimary != null) {
      final lum = appearance.brandPrimary!.computeLuminance();
      if (dark && lum < 0.38) {
        // Dark brand hex on dark UI → unreadable; use light ink instead.
        primary = p.ink;
      } else if (!dark && lum > 0.72) {
        primary = p.ink;
      } else {
        primary = appearance.brandPrimary!;
      }
    }
    final onPrimary =
        primary.computeLuminance() > 0.179 ? const Color(0xFF0B0C10) : Colors.white;
    final onSecondary =
        gold.computeLuminance() > 0.179 ? const Color(0xFF0B0C10) : Colors.white;

    final base = dark ? ThemeData.dark(useMaterial3: true) : ThemeData.light(useMaterial3: true);
    final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: p.ink,
      displayColor: p.ink,
    ).copyWith(
      bodyLarge: TextStyle(color: p.ink, fontSize: 16, height: 1.45, fontWeight: FontWeight.w400),
      bodyMedium: TextStyle(color: p.ink, fontSize: 14, height: 1.4, fontWeight: FontWeight.w400),
      bodySmall: TextStyle(color: p.ink2, fontSize: 12, height: 1.35, fontWeight: FontWeight.w400),
      titleLarge: TextStyle(color: p.ink, fontSize: 20, fontWeight: FontWeight.w600),
      titleMedium: TextStyle(color: p.ink, fontSize: 16, fontWeight: FontWeight.w600),
      titleSmall: TextStyle(color: p.ink, fontSize: 14, fontWeight: FontWeight.w600),
      labelLarge: TextStyle(color: p.ink, fontSize: 14, fontWeight: FontWeight.w600),
      labelMedium: TextStyle(color: p.ink2, fontSize: 12, fontWeight: FontWeight.w500),
      labelSmall: TextStyle(color: p.ink3, fontSize: 11, fontWeight: FontWeight.w500),
      headlineSmall: TextStyle(color: p.ink, fontSize: 24, fontWeight: FontWeight.w500),
    );

    return base.copyWith(
      brightness: brightness,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
      extensions: [AppPaletteTokens(p)],
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: onPrimary,
        secondary: gold,
        onSecondary: onSecondary,
        surface: p.surface,
        onSurface: p.ink,
        onSurfaceVariant: p.ink2,
        error: p.rose,
        onError: Colors.white,
        outline: p.line,
        outlineVariant: p.line2,
        surfaceContainerHighest: p.surfaceSunken,
        surfaceContainerHigh: p.surface,
        surfaceContainer: p.surface,
        surfaceContainerLow: p.canvas,
        surfaceContainerLowest: p.canvas,
      ),
      scaffoldBackgroundColor: p.canvas,
      canvasColor: p.canvas,
      cardColor: p.surface,
      dividerColor: p.line,
      disabledColor: p.ink3.withValues(alpha: 0.55),
      hintColor: p.ink3,
      secondaryHeaderColor: p.surfaceSunken,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      splashFactory: InkSparkle.splashFactory,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: ZoomPageTransitionsBuilder(),
          TargetPlatform.iOS: ZoomPageTransitionsBuilder(),
          TargetPlatform.linux: FadeUpwardsPageTransitionsBuilder(),
          TargetPlatform.macOS: ZoomPageTransitionsBuilder(),
          TargetPlatform.windows: FadeUpwardsPageTransitionsBuilder(),
        },
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: p.canvas,
        foregroundColor: p.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: p.ink,
          letterSpacing: -0.2,
        ),
        iconTheme: IconThemeData(color: p.ink),
        actionsIconTheme: IconThemeData(color: p.ink),
      ),
      cardTheme: CardThemeData(
        color: p.surface,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpace.radius),
          side: BorderSide(color: p.line),
        ),
      ),
      listTileTheme: ListTileThemeData(
        textColor: p.ink,
        iconColor: p.ink2,
        titleTextStyle: TextStyle(color: p.ink, fontWeight: FontWeight.w500, fontSize: 15),
        subtitleTextStyle: TextStyle(color: p.ink2, fontSize: 13, height: 1.35),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: p.surface,
        indicatorColor: p.surfaceSunken.withValues(alpha: 0.9),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 72,
        labelTextStyle: WidgetStateProperty.resolveWith((s) {
          final selected = s.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? p.ink : p.ink3,
            letterSpacing: 0.1,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((s) {
          final selected = s.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? p.ink : p.ink3,
            size: selected ? 22 : 21,
          );
        }),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: primary,
        foregroundColor: onPrimary,
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radiusLg)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: p.surfaceSunken,
        labelStyle: TextStyle(color: p.ink2, fontWeight: FontWeight.w500),
        floatingLabelStyle: TextStyle(color: p.ink, fontWeight: FontWeight.w600),
        hintStyle: TextStyle(color: p.ink3),
        helperStyle: TextStyle(color: p.ink3, fontSize: 12),
        errorStyle: TextStyle(color: p.rose, fontSize: 12),
        prefixIconColor: p.ink2,
        suffixIconColor: p.ink2,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpace.radius),
          borderSide: BorderSide(color: p.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpace.radius),
          borderSide: BorderSide(color: p.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpace.radius),
          borderSide: BorderSide(color: gold, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          backgroundColor: primary,
          foregroundColor: onPrimary,
          disabledBackgroundColor: p.surfaceSunken,
          disabledForegroundColor: p.ink3,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radius)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          foregroundColor: p.ink,
          side: BorderSide(color: p.line, width: 1),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radius)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 44),
          foregroundColor: p.ink,
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      iconTheme: IconThemeData(color: p.ink2, size: 22),
      primaryIconTheme: IconThemeData(color: p.ink),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: dark ? const Color(0xFFF5F2EB) : p.ink,
        contentTextStyle: TextStyle(
          color: dark ? const Color(0xFF12141A) : Colors.white,
          fontWeight: FontWeight.w500,
          fontSize: 14,
        ),
        actionTextColor: dark ? const Color(0xFF8B6914) : gold,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radius)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: p.ink,
          letterSpacing: -0.2,
        ),
        contentTextStyle: TextStyle(color: p.ink2, fontSize: 14, height: 1.4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radiusLg)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        showDragHandle: true,
        constraints: const BoxConstraints(maxWidth: 640),
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: p.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppSpace.radiusLg)),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: p.surface,
        surfaceTintColor: Colors.transparent,
        textStyle: TextStyle(color: p.ink, fontSize: 14, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpace.radius),
          side: BorderSide(color: p.line),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: p.surfaceSunken,
        selectedColor: gold.withValues(alpha: 0.18),
        disabledColor: p.surfaceSunken,
        labelStyle: TextStyle(color: p.ink, fontSize: 13, fontWeight: FontWeight.w500),
        secondaryLabelStyle: TextStyle(color: p.ink2, fontSize: 12),
        side: BorderSide(color: p.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpace.radiusSm)),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.selected)) return onPrimary;
          return p.ink3;
        }),
        trackColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.selected)) return gold;
          return p.surfaceSunken;
        }),
        trackOutlineColor: WidgetStateProperty.all(p.line),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.selected)) return primary;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(onPrimary),
        side: BorderSide(color: p.ink3, width: 1.5),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: p.ink,
        linearTrackColor: p.surfaceSunken,
        circularTrackColor: p.surfaceSunken,
      ),
      dividerTheme: DividerThemeData(color: p.line, thickness: 1, space: 1),
      tabBarTheme: TabBarThemeData(
        labelColor: p.ink,
        unselectedLabelColor: p.ink3,
        indicatorColor: gold,
        dividerColor: p.line,
      ),
      drawerTheme: DrawerThemeData(
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: dark ? const Color(0xFFF5F2EB) : p.ink,
          borderRadius: BorderRadius.circular(8),
        ),
        textStyle: TextStyle(
          color: dark ? const Color(0xFF12141A) : Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  /// Display / title type — Inter for product UI (admin-aligned).
  /// Pass [context] so dark mode always gets light ink.
  /// When neither [color] nor [context] is set, color is left unset so the
  /// ambient [DefaultTextStyle] / theme text color is used (theme-safe).
  static TextStyle display(
    double size, {
    FontWeight weight = FontWeight.w600,
    Color? color,
    double height = 1.15,
    double letterSpacing = -0.3,
    BuildContext? context,
  }) {
    final Color? c = color ?? (context != null ? AppColors.text(context) : null);
    return GoogleFonts.fraunces(
      fontSize: size,
      fontWeight: weight,
      color: c,
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  static TextStyle kicker({Color? color, BuildContext? context}) {
    final Color? c = color ??
        (context != null
            ? AppColors.text3(context)
            : null);
    return GoogleFonts.inter(
      fontSize: 11,
      fontWeight: FontWeight.w600,
      color: c,
      letterSpacing: 1.2,
    );
  }
}
