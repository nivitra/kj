import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../models/models.dart';
import '../providers/gallery_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Find My Photos — consent → selfie → async search → results.
/// FACE-PIPELINE-PLAN.md §6. Never shows similarity scores.
class FaceSearchScreen extends ConsumerStatefulWidget {
  final String? galleryId;
  /// Guest share flow: shadow-customer JWT for face APIs (does not log them into the main app).
  final String? guestCustomerToken;
  /// Guest share session token (for binding face results to the share guest).
  final String? guestAccessToken;
  const FaceSearchScreen({
    super.key,
    this.galleryId,
    this.guestCustomerToken,
    this.guestAccessToken,
  });

  @override
  ConsumerState<FaceSearchScreen> createState() => _FaceSearchScreenState();
}

class _FaceSearchScreenState extends ConsumerState<FaceSearchScreen> {
  final _picker = ImagePicker();

  String _step = 'consent'; // consent | pick | searching | results | empty | error
  bool _loading = false;
  String? _error;
  String? _consentId;
  String? _sessionId;
  String? _statusMessage;
  List<Photo> _results = [];
  bool _broaderAvailable = false;

  bool get _isGuest =>
      (widget.guestCustomerToken != null && widget.guestCustomerToken!.isNotEmpty) ||
      (widget.guestAccessToken != null && widget.guestAccessToken!.isNotEmpty);

  String? get _bearer => widget.guestCustomerToken;

