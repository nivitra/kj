import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import '../widgets/share_link_button.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/download_service.dart';
import '../providers/gallery_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/photo_grid_item.dart';

class GalleryDetailScreen extends ConsumerStatefulWidget {
  final String galleryId;
  const GalleryDetailScreen({super.key, required this.galleryId});
  @override
  ConsumerState<GalleryDetailScreen> createState() => _GalleryDetailScreenState();
}

class _GalleryDetailScreenState extends ConsumerState<GalleryDetailScreen> {
  final _scroll = ScrollController();
  final _saving = <String>{};
  List<Photo> _photos = [], _selected = [];
  Gallery? _gallery;
  SelectionState? _selection;
  bool _loading = false, _selectionEnabled = false, _downloads = false, _selectedOnly = false, _buying = false;
  int _page = 0, _pages = 1, _generation = 0;
  String? _error;
  final _money = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
  @override
  void initState() { super.initState(); _scroll.addListener(_next); _load(); }
  @override
  void dispose() { _generation++; _scroll.dispose(); super.dispose(); }
  void _next() { if (!_selectedOnly && _scroll.position.extentAfter < 600 && !_loading && _error == null && _page < _pages) _load(); }
  void _message(String text) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text))); }
  Future<void> _load({bool refresh = false}) async {
    if (_loading && !refresh) return;
    final generation = refresh ? ++_generation : _generation;
    final page = refresh ? 1 : _page + 1;
    setState(() { _loading = true; _error = null; });
    try {
      final data = await ApiService.getGalleryPhotos(widget.galleryId, page: page);
      if (!mounted || generation != _generation) return;
      final rows = data['photos'] as List<Photo>;
      setState(() {
        _gallery = data['gallery'] as Gallery;
        _downloads = data['downloadsAllowed'] == true || data['rawAccess'] == true;
        _selectionEnabled = data['selectionEnabled'] != false;
        _photos = {for (final p in [if (!refresh) ..._photos, ...rows]) p.id: p}.values.toList();
        _page = page; _pages = data['pages'] as int? ?? 1;
      });
      ref.read(photosNotifierProvider.notifier).setPhotos(_photos);
      if (page == 1 && _selectionEnabled) await _loadSelection();
    } catch (e) { if (mounted && generation == _generation) setState(() => _error = ApiService.errorMessage(e)); }
    finally { if (mounted && generation == _generation) setState(() => _loading = false); }
  }
  Future<void> _loadSelection() async {
    try {
      final state = await ApiService.getSelection(widget.galleryId);
      final selected = _selectedOnly ? await ApiService.getSelectionItems(widget.galleryId) : null;
      if (!mounted) return;
      setState(() { _selection = state; if (selected != null) _selected = selected; });
    } catch (e) { if (mounted) setState(() => _error = ApiService.errorMessage(e)); }
  }
  Future<void> _toggle(Photo p) async {
    if (!_selectionEnabled || _saving.contains(p.id)) return;
    if (_selection?.isLocked(p.id) == true) { _message('Editing has started for this photo. You can still add more photos.'); return; }
    final desired = !p.isFavorite;
    setState(() {
      _saving.add(p.id);
      _photos = _photos.map((x) => x.id == p.id ? x.copyWith(isFavorite: desired) : x).toList();
      _selected = _selected.map((x) => x.id == p.id ? x.copyWith(isFavorite: desired) : x).toList();
    });
    try {
      await ApiService.toggleFavorite(p.id, selected: desired);
    } catch (e) {
      if (!mounted) return;
      setState(() { _photos = _photos.map((x) => x.id == p.id ? p : x).toList(); });
      _message(ApiService.errorMessage(e) ?? 'Could not save this selection. Try again.');
    } finally {
      if (mounted) { setState(() => _saving.remove(p.id)); if (_saving.isEmpty) await _loadSelection(); }
    }
  }
  Future<void> _review() async {
    if (_saving.isNotEmpty) return;
    await context.push('/gallery/${widget.galleryId}/selection', extra: {'name': _gallery?.name ?? 'My photos', 'selectionPhase': 'CONTINUOUS'});
    if (mounted) await _load(refresh: true);
  }
  Future<void> _view(List<Photo> list, int index) async {
    await context.push('/gallery/${widget.galleryId}/photo', extra: {
      'photos': list, 'initialIndex': index, 'selectionEnabled': _selectionEnabled, 'downloadsAllowed': _downloads,
      'selectionPhase': 'CONTINUOUS', 'lockedPhotoIds': _selection?.lockedPhotoIds ?? [],
      'includedLimit': _selection?.includedLimit ?? 0, 'heartedCount': _selection?.count ?? 0,
      'extraRate': _selection?.extraRate ?? 0,
    });
    if (mounted) await _load(refresh: true);
  }
  Future<void> _download(Photo p) async {
    try {
      final url = await ApiService.getPhotoDownloadUrl(widget.galleryId, p.id);
      await DownloadService.downloadPhoto(url: url, filename: p.filename, expectedBytes: p.fileSize);
      _message('Download ready');
    } catch (e) { _message(ApiService.errorMessage(e) ?? 'Could not download this photo'); }
  }
  Future<void> _raw() async {
    final offer = _gallery?.bulkRawOffer;
    if (offer == null || _buying) return;
    if (offer.pending) { context.push('/invoices'); return; }
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Get full raw gallery?'),
      content: Text('Get all original, unedited files in this gallery for ${_money.format(offer.price ?? 0)}. Your edited-photo selection stays available. Access opens after the studio confirms payment.'),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirm request'))],
    ));
    if (confirmed != true || !mounted) return;
    setState(() => _buying = true);
    try { await ApiService.requestRawDump(widget.galleryId); if (mounted) { await _load(refresh: true); if (mounted) context.push('/invoices'); } }
    catch (e) { _message(ApiService.errorMessage(e) ?? 'Could not request raw access'); }
    finally { if (mounted) setState(() => _buying = false); }
  }
  @override
  Widget build(BuildContext context) {
    final list = _selectedOnly ? _selected : _photos;
    final count = _selection?.count ?? 0;
    final included = _selection?.includedLimit ?? 0;
    final extras = (count - included).clamp(0, count);
    final offer = _gallery?.bulkRawOffer;
    return Scaffold(
      appBar: AppBar(leading: const AppBackButton(), title: Text(_gallery?.name ?? 'My photos'), actions: [
        ShareLinkButton(path: '/gallery/${widget.galleryId}', title: 'Client-only link'),
        if (_gallery?.faceSearchEnabled == true) IconButton(tooltip: 'Find my photos', onPressed: () => context.push('/find-me?galleryId=${widget.galleryId}'), icon: const Icon(Icons.face_outlined)),
        IconButton(tooltip: 'Share with guests', onPressed: () => showModalBottomSheet<void>(context: context, isScrollControlled: true,
          builder: (_) => _ShareLinkSheet(galleryId: widget.galleryId, galleryName: _gallery?.name ?? 'Gallery')), icon: const Icon(Icons.share_outlined)),
      ]),
      body: RefreshIndicator(onRefresh: () => _load(refresh: true), child: CustomScrollView(controller: _scroll, physics: const AlwaysScrollableScrollPhysics(), slivers: [
        SliverPadding(padding: const EdgeInsets.fromLTRB(20, 12, 20, 16), sliver: SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(_selection?.statusLabel ?? 'Your memories, together', style: AppTheme.display(23)),
          const SizedBox(height: 8),
          if (_selectionEnabled) Text(_selection?.estimate?['pricingReady'] == false ? 'Choose as many photos as you like. The studio is confirming pricing before you send.' : 'Choose as many as you like. $included photos included · ${_money.format(_selection?.extraRate ?? 0)} for each additional photo.', style: TextStyle(color: AppColors.text2(context), height: 1.5)),
          if (offer?.purchased == true) const Card(child: ListTile(leading: Icon(Icons.folder_open_outlined), title: Text('Full raw gallery'), subtitle: Text('Your original, unedited files are unlocked. Tap download on any photo.'))),
          if (offer?.live == true || offer?.pending == true) Card(child: ListTile(leading: const Icon(Icons.collections_outlined), title: const Text('Full raw gallery'), subtitle: Text(offer!.pending ? 'Awaiting payment confirmation' : 'All original, unedited files · ${_money.format(offer.price ?? 0)}'), trailing: TextButton(onPressed: _buying ? null : _raw, child: Text(offer.pending ? 'View bill' : 'Get access')))),
          if (_selectionEnabled) Padding(padding: const EdgeInsets.only(top: 16), child: SegmentedButton<bool>(segments: [
            const ButtonSegment(value: false, label: Text('All photos'), icon: Icon(Icons.grid_view_outlined)),
            ButtonSegment(value: true, label: Text('Selected ($count)'), icon: const Icon(Icons.check_circle_outline)),
          ], selected: {_selectedOnly}, onSelectionChanged: (v) async { setState(() => _selectedOnly = v.first); if (_selectedOnly) await _loadSelection(); })),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Column(children: [Text(_error!, style: const TextStyle(color: AppColors.rose)), TextButton(onPressed: () => _load(refresh: _page == 0), child: const Text('Try again'))])),
        ]))),
        SliverPadding(padding: const EdgeInsets.symmetric(horizontal: 12), sliver: SliverLayoutBuilder(builder: (context, constraints) {
          final columns = (constraints.crossAxisExtent / 160).floor().clamp(2, 6);
          return SliverGrid(delegate: SliverChildBuilderDelegate((ctx, i) {
            final p = list[i]; final locked = _selection?.isLocked(p.id) == true;
            return PhotoGridItem(photo: p, onTap: () => _view(list, i), onFavorite: _saving.contains(p.id) ? null : () => _toggle(p),
              showFavorite: _selectionEnabled, isLocked: locked, canDownload: _downloads, onDownload: () => _download(p));
          }, childCount: list.length), gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: 6, crossAxisSpacing: 6));
        })),
        if (_loading) const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))),
        if (!_loading && list.isEmpty && _error == null) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(32), child: Text(_selectedOnly ? 'Tap the selection button on a photo to choose it.' : 'Your photos will appear here when they are ready.', textAlign: TextAlign.center))),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ])),
      bottomNavigationBar: _selectionEnabled ? SafeArea(child: Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: AppColors.card(context), border: Border(top: BorderSide(color: AppColors.border(context)))), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_saving.isNotEmpty ? 'Saving your choices…' : (_selection?.estimate?['pricingReady'] == false ? '$count selected · studio pricing pending' : '$count selected · ${count - extras} included · $extras extra · To confirm: ${_money.format((_selection?.estimate?['overageTotal'] as num?) ?? 0)}'), style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6), const Text('Changes allowed until editing starts. Add more photos anytime.', style: TextStyle(fontSize: 12)),
        const SizedBox(height: 12), FilledButton(onPressed: _saving.isEmpty && count > 0 && _selection != null ? _review : null, child: const Text('Review selection')),
      ]))) : null,
    );
  }
}
class _ShareLinkSheet extends StatefulWidget {
  final String galleryId;
  final String galleryName;
  const _ShareLinkSheet({required this.galleryId, required this.galleryName});

