import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'download_web.dart' if (dart.library.io) 'download_io.dart' as platform_dl;

/// Save gallery originals (photos / videos) when the studio enables downloads.
class DownloadService {
  DownloadService._();

  static Future<void> downloadPhoto({
    required String url,
    required String filename,
    /// Expected original byte size from API (optional sanity check).
    int? expectedBytes,
  }) async {
    if (url.isEmpty) {
      throw StateError('Download is not available for this file yet.');
    }
    // Never accept compressed derivatives as a "download" (preview pipeline only).
    // Masters live under /originals/ or /videos/ — pure camera bytes, not WebP display.
    final path = url.split('?').first.toLowerCase();
    final isDerivative = path.contains('/display/') ||
        path.contains('/thumbnails/') ||
        path.contains('/posters/') ||
        // Derivative keys always end in .webp; true originals keep camera extension.
        (path.endsWith('.webp') &&
            !path.contains('/originals/') &&
            !path.contains('/videos/'));
    if (isDerivative) {
      throw StateError(
        'Download linked to a compressed preview. Refresh the gallery and try again.',
      );
    }
    // If path structure is present, require master folder.
    final hasStudioPath = path.contains('/galleries/') || path.contains('%2fgalleries%2f');
    final looksMaster = path.contains('/originals/') ||
        path.contains('/videos/') ||
        path.contains('%2foriginals%2f') ||
        path.contains('%2fvideos%2f');
    if (hasStudioPath && !looksMaster) {
      throw StateError(
        'Download link is not a full original. Refresh the gallery and try again.',
      );
    }

    final safeName = filename.trim().isEmpty ? 'download.bin' : filename.trim();

    if (kIsWeb) {
      try {
        final bytes = await _fetchBytes(url);
        _assertNotTiny(bytes, expectedBytes);
        await platform_dl.saveBytes(bytes, safeName);
        return;
      } catch (e) {
        if (e is StateError) rethrow;
        await platform_dl.openUrl(url);
        return;
      }
    }

    // Mobile: fetch full original then share/save sheet.
    final bytes = await _fetchBytes(url);
    _assertNotTiny(bytes, expectedBytes);
    await platform_dl.saveFileFromBytes(bytes, safeName);
  }

  static void _assertNotTiny(Uint8List bytes, int? expectedBytes) {
    final expected = expectedBytes ?? 0;
    if (expected > 500 * 1024 && bytes.length < (expected * 0.15).round()) {
      throw StateError(
        'Downloaded file is much smaller than the original '
        '(${(bytes.length / 1024).round()} KB vs ~${(expected / 1024).round()} KB). '
        'Refresh and try again.',
      );
    }
  }

  /// Open or download a PDF from base64 and/or remote URL.
  static Future<void> openPdf({
    String? url,
    String? base64Data,
    required String filename,
    bool download = false,
  }) async {
    final name = filename.endsWith('.pdf') ? filename : '$filename.pdf';

    if (base64Data != null && base64Data.isNotEmpty) {
      final bytes = Uint8List.fromList(base64Decode(base64Data));
      if (kIsWeb) {
        if (download) {
          await platform_dl.saveBytes(bytes, name);
        } else {
          await platform_dl.openPdfBytes(bytes, name);
        }
        return;
      }
      await platform_dl.saveFileFromBytes(bytes, name);
      return;
    }

    if (url != null && url.isNotEmpty) {
      if (kIsWeb) {
        if (download) {
          try {
            final bytes = await _fetchBytes(url);
            await platform_dl.saveBytes(bytes, name);
            return;
          } catch (_) {
            await platform_dl.openUrl(url);
            return;
          }
        }
        await platform_dl.openUrl(url);
        return;
      }
      await downloadPhoto(url: url, filename: name);
      return;
    }

    throw StateError('PDF is not available.');
  }

  static Future<Uint8List> _fetchBytes(String url) async {
    final res = await Dio().get<List<int>>(
      url,
      options: Options(
        responseType: ResponseType.bytes,
        receiveTimeout: const Duration(minutes: 5),
        sendTimeout: const Duration(minutes: 2),
      ),
    );
    final data = res.data;
    if (data == null || data.isEmpty) {
      throw StateError('Empty download response');
    }
    return Uint8List.fromList(data);
  }
}
