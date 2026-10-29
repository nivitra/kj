import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../providers/gallery_provider.dart';
import '../providers/theme_provider.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/announcement_ui.dart';
import '../widgets/booking_sheet.dart';
import '../widgets/premium_ui.dart';
import '../widgets/studio_branding.dart';
import '../widgets/quotation_home_card.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;
  final _scroll = ScrollController();
  Set<String> _dismissedPopups = {};
  Set<String> _dismissedBanners = {};
  bool _popupShownThisSession = false;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final results = await Future.wait([
      AnnouncementPrefs.dismissedPopups(),
      AnnouncementPrefs.dismissedBanners(),
    ]);
    if (!mounted) return;
    setState(() {
      _dismissedPopups = results[0];
      _dismissedBanners = results[1];
    });
    await _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (force) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final d = await PortalApi.home(force: force);
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
        _error = null;
      });
      // Apply studio-controlled app theme from home profile
      if (d['profile'] is Map) {
        final profile = Map<String, dynamic>.from(d['profile'] as Map);
        ref.read(studioAppearanceProvider.notifier).applyFromMap(profile);
        final app = ref.read(studioAppearanceProvider);
        ref.read(themeModeProvider.notifier).applyStudioMode(app.mode);
      }
      _maybeShowPopup();
      if (!force) {
        PortalApi.home(force: true).then((fresh) {
          if (mounted) {
            setState(() => _data = fresh);
            if (fresh['profile'] is Map) {
              ref.read(studioAppearanceProvider.notifier).applyFromMap(
                    Map<String, dynamic>.from(fresh['profile'] as Map),
                  );
            }
            _maybeShowPopup();
          }
        }).catchError((_) {});
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        if (_data == null) {
          _error = e.toString();
          _loading = false;
        }
      });
    }
  }

  List<Map> get _announcements {
    final raw = (_data?['announcements'] as List?) ?? [];
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Map? get _bannerAnn {
    final candidates = _announcements
        .where(annIsBanner)
        .where((a) => !_dismissedBanners.contains(a['id']?.toString()))
        .toList();
    if (candidates.isEmpty) return null;
    candidates.sort((a, b) =>
        ((b['priority'] as num?) ?? 0).compareTo((a['priority'] as num?) ?? 0));
    return candidates.first;
  }

  List<Map> get _feedAnns {
    return _announcements.where(annIsFeed).toList();
  }

  void _maybeShowPopup() {
    if (_popupShownThisSession || !mounted) return;
    final candidates = _announcements
        .where(annIsPopup)
        .where((a) {
          final id = a['id']?.toString() ?? '';
          return id.isNotEmpty && !_dismissedPopups.contains(id);
        })
        .toList();
    if (candidates.isEmpty) return;
    candidates.sort((a, b) =>
        ((b['priority'] as num?) ?? 0).compareTo((a['priority'] as num?) ?? 0));
    final ann = candidates.first;
    final id = ann['id']?.toString() ?? '';
    if (id.isEmpty) return;
    _popupShownThisSession = true;

    // Wait for shell/home layout to settle (IndexedStack + first frame)
    Future<void>.delayed(const Duration(milliseconds: 450), () async {
      if (!mounted) return;
      try {
        await showAnnouncementPopup(
          context,
          announcement: ann,
          confetti: true,
          onDismiss: () async {
            await AnnouncementPrefs.dismissPopup(id);
            if (mounted) {
              setState(() => _dismissedPopups = {..._dismissedPopups, id});
            }
          },
        );
      } catch (_) {
        // Allow retry next load if dialog failed hard
        if (mounted) _popupShownThisSession = false;
      }
    });
  }

  Future<void> _dismissBanner(String id) async {
    await AnnouncementPrefs.dismissBanner(id);
    if (mounted) setState(() => _dismissedBanners = {..._dismissedBanners, id});
  }

  /// Card / banner tap → same confetti popup (always works).
  Future<void> _openAnnDetail(Map a) async {
    if (!mounted) return;
    final id = a['id']?.toString() ?? '';
    await showAnnouncementPopup(
      context,
      announcement: a,
      confetti: true,
      onDismiss: () async {
        // Manual open: don't permanently dismiss unless user hits Got it
        // (dismiss is called when dialog closes either way — keep soft)
        if (id.isNotEmpty) {
          await AnnouncementPrefs.dismissPopup(id);
          if (mounted) {
            setState(() => _dismissedPopups = {..._dismissedPopups, id});
          }
        }
      },
    );
  }

  String _money(dynamic n) {
    if (n == null) return '—';
    final v = n is num ? n.toDouble() : double.tryParse('$n') ?? 0;
    if (v >= 100000) return '₹${(v / 100000).toStringAsFixed(v % 100000 == 0 ? 0 : 1)}L';
    if (v >= 1000) return '₹${(v / 1000).toStringAsFixed(v % 1000 == 0 ? 0 : 1)}K';
    return '₹${v.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final customer = ref.watch(authStateProvider).value;
    final access = ref.watch(clientAccessProvider);
    final firstName = customer?.name.split(' ').first ?? 'there';
    final profile = _data?['profile'] as Map?;
    final galleries = (_data?['galleries'] as List?) ?? [];
    final banner = _bannerAnn;
    final feedAnns = _feedAnns;
    final featured = _data?['featuredPackage'] as Map?;
    final bookingRaw = _data?['booking'];
    final booking = bookingRaw is Map && bookingRaw.isNotEmpty ? bookingRaw : null;
    final portfolio = (_data?['portfolio'] as List?) ?? [];
    final payment = _data?['payment'] as Map? ?? _data?['billing'] as Map?;
    final favCount = _data?['favoriteCount'] ?? 0;
    final statusBanner = customer?.status;
    final showGalleries = access.hasGalleries;
    final photoCount = galleries.fold<int>(0, (s, g) {
      final m = g is Map ? g : <String, dynamic>{};
      return s + ((m['photoCount'] ?? m['photosCount'] ?? m['_count']?['photos'] ?? 0) as num).toInt();
    });

    return RefreshIndicator(
      color: AppColors.text(context),
      onRefresh: () async {
        Haptics.light();
        await _load(force: true);
      },
      child: CustomScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
        slivers: [
          SliverAppBar(
            pinned: true,
            backgroundColor: AppColors.bg(context),
            surfaceTintColor: Colors.transparent,
            leading: IconButton(
              icon: Icon(Icons.menu_rounded, color: AppColors.text(context)),
              onPressed: () => Scaffold.of(context).openDrawer(),
            ),
            title: Text(
              (profile?['displayName'] as String? ?? customer?.studio?.name ?? 'Studio').toUpperCase(),
              style: AppTheme.kicker(context: context),
            ),
            actions: [
              IconButton(
                icon: Icon(Icons.receipt_long_outlined, color: AppColors.text(context)),
                tooltip: 'Payments',
                onPressed: () => context.push('/invoices'),
              ),
            ],
          ),
          if (_loading && _data == null)
            const SliverFillRemaining(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Column(
                  children: [
                    ShimmerBox(height: 180, radius: 20),
                    SizedBox(height: 16),
                    ShimmerBox(height: 28, width: 200, radius: 8),
                    SizedBox(height: 12),
                    ShimmerBox(height: 100, radius: 16),
                    SizedBox(height: 12),
                    ShimmerBox(height: 72, radius: 16),
                  ],
                ),
              ),
            )
          else if (_error != null && _data == null)
            SliiverError(error: _error!, onRetry: _load)
          else ...[
            // Sticky studio announcement banner (BANNER / BOTH)
            if (banner != null)
              SliverToBoxAdapter(
                child: AnnouncementBanner(
                  announcement: banner,
                  onDismiss: () => _dismissBanner(banner['id']?.toString() ?? ''),
                  onOpen: () => _openAnnDetail(banner),
                ),
              ),

            // Parallax-ish hero
            SliiverHero(profile: profile, fallback: customer?.studio?.name ?? 'SJ Clicks'),

            SliverToBoxAdapter(
              child: Padding(
                padding: AppSpace.pageH(top: AppSpace.md, bottom: AppSpace.xs),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Hello, $firstName', style: AppTheme.display(24, context: context)),
                    const SizedBox(height: 20),
                    const QuotationHomeCard(),
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      profile?['welcomeMessage'] as String? ??
                          (showGalleries
                              ? 'Your collections and updates from the studio.'
                              : 'Explore our work and packages. Private galleries appear once assigned.'),
                      style: TextStyle(color: AppColors.text2(context), fontSize: 14, height: 1.45),
                    ),
                    if (statusBanner != null && statusBanner.isNotEmpty) ...[
                      const SizedBox(height: AppSpace.sm),
                      PremiumCard(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Row(
                          children: [
                            Icon(Icons.info_outline_rounded, size: 16, color: AppColors.accent(context)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                statusBanner,
                                style: TextStyle(
                                  fontSize: 13,
                                  height: 1.3,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.text(context),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),

            // Mini booking timeline
            if (booking != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: AppSpace.pageH(top: AppSpace.md, bottom: 0),
                  child: _BookingMiniCard(booking: booking, onTap: () => context.push('/booking')),
                ),
              ),

            // Smart stats
            SliverToBoxAdapter(
              child: Padding(
                padding: AppSpace.pageH(top: AppSpace.sm, bottom: 0),
                child: Row(
                  children: [
                    Expanded(
                      child: _StatCard(
                        icon: Icons.account_balance_wallet_outlined,
                        label: 'Balance',
                        value: payment != null
                            ? _money(payment['balance'] ?? payment['outstanding'] ?? payment['totalDue'])
                            : '—',
                        onTap: () => context.push('/invoices'),
                      ),
                    ),
                    const SizedBox(width: AppSpace.xs),
                    Expanded(
                      child: _StatCard(
                        icon: Icons.photo_outlined,
                        label: 'Photos',
                        value: showGalleries ? '$photoCount' : '—',
                        onTap: showGalleries ? () => context.go('/app?tab=gallery') : null,
                      ),
                    ),
                    const SizedBox(width: AppSpace.xs),
                    Expanded(
                      child: _StatCard(
                        icon: Icons.favorite_border_rounded,
                        label: 'Favs',
                        value: '${favCount is num ? favCount : 0}',
                        onTap: () => context.push('/favorites'),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Announcements feed carousel
            if (feedAnns.isNotEmpty) ...[
              const SectionHeader(title: 'From the studio', asSliver: true),
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 104,
                  child: PageView.builder(
                    controller: PageController(viewportFraction: 0.92),
                    itemCount: feedAnns.length,
                    itemBuilder: (_, i) {
                      final a = feedAnns[i];
                      return Padding(
                        padding: EdgeInsets.only(
                          left: i == 0 ? AppSpace.page : 0,
                          right: AppSpace.xs,
                        ),
                        child: AnnouncementFeedCard(
                          announcement: a,
                          onTap: () => _openAnnDetail(a),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ],

            // Galleries or empty state
            if (showGalleries) ...[
              SectionHeader(
                title: 'Your galleries',
                actionLabel: 'See all',
                onAction: () => context.go('/app?tab=gallery'),
                asSliver: true,
              ),
              if (galleries.isEmpty)
                const SliverToBoxAdapter(
                  child: EmptyState(
                    icon: Icons.photo_library_outlined,
                    title: 'No galleries shared yet',
                    subtitle: 'Your studio will assign private collections here.',
                  ),
                )
              else
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 148,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: AppSpace.page),
                      itemCount: galleries.length,
                      separatorBuilder: (_, __) => const SizedBox(width: AppSpace.xs),
                      itemBuilder: (_, i) {
                        final g = galleries[i] as Map;
                        final id = g['id']?.toString() ?? '';
                        final name = g['name']?.toString() ?? 'Gallery';
                        final cover = g['coverPhotoUrl'] as String?;
                        final count = g['photoCount'] ?? g['photosCount'] ?? g['_count']?['photos'];
                        return GestureDetector(
                          onTap: () {
                            Haptics.selection();
                            context.push('/gallery/$id');
                          },
                          child: Hero(
                            tag: 'gallery-cover-$id',
                            child: Container(
                              width: 164,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: AppColors.border(context)),
                                color: AppColors.card(context),
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Expanded(
                                    child: cover != null
                                        ? CachedNetworkImage(
                                            imageUrl: cover,
                                            fit: BoxFit.cover,
                                            memCacheWidth: 480,
                                            fadeInDuration: const Duration(milliseconds: 120),
                                          )
                                        : Container(color: AppColors.sunken(context)),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontWeight: FontWeight.w700,
                                            fontSize: 13,
                                            color: AppColors.text(context),
                                          ),
                                        ),
                                        if (count != null)
                                          Text(
                                            '$count photos',
                                            style: TextStyle(fontSize: 11, color: AppColors.text3(context)),
                                          ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
            ] else if (!access.loading) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: AppSpace.pageH(top: AppSpace.md, bottom: AppSpace.xs),
                  child: PremiumCard(
                    padding: const EdgeInsets.all(AppSpace.md),
                    child: Column(
                      children: [
                        Icon(Icons.camera_alt_outlined, size: 28, color: AppColors.accent(context)),
                        const SizedBox(height: AppSpace.xs),
                        Text(
                          'Your photos are being prepared ✨',
                          textAlign: TextAlign.center,
                          style: AppTheme.display(18, context: context),
                        ),
                        const SizedBox(height: AppSpace.xxs),
                        Text(
                          'Private galleries appear here when the studio shares them.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],

            // Explore divider
            SliverToBoxAdapter(
              child: Padding(
                padding: AppSpace.pageH(top: AppSpace.md, bottom: 0),
                child: Row(
                  children: [
                    Expanded(child: Divider(height: 1, color: AppColors.border(context))),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpace.sm),
                      child: Text('EXPLORE', style: AppTheme.kicker(context: context)),
                    ),
                    Expanded(child: Divider(height: 1, color: AppColors.border(context))),
                  ],
                ),
              ),
            ),

            // Our work preview
            if (portfolio.isNotEmpty) ...[
              SectionHeader(
                title: 'Our work',
                actionLabel: 'See all',
                onAction: () => context.push('/portfolio'),
                asSliver: true,
              ),
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 108,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AppSpace.page),
                    itemCount: portfolio.take(8).length,
                    separatorBuilder: (_, __) => const SizedBox(width: AppSpace.xs),
                    itemBuilder: (_, i) {
                      final item = portfolio[i] as Map;
                      final isReel = item['isReel'] == true ||
                          (item['mediaType']?.toString().toUpperCase() == 'REEL') ||
                          (item['externalUrl']?.toString().contains('instagram.com') == true);
                      return GestureDetector(
                        onTap: () => context.push('/portfolio'),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: SizedBox(
                            width: 90,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                if (item['coverUrl'] != null)
                                  CachedNetworkImage(
                                    imageUrl: item['coverUrl'] as String,
                                    fit: BoxFit.cover,
                                    memCacheWidth: 320,
                                  )
                                else if (isReel)
                                  const DecoratedBox(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        begin: Alignment.topLeft,
                                        end: Alignment.bottomRight,
                                        colors: [Color(0xFF833AB4), Color(0xFFFD1D1D), Color(0xFFF77737)],
                                      ),
                                    ),
                                  )
                                else
                                  Container(color: AppColors.sunken(context)),
                                if (isReel)
                                  const Center(
                                    child: Icon(Icons.play_arrow_rounded, color: Colors.white, size: 28),
                                  ),
                                Positioned(
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  child: Container(
                                    padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        begin: Alignment.topCenter,
                                        end: Alignment.bottomCenter,
                                        colors: [
                                          Colors.transparent,
                                          Colors.black.withValues(alpha: 0.7),
                                        ],
                                      ),
                                    ),
                                    child: Text(
                                      item['title']?.toString() ?? '',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ],

            // Featured package
            if (featured != null) ...[
              const SectionHeader(title: 'Featured package', asSliver: true),
              SliverToBoxAdapter(
                child: Padding(
                  padding: AppSpace.pageH(bottom: AppSpace.xs),
                  child: PremiumCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (featured['coverUrl'] != null)
                          ClipRRect(
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
                            child: AspectRatio(
                              aspectRatio: 16 / 9,
                              child: CachedNetworkImage(
                                imageUrl: featured['coverUrl'] as String,
                                fit: BoxFit.cover,
                                memCacheWidth: 800,
                              ),
                            ),
                          ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                featured['title']?.toString() ?? featured['name']?.toString() ?? 'Package',
                                style: AppTheme.display(18, context: context),
                              ),
                              if (featured['price'] != null || featured['discountPrice'] != null) ...[
                                const SizedBox(height: 4),
                                Text(
                                  '₹${featured['discountPrice'] ?? featured['price']} onwards',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.accent(context),
                                    fontSize: 14,
                                  ),
                                ),
                              ],
                              const SizedBox(height: AppSpace.sm),
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                  onPressed: () async {
                                    Haptics.medium();
                                    final title = '${featured['title'] ?? ''} ${featured['name'] ?? ''}';
                                    if (RegExp(r'wedding|marriage|bridal', caseSensitive: false).hasMatch(title)) {
                                      if (context.mounted) context.push('/wedding-inquiry');
                                      return;
                                    }
                                    final sent = await BookingSheet.open(
                                      context,
                                      package: Map<String, dynamic>.from(featured),
                                      source: 'BOOK',
                                    );
                                    if (sent == true && context.mounted) {
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(
                                          content: const Text('Request sent — studio will confirm your slot'),
                                          action: SnackBarAction(
                                            label: 'View status',
                                            onPressed: () => context.push('/booking'),
                                          ),
                                        ),
                                      );
                                    }
                                  },
                                  child: const Text('Book now'),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],

            // Contact
            const SectionHeader(title: 'Studio', asSliver: true),
            SliverToBoxAdapter(
              child: Padding(
                padding: AppSpace.pageH(bottom: AppSpace.bottomNav),
                child: StudioIdentityTile(
                  profile: profile,
                  fallbackName: customer?.studio?.name ?? 'SJ Clicks',
                  subtitle: () {
                    final bits = <String>[
                      if ((profile?['phone'] as String?)?.isNotEmpty == true) profile!['phone'].toString(),
                      if ((profile?['address'] as String?)?.isNotEmpty == true) profile!['address'].toString(),
                    ];
                    return bits.isEmpty ? 'Tap for call · WhatsApp · map' : bits.join(' · ');
                  }(),
                  onTap: () => context.push('/contact'),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class SliiverHero extends StatelessWidget {
  final Map? profile;
  final String fallback;
  const SliiverHero({super.key, required this.profile, required this.fallback});

  @override
  Widget build(BuildContext context) {
    final cover = profile?['coverUrl'] as String? ?? profile?['coverPhotoUrl'] as String?;
    final name = profile?['displayName'] as String? ?? fallback;
    final tagline = profile?['tagline'] as String?;
    return SliverToBoxAdapter(
      child: Padding(
        padding: AppSpace.pageH(top: AppSpace.xxs),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppSpace.radiusLg),
          child: SizedBox(
            height: 128,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (cover != null)
                  CachedNetworkImage(
                    imageUrl: cover,
                    fit: BoxFit.cover,
                    memCacheWidth: 900,
                  )
                else
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppColors.sunken(context),
                          AppColors.card(context),
                        ],
                      ),
                    ),
                  ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withValues(alpha: 0.15),
                        Colors.black.withValues(alpha: 0.55),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text(
                        name,
                        style: AppTheme.display(22, color: Colors.white),
                      ),
                      if (tagline != null && tagline.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          tagline,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.88),
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.accent(context)),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 15,
              color: AppColors.text(context),
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(fontSize: 11, color: AppColors.text3(context), fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _BookingMiniCard extends StatelessWidget {
  final Map booking;
  final VoidCallback onTap;
  const _BookingMiniCard({required this.booking, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final status = (booking['status'] as String? ?? '—').replaceAll('_', ' ');
    final steps = (booking['steps'] as List?) ?? (booking['statuses'] as List?) ?? [];
    final notes = booking['notes']?.toString();
    final pkg = booking['package'] is Map
        ? (booking['package'] as Map)['title']?.toString()
        : null;

    int idx = 0;
    if (booking['stepIndex'] is num) {
      idx = (booking['stepIndex'] as num).toInt().clamp(0, steps.isEmpty ? 0 : steps.length - 1);
    } else if (steps.isNotEmpty) {
      final keys = steps.map((s) {
        if (s is Map) return (s['key'] ?? s['status'] ?? s).toString();
        return s.toString();
      }).toList();
      final cur = (booking['status'] as String? ?? '').toUpperCase();
      final curNorm = cur.replaceAll(RegExp(r'[^A-Z0-9]+'), '_');
      idx = keys.indexWhere((k) {
        final u = k.toUpperCase();
        return u == cur || u == curNorm;
      });
      if (idx < 0) idx = steps.length - 1;
    }

    return PremiumCard(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.timeline_rounded, size: 16, color: AppColors.accent(context)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  pkg ?? 'Your booking',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.text(context)),
                ),
              ),
              Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.text3(context)),
            ],
          ),
          if (steps.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              children: List.generate(steps.length.clamp(0, 6), (i) {
                final done = i < idx;
                final current = i == idx;
                return Expanded(
                  child: Row(
                    children: [
                      Container(
                        width: current ? 10 : 8,
                        height: current ? 10 : 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: done || current
                              ? (current ? AppColors.accent(context) : AppColors.green)
                              : AppColors.border(context),
                        ),
                      ),
                      if (i < steps.length.clamp(0, 6) - 1)
                        Expanded(
                          child: Container(
                            height: 2.5,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(99),
                              gradient: i < idx
                                  ? LinearGradient(
                                      colors: [
                                        Theme.of(context).brightness == Brightness.dark
                                            ? const Color(0xFF4A9B78)
                                            : AppColors.green,
                                        AppColors.accent(context),
                                      ],
                                    )
                                  : null,
                              color: i < idx ? null : AppColors.border(context),
                            ),
                          ),
                        ),
                    ],
                  ),
                );
              }),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            status,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 12.5,
              color: AppColors.text(context),
            ),
          ),
          if (booking['slotStatus'] == 'RESCHEDULE_REQUESTED') ...[
            const SizedBox(height: 2),
            const Text(
              'Reschedule waiting on studio',
              style: TextStyle(fontSize: 12, color: AppColors.amber, fontWeight: FontWeight.w600),
            ),
          ] else if (booking['confirmedSlot'] is Map &&
              (booking['confirmedSlot'] as Map)['label'] != null) ...[
            const SizedBox(height: 2),
            Text(
              (booking['confirmedSlot'] as Map)['label'].toString(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: AppColors.text2(context)),
            ),
          ],
          if (notes != null && notes.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              notes,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: AppColors.text2(context), height: 1.3),
            ),
          ],
        ],
      ),
    );
  }
}

class SliiverError extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const SliiverError({super.key, required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return SliverFillRemaining(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Could not load home', style: AppTheme.display(18, context: context)),
              const SizedBox(height: AppSpace.xs),
              Text(error, textAlign: TextAlign.center, style: TextStyle(color: AppColors.text2(context))),
              const SizedBox(height: AppSpace.sm),
              FilledButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ),
        ),
      ),
    );
  }
}
