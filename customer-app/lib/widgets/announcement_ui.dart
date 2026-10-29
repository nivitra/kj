import 'dart:math' as math;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';
import 'premium_ui.dart';
import 'share_link_button.dart';

/// Persists dismissed popup/banner announcement IDs so clients aren't spammed.
/// Bump key version when we need every client to see announcements again.
class AnnouncementPrefs {
  static const _popupKey = 'ann_popup_dismissed_v3';
  static const _bannerKey = 'ann_banner_dismissed_v3';
  static const _sessionPopupKey = 'ann_popup_session_v3';

  static Future<Set<String>> _read(String key) async {
    try {
      final p = await SharedPreferences.getInstance();
      return (p.getStringList(key) ?? const []).toSet();
    } catch (_) {
      return {};
    }
  }

  static Future<void> _add(String key, String id) async {
    if (id.isEmpty) return;
    try {
      final p = await SharedPreferences.getInstance();
      final cur = (p.getStringList(key) ?? <String>[]).toSet()..add(id);
      final list = cur.toList();
      if (list.length > 80) list.removeRange(0, list.length - 80);
      await p.setStringList(key, list);
    } catch (_) {}
  }

  static Future<Set<String>> dismissedPopups() => _read(_popupKey);
  static Future<Set<String>> dismissedBanners() => _read(_bannerKey);
  static Future<void> dismissPopup(String id) => _add(_popupKey, id);
  static Future<void> dismissBanner(String id) => _add(_bannerKey, id);

  /// Clear all dismiss history (debug / force re-show).
  static Future<void> clearAll() async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.remove(_popupKey);
      await p.remove(_bannerKey);
      await p.remove(_sessionPopupKey);
    } catch (_) {}
  }
}

String annStyle(Map a) => (a['style']?.toString() ?? 'FEED').toUpperCase().trim();

bool annIsBanner(Map a) {
  final s = annStyle(a);
  return s == 'BANNER' || s == 'BOTH';
}

/// Every active style can popup once (FEED included) so existing posts are seen.
bool annIsPopup(Map a) {
  final s = annStyle(a);
  return s == 'POPUP' || s == 'BOTH' || s == 'FEED' || s == 'BANNER' || s.isEmpty;
}

bool annIsFeed(Map a) {
  final s = annStyle(a);
  // Popup-only stays modal; everything else appears in the feed strip
  return s != 'POPUP';
}

Future<void> openAnnCta(Map a) async {
  final url = a['ctaUrl']?.toString();
  if (url == null || url.isEmpty) return;
  var u = url.trim();
  if (!u.contains('://')) u = 'https://$u';
  final uri = Uri.tryParse(u);
  if (uri == null) return;
  try {
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  } catch (_) {}
}

/// Sticky / dismissible home banner for BANNER | BOTH styles.
class AnnouncementBanner extends StatelessWidget {
  final Map announcement;
  final VoidCallback onDismiss;
  final VoidCallback? onOpen;