  @override
  State<_ShareLinkSheet> createState() => _ShareLinkSheetState();
}

class _ShareLinkSheetState extends State<_ShareLinkSheet> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _link;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ApiService.listShareLinks(widget.galleryId);
      if (!mounted) return;
      Map<String, dynamic>? active;
      for (final raw in list) {
        final m = Map<String, dynamic>.from(raw as Map);
        if (m['active'] != false) {
          active = m;
          break;
        }
      }
      setState(() {
        _link = active;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    setState(() => _loading = true);
    try {
      final res = await ApiService.createShareLink(widget.galleryId, label: widget.galleryName);
      if (!mounted) return;
      final link = res['link'] is Map
          ? Map<String, dynamic>.from(res['link'] as Map)
          : res;
      setState(() {
        _link = link;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Share gallery', style: AppTheme.display(22)),
          const SizedBox(height: 8),
          Text(
            'Family & friends can open this without logging in.',
            style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
          ),
          const SizedBox(height: 16),
          if (_loading)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context))),
            )
          else if (_error != null)
            Text(_error!, style: const TextStyle(color: AppColors.rose))
          else if (_link == null)
            FilledButton(
              onPressed: _create,
              style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
              child: const Text('Create share link'),
            )
          else ...[
            SelectableText(
              _link!['url']?.toString() ?? '',
              style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final url = _link!['url']?.toString() ?? '';
                      if (url.isEmpty) return;
                      await Clipboard.setData(ClipboardData(text: url));
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: const Text('Link copied'), backgroundColor: AppColors.text(context)),
                      );
                    },
                    icon: const Icon(Icons.copy_rounded, size: 18),
                    label: const Text('Copy'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.text(context),
                      side: BorderSide(color: AppColors.border(context)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () async {
                      final url = _link!['url']?.toString() ?? '';
                      if (url.isEmpty) return;
                      await Share.share(url, subject: widget.galleryName);
                    },
                    icon: const Icon(Icons.ios_share_rounded, size: 18),
                    label: const Text('Share'),
                    style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
