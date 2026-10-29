import '../widgets/app_back_button.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/booking_sheet.dart';
import '../widgets/premium_ui.dart';
import '../widgets/share_link_button.dart';

class PackagesScreen extends StatefulWidget {
  final String? highlightId;
  const PackagesScreen({super.key, this.highlightId});
  @override
  State<PackagesScreen> createState() => _PackagesScreenState();
}

class _PackagesScreenState extends State<PackagesScreen> {
  List<dynamic> _packages = [];
  bool _loading = true;
  String? _loadError;
  final _couponCtrl = TextEditingController();
  String? _couponMsg;
  Map<String, dynamic>? _couponResult;
  final Set<String> _expanded = {};

  @override
  void initState() {
    super.initState();
    if (widget.highlightId != null) _expanded.add(widget.highlightId!);
    _load();
  }

  @override
  void dispose() {
    _couponCtrl.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (force || _packages.isEmpty) {
      setState(() {
        _loading = _packages.isEmpty;
        _loadError = null;
      });
    }
    try {
      final list = await PortalApi.packages(force: force);
      if (mounted) {
        setState(() {
          _packages = list;
          _loading = false;
          _loadError = null;
        });
      }
      if (!force) {
        PortalApi.packages(force: true).then((fresh) {
          if (mounted) setState(() => _packages = fresh);
        }).catchError((_) {});
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          if (_packages.isEmpty) {
            _loadError = 'Could not load packages. Check your connection and try again.';
          }
        });
      }
    }
  }

  Future<void> _validateCoupon([String? packageId, num? amount]) async {
    final code = _couponCtrl.text.trim();
    if (code.length < 2) {
      setState(() {
        _couponMsg = 'Enter a coupon code';
        _couponResult = null;
      });
      return;
    }
    try {
      final r = await PortalApi.validateCoupon(
        code: code,
        packageId: packageId,
        orderAmount: amount,
      );
      if (!mounted) return;
      setState(() {
        _couponResult = r;
        _couponMsg =
            'Valid — save ${r['discountAmount']} (final ${r['finalAmount']})';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _couponResult = null;
        _couponMsg = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  bool _isWeddingPackage(Map p) {
    final title = '${p['title'] ?? ''} ${p['name'] ?? ''} ${p['description'] ?? ''}';
    return RegExp(r'wedding|marriage|bridal', caseSensitive: false).hasMatch(title);
  }

  List<dynamic> get _sortedPackages {
    if (widget.highlightId != null) return _packages.where((p) => p['id'] == widget.highlightId).toList();
    final wedding = _packages.where((p) => p is Map && _isWeddingPackage(Map<String, dynamic>.from(p))).toList();
    final rest = _packages.where((p) => p is Map && !_isWeddingPackage(Map<String, dynamic>.from(p))).toList();
    return [...wedding, ...rest];
  }

  Future<void> _openFlow(Map p, String source) async {
    final code = _couponCtrl.text.trim();
    final sent = await BookingSheet.open(
      context,
      package: Map<String, dynamic>.from(p),
      source: source,
      couponCode: code.isNotEmpty ? code : null,
    );
    if (sent == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            source.toUpperCase() == 'BOOK'
                ? 'Request sent — studio will confirm your slot'
                : 'Enquiry sent to the studio',
          ),
          action: SnackBarAction(
            label: 'View status',
            onPressed: () => context.push('/booking'),
          ),
        ),
      );
    }
  }

  Widget _weddingHero() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.card(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Wedding', style: AppTheme.display(22)),
          const SizedBox(height: 6),
          Text(
            'Photography and film for your days — dates, venue, coverage, and budget. Send an inquiry and the studio replies with a quote.',
            style: TextStyle(color: AppColors.text2(context), fontSize: 13.5, height: 1.4),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            height: 46,
            child: FilledButton(
              onPressed: () {
                Haptics.medium();
                context.push('/wedding-inquiry');
              },
              style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
              child: const Text('Inquire now', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(leading: const AppBackButton(),
        title: Text('Services', style: AppTheme.display(22)),
        backgroundColor: AppColors.bg(context),
        automaticallyImplyLeading: true,
        actions: [ShareLinkButton(path: widget.highlightId == null ? '/packages' : '/packages?id=${widget.highlightId}')],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.text(context), strokeWidth: 2))
          : RefreshIndicator(
              onRefresh: _load,
              child: _sortedPackages.isEmpty
                  ? ListView(children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                        child: _weddingHero(),
                      ),
                      const SizedBox(height: 48),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                        child: Column(
                          children: [
                            Text(
                              _loadError ?? (widget.highlightId != null ? 'This package is no longer available.' : 'No packages yet'),
                              textAlign: TextAlign.center,
                              style: TextStyle(color: AppColors.text2(context), height: 1.4),
                            ),
                            if (_loadError != null) ...[
                              const SizedBox(height: 16),
                              FilledButton(
                                onPressed: () => _load(force: true),
                                style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                                child: const Text('Try again'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ])
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xs, AppSpace.page, AppSpace.bottomNav),
                      itemCount: _sortedPackages.length + 2,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpace.sm),
                      itemBuilder: (_, i) {
                        if (i == 0) return _weddingHero();
                        if (i == 1) {
                          return Container(
                            padding: const EdgeInsets.all(AppSpace.sm),
                            decoration: BoxDecoration(
                              color: AppColors.card(context),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppColors.border(context)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text('Have a coupon?', style: AppTheme.display(16)),
                                const SizedBox(height: AppSpace.xs),
                                Row(
                                  children: [
                                    Expanded(
                                      child: TextField(
                                        controller: _couponCtrl,
                                        textCapitalization: TextCapitalization.characters,
                                        decoration: const InputDecoration(
                                          hintText: 'Enter code',
                                          border: OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    FilledButton(
                                      onPressed: () => _validateCoupon(),
                                      style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                                      child: const Text('Apply'),
                                    ),
                                  ],
                                ),
                                if (_couponMsg != null) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    _couponMsg!,
                                    style: TextStyle(
                                      color: _couponResult != null ? AppColors.green : AppColors.rose,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          );
                        }
                        final p = Map<String, dynamic>.from(_sortedPackages[i - 2] as Map);
                        final weddingPkg = _isWeddingPackage(p);
                        final id = p['id']?.toString() ?? '$i';
                        final rawPrice = p['discountPrice'] ?? p['price'] ?? 0;
                        final priceNum = rawPrice is num ? rawPrice.toDouble() : double.tryParse('$rawPrice') ?? 0;
                        final features = (p['features'] as List?) ?? [];
                        final expanded = _expanded.contains(id);
                        final showFeatures = expanded ? features : features.take(3).toList();
                        return TweenAnimationBuilder<double>(
                          tween: Tween(begin: 0, end: 1),
                          duration: Duration(milliseconds: 220 + i * 40),
                          curve: AppMotion.spring,
                          builder: (_, v, child) => Opacity(
                            opacity: v,
                            child: Transform.translate(offset: Offset(0, 10 * (1 - v)), child: child),
                          ),
                          child: PremiumCard(
                            padding: EdgeInsets.zero,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (p['coverUrl'] != null)
                                  AspectRatio(
                                    aspectRatio: 16 / 10,
                                    child: CachedNetworkImage(
                                      imageUrl: p['coverUrl'] as String,
                                      fit: BoxFit.cover,
                                      memCacheWidth: 900,
                                      fadeInDuration: const Duration(milliseconds: 120),
                                      placeholder: (_, __) => Container(color: AppColors.sunken(context)),
                                    ),
                                  ),
                                Padding(
                                  padding: const EdgeInsets.all(AppSpace.md),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(child: Text(p['title']?.toString() ?? '', style: AppTheme.display(20))),
                                          ShareLinkButton(path: '/packages?id=$id', title: 'Share package'),
                                          if (p['isFeatured'] == true)
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: AppColors.accent(context).withValues(alpha: 0.12),
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: Text('Featured', style: TextStyle(color: AppColors.accent(context), fontSize: 11, fontWeight: FontWeight.w600)),
                                            ),
                                        ],
                                      ),
                                      if (p['description'] != null) ...[
                                        const SizedBox(height: AppSpace.xs),
                                        Text(p['description'].toString(), style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13)),
                                      ],
                                      if (features.isNotEmpty) ...[
                                        const SizedBox(height: AppSpace.sm),
                                        AnimatedSize(
                                          duration: AppMotion.med,
                                          curve: AppMotion.soft,
                                          alignment: Alignment.topCenter,
                                          child: Column(
                                            children: [
                                              ...showFeatures.map((f) => Padding(
                                                    padding: const EdgeInsets.only(bottom: 4),
                                                    child: Row(
                                                      children: [
                                                        const Icon(Icons.check_rounded, size: 16, color: AppColors.green),
                                                        const SizedBox(width: 8),
                                                        Expanded(
                                                          child: Text(
                                                            (f is Map ? f['title'] : f)?.toString() ?? '',
                                                            style: const TextStyle(fontSize: 13),
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                  )),
                                              if (features.length > 3)
                                                TextButton(
                                                  onPressed: () {
                                                    Haptics.selection();
                                                    setState(() {
                                                      if (expanded) {
                                                        _expanded.remove(id);
                                                      } else {
                                                        _expanded.add(id);
                                                      }
                                                    });
                                                  },
                                                  child: Text(
                                                    expanded ? 'Show less' : 'View all ${features.length} details',
                                                    style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.accent(context)),
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ),
                                      ],
                                      const SizedBox(height: AppSpace.sm),
                                      Row(
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          Text(
                                            (p['priceLabel']?.toString().trim().isNotEmpty == true)
                                                ? p['priceLabel'].toString()
                                                : (priceNum > 0 ? '₹${priceNum.toStringAsFixed(0)} onwards' : 'Contact for price'),
                                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                                          ),
                                          if (p['discountPrice'] != null && priceNum > 0) ...[
                                            const SizedBox(width: 8),
                                            Text(
                                              '₹${p['price']}',
                                              style: TextStyle(
                                                decoration: TextDecoration.lineThrough,
                                                color: AppColors.text3(context),
                                                fontSize: 13,
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                      const SizedBox(height: AppSpace.sm),
                                      if (weddingPkg)
                                        SizedBox(
                                          width: double.infinity,
                                          child: FilledButton(
                                            onPressed: () {
                                              Haptics.medium();
                                              context.push('/wedding-inquiry');
                                            },
                                            style: FilledButton.styleFrom(
                                              backgroundColor: AppColors.text(context),
                                              padding: const EdgeInsets.symmetric(vertical: 12),
                                            ),
                                            child: const Text('Inquire now'),
                                          ),
                                        )
                                      else
                                        Row(
                                          children: [
                                            Expanded(
                                              child: OutlinedButton(
                                                onPressed: () {
                                                  Haptics.light();
                                                  _openFlow(p, 'ENQUIRE');
                                                },
                                                style: OutlinedButton.styleFrom(
                                                  foregroundColor: AppColors.text(context),
                                                  side: BorderSide(color: AppColors.border(context)),
                                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                                ),
                                                child: const Text('Enquire'),
                                              ),
                                            ),
                                            const SizedBox(width: AppSpace.xs),
                                            Expanded(
                                              child: FilledButton(
                                                onPressed: () {
                                                  Haptics.medium();
                                                  _openFlow(p, 'BOOK');
                                                },
                                                style: FilledButton.styleFrom(
                                                  backgroundColor: AppColors.text(context),
                                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                                ),
                                                child: const Text('Book now'),
                                              ),
                                            ),
                                          ],
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
