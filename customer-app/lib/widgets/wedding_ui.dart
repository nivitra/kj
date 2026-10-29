import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../theme/wedding_theme.dart';

// ── Cards (flat, champagne hairline, blush on press) ─────────────────────────

/// Ivory surface · 1px champagne hairline · radius 20 · no elevation.
class WeddingCard extends StatefulWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;

  const WeddingCard({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.onTap,
  });

  @override
  State<WeddingCard> createState() => _WeddingCardState();
}

class _WeddingCardState extends State<WeddingCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final card = AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
      margin: widget.margin,
      padding: widget.padding ?? const EdgeInsets.all(WeddingSpace.md),
      decoration: BoxDecoration(
        color: _pressed ? WeddingPalette.blush : Colors.white,
        borderRadius: BorderRadius.circular(WeddingSpace.radius),
        border: Border.all(
          color: WeddingPalette.champagne.withValues(alpha: 0.28),
          width: WeddingSpace.hairline,
        ),
      ),
      child: widget.child,
    );

    if (widget.onTap == null) return card;

    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1,
        duration: const Duration(milliseconds: 100),
        curve: Curves.easeOut,
        child: card,
      ),
    );
  }
}

/// Champagne hairline rule — full width, quiet structure.
class WeddingHairline extends StatelessWidget {
  final double indent;
  const WeddingHairline({super.key, this.indent = 0});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: indent, vertical: WeddingSpace.md),
      child: Container(
        height: WeddingSpace.hairline,
        color: WeddingPalette.champagne.withValues(alpha: 0.28),
      ),
    );
  }
}

/// Legacy alias used in older screens.
class WeddingDivider extends StatelessWidget {
  const WeddingDivider({super.key});

  @override
  Widget build(BuildContext context) => const WeddingHairline(indent: 48);
}

// ── Buttons ──────────────────────────────────────────────────────────────────

/// Primary action = dusty rose. Secondary = ivory + champagne border.
/// Soft scale 0.97 on press — no bounce, no glow, not a stock pill+icon.
class WeddingPillButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool primary;

  const WeddingPillButton({
    super.key,
    required this.label,
    this.onPressed,
    this.primary = true,
  });

  @override
  State<WeddingPillButton> createState() => _WeddingPillButtonState();
}

class _WeddingPillButtonState extends State<WeddingPillButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final primary = widget.primary;
    return GestureDetector(
      onTapDown: widget.onPressed == null ? null : (_) => setState(() => _down = true),
      onTapUp: widget.onPressed == null ? null : (_) => setState(() => _down = false),
      onTapCancel: widget.onPressed == null ? null : () => setState(() => _down = false),
      onTap: widget.onPressed,
      child: AnimatedScale(
        scale: _down ? 0.97 : 1,
        duration: const Duration(milliseconds: 100),
        curve: Curves.easeOut,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 15),
          decoration: BoxDecoration(
            color: primary
                ? (_down ? WeddingPalette.wine : WeddingPalette.dustyRose)
                : (_down ? WeddingPalette.blush : WeddingPalette.ivory),
            borderRadius: BorderRadius.circular(14),
            border: primary
                ? null
                : Border.all(color: WeddingPalette.champagne, width: 1),
          ),
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            style: WeddingTheme.body(
              14,
              weight: FontWeight.w500,
              color: primary ? WeddingPalette.ivory : WeddingPalette.ink,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Monogram (only decorative flourish) ──────────────────────────────────────

/// Interlocking initials — the sole flourish. Reuse faint on empty states.
class WeddingMonogram extends StatelessWidget {
  final String? bride;
  final String? groom;
  final double size;
  final double opacity;

  const WeddingMonogram({
    super.key,
    this.bride,
    this.groom,
    this.size = 18,
    this.opacity = 1,
  });

  String get _label {
    final g = (groom ?? '').trim();
    final b = (bride ?? '').trim();
    final gi = g.isNotEmpty ? g[0].toUpperCase() : '';
    final bi = b.isNotEmpty ? b[0].toUpperCase() : '';
    if (gi.isNotEmpty && bi.isNotEmpty) return '$gi · $bi';
    if (gi.isNotEmpty) return gi;
    if (bi.isNotEmpty) return bi;
    return '·';
  }

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: opacity.clamp(0.0, 1.0),
      child: Text(
        _label,
        textAlign: TextAlign.center,
        style: WeddingTheme.display(
          size,
          weight: FontWeight.w300,
          color: WeddingPalette.champagne,
          height: 1,
        ),
      ),
    );
  }
}

