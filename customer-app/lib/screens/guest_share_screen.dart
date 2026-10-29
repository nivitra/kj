import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:photo_view/photo_view.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/download_service.dart';
import '../theme/app_theme.dart';
import '../widgets/gallery_video_player.dart';

/// Guest gallery share — name + phone + face (no sign-in).
///
/// Optional “Know more about studio” opens marketing (about, packages, portfolio)
/// from the share preview payload. Production QR links are served by nginx
/// `guest.html`; this screen is the Flutter-side fallback.
class GuestShareScreen extends StatefulWidget {
  final String token;
  const GuestShareScreen({super.key, required this.token});

  @override
  State<GuestShareScreen> createState() => _GuestShareScreenState();
}

class _GuestShareScreenState extends State<GuestShareScreen> {
  Map<String, dynamic>? _preview;
  bool _loading = true;
  String? _error;

  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _picker = ImagePicker();

  bool _busy = false;
  String? _guestToken;
  String? _customerToken;
  String? _galleryId;
  bool _faceEnabled = true;
  bool _hasFullAccessCode = false;
  bool _fullAccess = false;
  bool _downloadsAllowed = false;
  String? _guestName;

  List<Photo> _photos = [];
  String _statusMessage = '';
  final _fullAccessCtrl = TextEditingController();

