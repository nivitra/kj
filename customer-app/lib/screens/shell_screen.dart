import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart' show canLaunchUrl, launchUrl, LaunchMode;
import '../providers/auth_provider.dart';
import '../providers/gallery_provider.dart';
import '../providers/theme_provider.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';
import '../widgets/share_link_button.dart';
import '../widgets/studio_branding.dart';
import 'home_screen.dart';
import 'wedding_home_screen.dart';
import 'galleries_screen.dart';
import 'invoices_screen.dart';
import 'packages_screen.dart';
import 'profile_screen.dart';

/// Bottom nav shell — signed-in customers only (not QR guests).
///
/// Stable destinations for all clients; secondary tools live in the drawer.
class ShellScreen extends ConsumerStatefulWidget {
  final int initialIndex;
  final String? initialTab;
  const ShellScreen({super.key, this.initialIndex = 0, this.initialTab});

  @override
  ConsumerState<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends ConsumerState<ShellScreen> with WidgetsBindingObserver {
  int _index = 0;
  Map<String, dynamic>? _contact;
  Map<String, dynamic>? _profile;
  String? _lastTabKey;
  bool _accessReady = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _index = widget.initialIndex;
    _loadBranding();
    // Pull fresh profile (weddingExperience, package) so admin toggles apply without re-login.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authStateProvider.notifier).refresh();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.invalidate(galleriesProvider);
  }

  void _refreshGalleryTab(String tab) {
    if (tab == 'gallery') ref.invalidate(galleriesProvider);
  }

