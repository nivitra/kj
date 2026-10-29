import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/share_links.dart';

/// OAuth redirect target: /auth/callback?code=…&state=…
class AuthCallbackScreen extends ConsumerStatefulWidget {
  final Uri uri;
  const AuthCallbackScreen({super.key, required this.uri});

  @override
  ConsumerState<AuthCallbackScreen> createState() => _AuthCallbackScreenState();
}

class _AuthCallbackScreenState extends ConsumerState<AuthCallbackScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _finish());
  }

  Future<void> _finish() async {
    try {
      await ref.read(authStateProvider.notifier).completeCognitoLogin(widget.uri);
      final prefs = await SharedPreferences.getInstance();
      final destination = safeReturnPath(prefs.getString('auth_return_path')) ?? '/app';
      await prefs.remove('auth_return_path');
      if (!mounted) return;
      context.go(destination);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Bad state: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: _error == null
              ? const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.5, color: AppColors.ink),
                    ),
                    SizedBox(height: 20),
                    Text('Signing you in…',
                        style: TextStyle(color: AppColors.ink2, fontSize: 15)),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, color: AppColors.rose, size: 36),
                    const SizedBox(height: 16),
                    Text(_error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.ink2, height: 1.4)),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go('/login'),
                      style: FilledButton.styleFrom(backgroundColor: AppColors.ink),
                      child: const Text('Back to sign in'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
