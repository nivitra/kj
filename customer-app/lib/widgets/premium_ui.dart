import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shimmer/shimmer.dart';
import '../theme/app_theme.dart';

/// Soft haptic helpers — no-ops if platform lacks support.
class Haptics {
  static void light() {
    try {
      HapticFeedback.lightImpact();
    } catch (_) {}
  }

  static void medium() {
    try {
      HapticFeedback.mediumImpact();
    } catch (_) {}
  }

  static void selection() {
    try {
      HapticFeedback.selectionClick();
    } catch (_) {}
  }

  static void success() {
    try {
      HapticFeedback.mediumImpact();
    } catch (_) {}
  }
}

/// Layout-matching shimmer block.
class ShimmerBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;
  const ShimmerBox({super.key, this.width, this.height = 16, this.radius = 10});

  @override
  Widget build(BuildContext context) {
    final base = AppColors.sunken(context);
    final highlight = Theme.of(context).brightness == Brightness.dark
        ? AppColors.lineDark
        : AppColors.border(context);
    final block = Container(width: width, height: height, decoration: BoxDecoration(color: base, borderRadius: BorderRadius.circular(radius)));
    if (MediaQuery.disableAnimationsOf(context)) return block;
    return ExcludeSemantics(child: Shimmer.fromColors(
      baseColor: base,
      highlightColor: highlight,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: base,
          borderRadius: BorderRadius.circular(radius),
        ),
      ),
    ));
  }
}

class ShimmerList extends StatelessWidget {
  final int count;
  final double itemHeight;
  const ShimmerList({super.key, this.count = 4, this.itemHeight = 88});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (i) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: ShimmerBox(height: itemHeight, radius: AppSpace.radius),
        ),
      ),
    );
  }
}

/// Elevated card with soft shadow (light) / elevated surface (dark).
class PremiumCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;
  final BorderRadius? radius;
  final Color? color;
  final bool elevated;

  const PremiumCard({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.onTap,
    this.radius,
    this.color,
    this.elevated = true,
  });

  @override
  Widget build(BuildContext context) {
    final r = radius ?? BorderRadius.circular(AppSpace.radius);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bg = color ?? AppColors.card(context);
    return Padding(
      padding: margin ?? EdgeInsets.zero,
      child: Material(
        color: bg,
        elevation: elevated && !dark ? 1 : 0,
        shadowColor: Colors.black.withValues(alpha: 0.08),
        shape: RoundedRectangleBorder(borderRadius: r, side: BorderSide(color: AppColors.border(context))),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap == null ? null : () { Haptics.selection(); onTap!(); },
          child: Padding(padding: padding ?? const EdgeInsets.all(AppSpace.md), child: child),
        ),
      ),
    );
  }
}

/// Glass-style summary panel for billing.
class GlassCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  const GlassCard({super.key, required this.child, this.padding});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSpace.radiusLg),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? [
                  const Color(0xFF1C1C1C),
                  const Color(0xFF141414),
                ]
              : [
                  const Color(0xFF2C2416),
                  const Color(0xFF1A1A1A),
                ],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
  }
}

/// Bounce heart for favorites / selection.
class AnimatedHeart extends StatefulWidget {
  final bool active;
  final VoidCallback? onTap;
  final double size;
  const AnimatedHeart({
    super.key,
    required this.active,
    this.onTap,
    this.size = 28,
  });

  @override
  State<AnimatedHeart> createState() => _AnimatedHeartState();
}

class _AnimatedHeartState extends State<AnimatedHeart>
    with SingleTickerProviderStateMixin {
  late AnimationController _c;
  late Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 280));
    _scale = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1, end: 1.35), weight: 40),
      TweenSequenceItem(tween: Tween(begin: 1.35, end: 1), weight: 60),
    ]).animate(CurvedAnimation(parent: _c, curve: Curves.easeOut));
  }

  @override
  void didUpdateWidget(covariant AnimatedHeart old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active && widget.active && !MediaQuery.disableAnimationsOf(context)) {
      _c.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: widget.active,
      label: widget.active ? 'Remove from selection' : 'Select photo',
      child: SizedBox(width: 48, height: 48, child: GestureDetector(
      onTap: widget.onTap == null
          ? null
          : () {
              Haptics.light();
              widget.onTap!();
            },
      behavior: HitTestBehavior.opaque,
      child: ScaleTransition(
        scale: _scale,
        child: Icon(
          widget.active ? Icons.favorite_rounded : Icons.favorite_border_rounded,
          size: widget.size,
          color: widget.active ? AppColors.rose : Colors.white.withValues(alpha: 0.95),
          shadows: widget.active
              ? null
              : [Shadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 6)],
        ),
      ),
    )));
  }
}

