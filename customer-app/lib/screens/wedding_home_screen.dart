import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../services/portal_api.dart';
import '../theme/wedding_theme.dart';
import '../widgets/wedding_ui.dart';
import '../widgets/quotation_home_card.dart';

/// Exclusive home when weddingExperience is enabled.
/// Simple, plain-language: days · deliverables · when you get them · progress.
class WeddingHomeScreen extends ConsumerStatefulWidget {
  const WeddingHomeScreen({super.key});

  @override
  ConsumerState<WeddingHomeScreen> createState() => _WeddingHomeScreenState();
}

class _WeddingHomeScreenState extends ConsumerState<WeddingHomeScreen> {
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _plan;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        PortalApi.home(force: true),
        PortalApi.weddingPlan(force: true).catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0];
        _plan = results[1].isEmpty ? null : results[1];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _prettyStatus(String? raw) {
    if (raw == null || raw.trim().isEmpty) return '';
    return raw
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  String _fmtDate(dynamic raw) {
    if (raw == null || raw.toString().isEmpty) return '';
    final d = DateTime.tryParse(raw.toString());
    if (d == null) return raw.toString();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }

  String _timeRange(String? start, String? end) {
    final s = (start ?? '').trim();
    final e = (end ?? '').trim();
    if (s.isEmpty && e.isEmpty) return '';
    if (s.isNotEmpty && e.isNotEmpty) return '$s – $e';
    return s.isNotEmpty ? s : e;
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider).valueOrNull;
    final c = _data?['customer'] is Map
        ? Map<String, dynamic>.from(_data!['customer'] as Map)
        : <String, dynamic>{};
    final snap = _plan?['snapshot'] is Map
        ? Map<String, dynamic>.from(_plan!['snapshot'] as Map)
        : <String, dynamic>{};

    final bride = snap['brideName']?.toString().isNotEmpty == true
        ? snap['brideName'].toString()
        : (c['brideName']?.toString() ?? auth?.brideName ?? '');
    final groom = snap['groomName']?.toString().isNotEmpty == true
        ? snap['groomName'].toString()
        : (c['groomName']?.toString() ?? auth?.groomName ?? '');
    final couple = weddingCoupleTitle(
      bride: bride,
      groom: groom,
      fallback: auth?.name ?? 'Your Wedding',
    );

    final dateRaw = snap['weddingDate']?.toString() ??
        c['weddingDate']?.toString() ??
        auth?.weddingDate?.toIso8601String();
    DateTime? wDate;
    if (dateRaw != null && dateRaw.isNotEmpty) wDate = DateTime.tryParse(dateRaw);
    final venue = snap['weddingVenue']?.toString() ??
        c['weddingVenue']?.toString() ??
        auth?.weddingVenue;
    final heroUrl = c['couplePhotoUrl']?.toString() ??
        c['weddingCoverUrl']?.toString() ??
        auth?.couplePhotoUrl ??
        auth?.weddingCoverUrl;
    final bookingPhoto = c['bookingPhotoUrl']?.toString() ?? auth?.bookingPhotoUrl;
    final galleries = (_data?['galleries'] as List?) ?? const [];
    final bookingRaw = _data?['booking'];
    final booking = bookingRaw is Map && bookingRaw.isNotEmpty
        ? Map<String, dynamic>.from(bookingRaw)
        : null;
    final planUnlocked = _plan?['planUnlocked'] == true;
    final inquiryStatus = _plan?['inquiryStatus']?.toString();
    final emptyHint = _plan?['emptyHint']?.toString();
    final days = planUnlocked ? ((_plan?['days'] as List?) ?? const []) : const [];
    final deliverables = planUnlocked ? ((_plan?['deliverables'] as List?) ?? const []) : const [];
    final timeline = planUnlocked ? ((_plan?['timeline'] as List?) ?? const []) : const [];
    final progress = planUnlocked && _plan?['progress'] is Map
        ? Map<String, dynamic>.from(_plan!['progress'] as Map)
        : null;
    final packageName = planUnlocked
        ? (_plan?['packageName']?.toString() ??
            (booking?['package'] is Map
                ? (booking!['package'] as Map)['title']?.toString()
                : null))
        : null;
    final albumStatus = snap['albumStatus']?.toString() ?? c['albumStatus']?.toString();
    final deliveryStatus =
        snap['deliveryStatus']?.toString() ?? c['deliveryStatus']?.toString();
    final photographer = snap['photographerName']?.toString() ?? c['photographerName']?.toString();
    final cinematographer =
        snap['cinematographerName']?.toString() ?? c['cinematographerName']?.toString();

    if (_loading) {
      return Scaffold(
        backgroundColor: WeddingPalette.ivory,
        body: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: WeddingPalette.dustyRose.withValues(alpha: 0.8),
            ),
          ),
        ),
      );
    }

    final heroH = (MediaQuery.sizeOf(context).height * 0.26).clamp(180.0, 240.0);

    return Scaffold(
      backgroundColor: WeddingPalette.ivory,
      body: RefreshIndicator(
        color: WeddingPalette.dustyRose,
        backgroundColor: WeddingPalette.ivory,
        onRefresh: _load,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: SizedBox(height: MediaQuery.paddingOf(context).top + 4),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(WeddingSpace.page - 8, 0, WeddingSpace.page, 4),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    tooltip: 'Menu',
                    onPressed: () => Scaffold.of(context).openDrawer(),
                    icon: const Icon(Icons.menu_rounded, color: WeddingPalette.ink),
                  ),
                ),
              ),
            ),

            // Hero
            SliverToBoxAdapter(
              child: WeddingHero(
                imageUrl: heroUrl,
                title: couple,
                subtitle: venue != null && venue.isNotEmpty ? venue : null,
                height: heroH,
                brideName: bride,
                groomName: groom,
              ),
            ),

            if (wDate != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    WeddingSpace.page, 16, WeddingSpace.page, 4,
                  ),
                  child: WeddingCountdown(date: wDate),
                ),
              ),

            const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(24), child: QuotationHomeCard())),

            // Status pills — album / delivery / package (after quote is in)
            if (planUnlocked &&
                ((albumStatus != null && albumStatus.isNotEmpty) ||
                    (deliveryStatus != null && deliveryStatus.isNotEmpty) ||
                    (packageName != null && packageName.isNotEmpty)))
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    WeddingSpace.page, 0, WeddingSpace.page, WeddingSpace.sm,
                  ),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (packageName != null && packageName.isNotEmpty)
                        _statusPill(packageName, WeddingPalette.champagne),
                      if (albumStatus != null && albumStatus.isNotEmpty)
                        _statusPill('Album · ${_prettyStatus(albumStatus)}', WeddingPalette.dustyRose),
                      if (deliveryStatus != null && deliveryStatus.isNotEmpty)
                        _statusPill(
                          'Delivery · ${_prettyStatus(deliveryStatus)}',
                          WeddingPalette.inkSoft,
                        ),
                    ],
                  ),
                ),
              ),

            if (inquiryStatus == null || inquiryStatus.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    WeddingSpace.page, 12, WeddingSpace.page, WeddingSpace.md,
                  ),
                  child: WeddingCard(
                    onTap: () => context.push('/wedding-inquiry'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Wedding inquiry', style: WeddingTheme.display(20, weight: FontWeight.w500)),
                        const SizedBox(height: 6),
                        Text(
                          'Share dates, venue, and what you want filmed. The studio replies with a quote.',
                          style: WeddingTheme.body(13, color: WeddingPalette.inkSoft),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Start inquiry',
                          style: WeddingTheme.body(14, weight: FontWeight.w600, color: WeddingPalette.dustyRose),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            if (!planUnlocked && emptyHint != null && emptyHint.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    WeddingSpace.page, 8, WeddingSpace.page, WeddingSpace.md,
                  ),
                  child: WeddingCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          inquiryStatus == 'REJECTED'
                              ? 'Inquiry closed'
                              : inquiryStatus == 'IN_REVIEW'
                                  ? 'Under review'
                                  : 'Waiting on your quotation',
                          style: WeddingTheme.display(20, weight: FontWeight.w500),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          emptyHint,
                          style: WeddingTheme.body(14, color: WeddingPalette.inkSoft),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Quick links
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: WeddingQuickTile(
                            label: 'Gallery',
                            meta: galleries.isEmpty
                                ? 'Coming soon'
                                : '${galleries.length} collection${galleries.length == 1 ? '' : 's'}',
                            icon: Icons.photo_library_outlined,
                            onTap: galleries.isEmpty
                                ? null
                                : () => context.go('/app?tab=gallery'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: WeddingQuickTile(
                            label: 'Billing',
                            meta: 'Invoices & payments',
                            icon: Icons.receipt_long_outlined,
                            onTap: () => context.push('/invoices'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: WeddingQuickTile(
                            label: 'Our work',
                            meta: 'Studio portfolio',
                            icon: Icons.photo_outlined,
                            onTap: () => context.go('/app?tab=work'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: WeddingQuickTile(
                            label: 'Packages',
                            meta: 'Explore offerings',
                            icon: Icons.card_giftcard_outlined,
                            onTap: () => context.go('/app?tab=packages'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // ── WHERE YOU ARE (booking progress) ──────────────────────────
            if (progress != null) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'Booking',
                  title: 'Where things stand',
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                  child: WeddingCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          progress['statusLabel']?.toString() ?? 'In progress',
                          style: WeddingTheme.display(22),
                        ),
                        if (progress['packageTitle'] != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            progress['packageTitle'].toString(),
                            style: WeddingTheme.body(13),
                          ),
                        ],
                        const SizedBox(height: 18),
                        ...((progress['steps'] as List?) ?? const []).asMap().entries.map((e) {
                          final step = Map<String, dynamic>.from(e.value as Map);
                          final state = step['state']?.toString() ?? 'upcoming';
                          final isLast = e.key == ((progress['steps'] as List).length - 1);
                          return _JourneyStep(
                            label: step['label']?.toString() ?? '',
                            state: state,
                            isLast: isLast,
                          );
                        }),
                        if (progress['notes'] != null &&
                            progress['notes'].toString().trim().isNotEmpty) ...[
                          const SizedBox(height: 14),
                          Text(
                            progress['notes'].toString(),
                            style: WeddingTheme.body(13, color: WeddingPalette.inkSoft),
                          ),
                        ],
                        const SizedBox(height: 14),
                        GestureDetector(
                          onTap: () => context.push('/booking'),
                          child: Text(
                            'SEE FULL TIMELINE',
                            style: WeddingTheme.utility(
                              size: 10,
                              color: WeddingPalette.dustyRose,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],

            // ── YOUR WEDDING DAYS ─────────────────────────────────────────
            if (days.isNotEmpty) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'Coverage',
                  title: 'Day by day',
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, i) {
                      final day = Map<String, dynamic>.from(days[i] as Map);
                      final services = (day['services'] as List?) ?? const [];
                      final time = _timeRange(
                        day['startTime']?.toString(),
                        day['endTime']?.toString(),
                      );
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: WeddingCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 44,
                                    height: 44,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      color: WeddingPalette.blush,
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(
                                        color: WeddingPalette.champagne.withValues(alpha: 0.5),
                                      ),
                                    ),
                                    child: Text(
                                      '${day['dayNumber'] ?? i + 1}',
                                      style: WeddingTheme.display(
                                        20,
                                        color: WeddingPalette.ink,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          day['label']?.toString() ?? 'Day ${i + 1}',
                                          style: WeddingTheme.display(20),
                                        ),
                                        if (_fmtDate(day['date']).isNotEmpty) ...[
                                          const SizedBox(height: 4),
                                          Text(
                                            _fmtDate(day['date']),
                                            style: WeddingTheme.body(
                                              13,
                                              color: WeddingPalette.ink,
                                              weight: FontWeight.w500,
                                            ),
                                          ),
                                        ],
                                        if ((day['venue']?.toString() ?? '').isNotEmpty) ...[
                                          const SizedBox(height: 2),
                                          Text(
                                            day['venue'].toString(),
                                            style: WeddingTheme.body(13),
                                          ),
                                        ],
                                        if (time.isNotEmpty) ...[
                                          const SizedBox(height: 2),
                                          Text(time, style: WeddingTheme.body(12)),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              if (services.isNotEmpty) ...[
                                const SizedBox(height: 14),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: services.map((raw) {
                                    final s = Map<String, dynamic>.from(raw as Map);
                                    final count = (s['count'] as num?)?.toInt() ?? 1;
                                    final label = s['label']?.toString() ?? '';
                                    final text = count > 1 ? '$label × $count' : label;
                                    return _chip(text);
                                  }).toList(),
                                ),
                              ],
                              if ((day['notes']?.toString() ?? '').trim().isNotEmpty) ...[
                                const SizedBox(height: 12),
                                Text(
                                  day['notes'].toString(),
                                  style: WeddingTheme.body(13),
                                ),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                    childCount: days.length,
                  ),
                ),
              ),
            ],

            // ── WHAT YOU'LL RECEIVE ───────────────────────────────────────
            if (deliverables.isNotEmpty) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'Your package',
                  title: "What you'll receive",
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                  child: WeddingCard(
                    padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                    child: Column(
                      children: [
                        for (var i = 0; i < deliverables.length; i++) ...[
                          _DeliverableRow(
                            index: i + 1,
                            item: Map<String, dynamic>.from(deliverables[i] as Map),
                          ),
                          if (i < deliverables.length - 1)
                            Divider(
                              height: 1,
                              indent: 56,
                              endIndent: 16,
                              color: WeddingPalette.champagne.withValues(alpha: 0.35),
                            ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ],

            // ── WHEN YOU'LL GET THEM ──────────────────────────────────────
            if (timeline.isNotEmpty) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'After the wedding',
                  title: "When you'll get them",
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                  child: WeddingCard(
                    child: Column(
                      children: [
                        for (var i = 0; i < timeline.length; i++)
                          _DeliveryTimelineRow(
                            item: Map<String, dynamic>.from(timeline[i] as Map),
                            isLast: i == timeline.length - 1,
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              if (timeline.any((t) => (t as Map)['isDefault'] == true))
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      WeddingSpace.page + 4, 8, WeddingSpace.page, 0,
                    ),
                    child: Text(
                      'Typical studio timelines — your agreement may refine these dates.',
                      style: WeddingTheme.body(12, color: WeddingPalette.inkFaint),
                    ),
                  ),
                ),
            ],

            // ── YOUR TEAM ─────────────────────────────────────────────────
            if (planUnlocked &&
                ((photographer != null && photographer.isNotEmpty) ||
                    (cinematographer != null && cinematographer.isNotEmpty))) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'With you',
                  title: 'Your team',
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                  child: WeddingCard(
                    child: Column(
                      children: [
                        if (photographer != null && photographer.isNotEmpty)
                          _TeamRow(
                            role: 'Photographer',
                            name: photographer,
                          ),
                        if (photographer != null &&
                            photographer.isNotEmpty &&
                            cinematographer != null &&
                            cinematographer.isNotEmpty)
                          Divider(
                            height: 20,
                            color: WeddingPalette.champagne.withValues(alpha: 0.35),
                          ),
                        if (cinematographer != null && cinematographer.isNotEmpty)
                          _TeamRow(
                            role: 'Cinematographer',
                            name: cinematographer,
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],

            // Empty plan guidance (quote is in, studio still filling details)
            if (planUnlocked &&
                emptyHint != null &&
                days.isEmpty &&
                deliverables.isEmpty &&
                progress == null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    WeddingSpace.page, WeddingSpace.lg, WeddingSpace.page, 0,
                  ),
                  child: WeddingCard(
                    child: Text(
                      emptyHint,
                      style: WeddingTheme.body(14),
                    ),
                  ),
                ),
              ),

            // Booking day memory
            if (planUnlocked && bookingPhoto != null && bookingPhoto.isNotEmpty) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'Memories',
                  title: 'Our journey',
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: WeddingSpace.page),
                  child: WeddingCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ClipRRect(
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(19),
                          ),
                          child: AspectRatio(
                            aspectRatio: 4 / 3,
                            child: Image.network(bookingPhoto, fit: BoxFit.cover),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(WeddingSpace.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Booking day', style: WeddingTheme.utility(size: 11)),
                              const SizedBox(height: 6),
                              Text(
                                'From the day you booked with us',
                                style: WeddingTheme.display(18, weight: FontWeight.w500),
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

            // Galleries
            if (galleries.isNotEmpty) ...[
              const SliverToBoxAdapter(
                child: WeddingSectionTitle(
                  kicker: 'Collections',
                  title: 'Your galleries',
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  WeddingSpace.page, 0, WeddingSpace.page, WeddingSpace.xl,
                ),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, i) {
                      final g = Map<String, dynamic>.from(galleries[i] as Map);
                      return Padding(
                        padding: const EdgeInsets.only(bottom: WeddingSpace.md),
                        child: WeddingCard(
                          padding: EdgeInsets.zero,
                          onTap: () => context.push('/gallery/${g['id']}'),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              ClipRRect(
                                borderRadius: const BorderRadius.vertical(
                                  top: Radius.circular(19),
                                ),
                                child: AspectRatio(
                                  aspectRatio: 16 / 10,
                                  child: g['coverPhotoUrl'] != null
                                      ? Image.network(
                                          g['coverPhotoUrl'].toString(),
                                          fit: BoxFit.cover,
                                        )
                                      : Container(
                                          color: WeddingPalette.blush,
                                          child: const Center(
                                            child: WeddingMonogram(size: 22, opacity: 0.4),
                                          ),
                                        ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.all(WeddingSpace.md),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      g['name']?.toString() ?? 'Gallery',
                                      style: WeddingTheme.display(20),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${g['photoCount'] ?? 0} photographs',
                                      style: WeddingTheme.body(13),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                    childCount: galleries.length,
                  ),
                ),
              ),
            ],

            const SliverToBoxAdapter(child: SizedBox(height: 100)),
          ],
        ),
      ),
    );
  }

  Widget _statusPill(String text, Color accent) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: WeddingPalette.ivory,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: accent.withValues(alpha: 0.55), width: 1),
      ),
      child: Text(
        text,
        style: WeddingTheme.body(12, weight: FontWeight.w500, color: WeddingPalette.ink),
      ),
    );
  }

  Widget _chip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: WeddingPalette.blush.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: WeddingPalette.champagne.withValues(alpha: 0.4),
        ),
      ),
      child: Text(
        text,
        style: WeddingTheme.body(12, weight: FontWeight.w500, color: WeddingPalette.ink),
      ),
    );
  }
}

class _JourneyStep extends StatelessWidget {
  final String label;
  final String state; // done | current | upcoming
  final bool isLast;

  const _JourneyStep({
    required this.label,
    required this.state,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final done = state == 'done';
    final current = state == 'current';
    final color = done || current
        ? WeddingPalette.dustyRose
        : WeddingPalette.champagne.withValues(alpha: 0.45);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: done
                        ? WeddingPalette.dustyRose
                        : current
                            ? WeddingPalette.ivory
                            : WeddingPalette.ivory,
                    border: Border.all(color: color, width: current ? 2 : 1.5),
                  ),
                  child: done
                      ? const Icon(Icons.check, size: 11, color: WeddingPalette.ivory)
                      : current
                          ? Center(
                              child: Container(
                                width: 7,
                                height: 7,
                                decoration: const BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: WeddingPalette.dustyRose,
                                ),
                              ),
                            )
                          : null,
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 1.5,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      color: done
                          ? WeddingPalette.dustyRose.withValues(alpha: 0.5)
                          : WeddingPalette.champagne.withValues(alpha: 0.35),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 14),
              child: Text(
                label,
                style: WeddingTheme.body(
                  14,
                  weight: current ? FontWeight.w600 : FontWeight.w400,
                  color: current
                      ? WeddingPalette.ink
                      : done
                          ? WeddingPalette.inkSoft
                          : WeddingPalette.inkFaint,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DeliverableRow extends StatelessWidget {
  final int index;
  final Map<String, dynamic> item;

  const _DeliverableRow({required this.index, required this.item});

  @override
  Widget build(BuildContext context) {
    final title = item['title']?.toString() ?? 'Deliverable';
    final desc = item['description']?.toString();
    final qty = item['qty']?.toString();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Text(
              index.toString().padLeft(2, '0'),
              style: WeddingTheme.utility(size: 11, color: WeddingPalette.champagne),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: WeddingTheme.body(
                    15,
                    weight: FontWeight.w500,
                    color: WeddingPalette.ink,
                  ),
                ),
                if (desc != null && desc.trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(desc, style: WeddingTheme.body(12.5, height: 1.4)),
                ],
              ],
            ),
          ),
          if (qty != null && qty.isNotEmpty) ...[
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: WeddingPalette.blush.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                qty,
                style: WeddingTheme.body(
                  12,
                  weight: FontWeight.w600,
                  color: WeddingPalette.ink,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DeliveryTimelineRow extends StatelessWidget {
  final Map<String, dynamic> item;
  final bool isLast;

  const _DeliveryTimelineRow({required this.item, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final title = item['title']?.toString() ?? '';
    final timeframe = item['timeframe']?.toString();
    final desc = item['description']?.toString();

    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 10,
                height: 10,
                margin: const EdgeInsets.only(top: 5),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: WeddingPalette.champagne, width: 1.5),
                  color: WeddingPalette.ivory,
                ),
              ),
              if (!isLast)
                Container(
                  width: 1,
                  height: 36,
                  color: WeddingPalette.champagne.withValues(alpha: 0.4),
                ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: WeddingTheme.body(
                    15,
                    weight: FontWeight.w500,
                    color: WeddingPalette.ink,
                  ),
                ),
                if (timeframe != null && timeframe.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    timeframe,
                    style: WeddingTheme.body(
                      13,
                      weight: FontWeight.w500,
                      color: WeddingPalette.dustyRose,
                    ),
                  ),
                ],
                if (desc != null && desc.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(desc, style: WeddingTheme.body(12.5)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamRow extends StatelessWidget {
  final String role;
  final String name;

  const _TeamRow({required this.role, required this.name});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(role.toUpperCase(), style: WeddingTheme.utility(size: 10)),
              const SizedBox(height: 4),
              Text(
                name,
                style: WeddingTheme.display(20),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
