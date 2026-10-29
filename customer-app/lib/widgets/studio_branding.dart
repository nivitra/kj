import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Shared studio brand pieces used on Home, Contact, Profile, and shell drawer.
class StudioLogo extends StatelessWidget {
  final String? logoUrl;
  final String name;
  final double size;
  final double radius;

  const StudioLogo({
    super.key,
    this.logoUrl,
    required this.name,
    this.size = 48,
    this.radius = 12,
  });

  String get _initials {
    final parts = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final s = parts.map((w) => w[0].toUpperCase()).join();
    return s.isEmpty ? 'SJ' : s;
  }

  @override
  Widget build(BuildContext context) {
    if (logoUrl != null && logoUrl!.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: CachedNetworkImage(
          imageUrl: logoUrl!,
          width: size,
          height: size,
          fit: BoxFit.cover,
          memCacheWidth: (size * 3).round().clamp(64, 256),
          fadeInDuration: const Duration(milliseconds: 80),
          errorWidget: (_, __, ___) => _fallback(context),
          placeholder: (_, __) => _fallback(context),
        ),
      );
    }
    return _fallback(context);
  }

  Widget _fallback(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? [const Color(0xFF2A2D36), const Color(0xFF1C1F28)]
              : [const Color(0xFFF4EFE6), const Color(0xFFE8DFD0)],
        ),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Text(
        _initials,
        style: TextStyle(
          color: AppColors.accent(context),
          fontWeight: FontWeight.w700,
          fontSize: size * 0.32,
        ),
      ),
    );
  }
}

/// Full-bleed studio hero (cover + logo + name + tagline).
class StudioHeroCard extends StatelessWidget {
  final Map? profile;
  final String fallbackName;
  final VoidCallback? onTap;
  final double aspectRatio;
  final bool compact;

  const StudioHeroCard({
    super.key,
    required this.profile,
    this.fallbackName = 'Studio',
    this.onTap,
    this.aspectRatio = 16 / 9,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final name = (profile?['displayName'] as String?)?.trim().isNotEmpty == true
        ? profile!['displayName'] as String
        : fallbackName;
    final tagline = profile?['tagline']?.toString();
    final cover = profile?['coverUrl'] as String?;
    final logo = profile?['logoUrl'] as String?;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: AspectRatio(
            aspectRatio: aspectRatio,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (cover != null && cover.isNotEmpty)
                  CachedNetworkImage(
                    imageUrl: cover,
                    fit: BoxFit.cover,
                    memCacheWidth: 900,
                    fadeInDuration: const Duration(milliseconds: 100),
                  )
                else
                  Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF2C2A26), Color(0xFF9A7B4F)],
                      ),
                    ),
                  ),
                Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withValues(alpha: 0.05),
                        Colors.black.withValues(alpha: 0.62),
                      ],
                    ),
                  ),
                ),
                Positioned(
                  left: compact ? 14 : 18,
                  right: compact ? 14 : 18,
                  bottom: compact ? 12 : 16,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      StudioLogo(logoUrl: logo, name: name, size: compact ? 40 : 52, radius: 14),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTheme.display(compact ? 20 : 24, color: Colors.white),
                            ),
                            if (tagline != null && tagline.trim().isNotEmpty) ...[
                              const SizedBox(height: 3),
                              Text(
                                tagline.trim(),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.85),
                                  fontSize: compact ? 12 : 13,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (onTap != null)
                        Icon(Icons.chevron_right_rounded, color: Colors.white.withValues(alpha: 0.85)),
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

/// Compact studio row for lists / profile.
class StudioIdentityTile extends StatelessWidget {
  final Map? profile;
  final String fallbackName;
  final VoidCallback? onTap;
  final String? subtitle;

  const StudioIdentityTile({
    super.key,
    required this.profile,
    this.fallbackName = 'Studio',
    this.onTap,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final name = (profile?['displayName'] as String?)?.trim().isNotEmpty == true
        ? profile!['displayName'] as String
        : fallbackName;
    final tag = subtitle ??
        (profile?['tagline'] as String?)?.trim() ??
        (profile?['phone'] as String?)?.trim() ??
        'Your photography studio';

    return Material(
      color: AppColors.card(context),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border(context)),
          ),
          child: Row(
            children: [
              StudioLogo(
                logoUrl: profile?['logoUrl'] as String?,
                name: name,
                size: 44,
                radius: 12,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.text(context))),
                    if (tag.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        tag,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.text2(context), fontSize: 12, height: 1.3),
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null) Icon(Icons.chevron_right_rounded, color: AppColors.text3(context)),
            ],
          ),
        ),
      ),
    );
  }
}
