import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../screens/login_screen.dart';
import '../screens/shared_link_screen.dart';
import '../screens/auth_callback_screen.dart';
import '../screens/shell_screen.dart';
import '../screens/galleries_screen.dart';
import '../screens/gallery_detail_screen.dart';
import '../screens/photo_viewer_screen.dart';
import '../screens/shared_photo_screen.dart';
import '../screens/favorites_screen.dart';
import '../screens/face_search_screen.dart';
import '../screens/selection_review_screen.dart';
import '../screens/contracts_screen.dart';
import '../screens/quotes_screen.dart';
import '../screens/portfolio_screen.dart';
import '../screens/booking_screen.dart';
import '../screens/contact_screen.dart';
import '../screens/profile_screen.dart';
import '../screens/guest_share_screen.dart';
import '../screens/invoices_screen.dart';
import '../screens/wedding_inquiry_screen.dart';
import '../screens/event_inquiry_screen.dart';
import '../screens/quotation_request_screen.dart';
import '../models/models.dart';
import '../screens/packages_screen.dart';
import '../screens/announcements_screen.dart';
import '../services/share_links.dart';

/// Refresh redirects when auth changes — without disposing/recreating GoRouter.
class _RouterRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

/// Read the real browser location (path strategy) so QR /share/TOKEN never
/// gets replaced by /login on boot.
///
/// Prefer the full browser path (not only /share) so deep links work; fall
/// back to hash routes for older QR codes.
String? _browserLocationPath() {
  if (!kIsWeb) return null;
  try {
    final path = Uri.base.path;
    if (path.isNotEmpty && path != '/') {
      final q = Uri.base.hasQuery ? '?${Uri.base.query}' : '';
      return '$path$q';
    }
    final frag = Uri.base.fragment;
    if (frag.startsWith('/')) return frag;
    if (frag.isNotEmpty) return '/$frag';
  } catch (_) {}
  return null;
}

String? _browserSharePath() {
  final loc = _browserLocationPath();
  if (loc != null && _isSharePath(loc.split('?').first)) return loc;
  return null;
}

String _initialLocation() {
  return _browserLocationPath() ?? '/login';
}

bool _isSharePath(String path) => path.startsWith('/share/') || path.startsWith('/s/');

bool _isPublicGuest(GoRouterState state) {
  final path = state.uri.path;
  if (_isSharePath(path) || path.startsWith('/l/') || path.startsWith('/r/') || path == '/link-unavailable') return true;
  if (path == '/auth/callback') return true;
  if (path == '/quotation-request' && state.uri.queryParameters.containsKey('studioId')) return true;
  if (path == '/find-me' &&
      (state.uri.queryParameters.containsKey('guestToken') ||
          state.uri.queryParameters.containsKey('guestCustomerToken'))) {
    return true;
  }
  return false;
}