  @override
  void didUpdateWidget(covariant ShellScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialTab != widget.initialTab ||
        oldWidget.initialIndex != widget.initialIndex) {
      final access = ref.read(clientAccessProvider);
      final tabs = _tabsFor(access);
      final next = _resolveIndex(tabs).clamp(0, tabs.isEmpty ? 0 : tabs.length - 1);
      if (next != _index) {
        _refreshGalleryTab(tabs[next].id);
        setState(() => _index = next);
      }
    }
  }

  Future<void> _loadBranding() async {
    try {
      Map<String, dynamic>? contact;
      Map<String, dynamic>? profile;
      try {
        profile = await PortalApi.profile();
      } catch (_) {}
      try {
        contact = await PortalApi.contact();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _contact = contact;
        _profile = profile;
      });
    } catch (_) {}
  }

  List<_ShellTab> _tabsFor(ClientAccess access) {
    if (!access.loading) _accessReady = true;
    final wedding = ref.watch(authStateProvider).valueOrNull?.weddingExperience == true;
    return [
      _ShellTab(id: 'home', page: wedding ? const WeddingHomeScreen() : const HomeScreen(), icon: Icons.home_outlined, selectedIcon: Icons.home_rounded, label: 'Home'),
      const _ShellTab(id: 'gallery', page: GalleriesTab(), icon: Icons.photo_library_outlined, selectedIcon: Icons.photo_library_rounded, label: 'Galleries'),
      const _ShellTab(id: 'billing', page: InvoicesScreen(embedded: true), icon: Icons.receipt_long_outlined, selectedIcon: Icons.receipt_long_rounded, label: 'Billing'),
      const _ShellTab(id: 'packages', page: PackagesScreen(), icon: Icons.card_giftcard_outlined, selectedIcon: Icons.card_giftcard_rounded, label: 'Packages'),
      const _ShellTab(id: 'profile', page: ProfileScreen(), icon: Icons.person_outline_rounded, selectedIcon: Icons.person_rounded, label: 'You'),
    ];
  }

  int _resolveIndex(List<_ShellTab> tabs) {
    final name = widget.initialTab?.toLowerCase();
    if (name != null && name.isNotEmpty) {
      final byName = tabs.indexWhere((t) => t.id == name);
      if (byName >= 0) return byName;
      // Non-wedding shells open portfolio as a route, not a tab
      if (name == 'work') {
        final w = tabs.indexWhere((t) => t.id == 'work');
        return w >= 0 ? w : 0;
      }
    }
    if (widget.initialIndex > 0 && widget.initialIndex < tabs.length) {
      return widget.initialIndex;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final customer = ref.watch(authStateProvider).value;
    final studioName = (_profile?['displayName'] as String?)?.trim().isNotEmpty == true
        ? _profile!['displayName'] as String
        : (customer?.studio?.name ?? 'SJ Clicks');
    final access = ref.watch(clientAccessProvider);
    final tabs = _tabsFor(access);
    final tabKey = tabs.map((t) => t.id).join('|');
    final themeMode = ref.watch(themeModeProvider);

    if (_lastTabKey != tabKey) {
      final previousKey = _lastTabKey;
      _lastTabKey = tabKey;
      final resolved = _resolveIndex(tabs).clamp(0, tabs.length - 1);
      int next;
      if (previousKey == null) {
        next = resolved;
      } else if (_index >= tabs.length) {
        next = 0;
      } else {
        next = _index.clamp(0, tabs.length - 1);
      }
      if (previousKey != null) {
        final oldIds = previousKey.split('|');
        final oldId = _index < oldIds.length ? oldIds[_index] : 'home';
        final newIdx = tabs.indexWhere((t) => t.id == oldId);
        next = newIdx >= 0 ? newIdx : 0;
      }
      if (next != _index) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _index = next);
        });
      }
    }
    final safeIndex = _index.clamp(0, tabs.length - 1);

    final wide = MediaQuery.sizeOf(context).width >= 900;
    void selectTab(int i) {
      Haptics.selection();
      _refreshGalleryTab(tabs[i].id);
      setState(() => _index = i);
      context.go('/app?tab=${tabs[i].id}');
    }

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      drawer: _Drawer(
        studioName: studioName,
        logoUrl: _profile?['logoUrl'] as String?,
        contact: _contact,
        hasGalleries: !access.loading && access.hasGalleries,
        hasFaceSearch: !access.loading && access.hasGalleries && access.hasFaceSearch,
        themeMode: themeMode,
        onThemeToggle: (dark) => ref.read(themeModeProvider.notifier).toggleDark(dark),
        onLogout: () => ref.read(authStateProvider.notifier).logout(),
        onTab: (id) {
          final i = tabs.indexWhere((t) => t.id == id);
          if (i >= 0) {
            Haptics.selection();
            _refreshGalleryTab(id);
            setState(() => _index = i);
            context.go('/app?tab=$id');
            return;
          }
          // Standard (non-wedding) shell: Our work is a full-screen route
          if (id == 'face') context.push('/find-me');
          if (id == 'work') {
            context.push('/portfolio');
          }
        },
        onRoute: (path) => context.push(path),
      ),
      body: Row(children: [
        if (wide) ...[
          NavigationRail(
            selectedIndex: safeIndex,
            labelType: NavigationRailLabelType.all,
            backgroundColor: AppColors.card(context),
            onDestinationSelected: selectTab,
            leading: Padding(padding: const EdgeInsets.symmetric(vertical: 20), child: StudioLogo(logoUrl: _profile?['logoUrl'] as String?, name: studioName, size: 40, radius: 12)),
            destinations: tabs.map((t) => NavigationRailDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: Text(t.label))).toList(),
          ),
          VerticalDivider(width: 1, color: AppColors.border(context)),
        ],
        Expanded(child: Center(child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1200),
          child: IndexedStack(key: ValueKey(tabKey), index: safeIndex,
            children: tabs.map((t) => t.page).toList()),
        ))),
      ]),
      bottomNavigationBar: wide ? null : !_accessReady && access.loading
          ? _NavShimmer()
          : NavigationBar(
              selectedIndex: safeIndex,
              onDestinationSelected: (i) {
                Haptics.selection();
                _refreshGalleryTab(tabs[i].id);
                setState(() => _index = i);
                if (i >= 0 && i < tabs.length) {
                  context.go('/app?tab=${tabs[i].id}');
                }
              },
              destinations: tabs
                  .map(
                    (t) => NavigationDestination(
                      icon: Icon(t.icon),
                      selectedIcon: Icon(t.selectedIcon),
                      label: t.label,
                    ),
                  )
                  .toList(),
            ),
    );
  }
}

class _NavShimmer extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      decoration: BoxDecoration(
        color: AppColors.card(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: List.generate(
          4,
          (_) => const ShimmerBox(width: 40, height: 36, radius: AppSpace.radius),
        ),
      ),
    );
  }
}

class _ShellTab {
  final String id;
  final Widget page;
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  const _ShellTab({
    required this.id,
    required this.page,
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });
}

class GalleriesTab extends StatelessWidget {
  const GalleriesTab({super.key});
  @override
  Widget build(BuildContext context) => const GalleriesScreen(embedded: true);
}

class _Drawer extends StatelessWidget {
  final String studioName;
  final String? logoUrl;
  final Map<String, dynamic>? contact;
  final bool hasGalleries;
  final bool hasFaceSearch;
  final ThemeMode themeMode;
  final ValueChanged<bool> onThemeToggle;
  final VoidCallback onLogout;
  final void Function(String tabId) onTab;
  final void Function(String path) onRoute;

  const _Drawer({
    required this.studioName,
    this.logoUrl,
    required this.contact,
    required this.hasGalleries,
    required this.hasFaceSearch,
    required this.themeMode,
    required this.onThemeToggle,
    required this.onLogout,
    required this.onTab,
    required this.onRoute,
  });