  const AnnouncementBanner({
    super.key,
    required this.announcement,
    required this.onDismiss,
    this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final title = announcement['title']?.toString() ?? '';
    final body = announcement['description']?.toString() ?? '';
    final image = announcement['imageUrl']?.toString();
    final cta = announcement['ctaLabel']?.toString();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            Haptics.selection();
            onOpen?.call();
          },
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: Theme.of(context).brightness == Brightness.dark
                    ? [const Color(0xFF2A2438), const Color(0xFF1E2230)]
                    : [const Color(0xFF2C2416), const Color(0xFF1A1917)],
              ),
            ),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (image != null && image.isNotEmpty)
                    SizedBox(
                      width: 72,
                      child: CachedNetworkImage(
                        imageUrl: image,
                        fit: BoxFit.cover,
                        memCacheWidth: 200,
                      ),
                    ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.campaign_rounded, size: 14, color: Color(0xFFC4A574)),
                              const SizedBox(width: 6),
                              Text(
                                'STUDIO UPDATE',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.65),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.1,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                          ),
                          if (body.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              body,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.78),
                                fontSize: 12,
                                height: 1.35,
                              ),
                            ),
                          ],
                          if (cta != null && cta.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text(
                              cta,
                              style: const TextStyle(
                                color: Color(0xFFC4A574),
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Haptics.light();
                      onDismiss();
                    },
                    icon: Icon(Icons.close_rounded, size: 18, color: Colors.white.withValues(alpha: 0.7)),
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

/// Popup with confetti — safe on web/mobile. Call from any button / auto-home.
Future<void> showAnnouncementPopup(
  BuildContext context, {
  required Map announcement,
  VoidCallback? onDismiss,
  bool confetti = true,
}) async {
  final title = announcement['title']?.toString() ?? 'Studio update';
  final body = announcement['description']?.toString() ?? '';
  final image = announcement['imageUrl']?.toString();
  final cta = announcement['ctaLabel']?.toString();
  final hasCta = (announcement['ctaUrl']?.toString() ?? '').isNotEmpty;

  var dismissed = false;
  void dismissOnce() {
    if (dismissed) return;
    dismissed = true;
    onDismiss?.call();
  }

  try {
    await showDialog<void>(
      context: context,
      useRootNavigator: true,
      barrierDismissible: true,
      barrierColor: Colors.black.withValues(alpha: 0.55),
      builder: (ctx) {
        final maxH = MediaQuery.sizeOf(ctx).height * 0.85;
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              if (confetti)
                const Positioned.fill(
                  child: IgnorePointer(child: _ConfettiBurst()),
                ),
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: 380, maxHeight: maxH),
                child: Material(
                  color: AppColors.card(ctx),
                  borderRadius: BorderRadius.circular(22),
                  clipBehavior: Clip.antiAlias,
                  elevation: 12,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (image != null && image.isNotEmpty)
                          AspectRatio(
                            aspectRatio: 16 / 9,
                            child: CachedNetworkImage(
                              imageUrl: image,
                              fit: BoxFit.cover,
                              memCacheWidth: 800,
                              errorWidget: (_, __, ___) => Container(
                                color: AppColors.sunken(ctx),
                                alignment: Alignment.center,
                                child: Icon(Icons.campaign_rounded, color: AppColors.accent(ctx), size: 36),
                              ),
                            ),
                          )
                        else
                          Container(
                            height: 88,
                            alignment: Alignment.center,
                            color: AppColors.sunken(ctx),
                            child: Icon(Icons.campaign_rounded, color: AppColors.accent(ctx), size: 36),
                          ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('FROM YOUR STUDIO', style: AppTheme.kicker(context: ctx)),
                              const SizedBox(height: 8),
                              Text(title, style: AppTheme.display(24, context: ctx)),
                              if (body.isNotEmpty) ...[
                                const SizedBox(height: 10),
                                Text(
                                  body,
                                  style: TextStyle(
                                    color: AppColors.text2(ctx),
                                    height: 1.45,
                                    fontSize: 14.5,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                          child: Column(
                            children: [
                              ShareLinkButton(path: '/announcements?id=${announcement['id']}', title: 'Share announcement'),
                              if (hasCta)
                                SizedBox(
                                  width: double.infinity,
                                  child: FilledButton(
                                    onPressed: () async {
                                      Haptics.medium();
                                      await openAnnCta(announcement);
                                    },
                                    child: Text(cta?.isNotEmpty == true ? cta! : 'Learn more'),
                                  ),
                                ),
                              ShareLinkButton(path: '/announcements?id=${announcement['id']}', title: 'Share announcement'),
                              if (hasCta) const SizedBox(height: 8),
                              SizedBox(
                                width: double.infinity,
                                child: OutlinedButton(
                                  onPressed: () {
                                    Haptics.light();
                                    Navigator.of(ctx, rootNavigator: true).pop();
                                  },
                                  child: const Text('Got it'),
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
          ),
        );
      },
    );
  } catch (_) {
    // Fallback: snackbar if dialog fails for any reason
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(title), duration: const Duration(seconds: 4)),
      );
    }
  } finally {
    dismissOnce();
  }
}

/// Feed card — always tappable (GestureDetector, not just InkWell).
class AnnouncementFeedCard extends StatelessWidget {
  final Map announcement;
  final VoidCallback? onTap;
  const AnnouncementFeedCard({super.key, required this.announcement, this.onTap});

  @override
  Widget build(BuildContext context) {
    final title = announcement['title']?.toString() ?? '';
    final body = announcement['description']?.toString() ?? '';
    final image = announcement['imageUrl']?.toString();

    return Material(
      color: AppColors.card(context),
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      child: InkWell(
        onTap: () {
          Haptics.selection();
          onTap?.call();
        },
        child: Container(
          height: 128,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border(context)),
          ),
          child: Row(
            children: [
              if (image != null && image.isNotEmpty)
                SizedBox(
                  width: 100,
                  child: CachedNetworkImage(
                    imageUrl: image,
                    fit: BoxFit.cover,
                    memCacheWidth: 280,
                    errorWidget: (_, __, ___) => Container(
                      color: AppColors.sunken(context),
                      child: Icon(Icons.campaign_outlined, color: AppColors.text3(context)),
                    ),
                  ),
                )
              else
                Container(
                  width: 72,
                  color: AppColors.sunken(context),
                  alignment: Alignment.center,
                  child: Icon(Icons.campaign_outlined, color: AppColors.accent(context)),
                ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('ANNOUNCEMENT', style: AppTheme.kicker(context: context)),
                      const SizedBox(height: 6),
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AppColors.text(context),
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Expanded(
                        child: Text(
                          body,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: AppColors.text2(context),
                            fontSize: 12.5,
                            height: 1.35,
                          ),
                        ),
                      ),
                      Text(
                        'Tap to open',
                        style: TextStyle(
                          color: AppColors.accent(context),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Lightweight confetti — finite size only (web-safe).
class _ConfettiBurst extends StatefulWidget {
  const _ConfettiBurst();
  @override
  State<_ConfettiBurst> createState() => _ConfettiBurstState();
}

class _ConfettiBurstState extends State<_ConfettiBurst>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  late final List<_Particle> _parts;
  final _rng = math.Random();

  static const _colors = [
    Color(0xFFD64562),
    Color(0xFF9A7B4F),
    Color(0xFF3F8F5B),
    Color(0xFF3B6FB0),
    Color(0xFFE8B86D),
    Color(0xFF7C6CF0),
    Color(0xFFF472B6),
  ];

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))
      ..forward();
    _parts = List.generate(42, (i) {
      final angle = _rng.nextDouble() * math.pi * 2;
      final speed = 0.55 + _rng.nextDouble() * 0.9;
      return _Particle(
        ox: 0.5 + (_rng.nextDouble() - 0.5) * 0.15,
        oy: 0.42,
        vx: math.cos(angle) * speed,
        vy: math.sin(angle) * speed - 1.1,
        color: _colors[i % _colors.length],
        size: 5 + _rng.nextDouble() * 5,
        spin: (_rng.nextDouble() - 0.5) * 8,
        angle0: _rng.nextDouble() * math.pi,
        rect: i.isEven,
      );
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth.isFinite && constraints.maxWidth > 0
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        final h = constraints.maxHeight.isFinite && constraints.maxHeight > 0
            ? constraints.maxHeight
            : MediaQuery.sizeOf(context).height;
        return AnimatedBuilder(
          animation: _c,
          builder: (_, __) {
            if (_c.value >= 1) return const SizedBox.shrink();
            return CustomPaint(
              size: Size(w, h),
              painter: _ConfettiPainter(t: Curves.easeOut.transform(_c.value), parts: _parts),
            );
          },
        );
      },
    );
  }
}

class _Particle {
  final double ox, oy, vx, vy, size, spin, angle0;
  final Color color;
  final bool rect;
  _Particle({
    required this.ox,
    required this.oy,
    required this.vx,
    required this.vy,
    required this.color,
    required this.size,
    required this.spin,
    required this.angle0,
    required this.rect,
  });
}

class _ConfettiPainter extends CustomPainter {
  final double t;
  final List<_Particle> parts;
  _ConfettiPainter({required this.t, required this.parts});

  @override
  void paint(Canvas canvas, Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    if (!size.width.isFinite || !size.height.isFinite) return;
    const g = 2.4;
    final fade = t < 0.65 ? 1.0 : (1 - (t - 0.65) / 0.35).clamp(0.0, 1.0);
    for (final p in parts) {
      final x = p.ox * size.width + p.vx * t * size.width * 0.42;
      final y = p.oy * size.height + p.vy * t * size.height * 0.38 + 0.5 * g * t * t * size.height * 0.4;
      if (x < -40 || x > size.width + 40 || y < -40 || y > size.height + 40) continue;
      final paint = Paint()..color = p.color.withValues(alpha: 0.9 * fade);
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(p.angle0 + p.spin * t);
      if (p.rect) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.5),
            const Radius.circular(1.5),
          ),
          paint,
        );
      } else {
        canvas.drawCircle(Offset.zero, p.size * 0.4, paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.t != t;
}
