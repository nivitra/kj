import '../widgets/app_back_button.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';
import '../widgets/share_link_button.dart';

bool _isReelMap(Map it) {
  if (it['isReel'] == true) return true;
  final t = (it['mediaType']?.toString() ?? '').toUpperCase();
  if (t == 'REEL' || t == 'INSTAGRAM' || t == 'IG') return true;
  final url = it['externalUrl']?.toString() ?? '';
  return url.contains('instagram.com/reel') ||
      url.contains('instagram.com/reels') ||
      url.contains('instagram.com/p/') ||
      url.contains('instagram.com/tv/');
}

/// Instagram gradient used for reel cards without a cover.
const _kReelGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF833AB4), Color(0xFFFD1D1D), Color(0xFFF77737)],
);

class PortfolioScreen extends StatefulWidget {
  final bool embedded;
  final String? highlightId;
  const PortfolioScreen({super.key, this.embedded = false, this.highlightId});
  @override
  State<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends State<PortfolioScreen> {
  List<dynamic> _items = [];
  List<String> _categories = ['All'];
  String _cat = 'All';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool force = false}) async {
    try {
      final items = await PortalApi.portfolio(force: force);
      final cats = <String>{'All'};
      for (final i in items) {
        final c = (i as Map)['category']?.toString();
        if (c != null && c.isNotEmpty) cats.add(c);
      }
      if (mounted) {
        setState(() {
          _items = items;
          _categories = cats.toList();
          _loading = false;
        });
      }
      if (!force) {
        PortalApi.portfolio(force: true).then((fresh) {
          if (!mounted) return;
          final cats2 = <String>{'All'};
          for (final i in fresh) {
            final c = (i as Map)['category']?.toString();
            if (c != null && c.isNotEmpty) cats2.add(c);
          }
          setState(() {
            _items = fresh;
            _categories = cats2.toList();
          });
        }).catchError((_) {});
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<String> _mediaUrls(Map it) {
    final media = it['media'];
    if (media is List && media.isNotEmpty) {
      return media
          .map((m) => (m is Map ? m['url'] : null)?.toString())
          .whereType<String>()
          .where((u) => u.isNotEmpty)
          .toList();
    }
    final cover = it['coverUrl']?.toString() ?? it['mediaUrl']?.toString();
    if (cover != null && cover.isNotEmpty) return [cover];
    return const [];
  }

  void _openWork(Map<String, dynamic> it) {
    Haptics.selection();
    final id = it['id']?.toString() ?? '';
    final urls = _mediaUrls(it);
    final mediaCount = (it['mediaCount'] as num?)?.toInt() ?? urls.length;
    final isReel = _isReelMap(it);
    Navigator.of(context).push(
      PageRouteBuilder(
        transitionDuration: AppMotion.med,
        reverseTransitionDuration: AppMotion.fast,
        pageBuilder: (_, a, __) => FadeTransition(
          opacity: a,
          child: isReel
              ? _ReelDetailPage(
                  itemId: id,
                  heroTag: 'work-$id',
                  title: it['title']?.toString() ?? 'Reel',
                  description: it['description']?.toString(),
                  category: it['category']?.toString(),
                  coverUrl: it['coverUrl']?.toString() ?? (urls.isNotEmpty ? urls.first : null),
                  externalUrl: it['externalUrl']?.toString() ?? '',
                )
              : _WorkDetailPage(
                  itemId: id,
                  heroTag: 'work-$id',
                  initialUrls: urls,
                  expectedCount: mediaCount,
                  title: it['title']?.toString() ?? 'Work',
                  description: it['description']?.toString(),
                  category: it['category']?.toString(),
                  mediaType: it['mediaType']?.toString(),
                  coverUrl: it['coverUrl']?.toString() ?? (urls.isNotEmpty ? urls.first : null),
                ),
        ),
      ),
    );
  }

  List<String> get _filterChips {
    final hasReels = _items.any((i) => _isReelMap(Map<String, dynamic>.from(i as Map)));
    final chips = List<String>.from(_categories);
    if (hasReels && !chips.contains('Reels')) {
      if (chips.isEmpty) return ['All', 'Reels'];
      chips.insert(1, 'Reels');
    }
    return chips;
  }

  @override
  Widget build(BuildContext context) {
    final filtered = widget.highlightId != null ? _items.where((i) => i['id'] == widget.highlightId).toList() : _cat == 'All'
        ? _items
        : _cat == 'Reels'
            ? _items.where((i) => _isReelMap(Map<String, dynamic>.from(i as Map))).toList()
            : _items.where((i) => (i as Map)['category']?.toString() == _cat).toList();
    final chips = _filterChips;
    final dark = Theme.of(context).brightness == Brightness.dark;

    // Shop-style catalogue: full-width hero cards + pill filters
    // (inspired by afgprogrammer/Flutter-Shoes-Shop-App layout).
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(leading: const AppBackButton(),
        actions: [ShareLinkButton(path: widget.highlightId == null ? '/portfolio' : '/portfolio?id=${widget.highlightId}')],
        elevation: 0,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        automaticallyImplyLeading: !widget.embedded,
        title: Text(
          'Our work',
          style: TextStyle(
            color: AppColors.text(context),
            fontSize: 24,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.4,
          ),
        ),
      ),
      body: _loading
          ? ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: List.generate(
                3,
                (_) => const Padding(
                  padding: EdgeInsets.only(bottom: 20),
                  child: ShimmerBox(height: 250, radius: 20),
                ),
              ),
            )
          : filtered.isEmpty
              ? EmptyState(
                  icon: Icons.auto_awesome_outlined,
                  title: widget.highlightId == null ? 'Portfolio coming soon' : 'This work is no longer available',
                  subtitle: 'The studio will showcase selected work here.',
                )
              : RefreshIndicator(
                  color: AppColors.text(context),
                  onRefresh: () => _load(force: true),
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, AppSpace.bottomNav),
                    children: [
                      // Category pills — shoes shop style
                      SizedBox(
                        height: 40,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: chips.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 10),
                          itemBuilder: (_, i) {
                            final c = chips[i];
                            final on = c == _cat;
                            return TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: 1),
                              duration: Duration(milliseconds: 280 + i * 40),
                              curve: Curves.easeOut,
                              builder: (_, v, child) => Opacity(
                                opacity: v,
                                child: Transform.translate(offset: Offset(8 * (1 - v), 0), child: child),
                              ),
                              child: GestureDetector(
                                onTap: () {
                                  Haptics.selection();
                                  setState(() => _cat = c);
                                },
                                child: AnimatedContainer(
                                  duration: AppMotion.fast,
                                  padding: const EdgeInsets.symmetric(horizontal: 18),
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: on
                                        ? (dark ? AppColors.sunken(context) : const Color(0xFFEEEEEE))
                                        : Colors.transparent,
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Text(
                                    c,
                                    style: TextStyle(
                                      fontSize: on ? 16 : 15,
                                      fontWeight: on ? FontWeight.w600 : FontWeight.w500,
                                      color: on ? AppColors.text(context) : AppColors.text2(context),
                                    ),
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: 20),
                      ...List.generate(filtered.length, (i) {
                        final it = Map<String, dynamic>.from(filtered[i] as Map);
                        return _ShopWorkCard(
                          item: it,
                          index: i,
                          onTap: () => _openWork(it),
                          mediaUrls: _mediaUrls(it),
                        );
                      }),
                    ],
                  ),
                ),
    );
  }
}

