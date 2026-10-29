import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../services/api_service.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';

class FavoritesScreen extends ConsumerStatefulWidget {
  const FavoritesScreen({super.key});
  @override
  ConsumerState<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends ConsumerState<FavoritesScreen> {
  List<Photo> _favorites = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final favs = await ApiService.getFavorites();
      if (!mounted) return;
      setState(() {
        _favorites = favs;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _unheart(Photo p) async {
    Haptics.light();
    try {
      await ApiService.toggleFavorite(p.id, selected: false);
      if (!mounted) return;
      setState(() => _favorites = _favorites.where((x) => x.id != p.id).toList());
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        backgroundColor: AppColors.bg(context),
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: AppColors.text(context)),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/app?tab=gallery');
            }
          },
        ),
        title: Text('Favorites', style: AppTheme.display(22, context: context)),
      ),
      body: _loading
          ? Padding(
              padding: const EdgeInsets.all(16),
              child: GridView.count(
                crossAxisCount: 3,
                mainAxisSpacing: 6,
                crossAxisSpacing: 6,
                children: List.generate(9, (_) => const ShimmerBox(height: 100, radius: 10)),
              ),
            )
          : _favorites.isEmpty
              ? EmptyState(
                  icon: Icons.favorite_border_rounded,
                  title: 'No favorites yet',
                  subtitle: 'Tap the heart on any photo to keep it here.',
                  action: FilledButton(
                    onPressed: () => context.go('/app?tab=gallery'),
                    child: const Text('Browse galleries'),
                  ),
                )
              : RefreshIndicator(
                  color: AppColors.text(context),
                  onRefresh: _load,
                  child: GridView.builder(
                    padding: const EdgeInsets.fromLTRB(AppSpace.sm, AppSpace.xs, AppSpace.sm, AppSpace.bottomNav),
                    physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      mainAxisSpacing: 6,
                      crossAxisSpacing: 6,
                    ),
                    itemCount: _favorites.length,
                    itemBuilder: (_, i) {
                      final p = _favorites[i];
                      return Material(
                        color: AppColors.sunken(context),
                        borderRadius: BorderRadius.circular(12),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: p.galleryId != null && p.galleryId!.isNotEmpty
                              ? () => context.push('/gallery/${p.galleryId}')
                              : null,
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              p.thumbnailUrl != null
                                  ? CachedNetworkImage(
                                      imageUrl: p.thumbnailUrl!,
                                      fit: BoxFit.cover,
                                      memCacheWidth: 400,
                                    )
                                  : Container(color: AppColors.sunken(context)),
                              Positioned(
                                top: 6,
                                right: 6,
                                child: Material(
                                  color: Colors.black45,
                                  shape: const CircleBorder(),
                                  child: InkWell(
                                    customBorder: const CircleBorder(),
                                    onTap: () => _unheart(p),
                                    child: const Padding(
                                      padding: EdgeInsets.all(6),
                                      child: Icon(Icons.favorite_rounded, color: AppColors.rose, size: 18),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
