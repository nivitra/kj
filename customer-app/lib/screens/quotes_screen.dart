import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../widgets/share_link_button.dart';

class QuotesScreen extends StatefulWidget {
  final String? highlightId;
  const QuotesScreen({super.key, this.highlightId});
  @override
  State<QuotesScreen> createState() => _QuotesScreenState();
}

class _QuotesScreenState extends State<QuotesScreen> {
  List<Map<String, dynamic>>? _quotes, _requests;
  int _page = 1, _requestPage = 1, _total = 0, _requestTotal = 0;
  String? _error, _busy;
  final _money = NumberFormat.currency(locale: 'en_IN', symbol: '₹');
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ApiService.dio.get('/portal/quotes', queryParameters: {
          'page': _page,
          if (widget.highlightId != null) 'id': widget.highlightId
        }),
        if (widget.highlightId == null)
          ApiService.dio.get('/portal/quotation-requests',
              queryParameters: {'page': _requestPage}),
      ]);
      final body = ApiService.unwrapData(results.first) as Map;
      final requestsBody = results.length > 1
          ? ApiService.unwrapData(results.last) as Map
          : <String, dynamic>{};
      if (mounted) {
        setState(() {
          _quotes = (body['quotes'] as List? ?? [])
              .map((q) => Map<String, dynamic>.from(q as Map))
              .toList();
          _requests = (requestsBody['requests'] as List? ?? [])
              .map((q) => Map<String, dynamic>.from(q as Map))
              .toList();
          _total = (body['total'] as num?)?.toInt() ?? _quotes!.length;
          _requestTotal =
              (requestsBody['total'] as num?)?.toInt() ?? _requests!.length;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    }
  }

  Future<void> _accept(Map q, Map option) async {
    final yes = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
              title: const Text('Accept this package?'),
              content: Text(
                  '${option['title']}\nAgreed total: ${_money.format(option['total'])}\n\nThe studio will confirm your booking and payment milestones. Other alternatives will not be charged.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('Review again')),
                FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Accept package'))
              ],
            ));
    if (yes != true || !mounted) return;
    setState(() => _busy = q['id'].toString());
    try {
      await ApiService.dio.post('/portal/quotes/${q['id']}/accept',
          data: {'optionId': option['optionId'], 'updatedAt': q['updatedAt']});
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _openPdf(Map q) async {
    if (_busy != null) return;
    setState(() => _busy = q['id'].toString());
    try {
      // Request a fresh private URL at click time, even after a long-open screen.
      final response =
          await ApiService.dio.get('/portal/quotes/${q['id']}/pdf');
      final body = ApiService.unwrapData(response) as Map;
      final url = Uri.parse(body['url'] as String);
      if (!await launchUrl(url,
          mode: LaunchMode.externalApplication, webOnlyWindowName: '_self')) {
        throw StateError('Could not open the quotation. Please try again.');
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiService.errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(actions: const [ShareLinkButton(path: '/quotes')], leading: const AppBackButton(), title: const Text('My requests & quotations')),
        body: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
                padding: const EdgeInsets.all(20),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  if (widget.highlightId == null) ...[
                    Text('From your first plans to your final PDF.',
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    const Text(
                        'Track your requests and review every quotation from the studio.'),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                        onPressed: () => context.push('/quotation-request'),
                        icon: const Icon(Icons.add),
                        label: const Text('Request a quotation')),
                    const SizedBox(height: 28),
                  ],
                  if (_error != null) ...[
                    Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                    TextButton(onPressed: _load, child: const Text('Try again'))
                  ],
                  if (_quotes == null && _error == null)
                    const Center(child: CircularProgressIndicator()),
                  if (_quotes?.isEmpty == true)
                    Text(widget.highlightId != null
                        ? 'This quotation is unavailable. Sign in with the client account it was shared with.'
                        : 'Your quotations will appear here after the studio reviews your enquiry.'),
                  if (widget.highlightId == null && _requests != null) ...[
                    Text('Your requests',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 12),
                    if (_requests!.isEmpty)
                      const Padding(
                          padding: EdgeInsets.only(bottom: 20),
                          child: Text(
                              'No requests yet. Share your event plans to get started.')),
                    for (final request in _requests!)
                      Card(
                          child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Text(
                                        request['form']?['eventType']
                                                ?.toString() ??
                                            request['inquiryKind'].toString(),
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium),
                                    const SizedBox(height: 8),
                                    Text((request['quotes'] as List? ?? [])
                                            .isNotEmpty
                                        ? 'Quotation ready'
                                        : request['inquiryStatus'] == 'PENDING'
                                            ? 'Request received'
                                            : request['inquiryStatus'] ==
                                                    'IN_REVIEW'
                                                ? 'Preparing your quotation'
                                                : request['inquiryStatus'] ==
                                                        'REJECTED'
                                                    ? 'Request closed'
                                                    : request['inquiryStatus'] ==
                                                            'BOOKED'
                                                        ? 'Booking confirmed'
                                                        : 'Request approved'),
                                    const SizedBox(height: 12),
                                    Text(
                                        '${request['form']?['dates']?['dayCount'] ?? (request['form']?['dates']?['days'] as List?)?.length ?? 1} coverage day(s) · ${request['datesLabel'] ?? 'Dates to be decided'}'),
                                    if ((request['venueLabel']?.toString() ??
                                            '')
                                        .isNotEmpty)
                                      Text(request['venueLabel'].toString()),
                                    if ((request['servicesLabel']?.toString() ??
                                            '')
                                        .isNotEmpty)
                                      Text(request['servicesLabel'].toString()),
                                    for (final quote
                                        in request['quotes'] as List? ?? [])
                                      TextButton(
                                          onPressed: () => context.push(
                                              '/quotes?id=${quote['id']}'),
                                          child:
                                              const Text('Review quotation')),
                                  ]))),
                    if (_requestTotal > 20)
                      Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            TextButton(
                                onPressed: _requestPage > 1
                                    ? () {
                                        _requestPage--;
                                        _load();
                                      }
                                    : null,
                                child: const Text('Previous requests')),
                            Text(
                                '$_requestPage / ${(_requestTotal / 20).ceil()}'),
                            TextButton(
                                onPressed: _requestPage * 20 < _requestTotal
                                    ? () {
                                        _requestPage++;
                                        _load();
                                      }
                                    : null,
                                child: const Text('Next requests'))
                          ]),
                    const SizedBox(height: 28),
                    Text('Your quotations',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 12),
                  ],
                  for (final q in _quotes ?? <Map<String, dynamic>>[])
                    Card(
                        child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Align(
                                      alignment: Alignment.centerRight,
                                      child: ShareLinkButton(
                                          path: '/quotes?id=${q['id']}',
                                          title: 'Share quotation')),
                                  Text(q['title']?.toString() ?? 'Quotation',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge),
                                  Text(q['status'] == 'SENT'
                                      ? (((q['pricingSnapshot'] as Map?)?[
                                                          'alternatives']
                                                      as List? ??
                                                  [])
                                              .isEmpty
                                          ? 'View your quotation PDF below. Contact the studio to confirm.'
                                          : 'Choose one package below')
                                      : q['status'] == 'APPROVED'
                                          ? 'Accepted · awaiting studio confirmation'
                                          : 'Booking created'),
                                  for (final o in ((q['pricingSnapshot']
                                          as Map?)?['alternatives'] as List? ??
                                      []))
                                    Padding(
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 12),
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.stretch,
                                            children: [
                                              Text(o['title'].toString(),
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.bold)),
                                              for (final line
                                                  in (o['lines'] as List? ??
                                                      []))
                                                Text(
                                                    '${line['title']} · ${_money.format(line['amount'])}'),
                                              Text(
                                                  'Tax: ${_money.format(o['tax'] ?? 0)}'),
                                              Text(
                                                  'Total: ${_money.format(o['total'])}',
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.bold)),
                                              if (q['status'] == 'SENT')
                                                OutlinedButton(
                                                    onPressed: _busy != null
                                                        ? null
                                                        : () => _accept(
                                                            q, o as Map),
                                                    child: Text(_busy == q['id']
                                                        ? 'Saving…'
                                                        : 'Choose this package')),
                                              if (q['status'] != 'SENT' &&
                                                  (q['pricingSnapshot']
                                                              as Map?)?[
                                                          'selectedOptionId'] ==
                                                      o['optionId'])
                                                const Text(
                                                    'Your accepted package',
                                                    style: TextStyle(
                                                        fontWeight:
                                                            FontWeight.bold)),
                                              if (_total > 20)
                                                Row(
                                                    mainAxisAlignment:
                                                        MainAxisAlignment
                                                            .spaceBetween,
                                                    children: [
                                                      TextButton(
                                                          onPressed: _page > 1
                                                              ? () {
                                                                  _page--;
                                                                  _load();
                                                                }
                                                              : null,
                                                          child: const Text(
                                                              'Previous quotations')),
                                                      Text(
                                                          '$_page / ${(_total / 20).ceil()}'),
                                                      TextButton(
                                                          onPressed:
                                                              _page * 20 <
                                                                      _total
                                                                  ? () {
                                                                      _page++;
                                                                      _load();
                                                                    }
                                                                  : null,
                                                          child: const Text(
                                                              'Next quotations'))
                                                    ]),
                                            ])),
                                  if (q['hasPdf'] == true ||
                                      q['pdfUrl'] != null)
                                    TextButton(
                                        onPressed: _busy != null
                                            ? null
                                            : () => _openPdf(q),
                                        child:
                                            const Text('View quotation PDF')),
                                ]))),
                ])),
      );
}
