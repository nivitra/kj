import '../widgets/share_link_button.dart';
import '../widgets/app_back_button.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:photo_view/photo_view.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class SelectionReviewScreen extends StatefulWidget {
  final String galleryId, galleryName, selectionPhase;
  final Map<String, String> extraDeliveryTypes;
  final List<Map<String, String>> pendingExtras;
  final double extraRate;
  const SelectionReviewScreen({super.key, required this.galleryId, required this.galleryName,
    this.extraDeliveryTypes = const {}, this.pendingExtras = const [], this.selectionPhase = 'CONTINUOUS', this.extraRate = 0});
  @override
  State<SelectionReviewScreen> createState() => _SelectionReviewScreenState();
}
class _SelectionReviewScreenState extends State<SelectionReviewScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true, _saving = false;
  String? _error;
  final _note = TextEditingController();
  final _money = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _note.dispose(); super.dispose(); }
  Future<void> _load() async {
    try {
      final data = await ApiService.getSelectionItemsDetailed(widget.galleryId);
      if (mounted) setState(() { if (_data == null) _note.text = data['customerNote']?.toString() ?? ''; _data = data; _loading = false; _error = null; });
    } catch (e) { if (mounted) setState(() { _error = ApiService.errorMessage(e); _loading = false; }); }
  }
  Future<void> _remove(String id) async {
    if (_saving) return;
    setState(() => _saving = true);
    try { await ApiService.toggleFavorite(id, selected: false); await _load(); }
    catch (e) { if (mounted) setState(() => _error = ApiService.errorMessage(e)); }
    finally { if (mounted) setState(() => _saving = false); }
  }
  Future<void> _submit() async {
    if (_saving || _data == null) return;
    final estimate = _data!['estimate'] as Map? ?? {};
    final amount = (estimate['overageTotal'] as num?) ?? 0;
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Send your selection?'),
      content: Text('Additional cost for this submission: ${_money.format(amount)}. Existing payments stay on your account.\n\nYou can change these photos until the studio starts editing. Additional photos can be added afterward.'),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Review again')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirm & send'))],
    ));
    if (confirmed != true || !mounted) return;
    setState(() { _saving = true; _error = null; });
    try {
      await ApiService.submitSelection(widget.galleryId, revision: (_data!['revision'] as num?)?.toInt(), note: _note.text.trim());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Selection sent. Your invoice and photo choices are up to date.')));
      Navigator.pop(context, true);
    } catch (e) { if (mounted) { setState(() => _error = ApiService.errorMessage(e)); } }
    finally { if (mounted) setState(() => _saving = false); }
  }
  @override
  Widget build(BuildContext context) {
    final items = (_data?['items'] as List? ?? []).cast<Map>();
    final estimate = _data?['estimate'] as Map? ?? {};
    final history = (_data?['history'] as List? ?? []).cast<Map>();
    return Scaffold(
      appBar: AppBar(actions: [ShareLinkButton(path: '/gallery/${widget.galleryId}/selection', title: 'Share selection')], leading: const AppBackButton(), title: const Text('Review selection')),
      body: _loading ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(20), children: [
        Text(widget.galleryName, style: AppTheme.display(26)),
        const SizedBox(height: 8), Text(_data?['statusLabel']?.toString() ?? 'Review your photos and extra charges'),
        if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Column(children: [Text(_error!, style: const TextStyle(color: AppColors.rose)), TextButton(onPressed: _load, child: const Text('Refresh selection'))])),
        const SizedBox(height: 16), Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
          _row('Selected photos', '${items.length}'),
          _row('Your included allowance', '${estimate['includedPhotos'] ?? 0} photos'),
          _row('Included photos selected', '${estimate['freeCount'] ?? 0}'),
          _row('Extra photos selected', '${estimate['extraCount'] ?? 0}'),
          _row('Extra photo price', _money.format(estimate['extraRate'] ?? 0)),
          const Divider(height: 24), _row('Extras in this submission', '${estimate['pendingExtraCount'] ?? estimate['extraCount'] ?? 0}'),
          _row('Additional cost', estimate['pricingReady'] == false ? 'Awaiting studio pricing' : _money.format(estimate['overageTotal'] ?? 0)),
          const SizedBox(height: 8), const Text('There is no limit on how many photos you can choose. Only confirmed extras are invoiced. Photos already in editing keep their previous invoice.', style: TextStyle(fontSize: 12, height: 1.5)),
        ]))),
        const SizedBox(height: 16),
        TextField(controller: _note, maxLines: 3, maxLength: 2000, decoration: const InputDecoration(labelText: 'Note for the studio (optional)', hintText: 'Tell us about any editing preferences')),
        const SizedBox(height: 12),
        ...items.map((i) => Card(child: ListTile(
          contentPadding: const EdgeInsets.all(10),
          leading: ClipRRect(borderRadius: BorderRadius.circular(8), child: SizedBox(width: 60, height: 60, child: CachedNetworkImage(imageUrl: i['thumbnailUrl']?.toString() ?? '', fit: BoxFit.cover, errorWidget: (_, __, ___) => const Icon(Icons.image_outlined)))),
          title: Text(i['filename']?.toString() ?? 'Photo', maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text(i['locked'] == true ? 'Confirmed · changes closed' : i['isFree'] == true ? 'Included · changes allowed' : 'Extra · ${_money.format(estimate['extraRate'] ?? 0)}'),
          trailing: i['locked'] == true ? const Icon(Icons.lock_outline) : IconButton(tooltip: 'Remove photo', onPressed: _saving ? null : () => _remove(i['photoId'].toString()), icon: const Icon(Icons.remove_circle_outline)),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: Text(i['filename']?.toString() ?? 'Photo')), body: PhotoView(imageProvider: CachedNetworkImageProvider((i['previewUrl'] ?? i['thumbnailUrl']).toString()))))),
        ))),
        if (history.isNotEmpty) ExpansionTile(title: const Text('Selection history'), children: history.reversed.map((h) {
          final date = DateTime.tryParse((h['submittedAt'] ?? h['at'] ?? '').toString());
          return ListTile(title: Text(h['kind'] == 'LEGACY_BILLING_PRESERVED' ? 'Earlier photos and invoice preserved' : h['kind'] == 'EDITING_STARTED' ? 'Studio started editing' : h['kind'] == 'REOPENED' ? 'Studio reopened photos' : 'Selection sent · ${h['count'] ?? 0} photos'),
            subtitle: Text(date == null ? '' : '${DateFormat('d MMM yyyy, h:mm a').format(date.toUtc().add(const Duration(hours: 5, minutes: 30)))} IST'));
        }).toList()),
      ]),
      bottomNavigationBar: SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: FilledButton(onPressed: _saving || _loading || items.isEmpty || estimate['pricingReady'] == false ? null : _submit, child: Text(_saving ? 'Saving…' : 'Confirm & send selection')))),
    );
  }
  Widget _row(String label, String value) => Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Row(children: [Expanded(child: Text(label)), Text(value, style: const TextStyle(fontWeight: FontWeight.w600))]));
}
