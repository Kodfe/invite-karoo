import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'manual.dart';

/// Point at a printed card; Invite Karoo AI reads the names, dates, venue and every function.
/// Nothing is saved until the guest checks the result.
class AiScanScreen extends StatefulWidget {
  const AiScanScreen({super.key});
  @override
  State<AiScanScreen> createState() => _AiScanScreenState();
}

class _AiScanScreenState extends State<AiScanScreen> {
  String _state = 'idle'; // idle | scanning | result
  String? _path;
  Json? _result;

  Future<void> _camera() async {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
    if (x != null) _scan(x.path);
  }

  Future<void> _upload() async {
    final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'pdf']);
    final p = files.isEmpty ? null : files.first.path;
    if (p != null) _scan(p);
  }

  Future<void> _scan(String path) async {
    setState(() {
      _path = path;
      _state = 'scanning';
    });
    try {
      final r = asJson(await Session.read(context).api.upload('/v1/events/scan', files: {'file': path}));
      if (!mounted) return;
      setState(() {
        _result = r;
        _state = 'result';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _state = 'idle');
      showError(context, e);
    }
  }

  static const _kindToType = {
    'wedding': 'Wedding',
    'meeting': 'Meeting',
    'birthday': 'Birthday',
    'appointment': 'Appointment',
    'celebration': 'Celebration',
  };

  void _use() {
    final r = _result!;
    final notes = [
      if ('${r['host'] ?? ''}'.isNotEmpty) '${tr(context, 'Host')}: ${r['host']}',
      if ('${r['hostContact'] ?? ''}'.isNotEmpty) '${tr(context, 'Contact')}: ${r['hostContact']}',
      if ('${r['notes'] ?? ''}'.isNotEmpty) '${r['notes']}',
    ].join('\n');
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => ManualEventScreen(prefill: {
        'type': _kindToType['${r['kind']}'] ?? 'Other',
        'title': r['title'],
        'date': r['date'],
        'time': r['time'],
        'venue': r['venue'],
        'city': r['city'],
        'notes': notes,
        'source': 'ai',
        'functions': asList(r['functions']),
      }),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    return IkPage(
      header: IkHeader(
        kicker: tr(context, 'Invite Karoo AI'),
        title: _state == 'result' ? tr(context, 'Here is what we read') : tr(context, 'Scan the card'),
        sub: _state == 'result' ? tr(context, 'Check it once, then save') : tr(context, 'Point, and the AI reads it for you'),
        art: Art.aiBox,
        actions: [if (_state == 'result') SquareBtn(icon: Icons.refresh_rounded, onTap: () => setState(() => _state = 'idle'))],
      ),
      bottom: _state == 'result' ? BottomBar(child: IkButton(tr(context, 'Check and save'), icon: Icons.arrow_forward_rounded, onPressed: _use)) : null,
      children: [
        if (_state != 'result')
          IkCard(
            padding: const EdgeInsets.all(12),
            child: Column(children: [
              Container(
                height: 240,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  gradient: const LinearGradient(colors: [Color(0xFFF1E8FF), Color(0xFFFFF0F4)]),
                  border: Border.all(color: IK.gold.withValues(alpha: .5), width: 1.4),
                ),
                clipBehavior: Clip.antiAlias,
                child: Stack(fit: StackFit.expand, children: [
                  if (_path != null && !_path!.toLowerCase().endsWith('.pdf'))
                    Image.file(File(_path!), fit: BoxFit.cover)
                  else
                    Padding(padding: const EdgeInsets.all(18), child: Image.asset(Art.doliFrame)),
                  Positioned(right: 24, top: 18, child: Image.asset(Art.aiStars, height: 40)),
                  if (_state == 'scanning')
                    Container(
                      color: IK.ink.withValues(alpha: .55),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        const CircularProgressIndicator(color: IK.g4),
                        const SizedBox(height: 14),
                        Text(tr(context, 'Reading the card…'), style: IK.strong(size: 15, color: Colors.white)),
                        const SizedBox(height: 4),
                        Text(tr(context, 'Names, dates, venue and every function'), style: IK.body(size: 12, color: IK.v2)),
                      ]),
                    ),
                ]),
              ),
              const SizedBox(height: 14),
              Text(tr(context, 'Point at the card'), style: IK.title(size: 24)),
              const SizedBox(height: 6),
              Text(tr(context, 'Lay the invitation flat in good light. We read the names, the dates, the venue and every function on it.'),
                  textAlign: TextAlign.center, style: IK.soft(size: 12.5)),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(child: IkButton(tr(context, 'Camera'), icon: Icons.photo_camera_outlined, compact: true, onPressed: _state == 'scanning' ? null : _camera)),
                const SizedBox(width: 10),
                Expanded(child: IkButton(tr(context, 'Upload'), icon: Icons.upload_rounded, compact: true, kind: BtnKind.ghost, onPressed: _state == 'scanning' ? null : _upload)),
              ]),
            ]),
          )
        else if (r != null) ...[
          IkCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Pill(tr(context, '{k} card', {'k': tr(context, _kindToType['${r['kind']}'] ?? 'Other')}), tone: Tone.mag, icon: Icons.auto_awesome_rounded),
              const SizedBox(height: 8),
              Text('${r['title']}', style: IK.title(size: 24)),
              const SizedBox(height: 10),
              for (final row in [
                ('Bride', r['bride']),
                ('Groom', r['groom']),
                ('Host', r['host']),
                ('Host contact', r['hostContact']),
                ('Date', r['date'] == null ? null : '${dayMonthYear(parseDay(r['date'])!)}${r['endDate'] != null && r['endDate'] != r['date'] ? ' – ${dayMonthYear(parseDay(r['endDate'])!)}' : ''}'),
                ('Time', r['time']),
                ('Venue', r['venue']),
                ('City', r['city']),
                ('Notes', r['notes']),
              ])
                if ('${row.$2 ?? ''}'.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      SizedBox(width: 96, child: Text(tr(context, row.$1), style: IK.soft(size: 12))),
                      Expanded(child: Text('${row.$2}', style: IK.strong(size: 13))),
                    ]),
                  ),
            ]),
          ),
          if (asList(r['functions']).isNotEmpty) ...[
            SectionTitle(tr(context, 'Functions on the card'), count: asList(r['functions']).length),
            IkGroup(children: [
              for (final f in asList(r['functions']))
                IkRow(
                  image: Art.forFunction('${f['name']}'),
                  title: '${f['name']}',
                  sub: [
                    if (f['date'] != null && parseDay(f['date']) != null) dayMonth(parseDay(f['date'])!),
                    if (f['time'] != null) '${f['time']}',
                    if ('${f['venue'] ?? ''}'.isNotEmpty) '${f['venue']}',
                    if ('${f['note'] ?? ''}'.isNotEmpty) '${f['note']}',
                  ].join(' · '),
                ),
            ]),
          ],
          const SizedBox(height: 12),
          Note(tr(context, 'Nothing is saved yet. On the next screen you can fix anything the AI read wrong.'), icon: Icons.info_outline_rounded),
        ],
      ],
    );
  }
}
