import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:chewie/chewie.dart';
import '../theme/app_theme.dart';

/// Full-screen / dialog player for gallery delivery videos (signed S3 URLs).
class GalleryVideoPlayer extends StatefulWidget {
  final String url;
  final String? posterUrl;
  final String? title;
  final bool autoPlay;

  const GalleryVideoPlayer({
    super.key,
    required this.url,
    this.posterUrl,
    this.title,
    this.autoPlay = true,
  });

  /// Open as a modal dialog over the current route.
  static Future<void> open(
    BuildContext context, {
    required String url,
    String? posterUrl,
    String? title,
  }) {
    return showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.92),
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            Center(
              child: GalleryVideoPlayer(
                url: url,
                posterUrl: posterUrl,
                title: title,
              ),
            ),
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                onPressed: () => Navigator.pop(ctx),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  State<GalleryVideoPlayer> createState() => _GalleryVideoPlayerState();
}

class _GalleryVideoPlayerState extends State<GalleryVideoPlayer> {
  VideoPlayerController? _video;
  ChewieController? _chewie;
  String? _error;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final c = VideoPlayerController.networkUrl(Uri.parse(widget.url));
      await c.initialize();
      if (!mounted) {
        await c.dispose();
        return;
      }
      final chewie = ChewieController(
        videoPlayerController: c,
        autoPlay: widget.autoPlay,
        looping: false,
        allowFullScreen: true,
        allowMuting: true,
        showControlsOnInitialize: true,
        materialProgressColors: ChewieProgressColors(
          playedColor: AppColors.gold,
          handleColor: AppColors.gold,
          bufferedColor: Colors.white24,
          backgroundColor: Colors.white12,
        ),
        placeholder: widget.posterUrl != null
            ? Image.network(widget.posterUrl!, fit: BoxFit.contain)
            : const ColoredBox(color: Colors.black),
        errorBuilder: (_, error) => Center(
          child: Text(
            error,
            style: const TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ),
      );
      setState(() {
        _video = c;
        _chewie = chewie;
        _ready = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _chewie?.dispose();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          'Could not play video.\n$_error',
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white70, height: 1.4),
        ),
      );
    }
    if (!_ready || _chewie == null) {
      return const SizedBox(
        height: 220,
        child: Center(
          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70),
        ),
      );
    }
    final ar = _video!.value.aspectRatio == 0 ? 16 / 9 : _video!.value.aspectRatio;
    return AspectRatio(
      aspectRatio: ar,
      child: Chewie(controller: _chewie!),
    );
  }
}
