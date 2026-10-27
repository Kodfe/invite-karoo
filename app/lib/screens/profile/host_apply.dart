import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';

/// Host a wedding: fill this in once and the Invite Karoo team sets the whole wedding up.
class HostApplyScreen extends StatefulWidget {
  const HostApplyScreen({super.key});
  @override
  State<HostApplyScreen> createState() => _HostApplyScreenState();
}

class _HostApplyScreenState extends State<HostApplyScreen> {
  static const _steps = ['intro', 'couple', 'family', 'dates', 'guests', 'card', 'review'];
  int _step = 0;
  final c = {
    for (final k in ['brideName', 'brideParents', 'groomName', 'groomParents', 'brideFamily', 'brideElders', 'groomFamily', 'groomElders', 'city']) k: TextEditingController(),
  };
  DateTime? _start;
  DateTime? _end;
  String? _sheet;
  Json? _report;
  bool _checking = false;
  String? _card;
  Map<String, String> _errs = {};
  bool _sending = false;
  String _teamWa = '';

  @override
  void initState() {
    super.initState();
    Session.read(context).api.get('/v1/config').then((v) {
      if (mounted) setState(() => _teamWa = '${asJson(v)['teamWhatsapp'] ?? ''}');
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final x in c.values) {
      x.dispose();
    }
    super.dispose();
  }

  String _t(String k) => c[k]!.text.trim();

  bool _validate() {
    final e = <String, String>{};
    switch (_steps[_step]) {
      case 'couple':
        if (_t('brideName').length < 2) e['brideName'] = tr(context, 'Enter the bride’s name');
        if (_t('groomName').length < 2) e['groomName'] = tr(context, 'Enter the groom’s name');
      case 'family':
        if (_t('city').length < 2) e['city'] = tr(context, 'Enter the city');
      case 'dates':
        if (_start == null) e['start'] = tr(context, 'Pick the first day');
        if (_end == null) e['end'] = tr(context, 'Pick the last day');
        if (_start != null && _end != null && _end!.isBefore(_start!)) e['end'] = tr(context, 'The last day is before the first day');
        if (_start != null && _end != null && _end!.difference(_start!).inDays > 30) e['end'] = tr(context, 'That is more than a month. Check the dates.');
    }
    setState(() => _errs = e);
    return e.isEmpty;
  }

  Future<void> _template() async {
    final s = Session.read(context);
    final bytes = await guard(context, () => s.api.bytes('/v1/host-applications/template'));
    if (bytes == null) return;
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/invite-karoo-guest-list.xlsx');
    await f.writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], subject: 'Invite Karoo guest list'));
  }

  Future<void> _pickSheet() async {
    final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['xlsx', 'xls', 'csv', 'xml']);
    final p = files.isEmpty ? null : files.first.path;
    if (p == null) return;
    setState(() {
      _sheet = p;
      _checking = true;
      _report = null;
    });
    final r = await guard(context, () => Session.read(context).api.upload('/v1/host-applications/check-sheet', files: {'guests': p}));
    if (!mounted) return;
    setState(() {
      _checking = false;
      _report = r == null ? null : asJson(asJson(r)['report']);
      if (r == null) _sheet = null;
    });
  }

  Future<void> _pickCard() async {
    final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf']);
    final p = files.isEmpty ? null : files.first.path;
    if (p != null) setState(() => _card = p);
  }

  Future<void> _submit() async {
    setState(() => _sending = true);
    try {
      final data = {
        for (final k in c.keys) k: _t(k),
        'startDate': ymd(_start!),
        'endDate': ymd(_end!),
        'datesLocked': true,
      };
      await Session.read(context).api.upload(
        '/v1/host-applications',
        fields: {'data': jsonEncode(data)},
        files: {if (_sheet != null) 'guests': _sheet!, if (_card != null) 'card': _card!},
      );
      if (!mounted) return;
      await Session.read(context).refreshMe().catchError((_) {});
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HostApplySentScreen()));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _whatsapp() {
    final lines = ['Hi Invite Karoo, I would like to host a wedding on Invite Karoo.'];
    if (_t('brideName').isNotEmpty || _t('groomName').isNotEmpty) lines.add('Couple: ${[_t('brideName'), _t('groomName')].where((x) => x.isNotEmpty).join(' & ')}');
    if (_t('city').isNotEmpty) lines.add('City: ${_t('city')}');
    if (_start != null) lines.add('Dates: ${span(ymd(_start!), _end == null ? null : ymd(_end!))}');
    final n = _teamWa.replaceAll(RegExp(r'\D'), '');
    launchUrl(Uri.parse('https://wa.me/$n?text=${Uri.encodeComponent(lines.join('\n'))}'), mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final step = _steps[_step];
    final last = _step == _steps.length - 1;
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (did, _) {
        if (!did) setState(() => _step--);
      },
      child: IkPage(
        header: IkHeader(title: tr(context, 'Host a wedding'), sub: tr(context, 'Application'), art: Art.cplStand),
        bottom: BottomBar(
          child: IkButton(
            step == 'intro' ? tr(context, 'Start') : (last ? tr(context, 'Send to our team') : tr(context, 'Continue')),
            icon: last ? Icons.send_rounded : Icons.arrow_forward_rounded,
            loading: _sending,
            onPressed: () {
              if (!_validate()) return;
              if (last) {
                _submit();
              } else {
                setState(() => _step++);
              }
            },
          ),
        ),
        children: [
          Row(children: [
            for (var i = 0; i < _steps.length; i++)
              Expanded(child: Container(height: 4, margin: const EdgeInsets.symmetric(horizontal: 2), decoration: BoxDecoration(color: i <= _step ? IK.v6 : IK.line, borderRadius: BorderRadius.circular(2)))),
          ]),
          const SizedBox(height: 18),
          ...switch (step) {
            'intro' => _intro(),
            'couple' => _couple(),
            'family' => _family(),
            'dates' => _dates(),
            'guests' => _guests(),
            'card' => _cardStep(),
            _ => _review(),
          },
        ],
      ),
    );
  }

  Widget _head(String kicker, String title, String body) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr(context, kicker), style: IK.kicker(size: 21)),
          Text(tr(context, title), style: IK.title(size: 28)),
          const SizedBox(height: 8),
          Text(tr(context, body), style: IK.soft(size: 13)),
        ]),
      );

  List<Widget> _intro() => [
        _head('Host a wedding', 'Tell us about the wedding, once', 'Fill this in one time. Our team sets the whole wedding up for you and sends it to this number — you never enter anything twice.'),
        if (_teamWa.isNotEmpty)
          IkCard(
            color: IK.okBg,
            border: IK.okLine,
            child: Column(children: [
              Row(children: [
                Image.asset(Art.waCircle, width: 46),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr(context, 'Rather do it on WhatsApp?'), style: IK.h2(size: 19)),
                    Text(tr(context, 'Message our team and we fill this in for you. Send the card and guest list right there in the chat.'), style: IK.soft(size: 12)),
                  ]),
                ),
              ]),
              const SizedBox(height: 12),
              IkButton(tr(context, 'WhatsApp now'), kind: BtnKind.whatsapp, leading: Image.asset(Art.whatsappWhite, width: 20), onPressed: _whatsapp),
            ]),
          ),
        SectionTitle(tr(context, 'or fill it in here')),
        IkGroup(children: [
          IkRow(image: Art.family, title: tr(context, 'The couple and both families'), sub: tr(context, 'Names, parents and the city. This is what your guests will see.')),
          IkRow(image: Art.cal3d, title: tr(context, 'The dates'), sub: tr(context, 'When the first function starts and the last one ends.')),
          IkRow(icon: Icons.table_chart_outlined, title: tr(context, 'Your guest list, on our sheet'), sub: tr(context, 'Tick who comes to which function and who gets a gift.')),
          IkRow(image: Art.doliFrame, title: tr(context, 'Your card'), sub: tr(context, 'The PDF your guests will see, exactly as you made it.')),
        ]),
      ];

  List<Widget> _couple() => [
        _head('The couple', 'Who is getting married?', 'Names as your guests know them.'),
        Field(label: tr(context, 'Bride’s name'), required: true, controller: c['brideName'], error: _errs['brideName'], capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Bride’s parents'), controller: c['brideParents'], hint: 'Ramesh & Sunita Sharma', capitalization: TextCapitalization.words, maxLength: 80),
        Field(label: tr(context, 'Groom’s name'), required: true, controller: c['groomName'], error: _errs['groomName'], capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Groom’s parents'), controller: c['groomParents'], hint: 'Mahesh & Kavita Ranka', capitalization: TextCapitalization.words, maxLength: 80),
      ];

  List<Widget> _family() => [
        _head('Both families', 'The families and the city', 'Elders are shown on the wedding page. Separate names with commas.'),
        Field(label: tr(context, 'Bride’s family'), controller: c['brideFamily'], hint: 'Sharma Family', capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Elders on the bride’s side'), controller: c['brideElders'], lines: 2, maxLength: 200, capitalization: TextCapitalization.words),
        Field(label: tr(context, 'Groom’s family'), controller: c['groomFamily'], hint: 'Ranka Family', capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Elders on the groom’s side'), controller: c['groomElders'], lines: 2, maxLength: 200, capitalization: TextCapitalization.words),
        Field(label: tr(context, 'City'), required: true, controller: c['city'], error: _errs['city'], capitalization: TextCapitalization.words, maxLength: 40, icon: Icons.location_city_outlined),
      ];

  List<Widget> _dates() {
    Future<void> pick(bool first) async {
      final d = await showDatePicker(
        context: context,
        initialDate: (first ? _start : _end) ?? _start ?? DateTime.now().add(const Duration(days: 30)),
        firstDate: DateTime.now(),
        lastDate: DateTime.now().add(const Duration(days: 900)),
      );
      if (d == null) return;
      setState(() {
        if (first) {
          _start = d;
        } else {
          _end = d;
        }
      });
    }

    return [
      _head('The dates', 'When is it?', 'From the first function to the last. These lock when you submit.'),
      Field(label: tr(context, 'First day'), required: true, readOnly: true, icon: Icons.calendar_month_outlined, error: _errs['start'],
          controller: TextEditingController(text: _start == null ? '' : weekdayDay(_start!)), onTap: () => pick(true)),
      Field(label: tr(context, 'Last day'), required: true, readOnly: true, icon: Icons.calendar_month_outlined, error: _errs['end'],
          controller: TextEditingController(text: _end == null ? '' : weekdayDay(_end!)), onTap: () => pick(false)),
    ];
  }

  List<Widget> _guests() {
    final rep = _report;
    final errors = (rep?['errors'] as List?) ?? const [];
    return [
      _head('Your guest list', 'On our ready-made sheet', 'Download the sheet, fill one row per guest, mark Y for each function they are invited to, and upload it back. You can also send it later.'),
      IkButton(tr(context, 'Download the sheet'), kind: BtnKind.ghost, icon: Icons.download_rounded, onPressed: _template),
      const SizedBox(height: 10),
      IkButton(_sheet == null ? tr(context, 'Upload the filled sheet') : tr(context, 'Upload a different file'), icon: Icons.upload_file_rounded, loading: _checking, onPressed: _pickSheet),
      const SizedBox(height: 14),
      if (rep != null)
        IkCard(
          border: errors.isEmpty ? IK.okLine : IK.badLine,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(_sheet!.split(Platform.pathSeparator).last, style: IK.strong(size: 13)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: StatTile(value: '${rep['guests']}', label: tr(context, 'Guests'), color: IK.ok)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '${(rep['functions'] as List?)?.length ?? 0}', label: tr(context, 'Functions'))),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '${rep['gifts']}', label: tr(context, 'Gifts'), color: IK.goldInk)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '${rep['bad']}', label: tr(context, 'Skipped'), color: IK.bad)),
            ]),
            for (final e in errors) Padding(padding: const EdgeInsets.only(top: 8), child: Note('$e', tone: Tone.bad, icon: Icons.error_outline_rounded)),
            for (final w in (rep['warnings'] as List? ?? const [])) Padding(padding: const EdgeInsets.only(top: 8), child: Note('$w', tone: Tone.gold, icon: Icons.warning_amber_rounded)),
            for (final b in (rep['badRows'] as List? ?? const [])) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $b', style: IK.soft(size: 11.5))),
          ]),
        ),
      if (rep == null) Note(tr(context, 'Rows with a missing name or a wrong number are skipped and shown to you — the rest still go in.')),
    ];
  }

  List<Widget> _cardStep() => [
        _head('Your card', 'The invitation card', 'Upload the PDF your guests will see. We never change it.'),
        IkCard(
          onTap: _pickCard,
          child: Row(children: [
            Image.asset(Art.doliFrame, width: 56),
            const SizedBox(width: 12),
            Expanded(
              child: Text(_card == null ? tr(context, 'Choose the card PDF') : _card!.split(Platform.pathSeparator).last, style: IK.strong(size: 14)),
            ),
            Icon(_card == null ? Icons.upload_rounded : Icons.check_circle_rounded, color: _card == null ? IK.v6 : IK.ok),
          ]),
        ),
        const SizedBox(height: 10),
        Note(tr(context, 'No PDF yet? Skip this — you can send it to our team on WhatsApp later.')),
      ];

  List<Widget> _review() => [
        _head('Review', 'Check and send', 'Our team sets everything up and messages you on WhatsApp when your console is ready.'),
        IkGroup(children: [
          IkRow(image: Art.gathbandhan, title: '${_t('brideName')} & ${_t('groomName')}', sub: '${_t('city')}', onTap: () => setState(() => _step = 1)),
          IkRow(image: Art.cal3d, title: _start == null ? '' : span(ymd(_start!), _end == null ? null : ymd(_end!)), sub: tr(context, 'Dates lock when you submit'), onTap: () => setState(() => _step = 3)),
          IkRow(
            icon: Icons.table_chart_outlined,
            title: _report == null ? tr(context, 'Guest list: send later') : tr(context, '{n} guests on the sheet', {'n': _report!['guests']}),
            onTap: () => setState(() => _step = 4),
          ),
          IkRow(image: Art.doliFrame, title: _card == null ? tr(context, 'Card: send later') : tr(context, 'Card attached'), onTap: () => setState(() => _step = 5)),
        ]),
      ];
}

