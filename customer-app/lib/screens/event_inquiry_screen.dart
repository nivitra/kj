import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/api_service.dart';
import '../services/portal_api.dart';
import '../theme/app_theme.dart';

class EventInquiryScreen extends StatefulWidget {
  const EventInquiryScreen({super.key});
  @override
  State<EventInquiryScreen> createState() => _EventInquiryScreenState();
}
class _EventInquiryScreenState extends State<EventInquiryScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController(), _phone = TextEditingController(), _email = TextEditingController();
  final _organization = TextEditingController(), _venue = TextEditingController(), _duration = TextEditingController();
  final _guests = TextEditingController(), _deliverables = TextEditingController(), _notes = TextEditingController();
  Map<String,dynamic>? _catalog;
  final _services = <String>{};
  String _kind = 'CORPORATE', _budget = 'UNSURE';
  String? _error;
  DateTime? _date;
  bool _flexible = true, _saving = false, _sent = false;
  int _step = 0;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try {
      final response = await ApiService.dio.get('/portal/event-inquiry/catalog');
      final data = Map<String,dynamic>.from(ApiService.unwrapData(response));
      if (!mounted) return;
      setState(() { _catalog = data; _kind = (data['eventTypes'] as List).first['id'].toString(); _budget = (data['budgetTiers'] as List).last['id'].toString(); _error = null; });
      final profile = await PortalApi.profile();
      if (!mounted) return;
      if (_name.text.isEmpty) _name.text = profile['name']?.toString() ?? '';
      if (_phone.text.isEmpty) _phone.text = profile['phone']?.toString() ?? '';
      if (_email.text.isEmpty) _email.text = profile['email']?.toString() ?? '';
    } catch (e) { if (mounted) setState(() => _error = ApiService.errorMessage(e)); }
  }
  @override
  void dispose() { for (final c in [_name,_phone,_email,_organization,_venue,_duration,_guests,_deliverables,_notes]) { c.dispose(); } super.dispose(); }
  Future<void> _pickDate() async {
    final now = DateUtils.dateOnly(DateTime.now());
    final date = await showDatePicker(context: context, initialDate: _date ?? now, firstDate: now, lastDate: DateTime(now.year+3,now.month,now.day));
    if (date != null && mounted) setState(() { _date = date; _flexible = false; });
  }
  Future<void> _next() async {
    if (!_form.currentState!.validate()) return;
    if (_step == 0 && !_flexible && _date == null) { setState(() => _error = 'Choose your date or select date not decided.'); return; }
    if (_step == 1 && _services.isEmpty) { setState(() => _error = 'Choose at least one service.'); return; }
    if (_step < 2) { setState(() { _step++; _error = null; }); return; }
    setState(() { _saving = true; _error = null; });
    try {
      await ApiService.dio.post('/portal/event-inquiry', data: {'kind':_kind,'contact':{'name':_name.text.trim(),'phone':_phone.text.trim(),'email':_email.text.trim(),'countryCode':'+91'},'organization':_organization.text.trim(),'venue':_venue.text.trim(),'flexible':_flexible,'date':_date?.toIso8601String().substring(0,10),'services':_services.toList(),'budgetTier':_budget,'duration':_duration.text.trim(),'guestCount':int.tryParse(_guests.text),'deliverables':_deliverables.text.trim(),'notes':_notes.text.trim()});
      if (mounted) setState(() => _sent = true);
    } catch (e) { if (mounted) setState(() => _error = ApiService.errorMessage(e)); }
    finally { if (mounted) setState(() => _saving = false); }
  }
  Widget _field(String label, TextEditingController controller, {bool required = false, int lines = 1, TextInputType? keyboard}) => Padding(padding: const EdgeInsets.only(bottom:18),child:TextFormField(controller:controller,maxLines:lines,keyboardType:keyboard,decoration:InputDecoration(labelText:label,filled:true),validator:(v) { if (required && (v??'').trim().isEmpty) return 'Please enter ${label.toLowerCase()}'; if (controller==_phone && (v??'').replaceAll(RegExp(r'\D'),'').length<7) return 'Enter a valid phone number'; if (controller==_email && (v??'').isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v!)) return 'Enter a valid email'; return null; }));
  String _label(String field,String id) => (_catalog?[field] as List? ?? []).firstWhere((r)=>r['id']==id,orElse:()=>{'label':id})['label'].toString();
  Widget _summary(String label,String value) => Padding(padding:const EdgeInsets.symmetric(vertical:10),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label,style:TextStyle(color:AppColors.text2(context),fontSize:12)),const SizedBox(height:4),Text(value.isEmpty?'Not specified':value)]));
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar:AppBar(title:const Text('Plan your event')),
    body:SafeArea(child:Center(child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:680),child:_sent ? Padding(padding:const EdgeInsets.all(32),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[const Icon(Icons.check_circle_outline,size:56),const SizedBox(height:24),Text('Your plans are with us',style:AppTheme.display(30)),const SizedBox(height:16),const Text('The studio will review your event and prepare a tailored quotation. Your date is confirmed only after booking.',textAlign:TextAlign.center),const SizedBox(height:24),FilledButton(onPressed:()=>context.go('/home'),child:const Text('Back to home'))])) : _catalog==null ? Column(mainAxisAlignment:MainAxisAlignment.center,children:[if (_error==null) const CircularProgressIndicator() else ...[Text(_error!),TextButton(onPressed:_load,child:const Text('Try again'))]]) : Form(key:_form,child:ListView(padding:const EdgeInsets.fromLTRB(24,24,24,48),children:[
      Text('A gathering worth remembering.',style:AppTheme.display(32)),const SizedBox(height:12),Text('Corporate events, celebrations and creative projects. Tell us what you have in mind.',style:TextStyle(color:AppColors.text2(context),height:1.6)),const SizedBox(height:28),
      LinearProgressIndicator(value:(_step+1)/3),const SizedBox(height:12),Text('STEP ${_step+1} OF 3 · ${['Your event','Coverage & contact','Review your enquiry'][_step]}'),const SizedBox(height:28),
      if (_step==0) ...[
        DropdownButtonFormField<String>(initialValue:_kind,isExpanded:true,decoration:const InputDecoration(labelText:'Event type'),items:(_catalog!['eventTypes'] as List).map((r)=>DropdownMenuItem(value:r['id'].toString(),child:Text(r['label'].toString()))).toList(),onChanged:(v)=>setState(()=>_kind=v!)),const SizedBox(height:20),
        _field('Company or organisation (optional)',_organization),_field('Venue or city',_venue,required:true),
        SwitchListTile.adaptive(contentPadding:EdgeInsets.zero,title:const Text('Date not decided yet'),value:_flexible,onChanged:(v)=>setState(()=>_flexible=v)),
        if (!_flexible) OutlinedButton.icon(onPressed:_pickDate,icon:const Icon(Icons.calendar_today_outlined),label:Text(_date==null?'Choose event date':_date!.toIso8601String().substring(0,10))),const SizedBox(height:20),
        _field('Approximate duration (optional)',_duration),_field('Number of guests (optional)',_guests,keyboard:TextInputType.number),
      ],
      if (_step==1) ...[
        const Text('What would you like us to capture?'),const SizedBox(height:12),Wrap(spacing:8,runSpacing:8,children:(_catalog!['services'] as List).map((r)=>FilterChip(label:Text(r['label'].toString()),selected:_services.contains(r['id']),onSelected:(v)=>setState((){if(v){_services.add(r['id']);}else{_services.remove(r['id']);}}))).toList()),const SizedBox(height:24),
        DropdownButtonFormField<String>(initialValue:_budget,isExpanded:true,decoration:const InputDecoration(labelText:'Budget range'),items:(_catalog!['budgetTiers'] as List).map((r)=>DropdownMenuItem(value:r['id'].toString(),child:Text(r['label'].toString()))).toList(),onChanged:(v)=>setState(()=>_budget=v!)),const SizedBox(height:24),
        _field('Deliverables you have in mind (optional)',_deliverables,lines:2),_field('Your name',_name,required:true),_field('Phone / WhatsApp',_phone,required:true,keyboard:TextInputType.phone),_field('Email (optional)',_email,keyboard:TextInputType.emailAddress),_field('Anything else we should know? (optional)',_notes,lines:3),
      ],
      if (_step==2) ...[
        _summary('Event',_label('eventTypes',_kind)),_summary('Organisation',_organization.text),_summary('Location',_venue.text),_summary('Date',_flexible?'To be decided':_date!.toIso8601String().substring(0,10)),_summary('Coverage',_services.map((id)=>_label('services',id)).join(', ')),_summary('Budget',_label('budgetTiers',_budget)),_summary('Contact','${_name.text}\n${_phone.text}\n${_email.text}'),_summary('Deliverables',_deliverables.text),const SizedBox(height:16),const Text('This is an enquiry. No package, payment or date reservation is created until you agree a plan with the studio.'),const SizedBox(height:24),
      ],
      if (_error!=null) Padding(padding:const EdgeInsets.only(bottom:16),child:Text(_error!,style:const TextStyle(color:AppColors.rose))),
      Row(children:[if (_step>0) TextButton(onPressed:_saving?null:()=>setState(()=>_step--),child:const Text('Back')),const Spacer(),FilledButton(onPressed:_saving?null:_next,child:Text(_saving?'Sending…':_step==2?'Send enquiry':'Continue'))]),
    ]))))),
  );
}