/// 6-digit OTP entry with auto-advance.
class OtpBoxes extends StatefulWidget {
  final int length;
  final ValueChanged<String> onCompleted;
  final ValueChanged<String>? onChanged;
  const OtpBoxes({
    super.key,
    this.length = 6,
    required this.onCompleted,
    this.onChanged,
  });

  @override
  State<OtpBoxes> createState() => _OtpBoxesState();
}

class _OtpBoxesState extends State<OtpBoxes> {
  late final List<TextEditingController> _ctrls;
  late final List<FocusNode> _nodes;

  @override
  void initState() {
    super.initState();
    _ctrls = List.generate(widget.length, (_) => TextEditingController());
    _nodes = List.generate(widget.length, (_) => FocusNode());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_nodes.isNotEmpty) _nodes.first.requestFocus();
    });
  }

  @override
  void dispose() {
    for (final c in _ctrls) {
      c.dispose();
    }
    for (final n in _nodes) {
      n.dispose();
    }
    super.dispose();
  }

  String get _value => _ctrls.map((c) => c.text).join();

  void _onDigit(int i, String v) {
    if (v.length > 1) {
      // Paste full code
      final digits = v.replaceAll(RegExp(r'\D'), '');
      for (var j = 0; j < widget.length; j++) {
        _ctrls[j].text = j < digits.length ? digits[j] : '';
      }
      final last = digits.length.clamp(0, widget.length) - 1;
      if (last >= 0) _nodes[last.clamp(0, widget.length - 1)].requestFocus();
      widget.onChanged?.call(_value);
      if (_value.length == widget.length) {
        Haptics.success();
        widget.onCompleted(_value);
      }
      setState(() {});
      return;
    }
    if (v.isNotEmpty && i < widget.length - 1) {
      _nodes[i + 1].requestFocus();
    }
    widget.onChanged?.call(_value);
    if (_value.length == widget.length) {
      Haptics.success();
      widget.onCompleted(_value);
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: List.generate(widget.length, (i) {
        final filled = _ctrls[i].text.isNotEmpty;
        return AnimatedScale(
          scale: filled ? 1.05 : 1.0,
          duration: AppMotion.fast,
          child: SizedBox(
            width: 46,
            height: 56,
            child: TextField(
              controller: _ctrls[i],
              focusNode: _nodes[i],
              textAlign: TextAlign.center,
              keyboardType: TextInputType.number,
              maxLength: 1,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: AppColors.text(context),
              ),
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                counterText: '',
                filled: true,
                fillColor: AppColors.sunken(context),
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: AppColors.border(context)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: AppColors.text(context), width: 1.5),
                ),
              ),
              onChanged: (v) {
                if (v.isEmpty && i > 0) {
                  _nodes[i - 1].requestFocus();
                }
                _onDigit(i, v);
              },
            ),
          ),
        );
      }),
    );
  }
}

/// Empty state with icon + message.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.page, vertical: AppSpace.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.sunken(context),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 22, color: AppColors.text3(context)),
          ),
          const SizedBox(height: AppSpace.sm),
          Text(title, textAlign: TextAlign.center, style: AppTheme.display(17, context: context)),
          if (subtitle != null) ...[
            const SizedBox(height: AppSpace.xs),
            Text(
              subtitle!,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
            ),
          ],
          if (action != null) ...[
            const SizedBox(height: AppSpace.md),
            action!,
          ],
        ],
      ),
    );
  }
}

/// Section label with optional action — calm, generous top air.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  /// When true, returns a [SliverToBoxAdapter] for CustomScrollView.
  final bool asSliver;
  const SectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
    this.asSliver = false,
  });

  @override
  Widget build(BuildContext context) {
    final child = Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.page,
        AppSpace.md,
        AppSpace.page,
        AppSpace.sectionTitle,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: AppTheme.kicker(context: context),
            ),
          ),
          if (actionLabel != null)
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: const Size(48, 48),
              ),
              child: Text(
                actionLabel!,
                style: TextStyle(
                  fontWeight: FontWeight.w500,
                  color: AppColors.text2(context),
                  fontSize: 13,
                ),
              ),
            ),
        ],
      ),
    );
    return asSliver ? SliverToBoxAdapter(child: child) : child;
  }
}