  /// details | face | searching | photos
  String _step = 'details';

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _fullAccessCtrl.dispose();
    super.dispose();
  }

  Map? get _gallery => _preview?['gallery'] as Map?;
  Map? get _studio => _preview?['studio'] as Map?;
  List get _packages => (_preview?['packages'] as List?) ?? const [];
  List get _portfolio => (_preview?['portfolio'] as List?) ?? const [];

  Future<void> _loadPreview() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.publicSharePreview(widget.token);
      final share = Map<String, dynamic>.from(data['share'] as Map? ?? data);
      if (!mounted) return;
      setState(() {
        _preview = share;
        _faceEnabled = share['requiresFace'] == true ||
            (share['gallery'] as Map?)?['faceSearchEnabled'] == true;
        _downloadsAllowed = share['downloadsAllowed'] == true ||
            (share['gallery'] as Map?)?['downloadsAllowed'] == true ||
            (share['gallery'] as Map?)?['downloadEnabled'] == true;
        _hasFullAccessCode = share['hasFullAccessCode'] == true;
        _loading = false;
        _step = 'details';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  /// Digits only; India 10-digit mobiles get 91 prefix for WhatsApp deliverability.
  String _normalizePhone(String raw) {
    var d = raw.replaceAll(RegExp(r'[^\d]'), '');
    if (d.length == 10 && RegExp(r'^[6-9]').hasMatch(d)) {
      d = '91$d';
    }
    return d;
  }

  List<String> _portfolioUrls(Map item) {
    final media = item['media'];
    if (media is List && media.isNotEmpty) {
      return media
          .map((m) => (m is Map ? m['url'] : null)?.toString())
          .whereType<String>()
          .where((u) => u.isNotEmpty)
          .toList();
    }
    final cover = item['coverUrl']?.toString();
    if (cover != null && cover.isNotEmpty) return [cover];
    return const [];
  }

  void _openPortfolioWork(Map<String, dynamic> item) {
    final urls = _portfolioUrls(item);
    if (urls.isEmpty) return;
    final title = item['title']?.toString() ?? 'Our work';
    final desc = item['description']?.toString();
    final cat = item['category']?.toString();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (ctx) {
        var index = 0;
        final page = PageController();
        return StatefulBuilder(
          builder: (ctx, setLocal) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: AppColors.border(context),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                    Text(title, style: AppTheme.display(20)),
                    if (cat != null && cat.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(cat, style: TextStyle(color: AppColors.text3(context), fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                    if (desc != null && desc.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(desc, style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13)),
                    ],
                    const SizedBox(height: 12),
                    AspectRatio(
                      aspectRatio: 3 / 4,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(14),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            PageView.builder(
                              controller: page,
                              itemCount: urls.length,
                              onPageChanged: (i) => setLocal(() => index = i),
                              itemBuilder: (_, i) => CachedNetworkImage(
                                imageUrl: urls[i],
                                fit: BoxFit.cover,
                              ),
                            ),
                            if (urls.length > 1)
                              Positioned(
                                top: 10,
                                right: 10,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.55),
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Text(
                                    '${index + 1} / ${urls.length}',
                                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    if (urls.length > 1) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        height: 56,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: urls.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 6),
                          itemBuilder: (_, i) {
                            final on = i == index;
                            return GestureDetector(
                              onTap: () {
                                page.animateToPage(i, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
                              },
                              child: Container(
                                width: 52,
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: on ? AppColors.text(context) : AppColors.border(context), width: on ? 2 : 1),
                                ),
                                clipBehavior: Clip.antiAlias,
                                child: CachedNetworkImage(imageUrl: urls[i], fit: BoxFit.cover),
                              ),
                            );
                          },
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _submitDetails() async {
    final name = _nameCtrl.text.trim();
    final phone = _normalizePhone(_phoneCtrl.text);
    if (name.length < 2 || phone.length < 10) {
      _toast('Enter your full name and a valid mobile (with country code if outside India)');
      return;
    }
    setState(() => _busy = true);
    try {
      final data = await ApiService.publicShareRegister(
        token: widget.token,
        name: name,
        phone: phone,
      );
      if (!mounted) return;
      setState(() {
        _guestToken = data['accessToken']?.toString();
        _customerToken = data['customerToken']?.toString();
        _galleryId = data['galleryId']?.toString();
        _faceEnabled = data['faceSearchEnabled'] == true;
        _guestName = name;
        _busy = false;
        _step = _faceEnabled ? 'face' : 'photos';
      });
      if (!_faceEnabled) await _loadPhotos();
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(ApiService.errorMessage(e) ?? 'Could not continue');
    }
  }

  Future<void> _runFaceScan(ImageSource source) async {
    if (_customerToken == null || _customerToken!.isEmpty) {
      _toast('Session expired — re-enter your details');
      setState(() => _step = 'details');
      return;
    }
    setState(() {
      _busy = true;
      _step = 'searching';
      _statusMessage = 'Opening camera…';
    });
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 88,
      );
      if (file == null) {
        setState(() {
          _busy = false;
          _step = 'face';
        });
        return;
      }

      setState(() => _statusMessage = 'Almost there…');
      final consent = await ApiService.faceConsent(bearerToken: _customerToken);
      final consentId = consent['consentId'] as String?;
      if (consentId == null) throw StateError('Consent failed');

      final bytes = await file.readAsBytes();
      final path = file.path.toLowerCase();
      final mime = path.endsWith('.png')
          ? 'image/png'
          : path.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';

      setState(() => _statusMessage = 'Uploading selfie…');
      final urlData = await ApiService.faceUploadUrl(
        consentId: consentId,
        contentType: mime,
        galleryId: _galleryId,
        bearerToken: _customerToken,
      );
      final sessionId = urlData['sessionId'] as String;
      await ApiService.putSelfie(urlData['uploadUrl'] as String, bytes, mime);

      setState(() => _statusMessage = 'Finding your photos…');
      await ApiService.faceSubmit(sessionId, bearerToken: _customerToken);

      const terminal = {
        'COMPLETED', 'NO_MATCH', 'REJECTED', 'FAILED', 'EXPIRED', 'RATE_LIMITED',
      };
      var delay = const Duration(seconds: 2);
      for (var i = 0; i < 60; i++) {
        await Future<void>.delayed(delay);
        final status = await ApiService.faceStatus(sessionId, bearerToken: _customerToken);
        final s = status['status'] as String? ?? '';
        setState(() {
          _statusMessage = status['message'] as String? ?? _statusMessage;
        });
        if (terminal.contains(s)) {
          if ((s == 'COMPLETED' || s == 'NO_MATCH') && _guestToken != null) {
            try {
              await ApiService.bindGuestFaceSession(
                guestAccessToken: _guestToken!,
                sessionId: sessionId,
              );
            } catch (_) {}
          }
          break;
        }
        if (delay.inSeconds < 5) delay = Duration(seconds: delay.inSeconds + 1);
      }
      await _loadPhotos();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = 'face';
      });
      _toast(ApiService.errorMessage(e) ?? 'Face scan failed — try a clear selfie');
    }
  }

  Future<void> _loadPhotos() async {
    if (_guestToken == null) return;
    setState(() {
      _busy = true;
      _step = 'photos';
    });
    try {
      final data = await ApiService.guestPhotos(_guestToken!);
      if (data['needsFace'] == true && _faceEnabled && data['fullAccess'] != true) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _step = 'face';
          _photos = [];
          _hasFullAccessCode = data['hasFullAccessCode'] == true || _hasFullAccessCode;
        });
        _toast('Complete the face scan to see your photos');
        return;
      }
      final list = (data['photos'] as List? ?? [])
          .map((j) => Photo.fromJson(Map<String, dynamic>.from(j as Map)))
          .toList();
      if (!mounted) return;
      setState(() {
        _photos = list;
        _busy = false;
        _step = 'photos';
        _fullAccess = data['fullAccess'] == true;
        _hasFullAccessCode = data['hasFullAccessCode'] == true || _hasFullAccessCode;
        if (data.containsKey('downloadsAllowed')) {
          _downloadsAllowed = data['downloadsAllowed'] == true;
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(ApiService.errorMessage(e) ?? 'Could not load photos');
    }
  }

  Future<void> _unlockFullAccess() async {
    final code = _fullAccessCtrl.text.trim();
    if (code.isEmpty || _guestToken == null) {
      _toast('Enter the full access code from the studio');
      return;
    }
    setState(() => _busy = true);
    try {
      await ApiService.guestFullAccess(guestAccessToken: _guestToken!, code: code);
      if (!mounted) return;
      setState(() {
        _fullAccess = true;
        _busy = false;
      });
      _toast('Full gallery unlocked');
      await _loadPhotos();
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(ApiService.errorMessage(e) ?? 'Incorrect code');
    }
  }

  Future<void> _promptFullAccess() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Full access', style: AppTheme.display(22)),
              const SizedBox(height: 8),
              Text(
                'Enter the code from the studio to view the entire gallery (not only face matches).',
                style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _fullAccessCtrl,
                decoration: const InputDecoration(
                  labelText: 'Access code',
                  border: OutlineInputBorder(),
                ),
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _unlockFullAccess().then((_) {
                  if (mounted && ctx.mounted && _fullAccess) Navigator.of(ctx).pop();
                }),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () async {
                  await _unlockFullAccess();
                  if (mounted && ctx.mounted && _fullAccess) Navigator.of(ctx).pop();
                },
                style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                child: const Text('Unlock full gallery'),
              ),
            ],
          ),
        );
      },
    );
  }

  void _toast(String m) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(m), backgroundColor: AppColors.text(context)),
    );
  }

  String _money(dynamic n) {
    final v = n is num ? n.toDouble() : double.tryParse('$n');
    if (v == null) return '';
    final s = v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(0);
    return '₹$s';
  }

  void _openStudioSheet() {
    final studio = _studio;
    final packages = _packages;
    final portfolio = _portfolio
        .where((p) => p is Map && p['coverUrl'] != null)
        .map((p) => Map<String, dynamic>.from(p as Map))
        .toList();
    final name = (studio?['name'] ?? 'Studio').toString();
    final tagline = (studio?['tagline']?.toString() ?? '').trim();
    final about = (studio?['about']?.toString() ?? '').trim();
    final logoUrl = studio?['logoUrl']?.toString();
    final coverUrl = studio?['coverUrl']?.toString();
    final phone = studio?['phone']?.toString();
    final whatsapp = studio?['whatsapp']?.toString();
    final instagram = studio?['instagram']?.toString();
    final website = studio?['website']?.toString();
    final initials = name
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0].toUpperCase())
        .join();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.48),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.82,
          minChildSize: 0.42,
          maxChildSize: 0.94,
          expand: false,
          builder: (ctx, scrollCtrl) {
            return Container(
              decoration: BoxDecoration(
                color: AppColors.bg(context),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
                boxShadow: const [BoxShadow(color: Color(0x38000000), blurRadius: 24, offset: Offset(0, -6))],
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 10, 12),
                    child: Column(
                      children: [
                        Container(
                          width: 36,
                          height: 4,
                          decoration: BoxDecoration(
                            color: const Color(0xFFD8D2C6),
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            if (logoUrl != null && logoUrl.isNotEmpty)
                              ClipRRect(
                                borderRadius: BorderRadius.circular(12),
                                child: CachedNetworkImage(
                                  imageUrl: logoUrl,
                                  width: 42,
                                  height: 42,
                                  fit: BoxFit.cover,
                                  errorWidget: (_, __, ___) => _logoFallback(initials),
                                ),
                              )
                            else
                              _logoFallback(initials.isEmpty ? 'S' : initials),
                            const SizedBox(width: 11),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: -0.3),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    tagline.isNotEmpty ? tagline : 'Photography studio',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(color: AppColors.text3(context), fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              onPressed: () => Navigator.pop(ctx),
                              style: IconButton.styleFrom(
                                backgroundColor: AppColors.sunken(context),
                                foregroundColor: AppColors.text2(context),
                                fixedSize: const Size(34, 34),
                                padding: EdgeInsets.zero,
                              ),
                              icon: const Icon(Icons.close_rounded, size: 18),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: AppColors.border(context)),
                  Expanded(
                    child: ListView(
                      controller: scrollCtrl,
                      padding: const EdgeInsets.only(bottom: 28),
                      children: [
                        if (coverUrl != null && coverUrl.isNotEmpty)
                          SizedBox(
                            height: 120,
                            width: double.infinity,
                            child: CachedNetworkImage(imageUrl: coverUrl, fit: BoxFit.cover),
                          ),
                        if (about.isNotEmpty) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
                            child: Text('ABOUT', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppColors.accent(context))),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 18),
                            child: Text(about, style: TextStyle(color: AppColors.text2(context), fontSize: 13.5, height: 1.55)),
                          ),
                        ],
                        if (packages.isNotEmpty) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
                            child: Text('PACKAGES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppColors.accent(context))),
                          ),
                          ...packages.map((raw) {
                            final p = Map<String, dynamic>.from(raw as Map);
                            final price = p['discountPrice'] ?? p['price'];
                            final hasDisc = p['discountPrice'] != null && p['price'] != null;
                            final features = (p['features'] as List?) ?? const [];
                            final cover = p['coverUrl']?.toString();
                            return Container(
                              margin: const EdgeInsets.fromLTRB(18, 0, 18, 10),
                              decoration: BoxDecoration(
                                color: AppColors.card(context),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppColors.border(context)),
                                boxShadow: const [BoxShadow(color: Color(0x0A1A1917), blurRadius: 10, offset: Offset(0, 2))],
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  if (cover != null && cover.isNotEmpty)
                                    SizedBox(
                                      height: 96,
                                      child: CachedNetworkImage(imageUrl: cover, fit: BoxFit.cover),
                                    ),
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                p['title']?.toString() ?? 'Package',
                                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, letterSpacing: -0.2),
                                              ),
                                            ),
                                            if (price != null)
                                              Text.rich(
                                                TextSpan(
                                                  children: [
                                                    if (hasDisc)
                                                      TextSpan(
                                                        text: '${_money(p['price'])} ',
                                                        style: TextStyle(
                                                          decoration: TextDecoration.lineThrough,
                                                          color: AppColors.text3(context),
                                                          fontSize: 11.5,
                                                          fontWeight: FontWeight.w500,
                                                        ),
                                                      ),
                                                    TextSpan(
                                                      text: p['priceLabel']?.toString() ??
                                                          '${_money(price)} onwards',
                                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                          ],
                                        ),
                                        if (p['isFeatured'] == true) ...[
                                          const SizedBox(height: 8),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(
                                              color: AppColors.accent(context).withValues(alpha: 0.12),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(
                                              'FEATURED',
                                              style: TextStyle(color: AppColors.accent(context), fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.7),
                                            ),
                                          ),
                                        ],
                                        if ((p['description']?.toString() ?? '').isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                            p['description'].toString(),
                                            maxLines: 3,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(color: AppColors.text2(context), fontSize: 12.5, height: 1.45),
                                          ),
                                        ],
                                        if (features.isNotEmpty) ...[
                                          const SizedBox(height: 10),
                                          ...features.take(5).map((f) {
                                            final t = f is Map ? (f['title']?.toString() ?? '') : f.toString();
                                            if (t.isEmpty) return const SizedBox.shrink();
                                            return Padding(
                                              padding: const EdgeInsets.only(bottom: 4),
                                              child: Row(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Container(
                                                    width: 5,
                                                    height: 5,
                                                    margin: const EdgeInsets.only(top: 6, right: 8),
                                                    decoration: BoxDecoration(color: AppColors.accent(context), shape: BoxShape.circle),
                                                  ),
                                                  Expanded(child: Text(t, style: TextStyle(color: AppColors.text2(context), fontSize: 12.5, height: 1.4))),
                                                ],
                                              ),
                                            );
                                          }),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }),
                        ],
                        if (portfolio.isNotEmpty) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(18, 10, 18, 10),
                            child: Text('OUR WORK', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppColors.accent(context))),
                          ),
                          SizedBox(
                            height: 160,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(horizontal: 18),
                              itemCount: portfolio.length.clamp(0, 12),
                              separatorBuilder: (_, __) => const SizedBox(width: 8),
                              itemBuilder: (_, i) {
                                final item = Map<String, dynamic>.from(portfolio[i] as Map);
                                final url = item['coverUrl'] as String?;
                                if (url == null || url.isEmpty) return const SizedBox.shrink();
                                final media = (item['media'] as List?) ?? const [];
                                final count = (item['mediaCount'] as num?)?.toInt()
                                    ?? (media.isNotEmpty ? media.length : 1);
                                return GestureDetector(
                                  onTap: () => _openPortfolioWork(item),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(12),
                                    child: AspectRatio(
                                      aspectRatio: 4 / 5,
                                      child: Stack(
                                        fit: StackFit.expand,
                                        children: [
                                          CachedNetworkImage(imageUrl: url, fit: BoxFit.cover),
                                          if (count > 1)
                                            Positioned(
                                              top: 6,
                                              right: 6,
                                              child: Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: Colors.black.withValues(alpha: 0.55),
                                                  borderRadius: BorderRadius.circular(12),
                                                ),
                                                child: Text(
                                                  '$count',
                                                  style: const TextStyle(
                                                    color: Colors.white,
                                                    fontSize: 11,
                                                    fontWeight: FontWeight.w700,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          Positioned(
                                            left: 6,
                                            right: 6,
                                            bottom: 6,
                                            child: Text(
                                              item['title']?.toString() ?? '',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 11,
                                                fontWeight: FontWeight.w600,
                                                shadows: [Shadow(blurRadius: 6)],
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ],
                        if ([phone, whatsapp, instagram, website].any((s) => s != null && s.isNotEmpty)) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
                            child: Text('GET IN TOUCH', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppColors.accent(context))),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 18),
                            child: Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (phone != null && phone.isNotEmpty)
                                  _contactChip(Icons.phone_outlined, 'Call', 'tel:${phone.replaceAll(RegExp(r'\s+'), '')}'),
                                if (whatsapp != null && whatsapp.isNotEmpty)
                                  _contactChip(Icons.chat_outlined, 'WhatsApp', 'https://wa.me/${whatsapp.replaceAll(RegExp(r'\D'), '')}'),
                                if (instagram != null && instagram.isNotEmpty)
                                  _contactChip(
                                    Icons.camera_alt_outlined,
                                    'Instagram',
                                    instagram.startsWith('http')
                                        ? instagram
                                        : 'https://instagram.com/${instagram.replaceFirst(RegExp(r'^@'), '')}',
                                  ),
                                if (website != null && website.isNotEmpty)
                                  _contactChip(
                                    Icons.language_rounded,
                                    'Website',
                                    website.startsWith('http') ? website : 'https://$website',
                                  ),
                              ],
                            ),
                          ),
                        ],
                        if (about.isEmpty &&
                            packages.isEmpty &&
                            portfolio.isEmpty &&
                            [phone, whatsapp, instagram, website].every((s) => s == null || s.isEmpty))
                          Padding(
                            padding: const EdgeInsets.fromLTRB(18, 36, 18, 12),
                            child: Text(
                              'Studio details coming soon.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: AppColors.text3(context), fontSize: 13),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _logoFallback(String initials) {
    return Container(
      width: 42,
      height: 42,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF4EFE6), Color(0xFFE8DFD0)],
        ),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Text(
        initials,
        style: TextStyle(color: AppColors.accent(context), fontWeight: FontWeight.w700, fontSize: 14),
      ),
    );
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {}
  }

  Widget _contactChip(IconData icon, String label, String url) {
    return ActionChip(
      avatar: Icon(icon, size: 16, color: AppColors.text(context)),
      label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      backgroundColor: AppColors.card(context),
      side: BorderSide(color: AppColors.border(context)),
      onPressed: () => _openUrl(url),
    );
  }

  Widget _knowMoreButton() {
    return TextButton(
      onPressed: _openStudioSheet,
      style: TextButton.styleFrom(
        foregroundColor: AppColors.accent(context),
        padding: const EdgeInsets.symmetric(vertical: 8),
        minimumSize: const Size.fromHeight(36),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      child: const Text(
        'Know more about studio ›',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        backgroundColor: AppColors.bg(context),
        automaticallyImplyLeading: false,
        title: Text(
          (_gallery?['name'] ?? _studio?['name'] ?? 'Gallery').toString().toUpperCase(),
          style: AppTheme.kicker(),
        ),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context)))
          : _error != null
              ? _errorBody()
              : ListView(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 40),
                  children: [
                    _galleryHero(),
                    const SizedBox(height: 16),
                    _galleryTab(),
                  ],
                ),
    );
  }

  Widget _galleryHero() {
    final cover = _gallery?['coverPhotoUrl'] as String?;
    final name = _gallery?['name']?.toString() ?? 'Shared gallery';
    final desc = _gallery?['description']?.toString();
    final count = _gallery?['photoCount'];
    final eventDate = _gallery?['eventDate'];
    String? dateLabel;
    if (eventDate != null) {
      final d = DateTime.tryParse(eventDate.toString())?.toLocal();
      if (d != null) {
        dateLabel = '${d.day}/${d.month}/${d.year}';
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: AspectRatio(
            aspectRatio: 16 / 10,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (cover != null && cover.isNotEmpty)
                  CachedNetworkImage(imageUrl: cover, fit: BoxFit.cover)
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
                      colors: [Colors.transparent, Colors.black.withValues(alpha: 0.55)],
                    ),
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 14,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: AppTheme.display(24, color: Colors.white)),
                      if (dateLabel != null || count != null)
                        Text(
                          [
                            if (dateLabel != null) dateLabel,
                            if (count != null) '$count photos',
                          ].join(' · '),
                          style: const TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (desc != null && desc.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(desc, style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13)),
        ],
      ],
    );
  }

  Widget _galleryTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _stepChips(),
        const SizedBox(height: 16),
        if (_step == 'details') _detailsCard(),
        if (_step == 'face') _faceCard(),
        if (_step == 'searching') _searchingCard(),
        if (_step == 'photos') _photosSection(),
      ],
    );
  }

  Widget _stepChips() {
    final labels = _faceEnabled
        ? const ['Details', 'Face', 'Photos']
        : const ['Details', 'Photos'];
    int active = 0;
    if (_step == 'face' || _step == 'searching') active = 1;
    if (_step == 'photos') active = _faceEnabled ? 2 : 1;
    return Row(
      children: List.generate(labels.length, (i) {
        final on = i <= active;
        return Expanded(
          child: Container(
            margin: EdgeInsets.only(right: i < labels.length - 1 ? 6 : 0),
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              color: on ? AppColors.text(context) : AppColors.card(context),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: on ? AppColors.text(context) : AppColors.border(context)),
            ),
            child: Text(
              '${i + 1}. ${labels[i]}',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: on ? Colors.white : AppColors.text3(context),
              ),
            ),
          ),
        );
      }),
    );
  }

  Widget _detailsCard() => _card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Your details', style: AppTheme.display(20)),
            const SizedBox(height: 6),
            Text(
              'Name and phone only — no email or password. Use a WhatsApp-capable number so the studio can greet you.',
              style: TextStyle(color: AppColors.text3(context), fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _nameCtrl,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Full name', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submitDetails(),
              decoration: const InputDecoration(
                labelText: 'Mobile (WhatsApp)',
                hintText: '10-digit or +91…',
                border: OutlineInputBorder(),
                helperText: 'Indian numbers: 10 digits is fine — we add 91 automatically',
              ),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _submitDetails,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.text(context),
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
              child: Text(
                _busy ? 'Please wait…' : (_faceEnabled ? 'Next — face scan' : 'View photos'),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 4),
            _knowMoreButton(),
          ],
        ),
      );

  Widget _faceCard() => _card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Face scan', style: AppTheme.display(20)),
            const SizedBox(height: 8),
            Text(
              'Hi ${_guestName ?? ''}. A clear selfie (only you) finds photos of you in this gallery. View only — no likes.',
              style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 13),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _busy ? null : () => _runFaceScan(ImageSource.camera),
              icon: const Icon(Icons.photo_camera_outlined, size: 18),
              label: const Text('Take selfie'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.text(context),
                padding: const EdgeInsets.symmetric(vertical: 15),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _busy ? null : () => _runFaceScan(ImageSource.gallery),
              icon: const Icon(Icons.photo_library_outlined, size: 18),
              label: const Text('Upload selfie'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.text(context),
                side: BorderSide(color: AppColors.border(context)),
                padding: const EdgeInsets.symmetric(vertical: 13),
              ),
            ),
          ],
        ),
      );

  Widget _searchingCard() => _card(
        child: Column(
          children: [
            CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context)),
            const SizedBox(height: 14),
            Text(
              _statusMessage.isEmpty ? 'Working…' : _statusMessage,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.text2(context)),
            ),
          ],
        ),
      );

  Widget _photosSection() {
    final photos = _photos.where((p) => !p.isVideo).toList();
    final videos = _photos.where((p) => p.isVideo).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _fullAccess
              ? 'Full gallery'
              : (_guestName != null ? 'Photos of $_guestName' : 'Your photos'),
          style: AppTheme.display(20),
        ),
        const SizedBox(height: 4),
        Text(
          _fullAccess
              ? (_downloadsAllowed
                  ? 'Full access unlocked · tap a photo to download'
                  : 'Full access unlocked · view only')
              : (_downloadsAllowed
                  ? 'Face matches · tap a photo to view or download.'
                  : 'Face matches · view only.'),
          style: TextStyle(color: AppColors.text3(context), fontSize: 12),
        ),
        if (_hasFullAccessCode && !_fullAccess) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: _promptFullAccess,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.accent(context),
                padding: EdgeInsets.zero,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
              child: const Text('Full access'),
            ),
          ),
        ],
        const SizedBox(height: 12),
        if (_busy && _photos.isEmpty)
          Padding(
            padding: const EdgeInsets.all(28),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context))),
          )
        else if (_photos.isEmpty)
          _card(
            child: Column(
              children: [
                const Text('No matched photos yet', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Text(
                  'Try another selfie with good light and only your face.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.text2(context), fontSize: 13, height: 1.4),
                ),
                if (_faceEnabled) ...[
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () => setState(() => _step = 'face'),
                    style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                    child: const Text('Scan face again'),
                  ),
                ],
                if (_hasFullAccessCode && !_fullAccess) ...[
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _promptFullAccess,
                    child: const Text('Have a full access code?'),
                  ),
                ],
              ],
            ),
          )
        else ...[
          if (photos.isNotEmpty) ...[
            const Text('Photos', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: photos.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 4,
                crossAxisSpacing: 4,
              ),
              itemBuilder: (_, i) {
                final p = photos[i];
                return GestureDetector(
                  onTap: () => _openViewer(photos, i),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: p.thumbnailUrl != null
                        ? CachedNetworkImage(imageUrl: p.thumbnailUrl!, fit: BoxFit.cover)
                        : Container(color: AppColors.sunken(context)),
                  ),
                );
              },
            ),
          ],
          if (videos.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Text('Videos', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: videos.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 4,
                crossAxisSpacing: 4,
              ),
              itemBuilder: (_, i) {
                final p = videos[i];
                return GestureDetector(
                  onTap: () => _openViewer(videos, i),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        p.thumbnailUrl != null
                            ? CachedNetworkImage(imageUrl: p.thumbnailUrl!, fit: BoxFit.cover)
                            : Container(color: AppColors.sunken(context)),
                        const Center(
                          child: Icon(Icons.play_circle_fill, color: Colors.white70, size: 32),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ],
        ],
        if (_photos.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            '${_photos.length} item${_photos.length == 1 ? '' : 's'} · tap to view',
            style: TextStyle(color: AppColors.text3(context), fontSize: 12),
          ),
          if (_faceEnabled && !_fullAccess)
            TextButton(
              onPressed: () => setState(() => _step = 'face'),
              child: const Text('Scan face again'),
            ),
        ],
        if (!(_busy && _photos.isEmpty)) ...[
          const SizedBox(height: 4),
          _knowMoreButton(),
        ],
      ],
    );
  }

  Future<void> _openViewer(List<Photo> list, int index) async {
    if (list.isEmpty || index < 0 || index >= list.length) return;
    await Navigator.of(context).push(
      PageRouteBuilder(
        opaque: true,
        barrierColor: Colors.black,
        transitionDuration: const Duration(milliseconds: 200),
        pageBuilder: (_, anim, __) => FadeTransition(
          opacity: anim,
          child: _GuestPreviewPage(
            photos: list,
            initialIndex: index,
            downloadsAllowed: _downloadsAllowed,
            guestToken: _guestToken,
          ),
        ),
      ),
    );
  }

  Widget _card({required Widget child}) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: child,
      );

  Widget _errorBody() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.link_off_rounded, size: 40, color: AppColors.text3(context)),
              const SizedBox(height: 12),
              Text('Link invalid or expired', style: AppTheme.display(22), textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: AppColors.text2(context))),
              TextButton(onPressed: _loadPreview, child: const Text('Retry')),
            ],
          ),
        ),
      );
}