class WeddingHero extends StatelessWidget {
  final String? imageUrl;
  final String title;
  final String? subtitle;
  final String? meta;
  final double height;
  final String? brideName;
  final String? groomName;

  const WeddingHero({
    super.key,
    this.imageUrl,
    required this.title,
    this.subtitle,
    this.meta,
    this.height = 220,
    this.brideName,
    this.groomName,
  });

  @override
  Widget build(BuildContext context) {
    const pad = WeddingSpace.page;
    return Padding(
      padding: const EdgeInsets.fromLTRB(pad, WeddingSpace.sm, pad, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(WeddingSpace.radius),
            child: SizedBox(
              height: height,
              width: double.infinity,
              child: imageUrl != null && imageUrl!.isNotEmpty
                  ? CachedNetworkImage(
                      imageUrl: imageUrl!,
                      fit: BoxFit.cover,
                      memCacheWidth: 1200,
                      placeholder: (_, __) => Container(color: WeddingPalette.blush),
                      errorWidget: (_, __, ___) => _placeholder(),
                    )
                  : _placeholder(),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            style: WeddingTheme.display(28, weight: FontWeight.w500),
          ),
          if (subtitle != null && subtitle!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              subtitle!,
              style: WeddingTheme.body(14, color: WeddingPalette.inkSoft),
            ),
          ],
        ],
      ),
    );
  }

  Widget _placeholder() {
    return Container(
      color: WeddingPalette.blush,
      alignment: Alignment.center,
      child: WeddingMonogram(
        bride: brideName,
        groom: groomName,
        size: 22,
        opacity: 0.45,
      ),
    );
  }
}

/// Compact days · hours · minutes until the wedding.
class WeddingCountdown extends StatefulWidget {
  final DateTime date;
  const WeddingCountdown({super.key, required this.date});

  @override
  State<WeddingCountdown> createState() => _WeddingCountdownState();
}

class _WeddingCountdownState extends State<WeddingCountdown> {
  Timer? _timer;
  Duration _left = Duration.zero;

