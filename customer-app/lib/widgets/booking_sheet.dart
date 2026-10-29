import 'package:flutter/material.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import 'premium_ui.dart';

/// Smooth Book Now sheet: package summary → date → time → note → submit.
/// Enquire mode: optional date, message required-ish.
class BookingSheet extends StatefulWidget {
  final Map<String, dynamic> package;
  /// BOOK requires date+time; ENQUIRE is lighter.
  final String source;
  final String? couponCode;

  const BookingSheet({
    super.key,
    required this.package,
    this.source = 'BOOK',
    this.couponCode,
  });

  /// Opens the sheet; returns true if request was sent.
  static Future<bool?> open(
    BuildContext context, {
    required Map<String, dynamic> package,
    String source = 'BOOK',
    String? couponCode,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => BookingSheet(
        package: package,
        source: source,
        couponCode: couponCode,
      ),
    );
  }

  @override
  State<BookingSheet> createState() => _BookingSheetState();
}

class _BookingSheetState extends State<BookingSheet> {
  DateTime? _date;
  String? _time; // HH:mm
  final _noteCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  bool get _isBook => widget.source.toUpperCase() == 'BOOK';

  static const _slots = [
    '09:00', '10:00', '11:00', '12:00',
    '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
  ];

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  String get _pkgTitle =>
      widget.package['title']?.toString() ??
      widget.package['name']?.toString() ??
      'Package';

  String get _priceLabel {
    if (widget.package['priceLabel'] != null) {
      return widget.package['priceLabel'].toString();
    }
    final p = widget.package['discountPrice'] ?? widget.package['price'];
    if (p == null) return '';
    return '₹$p';
  }

  String _fmtDate(DateTime d) {
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return '${wd[d.weekday - 1]}, ${d.day} ${mo[d.month - 1]} ${d.year}';
  }

