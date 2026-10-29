import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'quotation_request_screen.dart';

class SharedLinkScreen extends StatefulWidget {
  final String token;
  const SharedLinkScreen({super.key, required this.token});
  @override
  State<SharedLinkScreen> createState() => _SharedLinkScreenState();
}
class _SharedLinkScreenState extends State<SharedLinkScreen> {
  bool _failed = false;
  Uri? _receipt;
  @override
  void initState() { super.initState(); _open(); }
  Future<void> _open() async {
    setState(() => _failed = false);
    try {
      final response = await ApiService.dio.get('/links/${Uri.encodeComponent(widget.token)}');
      final path = (ApiService.unwrapData(response) as Map)['path'] as String;
      if (!mounted) return;
      final uri = Uri.parse(path);
      if (uri.path == '/quotation-request' && uri.queryParameters.containsKey('requestId')) {
        setState(() => _receipt = uri);
      } else { context.go(path); }
    } catch (_) { if (mounted) setState(() => _failed = true); }
  }
  @override
  Widget build(BuildContext context) => _receipt != null
    ? QuotationRequestScreen(studioId: _receipt!.queryParameters['studioId'], requestId: _receipt!.queryParameters['requestId'], token: _receipt!.queryParameters['token'])
    : _failed
    ? LinkUnavailableScreen(onRetry: _open)
    : const Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [CircularProgressIndicator(), SizedBox(height: 20), Text('Opening your shared link…')])));
}
class LinkUnavailableScreen extends StatelessWidget {
  final VoidCallback? onRetry;
  const LinkUnavailableScreen({super.key, this.onRetry});
  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(28), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 440), child: Column(mainAxisSize: MainAxisSize.min, children: [
      Container(padding: const EdgeInsets.all(24), decoration: BoxDecoration(color: AppColors.sunken(context), shape: BoxShape.circle), child: Icon(Icons.link_off_rounded, size: 40, color: AppColors.text2(context))),
      const SizedBox(height: 24), Text('This link is unavailable', textAlign: TextAlign.center, style: AppTheme.display(28)),
      const SizedBox(height: 12), Text('It may have expired or been removed. Ask the studio for a new link, or open your account to find your documents and galleries.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.text2(context), height: 1.6)),
      const SizedBox(height: 24), FilledButton.icon(onPressed: () => context.go('/app'), icon: const Icon(Icons.home_outlined), label: const Text('Open my account')),
      if (onRetry != null) TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
    ]))))),
  );
}
