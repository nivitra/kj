import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../services/share_links.dart';
import '../theme/app_theme.dart';

class ShareLinkButton extends StatelessWidget {
  final String path;
  final String title;
  final Color? color;
  const ShareLinkButton({super.key, required this.path, this.title = 'Share link', this.color});
  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: title,
    icon: Icon(Icons.share_outlined, color: color),
    onPressed: () => showDialog<void>(context: context,
      builder: (ctx) => _ShareDialog(path: path, title: title)),
  );
}

class _ShareDialog extends StatefulWidget {
  final String path, title;
  const _ShareDialog({required this.path, required this.title});
  @override
  State<_ShareDialog> createState() => _ShareDialogState();
}
class _ShareDialogState extends State<_ShareDialog> {
  String? _url, _error;
  bool _loading = true, _copied = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try { final url = await createAppShareLink(widget.path); if (mounted) setState(() => _url = url); }
    catch (_) { if (mounted) setState(() => _error = 'Could not prepare this link. Please try again.'); }
    finally { if (mounted) setState(() => _loading = false); }
  }
  void _message(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  Future<void> _copy() async {
    try { await Clipboard.setData(ClipboardData(text: _url!)); if (mounted) { setState(() => _copied = true); _message('Link copied'); } }
    catch (_) { if (mounted) _message('Select and copy the link above'); }
  }
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title == 'Client-only link' ? 'Share this gallery' : widget.title),
    content: SizedBox(width: 420, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: AppColors.sunken(context), borderRadius: BorderRadius.circular(12)), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.lock_outline, size: 20, color: AppColors.text2(context)), const SizedBox(width: 10),
        Expanded(child: Text(widget.path.startsWith('/gallery/') ? 'Assigned clients can open this gallery with their invited account. Use a guest link for friends and family.' : 'Sign in to open this item. Client documents keep their existing access permissions.', style: TextStyle(fontSize: 13, color: AppColors.text2(context)))),
      ])),
      const SizedBox(height: 20),
      if (_loading) const Row(children: [SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)), SizedBox(width: 12), Expanded(child: Text('Preparing your link…'))]),
      if (_error != null) ...[Text(_error!, style: TextStyle(color: AppColors.danger(context))), const SizedBox(height: 8), TextButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again'))],
      if (_url != null && !_loading) ...[
        Text('SHAREABLE LINK', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1, color: AppColors.text2(context))),
        const SizedBox(height: 8), SelectableText(_url!, style: const TextStyle(fontSize: 14)),
      ],
    ])),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      if (_url != null && !_loading) ...[
        OutlinedButton.icon(onPressed: () async {
          try { final box = context.findRenderObject() as RenderBox?; await Share.share(_url!, subject: widget.title, sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size); }
          catch (_) { if (mounted) _message('Use Copy link to share this item'); }
        }, icon: const Icon(Icons.share_outlined, size: 18), label: const Text('Share')),
        FilledButton.icon(onPressed: _copy, icon: Icon(_copied ? Icons.check : Icons.copy_outlined, size: 18), label: Text(_copied ? 'Copied' : 'Copy link')),
      ],
    ],
  );
}