/// KeepAlive GoRouter — AutoDispose was recreating the router and sending
/// QR guests to the login screen.
final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh();
  ref.onDispose(refresh.dispose);
  ref.listen(authStateProvider, (_, __) => refresh.ping());

  final router = GoRouter(
    initialLocation: _initialLocation(),
    refreshListenable: refresh,
    debugLogDiagnostics: false,
    redirect: (context, state) {
      // 1) Browser still on /share/… but router is elsewhere → force share route
      final browserShare = _browserSharePath();
      if (browserShare != null) {
        final current = state.uri.path;
        if (!_isSharePath(current)) {
          return browserShare;
        }
        // Already on share — never redirect to login
        return null;
      }

      // 2) Explicit public guest routes
      if (_isPublicGuest(state)) return null;

      final path = state.uri.path;
      final auth = ref.read(authStateProvider);
      final isLoggedIn = auth.asData?.value != null;
      final isLogin = path == '/login' || path == '/';

      if (auth.isLoading) return null;
      if (!isLoggedIn && !isLogin) return '/login?from=${Uri.encodeComponent(state.uri.toString())}';
      if (isLoggedIn && isLogin) {
        final from = state.uri.queryParameters['from'];
        return safeReturnPath(from) ?? '/app';
      }
      if (isLoggedIn && path == '/galleries') return '/app?tab=gallery';
      return null;
    },
    errorBuilder: (context, state) => const LinkUnavailableScreen(),
    routes: [
      GoRoute(path: '/r/:token', builder: (ctx, state) => SharedLinkScreen(key: ValueKey(state.uri.toString()), token: state.pathParameters['token']!)),
      GoRoute(path: '/l/:token', builder: (ctx, state) => SharedLinkScreen(key: ValueKey(state.uri.toString()), token: state.pathParameters['token']!)),
      GoRoute(path: '/link-unavailable', builder: (ctx, state) => const LinkUnavailableScreen()),
      GoRoute(path: '/s/:token', builder: (ctx, state) => GuestShareScreen(key: ValueKey(state.uri.toString()), token: state.pathParameters['token']!)),
      GoRoute(
        path: '/login',
        builder: (ctx, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/share/:token',
        builder: (ctx, state) {
          final token = state.pathParameters['token'] ?? '';
          return GuestShareScreen(key: ValueKey(state.uri.toString()), token: token);
        },
      ),
      GoRoute(
        path: '/auth/callback',
        builder: (ctx, state) => AuthCallbackScreen(uri: state.uri),
      ),
      GoRoute(
        path: '/app',
        builder: (ctx, state) {
          final tabParam = state.uri.queryParameters['tab'] ?? '0';
          final numeric = int.tryParse(tabParam);
          // Stable key — remounting on every tab change wiped scroll, forms, and coupons.
          return ShellScreen(
            initialIndex: (numeric ?? 0).clamp(0, 8),
            initialTab: numeric == null ? tabParam : null,
          );
        },
      ),
      GoRoute(path: '/quotation-request', builder: (ctx, state) => QuotationRequestScreen(key: ValueKey(state.uri.toString()), studioId: state.uri.queryParameters['studioId'], requestId: state.uri.queryParameters['requestId'], token: state.uri.queryParameters['token'])),
      GoRoute(path: '/quotes', builder: (ctx, state) => QuotesScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/packages', builder: (ctx, state) => PackagesScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/galleries', builder: (ctx, state) => const GalleriesScreen()),
      GoRoute(
        path: '/gallery/:id',
        builder: (ctx, state) => GalleryDetailScreen(key: ValueKey(state.uri.toString()), galleryId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/gallery/:id/photo',
        builder: (ctx, state) {
          final photoId = state.uri.queryParameters['photoId'];
          if (photoId != null) return SharedPhotoScreen(key: ValueKey(state.uri.toString()), galleryId: state.pathParameters['id']!, photoId: photoId);
          final extra = state.extra as Map<String, dynamic>? ?? {};
          final photos = (extra['photos'] as List<Photo>?) ?? <Photo>[];
          return PhotoViewerScreen(
            galleryId: state.pathParameters['id']!,
            photos: photos,
            initialIndex: extra['initialIndex'] as int? ?? 0,
            selectionEnabled: extra['selectionEnabled'] as bool? ?? true,
            downloadsAllowed: extra['downloadsAllowed'] as bool? ?? false,
            lockedPhotoIds: (extra['lockedPhotoIds'] as List?)
                    ?.map((e) => e.toString())
                    .toList() ??
                const <String>[],
            includedLimit: extra['includedLimit'] as int? ?? 0,
            selectionPhase: extra['selectionPhase'] as String? ?? 'INCLUDED',
            heartedCount: extra['heartedCount'] as int? ?? 0,
            extraDeliveryTypes: _stringMap(extra['extraDeliveryTypes']),
            rawRate: (extra['rawRate'] as num?)?.toDouble() ?? 200,
            editRate: (extra['editRate'] as num?)?.toDouble() ?? 350,
            billedExtraPhotoIds: (extra['billedExtraPhotoIds'] as List?)
                    ?.map((e) => e.toString())
                    .toList() ??
                const <String>[],
          );
        },
      ),
      GoRoute(
        path: '/gallery/:id/selection',
        builder: (ctx, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          final pending = <Map<String, String>>[];
          final rawPending = extra['pendingExtras'];
          if (rawPending is List) {
            for (final row in rawPending) {
              if (row is Map) {
                pending.add({
                  'id': '${row['id'] ?? ''}',
                  if (row['thumbnailUrl'] != null) 'thumbnailUrl': '${row['thumbnailUrl']}',
                  if (row['previewUrl'] != null) 'previewUrl': '${row['previewUrl']}',
                });
              }
            }
          }
          return SelectionReviewScreen(
            galleryId: state.pathParameters['id']!,
            galleryName: extra['name'] as String? ?? 'Gallery',
            extraDeliveryTypes: _stringMap(extra['extraDeliveryTypes']),
            pendingExtras: pending,
            selectionPhase: extra['selectionPhase'] as String? ?? 'INCLUDED',
            extraRate: (extra['extraRate'] as num?)?.toDouble() ?? 0,
          );
        },
      ),
      GoRoute(path: '/favorites', builder: (ctx, state) => const FavoritesScreen()),
      GoRoute(path: '/contracts', builder: (ctx, state) => ContractsScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(
        path: '/find-me',
        builder: (ctx, state) => FaceSearchScreen(
          galleryId: state.uri.queryParameters['galleryId'],
          guestAccessToken: state.uri.queryParameters['guestToken'],
          guestCustomerToken: state.uri.queryParameters['guestCustomerToken'],
        ),
      ),
      GoRoute(path: '/portfolio', builder: (ctx, state) => PortfolioScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/booking', builder: (ctx, state) => const BookingScreen()),
      GoRoute(path: '/event-inquiry', builder: (ctx, state) => const EventInquiryScreen()),
      GoRoute(path: '/wedding-inquiry', builder: (ctx, state) => const WeddingInquiryScreen()),
      GoRoute(path: '/announcements', builder: (ctx, state) => AnnouncementsScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/contact', builder: (ctx, state) => const ContactScreen()),
      GoRoute(path: '/profile-edit', builder: (ctx, state) => const ProfileScreen()),
      GoRoute(path: '/invoices', builder: (ctx, state) => InvoicesScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/billing', builder: (ctx, state) => InvoicesScreen(key: ValueKey(state.uri.toString()), highlightId: state.uri.queryParameters['id'])),
      GoRoute(path: '/legal/privacy', builder: (ctx, state) => const ContactScreen()),
    ],
  );

  // Prevent accidental disposal when using ProviderScope rebuilds
  ref.keepAlive();
  return router;
});

Map<String, String> _stringMap(dynamic raw) {
  if (raw is! Map) return const {};
  return {
    for (final e in raw.entries) e.key.toString(): e.value.toString(),
  };
}