  Future<void> _open(String? url, {String scheme = 'https'}) async {
    if (url == null || url.isEmpty) return;
    var u = url;
    if (!u.contains('://') && scheme == 'https') u = 'https://$u';
    if (scheme == 'tel') u = 'tel:$url';
    if (scheme == 'mailto') u = 'mailto:$url';
    if (scheme == 'wa') {
      var digits = url.replaceAll(RegExp(r'[^\d]'), '');
      if (digits.length == 10 && RegExp(r'^[6-9]').hasMatch(digits)) {
        digits = '91$digits';
      }
      u = 'https://wa.me/$digits';
    }
    final uri = Uri.parse(u);
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark || themeMode == ThemeMode.dark;
    return Drawer(
      backgroundColor: AppColors.card(context),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const ListTile(title: Text('Share app'), trailing: ShareLinkButton(path: '/app', title: 'Share app')),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.md, AppSpace.page, AppSpace.sm),
              child: Row(
                children: [
                  StudioLogo(logoUrl: logoUrl, name: studioName, size: 48, radius: AppSpace.radius),
                  const SizedBox(width: AppSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(studioName.toUpperCase(), style: AppTheme.kicker(context: context)),
                        const SizedBox(height: 4),
                        Text('Client portal', style: AppTheme.display(18, context: context)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: AppColors.border(context)),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: AppSpace.xs),
                children: [
                  _item(context, Icons.home_outlined, 'Home', () {
                    Navigator.pop(context);
                    onTab('home');
                  }),
                  if (hasGalleries)
                    _item(context, Icons.photo_library_outlined, 'My galleries', () {
                      Navigator.pop(context);
                      onTab('gallery');
                    }),
                  if (hasFaceSearch)
                    _item(context, Icons.face_retouching_natural_outlined, 'Find my photos', () {
                      Navigator.pop(context);
                      onTab('face');
                    }),
                  _item(context, Icons.auto_awesome_outlined, 'Our work', () {
                    Navigator.pop(context);
                    onTab('work');
                  }),
                  _item(context, Icons.card_giftcard_outlined, 'Packages', () {
                    Navigator.pop(context);
                    onTab('packages');
                  }),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Divider(height: 1, color: AppColors.border(context)),
                  ),
                  _item(context, Icons.timeline_rounded, 'Booking status', () {
                    Navigator.pop(context);
                    onRoute('/booking');
                  }),
                  _item(context, Icons.receipt_long_outlined, 'Billing', () {
                    Navigator.pop(context);
                    onTab('billing');
                  }),
                  _item(context, Icons.description_outlined, 'Agreements', () {
                    Navigator.pop(context);
                    onRoute('/contracts');
                  }),
                  _item(context, Icons.contact_phone_outlined, 'Contact studio', () {
                    Navigator.pop(context);
                    onRoute('/contact');
                  }),
                  _item(context, Icons.person_outline_rounded, 'Profile', () {
                    Navigator.pop(context);
                    onTab('profile');
                  }),
                  SwitchListTile(
                    secondary: Icon(
                      isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                      color: AppColors.text2(context),
                    ),
                    title: Text(
                      'Dark mode',
                      style: TextStyle(
                        fontWeight: FontWeight.w500,
                        fontSize: 15,
                        color: AppColors.text(context),
                      ),
                    ),
                    value: Theme.of(context).brightness == Brightness.dark,
                    activeThumbColor: AppColors.accent(context),
                    onChanged: (v) {
                      Haptics.selection();
                      onThemeToggle(v);
                    },
                  ),
                ],
              ),
            ),
            if (contact != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    if ((contact!['phone'] as String?)?.isNotEmpty == true)
                      IconButton(
                        onPressed: () => _open(contact!['phone'] as String, scheme: 'tel'),
                        icon: Icon(Icons.call_outlined, color: AppColors.text(context)),
                      ),
                    if ((contact!['whatsapp'] as String?)?.isNotEmpty == true)
                      IconButton(
                        onPressed: () => _open(contact!['whatsapp'] as String, scheme: 'wa'),
                        icon: Icon(Icons.chat_outlined, color: AppColors.text(context)),
                      ),
                    if ((contact!['instagram'] as String?)?.isNotEmpty == true)
                      IconButton(
                        onPressed: () => _open(contact!['instagram'] as String),
                        icon: Icon(Icons.camera_alt_outlined, color: AppColors.text(context)),
                      ),
                  ],
                ),
              ),
            ListTile(
              leading: Icon(Icons.logout_rounded, color: AppColors.text2(context)),
              title: Text(
                'Log out',
                style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.text(context)),
              ),
              onTap: () {
                Navigator.pop(context);
                onLogout();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _item(BuildContext context, IconData icon, String label, VoidCallback onTap) => ListTile(
        leading: Icon(icon, color: AppColors.text2(context), size: 22),
        title: Text(
          label,
          style: TextStyle(fontWeight: FontWeight.w500, fontSize: 15, color: AppColors.text(context)),
        ),
        onTap: () {
          Haptics.selection();
          onTap();
        },
      );
}
