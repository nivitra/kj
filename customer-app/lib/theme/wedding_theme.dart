import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Quiet wedding surface — warm, not flashy.
/// Gated behind `weddingExperience` — never bleed into general clients.
class WeddingPalette {
  static const ivory = Color(0xFFF7F4F0);
  static const ink = Color(0xFF2C2A28);
  static const champagne = Color(0xFF8F857A);
  static const dustyRose = Color(0xFF9A6B73);
  static const blush = Color(0xFFF0E7E4);
  static const wine = Color(0xFF6B4448);

  // Soft ink variants for hierarchy only (tints of ink, not new hues)
  static const inkSoft = Color(0xFF5C564F);
  static const inkFaint = Color(0xFF8A837C);

  /// Soft ivory gradient scrim under hero names (not a purple/AI wash).
  static const heroScrim = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0x00FAF5EF),
      Color(0x66FAF5EF),
      Color(0xCCFAF5EF),
      Color(0xF2FAF5EF),
    ],
    stops: [0.35, 0.55, 0.78, 1.0],
  );

  /// Empty-state wash — ivory only, no decorative gradients.
  static const emptyWash = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [ivory, Color(0xFFF5EDE4)],
  );
}

class WeddingSpace {
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 20.0;
  static const lg = 28.0;
  static const xl = 40.0;
  static const page = 24.0;
  static const radius = 16.0;
  static const hairline = 1.0;
  static const heroInset = 0.0;
}

