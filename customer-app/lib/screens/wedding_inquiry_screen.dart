import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../theme/wedding_theme.dart';
import '../widgets/premium_ui.dart';
import '../widgets/wedding_ui.dart';

const _codes = ['+91', '+1', '+44', '+971', '+65'];

const _services = [
  ('traditional_photographer', 'Traditional photography'),
  ('candid_photographer', 'Candid photography'),
  ('traditional_videographer', 'Traditional videography'),
  ('cinematic_videographer', 'Cinematography'),
  ('drone', 'Drone'),
  ('pre_wedding', 'Pre-wedding'),
  ('same_day_edit', 'Same-day edit'),
  ('live_stream', 'Live streaming'),
  ('album_design', 'Album design'),
  ('audio_setup', 'Audio setup'),
];

const _budgets = [
  ('UNDER_1L', 'Under ₹1 lakh'),
  ('1L_2L', '₹1–2 lakh'),
  ('2L_4L', '₹2–4 lakh'),
  ('4L_PLUS', '₹4 lakh+'),
  ('UNSURE', 'Not sure yet'),
];

const _schedules = [
  ('MORNING', 'Morning'),
  ('EVENING', 'Evening'),
  ('FULL_DAY', 'Full day'),
];

const _dayHints = ['Haldi', 'Wedding', 'Reception', 'Sangeet', 'Mehndi'];

const _timeline = [
  ('Inquiry sent', 'We receive your details'),
  ('Admin review & quote', 'Studio replies with a plan'),
  ('Contract / confirmation', 'Dates lock in'),
  ('Event execution', 'Your wedding days'),
];

class WeddingInquiryScreen extends ConsumerStatefulWidget {
  const WeddingInquiryScreen({super.key});

  @override
  ConsumerState<WeddingInquiryScreen> createState() => _WeddingInquiryScreenState();
}

class _WeddingInquiryScreenState extends ConsumerState<WeddingInquiryScreen> {
  int _step = 0;
  bool _flexible = false;
  List<(String, String)> _serviceChoices = _services;
  List<(String, String)> _budgetChoices = _budgets;
  List<(String, String)> _scheduleChoices = _schedules;
  Future<void> _catalog() async {
    try {
      final response = await ApiService.dio.get('/portal/wedding-inquiry/catalog');
      final data = ApiService.unwrapData(response) as Map;
      List<(String, String)> choices(String key) => (data[key] as List).map((r) => (r['id'].toString(), r['label'].toString())).toList();
      if (mounted) setState(() { _serviceChoices = choices('services'); _budgetChoices = choices('budgetTiers'); _scheduleChoices = choices('schedules'); });
    } catch (_) { /* The built-in choices remain available while offline. */ }
  }

  bool _submitting = false;
  bool _success = false;
  String? _error;
  Map<String, String> _fieldErrors = {};

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _location = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _notes = TextEditingController();
  final _guests = TextEditingController();

  String _code = '+91';
  final String _schedule = 'FULL_DAY';
  String? _budget;
  int _dayCount = 3;
  late List<_DayPlan> _days;
  bool? _albumNeeded;
  int _albumSheets = 20;

  @override
  void initState() {
    super.initState();
    _days = List.generate(3, (_) => _DayPlan());
    _prefill();
    _catalog();
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _location.dispose();
    _city.dispose();
    _state.dispose();
    _notes.dispose();
    _guests.dispose();
    for (final d in _days) {
      d.dispose();
    }
    super.dispose();
  }

  void _setDayCount(int n) {
    final next = n.clamp(1, 7);
    if (next == _dayCount) return;
    setState(() {
      if (next > _days.length) {
        _days.addAll(List.generate(next - _days.length, (_) => _DayPlan()));
      } else {
        for (final extra in _days.sublist(next)) {
          extra.dispose();
        }
        _days = _days.sublist(0, next);
      }
      _dayCount = next;
      _seedFollowingDays();
    });
  }

