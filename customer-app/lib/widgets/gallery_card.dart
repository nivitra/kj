import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import 'premium_ui.dart';

class GalleryCard extends StatelessWidget {
  final Gallery gallery;
  final VoidCallback onTap;
  const GalleryCard({super.key, required this.gallery, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 16 / 10,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Hero(
                  tag: 'gallery-cover-${gallery.id}',
                  child: gallery.coverPhotoUrl != null
                      ? CachedNetworkImage(
                          imageUrl: gallery.coverPhotoUrl!,
                          fit: BoxFit.cover,
                          memCacheWidth: 900,
                          fadeInDuration: const Duration(milliseconds: 120),
                          placeholder: (_, __) => Container(color: AppColors.sunken(context)),
                          errorWidget: (_, __, ___) => _placeholderCover(context),
                        )
                      : _placeholderCover(context),
                ),
                Positioned(
                  left: 10,
                  right: 10,
                  bottom: 10,
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (gallery.isRawMode)
                        _badge(Icons.lock_open_rounded, 'Originals')
                      else if (gallery.downloadsAllowed || gallery.downloadEnabled)
                        _badge(Icons.download_rounded, 'Downloads'),
                      if (gallery.faceSearchEnabled)
                        _badge(Icons.face_retouching_natural, 'Face'),
                      if (gallery.isViewOnly)
                        _badge(Icons.lock_rounded, 'View only')
                      else if (!gallery.isRawMode && gallery.selectionEnabled == false)
                        _badge(Icons.lock_rounded, 'View only'),
                      if (gallery.bulkRawOffer.live && gallery.bulkRawOffer.daysLeft != null)
                        _badge(
                          Icons.timer_outlined,
                          gallery.bulkRawOffer.daysLeft! <= 0
                              ? 'Ending'
                              : 'Ends in ${gallery.bulkRawOffer.daysLeft}d',
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 10, 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        gallery.name,
                        style: AppTheme.display(17, letterSpacing: -0.2, context: context),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        [
                          '${gallery.photoCount} photos',
                          if (gallery.ageLabel != null && gallery.ageLabel!.isNotEmpty)
                            gallery.ageLabel!,
                          if (gallery.eventDate != null) _formatDate(gallery.eventDate!),
                        ].join(' · '),
                        style: TextStyle(
                          color: AppColors.text2(context),
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppColors.text(context),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.arrow_forward_rounded,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? AppColors.canvasDark
                        : Colors.white,
                    size: 18,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _badge(IconData icon, String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: Colors.white),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      );

  Widget _placeholderCover(BuildContext context) => Container(
        color: AppColors.sunken(context),
        child: Icon(Icons.image_outlined, color: AppColors.text3(context), size: 30),
      );

  String _formatDate(String iso) {
    try {
      final d = DateTime.parse(iso);
      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      return '${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return '';
    }
  }
}