/// Full-screen guest preview — Close + Download always hittable.
class _GuestPreviewPage extends StatefulWidget {
  final List<Photo> photos;
  final int initialIndex;
  final bool downloadsAllowed;
  final String? guestToken;

  const _GuestPreviewPage({
    required this.photos,
    required this.initialIndex,
    required this.downloadsAllowed,
    this.guestToken,
  });

  @override
  State<_GuestPreviewPage> createState() => _GuestPreviewPageState();
}

class _GuestPreviewPageState extends State<_GuestPreviewPage> {
  late int _index;
  late PageController _page;
  late List<Photo> _photos;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _photos = List<Photo>.from(widget.photos);
    _index = widget.initialIndex.clamp(0, _photos.isEmpty ? 0 : _photos.length - 1);
    _page = PageController(initialPage: _index);
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  }

  @override
  void dispose() {
    _page.dispose();
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark);
    super.dispose();
  }

  Photo get _current => _photos[_index];

  void _close() {
    if (mounted) Navigator.of(context).pop();
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _download() async {
    if (!widget.downloadsAllowed) {
      _snack('Downloads are locked on this gallery.');
      return;
    }
    setState(() => _downloading = true);
    try {
      var url = _current.downloadUrl;
      if ((url == null || url.isEmpty) && widget.guestToken != null) {
        url = await ApiService.getGuestPhotoDownloadUrl(
          guestAccessToken: widget.guestToken!,
          photoId: _current.id,
        );
        final i = _photos.indexWhere((p) => p.id == _current.id);
        if (i >= 0 && url.isNotEmpty && mounted) {
          setState(() {
            _photos[i] = _photos[i].copyWith(downloadUrl: url, downloadAvailable: true);
          });
        }
      }
      if (url == null || url.isEmpty) {
        throw StateError('Original file is not ready for download yet.');
      }
      await DownloadService.downloadPhoto(
        url: url,
        filename: _current.filename.isNotEmpty
            ? _current.filename
            : (_current.isVideo ? 'video.mp4' : 'photo.jpg'),
        expectedBytes: _current.fileSize,
      );
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
            child: TextButton(onPressed: _close, child: const Text('Close', style: TextStyle(color: Colors.white))),
          ),
        ),
      );
    }

    return PopScope(
      canPop: true,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            PageView.builder(
              controller: _page,
              physics: const BouncingScrollPhysics(),
              itemCount: _photos.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (ctx, i) {
                final p = _photos[i];
                final stream = p.streamUrl ?? p.downloadUrl;
                if (p.isVideo && stream != null && stream.isNotEmpty) {
                  return Center(
                    child: GalleryVideoPlayer(
                      key: ValueKey('gvid-${p.id}'),
                      url: stream,
                      posterUrl: p.previewUrl ?? p.thumbnailUrl,
                      title: p.filename,
                      autoPlay: i == _index,
                    ),
                  );
                }
                final img = p.previewUrl ?? p.thumbnailUrl ?? '';
                if (img.isEmpty) {
                  return const Center(
                    child: Icon(Icons.broken_image_outlined, color: Colors.white38, size: 40),
                  );
                }
                return PhotoView(
                  imageProvider: CachedNetworkImageProvider(img),
                  minScale: PhotoViewComputedScale.contained,
                  maxScale: PhotoViewComputedScale.covered * 4,
                  initialScale: PhotoViewComputedScale.contained,
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
                            onPressed: _close,
                            tooltip: 'Close',
                          ),
                          Expanded(
                            child: Text(
                              '${_index + 1} of ${_photos.length}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                            ),
                          ),
                          const SizedBox(width: 52),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
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
                      padding: const EdgeInsets.fromLTRB(16, 24, 16, 14),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          if (widget.downloadsAllowed)
                            TextButton.icon(
                              onPressed: _downloading ? null : _download,
                              icon: Icon(
                                _downloading ? Icons.hourglass_top_rounded : Icons.download_rounded,
                                color: Colors.white,
                              ),
                              label: Text(
                                _downloading ? 'Saving…' : 'Download',
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                              ),
                            ),
                          TextButton.icon(
                            onPressed: _close,
                            icon: const Icon(Icons.close_rounded, color: Colors.white70),
                            label: const Text(
                              'Close',
                              style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                            ),
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
}