  Future<void> _prefill() async {
    try {
      final p = await PortalApi.profile();
      if (!mounted) return;
      setState(() {
        if (_name.text.isEmpty) _name.text = p['name']?.toString() ?? '';
        if (_email.text.isEmpty) _email.text = p['email']?.toString() ?? '';
        final raw = (p['phone'] ?? '').toString();
        final digits = raw.replaceAll(RegExp(r'\D'), '');
        if (_phone.text.isEmpty && digits.isNotEmpty) {
          if (digits.length > 10 && digits.startsWith('91')) {
            _code = '+91';
            _phone.text = digits.substring(digits.length - 10);
          } else {
            _phone.text = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
          }
        }
      });
    } catch (_) {}
  }

  String _fmt(DateTime d) {
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${mo[d.month - 1]} ${d.year}';
  }

  String _iso(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<DateTime?> _pickDate(DateTime? current) {
    final now = DateTime.now();
    final first = DateTime(now.year, now.month, now.day);
    return showDatePicker(
      context: context,
      initialDate: current == null || current.isBefore(first) || current.isAfter(first.add(const Duration(days: 365 * 3))) ? first.add(const Duration(days: 30)) : current,
      firstDate: first,
      lastDate: first.add(const Duration(days: 365 * 3)),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.light(
            primary: WeddingPalette.wine,
            onPrimary: Colors.white,
            surface: WeddingPalette.ivory,
            onSurface: WeddingPalette.ink,
          ),
        ),
        child: child!,
      ),
    );
  }

  static const _lastStep = 4;

  bool _validStep(int step) {
    final errs = <String, String>{};
    if (step == 0) {
      if (_name.text.trim().length < 2) errs['name'] = 'Enter your full name';
      final phone = _phone.text.replaceAll(RegExp(r'\D'), '');
      if (_code == '+91' && !RegExp(r'^[6-9]\d{9}$').hasMatch(phone)) {
        errs['phone'] = 'Enter a valid 10-digit mobile number';
      } else if (phone.length < 7) {
        errs['phone'] = 'Enter a valid phone number';
      }
      if (_email.text.trim().isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(_email.text.trim())) {
        errs['email'] = 'Enter a valid email';
      }
    } else if (step == 1) {
      if (_location.text.trim().isEmpty && _city.text.trim().isEmpty) {
        errs['venue'] = 'Add a venue or city';
      }
    } else if (step == 2) {
      if (_days.any((d) => d.event.text.trim().isEmpty)) {
        errs['dates'] = 'Type the event for every day';
      } else if (!_flexible && _days.any((d) => d.date == null)) {
        errs['dates'] = 'Pick a date for every day';
      } else if (_days.any((d) => d.services.isEmpty)) {
        errs['dates'] = 'Choose coverage for every day';
      }
    }
    setState(() => _fieldErrors = errs);
    return errs.isEmpty;
  }

  void _next() {
    Haptics.light();
    if (!_validStep(_step)) return;
    setState(() {
      _error = null;
      if (_step == 1) _seedFollowingDays();
      _step = (_step + 1).clamp(0, _lastStep);
    });
  }

  void _seedFollowingDays() {
    final start = _days.first.date;
    if (start == null) return;
    for (var i = 0; i < _days.length; i++) {
      _days[i].date ??= start.add(Duration(days: i));
    }
  }

  Map<String, dynamic> _payload() {
    final days = <Map<String, dynamic>>[];
    for (var i = 0; i < _days.length; i++) {
      final d = _days[i];
      days.add({
        'day': i + 1,
        'event': d.event.text.trim(),
        'name': d.event.text.trim(),
        'date': !_flexible && d.date != null ? _iso(d.date!) : null,
        'schedule': d.schedule,
        'services': d.services.toList(),
      });
    }
    return {
      'contact': {
        'name': _name.text.trim(),
        'email': _email.text.trim(),
        'phone': _phone.text.trim(),
        'countryCode': _code,
      },
      'venue': {
        'location': _location.text.trim(),
        'city': _city.text.trim(),
        'state': _state.text.trim(),
      },
      'dates': {
        'mode': 'days',
        'flexible': _flexible,
        'dayCount': _dayCount,
        'start': days.isNotEmpty ? days.first['date'] : null,
        'end': days.isNotEmpty ? days.last['date'] : null,
        'days': days,
        'ceremonies': days,
      },
      'schedule': _days.isNotEmpty ? _days.first.schedule : _schedule,
      'services': _days.expand((d) => d.services).toSet().toList(),
      'album': {
        'needed': _albumNeeded == true,
        'sheets': _albumSheets,
      },
      'budgetTier': _budget,
      'guestCount': int.tryParse(_guests.text.trim()),
      'notes': _notes.text.trim(),
    };
  }

  Future<void> _submit() async {
    if (!_validStep(0) || !_validStep(1) || !_validStep(2) || !_validStep(3)) {
      setState(() {
        if (_fieldErrors.containsKey('name') ||
            _fieldErrors.containsKey('phone') ||
            _fieldErrors.containsKey('email')) {
          _step = 0;
        } else if (_fieldErrors.containsKey('venue') || _fieldErrors.containsKey('start')) {
          _step = 1;
        } else if (_fieldErrors.containsKey('dates')) {
          _step = 2;
        } else {
          _step = 3;
        }
      });
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await PortalApi.submitWeddingInquiry(_payload());
      if (!mounted) return;
      Haptics.success();
      setState(() {
        _submitting = false;
        _success = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = ApiService.errorMessage(e) ?? 'Could not send inquiry. Try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        backgroundColor: AppColors.bg(context),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.close_rounded, color: AppColors.text(context)),
          onPressed: () => context.pop(),
        ),
        title: Text('Wedding inquiry', style: AppTheme.display(22)),
      ),
      body: _success ? _successView() : Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 4, 24, 12),
            child: Row(
              children: List.generate(_lastStep + 1, (i) {
                final on = i <= _step;
                return Expanded(
                  child: Container(
                    height: 3,
                    margin: EdgeInsets.only(right: i == _lastStep ? 0 : 6),
                    decoration: BoxDecoration(
                      color: on ? WeddingPalette.wine : WeddingPalette.blush,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                );
              }),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text(_error!, style: WeddingTheme.body(13, color: WeddingPalette.wine)),
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
              children: [
                Text(
                  'Step ${_step + 1} of ${_lastStep + 1}',
                  style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.champagne),
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    'Your details',
                    'Venue & days',
                    'Day by day',
                    'Album & budget',
                    'Review & send',
                  ][_step],
                  style: WeddingTheme.display(28),
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    'We’ll use this to reach you about dates and a quote.',
                    'Where is it, and how many days of coverage?',
                    'Date, event name, and crew needed for each day.',
                    'Album preference and budget — nothing is billed yet.',
                    'Check everything, then send. Your timeline starts after this.',
                  ][_step],
                  style: WeddingTheme.body(14, color: WeddingPalette.inkSoft),
                ),
                const SizedBox(height: 22),
                if (_step == 0) ..._contact(),
                if (_step == 1) ..._venue(),
                if (_step == 2) ..._daysScreen(),
                if (_step == 3) ..._coverage(),
                if (_step == 4) ..._review(),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
              child: Row(
                children: [
                  if (_step > 0)
                    TextButton(
                      onPressed: _submitting ? null : () => setState(() => _step -= 1),
                      child: Text('Back', style: WeddingTheme.body(14, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _submitting ? null : (_step < _lastStep ? _next : _submit),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.text(context),
                      foregroundColor: Colors.white,
                      minimumSize: const Size(168, 50),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: _submitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text(
                            _step < _lastStep ? 'Next' : 'Send inquiry',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
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

  Widget _successView() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 24),
      child: Column(
        children: [
          const Spacer(),
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(color: WeddingPalette.blush, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, color: WeddingPalette.wine, size: 36),
          ),
          const SizedBox(height: 20),
          Text('Inquiry sent', style: AppTheme.display(28), textAlign: TextAlign.center),
          const SizedBox(height: 10),
          Text(
            'The studio will review your dates and coverage, then reply with a quotation. You stay in the usual app until they send it.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.text2(context), fontSize: 15, height: 1.45),
          ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton(
              onPressed: () => context.go('/app'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.text(context),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ),
          TextButton(
            onPressed: () => context.go('/app?tab=packages'),
            child: Text('Back to packages', style: TextStyle(color: AppColors.text2(context))),
          ),
        ],
      ),
    );
  }

  List<Widget> _contact() => [
        _field('Full name', _name, err: _fieldErrors['name']),
        const SizedBox(height: 14),
        _field('Email (optional)', _email, keyboard: TextInputType.emailAddress, err: _fieldErrors['email']),
        const SizedBox(height: 14),
        Text('Phone', style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
        const SizedBox(height: 6),
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: _box(),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _code,
                  items: _codes.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                  onChanged: (v) => setState(() => _code = v ?? '+91'),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
                decoration: _dec(hint: '98765 43210', err: _fieldErrors['phone']),
              ),
            ),
          ],
        ),
        if (_fieldErrors['phone'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_fieldErrors['phone']!, style: WeddingTheme.body(12, color: WeddingPalette.wine)),
          ),
      ];

  List<Widget> _venue() => [
        _field('Venue / location', _location, hint: 'Palace, hall, or home', err: _fieldErrors['venue']),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _field('City', _city)),
            const SizedBox(width: 10),
            Expanded(child: _field('State', _state)),
          ],
        ),
        const SizedBox(height: 20),
        Text('How many days of coverage?', style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            for (final n in [1, 2, 3, 4, 5, 6, 7])
              ChoiceChip(
                label: Text(n == 1 ? '1 day' : '$n days'),
                selected: _dayCount == n,
                onSelected: (_) => _setDayCount(n),
                selectedColor: WeddingPalette.blush,
                labelStyle: TextStyle(
                  color: WeddingPalette.ink,
                  fontWeight: _dayCount == n ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
          ],
        ),
      ];

  List<Widget> _daysScreen() {
    final start = _days.isNotEmpty ? _days.first.date : null;
    final sched = _scheduleChoices.firstWhere((s) => s.$1 == _schedule, orElse: () => ('', '')).$2;
    return [
      SwitchListTile.adaptive(contentPadding: EdgeInsets.zero, title: const Text('Dates are not decided yet'), subtitle: const Text('Share your plans now; confirm dates with the studio later.'), value: _flexible, onChanged: (value) => setState(() => _flexible = value)),
      if (start != null && !_flexible)
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: WeddingPalette.blush.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: WeddingPalette.champagne.withValues(alpha: 0.5)),
            ),
            child: Text(
              '$_dayCount days · from ${_fmt(start)}'
              '${sched.isNotEmpty ? ' · $sched' : ''}',
              style: WeddingTheme.body(13, weight: FontWeight.w700),
            ),
          ),
        ),
      ...List.generate(_days.length, (i) {
        final d = _days[i];
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: WeddingPalette.champagne.withValues(alpha: 0.55)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Day ${i + 1}', style: WeddingTheme.body(13, weight: FontWeight.w800)),
                const SizedBox(height: 10),
                TextField(
                  controller: d.event,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: _dec(hint: i < _dayHints.length ? 'e.g. ${_dayHints[i]}' : 'What happens this day?'),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                _dateTile('Date', d.date, (picked) => _setDayDate(i, picked)),
                const SizedBox(height: 10),
                Text('Time of day', style: WeddingTheme.body(12, weight: FontWeight.w600, color: WeddingPalette.inkSoft)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: _scheduleChoices
                      .map((s) => ChoiceChip(
                            label: Text(s.$2),
                            selected: d.schedule == s.$1,
                            onSelected: (_) => setState(() => d.schedule = s.$1),
                            selectedColor: WeddingPalette.blush,
                            labelStyle: TextStyle(
                              color: WeddingPalette.ink,
                              fontWeight: d.schedule == s.$1 ? FontWeight.w700 : FontWeight.w500,
                            ),
                          ))
                      .toList(),
                ),
                const SizedBox(height: 10),
                Text('Coverage this day', style: WeddingTheme.body(12, weight: FontWeight.w600, color: WeddingPalette.inkSoft)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _serviceChoices.map((s) {
                    final on = d.services.contains(s.$1);
                    return FilterChip(
                      label: Text(s.$2),
                      selected: on,
                      onSelected: (v) => setState(() {
                        if (v) {
                          d.services.add(s.$1);
                        } else {
                          d.services.remove(s.$1);
                        }
                      }),
                      selectedColor: WeddingPalette.blush,
                      checkmarkColor: WeddingPalette.wine,
                      labelStyle: TextStyle(
                        fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                        color: WeddingPalette.ink,
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        );
      }),
      if (_fieldErrors['dates'] != null)
        Text(_fieldErrors['dates']!, style: WeddingTheme.body(12, color: WeddingPalette.wine)),
    ];
  }

  void _setDayDate(int index, DateTime picked) {
    setState(() {
      _days[index].date = picked;
      for (var j = index + 1; j < _days.length; j++) {
        if (_days[j].date == null) {
          _days[j].date = picked.add(Duration(days: j - index));
        }
      }
    });
  }

  List<Widget> _coverage() => [
        Text('Do you need an album? (optional)', style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: ChoiceChip(
                label: const Text('Yes'),
                selected: _albumNeeded == true,
                onSelected: (_) => setState(() => _albumNeeded = true),
                selectedColor: WeddingPalette.blush,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ChoiceChip(
                label: const Text('No'),
                selected: _albumNeeded == false,
                onSelected: (_) => setState(() => _albumNeeded = false),
                selectedColor: WeddingPalette.blush,
              ),
            ),
          ],
        ),
        if (_albumNeeded == true) ...[
          const SizedBox(height: 12),
          Text('Sheets / spreads (optional)', style: WeddingTheme.body(12, weight: FontWeight.w600, color: WeddingPalette.inkSoft)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: [
              for (final n in [10, 15, 20, 25, 30])
                ChoiceChip(
                  label: Text('$n sheets'),
                  selected: _albumSheets == n,
                  onSelected: (_) => setState(() => _albumSheets = n),
                  selectedColor: WeddingPalette.blush,
                ),
            ],
          ),
        ],
        if (_fieldErrors['album'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_fieldErrors['album']!, style: WeddingTheme.body(12, color: WeddingPalette.wine)),
          ),
        const SizedBox(height: 18),
        Text('Expected budget (optional)', style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
        const SizedBox(height: 8),
        ..._budgetChoices.map((b) {
          final on = _budget == b.$1;
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: InkWell(
              onTap: () => setState(() => _budget = b.$1),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                decoration: BoxDecoration(
                  color: on ? WeddingPalette.blush : WeddingPalette.ivory,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: on ? WeddingPalette.wine : WeddingPalette.champagne.withValues(alpha: 0.55)),
                ),
                child: Row(
                  children: [
                    Icon(on ? Icons.radio_button_checked : Icons.radio_button_off, color: WeddingPalette.wine, size: 20),
                    const SizedBox(width: 10),
                    Text(b.$2, style: WeddingTheme.body(14, weight: FontWeight.w600)),
                  ],
                ),
              ),
            ),
          );
        }),
        if (_fieldErrors['budget'] != null)
          Text(_fieldErrors['budget']!, style: WeddingTheme.body(12, color: WeddingPalette.wine)),
        const SizedBox(height: 8),
        _field('Guest count (optional)', _guests, keyboard: TextInputType.number),
      ];

  List<Widget> _review() {
    final serviceNames = _days
        .expand((d) => d.services)
        .toSet()
        .map((id) => _serviceChoices.firstWhere((s) => s.$1 == id, orElse: () => (id, id)).$2)
        .join(', ');
    final budget = _budgetChoices.firstWhere((b) => b.$1 == _budget, orElse: () => ('', '')).$2;
    final dates = _days.asMap().entries.map((e) {
      final label = e.value.event.text.trim().isEmpty ? 'Day ${e.key + 1}' : e.value.event.text.trim();
      final when = e.value.date == null ? 'no date' : _fmt(e.value.date!);
      return 'Day ${e.key + 1} · $label · $when';
    }).join('\n');
    return [
      WeddingCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _kv('Name', _name.text.trim()),
            _kv('Phone', '$_code ${_phone.text.trim()}'),
            _kv('Email', _email.text.trim()),
            _kv('Venue', [_location.text, _city.text, _state.text].where((s) => s.trim().isNotEmpty).join(', ')),
            _kv('Dates', _flexible ? 'To be decided' : dates),
            _kv('Coverage', serviceNames),
            _kv('Album', _albumNeeded == true ? 'Yes · $_albumSheets sheets' : 'No'),
            _kv('Budget', budget),
            if (_guests.text.trim().isNotEmpty) _kv('Guests', _guests.text.trim()),
          ],
        ),
      ),
      const SizedBox(height: 16),
      _field('Notes for the studio', _notes, hint: 'Theme, guest estimate, anything we should know', maxLines: 4),
      const SizedBox(height: 20),
      Text('What happens next', style: WeddingTheme.body(13, weight: FontWeight.w700)),
      const SizedBox(height: 10),
      _timelinePreview(current: 0),
    ];
  }

  Widget _timelinePreview({required int current}) {
    return Column(
      children: List.generate(_timeline.length, (i) {
        final done = i < current;
        final on = i == current;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      color: done || on ? WeddingPalette.wine : WeddingPalette.blush,
                      shape: BoxShape.circle,
                    ),
                  ),
                  if (i < _timeline.length - 1)
                    Container(width: 1, height: 28, color: WeddingPalette.champagne.withValues(alpha: 0.5)),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_timeline[i].$1, style: WeddingTheme.body(14, weight: FontWeight.w700)),
                      Text(_timeline[i].$2, style: WeddingTheme.body(12, color: WeddingPalette.inkSoft)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }

  Widget _kv(String k, String v) {
    if (v.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: WeddingTheme.body(11, color: WeddingPalette.inkFaint, weight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(v, style: WeddingTheme.body(14, weight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _dateTile(String label, DateTime? value, void Function(DateTime) onPick) {
    return InkWell(
      onTap: () async {
        final d = await _pickDate(value);
        if (d != null) onPick(d);
      },
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: _box(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: WeddingTheme.body(11, color: WeddingPalette.inkFaint, weight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(value == null ? 'Select' : _fmt(value), style: WeddingTheme.body(14, weight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }

  Widget _field(String label, TextEditingController c, {String? hint, String? err, TextInputType? keyboard, int maxLines = 1}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: WeddingTheme.body(12, weight: FontWeight.w700, color: WeddingPalette.inkSoft)),
        const SizedBox(height: 6),
        TextField(
          controller: c,
          keyboardType: keyboard,
          maxLines: maxLines,
          decoration: _dec(hint: hint, err: err),
        ),
        if (err != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(err, style: WeddingTheme.body(12, color: WeddingPalette.wine)),
          ),
      ],
    );
  }

  InputDecoration _dec({String? hint, String? err}) => InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: Colors.white,
        errorText: null,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: err != null ? WeddingPalette.wine : WeddingPalette.champagne.withValues(alpha: 0.6)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: err != null ? WeddingPalette.wine : WeddingPalette.champagne.withValues(alpha: 0.6)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: WeddingPalette.wine, width: 1.4),
        ),
      );

  BoxDecoration _box() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: WeddingPalette.champagne.withValues(alpha: 0.6)),
      );
}

class _DayPlan {
  DateTime? date;
  String schedule = 'FULL_DAY';
  final Set<String> services = {};
  final TextEditingController event = TextEditingController();
  void dispose() => event.dispose();
}
