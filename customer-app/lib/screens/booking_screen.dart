import '../widgets/share_link_button.dart';
import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/premium_ui.dart';

class BookingScreen extends StatefulWidget {
  const BookingScreen({super.key});
  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen>
    with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _booking;
  Map<String, dynamic>? _contact;
  Map<String, dynamic>? _account;
  bool _loading = true;
  late AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))
      ..repeat(reverse: true);
    _load();
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        PortalApi.booking(),
        PortalApi.contact().catchError((_) => <String, dynamic>{}),
        PortalApi.billingAccount().catchError((_) => <String, dynamic>{}),
      ]);
      if (mounted) {
        setState(() {
          _booking = results[0];
          _contact = results[1];
          _account = results[2].isEmpty
              ? null
              : (results[2]['summary'] is Map
                  ? Map<String, dynamic>.from(results[2]['summary'] as Map)
                  : results[2]);
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _label(String s) {
    final labels = (_booking?['statusLabels'] as Map?) ?? {};
    if (labels[s] != null) return labels[s].toString();
    final steps = (_booking?['steps'] as List?) ?? [];
    for (final raw in steps) {
      final m = Map<String, dynamic>.from(raw as Map);
      if (m['key']?.toString() == s && m['label'] != null) return m['label'].toString();
      if (m['key']?.toString().toUpperCase() == s.toUpperCase() && m['label'] != null) {
        return m['label'].toString();
      }
    }
    if (s.contains(' ') || !s.contains('_')) return s;
    return s
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  String _fmt(dynamic at) {
    final d = DateTime.tryParse(at?.toString() ?? '')?.toLocal();
    if (d == null) return '';
    final mo = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$day/$mo/${d.year}';
  }

  String _fmtMoney(dynamic n) {
    final v = (n is num) ? n.toDouble() : double.tryParse(n?.toString() ?? '') ?? 0;
    if (v == v.roundToDouble()) return '₹${v.round()}';
    return '₹${v.toStringAsFixed(0)}';
  }

  String _normKey(String raw) {
    return raw
        .trim()
        .toUpperCase()
        .replaceAll(RegExp(r'[^A-Z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
  }

  String get _slotStatus =>
      (_booking?['slotStatus'] ?? _booking?['booking']?['slotStatus'] ?? 'NONE')
          .toString();

  bool get _reschedulePending => _slotStatus == 'RESCHEDULE_REQUESTED';

  List<Map<String, dynamic>> get _jobs {
    final raw = _booking?['jobs'];
    if (raw is! List || raw.isEmpty) return const [];
    return raw
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  bool get _isPlaceholderBooking {
    if (_jobs.length > 1) return false;
    if (_booking == null) return true;
    if (_booking!['confirmedSlot'] is Map) return false;
    if (_booking!['pendingSlot'] is Map) return false;
    if (_booking!['package'] != null) return false;
    if (_slotStatus != 'NONE' && _slotStatus.isNotEmpty) return false;
    final status = (_booking!['status'] ?? '').toString();
    if (status.isNotEmpty && status != 'ENQUIRY_RECEIVED') return false;
    final history = (_booking!['history'] as List?) ?? [];
    return history.length <= 1;
  }

  /// Build flow steps — backend already merges customs; keep a safe client fallback.
  List<Map<String, dynamic>> _resolveSteps({
    required List stepsRaw,
    required List statuses,
    required List history,
    required String current,
  }) {
    List<Map<String, dynamic>> fromRaw(List raw) {
      return raw.map((s) {
        if (s is Map) {
          return {
            'key': (s['key'] ?? s['status'] ?? '').toString(),
            'label': (s['label'] ?? s['key'] ?? s['status'] ?? '').toString(),
            'custom': s['custom'] == true,
          };
        }
        return {'key': s.toString(), 'label': _label(s.toString()), 'custom': false};
      }).toList();
    }

    if (stepsRaw.isNotEmpty) return fromRaw(stepsRaw);
    if (statuses.isNotEmpty) {
      return statuses.map((s) => {
            'key': s.toString(),
            'label': _label(s.toString()),
            'custom': false,
          }).toList();
    }
    return [
      {'key': current, 'label': _label(current), 'custom': false},
    ];
  }

  int _indexOf(List<Map<String, dynamic>> steps, String current) {
    final apiIdx = _booking?['stepIndex'];
    if (apiIdx is num && apiIdx >= 0 && apiIdx < steps.length) return apiIdx.toInt();
    final u = current.toUpperCase();
    final nk = _normKey(current);
    var idx = steps.indexWhere((s) {
      final k = (s['key'] ?? '').toString();
      final l = (s['label'] ?? '').toString();
      return k.toUpperCase() == u || k == nk || l.toUpperCase() == u;
    });
    if (idx < 0) idx = steps.isEmpty ? 0 : steps.length - 1;
    return idx;
  }

  Future<void> _open(String? raw, {required String scheme}) async {
    if (raw == null || raw.isEmpty) return;
    String u = raw;
    if (scheme == 'tel') u = 'tel:$raw';
    if (scheme == 'wa') {
      var digits = raw.replaceAll(RegExp(r'[^\d]'), '');
      if (digits.length == 10 && RegExp(r'^[6-9]').hasMatch(digits)) digits = '91$digits';
      u = 'https://wa.me/$digits';
    }
    final uri = Uri.parse(u);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _showRescheduleDialog({Map<String, dynamic>? job}) async {
    String? selectedJobId = job?['id']?.toString() ?? (_jobs.length == 1 ? _jobs.first['id']?.toString() : null);
    DateTime selectedDate = DateTime.now().add(const Duration(days: 3));
    TimeOfDay selectedTime = const TimeOfDay(hour: 10, minute: 0);
    final noteCtrl = TextEditingController();
    bool submitting = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final dateStr = '${selectedDate.day}/${selectedDate.month}/${selectedDate.year}';
            final timeStr = selectedTime.format(context);

            return Padding(
              padding: EdgeInsets.fromLTRB(
                20, 20, 20,
                MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 36, height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.border(context),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('Request Edit / Reschedule', style: AppTheme.display(20, context: context)),
                  const SizedBox(height: 6),
                  Text(
                    'Pick your preferred date and time slot. Your studio will accept and confirm the change.',
                    style: TextStyle(color: AppColors.text2(context), fontSize: 13),
                  ),
                  if (_jobs.length > 1) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: selectedJobId,
                    decoration: const InputDecoration(labelText: 'Shoot to reschedule'),
                    items: _jobs.map((j) => DropdownMenuItem(value: j['id'].toString(), child: Text('${j['shootLabel'] ?? 'Shoot'} · ${j['packageTitle'] ?? 'Booking'}'))).toList(),
                    onChanged: submitting ? null : (value) => setModalState(() => selectedJobId = value),
                  ),
                ],
                const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () async {
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: selectedDate,
                              firstDate: DateTime.now(),
                              lastDate: DateTime.now().add(const Duration(days: 365)),
                            );
                            if (picked != null) {
                              setModalState(() => selectedDate = picked);
                            }
                          },
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.sunken(context),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.border(context)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Date', style: TextStyle(fontSize: 11, color: AppColors.text2(context))),
                                const SizedBox(height: 2),
                                Text(dateStr, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: InkWell(
                          onTap: () async {
                            final picked = await showTimePicker(
                              context: context,
                              initialTime: selectedTime,
                            );
                            if (picked != null) {
                              setModalState(() => selectedTime = picked);
                            }
                          },
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.sunken(context),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.border(context)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Time', style: TextStyle(fontSize: 11, color: AppColors.text2(context))),
                                const SizedBox(height: 2),
                                Text(timeStr, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: noteCtrl,
                    decoration: InputDecoration(
                      hintText: 'Optional note (e.g. Reason for change)',
                      filled: true,
                      fillColor: AppColors.sunken(context),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppColors.border(context)),
                      ),
                    ),
                    maxLines: 2,
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: submitting ? null : () async {
                        if (selectedJobId == null && _jobs.length > 1) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Choose a shoot to reschedule.')));
                          return;
                        }
                        setModalState(() => submitting = true);
                        try {
                          final isoDate = '${selectedDate.year}-${selectedDate.month.toString().padLeft(2, '0')}-${selectedDate.day.toString().padLeft(2, '0')}';
                          final h = selectedTime.hour.toString().padLeft(2, '0');
                          final m = selectedTime.minute.toString().padLeft(2, '0');
                          final time24 = '$h:$m';

                          await ApiService.requestReschedule(
                            jobId: selectedJobId,
                            requestedDate: isoDate,
                            requestedTime: time24,
                            note: noteCtrl.text.trim(),
                          );
                          if (!mounted || !ctx.mounted) return;
                          Navigator.pop(ctx);
                          _load();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Reschedule request sent! Studio will confirm shortly.')),
                          );
                        } catch (e) {
                          if (!mounted || !ctx.mounted) return;
                          setModalState(() => submitting = false);
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(ApiService.errorMessage(e) ?? 'Reschedule request failed')),
                          );
                        }
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.text(context),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: Text(submitting ? 'Submitting…' : 'Submit Reschedule Request'),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final stepsRaw = (_booking?['steps'] as List?) ?? [];
    final statuses = (_booking?['statuses'] as List?)?.cast<String>() ?? <String>[];
    final current = _booking?['status'] as String? ?? 'ENQUIRY_RECEIVED';
    final history = (_booking?['history'] as List?) ?? [];

    final steps = _resolveSteps(
      stepsRaw: stepsRaw,
      statuses: statuses,
      history: history,
      current: current,
    );
    final idx = _indexOf(steps, current);
    final progress = steps.isEmpty ? 0.0 : ((idx + 1) / steps.length).clamp(0.0, 1.0);
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(leading: const AppBackButton(), actions: [const ShareLinkButton(path: '/booking'),TextButton(onPressed: () => context.push('/quotes'), child: const Text('Quotations'))],
        backgroundColor: AppColors.bg(context),
        title: Text('Booking status', style: AppTheme.display(22, context: context)),
      ),
      body: _loading
          ? const Padding(
              padding: EdgeInsets.all(AppSpace.md),
              child: Column(
                children: [
                  ShimmerBox(height: 56, radius: 12),
                  SizedBox(height: AppSpace.sm),
                  ShimmerBox(height: 200, radius: 12),
                ],
              ),
            )
          : RefreshIndicator(
              color: AppColors.text(context),
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xs, AppSpace.page, AppSpace.bottomNav),
                physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                children: [
                  if (_jobs.isNotEmpty && !_isPlaceholderBooking) ...[
                    Text(
                      _jobs.length == 1 ? 'Your timeline' : 'Your jobs',
                      style: AppTheme.kicker(context: context),
                    ),
                    const SizedBox(height: 8),
                    ..._jobs.map((job) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _JobTimelineCard(
                            job: job,
                            labelOf: _label,
                            fmt: _fmt,
                            normKey: _normKey,
                            pulse: _pulse,
                            dark: dark,
                            onReschedule: () => _showRescheduleDialog(job: job),
                          ),
                        )),
                    const SizedBox(height: AppSpace.sm),
                  ],

                  if (_isPlaceholderBooking) ...[
                    PremiumCard(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Nothing on your timeline yet', style: AppTheme.display(20, context: context)),
                          const SizedBox(height: 6),
                          Text(
                            'Send a wedding inquiry or book a package. This page stays empty until the studio has a real request to work with.',
                            style: TextStyle(color: AppColors.text2(context), fontSize: 13, height: 1.4),
                          ),
                          const SizedBox(height: 14),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: () => context.push('/wedding-inquiry'),
                              icon: const Icon(Icons.favorite_outline_rounded, size: 18),
                              label: const Text('Wedding inquiry'),
                              style: FilledButton.styleFrom(backgroundColor: AppColors.text(context)),
                            ),
                          ),
                          const SizedBox(height: 8),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () => context.go('/app?tab=packages'),
                              icon: const Icon(Icons.photo_album_outlined, size: 18),
                              label: const Text('Browse packages'),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpace.sm),
                  ],

                  // Confirmed / pending / reschedule requested slot cards
                  if (_jobs.length <= 1 && (_booking?['confirmedSlot'] is Map || _reschedulePending)) ...[
                    PremiumCard(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: (_reschedulePending
                                          ? AppColors.amber
                                          : AppColors.green)
                                      .withValues(alpha: 0.14),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(
                                  _reschedulePending
                                      ? Icons.hourglass_top_rounded
                                      : Icons.event_available_rounded,
                                  color: _reschedulePending
                                      ? AppColors.amber
                                      : AppColors.green,
                                ),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _reschedulePending
                                          ? 'RESCHEDULE PENDING CONFIRMATION'
                                          : 'SESSION CONFIRMED',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        letterSpacing: 0.8,
                                        color: _reschedulePending
                                            ? AppColors.amber
                                            : AppColors.green,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      (_booking!['confirmedSlot'] as Map?)?['label']?.toString() ??
                                          '${_booking?['requestedDate']?.toString().split('T')[0] ?? ''} ${_booking?['requestedTime'] ?? ''}',
                                      style: AppTheme.display(18, context: context),
                                    ),
                                    Text(
                                      _reschedulePending
                                          ? (_booking?['rescheduleNote']?.toString().isNotEmpty == true
                                              ? 'Waiting on studio · ${_booking!['rescheduleNote']}'
                                              : 'Reschedule requested — studio will accept shortly')
                                          : 'Confirmed session slot with your studio',
                                      style: TextStyle(fontSize: 12, color: AppColors.text2(context)),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _reschedulePending ? null : _showRescheduleDialog,
                              icon: const Icon(Icons.edit_calendar_rounded, size: 16),
                              label: Text(_reschedulePending
                                  ? 'Waiting for studio confirmation'
                                  : 'Edit Timeslot / Request Reschedule'),
                              style: OutlinedButton.styleFrom(
                                side: BorderSide(color: AppColors.border(context)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpace.sm),
                  ] else if (_booking?['pendingSlot'] is Map) ...[
                    PremiumCard(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: AppColors.amber.withValues(alpha: 0.14),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(Icons.hourglass_top_rounded, color: AppColors.amber),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'AWAITING CONFIRMATION',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        letterSpacing: 0.8,
                                        color: AppColors.amber,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      (_booking!['pendingSlot'] as Map)['label']?.toString() ?? '',
                                      style: AppTheme.display(18, context: context),
                                    ),
                                    Text(
                                      (_booking!['pendingSlot'] as Map)['packageTitle'] != null
                                          ? '${(_booking!['pendingSlot'] as Map)['packageTitle']} · studio will confirm'
                                          : 'Studio will confirm this slot',
                                      style: TextStyle(fontSize: 12, color: AppColors.text2(context)),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _showRescheduleDialog,
                              icon: const Icon(Icons.edit_calendar_rounded, size: 16),
                              label: const Text('Edit Preferred Timeslot'),
                              style: OutlinedButton.styleFrom(
                                side: BorderSide(color: AppColors.border(context)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpace.sm),
                  ],

                  if (_jobs.isEmpty && !_isPlaceholderBooking) ...[
                  Text('Current stage', style: AppTheme.kicker(context: context)),
                  const SizedBox(height: 6),
                  Text(_label(current), style: AppTheme.display(24, context: context)),
                  if (_booking?['package'] != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Package: ${(_booking!['package'] as Map)['title'] ?? ''}',
                      style: TextStyle(
                        color: AppColors.text2(context),
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                      ),
                    ),
                  ],
                  if (_account != null &&
                      ((_account!['billed'] as num?) ?? (_account!['totalBilled'] as num?) ?? 0) > 0) ...[
                    const SizedBox(height: 12),
                    PremiumCard(
                      padding: const EdgeInsets.all(14),
                      onTap: () => context.push('/invoices'),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('BILLING', style: AppTheme.kicker(context: context)),
                                const SizedBox(height: 4),
                                Text(
                                  'Paid ${_fmtMoney(_account!['paid'] ?? _account!['totalPaid'])} · remaining ${_fmtMoney(_account!['balance'] ?? _account!['totalOutstanding'])}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13,
                                    color: AppColors.text(context),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, color: AppColors.text3(context)),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpace.sm),

                  // Gradient progress
                  PremiumCard(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              '${(progress * 100).round()}% complete',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                                color: AppColors.text(context),
                              ),
                            ),
                            const Spacer(),
                            Text(
                              '${idx + 1} of ${steps.isEmpty ? 1 : steps.length}',
                              style: TextStyle(color: AppColors.text3(context), fontSize: 12),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpace.sm),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(99),
                          child: TweenAnimationBuilder<double>(
                            tween: Tween(begin: 0, end: progress),
                            duration: const Duration(milliseconds: 700),
                            curve: Curves.easeOutCubic,
                            builder: (_, v, __) => SizedBox(
                              height: 6,
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  ColoredBox(color: AppColors.sunken(context)),
                                  FractionallySizedBox(
                                    alignment: Alignment.centerLeft,
                                    widthFactor: v,
                                    child: ColoredBox(
                                      color: dark
                                          ? const Color(0xFF4A9B78)
                                          : AppColors.green,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.md),

                  // Vertical gradient timeline
                  PremiumCard(
                    padding: const EdgeInsets.fromLTRB(14, 16, 14, 10),
                    child: steps.isEmpty
                        ? Text(
                            'No timeline steps yet — the studio will update your journey here.',
                            style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
                          )
                        : Column(
                            children: List.generate(steps.length, (i) {
                              final done = i < idx;
                              final currentStep = i == idx;
                              final upcoming = i > idx;
                              final label = steps[i]['label']?.toString() ?? steps[i]['key']!.toString();
                              final isCustom = steps[i]['custom'] == true;
                              String? note;
                              String? when;
                              for (final h in history) {
                                if (h is! Map) continue;
                                final st = (h['status'] ?? h['key'] ?? '').toString();
                                final sk = _normKey(st);
                                final stepKey = _normKey(steps[i]['key']!.toString());
                                if (sk == stepKey || st.toUpperCase() == steps[i]['key']!.toString().toUpperCase()) {
                                  note = h['note']?.toString();
                                  when = _fmt(h['at'] ?? h['createdAt']);
                                }
                              }
                              return _TimelineRow(
                                label: label,
                                done: done,
                                current: currentStep,
                                upcoming: upcoming,
                                isCustom: isCustom,
                                note: note,
                                when: when,
                                isLast: i == steps.length - 1,
                                pulse: currentStep ? _pulse : null,
                                dark: dark,
                              );
                            }),
                          ),
                  ),
                  ],

                  if (_booking?['notes'] != null) ...[
                    const SizedBox(height: AppSpace.sm),
                    PremiumCard(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Studio note', style: AppTheme.kicker(context: context)),
                          const SizedBox(height: 6),
                          Text(
                            _booking!['notes'].toString(),
                            style: TextStyle(
                              color: AppColors.text2(context),
                              height: 1.4,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  if (_booking?['estimatedCompletion'] != null) ...[
                    const SizedBox(height: AppSpace.sm),
                    Text(
                      'Est. delivery: ${_fmt(_booking!['estimatedCompletion'])}',
                      style: TextStyle(
                        color: AppColors.accent(context),
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                  ],

                  const SizedBox(height: AppSpace.md),
                  Text('Need to reach us?', style: AppTheme.display(17, context: context)),
                  const SizedBox(height: AppSpace.sm),
                  Builder(builder: (context) {
                    final phone = _contact?['phone']?.toString();
                    final wa = (_contact?['whatsapp'] ?? _contact?['phone'])?.toString();
                    final hasPhone = phone != null && phone.trim().isNotEmpty;
                    final hasWa = wa != null && wa.trim().isNotEmpty;
                    if (!hasPhone && !hasWa) {
                      return Text(
                        'Studio contact isn’t listed yet — use the page below.',
                        style: TextStyle(color: AppColors.text2(context), fontSize: 13),
                      );
                    }
                    return Row(
                      children: [
                        if (hasPhone)
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _open(phone, scheme: 'tel'),
                              icon: const Icon(Icons.call_outlined, size: 18),
                              label: const Text('Call'),
                            ),
                          ),
                        if (hasPhone && hasWa) const SizedBox(width: 8),
                        if (hasWa)
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: () => _open(wa, scheme: 'wa'),
                              icon: const Icon(Icons.chat_outlined, size: 18),
                              label: const Text('WhatsApp'),
                            ),
                          ),
                      ],
                    );
                  }),
                  const SizedBox(height: 4),
                  TextButton(
                    onPressed: () => context.push('/contact'),
                    child: Text(
                      'Full studio contact',
                      style: TextStyle(color: AppColors.accent(context), fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _JobTimelineCard extends StatelessWidget {
  final Map<String, dynamic> job;
  final String Function(String) labelOf;
  final String Function(dynamic) fmt;
  final String Function(String) normKey;
  final Animation<double> pulse;
  final bool dark;
  final VoidCallback? onReschedule;

  const _JobTimelineCard({
    required this.job,
    required this.labelOf,
    required this.fmt,
    required this.normKey,
    required this.pulse,
    required this.dark,
    this.onReschedule,
  });

  @override
  Widget build(BuildContext context) {
    final title = (job['packageTitle']?.toString().isNotEmpty == true)
        ? job['packageTitle'].toString()
        : 'Job';
    final source = job['source']?.toString() ?? '';
    final status = job['status']?.toString() ?? '';
    final history = (job['history'] as List?) ?? [];
    final stepsRaw = (job['steps'] as List?) ?? [];
    final steps = stepsRaw.map((s) {
      if (s is Map) {
        return {
          'key': (s['key'] ?? s['status'] ?? '').toString(),
          'label': (s['label'] ?? s['key'] ?? '').toString(),
          'custom': s['custom'] == true,
        };
      }
      return {'key': s.toString(), 'label': labelOf(s.toString()), 'custom': false};
    }).toList();
    var idx = 0;
    if (job['stepIndex'] is num) {
      idx = (job['stepIndex'] as num).toInt().clamp(0, steps.isEmpty ? 0 : steps.length - 1);
    } else if (steps.isNotEmpty) {
      final u = status.toUpperCase();
      idx = steps.indexWhere((s) => (s['key'] as String).toUpperCase() == u);
      if (idx < 0) idx = 0;
    }
    final when = fmt(job['createdAt'] ?? (history.isNotEmpty ? (history.first as Map)['at'] : null));
    final slot = job['confirmedDate'] != null
        ? '${fmt(job['confirmedDate'])} ${job['confirmedTime'] ?? ''}'
        : job['slotLabel']?.toString();

    return PremiumCard(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('${job['shootLabel'] ?? 'S1'} · $title', style: AppTheme.display(18, context: context))),
              if (source.isNotEmpty)
                Text(
                  source == 'BOOK' ? 'Booked' : (source == 'ENQUIRE' ? 'Enquiry' : source),
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.text3(context)),
                ),
            ],
          ),
          if (when.isNotEmpty || (slot != null && slot.isNotEmpty)) ...[
            const SizedBox(height: 4),
            Text(
              [if (when.isNotEmpty) when, if (slot != null && slot.isNotEmpty) slot].join(' · '),
              style: TextStyle(fontSize: 12, color: AppColors.text2(context)),
            ),
          ],
          if (job['slotStatus'] == 'RESCHEDULE_REQUESTED')
            Text('Reschedule requested: ${fmt(job['requestedDate'])} ${job['requestedTime'] ?? ''}', style: const TextStyle(color: AppColors.amber, fontSize: 12)),
          if (onReschedule != null && job['confirmedDate'] != null)
            TextButton(onPressed: job['slotStatus'] == 'RESCHEDULE_REQUESTED' ? null : onReschedule, child: const Text('Request a time change')),
          const SizedBox(height: 8),
          Text(
            labelOf(status),
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: AppColors.text(context)),
          ),
          const SizedBox(height: 10),
          if (steps.isEmpty)
            Text('Studio will add stages here.', style: TextStyle(color: AppColors.text2(context), fontSize: 13))
          else
            Column(
              children: List.generate(steps.length, (i) {
                String? note;
                String? at;
                for (final h in history) {
                  if (h is! Map) continue;
                  final st = (h['status'] ?? h['key'] ?? '').toString();
                  if (normKey(st) == normKey(steps[i]['key']!.toString())) {
                    note = h['note']?.toString();
                    at = fmt(h['at']);
                  }
                }
                return _TimelineRow(
                  label: steps[i]['label']!.toString(),
                  done: i < idx,
                  current: i == idx,
                  upcoming: i > idx,
                  isCustom: steps[i]['custom'] == true,
                  note: note,
                  when: at,
                  isLast: i == steps.length - 1,
                  pulse: i == idx ? pulse : null,
                  dark: dark,
                );
              }),
            ),
        ],
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  final String label;
  final bool done;
  final bool current;
  final bool upcoming;
  final bool isCustom;
  final bool isLast;
  final bool dark;
  final String? note;
  final String? when;
  final Animation<double>? pulse;

  const _TimelineRow({
    required this.label,
    required this.done,
    required this.current,
    required this.upcoming,
    required this.isLast,
    required this.dark,
    this.isCustom = false,
    this.note,
    this.when,
    this.pulse,
  });

  @override
  Widget build(BuildContext context) {
    final green = dark ? const Color(0xFF4A9B78) : AppColors.green;
    final gold = AppColors.accent(context);
    final lineMuted = AppColors.border(context);

    Widget dot = Container(
      width: current ? 14 : 11,
      height: current ? 14 : 11,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: (done || current)
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: done
                    ? [green, green.withValues(alpha: 0.85)]
                    : [const Color(0xFFE8C9A0), gold],
              )
            : null,
        color: (done || current) ? null : AppColors.sunken(context),
        border: Border.all(
          color: done || current
              ? Colors.transparent
              : (isCustom ? gold.withValues(alpha: 0.55) : lineMuted),
          width: current ? 0 : 1.5,
          strokeAlign: BorderSide.strokeAlignInside,
        ),
      ),
      child: done
          ? const Icon(Icons.check_rounded, size: 9, color: Colors.white)
          : null,
    );

    if (current && pulse != null) {
      final amber = dark ? const Color(0xFFFCD34D) : AppColors.amber;
      dot = ScaleTransition(
        scale: Tween(begin: 0.96, end: 1.05).animate(
          CurvedAnimation(parent: pulse!, curve: Curves.easeInOut),
        ),
        child: Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: amber.withValues(alpha: 0.28),
                blurRadius: 6,
                spreadRadius: 0,
              ),
            ],
          ),
          child: dot,
        ),
      );
    }

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 26,
            child: Column(
              children: [
                dot,
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(99),
                        color: done ? green.withValues(alpha: 0.85) : lineMuted.withValues(alpha: 0.7),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 2 : AppSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          label,
                          style: TextStyle(
                            fontWeight: current ? FontWeight.w600 : FontWeight.w500,
                            fontSize: 14,
                            height: 1.3,
                            color: upcoming ? AppColors.text3(context) : AppColors.text(context),
                          ),
                        ),
                      ),
                      if (isCustom)
                        Container(
                          margin: const EdgeInsets.only(left: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(color: gold.withValues(alpha: 0.35)),
                          ),
                          child: Text(
                            'custom',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                              color: gold,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (when != null && when!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(when!, style: TextStyle(fontSize: 11, color: AppColors.text3(context))),
                    ),
                  if (note != null && note!.isNotEmpty && note != label)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        note!,
                        style: TextStyle(fontSize: 12, height: 1.35, color: AppColors.text2(context)),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