  DateTime get _target {
    final d = widget.date.toLocal();
    return DateTime(d.year, d.month, d.day);
  }

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _tick());
  }

  @override
  void didUpdateWidget(covariant WeddingCountdown oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.date != widget.date) _tick();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _tick() {
    final now = DateTime.now();
    final left = _target.difference(now);
    if (!mounted) return;
    setState(() => _left = left);
  }

  @override
  Widget build(BuildContext context) {
    final d = _target;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final dateLabel = '${d.day} ${months[d.month - 1]} ${d.year}';

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    if (today == DateTime(d.year, d.month, d.day)) {
      return WeddingCard(
        child: Column(
          children: [
            Text('Today', style: WeddingTheme.utility(size: 11)),
            const SizedBox(height: 8),
            Text("It's your wedding day", style: WeddingTheme.display(22)),
          ],
        ),
      );
    }
    if (today.isAfter(DateTime(d.year, d.month, d.day))) {
      return WeddingCard(
        child: Column(
          children: [
            Text('Your day', style: WeddingTheme.utility(size: 11)),
            const SizedBox(height: 8),
            Text(dateLabel, style: WeddingTheme.display(20)),
            const SizedBox(height: 4),
            Text(
              'Photos and films will land here as they’re ready.',
              textAlign: TextAlign.center,
              style: WeddingTheme.body(13, color: WeddingPalette.inkSoft),
            ),
          ],
        ),
      );
    }

    final days = _left.inDays;
    final hours = _left.inHours.remainder(24);
    final mins = _left.inMinutes.remainder(60);

    Widget cell(String value, String label) {
      return Expanded(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: WeddingPalette.blush.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                value,
                textAlign: TextAlign.center,
                style: WeddingTheme.display(26, weight: FontWeight.w500),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: WeddingTheme.body(11, color: WeddingPalette.inkFaint),
            ),
          ],
        ),
      );
    }

    return WeddingCard(
      child: Column(
        children: [
          Text('Countdown', style: WeddingTheme.utility(size: 11)),
          const SizedBox(height: 4),
          Text(dateLabel, style: WeddingTheme.body(13, color: WeddingPalette.inkSoft)),
          const SizedBox(height: 14),
          Row(
            children: [
              cell('$days', days == 1 ? 'day' : 'days'),
              const SizedBox(width: 8),
              cell(hours.toString().padLeft(2, '0'), hours == 1 ? 'hour' : 'hours'),
              const SizedBox(width: 8),
              cell(mins.toString().padLeft(2, '0'), 'min'),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Section chrome ───────────────────────────────────────────────────────────

class WeddingSectionTitle extends StatelessWidget {
  final String kicker;
  final String title;
  const WeddingSectionTitle({super.key, required this.kicker, required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        WeddingSpace.page,
        WeddingSpace.lg,
        WeddingSpace.page,
        WeddingSpace.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(kicker, style: WeddingTheme.utility(size: 11)),
          const SizedBox(height: 4),
          Text(title, style: WeddingTheme.display(20, weight: FontWeight.w500)),
        ],
      ),
    );
  }
}

/// Quick-link tile for home (Gallery / Billing) — ivory, gold hairline, blush press.
class WeddingQuickTile extends StatefulWidget {
  final String label;
  final String? meta;
  final IconData icon;
  final VoidCallback? onTap;

  const WeddingQuickTile({
    super.key,
    required this.label,
    this.meta,
    required this.icon,
    this.onTap,
  });

  @override
  State<WeddingQuickTile> createState() => _WeddingQuickTileState();
}

class _WeddingQuickTileState extends State<WeddingQuickTile> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1,
        duration: const Duration(milliseconds: 100),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
          decoration: BoxDecoration(
            color: _pressed ? WeddingPalette.blush : Colors.white,
            borderRadius: BorderRadius.circular(WeddingSpace.radius),
            border: Border.all(
              color: WeddingPalette.champagne.withValues(alpha: 0.28),
              width: WeddingSpace.hairline,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(widget.icon, size: 22, color: WeddingPalette.inkSoft),
              const SizedBox(height: 16),
              Text(
                widget.label,
                style: WeddingTheme.body(
                  15,
                  weight: FontWeight.w500,
                  color: WeddingPalette.ink,
                ),
              ),
              if (widget.meta != null && widget.meta!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  widget.meta!,
                  style: WeddingTheme.body(12, color: WeddingPalette.inkFaint),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

String weddingCoupleTitle({String? bride, String? groom, String? fallback}) {
  final b = (bride ?? '').trim();
  final g = (groom ?? '').trim();
  if (b.isNotEmpty && g.isNotEmpty) return '$g & $b';
  if (b.isNotEmpty) return b;
  if (g.isNotEmpty) return g;
  return fallback ?? 'Your Wedding';
}

String? weddingCountdown(DateTime? date) {
  if (date == null) return null;
  final now = DateTime.now();
  final d = DateTime(date.year, date.month, date.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = d.difference(today).inDays;
  if (diff > 1) return '$diff days until your wedding';
  if (diff == 1) return 'Tomorrow is the day';
  if (diff == 0) return 'Today is your wedding day';
  return 'Your wedding memories';
}

String weddingUtilityDate(DateTime? date) {
  if (date == null) return 'YOUR WEDDING';
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  return 'YOUR WEDDING · ${date.day} ${months[date.month - 1]} ${date.year}';
}
