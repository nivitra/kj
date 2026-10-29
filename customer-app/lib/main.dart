import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_skill/flutter_skill.dart';
import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';
import 'theme/wedding_theme.dart';
import 'url_strategy_stub.dart' if (dart.library.html) 'url_strategy_web.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kDebugMode) {
    FlutterSkillBinding.ensureInitialized();
  }
  configureUrlStrategy();

  PaintingBinding.instance.imageCache.maximumSize = 200;
  PaintingBinding.instance.imageCache.maximumSizeBytes = 120 << 20;

  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: AppColors.canvas,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  runApp(const ProviderScope(child: StudioApp()));
}

class StudioApp extends ConsumerStatefulWidget {
  const StudioApp({super.key});

  @override
  ConsumerState<StudioApp> createState() => _StudioAppState();
}

class _StudioAppState extends ConsumerState<StudioApp> {
  @override
  void initState() {
    super.initState();
    // Load studio theme from API once app starts
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(studioAppearanceProvider.notifier).refresh().then((_) {
        final app = ref.read(studioAppearanceProvider);
        ref.read(themeModeProvider.notifier).applyStudioMode(app.mode);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    final themeMode = ref.watch(themeModeProvider);
    final appearance = ref.watch(studioAppearanceProvider);
    final customer = ref.watch(authStateProvider).valueOrNull;
    final wedding = customer?.weddingExperience == true;

    final dark = !wedding &&
        (themeMode == ThemeMode.dark ||
            (themeMode == ThemeMode.system &&
                WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.dark));

    final lightTheme = wedding ? WeddingTheme.light() : AppTheme.light(appearance);
    final darkTheme = wedding ? WeddingTheme.light() : AppTheme.dark(appearance);
    final active = dark ? darkTheme : lightTheme;
    final canvas = active.scaffoldBackgroundColor;

    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
      systemNavigationBarColor: canvas,
      systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
    ));

    return MaterialApp.router(
      title: wedding ? 'Your Wedding' : 'SJ Clicks',
      debugShowCheckedModeBanner: false,
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: wedding ? ThemeMode.light : themeMode,
      routerConfig: router,
      builder: (context, child) => child ?? const SizedBox.shrink(),
    );
  }
}
