import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';

// Web iframe helper (conditional import pattern via dynamic)
import 'pdf_viewer_web.dart' if (dart.library.io) 'pdf_viewer_stub.dart' as platform_pdf;

/// In-app PDF experience for invoices & agreements.
class PdfViewerScreen extends StatefulWidget {
  final String title;
  final String? url;
  final String? base64Data;
  final String? filename;

  const PdfViewerScreen({
    super.key,
    required this.title,
    this.url,
    this.base64Data,
    this.filename,
  });

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  bool _loading = true;
  String? _error;
  String? _viewUrl;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  Future<void> _prepare() async {
    try {
      if (widget.url != null && widget.url!.isNotEmpty) {
        setState(() {
          _viewUrl = widget.url;
          _loading = false;
        });
        return;
      }
      if (widget.base64Data != null && widget.base64Data!.isNotEmpty) {
        // data URL for web iframe
        final dataUrl = 'data:application/pdf;base64,${widget.base64Data}';
        setState(() {
          _viewUrl = dataUrl;
          _loading = false;
        });
        return;
      }
      setState(() {
        _error = 'PDF not available';
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openExternal() async {
    final u = widget.url;
    if (u == null || u.isEmpty) return;
    final uri = Uri.parse(u);
    if (await canLaunchUrl(uri)) {
      await launchUrl(
        uri,
        mode: kIsWeb ? LaunchMode.platformDefault : LaunchMode.inAppBrowserView,
      );
    }
  }

  Future<void> _download() async {
    final u = widget.url;
    if (u == null || u.isEmpty) return;
    final uri = Uri.parse(u);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        backgroundColor: AppColors.bg(context),
        title: Text(widget.title, style: AppTheme.display(18, context: context)),
        actions: [
          if (widget.url != null) ...[
            IconButton(
              tooltip: 'Open external',
              icon: const Icon(Icons.open_in_new_rounded),
              onPressed: _openExternal,
            ),
            IconButton(
              tooltip: 'Download',
              icon: const Icon(Icons.download_rounded),
              onPressed: _download,
            ),
          ],
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.picture_as_pdf_outlined, size: 40, color: AppColors.text3(context)),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        if (widget.url != null)
                          FilledButton(onPressed: _openExternal, child: const Text('Open PDF')),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    Expanded(
                      child: kIsWeb && _viewUrl != null
                          ? platform_pdf.buildPdfView(_viewUrl!)
                          : _mobileFallback(),
                    ),
                  ],
                ),
    );
  }

  Widget _mobileFallback() {
    // Native apps: open system in-app browser for reliable PDF rendering.
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.sunken(context),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.picture_as_pdf_rounded, size: 32, color: AppColors.accent(context)),
            ),
            const SizedBox(height: 16),
            Text('Agreement / Invoice PDF', style: AppTheme.display(22, context: context)),
            const SizedBox(height: 8),
            Text(
              widget.filename ?? widget.title,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.text2(context)),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: () async {
                Haptics.medium();
                await _openExternal();
              },
              icon: const Icon(Icons.visibility_rounded, size: 18),
              label: const Text('View PDF'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _download,
              icon: const Icon(Icons.download_rounded, size: 18),
              label: const Text('Download'),
            ),
          ],
        ),
      ),
    );
  }
}
