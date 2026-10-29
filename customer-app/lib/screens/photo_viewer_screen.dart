import '../widgets/share_link_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:photo_view/photo_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/download_service.dart';
import '../widgets/gallery_video_player.dart';
import '../widgets/premium_ui.dart';

class PhotoViewerScreen extends StatefulWidget {
  final String galleryId;
  final List<Photo> photos;
  final int initialIndex;
  final bool selectionEnabled;
  final bool downloadsAllowed;
  final List<String> lockedPhotoIds;
  final int includedLimit;
  final String selectionPhase;
  final int heartedCount;
  final Map<String, String> extraDeliveryTypes;
  final double rawRate;
  final double editRate;
  final List<String> billedExtraPhotoIds;

  const PhotoViewerScreen({
    super.key,
    required this.galleryId,
    required this.photos,
    required this.initialIndex,
    this.selectionEnabled = true,
    this.downloadsAllowed = false,
    this.lockedPhotoIds = const [],
    this.includedLimit = 0,
    this.selectionPhase = 'INCLUDED',
    this.heartedCount = 0,
    this.extraDeliveryTypes = const {},
    this.rawRate = 350,
    this.editRate = 350,
    this.billedExtraPhotoIds = const [],
  });

  @override
  State<PhotoViewerScreen> createState() => _PhotoViewerScreenState();
}

