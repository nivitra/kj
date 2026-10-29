import '../widgets/app_back_button.dart';
import '../widgets/share_link_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import '../providers/gallery_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/gallery_card.dart';

/// Galleries list. Never auto-opens a gallery — client must tap one.
/// [embedded] when shown inside bottom-nav shell (no outer scaffold chrome).
class GalleriesScreen extends ConsumerStatefulWidget {
  final bool embedded;
  const GalleriesScreen({super.key, this.embedded = false});

  @override
  ConsumerState<GalleriesScreen> createState() => _GalleriesScreenState();
}

class _GalleriesScreenState extends ConsumerState<GalleriesScreen> {
  List<StudioPackage> _packages = [];
  String? _currentPackageId;
  String? _requestedPackageId;
  String? _packageBusyId;

  @override
  void initState() {
    super.initState();
    if (!widget.embedded) _loadPackages();
  }

  Future<void> _loadPackages() async {
    try {
      final data = await ApiService.getPackages();
      if (!mounted) return;
      setState(() {
        _packages = (data['packages'] as List<StudioPackage>?) ?? [];
        _currentPackageId = data['currentPackageId'] as String?;
        _requestedPackageId = data['requestedPackageId'] as String?;
      });
    } catch (_) {}
  }

  Future<void> _selectPackage(StudioPackage pkg) async {
    setState(() => _packageBusyId = pkg.id);
    try {
      final customer = await ApiService.requestPackage(pkg.id);
      ref.read(authStateProvider.notifier).setCustomer(customer);
      if (!mounted) return;
      setState(() {
        _currentPackageId = pkg.id;
        _requestedPackageId = pkg.id;
        _packageBusyId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Selected ${pkg.name}'),
          backgroundColor: AppColors.text(context),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _packageBusyId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiService.errorMessage(e) ?? 'Could not select package'),
          backgroundColor: const Color(0xFFB4534B),
        ),
      );
    }
  }

  Future<void> _refresh() async {
    ref.invalidate(galleriesProvider);
    await Future.wait([
      ref.read(galleriesProvider.future).catchError((_) => <Gallery>[]),
      _loadPackages(),
      ref.read(authStateProvider.notifier).refresh(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final customer = ref.watch(authStateProvider).value;
    final galleriesAsync = ref.watch(galleriesProvider);
    final firstName = customer?.name.split(' ').first ?? 'there';
    final studioName = customer?.studio?.name ?? 'Studio';
    final status = customer?.status;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: RefreshIndicator(
        color: AppColors.text(context),
        backgroundColor: AppColors.card(context),
        onRefresh: _refresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            if (!widget.embedded)
              SliiverHomeAppBar(
                studioName: studioName,
                onFindMe: ref.watch(clientAccessProvider).hasFaceSearch
                    ? () => context.push('/find-me')
                    : null,
                onFavorites: () => context.push('/favorites'),
                menu: _menuButton(context, ref),
              )
            else
              SliverAppBar(
                leading: const AppBackButton(),
                pinned: true,
                backgroundColor: AppColors.bg(context),
                surfaceTintColor: Colors.transparent,
                automaticallyImplyLeading: false,
                title: Text('Galleries', style: AppTheme.display(22)),
                actions: [
                  const ShareLinkButton(path: '/galleries', title: 'Share galleries'),
                  IconButton(
                    icon: const Icon(Icons.favorite_border_rounded),
                    onPressed: () => context.push('/favorites'),
                  ),
                ],
              ),
            if (!widget.embedded)
              SliverToBoxAdapter(
                child: Padding(
                  padding: AppSpace.pageH(top: AppSpace.xs, bottom: AppSpace.xs),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Hello, $firstName.', style: AppTheme.display(28, height: 1.05)),
                      const SizedBox(height: AppSpace.xxs),
                      Text(
                        'Your collections and packages, in one place.',
                        style: TextStyle(color: AppColors.text2(context), fontSize: 14, height: 1.4),
                      ),
                      if (status != null && status.isNotEmpty) ...[
                        const SizedBox(height: AppSpace.sm),
                        _statusBanner(status),
                      ],
                    ],
                  ),
                ),
              ),
            // Optional legacy pricing packages only outside shell
            if (!widget.embedded && _packages.isNotEmpty)
              SliiverPackages(
                packages: _packages,
                currentId: _currentPackageId,
                requestedId: _requestedPackageId,
                busyId: _packageBusyId,
                onSelect: _selectPackage,
              ),
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  AppSpace.page,
                  widget.embedded ? AppSpace.xs : AppSpace.sm,
                  AppSpace.page,
                  AppSpace.xs,
                ),
                child: Text(
                  widget.embedded ? 'Your collections' : 'Your galleries',
                  style: AppTheme.display(18),
                ),
              ),
            ),
            galleriesAsync.when(
              loading: _loadingSliver,
              error: (e, _) => SliverFillRemaining(
                hasScrollBody: false,
                child: _messageState(
                  icon: Icons.cloud_off_rounded,
                  title: 'Couldn\'t load your galleries',
                  subtitle: 'Please check your connection and try again.',
                  action: TextButton(
                    onPressed: () => ref.invalidate(galleriesProvider),
                    style: TextButton.styleFrom(foregroundColor: AppColors.text(context)),
                    child: const Text('Try again', style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
                ),
              ),
              data: (galleries) => galleries.isEmpty
                  ? SliverToBoxAdapter(
                      child: Padding(
                        padding: AppSpace.pageH(top: AppSpace.xs, bottom: AppSpace.bottomNav),
                        child: _emptyGalleries(),
                      ),
                    )
                  : SliverPadding(
                      padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xxs, AppSpace.page, AppSpace.bottomNav),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (ctx, i) {
                            if (i == 0) {
                              return Padding(
                                padding: const EdgeInsets.fromLTRB(0, 0, 0, AppSpace.xs),
                                child: Text(
                                  '${galleries.length} ${galleries.length == 1 ? "collection" : "collections"} — tap one to open',
                                  style: TextStyle(
                                    color: AppColors.text3(context),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              );
                            }
                            final gallery = galleries[i - 1];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: AppSpace.sm),
                              child: GalleryCard(
                                gallery: gallery,
                                // push (not go) so back returns to this list
                                onTap: () => context.push('/gallery/${gallery.id}'),
                              ),
                            );
                          },
                          childCount: galleries.length + 1,
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusBanner(String status) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline_rounded, size: 16, color: AppColors.accent(context)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Update from your studio',
                    style: TextStyle(
                      color: AppColors.text3(context),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.3,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    status,
                    style: TextStyle(
                      color: AppColors.text(context),
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _emptyGalleries() => Container(
        padding: const EdgeInsets.all(AppSpace.md),
        decoration: BoxDecoration(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Column(
          children: [
            Icon(Icons.photo_album_outlined, color: AppColors.text3(context), size: 28),
            const SizedBox(height: AppSpace.xs),
            Text(
              'No galleries yet',
              style: TextStyle(color: AppColors.text(context), fontWeight: FontWeight.w600, fontSize: 15),
            ),
            const SizedBox(height: AppSpace.xxs),
            Text(
              'When your studio shares a collection with you, it will appear here. You never open someone else\'s gallery.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.text2(context), fontSize: 13, height: 1.4),
            ),
          ],
        ),
      );

  Widget _menuButton(BuildContext context, WidgetRef ref) {
    final showFace = ref.watch(clientAccessProvider).hasFaceSearch;
    return PopupMenuButton<String>(
      offset: const Offset(0, 48),
      color: AppColors.card(context),
      surfaceTintColor: Colors.transparent,
      elevation: 3,
      shadowColor: Colors.black26,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: AppColors.border(context)),
      ),
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Icon(Icons.more_horiz_rounded, color: AppColors.text(context), size: 20),
      ),
      itemBuilder: (_) => [
        if (showFace)
          PopupMenuItem(
            value: 'find-me',
            height: 44,
            child: Row(children: [
              Icon(Icons.face_retouching_natural_outlined, color: AppColors.text2(context), size: 18),
              const SizedBox(width: 12),
              Text('Find my photos',
                  style: TextStyle(color: AppColors.text(context), fontSize: 14, fontWeight: FontWeight.w500)),
            ]),
          ),
        PopupMenuItem(
          value: 'favorites',
          height: 44,
          child: Row(children: [
            Icon(Icons.favorite_border_rounded, color: AppColors.text2(context), size: 18),
            const SizedBox(width: 12),
            Text('Favorites',
                style: TextStyle(color: AppColors.text(context), fontSize: 14, fontWeight: FontWeight.w500)),
          ]),
        ),
        PopupMenuItem(
          value: 'contracts',
          height: 44,
          child: Row(children: [
            Icon(Icons.description_outlined, color: AppColors.text2(context), size: 18),
            const SizedBox(width: 12),
            Text('Contracts',
                style: TextStyle(color: AppColors.text(context), fontSize: 14, fontWeight: FontWeight.w500)),
          ]),
        ),
        PopupMenuItem(
          value: 'logout',
          height: 44,
          child: Row(children: [
            Icon(Icons.logout_rounded, color: AppColors.text2(context), size: 18),
            const SizedBox(width: 12),
            Text('Sign out',
                style: TextStyle(color: AppColors.text(context), fontSize: 14, fontWeight: FontWeight.w500)),
          ]),
        ),
      ],
      onSelected: (v) {
        if (v == 'logout') {
          ref.read(authStateProvider.notifier).logout();
        } else if (v == 'find-me' && showFace) {
          context.push('/find-me');
        } else if (v == 'favorites') {
          context.push('/favorites');
        } else if (v == 'contracts') {
          context.push('/contracts');
        }
      },
    );
  }

  Widget _loadingSliver() => SliverPadding(
        padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xs, AppSpace.page, 0),
        sliver: SliiverList(
          childCount: 2,
          builder: (_, __) => Container(
            height: 160,
            margin: const EdgeInsets.only(bottom: AppSpace.sm),
            decoration: BoxDecoration(
              color: AppColors.card(context),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border(context)),
            ),
          ),
        ),
      );

  Widget _messageState({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? action,
  }) =>
      Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: AppColors.text3(context), size: 28),
              const SizedBox(height: AppSpace.sm),
              Text(title, style: AppTheme.display(20)),
              const SizedBox(height: 8),
              Text(subtitle, style: TextStyle(color: AppColors.text2(context), fontSize: 14), textAlign: TextAlign.center),
              if (action != null) ...[const SizedBox(height: 12), action],
            ],
          ),
        ),
      );
}

