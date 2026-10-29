import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import 'auth_provider.dart';

/// Galleries assigned to the signed-in customer (access grants).
/// Empty list means the photo dashboard / face search must stay hidden.
final galleriesProvider = FutureProvider<List<Gallery>>((ref) async {
  final customer = ref.watch(authStateProvider).value;
  if (customer == null) return <Gallery>[];
  return ApiService.getMyGalleries();
});

/// Derived access flags for shell / home / face gating.
class ClientAccess {
  final bool loading;
  final bool hasGalleries;
  final bool hasFaceSearch;
  final List<Gallery> galleries;

  const ClientAccess({
    required this.loading,
    required this.hasGalleries,
    required this.hasFaceSearch,
    required this.galleries,
  });

  factory ClientAccess.fromGalleries(List<Gallery> galleries) => ClientAccess(
        loading: false,
        hasGalleries: galleries.isNotEmpty,
        hasFaceSearch: galleries.any((g) => g.faceSearchEnabled),
        galleries: galleries,
      );

  static const loadingState = ClientAccess(
    loading: true,
    hasGalleries: false,
    hasFaceSearch: false,
    galleries: [],
  );

  static const none = ClientAccess(
    loading: false,
    hasGalleries: false,
    hasFaceSearch: false,
    galleries: [],
  );
}

final clientAccessProvider = Provider<ClientAccess>((ref) {
  final async = ref.watch(galleriesProvider);
  if (async.hasValue) return ClientAccess.fromGalleries(async.value!);
  return async.when(
    data: ClientAccess.fromGalleries,
    loading: () => ClientAccess.loadingState,
    // Keep My photos reachable so a transient failure presents its retry UI.
    error: (_, __) => const ClientAccess(loading: false, hasGalleries: true, hasFaceSearch: false, galleries: []),
  );
});

final galleryPhotosProvider = FutureProvider.family<Map<String, dynamic>, String>(
  (ref, galleryId) => ApiService.getGalleryPhotos(galleryId),
);

// Favorites state
final favoritesSetProvider = StateProvider<Set<String>>((ref) => {});

class PhotosNotifier extends StateNotifier<List<Photo>> {
  PhotosNotifier() : super([]);

  void setPhotos(List<Photo> photos) => state = photos;

  void toggleFavorite(String photoId, bool newValue) {
    state = state.map((p) => p.id == photoId ? p.copyWith(isFavorite: newValue) : p).toList();
  }
}

final photosNotifierProvider = StateNotifierProvider<PhotosNotifier, List<Photo>>(
  (_) => PhotosNotifier(),
);
