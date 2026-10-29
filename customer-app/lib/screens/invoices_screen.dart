import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import '../widgets/share_link_button.dart';
import 'package:intl/intl.dart';
import '../widgets/upi_payment_sheet.dart';
import '../services/download_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';
import 'pdf_viewer_screen.dart';

class InvoicesScreen extends StatefulWidget {
  final String? highlightId;
  final bool embedded;
  const InvoicesScreen({super.key, this.highlightId, this.embedded = false});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  List<dynamic> _items = [];
  Map<String, dynamic>? _summary;
  List<dynamic> _timeline = [];
  Map<String, dynamic>? _packagePending;
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _detail;
  bool _pdfBusy = false;
  bool _highlightOpened = false;
  final _couponCtrl = TextEditingController();
  bool _couponBusy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _couponCtrl.dispose();
    super.dispose();
  }

  Future<void> _applyCoupon() async {
    final id = _detail?['id']?.toString();
    final code = _couponCtrl.text.trim();
    if (id == null || code.isEmpty) return;
    setState(() => _couponBusy = true);
    try {
      final r = await PortalApi.applyInvoiceCoupon(id, code);
      if (!mounted) return;
      final inv = r['invoice'];
      if (inv is Map) {
        setState(() => _detail = Map<String, dynamic>.from(inv));
      } else {
        await _openDetail(id);
      }
      if (!mounted) return;
      _couponCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Coupon applied — saved ${r['discountAmount'] ?? ''} · final ${r['finalAmount'] ?? ''}',
          ),
          backgroundColor: AppColors.text(context),
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: AppColors.rose,
        ),
      );
    } finally {
      if (mounted) setState(() => _couponBusy = false);
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      Map<String, dynamic>? account;
      List list = const [];
      try {
        account = await PortalApi.billingAccount();
        list = (account['invoices'] as List?) ?? [];
      } catch (_) {
        list = await PortalApi.invoices();
      }
      final detailId = _detail?['id']?.toString();
      if (!mounted) return;
      setState(() {
        _items = list;
        _summary = account?['summary'] is Map
            ? Map<String, dynamic>.from(account!['summary'] as Map)
            : null;
        _timeline = account?['timeline'] is List
            ? List<dynamic>.from(account!['timeline'] as List)
            : [];
        _packagePending = account?['packagePending'] is Map
            ? Map<String, dynamic>.from(account!['packagePending'] as Map)
            : null;
        _loading = false;
      });
      if (detailId != null) await _openDetail(detailId);
      if (widget.highlightId != null && !_highlightOpened) {
        _highlightOpened = true;
        await _openDetail(widget.highlightId!);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openDetail(String id) async {
    try {
      final inv = await PortalApi.invoice(id);
      if (!mounted) return;
      setState(() => _detail = inv);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open invoice: $e'), backgroundColor: AppColors.rose),
      );
    }
  }

  Future<void> _openPdf({bool download = false, String? receiptId}) async {
    final id = _detail?['id']?.toString();
    if (id == null || id.isEmpty) return;
    setState(() => _pdfBusy = true);
    try {
      final data = receiptId == null ? await PortalApi.invoicePdf(id) : await PortalApi.receiptPdf(receiptId);
      final url = data['url']?.toString();
      final b64 = data['base64']?.toString();
      final filename = data['filename']?.toString() ??
          '${_detail?['invoiceNumber'] ?? 'invoice'}.pdf';
      if ((b64 == null || b64.isEmpty) && (url == null || url.isEmpty)) {
        throw Exception('PDF not available');
      }
      if (download) {
        await DownloadService.openPdf(
          url: url,
          base64Data: b64,
          filename: filename,
          download: true,
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: const Text('Invoice PDF ready'), backgroundColor: AppColors.text(context)),
          );
        }
        return;
      }
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PdfViewerScreen(
            title: receiptId == null ? (_detail?['invoiceNumber']?.toString() ?? 'Invoice') : 'Payment receipt',
            url: url,
            base64Data: b64,
            filename: filename,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open PDF: $e'), backgroundColor: AppColors.rose),
      );
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  Future<void> _payUpi() async {
    final invoice = _detail;
    if (invoice == null) return;
    await showModalBottomSheet(context: context, isScrollControlled: true,
      builder: (_) => UpiPaymentSheet(invoice: invoice));
    if (mounted) await _load();
  }

  String _money(dynamic amount, [String currency = 'INR']) {
    final n = amount is num ? amount.toDouble() : double.tryParse('$amount') ?? 0;
    return NumberFormat.currency(locale: 'en_IN', name: currency, symbol: currency == 'INR' ? '₹' : '$currency ', decimalDigits: n == n.roundToDouble() ? 0 : 2).format(n);
  }

  /// Never show raw DRAFT/SENT/FINALIZED/VOID to the customer.
  String _statusLabel(Map<String, dynamic> inv) {
    final explicit = inv['statusLabel']?.toString();
    if (explicit != null && explicit.isNotEmpty) return explicit;
    final raw = (inv['status']?.toString() ?? '').toUpperCase();
    if (raw == 'VOID') return 'Cancelled';
    final totals = inv['totals'] is Map ? Map<String, dynamic>.from(inv['totals'] as Map) : null;
    final total = (totals?['total'] as num?)?.toDouble()
        ?? (inv['totalAmount'] as num?)?.toDouble()
        ?? 0;
    final paid = (totals?['cashPaid'] as num?)?.toDouble()
        ?? (inv['cashPaid'] as num?)?.toDouble()
        ?? (inv['amountPaid'] as num?)?.toDouble()
        ?? 0;
    final due = (totals?['outstanding'] as num?)?.toDouble()
        ?? (inv['balance'] as num?)?.toDouble()
        ?? (total - paid).clamp(0, double.infinity);

    if (raw == 'PAID' || raw == 'WRITTEN_OFF' || due <= 0) return "Nothing due — you're all paid up";
    if (paid > 0.01) {
      return 'Partially paid — ${_money(paid, inv['currency']?.toString() ?? 'INR')} of ${_money(total, inv['currency']?.toString() ?? 'INR')}';
    }
    return '${_money(due, inv['currency']?.toString() ?? 'INR')} due';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        automaticallyImplyLeading: !widget.embedded,
        actions: [ShareLinkButton(path: _detail == null ? '/invoices' : '/invoices?id=${_detail!['id']}', title: 'Share billing link')],
        backgroundColor: AppColors.bg(context),
        title: Text(_detail == null ? 'Billing' : 'Invoice details', style: AppTheme.display(22)),
        leading: _detail != null
            ? IconButton(
                icon: const Icon(Icons.arrow_back_rounded),
                onPressed: () => setState(() => _detail = null),
              )
            : const AppBackButton(),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context)))
          : _error != null
              ? Center(child: EmptyState(icon: Icons.cloud_off_outlined, title: 'Billing couldn’t load', subtitle: 'Your payment history is safe. Check your connection and try again.', action: FilledButton(onPressed: _load, child: const Text('Try again'))))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _detail != null ? _detailView(_detail!) : _listView(),
                ),
    );
  }

  Widget _listView() {
    final currency = _summary?['currency']?.toString() ?? 'INR';
    if (_items.isEmpty) {
      return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpace.md),
        children: [
          const SizedBox(height: AppSpace.xl),
          const Text(
            'Your billing, all together',
            textAlign: TextAlign.center,
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
          ),
          const SizedBox(height: AppSpace.xs),
          Text(
            'When your studio sends a bill, you will see the full amount, what you have paid, and what is still due — all in one place.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.text2(context), height: 1.4),
          ),
        ],
      );
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xs, AppSpace.page, AppSpace.bottomNav),
      children: [
        if (_summary != null) ...[
          GlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'YOUR ACCOUNT',
                  style: AppTheme.kicker(color: AppColors.goldDark),
                ),
                const SizedBox(height: 12),
                Text(
                  (_summary!['headline'] ?? _summary!['statusLabel'] ?? _money(_summary!['balance'], currency))
                      .toString(),
                  style: AppTheme.display(26, color: Colors.white),
                ),
                const SizedBox(height: 6),
                Text(
                  'Paid ${_money(_summary!['paid'], currency)} of ${_money(_summary!['billed'], currency)}',
                  style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 14),
                Builder(builder: (_) {
                  final billed = (_summary!['billed'] as num?)?.toDouble() ?? 0;
                  final paid = (_summary!['paid'] as num?)?.toDouble() ?? 0;
                  final pct = billed > 0 ? (paid / billed).clamp(0.0, 1.0) : 0.0;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(99),
                        child: TweenAnimationBuilder<double>(
                          tween: Tween(begin: 0, end: pct),
                          duration: const Duration(milliseconds: 800),
                          curve: Curves.easeOutCubic,
                          builder: (_, v, __) => LinearProgressIndicator(
                            value: v,
                            minHeight: 8,
                            backgroundColor: Colors.white24,
                            color: AppColors.goldDark,
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${(pct * 100).round()}% paid',
                        style: const TextStyle(color: Colors.white60, fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ],
                  );
                }),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _miniStatGlass('Billed', _money(_summary!['billed'], currency)),
                    ),
                    Expanded(
                      child: _miniStatGlass('Paid', _money(_summary!['paid'], currency)),
                    ),
                    if (((_summary!['adjusted'] as num?) ?? 0) > 0)
                      Expanded(
                        child: _miniStatGlass('Adjusted', _money(_summary!['adjusted'], currency)),
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (_packagePending?['pending'] == true) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.amber.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppSpace.radiusLg),
                border: Border.all(color: AppColors.amber.withValues(alpha: 0.35)),
              ),
              child: Text(
                (_packagePending!['message'] ??
                        'Awaiting studio confirmation — they will send your invoice shortly.')
                    .toString(),
                style: TextStyle(
                  color: AppColors.text(context),
                  fontSize: 13,
                  height: 1.4,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
          if (_timeline.isNotEmpty) ...[
            const SizedBox(height: 18),
            Text(
              'Timeline',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.text(context)),
            ),
            const SizedBox(height: 10),
            ..._timeline.take(12).map((raw) {
              final e = Map<String, dynamic>.from(raw as Map);
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.only(top: 5, right: 10),
                      decoration: BoxDecoration(
                        color: AppColors.text3(context),
                        shape: BoxShape.circle,
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            e['title']?.toString() ?? '',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                              color: AppColors.text(context),
                            ),
                          ),
                          if (e['subtitle'] != null)
                            Text(
                              e['subtitle'].toString(),
                              style: TextStyle(fontSize: 12, color: AppColors.text3(context)),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
          const SizedBox(height: 18),
          Text(
            'Invoices',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.text(context)),
          ),
          const SizedBox(height: 10),
        ],
        ..._items.map((raw) {
          final inv = Map<String, dynamic>.from(raw as Map);
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Material(
              color: AppColors.card(context),
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => _openDetail(inv['id'].toString()),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        inv['invoiceNumber']?.toString() ?? '',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                          color: AppColors.text2(context),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(inv['title']?.toString() ?? 'Invoice', style: AppTheme.display(18)),
                      const SizedBox(height: 8),
                      Text(
                        _statusLabel(inv),
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                          color: AppColors.text(context),
                          height: 1.35,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Builder(builder: (_) {
                        final totals = inv['totals'] is Map
                            ? Map<String, dynamic>.from(inv['totals'] as Map)
                            : null;
                        final total = (totals?['total'] as num?)?.toDouble()
                            ?? (inv['totalAmount'] as num?)?.toDouble()
                            ?? 0;
                        final paid = (totals?['cashPaid'] as num?)?.toDouble()
                            ?? (inv['cashPaid'] as num?)?.toDouble()
                            ?? (inv['amountPaid'] as num?)?.toDouble()
                            ?? 0;
                        final progress = total > 0 ? (paid / total).clamp(0.0, 1.0) : 0.0;
                        final cur = inv['currency']?.toString() ?? 'INR';
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(
                                value: progress,
                                minHeight: 6,
                                backgroundColor: AppColors.sunken(context),
                                color: AppColors.text(context),
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${_money(paid, cur)} paid of ${_money(total, cur)}',
                              style: TextStyle(color: AppColors.text3(context), fontSize: 12),
                            ),
                          ],
                        );
                      }),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _miniStatGlass(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white60, fontSize: 11, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white)),
      ],
    );
  }

  Widget _detailView(Map<String, dynamic> inv) {
    final currency = inv['currency']?.toString() ?? 'INR';
    final installments = (inv['installments'] as List?) ?? [];
    final payments = (inv['payments'] as List?) ?? [];
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xs, AppSpace.page, AppSpace.bottomNav),
      children: [
        Text(inv['invoiceNumber']?.toString() ?? '', style: AppTheme.kicker()),
        const SizedBox(height: 8),
        Text(inv['title']?.toString() ?? 'Invoice', style: AppTheme.display(28)),
        const SizedBox(height: 6),
        Text(
          _statusLabel(inv),
          style: TextStyle(color: AppColors.text2(context), fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: _pdfBusy ? null : () => _openPdf(),
                icon: _pdfBusy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                label: Text(_pdfBusy ? 'Opening…' : 'View PDF'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.text(context),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _pdfBusy ? null : () => _openPdf(download: true),
                icon: const Icon(Icons.download_rounded, size: 18),
                label: const Text('Download'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.text(context),
                  side: BorderSide(color: AppColors.border(context)),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: inv['canPay'] == true ? _payUpi : null,
            icon: const Icon(Icons.account_balance_wallet_outlined, size: 18),
            label: Text(inv['status'] == 'VOID' ? 'Invoice cancelled' : inv['canPay'] == true ? 'Pay with UPI' : 'Nothing due'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.text(context),
              side: BorderSide(color: AppColors.border(context)),
              padding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ),
        const SizedBox(height: 18),
        _card(
          child: Column(
            children: [
              _kv('Total billed', _money(inv['totalAmount'], currency)),
              _kv('Paid', _money(inv['cashPaid'] ?? inv['amountPaid'], currency)),
              if (((inv['adjusted'] as num?) ?? 0) > 0) _kv('Adjustments', _money(inv['adjusted'], currency)),
              _kv('Balance due', _money(inv['balance'], currency)),
              if (((inv['taxAmount'] as num?) ?? 0) > 0) _kv(inv['taxLabel']?.toString() ?? 'Tax included', _money(inv['taxAmount'], currency)),
              if (inv['discountAmount'] != null && (inv['discountAmount'] as num) > 0)
                _kv('Discount', _money(inv['discountAmount'], currency)),
              if ((inv['couponCode'] as String?)?.isNotEmpty == true)
                _kv('Coupon', inv['couponCode'].toString()),
            ],
          ),
        ),
        if (((inv['lineItems'] as List?) ?? []).isNotEmpty) ...[
          const SizedBox(height: AppSpace.section),
          Text('What’s included', style: AppTheme.display(20)),
          const SizedBox(height: AppSpace.sm),
          _card(child: Column(children: (inv['lineItems'] as List).map((line) =>
            _kv('${line['description']}${(line['quantity'] as num? ?? 1) > 1 ? " × ${line['quantity']}" : ""}', _money(line['lineTotal'], currency))).toList())),
        ],
        if (((inv['receipts'] as List?) ?? []).isNotEmpty) ...[
          const SizedBox(height: AppSpace.section),
          Text('Receipts', style: AppTheme.display(20)),
          const SizedBox(height: AppSpace.sm),
          ...((inv['receipts'] as List).map((receipt) => ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.receipt_long_outlined),
            title: Text('${receipt['receiptNumber']}'),
            subtitle: const Text('Verified payment · PDF'),
            trailing: const Icon(Icons.download_outlined),
            onTap: _pdfBusy ? null : () => _openPdf(receiptId: '${receipt['id']}'),
          ))),
        ],
        // Coupon apply: only on open service invoices before any payment
        if ((inv['kind'] as String?) != 'RECEIPT' &&
            inv['status']?.toString() == 'SENT' &&
            (inv['couponCode'] == null || (inv['couponCode'] as String).isEmpty) &&
            ((inv['amountPaid'] as num?) ?? 0) <= 0) ...[
          const SizedBox(height: 16),
          Text('Have a coupon?', style: AppTheme.display(18)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _couponCtrl,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    hintText: 'Enter coupon code',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton(
                onPressed: _couponBusy ? null : _applyCoupon,
                style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                child: Text(_couponBusy ? '…' : 'Apply'),
              ),
            ],
          ),
        ],
        if ((inv['terms'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 16),
          Text('Payment terms & conditions', style: AppTheme.display(18)),
          const SizedBox(height: 4),
          Text(
            'SJ Clicks and Films, Nanded · Studio by Warmkelvin',
            style: TextStyle(color: AppColors.text3(context), fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(inv['terms'].toString(), style: TextStyle(color: AppColors.text2(context), height: 1.5, fontSize: 13)),
        ],
        if ((inv['notes'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 14),
          Text('Notes', style: AppTheme.display(18)),
          const SizedBox(height: 8),
          Text(inv['notes'].toString(), style: TextStyle(color: AppColors.text2(context), height: 1.45)),
        ],
        const SizedBox(height: 20),
        Text('Installment schedule', style: AppTheme.display(20)),
        const SizedBox(height: 10),
        ...installments.map((raw) {
          final i = Map<String, dynamic>.from(raw as Map);
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.card(context),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border(context)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        i['label']?.toString() ?? 'Installment',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    Text(
                      _money(i['amount'], currency),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    () {
                      final st = (i['status']?.toString() ?? '').toUpperCase();
                      if (st == 'PAID') return 'Paid';
                      if (st == 'PARTIAL' || st == 'PARTIALLY_PAID') return 'Partially paid';
                      if (((i['remaining'] as num?) ?? 0) <= 0.01) return 'Paid';
                      return 'Upcoming';
                    }(),
                    if (((i['paidAmount'] as num?) ?? 0) > 0)
                      'Paid ${_money(i['paidAmount'], currency)}',
                    if (((i['remaining'] as num?) ?? 0) > 0.01 &&
                        i['status']?.toString() != 'PAID')
                      'Left ${_money(i['remaining'], currency)}',
                    if (i['dueDate'] != null)
                      'Due ${DateTime.tryParse(i['dueDate'].toString())?.toLocal().toString().split(' ').first ?? ''}',
                  ].where((e) => e.toString().isNotEmpty).join(' · '),
                  style: TextStyle(color: AppColors.text3(context), fontSize: 12),
                ),
                if ((i['terms'] as String?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 6),
                  Text(i['terms'].toString(), style: TextStyle(color: AppColors.text2(context), fontSize: 13, height: 1.4)),
                ],
                if ((i['notes'] as String?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 4),
                  Text(i['notes'].toString(), style: TextStyle(color: AppColors.text3(context), fontSize: 12, height: 1.35)),
                ],
              ],
            ),
          );
        }),
        if (payments.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Payment history', style: AppTheme.display(20)),
          const SizedBox(height: 10),
          ...payments.map((raw) {
            final p = Map<String, dynamic>.from(raw as Map);
            final kind = p['kind']?.toString() ?? 'PAYMENT';
            final kindLabel = kind == 'PAYMENT'
                ? 'Payment'
                : kind.replaceAll('_', ' ');
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.card(context),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.border(context)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          p['voidedAt'] != null ? 'Reversed · $kindLabel' : kindLabel,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            if (p['method'] != null) p['method'].toString(),
                            if (p['reference'] != null) 'Ref: ${p['reference']}',
                            if (p['installmentLabel'] != null) p['installmentLabel'].toString(),
                            if (p['note'] != null) p['note'].toString(),
                          ].where((e) => e.isNotEmpty).join(' · '),
                          style: TextStyle(color: AppColors.text3(context), fontSize: 12, height: 1.35),
                        ),
                        if (p['paidAt'] != null)
                          Text(
                            DateTime.tryParse(p['paidAt'].toString())
                                    ?.toLocal()
                                    .toString()
                                    .split('.')
                                    .first ??
                                '',
                            style: TextStyle(color: AppColors.text3(context), fontSize: 11),
                          ),
                      ],
                    ),
                  ),
                  Text(
                    _money(p['amount'], currency),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            );
          }),
        ],
      ],
    );
  }

  Widget _card({required Widget child}) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.card(context),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: child,
      );

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(flex: 3, child: Text(k, style: TextStyle(color: AppColors.text3(context), fontSize: 13))),
            Expanded(flex: 2, child: Text(v, textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w600))),
          ],
        ),
      );
}