class SliiverHomeAppBar extends StatelessWidget {
  final String studioName;
  final VoidCallback? onFindMe;
  final VoidCallback onFavorites;
  final Widget menu;
  const SliiverHomeAppBar({
    super.key,
    required this.studioName,
    this.onFindMe,
    required this.onFavorites,
    required this.menu,
  });

  @override
  Widget build(BuildContext context) {
    return SliiverAppBarCompat(
      studioName: studioName,
      onFindMe: onFindMe,
      onFavorites: onFavorites,
      menu: menu,
    );
  }
}

class SliiverAppBarCompat extends StatelessWidget {
  final String studioName;
  final VoidCallback? onFindMe;
  final VoidCallback onFavorites;
  final Widget menu;
  const SliiverAppBarCompat({
    super.key,
    required this.studioName,
    this.onFindMe,
    required this.onFavorites,
    required this.menu,
  });

  @override
  Widget build(BuildContext context) {
    return SliverAppBar(
      pinned: true,
      backgroundColor: AppColors.bg(context),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      toolbarHeight: 64,
      titleSpacing: 24,
      title: Text(studioName.toUpperCase(), style: AppTheme.kicker()),
      actions: [
        if (onFindMe != null) ...[
          _icon(context, Icons.face_retouching_natural_outlined, onFindMe!),
          const SizedBox(width: 4),
        ],
        _icon(context, Icons.favorite_border_rounded, onFavorites),
        const SizedBox(width: 8),
        menu,
        const SizedBox(width: 16),
      ],
    );
  }