  Future<void> _acceptConsent() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.faceConsent(bearerToken: _bearer);
      setState(() {
        _consentId = data['consentId'] as String?;
        _step = 'pick';
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Could not record consent. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _pickAndSearch(ImageSource source) async {
    if (_consentId == null) return;
    final file = await _picker.pickImage(
      source: source,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 88,
    );
    if (file == null) return;

    setState(() {
      _loading = true;
      _error = null;
      _step = 'searching';
      _statusMessage = 'Uploading selfie…';
    });

    try {
      final bytes = await file.readAsBytes();
      final mime = _mimeFor(file.path, file.mimeType);

      final urlData = await ApiService.faceUploadUrl(
        consentId: _consentId!,
        contentType: mime,
        galleryId: widget.galleryId,
        bearerToken: _bearer,
      );
      final sessionId = urlData['sessionId'] as String;
      final uploadUrl = urlData['uploadUrl'] as String;
      _sessionId = sessionId;

      await ApiService.putSelfie(uploadUrl, bytes, mime);

      setState(() => _statusMessage = 'Looking for photos that may include you…');
      await ApiService.faceSubmit(sessionId, bearerToken: _bearer);
      await _poll(sessionId);
    } catch (e) {
      setState(() {
        _step = 'error';
        _error = 'Search failed. Try a brighter selfie with only you in frame.';
        _loading = false;
      });
    }
  }

  Future<void> _poll(String sessionId) async {
    const terminal = {
      'COMPLETED',
      'NO_MATCH',
      'REJECTED',
      'FAILED',
      'EXPIRED',
      'RATE_LIMITED',
    };
    var delay = const Duration(seconds: 2);
    for (var i = 0; i < 60; i++) {
      await Future.delayed(delay);
      final status = await ApiService.faceStatus(sessionId, bearerToken: _bearer);
      final s = status['status'] as String? ?? '';
      setState(() {
        _statusMessage = status['message'] as String? ?? _statusMessage;
        _broaderAvailable = status['broaderAvailable'] == true;
      });
      if (terminal.contains(s)) {
        if (s == 'COMPLETED') {
          if (widget.guestAccessToken != null && widget.guestAccessToken!.isNotEmpty) {
            try {
              await ApiService.bindGuestFaceSession(
                guestAccessToken: widget.guestAccessToken!,
                sessionId: sessionId,
              );
            } catch (_) {}
          }
          final res = await ApiService.faceResults(sessionId, bearerToken: _bearer);
          final list = (res['results'] as List<Photo>?) ?? [];
          setState(() {
            _results = list;
            _step = list.isEmpty ? 'empty' : 'results';
            _loading = false;
          });
        } else if (s == 'NO_MATCH') {
          setState(() {
            _step = 'empty';
            _loading = false;
            _broaderAvailable = true;
          });
        } else if (s == 'REJECTED') {
          setState(() {
            _step = 'error';
            _error = status['message'] as String? ??
                'We couldn\'t use that selfie. Try again with only you in frame.';
            _loading = false;
          });
        } else {
          setState(() {
            _step = 'error';
            _error = status['message'] as String? ?? 'Something went wrong.';
            _loading = false;
          });
        }
        return;
      }
      if (delay.inSeconds < 5) delay = Duration(seconds: delay.inSeconds + 1);
    }
    setState(() {
      _step = 'error';
      _error = 'Search is taking longer than expected. Please try again.';
      _loading = false;
    });
  }

  Future<void> _broader() async {
    if (_sessionId == null) return;
    setState(() {
      _loading = true;
      _step = 'searching';
      _statusMessage = 'Running a broader search…';
    });
    try {
      await ApiService.faceBroader(_sessionId!, bearerToken: _bearer);
      await _poll(_sessionId!);
    } catch (_) {
      setState(() {
        _step = 'error';
        _error = 'Broader search failed. Please try a new selfie.';
        _loading = false;
      });
    }
  }

  Future<void> _toggleFavorite(Photo photo) async {
    try {
      final result = await ApiService.toggleFavorite(photo.id, selected: !photo.isFavorite);
      if (!mounted) return;
      final fav = result['favorited'] == true;
      setState(() {
        _results = _results
            .map((p) => p.id == photo.id ? p.copyWith(isFavorite: fav) : p)
            .toList();
      });
    } catch (_) {}
  }

  String _mimeFor(String path, String? mime) {
    if (mime != null && mime.startsWith('image/')) return mime;
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  @override
  Widget build(BuildContext context) {
    // Guest share: skip client-dashboard access gates — they only have this gallery token.
    if (_isGuest) {
      return Scaffold(
        backgroundColor: AppColors.bg(context),
        appBar: AppBar(
          backgroundColor: AppColors.bg(context),
          surfaceTintColor: Colors.transparent,
          title: Text('Find my photos', style: AppTheme.kicker()),
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
            child: _buildBody(),
          ),
        ),
      );
    }

    final access = ref.watch(clientAccessProvider);

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        backgroundColor: AppColors.bg(context),
        surfaceTintColor: Colors.transparent,
        title: Text('Find my photos', style: AppTheme.kicker()),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: access.loading
              ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context)))
              : !access.hasGalleries
                  ? _noAccessView(
                      title: 'No gallery assigned',
                      body:
                          'Face search is available only after your studio shares a private gallery with you.',
                    )
                  : !access.hasFaceSearch
                      ? _noAccessView(
                          title: 'Face search not enabled',
                          body:
                              'Your studio has not turned on face search for your galleries yet.',
                        )
                      : _buildBody(),
        ),
      ),
    );
  }

  Widget _noAccessView({required String title, required String body}) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.photo_library_outlined, size: 40, color: AppColors.text3(context)),
          const SizedBox(height: 16),
          Text(title, style: AppTheme.display(22), textAlign: TextAlign.center),
          const SizedBox(height: 10),
          Text(
            body,
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    switch (_step) {
      case 'consent':
        return _consentView();
      case 'pick':
        return _pickView();
      case 'searching':
        return _searchingView();
      case 'results':
        return _resultsView();
      case 'empty':
        return _emptyView();
      case 'error':
        return _errorView();
      default:
        return _consentView();
    }
  }

  Widget _consentView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Find photos of you', style: AppTheme.display(28)),
        const SizedBox(height: 12),
        Text(
          'Take a quick selfie. We will show photos that may include you from galleries your studio shared with you.',
          style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.5),
        ),
        const SizedBox(height: 20),
        _bullet('Selfies are deleted immediately after search.'),
        _bullet('Never an identity claim — only possible matches.'),
        _bullet('Similarity scores are never shown.'),
        _bullet('You can heart photos and finalize selections as usual.'),
        const Spacer(),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(_error!, style: const TextStyle(color: Color(0xFFB4534B))),
          ),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _loading ? null : _acceptConsent,
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.text(context),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: _loading
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('I understand — continue', style: TextStyle(fontWeight: FontWeight.w600)),
          ),
        ),
      ],
    );
  }

  Widget _pickView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Your selfie', style: AppTheme.display(28)),
        const SizedBox(height: 12),
        Text(
          'One person, face clearly visible, good light. No group shots.',
          style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.5),
        ),
        const Spacer(),
        _actionButton(Icons.photo_camera_outlined, 'Take a photo', () => _pickAndSearch(ImageSource.camera)),
        const SizedBox(height: 12),
        _actionButton(Icons.photo_library_outlined, 'Choose from library', () => _pickAndSearch(ImageSource.gallery), outlined: true),
      ],
    );
  }

  Widget _searchingView() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 120,
            height: 120,
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 120,
                  height: 120,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    color: AppColors.accent(context).withValues(alpha: 0.35),
                  ),
                ),
                SizedBox(
                  width: 88,
                  height: 88,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AppColors.text(context),
                  ),
                ),
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppColors.sunken(context),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: Icon(Icons.face_retouching_natural, size: 30, color: AppColors.accent(context)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          Text('Scanning', style: AppTheme.display(24)),
          const SizedBox(height: 10),
          Text(
            _statusMessage ?? 'Looking for photos that may include you…',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.5),
          ),
          const SizedBox(height: 16),
          Text(
            'This usually takes a few seconds',
            style: TextStyle(color: AppColors.text3(context), fontSize: 12, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _resultsView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Photos that may include you', style: AppTheme.display(24)),
        const SizedBox(height: 6),
        Text(
          '${_results.length} ${_results.length == 1 ? 'photo' : 'photos'}',
          style: TextStyle(color: AppColors.text3(context), fontSize: 13),
        ),
        const SizedBox(height: 16),
        Expanded(
          child: GridView.builder(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              mainAxisSpacing: 6,
              crossAxisSpacing: 6,
            ),
            itemCount: _results.length,
            itemBuilder: (ctx, i) {
              final p = _results[i];
              final gid = p.galleryId ?? widget.galleryId;
              return GestureDetector(
                onTap: gid != null && gid.isNotEmpty ? () => context.push('/gallery/$gid') : null,
                child: Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: p.thumbnailUrl != null
                        ? CachedNetworkImage(imageUrl: p.thumbnailUrl!, fit: BoxFit.cover)
                        : Container(color: AppColors.sunken(context)),
                  ),
                  Positioned(
                    top: 4,
                    right: 4,
                    child: GestureDetector(
                      onTap: () => _toggleFavorite(p),
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.black45,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Icon(
                          p.isFavorite ? Icons.favorite : Icons.favorite_border,
                          size: 16,
                          color: p.isFavorite ? const Color(0xFFE8B4B8) : Colors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              );
            },
          ),
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: () => setState(() {
            _step = 'pick';
            _results = [];
            _sessionId = null;
          }),
          child: Text('Search again', style: TextStyle(color: AppColors.text(context), fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }

  Widget _emptyView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('No matches yet', style: AppTheme.display(28)),
        const SizedBox(height: 12),
        Text(
          'We couldn\'t find photos that may include you. Try another selfie, or ask your studio for help.',
          style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.5),
        ),
        const Spacer(),
        if (_broaderAvailable) ...[
          _actionButton(Icons.tune_rounded, 'Try a broader search', _broader),
          const SizedBox(height: 12),
        ],
        _actionButton(Icons.camera_alt_outlined, 'Try another selfie', () {
          setState(() {
            _step = 'pick';
            _sessionId = null;
          });
        }, outlined: true),
      ],
    );
  }

  Widget _errorView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Something went wrong', style: AppTheme.display(28)),
        const SizedBox(height: 12),
        Text(
          _error ?? 'Please try again.',
          style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.5),
        ),
        const Spacer(),
        _actionButton(Icons.refresh_rounded, 'Try again', () {
          setState(() {
            _step = 'pick';
            _error = null;
            _sessionId = null;
          });
        }),
      ],
    );
  }

  Widget _bullet(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('·  ', style: TextStyle(color: AppColors.accent(context), fontSize: 18, height: 1.2)),
          Expanded(child: Text(text, style: TextStyle(color: AppColors.text2(context), fontSize: 14, height: 1.45))),
        ],
      ),
    );
  }

  Widget _actionButton(IconData icon, String label, VoidCallback onTap, {bool outlined = false}) {
    return SizedBox(
      width: double.infinity,
      child: outlined
          ? OutlinedButton.icon(
              onPressed: _loading ? null : onTap,
              icon: Icon(icon, size: 18),
              label: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.text(context),
                padding: const EdgeInsets.symmetric(vertical: 16),
                side: BorderSide(color: AppColors.border(context)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            )
          : FilledButton.icon(
              onPressed: _loading ? null : onTap,
              icon: Icon(icon, size: 18),
              label: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.text(context),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
    );
  }
}
