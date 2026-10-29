import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/studio_branding.dart';

/// Customer account + studio branding. Optimised for signed-in clients only.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  Map<String, dynamic>? _profile;
  Map<String, dynamic>? _studio;
  bool _loading = true;
  bool _editing = false;
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final bundle = await PortalApi.profileBundle();
      if (!mounted) return;
      final p = Map<String, dynamic>.from(bundle['profile'] as Map? ?? {});
      Map<String, dynamic>? studio;
      if (bundle['studio'] is Map) {
        studio = Map<String, dynamic>.from(bundle['studio'] as Map);
      }
      // Fallback contact if studio missing
      if (studio == null || (studio['displayName'] == null && studio['logoUrl'] == null)) {
        try {
          final c = await PortalApi.contact();
          if (c.isNotEmpty) studio = c;
        } catch (_) {}
      }
      setState(() {
        _profile = p;
        _studio = studio;
        _nameCtrl.text = p['name']?.toString() ?? '';
        _phoneCtrl.text = p['phone']?.toString() ?? '';
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await PortalApi.updateProfile(
        name: _nameCtrl.text.trim(),
        phone: _phoneCtrl.text.trim(),
      );
      await ref.read(authStateProvider.notifier).refresh();
      await _load();
      if (mounted) {
        setState(() => _editing = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Profile updated'),
            backgroundColor: AppColors.text(context),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not save: $e'), backgroundColor: AppColors.rose),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _fmtDate(dynamic v) {
    if (v == null) return '—';
    final d = DateTime.tryParse(v.toString())?.toLocal();
    if (d == null) return '—';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  String _fmtBooking(String? s) {
    if (s == null || s.isEmpty) return '—';
    return s.replaceAll('_', ' ').toLowerCase().split(' ').map((w) {
      if (w.isEmpty) return w;
      return '${w[0].toUpperCase()}${w.substring(1)}';
    }).join(' ');
  }

  String _money(dynamic n, [String currency = 'INR']) {
    if (n == null) return '—';
    final v = n is num ? n.toDouble() : double.tryParse('$n') ?? 0;
    final s = v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(0);
    return '$currency $s';
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider).value;
    final p = _profile;
    final name = p?['name']?.toString() ?? auth?.name ?? '';
    final phone = p?['phone']?.toString() ?? auth?.phone ?? '';
    final initial = name.isNotEmpty ? name.characters.first.toUpperCase() : '?';
    final studioName = _studio?['displayName']?.toString() ?? auth?.studio?.name ?? 'Studio';

    final ink = AppColors.text(context);
    final ink2 = AppColors.text2(context);
    final canvas = AppColors.bg(context);
    final surface = AppColors.card(context);
    final sunken = AppColors.sunken(context);
    final line = AppColors.border(context);
    final accent = AppColors.accent(context);

    return Scaffold(
      backgroundColor: canvas,
      appBar: AppBar(leading: const AppBackButton(),
        automaticallyImplyLeading: false,
        backgroundColor: canvas,
        surfaceTintColor: Colors.transparent,
        foregroundColor: ink,
        title: Text('Profile', style: AppTheme.display(22, context: context)),
        actions: [
          TextButton(
            onPressed: _loading
                ? null
                : () {
                    if (_editing) {
                      setState(() => _editing = false);
                    } else {
                      setState(() => _editing = true);
                    }
                  },
            child: Text(
              _editing ? 'Cancel' : 'Edit',
              style: TextStyle(fontWeight: FontWeight.w600, color: ink),
            ),
          ),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: ink))
          : RefreshIndicator(
              color: ink,
              onRefresh: _load,
              child: ListView(
                padding: AppSpace.pagePadding,
                children: [
                  StudioIdentityTile(
                    profile: _studio,
                    fallbackName: studioName,
                    subtitle: _studio?['tagline']?.toString() ?? 'Your photography studio',
                    onTap: () => context.push('/contact'),
                  ),
                  const SizedBox(height: AppSpace.md),
                  Center(
                    child: CircleAvatar(
                      radius: 32,
                      backgroundColor: sunken,
                      child: Text(initial, style: AppTheme.display(22, context: context)),
                    ),
                  ),
                  const SizedBox(height: AppSpace.xs),
                  if (_editing) ...[
                    TextField(
                      controller: _nameCtrl,
                      textCapitalization: TextCapitalization.words,
                      style: TextStyle(color: ink),
                      decoration: const InputDecoration(
                        labelText: 'Full name',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: AppSpace.sm),
                    TextField(
                      controller: _phoneCtrl,
                      keyboardType: TextInputType.phone,
                      style: TextStyle(color: ink),
                      decoration: const InputDecoration(
                        labelText: 'Phone',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: AppSpace.sm),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      child: Text(_saving ? 'Saving…' : 'Save changes'),
                    ),
                  ] else ...[
                    Center(child: Text(name, style: AppTheme.display(22, context: context))),
                    if (phone.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Center(
                        child: Text(
                          phone,
                          style: TextStyle(color: ink2, fontSize: 14, fontWeight: FontWeight.w500),
                        ),
                      ),
                    ],
                  ],

                  if ((p?['status'] as String?)?.isNotEmpty == true) ...[
                    const SizedBox(height: AppSpace.sm),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: line),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.info_outline_rounded, size: 16, color: accent),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              p!['status'].toString(),
                              style: TextStyle(height: 1.35, fontWeight: FontWeight.w600, color: ink, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: AppSpace.md),
                  _section(context, 'Your account'),
                  _card(context, children: [
                    _row(context, 'Phone', phone.isEmpty ? '—' : phone),
                    _row(context, 'Joined', _fmtDate(p?['joinedAt'])),
                    _row(context, 'Galleries', '${p?['galleryCount'] ?? 0}'),
                    _row(context, 'Favorites', '${p?['favoriteCount'] ?? 0}'),
                    _row(context, 'Package', p?['packageName']?.toString() ?? '—'),
                  ]),

                  const SizedBox(height: AppSpace.md),
                  _section(context, 'Booking'),
                  _card(context, children: [
                    _row(context, 'Status', _fmtBooking(p?['bookingStatus']?.toString())),
                    if ((p?['bookingPackage'] as Map?)?['title'] != null)
                      _row(context, 'Package', (p!['bookingPackage'] as Map)['title'].toString()),
                    if ((p?['bookingNotes'] as String?)?.isNotEmpty == true) ...[
                      const SizedBox(height: 4),
                      Text(
                        p!['bookingNotes'].toString(),
                        style: TextStyle(color: ink2, fontSize: 13, height: 1.35),
                      ),
                    ],
                  ]),
                  const SizedBox(height: AppSpace.xs),
                  _linkTile(context, Icons.timeline_rounded, 'Full booking timeline', () => context.push('/booking')),

                  const SizedBox(height: AppSpace.md),
                  _section(context, 'Payments'),
                  if ((p?['payment'] as Map?) != null) ...[
                    Builder(builder: (_) {
                      final pay = Map<String, dynamic>.from(p!['payment'] as Map);
                      final currency = pay['currency']?.toString() ?? 'INR';
                      final total = pay['totalDue'];
                      final paid = pay['amountPaid'];
                      final bal = pay['balance'];
                      final hasAny = total != null || paid != null || (pay['terms'] as String?)?.isNotEmpty == true;
                      if (!hasAny) {
                        return _card(context, children: [
                          Text(
                            'Payment terms appear here once the studio adds them or sends an invoice.',
                            style: TextStyle(color: ink2, fontSize: 13, height: 1.4),
                          ),
                        ]);
                      }
                      return _card(context, children: [
                        if (total != null) _row(context, 'Total due', _money(total, currency)),
                        if (paid != null) _row(context, 'Paid', _money(paid, currency)),
                        if (bal != null) _row(context, 'Balance', _money(bal, currency)),
                        if ((pay['terms'] as String?)?.isNotEmpty == true) ...[
                          const SizedBox(height: 8),
                          Text(
                            pay['terms'].toString(),
                            style: TextStyle(height: 1.45, fontSize: 13, color: ink2),
                          ),
                        ],
                      ]);
                    }),
                  ],
                  const SizedBox(height: 8),
                  if ((p?['invoices'] as List?)?.isNotEmpty == true) ...[
                    ...((p!['invoices'] as List).take(3).map((raw) {
                      final inv = Map<String, dynamic>.from(raw as Map);
                      final currency = inv['currency']?.toString() ?? 'INR';
                      return _linkTile(
                        context,
                        Icons.receipt_long_outlined,
                        '${inv['invoiceNumber'] ?? 'Invoice'} · ${_money(inv['totalAmount'], currency)} · ${inv['status'] ?? ''}',
                        () => context.push('/invoices'),
                      );
                    })),
                    _linkTile(context, Icons.receipt_long_outlined, 'All invoices', () => context.push('/invoices')),
                  ] else
                    _linkTile(context, Icons.receipt_long_outlined, 'Invoices', () => context.push('/invoices')),

                  const SizedBox(height: AppSpace.md),
                  _section(context, 'Agreements'),
                  if ((p?['weddingAgreements'] as List?)?.isNotEmpty == true)
                    ...((p!['weddingAgreements'] as List).map((raw) {
                      final a = Map<String, dynamic>.from(raw as Map);
                      return _linkTile(
                        context,
                        Icons.description_outlined,
                        '${a['title'] ?? 'Wedding agreement'} · view PDF',
                        () => context.push('/contracts'),
                      );
                    })),
                  if ((p?['contracts'] as List?)?.isNotEmpty == true)
                    ...((p!['contracts'] as List).map((raw) {
                      final c = Map<String, dynamic>.from(raw as Map);
                      return _linkTile(
                        context,
                        Icons.description_outlined,
                        '${c['title'] ?? 'Agreement'} · ${c['status'] ?? ''}',
                        () => context.push('/contracts'),
                      );
                    })),
                  if ((p?['contracts'] as List?)?.isEmpty != false &&
                      (p?['weddingAgreements'] as List?)?.isEmpty != false)
                    _linkTile(
                      context,
                      Icons.description_outlined,
                      'Agreements & contracts',
                      () => context.push('/contracts'),
                    ),

                  const SizedBox(height: AppSpace.md),
                  _section(context, 'Studio'),
                  if (_studio != null) ...[
                    if ((_studio!['about'] as String?)?.trim().isNotEmpty == true) ...[
                      Text(
                        _studio!['about'].toString().trim(),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: ink2, fontSize: 13, height: 1.4),
                      ),
                      const SizedBox(height: AppSpace.xs),
                    ],
                    _card(context, children: [
                      if ((_studio!['phone'] as String?)?.isNotEmpty == true)
                        _row(context, 'Phone', _studio!['phone'].toString()),
                      if ((_studio!['email'] as String?)?.isNotEmpty == true)
                        _row(context, 'Email', _studio!['email'].toString()),
                      if ((_studio!['address'] as String?)?.isNotEmpty == true)
                        _row(context, 'Address', _studio!['address'].toString()),
                      if ((_studio!['workingHours'] as String?)?.isNotEmpty == true)
                        _row(context, 'Hours', _studio!['workingHours'].toString()),
                    ]),
                  ],
                  const SizedBox(height: AppSpace.xs),
                  _linkTile(context, Icons.storefront_outlined, 'Full studio profile & contact', () => context.push('/contact')),
                  _linkTile(context, Icons.auto_awesome_outlined, 'Our work', () => context.push('/portfolio')),
                  _linkTile(context, Icons.card_giftcard_outlined, 'Packages', () => context.go('/app?tab=packages')),

                  const SizedBox(height: AppSpace.md),
                  OutlinedButton(
                    onPressed: () => ref.read(authStateProvider.notifier).logout(),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: ink,
                      side: BorderSide(color: line),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text('Log out', style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _section(BuildContext context, String t) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpace.xs),
        child: Text(t, style: AppTheme.display(17, context: context)),
      );

  Widget _card(BuildContext context, {required List<Widget> children}) {
    if (children.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
      decoration: BoxDecoration(
        color: AppColors.card(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }

  Widget _row(BuildContext context, String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 92,
              child: Text(
                k,
                style: TextStyle(
                  color: AppColors.text2(context),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Expanded(
              child: Text(
                v,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  height: 1.3,
                  color: AppColors.text(context),
                  fontSize: 13.5,
                ),
              ),
            ),
          ],
        ),
      );

  Widget _linkTile(BuildContext context, IconData icon, String label, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Material(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border(context)),
              ),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: AppColors.text2(context)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      label,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: AppColors.text(context),
                        fontSize: 14,
                      ),
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.text3(context)),
                ],
              ),
            ),
          ),
        ),
      );
}
