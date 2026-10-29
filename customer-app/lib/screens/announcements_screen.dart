import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import '../services/portal_api.dart';
import '../widgets/share_link_button.dart';
import '../widgets/announcement_ui.dart';
class AnnouncementsScreen extends StatefulWidget {
  final String? highlightId;
  const AnnouncementsScreen({super.key, this.highlightId});
  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}
class _AnnouncementsScreenState extends State<AnnouncementsScreen> {
  List<dynamic>? _items;
  bool _failed = false;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final items = await PortalApi.announcements(id: widget.highlightId); if (mounted) setState(() { _items = items.where((a) => widget.highlightId == null || a['id'] == widget.highlightId).toList(); _failed = false; }); }
    catch (_) { if (mounted) setState(() => _failed = true); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(actions: const [ShareLinkButton(path: '/announcements')], leading: const AppBackButton(), title: const Text('Announcements')), body: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(20), children: [
    if (_failed) ...[const Text('Could not load announcements.'), TextButton(onPressed: _load, child: const Text('Try again'))],
    if (_items == null && !_failed) const Center(child: CircularProgressIndicator()),
    if (_items?.isEmpty == true) const Text('This announcement has expired or is no longer available.'),
    for (final a in _items ?? []) Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Expanded(child: Text('${a['title'] ?? 'Announcement'}', style: Theme.of(context).textTheme.titleLarge)), ShareLinkButton(path: '/announcements?id=${a['id']}')]),
      if (a['imageUrl'] != null) Image.network('${a['imageUrl']}', errorBuilder: (_, __, ___) => const SizedBox.shrink()),
      Text('${a['description'] ?? ''}'),
      if (a['ctaUrl'] != null) TextButton(onPressed: () => openAnnCta(a as Map), child: Text('${a['ctaLabel'] ?? 'Learn more'}')),
    ]))),
  ])));
}
