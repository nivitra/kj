import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'package:go_router/go_router.dart';
import '../services/share_links.dart';
import '../widgets/premium_ui.dart';

/// Default: WhatsApp sign up (name + number + code).
/// Sign in is a secondary path (WhatsApp code, optional password).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();

  late AnimationController _animCtrl;
  late Animation<double> _fade;

  /// signUp | signIn | otpCode | password | forgot | reset
  String _mode = 'signIn';
  String _otpIntent = 'signup';
  bool _loading = false;
  bool _obscure = true;
  String? _error;
  String? _info;
  String? _pendingPhone;
  int _resendSec = 0;
  String _otpDraft = '';

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
    _fade = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  void _switchMode(String mode) {
    setState(() {
      _mode = mode;
      _error = null;
      _info = null;
      _loading = false;
      if (mode != 'reset' && mode != 'otpCode') {
        _codeCtrl.clear();
        if (mode != 'forgot') _pendingPhone = null;
      }
    });
  }

  String _normalizePhone(String raw) {
    var s = raw.trim().replaceAll(RegExp(r'[^\d+]'), '');
    if (s.startsWith('+')) s = s.substring(1);
    s = s.replaceAll(RegExp(r'\D'), '');
    if (s.length == 10 && RegExp(r'^[6-9]').hasMatch(s)) {
      s = '91$s';
    }
    return s;
  }

  String _displayPhone(String p) {
    if (p.length >= 12 && p.startsWith('91')) {
      return '+91 ${p.substring(2, 7)} ${p.substring(7)}';
    }
    return p;
  }

  void _startResendTimer() {
    setState(() => _resendSec = 45);
    Future.doWhile(() async {
      await Future<void>.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      if (_resendSec <= 1) {
        setState(() => _resendSec = 0);
        return false;
      }
      setState(() => _resendSec--);
      return true;
    });
  }

  Future<void> _requestSignupOtp({bool isResend = false}) async {
    FocusScope.of(context).unfocus();
    final name = _nameCtrl.text.trim();
    final phone = _normalizePhone(_phoneCtrl.text);
    if (name.length < 2) {
      setState(() => _error = 'Enter your full name');
      return;
    }
    if (phone.length < 10) {
      setState(() => _error = 'Enter a valid WhatsApp number');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _info = null;
    });
    try {
      final r = await ApiService.requestSignupOtp(name: name, phone: phone);
      if (!mounted) return;
      Haptics.success();
      setState(() {
        _pendingPhone = phone;
        _otpIntent = 'signup';
        _mode = 'otpCode';
        _info = r['message']?.toString() ?? 'We sent a 6-digit code to WhatsApp.';
        _loading = false;
      });
      _startResendTimer();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _requestSignInOtp({bool isResend = false}) async {
    FocusScope.of(context).unfocus();
    final phone = _normalizePhone(_phoneCtrl.text);
    if (phone.length < 10) {
      setState(() => _error = 'Enter a valid WhatsApp number');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _info = null;
    });
    try {
      final r = await ApiService.requestLoginOtp(phone);
      if (!mounted) return;
      Haptics.success();
      setState(() {
        _pendingPhone = phone;
        _otpIntent = 'signin';
        _mode = 'otpCode';
        _info = r['message']?.toString() ?? 'Code sent on WhatsApp';
        _loading = false;
      });
      _startResendTimer();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _resendOtp() async {
    if (_otpIntent == 'signup') {
      await _requestSignupOtp(isResend: true);
    } else {
      await _requestSignInOtp(isResend: true);
    }
  }

  Future<void> _verifyOtp(String code) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final phone = _pendingPhone ?? _normalizePhone(_phoneCtrl.text);
      if (_otpIntent == 'signup') {
        await ref.read(authStateProvider.notifier).registerWithOtp(
              name: _nameCtrl.text.trim(),
              phone: phone,
              code: code,
            );
      } else {
        await ref.read(authStateProvider.notifier).loginWithOtp(phone: phone, code: code);
      }
      Haptics.success();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.errorMessage(e) ?? e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _submitPasswordFlow() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
      _info = null;
    });
    try {
      switch (_mode) {
        case 'password':
          final phone = _normalizePhone(_phoneCtrl.text);
          if (phone.length < 10) throw 'Enter your phone number';
          if (_passwordCtrl.text.isEmpty) throw 'Enter your password';
          await ref.read(authStateProvider.notifier).login(phone, _passwordCtrl.text);
          break;
        case 'forgot':
          final phone = _normalizePhone(_phoneCtrl.text);
          if (phone.length < 10) throw 'Enter the phone number on your account';
          final msg = await ApiService.forgotPassword(phone);
          if (!mounted) return;
          setState(() {
            _pendingPhone = phone;
            _info = msg;
            _mode = 'reset';
            _loading = false;
            _passwordCtrl.clear();
            _confirmCtrl.clear();
            _codeCtrl.clear();
          });
          return;
        case 'reset':
          final phone = _pendingPhone ?? _normalizePhone(_phoneCtrl.text);
          if (_codeCtrl.text.trim().length < 4) throw 'Enter the 6-digit code from WhatsApp';
          if (_passwordCtrl.text.length < 8) throw 'Password must be at least 8 characters';
          if (_passwordCtrl.text != _confirmCtrl.text) throw 'Passwords do not match';
          final msg = await ApiService.resetPassword(
            phone: phone,
            code: _codeCtrl.text.trim(),
            password: _passwordCtrl.text,
          );
          if (!mounted) return;
          setState(() {
            _info = msg;
            _mode = 'password';
            _loading = false;
            _passwordCtrl.clear();
            _confirmCtrl.clear();
            _codeCtrl.clear();
          });
          return;
        default:
          break;
      }
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
    final bottom = MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: FadeTransition(
        opacity: _fade,
        child: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(24, 24, 24, 24 + bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (safeReturnPath(GoRouterState.of(context).uri.queryParameters['from']) != null) const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('Sign in to view the shared item. We’ll take you straight there after login.'))),
                const SizedBox(height: 8),
                Center(
                  child: Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: AppColors.sunken(context),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.border(context)),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Image.asset(
                      'assets/images/logo.png',
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Icon(
                        Icons.camera_alt_rounded,
                        size: 32,
                        color: AppColors.accent(context),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'SJ Clicks and Films',
                  textAlign: TextAlign.center,
                  style: AppTheme.display(26, context: context),
                ),
                const SizedBox(height: 4),
                Text(
                  'Studio by Warmkelvin',
                  textAlign: TextAlign.center,
                  style: AppTheme.kicker(context: context),
                ),
                if (_mode == 'signUp' || _mode == 'signIn') ...[
                  const SizedBox(height: 22),
                  _authToggle(),
                  const SizedBox(height: 22),
                ] else
                  const SizedBox(height: 32),

                if (_mode == 'signUp') ..._signUp(),
                if (_mode == 'signIn') ..._signIn(),
                if (_mode == 'otpCode') ..._otpCode(),
                if (_mode == 'password' || _mode == 'forgot' || _mode == 'reset')
                  ..._passwordModes(),

                if (_error != null) ...[
                  const SizedBox(height: 14),
                  _banner(_error!, isError: true),
                ],
                if (_info != null && _error == null) ...[
                  const SizedBox(height: 14),
                  _banner(_info!, isError: false),
                ],

                const SizedBox(height: 28),
                Text(
                  'Client portal · Private photos only when shared with you',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: AppColors.text3(context), height: 1.4),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _authToggle() {
    Widget chip(String id, String label) {
      final on = _mode == id;
      return Expanded(
        child: GestureDetector(
          onTap: () => _switchMode(id),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.symmetric(vertical: 11),
            decoration: BoxDecoration(
              color: on ? AppColors.text(context) : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14,
                color: on ? AppColors.bg(context) : AppColors.text2(context),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.sunken(context),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        children: [
          chip('signIn', 'Sign in'),
          chip('signUp', 'Create account'),
        ],
      ),
    );
  }

  List<Widget> _signUp() => [
        Text('Create your account', style: AppTheme.display(28, context: context)),
        const SizedBox(height: 8),
        Text(
          'Enter your name and WhatsApp number. We’ll send a 6-digit code to verify.',
          style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 15),
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _nameCtrl,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.name],
          decoration: const InputDecoration(
            labelText: 'Full name',
            hintText: 'As you’d like the studio to see it',
          ),
        ),
        const SizedBox(height: 12),
        _phoneField(label: 'WhatsApp number'),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _loading ? null : () => _requestSignupOtp(),
          child: _loading
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Text('Continue with WhatsApp'),
        ),
      ];

  List<Widget> _signIn() => [
        Text('Welcome back', style: AppTheme.display(28, context: context)),
        const SizedBox(height: 8),
        Text(
          'Sign in with a one-time code on WhatsApp.',
          style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 15),
        ),
        const SizedBox(height: 24),
        _phoneField(label: 'WhatsApp number'),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _loading ? null : () => _requestSignInOtp(),
          child: _loading
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Text('Continue with WhatsApp'),
        ),
        const SizedBox(height: 10),
        TextButton(
          onPressed: () => _switchMode('password'),
          child: Text(
            'Use password instead',
            style: TextStyle(color: AppColors.text2(context), fontWeight: FontWeight.w500),
          ),
        ),
      ];

  List<Widget> _otpCode() => [
        Align(
          alignment: Alignment.centerLeft,
          child: IconButton(
            onPressed: () => _switchMode(_otpIntent == 'signup' ? 'signUp' : 'signIn'),
            icon: Icon(Icons.arrow_back_rounded, color: AppColors.text(context)),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _otpIntent == 'signup' ? 'Verify your WhatsApp' : 'Enter code',
          style: AppTheme.display(28, context: context),
        ),
        const SizedBox(height: 8),
        Text(
          'We sent a 6-digit code to\n${_displayPhone(_pendingPhone ?? _normalizePhone(_phoneCtrl.text))}',
          style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 15),
        ),
        const SizedBox(height: 28),
        OtpBoxes(
          onCompleted: _verifyOtp,
          onChanged: (v) => setState(() => _otpDraft = v),
        ),
        const SizedBox(height: 20),
        if (_loading)
          const Center(child: CircularProgressIndicator(strokeWidth: 2))
        else ...[
          FilledButton(
            onPressed: _otpDraft.length == 6 ? () => _verifyOtp(_otpDraft) : null,
            child: const Text('Verify code'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _resendSec > 0 ? null : _resendOtp,
            child: Text(
              _resendSec > 0 ? 'Resend in ${_resendSec}s' : 'Resend code',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: _resendSec > 0 ? AppColors.text3(context) : AppColors.accent(context),
              ),
            ),
          ),
        ],
      ];

  List<Widget> _passwordModes() {
    final titles = {
      'password': 'Sign in with password',
      'forgot': 'Reset password',
      'reset': 'New password',
    };
    return [
      Align(
        alignment: Alignment.centerLeft,
        child: IconButton(
          onPressed: () => _switchMode(_mode == 'reset' ? 'forgot' : 'signIn'),
          icon: Icon(Icons.arrow_back_rounded, color: AppColors.text(context)),
        ),
      ),
      Text(titles[_mode] ?? 'Sign in', style: AppTheme.display(28, context: context)),
      const SizedBox(height: 8),
      Text(
        _mode == 'forgot'
            ? 'We’ll send a code on WhatsApp to reset your password.'
            : _mode == 'reset'
                ? 'Enter the code and choose a new password.'
                : 'For studio-issued accounts with a password.',
        style: TextStyle(color: AppColors.text2(context), height: 1.45, fontSize: 15),
      ),
      const SizedBox(height: 22),
      if (_mode != 'reset') _phoneField(),
      if (_mode == 'reset') ...[
        TextField(
          controller: _codeCtrl,
          keyboardType: TextInputType.number,
          maxLength: 6,
          decoration: const InputDecoration(labelText: 'WhatsApp code', counterText: ''),
        ),
        const SizedBox(height: 12),
      ],
      if (_mode == 'password' || _mode == 'reset') ...[
        const SizedBox(height: 12),
        TextField(
          controller: _passwordCtrl,
          obscureText: _obscure,
          decoration: InputDecoration(
            labelText: _mode == 'reset' ? 'New password' : 'Password',
            suffixIcon: IconButton(
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
        ),
      ],
      if (_mode == 'reset') ...[
        const SizedBox(height: 12),
        TextField(
          controller: _confirmCtrl,
          obscureText: _obscure,
          decoration: const InputDecoration(labelText: 'Confirm password'),
        ),
      ],
      const SizedBox(height: 18),
      FilledButton(
        onPressed: _loading ? null : _submitPasswordFlow,
        child: _loading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : Text(
                _mode == 'forgot'
                    ? 'Send WhatsApp code'
                    : _mode == 'reset'
                        ? 'Update password'
                        : 'Sign in',
              ),
      ),
      if (_mode == 'password') ...[
        const SizedBox(height: 10),
        TextButton(
          onPressed: () => _switchMode('forgot'),
          child: Text('Forgot password?', style: TextStyle(color: AppColors.text2(context))),
        ),
        TextButton(
          onPressed: () => _switchMode('signIn'),
          child: Text(
            'Use WhatsApp code instead',
            style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.accent(context)),
          ),
        ),
      ],
    ];
  }

  Widget _phoneField({String label = 'Phone number'}) => TextField(
        controller: _phoneCtrl,
        keyboardType: TextInputType.phone,
        textInputAction: TextInputAction.done,
        autofillHints: const [AutofillHints.telephoneNumber],
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d+\s-]'))],
        decoration: InputDecoration(
          labelText: label,
          hintText: '98765 43210',
          prefixIcon: const Padding(
            padding: EdgeInsets.only(left: 14, right: 8),
            child: Center(
              widthFactor: 1,
              child: Text('🇮🇳 +91', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            ),
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        ),
      );

  Widget _banner(String text, {required bool isError}) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isError ? AppColors.rose.withValues(alpha: 0.1) : AppColors.green.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isError ? AppColors.rose.withValues(alpha: 0.3) : AppColors.green.withValues(alpha: 0.3),
          ),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: isError ? AppColors.rose : AppColors.green,
            fontSize: 13,
            height: 1.4,
            fontWeight: FontWeight.w500,
          ),
        ),
      );
}
