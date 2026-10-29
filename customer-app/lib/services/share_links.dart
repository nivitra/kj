import 'package:flutter/foundation.dart';
import 'api_service.dart';

String appShareUrl(String path) {
  const configured = String.fromEnvironment('CUSTOMER_APP_URL');
  final base = configured.isNotEmpty ? configured : kIsWeb ? Uri.base.origin : Uri.parse(kApiUrl).origin.replaceFirst('://api.', '://app.');
  return Uri.parse(base).resolve(path).toString();
}

/// Only known local app destinations may be restored after authentication.
String? safeReturnPath(String? value) {
  if (value == null || !value.startsWith('/') || value.startsWith('//') || value.contains(r'\')) return null;
  if (RegExp(r'[\x00-\x20]').hasMatch(value) || value.contains('#')) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return null;
  const routes = {'/app', '/packages', '/quotes', '/contracts', '/invoices', '/billing', '/galleries', '/portfolio', '/announcements', '/booking', '/contact', '/wedding-inquiry', '/event-inquiry', '/quotation-request', '/favorites', '/profile-edit', '/find-me'};
  if (routes.contains(uri.path) || RegExp(r'^/gallery/[A-Za-z0-9_-]{1,100}(?:/(?:selection|photo))?$').hasMatch(uri.path)) return uri.toString();
  return null;
}

/// The API verifies the destination and reuses its stable, opaque short URL.
Future<String> createAppShareLink(String path) async {
  final response = await ApiService.dio.post('/links', data: {'path': path});
  final data = ApiService.unwrapData(response) as Map;
  return data['url'] as String;
}