/// Full-width product-style portfolio card (shoes-shop catalogue pattern).
class _ShopWorkCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final int index;
  final VoidCallback onTap;
  final List<String> mediaUrls;

  const _ShopWorkCard({
    required this.item,
    required this.index,
    required this.onTap,
    required this.mediaUrls,
  });

  @override
  Widget build(BuildContext context) {
    final id = item['id']?.toString() ?? '$index';
    final title = item['title']?.toString() ?? 'Work';
    final category = item['category']?.toString() ?? '';
    final more = (item['mediaCount'] as num?)?.toInt() ?? mediaUrls.length;
    final cover = item['coverUrl']?.toString() ??
        (mediaUrls.isNotEmpty ? mediaUrls.first : null);
    final reel = _isReelMap(item);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tag = 'work-$id';

    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 420 + (index % 5) * 70),
      curve: Curves.easeOutCubic,
      builder: (_, v, child) => Opacity(
        opacity: v,
        child: Transform.translate(offset: Offset(0, 18 * (1 - v)), child: child),
      ),
      child: Hero(
        tag: tag,
        child: Material(
          color: Colors.transparent,
          child: GestureDetector(
            onTap: onTap,
            child: Container(
              height: 250,
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 20),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: dark
                        ? Colors.black.withValues(alpha: 0.45)
                        : Colors.black.withValues(alpha: 0.12),
                    blurRadius: 16,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (cover != null && cover.isNotEmpty)
                    CachedNetworkImage(
                      imageUrl: cover,
                      fit: BoxFit.cover,
                      memCacheWidth: 900,
                      fadeInDuration: const Duration(milliseconds: 120),
                      placeholder: (_, __) => Container(color: AppColors.sunken(context)),
                      errorWidget: (_, __, ___) => Container(color: AppColors.sunken(context)),
                    )
                  else if (reel)
                    const DecoratedBox(decoration: BoxDecoration(gradient: _kReelGradient))
                  else
                    Container(color: AppColors.sunken(context)),

                  // Soft scrim for white type
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.18),
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.55),
                        ],
                        stops: const [0, 0.45, 1],
                      ),
                    ),
                  ),

                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    title,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 26,
                                      fontWeight: FontWeight.w700,
                                      height: 1.15,
                                      letterSpacing: -0.4,
                                    ),
                                  ),
                                  if (category.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      category,
                                      style: TextStyle(
                                        color: Colors.white.withValues(alpha: 0.9),
                                        fontSize: 15,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ] else if (reel) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      'Instagram Reel',
                                      style: TextStyle(
                                        color: Colors.white.withValues(alpha: 0.9),
                                        fontSize: 15,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            if (reel)
                              Container(
                                width: 36,
                                height: 36,
                                decoration: const BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white,
                                ),
                                child: const Icon(Icons.play_arrow_rounded, size: 22, color: Colors.black87),
                              )
                            else if (more > 1)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  '$more',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13,
                                    color: Colors.black87,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        ShareLinkButton(path: '/portfolio?id=$id', title: 'Share work'),
                        // Bottom meta — like price row in the shop demo
                        Text(
                          reel
                              ? 'Watch reel'
                              : more > 1
                                  ? '$more photos'
                                  : (item['mediaType']?.toString().toUpperCase() == 'VIDEO'
                                      ? 'Video'
                                      : 'View story'),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.3,
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
      ),
    );
  }
}