class HostApplySentScreen extends StatelessWidget {
  const HostApplySentScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Widget step(int n, String t, String s, {bool done = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: done ? IK.okBg : IK.g1, border: Border.all(color: done ? IK.okLine : IK.g2)),
              child: done ? const Icon(Icons.check_rounded, size: 16, color: IK.ok) : Text('$n', style: IK.strong(size: 13, color: IK.g6)),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(tr(context, t), style: IK.h2(size: 18)), Text(tr(context, s), style: IK.soft(size: 12))])),
          ]),
        );
    return IkPage(
      header: IkHeader(title: tr(context, 'Application sent'), sub: tr(context, 'Host a wedding'), art: Art.cplWalk),
      bottom: BottomBar(child: IkButton(tr(context, 'Back to my agenda'), onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst))),
      children: [
        IkCard(
          child: Column(children: [
            Image.asset(Art.cplWalk, height: 150),
            const SizedBox(height: 8),
            const Icon(Icons.check_circle_rounded, color: IK.ok, size: 44),
            const SizedBox(height: 8),
            Text(tr(context, 'It is with our team'), style: IK.title(size: 26)),
            const SizedBox(height: 6),
            Text(tr(context, 'We have your details and your files. Nothing else is needed from you right now.'), textAlign: TextAlign.center, style: IK.soft(size: 13)),
          ]),
        ),
        const SizedBox(height: 14),
        IkCard(
          child: Column(children: [
            step(1, 'Application received', 'Your details and files are with us', done: true),
            step(2, 'We set the wedding up', 'Every function, every guest, and who gets a gift. Usually within one working day.'),
            step(3, 'Everything opens on this number', 'You get a message on WhatsApp. Open the app and your console is ready.'),
          ]),
        ),
      ],
    );
  }
}
