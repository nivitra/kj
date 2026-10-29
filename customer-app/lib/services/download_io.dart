import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

String _mime(String filename) {
  final n = filename.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.mp4')) return 'video/mp4';
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

Future<void> saveBytes(Uint8List bytes, String filename) async {
  await saveFileFromBytes(bytes, filename);
}

/// Write to a temp file and open the system share sheet (Save Image / Files).
Future<void> saveFileFromBytes(Uint8List bytes, String filename) async {
  final dir = await getTemporaryDirectory();
  final safe = filename.replaceAll(RegExp(r'[/\\]'), '_');
  final path = '${dir.path}/dl_${DateTime.now().millisecondsSinceEpoch}_$safe';
  final file = File(path);
  await file.writeAsBytes(bytes, flush: true);
  try {
    await Share.shareXFiles(
      [XFile(path, name: safe, mimeType: _mime(safe))],
      text: safe,
    );
  } finally {
    Future<void>.delayed(const Duration(minutes: 3), () {
      try {
        if (file.existsSync()) file.deleteSync();
      } catch (_) {}
    });
  }
}

Future<void> openUrl(String url) async {
  final uri = Uri.parse(url);
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

Future<void> openPdfBytes(Uint8List bytes, String filename) async {
  await saveFileFromBytes(bytes, filename);
}