  String _fmtTime(String hhmm) {
    final parts = hhmm.split(':');
    var h = int.tryParse(parts[0]) ?? 0;
    final m = parts.length > 1 ? parts[1] : '00';
    final ap = h >= 12 ? 'PM' : 'AM';
    h = ((h + 11) % 12) + 1;
    return '$h:$m $ap';
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final first = DateTime(now.year, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? first.add(const Duration(days: 3)),
      firstDate: first,
      lastDate: first.add(const Duration(days: 365 * 2)),
      builder: (ctx, child) {
        return Theme(
          data: Theme.of(ctx).copyWith(
            colorScheme: ColorScheme.light(
              primary: AppColors.text(ctx),
              onPrimary: AppColors.bg(ctx),
              surface: AppColors.card(ctx),
              onSurface: AppColors.text(ctx),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      setState(() {
        _date = picked;
        _error = null;
      });
    }
  }

  Future<void> _submit() async {
    if (_isBook) {
      if (_date == null || _time == null) {
        setState(() => _error = 'Choose a date and time for your session');
        return;
      }
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final code = widget.couponCode?.trim();
      if (code != null && code.isNotEmpty) {
        try {
          final amount = (widget.package['discountPrice'] ?? widget.package['price']) as num?;
          await PortalApi.applyCoupon(
            code: code,
            packageId: widget.package['id']?.toString(),
            orderAmount: amount,
            note: _isBook ? 'Book Now' : 'Enquire',
          );
        } catch (_) {}
      }

      await PortalApi.createLead(
        packageId: widget.package['id']?.toString(),
        source: widget.source,
        message: _noteCtrl.text.trim().isEmpty ? null : _noteCtrl.text.trim(),
        couponCode: code,
        requestedDate: _date,
        requestedTime: _time,
      );
      if (!mounted) return;
      Haptics.success();
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    final features = (widget.package['features'] as List?) ?? [];

    return Container(
      margin: EdgeInsets.only(top: MediaQuery.paddingOf(context).top + 24),
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, 10, 20, 16 + bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.border(context),
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                _isBook ? 'Book this package' : 'Send enquiry',
                style: AppTheme.display(24),
              ),
              const SizedBox(height: 4),
              Text(
                _isBook
                    ? 'Pick a preferred date & time. The studio confirms — then it’s final.'
                    : 'Tell the studio you’re interested. Add a preferred date if you like.',
                style: TextStyle(color: AppColors.text2(context), fontSize: 13.5, height: 1.4),
              ),
              const SizedBox(height: 18),

              // Package card
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.card(context),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border(context)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_pkgTitle, style: AppTheme.display(18)),
                    if (_priceLabel.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        _priceLabel,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          color: AppColors.accent(context),
                        ),
                      ),
                    ],
                    if (features.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      ...features.take(4).map((f) {
                        final t = (f is Map ? f['title'] : f)?.toString() ?? '';
                        if (t.isEmpty) return const SizedBox.shrink();
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            children: [
                              const Icon(Icons.check_rounded, size: 15, color: AppColors.green),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(t, style: TextStyle(fontSize: 12.5, color: AppColors.text2(context))),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Date
              Text(
                _isBook ? 'Preferred date' : 'Preferred date (optional)',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: AppColors.text(context),
                ),
              ),
              const SizedBox(height: 8),
              Material(
                color: AppColors.card(context),
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  onTap: _pickDate,
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: _date != null
                            ? AppColors.text(context).withValues(alpha: 0.35)
                            : AppColors.border(context),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.calendar_today_rounded, size: 18, color: AppColors.text2(context)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _date != null ? _fmtDate(_date!) : 'Tap to choose date',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: _date != null ? FontWeight.w600 : FontWeight.w400,
                              color: _date != null ? AppColors.text(context) : AppColors.text3(context),
                            ),
                          ),
                        ),
                        Icon(Icons.chevron_right_rounded, color: AppColors.text3(context)),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Time chips
              Text(
                _isBook ? 'Preferred time' : 'Preferred time (optional)',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: AppColors.text(context),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 44,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _slots.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final t = _slots[i];
                    final sel = _time == t;
                    return ChoiceChip(
                      label: Text(_fmtTime(t)),
                      selected: sel,
                      onSelected: (_) => setState(() {
                        _time = t;
                        _error = null;
                      }),
                      selectedColor: AppColors.text(context),
                      labelStyle: TextStyle(
                        color: sel ? AppColors.bg(context) : AppColors.text(context),
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                      backgroundColor: AppColors.card(context),
                      side: BorderSide(
                        color: sel ? AppColors.text(context) : AppColors.border(context),
                      ),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      showCheckmark: false,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),

              // Note
              TextField(
                controller: _noteCtrl,
                maxLines: 2,
                decoration: InputDecoration(
                  hintText: _isBook
                      ? 'Anything we should know? (venue, guests…)'
                      : 'Your message to the studio…',
                  filled: true,
                  fillColor: AppColors.card(context),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: AppColors.border(context)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: AppColors.border(context)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: AppColors.text(context), width: 1.4),
                  ),
                ),
              ),

              if (_date != null && _time != null) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.accent(context).withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.accent(context).withValues(alpha: 0.25)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.event_available_rounded, color: AppColors.accent(context), size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${_fmtDate(_date!)} · ${_fmtTime(_time!)}'
                          '${_isBook ? '\nPending studio confirmation' : ''}',
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.35,
                            fontWeight: FontWeight.w600,
                            color: AppColors.text(context),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: AppColors.rose, fontSize: 13)),
              ],
              const SizedBox(height: 16),

              SizedBox(
                height: 52,
                child: FilledButton(
                  onPressed: _submitting ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.text(context),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(
                          _isBook ? 'Request this slot' : 'Send enquiry',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                        ),
                ),
              ),
              if (_isBook) ...[
                const SizedBox(height: 8),
                Text(
                  'Your slot is only final after the studio accepts it.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 11.5, color: AppColors.text3(context)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
