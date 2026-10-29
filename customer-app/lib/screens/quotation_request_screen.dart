import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';

class QuotationRequestScreen extends StatefulWidget {
  final String? studioId, requestId, token;
  const QuotationRequestScreen(
      {super.key, this.studioId, this.requestId, this.token});
  @override
  State<QuotationRequestScreen> createState() => _QuotationRequestScreenState();
}

class _QuotationRequestScreenState extends State<QuotationRequestScreen> {
  final _form = GlobalKey<FormState>();
  final _scroll = ScrollController();
  final _name = TextEditingController(),
      _phone = TextEditingController(),
      _email = TextEditingController();
  final _venue = TextEditingController(),
      _organization = TextEditingController(),
      _deliverables = TextEditingController(),
      _notes = TextEditingController(),
      _guests = TextEditingController();
  final _quantities = <String, int>{};
  Map<String, dynamic>? _catalog, _receipt;
  String _kind = 'WEDDING', _countryCode = '+91', _budget = '';
  int _step = 0, _days = 1, _albums = 1;
  bool _flexible = false, _album = false, _busy = false, _sent = false;
  DateTimeRange? _range;
  String? _error;
  bool get _public => widget.studioId != null;
  bool get _tracking => widget.requestId != null && widget.token != null;
  String get _base => '/quotation-requests/${widget.studioId}';
  String get _receiptBase => '$_base/${widget.requestId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    for (final c in [
      _name,
      _phone,
      _email,
      _venue,
      _organization,
      _deliverables,
      _notes,
      _guests
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final response = await ApiService.dio.get(
          _public ? '$_base/catalog' : '/portal/quotation-requests/catalog');
      final catalog =
          Map<String, dynamic>.from(ApiService.unwrapData(response) as Map);
      Map<String, dynamic>? receipt;
      if (_tracking) {
        final r = await ApiService.dio.get(_receiptBase,
            options: Options(headers: {'X-Quotation-Token': widget.token}));
        receipt = Map<String, dynamic>.from(ApiService.unwrapData(r) as Map);
      }
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _receipt = receipt;
        _budget = _budget.isEmpty
            ? (catalog['budgetTiers'] as List).last['id'].toString()
            : _budget;
      });
      if (!_public) {
        try {
          final profile = await PortalApi.profile();
          if (!mounted) return;
          if (_name.text.isEmpty) {
            _name.text = profile['name']?.toString() ?? '';
          }
          if (_phone.text.isEmpty) {
            _phone.text = profile['phone']?.toString() ?? '';
          }
          if (_email.text.isEmpty) {
            _email.text = profile['email']?.toString() ?? '';
          }
        } catch (_) {/* The form can still be completed manually. */}
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    }
  }

  String _date(DateTime value) => DateFormat('yyyy-MM-dd').format(value);
  String get _dateLabel => _flexible
      ? 'Dates to be decided · $_days coverage day${_days == 1 ? '' : 's'}'
      : _range == null
          ? 'Choose start & end dates'
          : '${DateFormat('d MMM y').format(_range!.start)} – ${DateFormat('d MMM y').format(_range!.end)} · $_days coverage day${_days == 1 ? '' : 's'}';
  List<Map> get _types => [
        {'id': 'WEDDING', 'label': 'Wedding'},
        ...(_catalog?['eventTypes'] as List? ?? [])
            .where((t) => t['id'] != 'WEDDING')
            .cast<Map>()
      ];
  String _label(String field, String id) => ((_catalog?[field] as List? ?? [])
          .cast<Map>()
          .firstWhere((r) => r['id'] == id,
              orElse: () => {'label': id})['label'])
      .toString();
  Future<void> _pickDates() async {
    final now = DateUtils.dateOnly(DateTime.now());
    final range = await showDateRangePicker(
        context: context,
        initialDateRange: _range,
        firstDate: now,
        lastDate: DateTime(now.year + 5),
        helpText: 'Event start and end dates');
    if (range != null && mounted) {
      setState(() {
        _range = range;
        _flexible = false;
        _days = _days.clamp(1, range.duration.inDays + 1);
        _error = null;
      });
    }
  }

  Future<void> _next() async {
    if (!_form.currentState!.validate()) return;
    if (_step == 0 && !_flexible && _range == null) {
      setState(
          () => _error = 'Choose your date range or select dates not decided.');
      return;
    }
    if (_step == 0 && !_flexible && _days > _range!.duration.inDays + 1) {
      setState(() => _error = 'Coverage days cannot exceed your date range.');
      return;
    }
    if (_step == 1 && _quantities.isEmpty) {
      setState(() => _error = 'Choose at least one coverage type.');
      return;
    }
    if (_step < 2) {
      _changeStep(_step + 1);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await ApiService.dio
          .post(_public ? _base : '/portal/quotation-requests', data: {
        'kind': _kind,
        'contact': {
          'name': _name.text.trim(),
          'phone': _phone.text.trim(),
          'countryCode': _countryCode,
          'email': _email.text.trim()
        },
        'venue': {'location': _venue.text.trim()},
        'organization': _organization.text.trim(),
        'dates': {
          'flexible': _flexible,
          'dayCount': _days,
          'start': _range == null ? null : _date(_range!.start),
          'end': _range == null ? null : _date(_range!.end)
        },
        'services': _quantities.keys.toList(),
        'crewCounts': _quantities,
        'album': {'needed': _album, 'count': _albums},
        'budgetTier': _budget,
        'guestCount': int.tryParse(_guests.text),
        'deliverables': _deliverables.text.trim(),
        'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      final body = ApiService.unwrapData(response) as Map;
      if (_public) {
        context.go((body['receiptSharePath'] ?? body['receiptPath']).toString());
      } else {
        setState(() => _sent = true);
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _changeStep(int step) {
    setState(() {
      _step = step;
      _error = null;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) {
        _scroll.animateTo(0,
            duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  Widget _field(String label, TextEditingController controller,
          {bool required = false,
          int lines = 1,
          int maxLength = 160,
          TextInputType? keyboard}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextFormField(
            controller: controller,
            maxLines: lines,
            maxLength: maxLength,
            keyboardType: keyboard,
            decoration: InputDecoration(
                labelText: label, counterText: '', filled: true),
            validator: (v) {
              final value = (v ?? '').trim();
              if (required && value.isEmpty) {
                return 'Please enter ${label.toLowerCase()}';
              }
              if (controller == _name && value.length < 2) {
                return 'Enter your full name';
              }
              if (controller == _phone &&
                  (value.replaceAll(RegExp(r'\D'), '').length < 7 ||
                      value.replaceAll(RegExp(r'\D'), '').length > 15)) {
                return 'Enter a valid phone number';
              }
              if (controller == _email &&
                  value.isNotEmpty &&
                  !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value)) {
                return 'Enter a valid email';
              }
              if (controller == _guests &&
                  value.isNotEmpty &&
                  (int.tryParse(value) == null ||
                      int.parse(value) < 1 ||
                      int.parse(value) > 100000)) {
                return 'Enter 1 to 100,000 guests';
              }
              return null;
            }),
      );
  Widget _summary(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: TextStyle(color: AppColors.text2(context), fontSize: 12)),
        const SizedBox(height: 4),
        Text(value.isEmpty ? 'Not specified' : value),
      ]));
  Future<void> _copyReceipt() async {
    String? url;
    try {
      final response = await ApiService.dio.post('$_receiptBase/share-link', options: Options(headers: {'X-Quotation-Token': widget.token}));
      url = (ApiService.unwrapData(response) as Map)['url'] as String;
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Private tracking link copied')));
      }
    } catch (_) {
      if (mounted && url == null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not prepare the tracking link. Please try again.')));
      } else if (mounted) {
        await showDialog<void>(
            context: context,
            builder: (ctx) => AlertDialog(
                    title: const Text('Save your tracking link'),
                    content: SelectableText(url!),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('Close'))
                    ]));
      }
    }
  }

  Future<void> _openPdf(Map quote) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await ApiService.dio.get(
          '$_receiptBase/quotes/${quote['id']}/pdf',
          options: Options(headers: {'X-Quotation-Token': widget.token}));
      final body = ApiService.unwrapData(response) as Map;
      if (!await launchUrl(Uri.parse(body['url'].toString()),
          mode: LaunchMode.externalApplication, webOnlyWindowName: '_self')) {
        throw StateError('Could not open PDF. Please try again.');
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _trackingContent() {
    final inquiry = _receipt!['inquiry'] as Map;
    final quotes = _receipt!['quotes'] as List? ?? [];
    const statuses = {
      'PENDING': 'Request received',
      'IN_REVIEW': 'Preparing your quotation',
      'APPROVED': 'Accepted',
      'BOOKED': 'Booking confirmed',
      'REJECTED': 'Request closed'
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Icon(Icons.check_circle_outline, size: 48),
      const SizedBox(height: 20),
      Text('Your plans are with us',
          style: AppTheme.display(30, context: context)),
      const SizedBox(height: 12),
      Text(
          '${statuses[inquiry['inquiryStatus']] ?? 'Request received'} · ${inquiry['shortId']}'),
      const SizedBox(height: 16),
      const Text(
          'Save your private tracking link. Return here to see updates and download your quotation PDF. Anyone with this link can view your request.'),
      const SizedBox(height: 16),
      OutlinedButton.icon(
          onPressed: _copyReceipt,
          icon: const Icon(Icons.link),
          label: const Text('Copy tracking link')),
      _summary('Event',
          (inquiry['form']?['eventType'] ?? inquiry['inquiryKind']).toString()),
      _summary('Dates', inquiry['datesLabel']?.toString() ?? ''),
      _summary('Location', inquiry['venueLabel']?.toString() ?? ''),
      _summary('Coverage', inquiry['servicesLabel']?.toString() ?? ''),
      const Divider(height: 32),
      if (quotes.isEmpty)
        const Text(
            'Your PDF will appear here once the studio has prepared it. Your dates are confirmed only after booking.'),
      for (final q in quotes)
        Card(
            child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(q['title'].toString(),
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      if (q['hasPdf'] == true)
                        FilledButton.icon(
                            onPressed: _busy ? null : () => _openPdf(q as Map),
                            icon: const Icon(Icons.picture_as_pdf_outlined),
                            label: const Text('View quotation PDF')),
                    ]))),
      const SizedBox(height: 20),
      TextButton.icon(
          onPressed: _busy ? null : _load,
          icon: const Icon(Icons.refresh),
          label: const Text('Refresh status')),
    ]);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: Text(
                _tracking ? 'Your quotation request' : 'Request a quotation')),
        bottomNavigationBar: _catalog != null && !_tracking && !_sent
            ? SafeArea(
                top: false,
                child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
                    child: Center(
                        heightFactor: 1,
                        child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 672),
                            child: Row(children: [
                              if (_step > 0) ...[
                                TextButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _changeStep(_step - 1),
                                    child: const Text('Back')),
                                const SizedBox(width: 16)
                              ],
                              Expanded(
                                  child: FilledButton(
                                      onPressed: _busy ? null : _next,
                                      child: Text(_busy
                                          ? 'Sending…'
                                          : _step == 2
                                              ? 'Send quotation request'
                                              : 'Continue'))),
                            ])))))
            : null,
        body: SafeArea(
            child: Center(
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: Form(
                        key: _form,
                        child: ListView(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(24, 24, 24, 48),
                          children: [
                            if (_error != null) ...[
                              Container(
                                  padding: const EdgeInsets.all(16),
                                  margin: const EdgeInsets.only(bottom: 20),
                                  decoration: BoxDecoration(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .errorContainer,
                                      borderRadius: BorderRadius.circular(12)),
                                  child: Text(_error!,
                                      style: TextStyle(
                                          color: Theme.of(context)
                                              .colorScheme
                                              .onErrorContainer))),
                              if (_catalog == null ||
                                  (_tracking && _receipt == null))
                                TextButton(
                                    onPressed: _load,
                                    child: const Text('Try again'))
                            ],
                            if (_catalog == null && _error == null)
                              const Center(child: CircularProgressIndicator()),
                            if (_sent) ...[
                              const Icon(Icons.check_circle_outline, size: 56),
                              const SizedBox(height: 24),
                              Text('Request sent',
                                  style:
                                      AppTheme.display(32, context: context)),
                              const SizedBox(height: 12),
                              const Text(
                                  'The studio will review your plans and prepare your PDF. You can track this request in My requests & quotations.'),
                              const SizedBox(height: 24),
                              FilledButton(
                                  onPressed: () => context.go('/quotes'),
                                  child: const Text('View my requests')),
                            ] else if (_tracking && _receipt != null)
                              _trackingContent()
                            else if (_catalog != null && !_tracking) ...[
                              if (_public) ...[
                                Text(_catalog!['studioName']?.toString() ?? '',
                                    style:
                                        Theme.of(context).textTheme.labelLarge),
                                const SizedBox(height: 12)
                              ],
                              Text('Let’s bring your plans to life.',
                                  style:
                                      AppTheme.display(32, context: context)),
                              const SizedBox(height: 12),
                              const Text(
                                  'Tell us about your wedding or event. We’ll put together a quotation shaped around what you need.'),
                              const SizedBox(height: 28),
                              LinearProgressIndicator(value: (_step + 1) / 3),
                              const SizedBox(height: 12),
                              Text('STEP ${_step + 1} OF 3 · ${[
                                'Your event',
                                'Coverage & contact',
                                'Review & send'
                              ][_step]}'),
                              const SizedBox(height: 28),
                              if (_step == 0) ...[
                                DropdownButtonFormField<String>(
                                    initialValue: _kind,
                                    isExpanded: true,
                                    decoration: const InputDecoration(
                                        labelText: 'Event type'),
                                    items: _types
                                        .map((t) => DropdownMenuItem(
                                            value: t['id'].toString(),
                                            child: Text(t['label'].toString())))
                                        .toList(),
                                    onChanged: (v) =>
                                        setState(() => _kind = v!)),
                                const SizedBox(height: 20),
                                if (_kind == 'CORPORATE' || _kind == 'PRODUCT')
                                  _field('Organisation / company (optional)',
                                      _organization),
                                _field('Venue or city', _venue,
                                    required: true, maxLength: 200),
                                OutlinedButton.icon(
                                    onPressed: _pickDates,
                                    icon: const Icon(Icons.date_range),
                                    label: Text(_dateLabel)),
                                CheckboxListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: const Text('Dates not decided yet'),
                                    value: _flexible,
                                    onChanged: (v) =>
                                        setState(() => _flexible = v!)),
                                DropdownButtonFormField<int>(
                                    key: ValueKey(_days),
                                    initialValue: _days,
                                    decoration: const InputDecoration(
                                        labelText:
                                            'How many days of coverage?'),
                                    items: List.generate(
                                        30,
                                        (i) => DropdownMenuItem(
                                            value: i + 1,
                                            child: Text(
                                                '${i + 1} day${i == 0 ? '' : 's'}'))),
                                    onChanged: (v) =>
                                        setState(() => _days = v!)),
                                const SizedBox(height: 20),
                                _field('Expected guests (optional)', _guests,
                                    keyboard: TextInputType.number,
                                    maxLength: 6),
                              ],
                              if (_step == 1) ...[
                                Text('What coverage do you need?',
                                    style:
                                        Theme.of(context).textTheme.titleLarge),
                                const SizedBox(height: 8),
                                const Text(
                                    'Choose your services and the number of people or units you need.'),
                                const SizedBox(height: 16),
                                for (final s in _catalog!['services'] as List)
                                  Card(
                                      margin: const EdgeInsets.only(bottom: 8),
                                      child: Padding(
                                          padding: const EdgeInsets.all(8),
                                          child: Column(children: [
                                            CheckboxListTile(
                                                title:
                                                    Text(s['label'].toString()),
                                                value: _quantities
                                                    .containsKey(s['id']),
                                                onChanged: (v) => setState(() {
                                                      if (v == true) {
                                                        _quantities[s['id']
                                                            .toString()] = 1;
                                                      } else {
                                                        _quantities
                                                            .remove(s['id']);
                                                      }
                                                    })),
                                            if (_quantities.containsKey(s['id']))
                                              Padding(
                                                  padding:
                                                      const EdgeInsets.fromLTRB(
                                                          16, 0, 16, 12),
                                                  child: DropdownButtonFormField<int>(
                                                      initialValue:
                                                          _quantities[s['id']],
                                                      decoration: InputDecoration(
                                                          labelText:
                                                              '${s['label']} quantity'),
                                                      items: List.generate(
                                                          50,
                                                          (i) => DropdownMenuItem(
                                                              value: i + 1,
                                                              child: Text(
                                                                  '${i + 1}'))),
                                                      onChanged: (v) =>
                                                          setState(() => _quantities[s['id'].toString()] = v!))),
                                          ]))),
                                const SizedBox(height: 12),
                                SwitchListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: const Text(
                                        'Do you need a physical album?'),
                                    subtitle: Text(_album
                                        ? 'Yes, include a printed album'
                                        : 'No printed album'),
                                    value: _album,
                                    onChanged: (v) =>
                                        setState(() => _album = v)),
                                if (_album) ...[
                                  DropdownButtonFormField<int>(
                                      initialValue: _albums,
                                      decoration: const InputDecoration(
                                          labelText: 'How many albums?'),
                                      items: List.generate(
                                          20,
                                          (i) => DropdownMenuItem(
                                              value: i + 1,
                                              child: Text('${i + 1}'))),
                                      onChanged: (v) =>
                                          setState(() => _albums = v!)),
                                  const SizedBox(height: 20)
                                ],
                                _field(
                                    'What exactly would you like delivered? (optional)',
                                    _deliverables,
                                    lines: 3,
                                    maxLength: 1500),
                                DropdownButtonFormField<String>(
                                    initialValue: _budget,
                                    decoration: const InputDecoration(
                                        labelText: 'Budget preference'),
                                    items: (_catalog!['budgetTiers'] as List)
                                        .map((r) => DropdownMenuItem(
                                            value: r['id'].toString(),
                                            child: Text(r['label'].toString())))
                                        .toList(),
                                    onChanged: (v) =>
                                        setState(() => _budget = v!)),
                                const SizedBox(height: 28),
                                Text('How can we reach you?',
                                    style:
                                        Theme.of(context).textTheme.titleLarge),
                                const SizedBox(height: 16),
                                _field('Full name', _name,
                                    required: true, maxLength: 120),
                                DropdownButtonFormField<String>(
                                    initialValue: _countryCode,
                                    decoration: const InputDecoration(
                                        labelText: 'Phone country code'),
                                    items: const [
                                      DropdownMenuItem(
                                          value: '+91',
                                          child: Text('India (+91)')),
                                      DropdownMenuItem(
                                          value: '+1',
                                          child: Text('US / Canada (+1)')),
                                      DropdownMenuItem(
                                          value: '+44',
                                          child: Text('UK (+44)')),
                                      DropdownMenuItem(
                                          value: '+971',
                                          child: Text('UAE (+971)')),
                                      DropdownMenuItem(
                                          value: '+65',
                                          child: Text('Singapore (+65)')),
                                      DropdownMenuItem(
                                          value: '+61',
                                          child: Text('Australia (+61)'))
                                    ],
                                    onChanged: (v) =>
                                        setState(() => _countryCode = v!)),
                                const SizedBox(height: 16),
                                _field('Phone number', _phone,
                                    required: true,
                                    keyboard: TextInputType.phone,
                                    maxLength: 20),
                                _field('Email (optional)', _email,
                                    keyboard: TextInputType.emailAddress),
                                _field(
                                    'Anything else we should know? (optional)',
                                    _notes,
                                    lines: 3,
                                    maxLength: 4000),
                              ],
                              if (_step == 2) ...[
                                Text('Every detail, in one place.',
                                    style:
                                        Theme.of(context).textTheme.titleLarge),
                                const SizedBox(height: 12),
                                _summary(
                                    'Event',
                                    _types
                                        .firstWhere(
                                            (t) => t['id'] == _kind)['label']
                                        .toString()),
                                if (_organization.text.isNotEmpty)
                                  _summary('Organisation', _organization.text),
                                _summary('Dates & coverage days', _dateLabel),
                                _summary('Location', _venue.text),
                                if (_guests.text.isNotEmpty)
                                  _summary('Expected guests', _guests.text),
                                _summary(
                                    'Coverage & quantities',
                                    _quantities.entries
                                        .map((e) =>
                                            '${_label('services', e.key)} × ${e.value}')
                                        .join('\n')),
                                _summary(
                                    'Physical album',
                                    _album
                                        ? 'Yes · $_albums album${_albums == 1 ? '' : 's'}'
                                        : 'No'),
                                _summary('Requested deliverables',
                                    _deliverables.text),
                                _summary(
                                    'Budget', _label('budgetTiers', _budget)),
                                _summary(
                                    'Contact',
                                    [
                                      _name.text,
                                      '$_countryCode ${_phone.text}',
                                      _email.text
                                    ].where((s) => s.isNotEmpty).join('\n')),
                                if (_notes.text.isNotEmpty)
                                  _summary('Additional notes', _notes.text),
                                const SizedBox(height: 16),
                                const Text(
                                    'Sending this request helps us prepare your quotation. Your dates will be confirmed when you book.'),
                              ],
                              const SizedBox(height: 28),
                            ],
                          ],
                        ))))),
      );
}
