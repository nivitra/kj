import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import 'pdf_viewer_screen.dart';
import '../widgets/share_link_button.dart';

class ContractsScreen extends StatefulWidget {
  final String? highlightId;
  const ContractsScreen({super.key, this.highlightId});

  @override
  State<ContractsScreen> createState() => _ContractsScreenState();
}

class _ContractsScreenState extends State<ContractsScreen> {
  List<ContractItem> _items = [];
  List<Map<String, dynamic>> _wedding = [];
  bool _loading = true;
  String? _error;

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
      final list = await ApiService.getContracts();
      List<Map<String, dynamic>> wedding = [];
      try {
        final ag = await PortalApi.myAgreements();
        wedding = ((ag['weddingAgreements'] as List?) ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _items = widget.highlightId == null ? list : list.where((c) => c.id == widget.highlightId).toList();
        _wedding = widget.highlightId == null ? wedding : wedding.where((a) => a['id'] == widget.highlightId).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e);
        _loading = false;
      });
    }
  }

  Future<void> _openWedding(String id, {String title = 'Agreement'}) async {
    try {
      final url = await PortalApi.agreementPdfUrl(id);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PdfViewerScreen(title: title, url: url),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.errorMessage(e) ?? 'Could not open agreement')),
        );
      }
    }
  }

  Future<void> _open(ContractItem c) async {
    try {
      final url = await ApiService.viewContract(c.id);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PdfViewerScreen(title: c.title, url: url),
        ),
      );
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.errorMessage(e) ?? 'Could not open contract')),
        );
      }
    }
  }

  Future<void> _accept(ContractItem c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card(context),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('Accept contract?', style: AppTheme.display(20)),
        content: Text(
          'Confirm that you accept “${c.title}”.',
          style: TextStyle(color: AppColors.text2(context), height: 1.45),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
            child: const Text('Accept'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.acceptContract(c.id);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: const Text('Contract accepted'), backgroundColor: AppColors.text(context)),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.errorMessage(e) ?? 'Failed')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(leading: const AppBackButton(), actions: [const ShareLinkButton(path: '/contracts'),TextButton(onPressed: () => context.push('/quotes'), child: const Text('Quotations'))],
        backgroundColor: AppColors.bg(context),
        surfaceTintColor: Colors.transparent,
        title: Text('Contracts', style: AppTheme.display(20)),
      ),
      body: _loading
          ? Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(color: AppColors.text(context), strokeWidth: 2),
              ),
            )
          : RefreshIndicator(
              color: AppColors.text(context),
              onRefresh: _load,
              child: (_items.isEmpty && _wedding.isEmpty)
                  ? ListView(
                      children: [
                        SizedBox(height: MediaQuery.of(context).size.height * 0.25),
                        Center(
                          child: Column(
                            children: [
                              Container(
                                width: 76,
                                height: 76,
                                decoration: BoxDecoration(
                                  color: AppColors.sunken(context),
                                  borderRadius: BorderRadius.circular(22),
                                ),
                                child: Icon(Icons.description_outlined, color: AppColors.text3(context), size: 30),
                              ),
                              const SizedBox(height: 18),
                              Text('No agreements yet', style: AppTheme.display(22)),
                              const SizedBox(height: 8),
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 40),
                                child: Text(
                                  widget.highlightId != null ? 'This agreement is unavailable. Sign in with the client account it was shared with.' : 'When your studio sends an agreement, it will appear here for viewing.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: AppColors.text2(context), height: 1.5),
                                ),
                              ),
                              if (_error != null) ...[
                                const SizedBox(height: 12),
                                Text(_error!, style: const TextStyle(color: AppColors.rose)),
                              ],
                            ],
                          ),
                        ),
                      ],
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.sm, AppSpace.page, AppSpace.bottomNav),
                      children: [
                        if (_wedding.isNotEmpty) ...[
                          Text('Wedding agreements', style: AppTheme.display(17)),
                          const SizedBox(height: AppSpace.xs),
                          ..._wedding.map((a) => Container(
                                margin: const EdgeInsets.only(bottom: AppSpace.sm),
                                padding: const EdgeInsets.all(AppSpace.md),
                                decoration: BoxDecoration(
                                  color: AppColors.card(context),
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(color: AppColors.border(context)),
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            a['title']?.toString() ?? 'Agreement',
                                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            a['status']?.toString() ?? 'FINALIZED',
                                            style: TextStyle(color: AppColors.text3(context), fontSize: 12),
                                          ),
                                        ],
                                      ),
                                    ),
                                    ShareLinkButton(path: '/contracts?id=${a['id']}', title: 'Share agreement'),
                                    FilledButton(
                                      onPressed: () => _openWedding(
                                        a['id'].toString(),
                                        title: a['title']?.toString() ?? 'Wedding agreement',
                                      ),
                                      style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                                      child: const Text('View PDF'),
                                    ),
                                  ],
                                ),
                              )),
                          const SizedBox(height: 12),
                        ],
                        if (_items.isNotEmpty)
                          Text('Contracts', style: AppTheme.display(18)),
                        if (_items.isNotEmpty) const SizedBox(height: 10),
                        ..._items.map((c) {
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppColors.card(context),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.border(context)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        c.title,
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 15,
                                          color: AppColors.text(context),
                                        ),
                                      ),
                                    ),
                                    ShareLinkButton(path: '/contracts?id=${c.id}', title: 'Share agreement'),
                                    _statusChip(c.status),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                Row(
                                  children: [
                                    TextButton.icon(
                                      onPressed: () => _open(c),
                                      icon: const Icon(Icons.open_in_new_rounded, size: 16),
                                      label: const Text('View PDF'),
                                      style: TextButton.styleFrom(foregroundColor: AppColors.text(context)),
                                    ),
                                    if (!c.isAccepted)
                                      TextButton.icon(
                                        onPressed: () => _accept(c),
                                        icon: const Icon(Icons.check_rounded, size: 16),
                                        label: const Text('Accept'),
                                        style: TextButton.styleFrom(foregroundColor: AppColors.accent(context)),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        }),
                      ],
                    ),
            ),
    );
  }

  Widget _statusChip(String status) {
    final color = status == 'ACCEPTED'
        ? AppColors.green
        : status == 'VIEWED'
            ? AppColors.accent(context)
            : AppColors.text3(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.toLowerCase(),
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
