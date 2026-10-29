import '../widgets/share_link_button.dart';
import '../widgets/app_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';
import '../widgets/studio_branding.dart';

/// Full studio profile / contact — branding, about, hours, socials, enquiry.
class ContactScreen extends StatefulWidget {
  const ContactScreen({super.key});
  @override
  State<ContactScreen> createState() => _ContactScreenState();
}

class _ContactScreenState extends State<ContactScreen> {
  Map<String, dynamic>? _c;
  bool _loading = true;
  String? _error;
  bool _sending = false;

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
      final c = await PortalApi.contact();
      if (mounted) {
        setState(() {
          _c = c;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _launch(String? value, {required String kind}) async {
    if (value == null || value.isEmpty) return;
    Uri uri;
    switch (kind) {
      case 'tel':
        uri = Uri.parse('tel:${value.replaceAll(RegExp(r'\s+'), '')}');
        break;
      case 'mail':
        uri = Uri.parse('mailto:$value');
        break;
      case 'wa':
        var d = value.replaceAll(RegExp(r'[^\d]'), '');
        // India 10-digit local → WhatsApp E.164 without +
        if (d.length == 10 && RegExp(r'^[6-9]').hasMatch(d)) d = '91$d';
        uri = Uri.parse('https://wa.me/$d');
        break;
      case 'ig':
        var v = value.trim();
        if (!v.startsWith('http')) {
          v = 'https://instagram.com/${v.replaceFirst(RegExp(r'^@'), '')}';
        }
        uri = Uri.parse(v);
        break;
      case 'fb':
        var v = value.trim();
        if (!v.startsWith('http')) v = 'https://facebook.com/$v';
        uri = Uri.parse(v);
        break;
      case 'yt':
        var v = value.trim();
        if (!v.startsWith('http')) v = 'https://youtube.com/$v';
        uri = Uri.parse(v);
        break;
      default:
        uri = Uri.parse(value.startsWith('http') ? value : 'https://$value');
    }
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _copy(String? value, String label) async {
    if (value == null || value.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copied'), backgroundColor: AppColors.text(context)),
    );
  }

  Future<void> _enquire() async {
    setState(() => _sending = true);
    try {
      await PortalApi.createLead(source: 'CONTACT', message: 'Contact request from client app');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Studio notified — they will get back to you'),
          backgroundColor: AppColors.text(context),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiService.errorMessage(e) ?? 'Could not send enquiry'),
          backgroundColor: AppColors.rose,
        ),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final name = c?['displayName']?.toString() ?? 'Studio';

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(actions: const [ShareLinkButton(path: '/contact')], leading: const AppBackButton(),
        backgroundColor: AppColors.bg(context),
        surfaceTintColor: Colors.transparent,
        title: Text('Studio', style: AppTheme.display(22)),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.text(context)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load studio profile'),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  color: AppColors.text(context),
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpace.page, AppSpace.xxs, AppSpace.page, AppSpace.bottomNav),
                    children: [
                      StudioHeroCard(profile: c, fallbackName: name, aspectRatio: 16 / 10),
                      if ((c?['about'] as String?)?.trim().isNotEmpty == true) ...[
                        const SizedBox(height: AppSpace.md),
                        Text('About', style: AppTheme.display(17)),
                        const SizedBox(height: AppSpace.xs),
                        Text(
                          c!['about'].toString().trim(),
                          style: TextStyle(color: AppColors.text2(context), height: 1.4, fontSize: 13),
                        ),
                      ],
                      if ((c?['welcomeMessage'] as String?)?.trim().isNotEmpty == true) ...[
                        const SizedBox(height: AppSpace.sm),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(AppSpace.sm),
                          decoration: BoxDecoration(
                            color: AppColors.sunken(context),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            c!['welcomeMessage'].toString().trim(),
                            style: TextStyle(
                              color: AppColors.text2(context),
                              height: 1.4,
                              fontSize: 13,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: AppSpace.md),
                      Text('Get in touch', style: AppTheme.display(17)),
                      const SizedBox(height: AppSpace.xs),
                      // Quick action chips
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (_has(c, 'phone'))
                            _chip(Icons.call_outlined, 'Call', () => _launch(c!['phone'] as String?, kind: 'tel')),
                          if (_has(c, 'whatsapp') || _has(c, 'phone'))
                            _chip(
                              Icons.chat_outlined,
                              'WhatsApp',
                              () => _launch((c!['whatsapp'] ?? c['phone']) as String?, kind: 'wa'),
                            ),
                          if (_has(c, 'email'))
                            _chip(Icons.email_outlined, 'Email', () => _launch(c!['email'] as String?, kind: 'mail')),
                          if (_has(c, 'website'))
                            _chip(Icons.language_rounded, 'Website', () => _launch(c!['website'] as String?, kind: 'web')),
                        ],
                      ),
                      const SizedBox(height: 16),
                      _infoCard(
                        Icons.place_outlined,
                        'Address',
                        c?['address']?.toString(),
                        trailing: c?['mapsUrl'] != null
                            ? TextButton(
                                onPressed: () => _launch(c?['mapsUrl'] as String?, kind: 'web'),
                                child: const Text('Maps'),
                              )
                            : null,
                      ),
                      _infoCard(Icons.schedule_outlined, 'Working hours', c?['workingHours']?.toString()),
                      _infoCard(
                        Icons.call_outlined,
                        'Phone',
                        c?['phone']?.toString(),
                        onTap: () => _launch(c?['phone'] as String?, kind: 'tel'),
                        onLongPress: () => _copy(c?['phone']?.toString(), 'Phone'),
                      ),
                      _infoCard(
                        Icons.chat_outlined,
                        'WhatsApp',
                        (c?['whatsapp'] ?? c?['phone'])?.toString(),
                        onTap: () => _launch((c?['whatsapp'] ?? c?['phone']) as String?, kind: 'wa'),
                      ),
                      _infoCard(
                        Icons.email_outlined,
                        'Email',
                        c?['email']?.toString(),
                        onTap: () => _launch(c?['email'] as String?, kind: 'mail'),
                        onLongPress: () => _copy(c?['email']?.toString(), 'Email'),
                      ),
                      if (_has(c, 'website'))
                        _infoCard(
                          Icons.language_rounded,
                          'Website',
                          c!['website'].toString(),
                          onTap: () => _launch(c['website'] as String?, kind: 'web'),
                        ),
                      if (_has(c, 'instagram'))
                        _infoCard(
                          Icons.camera_alt_outlined,
                          'Instagram',
                          c!['instagram'].toString(),
                          onTap: () => _launch(c['instagram'] as String?, kind: 'ig'),
                        ),
                      if (_has(c, 'facebook'))
                        _infoCard(
                          Icons.public_outlined,
                          'Facebook',
                          c!['facebook'].toString(),
                          onTap: () => _launch(c['facebook'] as String?, kind: 'fb'),
                        ),
                      if (_has(c, 'youtube'))
                        _infoCard(
                          Icons.ondemand_video_outlined,
                          'YouTube',
                          c!['youtube'].toString(),
                          onTap: () => _launch(c['youtube'] as String?, kind: 'yt'),
                        ),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        onPressed: _sending ? null : _enquire,
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.text(context),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                        icon: _sending
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.send_rounded, size: 18),
                        label: Text(
                          _sending ? 'Sending…' : 'Send enquiry to studio',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'We notify the studio team. They will reply on your registered phone or email.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.text3(context), fontSize: 12, height: 1.4),
                      ),
                    ],
                  ),
                ),
    );
  }

  bool _has(Map? c, String key) {
    final v = c?[key]?.toString().trim();
    return v != null && v.isNotEmpty;
  }

  Widget _chip(IconData icon, String label, VoidCallback onTap) {
    return ActionChip(
      avatar: Icon(icon, size: 16, color: AppColors.text(context)),
      label: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
      backgroundColor: AppColors.card(context),
      side: BorderSide(color: AppColors.border(context)),
      onPressed: onTap,
    );
  }

  Widget _infoCard(
    IconData icon,
    String label,
    String? value, {
    VoidCallback? onTap,
    VoidCallback? onLongPress,
    Widget? trailing,
  }) {
    final empty = value == null || value.trim().isEmpty;
    if (empty && trailing == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.card(context),
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: empty ? null : onTap,
          onLongPress: empty ? null : onLongPress,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 14, 10, 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border(context)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: AppColors.text2(context)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: AppTheme.kicker()),
                      const SizedBox(height: 4),
                      Text(
                        empty ? 'Not provided' : value,
                        style: TextStyle(
                          fontWeight: FontWeight.w500,
                          color: empty ? AppColors.text3(context) : AppColors.text(context),
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                if (trailing != null) trailing,
                if (!empty && onTap != null)
                  Icon(Icons.chevron_right_rounded, color: AppColors.text3(context)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
