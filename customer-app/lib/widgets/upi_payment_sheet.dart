import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

class UpiPaymentSheet extends StatefulWidget {
  final Map<String, dynamic> invoice;
  const UpiPaymentSheet({super.key, required this.invoice});
  @override
  State<UpiPaymentSheet> createState() => _UpiPaymentSheetState();
}

class _UpiPaymentSheetState extends State<UpiPaymentSheet> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  Map<String, dynamic>? _options;
  String? _error;
  bool _busy = false;
  @override
  void initState() {
    super.initState();
    _amount.text = '${widget.invoice['balance'] ?? ''}';
    _load();
  }
  @override
  void dispose() { _amount.dispose(); _reference.dispose(); super.dispose(); }
  Future<void> _load() async {
    try {
      final response = await ApiService.dio.get('/billing/invoices/${widget.invoice['id']}/payment-options');
      if (mounted) setState(() { _options = Map<String, dynamic>.from(ApiService.unwrapData(response)); _error = null; });
    } catch (_) { if (mounted) setState(() => _error = 'Could not load payment details. Please try again.'); }
  }
  Future<void> _report() async {
    final amount = double.tryParse(_amount.text.trim());
    if (amount == null || !amount.isFinite || amount <= 0 || _reference.text.trim().length < 6) {
      setState(() => _error = 'Enter the amount paid and the reference / UTR from your payment app.'); return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await ApiService.dio.post('/billing/invoices/${widget.invoice['id']}/payment-claims', data: {'amount': amount, 'reference': _reference.text.trim()});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payment reported. The studio will verify it and issue your receipt.')));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    } finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _launch(String upi) async {
    final uri = Uri(scheme: 'upi', host: 'pay', queryParameters: {'pa': upi, 'pn': '${_options?['payeeName'] ?? 'Studio'}', 'cu': 'INR', 'am': _amount.text.trim(), 'tn': '${widget.invoice['invoiceNumber']}'});
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) throw Exception();
    } catch (_) { if (mounted) setState(() => _error = 'Open your UPI app and pay using the QR or copied UPI ID below.'); }
  }
  @override
  Widget build(BuildContext context) {
    final qr = _options?['qrUrl']?.toString() ?? _options?['paymentQrUrl']?.toString() ?? '';
    final upi = _options?['upiId']?.toString() ?? '';
    final claims = (_options?['claims'] as List?) ?? [];
    return SafeArea(child: Padding(padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom), child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [const Expanded(child: Text('Pay the studio', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold))), IconButton(onPressed: _busy ? null : () => Navigator.pop(context), icon: const Icon(Icons.close))]),
      Text('${widget.invoice['invoiceNumber']} · Pay using UPI, then share your reference number. Your balance changes after studio verification.'),
      const SizedBox(height: 16),
      if (_options == null && _error == null) const Center(child: CircularProgressIndicator()),
      if (qr.isNotEmpty) Image.network(qr, height: 220, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Text('QR could not load. Use the UPI ID or contact the studio.')),
      if (qr.isNotEmpty) ...[
        const Text('On one phone, save or screenshot this QR, then import it in your UPI app. Check the payee and amount before paying.'),
        TextButton(onPressed: () async { await launchUrl(Uri.parse(qr), mode: LaunchMode.externalApplication); }, child: const Text('Open QR to save')),
      ],
      if (upi.isNotEmpty) ...[
        TextButton.icon(onPressed: () async { await Clipboard.setData(ClipboardData(text: upi)); if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('UPI ID copied'))); }, icon: const Icon(Icons.copy), label: Text(upi)),
        OutlinedButton(onPressed: _busy ? null : () => _launch(upi), child: const Text('Open UPI app')),
      ],
      if (_options != null && qr.isEmpty && upi.isEmpty) const Text('Contact the studio for payment details. If you have already paid, report the reference below.'),
      for (final claim in claims) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text('₹${claim['amount']} · ${claim['status'] == 'PENDING' ? 'Waiting for studio verification' : claim['status'] == 'CONFIRMED' ? 'Verified' : 'Not verified — ${claim['note'] ?? 'contact studio'}'}')),
      const SizedBox(height: 16),
      TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount paid (₹)')),
      const SizedBox(height: 12),
      TextField(controller: _reference, maxLength: 120, decoration: const InputDecoration(labelText: 'Payment reference / UTR', helperText: 'Find this in your UPI app’s payment details')),
      if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      if (_options == null && _error != null) TextButton(onPressed: _load, child: const Text('Try again')),
      FilledButton(onPressed: _busy || _options == null ? null : _report, child: Text(_busy ? 'Sending…' : 'I have paid — send for verification')),
    ]))));
  }
}