class WeddingTheme {
  /// Display — Fraunces — couple names & screen titles only.
  static TextStyle display(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color? color,
    double height = 1.12,
  }) {
    return GoogleFonts.fraunces(
      fontSize: size,
      fontWeight: weight,
      color: color ?? WeddingPalette.ink,
      height: height,
      letterSpacing: -0.4,
    );
  }

  /// Body — Inter — everything readable.
  static TextStyle body(
    double size, {
    FontWeight weight = FontWeight.w400,
    Color? color,
    double height = 1.5,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? WeddingPalette.inkSoft,
      height: height,
    );
  }

  /// Utility — Space Grotesk, all-caps, wide tracking — labels/dates.
  static TextStyle utility({
    double size = 11,
    Color? color,
    FontWeight weight = FontWeight.w500,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? WeddingPalette.inkFaint,
      letterSpacing: 0.6,
      height: 1.2,
    );
  }

  static ThemeData light() {
    final base = ThemeData.light(useMaterial3: true);
    final textTheme = base.textTheme
        .apply(
          bodyColor: WeddingPalette.ink,
          displayColor: WeddingPalette.ink,
        )
        .copyWith(
          displayLarge: display(40),
          displayMedium: display(32),
          displaySmall: display(26),
          headlineLarge: display(28),
          headlineMedium: display(24),
          headlineSmall: display(22),
          titleLarge: display(22, weight: FontWeight.w500),
          titleMedium: body(16, weight: FontWeight.w500, color: WeddingPalette.ink),
          titleSmall: body(14, weight: FontWeight.w500, color: WeddingPalette.ink),
          bodyLarge: body(16, color: WeddingPalette.ink),
          bodyMedium: body(14),
          bodySmall: body(12, color: WeddingPalette.inkFaint),
          labelLarge: body(14, weight: FontWeight.w500, color: WeddingPalette.ink),
          labelMedium: utility(size: 11, color: WeddingPalette.champagne),
          labelSmall: utility(size: 10, color: WeddingPalette.inkFaint),
        );

    // primary = Dusty Rose (action), secondary = Champagne (structure),
    // surface = Ivory, onSurface = Ink, error = Wine (sparing).
    const scheme = ColorScheme.light(
      primary: WeddingPalette.dustyRose,
      onPrimary: Color(0xFFFAF5EF),
      secondary: WeddingPalette.champagne,
      onSecondary: WeddingPalette.ink,
      surface: WeddingPalette.ivory,
      onSurface: WeddingPalette.ink,
      onSurfaceVariant: WeddingPalette.inkSoft,
      outline: WeddingPalette.champagne,
      error: WeddingPalette.wine,
      onError: Color(0xFFFAF5EF),
      tertiary: WeddingPalette.blush,
      onTertiary: WeddingPalette.ink,
    );

    return base.copyWith(
      brightness: Brightness.light,
      scaffoldBackgroundColor: WeddingPalette.ivory,
      canvasColor: WeddingPalette.ivory,
      cardColor: WeddingPalette.ivory,
      dividerColor: WeddingPalette.champagne.withValues(alpha: 0.35),
      primaryColor: WeddingPalette.dustyRose,
      colorScheme: scheme,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: WeddingPalette.ivory,
        foregroundColor: WeddingPalette.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: display(22, weight: FontWeight.w500),
        iconTheme: const IconThemeData(color: WeddingPalette.ink, size: 22),
      ),
      // Flat ivory cards — 1px champagne hairline, radius 20, no elevation.
      cardTheme: CardThemeData(
        color: WeddingPalette.ivory,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(WeddingSpace.radius),
          side: BorderSide(
            color: WeddingPalette.champagne.withValues(alpha: 0.28),
            width: WeddingSpace.hairline,
          ),
        ),
        margin: EdgeInsets.zero,
      ),
      // Primary CTA = dusty rose — soft corners, not stock full-pill+icon.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: WeddingPalette.dustyRose,
          foregroundColor: WeddingPalette.ivory,
          elevation: 0,
          shadowColor: Colors.transparent,
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: GoogleFonts.inter(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.2,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: WeddingPalette.dustyRose,
          foregroundColor: WeddingPalette.ivory,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: GoogleFonts.inter(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.2,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: WeddingPalette.dustyRose,
          textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: WeddingPalette.ink,
          side: const BorderSide(color: WeddingPalette.champagne, width: 1),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: WeddingPalette.ivory,
        indicatorColor: WeddingPalette.blush,
        elevation: 0,
        height: 68,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        labelTextStyle: WidgetStateProperty.resolveWith((s) {
          final sel = s.contains(WidgetState.selected);
          return GoogleFonts.inter(
            fontSize: 11,
            fontWeight: sel ? FontWeight.w600 : FontWeight.w400,
            color: sel ? WeddingPalette.ink : WeddingPalette.inkFaint,
            letterSpacing: 0.15,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((s) {
          final sel = s.contains(WidgetState.selected);
          // Active = rose (action). Inactive structure = champagne-tinted ink.
          return IconThemeData(
            color: sel ? WeddingPalette.dustyRose : WeddingPalette.inkFaint,
            size: 22,
          );
        }),
      ),
      dividerTheme: DividerThemeData(
        color: WeddingPalette.champagne.withValues(alpha: 0.4),
        thickness: 1,
        space: 1,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: WeddingPalette.ivory,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(WeddingSpace.radius),
          side: const BorderSide(color: WeddingPalette.champagne, width: 1),
        ),
        titleTextStyle: display(24, weight: FontWeight.w500),
        contentTextStyle: body(14),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: WeddingPalette.ink,
        contentTextStyle: GoogleFonts.inter(
          fontSize: 14,
          color: WeddingPalette.ivory,
          fontWeight: FontWeight.w400,
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: WeddingPalette.dustyRose,
        linearTrackColor: WeddingPalette.blush,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: WeddingPalette.ivory,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: WeddingPalette.champagne, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(
            color: WeddingPalette.champagne.withValues(alpha: 0.55),
            width: 1,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: WeddingPalette.dustyRose, width: 1.2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        hintStyle: body(14, color: WeddingPalette.inkFaint),
        labelStyle: body(13, color: WeddingPalette.inkSoft),
      ),
      iconTheme: const IconThemeData(color: WeddingPalette.champagne, size: 22),
      splashColor: WeddingPalette.blush.withValues(alpha: 0.5),
      highlightColor: WeddingPalette.blush.withValues(alpha: 0.35),
    );
  }
}
