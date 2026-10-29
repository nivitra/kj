import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';

class PhotoGridItem extends StatelessWidget {
  final Photo photo;
  final VoidCallback onTap;
  final VoidCallback? onFavorite;
  final VoidCallback? onDownload;
  final bool showFavorite;
  final bool canDownload;
  /// Included photo locked after final submit — show lock instead of removable heart.
  final bool isLocked;
  /// Extra (pending, not yet billed) in extras phase.
  final bool isExtra;
  /// Extra already billed — cannot remove.
  final bool isBilled;
  /// Gallery is in extras phase: unselected tiles show + Extra instead of an empty heart.
  final bool extrasMode;
  /// e.g. "₹350"
  final String? extraPriceLabel;

  const PhotoGridItem({
    super.key,
    required this.photo,
    required this.onTap,
    this.onFavorite,
    this.onDownload,
    this.showFavorite = true,
    this.canDownload = false,
    this.isLocked = false,
    this.isExtra = false,
    this.isBilled = false,
    this.extrasMode = false,
    this.extraPriceLabel,
  });

  @override
  Widget build(BuildContext context) {
    final thumb = photo.thumbnailUrl ?? photo.previewUrl;
    return Material(
      color: AppColors.sunken(context),
      borderRadius: BorderRadius.circular(10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (thumb != null && thumb.isNotEmpty)
              CachedNetworkImage(
                imageUrl: thumb,
                fit: BoxFit.cover,
                memCacheWidth: 480,
                fadeInDuration: const Duration(milliseconds: 200),
                placeholder: (_, __) => Container(
                  color: AppColors.sunken(context),
                  alignment: Alignment.center,
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 1.5, color: AppColors.text3(context)),
                  ),
                ),
                errorWidget: (_, __, ___) => Center(
                  child: Icon(Icons.broken_image_outlined, color: AppColors.text3(context), size: 22),
                ),
              )
            else
              Center(
                child: Icon(
                  photo.isVideo ? Icons.videocam_outlined : Icons.image_outlined,
                  color: AppColors.text3(context),
                  size: 26,
                ),
              ),

            // Video badge
            if (photo.isVideo) ...[
              Container(color: Colors.black.withValues(alpha: 0.12)),
              Center(
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.55),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white24),
                  ),
                  child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 22),
                ),
              ),
              Positioned(
                left: 6,
                bottom: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'VIDEO',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
              ),
            ],

            // Top scrim for actions
            if (showFavorite || canDownload)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: 40,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withValues(alpha: 0.28),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),

            if (showFavorite && (onFavorite != null || isLocked || isBilled))
              Positioned(
                top: 6,
                right: 6,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: (isLocked || isBilled) ? null : onFavorite,
                  child: isLocked
                      ? _lockBadge()
                      : isBilled
                          ? _statusBadge('BILLED', const Color(0xFF5A5A56))
                          : extrasMode && !photo.isFavorite
                              ? _extraAddChip()
                              : _heartBtn(
                                  onTap: onFavorite!,
                                  active: photo.isFavorite,
                                  isExtra: isExtra && photo.isFavorite,
                                ),
                ),
              ),

            if (extrasMode && photo.isFavorite && !isLocked && !photo.isVideo)
              Positioned(
                left: 6,
                bottom: 6,
                child: _statusBadge(
                  isBilled
                      ? 'BILLED'
                      : (extraPriceLabel != null && extraPriceLabel!.isNotEmpty
                          ? 'EXTRA · $extraPriceLabel'
                          : 'EXTRA'),
                  isBilled ? const Color(0xFF5A5A56) : AppColors.amber,
                ),
              ),

            if (canDownload && onDownload != null)
              Positioned(
                top: 6,
                left: 6,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: onDownload,
                  child: _iconBtn(
                    onTap: onDownload!,
                    icon: Icons.download_rounded,
                    color: Colors.white,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _lockBadge() {
    return _statusBadge('LOCKED', AppColors.green, icon: Icons.lock_rounded);
  }

  Widget _extraAddChip() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.amber.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(10),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.add_rounded, color: Colors.white, size: 14),
          SizedBox(width: 2),
          Text(
            'EXTRA',
            style: TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBadge(String label, Color color, {IconData? icon}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, color: Colors.white, size: 12),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _heartBtn({
    required VoidCallback onTap,
    required bool active,
    bool isExtra = false,
  }) {
    return Material(
      color: Colors.black.withValues(alpha: 0.32),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(
            active ? Icons.favorite_rounded : Icons.favorite_border_rounded,
            color: active
                ? (isExtra ? AppColors.amber : AppColors.rose)
                : Colors.white,
            size: 22,
          ),
        ),
      ),
    );
  }

  Widget _iconBtn({
    required VoidCallback onTap,
    required IconData icon,
    required Color color,
  }) {
    return Material(
      color: Colors.black.withValues(alpha: 0.28),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(7),
          child: Icon(icon, color: color, size: 18),
        ),
      ),
    );
  }
}