class _WorkDetailPage extends StatefulWidget {
  final String? itemId;
  final String heroTag;
  final List<String> initialUrls;
  final int expectedCount;
  final String title;
  final String? description;
  final String? category;
  final String? mediaType;
  final String? coverUrl;

  const _WorkDetailPage({
    required this.itemId,
    required this.heroTag,
    required this.initialUrls,
    required this.expectedCount,
    required this.title,
    this.description,
    this.category,
    this.mediaType,
    this.coverUrl,
  });

  @override
  State<_WorkDetailPage> createState() => _WorkDetailPageState();
}

class _WorkDetailPageState extends State<_WorkDetailPage> {
  late List<String> _urls = List<String>.from(widget.initialUrls);
  late final PageController _page = PageController();
  late final PageController _heroPage = PageController();
  int _index = 0;
  bool _loadingMore = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    if (_urls.isEmpty && widget.coverUrl != null) _urls = [widget.coverUrl!];
    // Always fetch full multi-media on open — list payload is cover-only.
    _loadFullMedia();
  }

  @override
  void dispose() {
    _page.dispose();
    _heroPage.dispose();
    super.dispose();
  }

  Future<void> _loadFullMedia() async {
    final id = widget.itemId;
    if (id == null || id.isEmpty) return;
    setState(() {
      _loadingMore = true;
      _loadError = null;
    });
    try {
      final full = await PortalApi.portfolioItem(id);
      final media = full['media'];
      final next = <String>[];
      if (media is List) {
        for (final m in media) {
          if (m is! Map) continue;
          final u = m['url']?.toString();
          if (u != null && u.isNotEmpty) next.add(u);
        }
      }
      if (next.isEmpty) {
        final c = full['coverUrl']?.toString() ?? full['mediaUrl']?.toString();
        if (c != null && c.isNotEmpty) next.add(c);
      }
      if (!mounted) return;
      setState(() {
        if (next.isNotEmpty) {
          _urls = next;
          if (_index >= _urls.length) _index = 0;
        }
        _loadingMore = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadingMore = false;
          _loadError = 'Could not load all photos';
        });
      }
    }
  }

  Future<void> _enquire() async {
    Haptics.medium();
    try {
      await PortalApi.createLead(
        packageId: null,
        source: 'PORTFOLIO',
        message: 'Interested in similar shoot: ${widget.title}',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enquiry sent to the studio')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e'), backgroundColor: AppColors.rose),
        );
      }
    }
  }

  void _goTo(int i) {
    if (i < 0 || i >= _urls.length) return;
    setState(() => _index = i);
    if (_page.hasClients) {
      _page.animateToPage(i, duration: AppMotion.fast, curve: Curves.easeOut);
    }
    if (_heroPage.hasClients) {
      _heroPage.animateToPage(i, duration: AppMotion.fast, curve: Curves.easeOut);
    }
  }

  @override
  Widget build(BuildContext context) {
    final multi = _urls.length > 1;
    final cover = _urls.isNotEmpty ? _urls[_index.clamp(0, _urls.length - 1)] : widget.coverUrl;
    final h = MediaQuery.sizeOf(context).height;

    // Full-bleed product detail (shoes-shop pattern) + bottom gradient CTA.
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: multi
                ? PageView.builder(
                    controller: _heroPage,
                    itemCount: _urls.length,
                    onPageChanged: (i) {
                      setState(() => _index = i);
                      if (_page.hasClients) _page.jumpToPage(i);
                    },
                    itemBuilder: (_, i) {
                      final img = CachedNetworkImage(
                        imageUrl: _urls[i],
                        fit: BoxFit.cover,
                        memCacheWidth: 1400,
                      );
                      if (i == 0) return Hero(tag: widget.heroTag, child: img);
                      return img;
                    },
                  )
                : Hero(
                    tag: widget.heroTag,
                    child: cover != null
                        ? CachedNetworkImage(
                            imageUrl: cover,
                            fit: BoxFit.cover,
                            memCacheWidth: 1400,
                          )
                        : Container(color: AppColors.sunken(context)),
                  ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 22),
                  ),
                  if (multi)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '${_index + 1} / ${_urls.length}',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                      ),
                    )
                  else
                    const SizedBox(width: 36),
                ],
              ),
            ),
          ),
          if (_loadingMore)
            const Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: LinearProgressIndicator(minHeight: 2, color: Colors.white70),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: h * 0.48,
            child: Container(
              padding: const EdgeInsets.fromLTRB(22, 28, 22, 28),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.92),
                    Colors.black.withValues(alpha: 0.55),
                    Colors.transparent,
                  ],
                  stops: const [0, 0.55, 1],
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    widget.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 36,
                      fontWeight: FontWeight.w700,
                      height: 1.1,
                      letterSpacing: -0.8,
                    ),
                  ),
                  if (widget.category != null && widget.category!.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(
                      widget.category!,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                  if (widget.description != null && widget.description!.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      widget.description!,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontSize: 14,
                        height: 1.4,
                      ),
                    ),
                  ],
                  if (_loadError != null) ...[
                    const SizedBox(height: 8),
                    Text(_loadError!, style: const TextStyle(color: Color(0xFFFF8A80), fontSize: 12)),
                  ],
                  if (multi) ...[
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 52,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _urls.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final on = i == _index;
                          return GestureDetector(
                            onTap: () => _goTo(i),
                            child: AnimatedContainer(
                              duration: AppMotion.fast,
                              width: 48,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: on ? Colors.white : Colors.white24,
                                  width: on ? 2 : 1,
                                ),
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: CachedNetworkImage(
                                imageUrl: _urls[i],
                                fit: BoxFit.cover,
                                memCacheWidth: 160,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: FilledButton(
                      onPressed: _enquire,
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.black,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                      child: const Text('Enquire for similar shoot'),
                    ),
                  ),
                  SizedBox(height: MediaQuery.paddingOf(context).bottom > 0 ? 4 : 12),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}


/// Instagram Reel detail — polished card + open-in-Instagram CTA.
class _ReelDetailPage extends StatefulWidget {
  final String? itemId;
  final String heroTag;
  final String title;
  final String? description;
  final String? category;
  final String? coverUrl;
  final String externalUrl;

  const _ReelDetailPage({
    required this.itemId,
    required this.heroTag,
    required this.title,
    this.description,
    this.category,
    this.coverUrl,
    required this.externalUrl,
  });

  @override
  State<_ReelDetailPage> createState() => _ReelDetailPageState();
}

class _ReelDetailPageState extends State<_ReelDetailPage> {
  bool _opening = false;

  Future<void> _openInstagram() async {
    final raw = widget.externalUrl.trim();
    if (raw.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No Instagram link for this reel')),
      );
      return;
    }
    Haptics.medium();
    setState(() => _opening = true);
    try {
      final uri = Uri.parse(raw);
      final ok = await canLaunchUrl(uri);
      if (ok) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open Instagram')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open link: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _copyLink() async {
    final raw = widget.externalUrl.trim();
    if (raw.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: raw));
    Haptics.selection();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Reel link copied')),
    );
  }

  Future<void> _enquire() async {
    Haptics.medium();
    try {
      await PortalApi.createLead(
        packageId: null,
        source: 'PORTFOLIO_REEL',
        message: 'Interested after watching reel: ${widget.title}\n${widget.externalUrl}',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enquiry sent to the studio')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e'), backgroundColor: AppColors.rose),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cover = widget.coverUrl;
    final hasCover = cover != null && cover.isNotEmpty;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          SliiverAppBarLike(
            onBack: () => Navigator.pop(context),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Hero(
                  tag: widget.heroTag,
                  child: hasCover
                      ? CachedNetworkImage(
                          imageUrl: cover,
                          fit: BoxFit.cover,
                          memCacheWidth: 1200,
                        )
                      : const DecoratedBox(decoration: BoxDecoration(gradient: _kReelGradient)),
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
                Center(
                  child: GestureDetector(
                    onTap: _openInstagram,
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.2),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.9), width: 2),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.3),
                            blurRadius: 18,
                          ),
                        ],
                      ),
                      child: _opening
                          ? const Padding(
                              padding: EdgeInsets.all(20),
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 44),
                    ),
                  ),
                ),
                Positioned(
                  left: 16,
                  bottom: 18,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      gradient: _kReelGradient,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.movie_filter_outlined, size: 14, color: Colors.white),
                        SizedBox(width: 6),
                        Text(
                          'Instagram Reel',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.md, AppSpace.page, AppSpace.bottomNav),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title, style: AppTheme.display(24, context: context)),
                  if (widget.category != null && widget.category!.isNotEmpty) ...[
                    const SizedBox(height: AppSpace.xxs),
                    Text(
                      widget.category!,
                      style: TextStyle(
                        color: AppColors.accent(context),
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                  if (widget.description != null && widget.description!.isNotEmpty) ...[
                    const SizedBox(height: AppSpace.sm),
                    Text(
                      widget.description!,
                      style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 14),
                    ),
                  ],
                  const SizedBox(height: AppSpace.md),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppSpace.md),
                    decoration: BoxDecoration(
                      color: AppColors.card(context),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.border(context)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Watch on Instagram',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                            color: AppColors.text(context),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Reels play best in the Instagram app. Tap below to open this reel.',
                          style: TextStyle(
                            color: AppColors.text2(context),
                            fontSize: 13,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: AppSpace.sm),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: _opening ? null : _openInstagram,
                            icon: const Icon(Icons.open_in_new_rounded, size: 18),
                            label: Text(_opening ? 'Opening…' : 'Open Reel'),
                            style: FilledButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              backgroundColor: const Color(0xFFE1306C),
                              foregroundColor: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: AppSpace.xs),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: widget.externalUrl.isEmpty ? null : _copyLink,
                            icon: const Icon(Icons.link_rounded, size: 18),
                            label: const Text('Copy link'),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _enquire,
                      child: const Text('Enquire for similar shoot'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact pinned app bar with a tall hero media area (reel detail).
class SliiverAppBarLike extends StatelessWidget {
  final Widget child;
  final VoidCallback onBack;
  const SliiverAppBarLike({super.key, required this.child, required this.onBack});

  @override
  Widget build(BuildContext context) {
    return SliverAppBar(
      expandedHeight: 420,
      pinned: true,
      backgroundColor: AppColors.bg(context),
      leading: IconButton(
        icon: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.35),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 20),
        ),
        onPressed: onBack,
      ),
      flexibleSpace: FlexibleSpaceBar(background: child),
    );
  }
}