class _PhotoViewerScreenState extends State<PhotoViewerScreen>
    with SingleTickerProviderStateMixin {
  late int _currentIndex;
  late PageController _pageController;
  bool _downloading = false;
  List<Photo> _photos = [];
  final Map<String, bool> _favoriteChanges = {};
  late Map<String, String> _types;
  late int _hearted;
  late AnimationController _heartCtrl;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex.clamp(0, widget.photos.isEmpty ? 0 : widget.photos.length - 1);
    _photos = List<Photo>.from(widget.photos);
    _hearted = widget.heartedCount;
    _types = Map<String, String>.from(widget.extraDeliveryTypes);
    _pageController = PageController(initialPage: _currentIndex);
    _heartCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 280));
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  }

  Photo get _current => _photos[_currentIndex];
  bool get _isExtrasPhase => widget.selectionPhase == 'EXTRAS';
  bool get _currentLocked => widget.lockedPhotoIds.contains(_current.id);
  bool get _currentBilled => widget.billedExtraPhotoIds.contains(_current.id);
  double get _extraRate {
    return widget.editRate >= 0 ? widget.editRate : 0;
  }
  String get _rateLabel {
    final r = _extraRate;
    return r == r.roundToDouble() ? r.round().toString() : r.toStringAsFixed(0);
  }


  Map<String, dynamic> _resultPayload() => {
        'favorites': Map<String, bool>.from(_favoriteChanges),
        'types': Map<String, String>.from(_types),
      };

  void _pop() {
    if (!mounted) return;
    final empty = _favoriteChanges.isEmpty && _types.isEmpty;
    if (context.canPop()) { context.pop(empty ? null : _resultPayload()); }
    else { context.go('/gallery/${widget.galleryId}'); }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg, style: const TextStyle(height: 1.35)), duration: const Duration(seconds: 4)),
    );
  }

  bool _savingSelection = false;
  Future<void> _toggleFavorite() async {
    if (_savingSelection) return;
    if (!widget.selectionEnabled) return;
    if (_currentLocked) {
      _snack(
        'Editing has started for this photo. '
        'You can still select more photos and review any extra cost before sending.',
      );
      return;
    }
    if (_currentBilled) {
      _snack(
        'Editing has started for this photo. You can still add other photos.',
      );
      return;
    }

    _savingSelection = true;
    Haptics.light();
    _heartCtrl.forward(from: 0);
    final prev = _current;
    final optimistic = !prev.isFavorite;
    setState(() {
      final i = _photos.indexWhere((p) => p.id == prev.id);
      if (i >= 0) _photos[i] = prev.copyWith(isFavorite: optimistic);
      _hearted = (_hearted + (optimistic ? 1 : -1)).clamp(0, 1 << 30).toInt();
      _favoriteChanges[prev.id] = optimistic;
      if (optimistic) {
        _types[prev.id] ??= 'EDITED';
      } else {
        _types.remove(prev.id);
      }
    });
    try {
      final result = await ApiService.toggleFavorite(prev.id, selected: optimistic);
      final newVal = result['favorited'] == true;
      if (!mounted) return;
      setState(() {
        final i = _photos.indexWhere((p) => p.id == prev.id);
        if (i >= 0) _photos[i] = _photos[i].copyWith(isFavorite: newVal);
        _favoriteChanges[prev.id] = newVal;
        if (optimistic != newVal) {
          _hearted = (_hearted + (newVal ? 1 : -1)).clamp(0, 1 << 30).toInt();
        }
        if (newVal) {
          _types[prev.id] ??= 'EDITED';
        } else {
          _types.remove(prev.id);
        }
      });
      if (newVal && _isExtrasPhase) {
        _snack(result['message']?.toString() ?? 'Added as extra · ₹$_rateLabel');
      } else if (result['overLimit'] == true && !_isExtrasPhase) {
        final msg = result['overLimitMessage']?.toString() ?? result['message']?.toString();
        if (msg != null && msg.isNotEmpty) _snack(msg);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        final i = _photos.indexWhere((p) => p.id == prev.id);
        if (i >= 0) _photos[i] = prev;
        _favoriteChanges.remove(prev.id);
        _hearted = (_hearted + (optimistic ? -1 : 1)).clamp(0, 1 << 30).toInt();
        if (prev.isFavorite) {
          _types[prev.id] ??= 'EDITED';
        } else {
          _types.remove(prev.id);
        }
      });
      _snack(ApiService.errorMessage(e) ?? 'Could not update');
    }
    _savingSelection = false;
  }

  Future<String?> _resolveDownloadUrl(Photo p) async {
    if (!widget.downloadsAllowed) return null;
    if (p.downloadUrl != null && p.downloadUrl!.isNotEmpty) return p.downloadUrl;
    try {
      final url = await ApiService.getPhotoDownloadUrl(widget.galleryId, p.id);
      final i = _photos.indexWhere((x) => x.id == p.id);
      if (i >= 0 && mounted) {
        setState(() {
          _photos[i] = _photos[i].copyWith(downloadUrl: url, downloadAvailable: true);
        });
      }
      return url;
    } catch (_) {
      return null;
    }
  }

  Future<void> _download() async {
    if (!widget.downloadsAllowed) {
      _snack('Downloads are locked. Ask the studio to enable downloads for this gallery.');
      return;
    }
    setState(() => _downloading = true);
    try {
      final url = await _resolveDownloadUrl(_current);
      if (url == null || url.isEmpty) {
        throw StateError('Original file is not ready for download yet.');
      }
      final name = _current.filename.isNotEmpty
          ? _current.filename
          : (_current.isVideo ? 'video_${_currentIndex + 1}.mp4' : 'photo_${_currentIndex + 1}.jpg');
      await DownloadService.downloadPhoto(
        url: url,
        filename: name,
        expectedBytes: _current.fileSize,
      );
      Haptics.success();
      _snack('Ready — choose Save Image / Save to Files in the share sheet');
    } catch (e) {
      _snack(ApiService.errorMessage(e) ?? 'Download failed');
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_photos.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Center(
            child: TextButton(
              onPressed: _pop,
              child: const Text('Close', style: TextStyle(color: Colors.white)),
            ),
          ),
        ),
      );
    }

    final dpr = MediaQuery.devicePixelRatioOf(context);
    final screenW = MediaQuery.sizeOf(context).width;
    final previewCacheW = (screenW * dpr).clamp(720, 1600).round();

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _pop();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            PageView.builder(
              controller: _pageController,
              physics: const BouncingScrollPhysics(),
              itemCount: _photos.length,
              onPageChanged: (i) => setState(() => _currentIndex = i),
              itemBuilder: (ctx, i) {
                final p = _photos[i];
                final stream = p.streamUrl ?? p.downloadUrl;
                if (p.isVideo && stream != null && stream.isNotEmpty) {
                  return Center(
                    child: GalleryVideoPlayer(
                      key: ValueKey('vid-${p.id}'),
                      url: stream,
                      posterUrl: p.previewUrl ?? p.thumbnailUrl,
                      title: p.filename,
                      autoPlay: i == _currentIndex,
                    ),
                  );
                }
                final preview = p.previewUrl;
                final thumb = p.thumbnailUrl;
                final img = preview ?? thumb ?? '';
                if (img.isEmpty) {
                  return const Center(
                    child: Icon(Icons.broken_image_outlined, color: Colors.white38, size: 40),
                  );
                }
                return PhotoView(
                  imageProvider: CachedNetworkImageProvider(
                    img,
                    maxWidth: preview != null ? previewCacheW : 480,
                  ),
                  minScale: PhotoViewComputedScale.contained,
                  maxScale: PhotoViewComputedScale.covered * 4,
                  initialScale: PhotoViewComputedScale.contained,
                  heroAttributes: PhotoViewHeroAttributes(tag: p.id),
                  backgroundDecoration: const BoxDecoration(color: Colors.black),
                  gestureDetectorBehavior: HitTestBehavior.deferToChild,
                  loadingBuilder: (_, __) => const Center(
                    child: SizedBox(
                      width: 26,
                      height: 26,
                      child: CircularProgressIndicator(color: Colors.white54, strokeWidth: 2),
                    ),
                  ),
                  errorBuilder: (_, __, ___) => const Center(
                    child: Icon(Icons.broken_image_outlined, color: Colors.white38, size: 40),
                  ),
                );
              },
            ),

            // Top bar — always hittable (Material so PhotoView cannot steal taps)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Material(
                type: MaterialType.transparency,
                child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.black.withValues(alpha: 0.62), Colors.transparent],
                  ),
                ),
                child: SafeArea(
                  bottom: false,
                  child: SizedBox(
                    height: 56,
                    child: Row(
                      children: [
                        IconButton(
                          iconSize: 28,
                          padding: const EdgeInsets.all(12),
                          icon: const Icon(Icons.close_rounded, color: Colors.white),
                          onPressed: _pop,
                          tooltip: 'Close',
                        ),
                        Expanded(
                          child: Text(
                            '${_currentIndex + 1} of ${_photos.length}',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        ShareLinkButton(path: '/gallery/${widget.galleryId}/photo?photoId=${_current.id}', title: 'Share photo', color: Colors.white),
                      ],
                    ),
                  ),
                ),
                ),
              ),
            ),

            // Bottom actions — always visible, large tap targets
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Material(
                type: MaterialType.transparency,
                child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [Colors.black.withValues(alpha: 0.78), Colors.transparent],
                  ),
                ),
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 28, 16, 14),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (widget.selectionEnabled &&
                            _isExtrasPhase &&
                            !_currentLocked &&
                            !_current.isVideo) ...[
                          Text(
                            _currentBilled
                                ? 'Already billed — not charged again'
                                : (_current.isFavorite
                                    ? 'In extra cart · ₹$_rateLabel  ·  tap to remove'
                                    : 'Add as extra · ₹$_rateLabel  ·  billed after you review'),
                            style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 12),
                        ],
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            if (widget.selectionEnabled)
                              ScaleTransition(
                                scale: TweenSequence<double>([
                                  TweenSequenceItem(tween: Tween(begin: 1, end: 1.28), weight: 40),
                                  TweenSequenceItem(tween: Tween(begin: 1.28, end: 1), weight: 60),
                                ]).animate(CurvedAnimation(parent: _heartCtrl, curve: Curves.easeOut)),
                                child: _BarButton(
                                  icon: _currentLocked
                                      ? Icons.lock_rounded
                                      : _currentBilled
                                          ? Icons.check_circle_rounded
                                          : (_isExtrasPhase
                                              ? (_current.isFavorite
                                                  ? Icons.remove_circle_outline_rounded
                                                  : Icons.add_rounded)
                                              : (_current.isFavorite
                                                  ? Icons.favorite_rounded
                                                  : Icons.favorite_border_rounded)),
                                  label: _currentLocked
                                      ? 'Locked'
                                      : _currentBilled
                                          ? 'Billed'
                                          : (_isExtrasPhase
                                              ? (_current.isFavorite
                                                  ? 'Remove extra'
                                                  : 'Add extra')
                                              : (_current.isFavorite ? 'Selected' : 'Select')),
                                  color: _currentLocked
                                      ? const Color(0xFF4A9B78)
                                      : _currentBilled
                                          ? const Color(0xFFB8B8B4)
                                          : (_isExtrasPhase
                                              ? const Color(0xFFE0A84A)
                                              : (_current.isFavorite ? const Color(0xFFD64562) : Colors.white)),
                                  onTap: _toggleFavorite,
                                ),
                              ),
                            if (widget.downloadsAllowed)
                              _BarButton(
                                icon: _downloading
                                    ? Icons.hourglass_top_rounded
                                    : Icons.download_rounded,
                                label: _downloading ? 'Saving…' : 'Download',
                                color: Colors.white,
                                onTap: _downloading ? () {} : _download,
                              ),
                            _BarButton(
                              icon: Icons.close_rounded,
                              label: 'Close',
                              color: Colors.white70,
                              onTap: _pop,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _pageController.dispose();
    _heartCtrl.dispose();
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ));
    super.dispose();
  }
}

class _BarButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _BarButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 76, minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, color: color, size: 28),
                const SizedBox(height: 4),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