  Widget _icon(BuildContext context, IconData icon, VoidCallback onTap) => Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.card(context),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border(context)),
            ),
            child: Icon(icon, color: AppColors.text(context), size: 20),
          ),
        ),
      );
}

class SliiverPackages extends StatelessWidget {
  final List<StudioPackage> packages;
  final String? currentId;
  final String? requestedId;
  final String? busyId;
  final Future<void> Function(StudioPackage) onSelect;

  const SliiverPackages({
    super.key,
    required this.packages,
    required this.currentId,
    required this.requestedId,
    required this.busyId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(
      child: SizedBox(
        height: 148,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.page),
          itemCount: packages.length,
          separatorBuilder: (_, __) => const SizedBox(width: AppSpace.xs),
          itemBuilder: (ctx, i) {
            final p = packages[i];
            final selected = p.id == currentId || p.id == requestedId;
            final busy = busyId == p.id;
            return Container(
              width: 200,
              padding: const EdgeInsets.all(AppSpace.sm),
              decoration: BoxDecoration(
                color: AppColors.card(context),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: selected ? AppColors.text(context) : AppColors.border(context),
                  width: selected ? 1.5 : 1,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    p.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppColors.text(context),
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: AppSpace.xxs),
                  Text(
                    [
                      if (p.includedPhotos != null) '${p.includedPhotos} photos',
                      p.displayPrice,
                    ].join(' · '),
                    style: TextStyle(color: AppColors.text2(context), fontSize: 12),
                  ),
                  if (p.description != null && p.description!.isNotEmpty) ...[
                    const SizedBox(height: AppSpace.xxs),
                    Text(
                      p.description!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: AppColors.text3(context), fontSize: 11, height: 1.25),
                    ),
                  ],
                  const Spacer(),
                  SizedBox(
                    width: double.infinity,
                    height: 32,
                    child: FilledButton(
                      onPressed: (selected || busy) ? null : () => onSelect(p),
                      style: FilledButton.styleFrom(
                        backgroundColor: selected ? AppColors.text(context).withValues(alpha: 0.12) : AppColors.text(context),
                        foregroundColor: selected ? AppColors.text(context) : Colors.white,
                        disabledBackgroundColor: AppColors.text(context).withValues(alpha: 0.1),
                        disabledForegroundColor: AppColors.text(context),
                        padding: EdgeInsets.zero,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: busy
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              selected ? 'Selected' : 'Choose',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class SliiverList extends StatelessWidget {
  final int childCount;
  final Widget Function(BuildContext, int) builder;
  const SliiverList({super.key, required this.childCount, required this.builder});

  @override
  Widget build(BuildContext context) {
    return SliverList(
      delegate: SliverChildBuilderDelegate(builder, childCount: childCount),
    );
  }
}
