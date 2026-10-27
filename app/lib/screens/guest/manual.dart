import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';

const eventKinds = [
  ('Wedding', 'Several functions across days', 'homeCouple'),
  ('Meeting', 'Work, client or committee', 'photoWork'),
  ('Appointment', 'Clinic, bank, government', 'photoHealth'),
  ('Celebration', 'Birthday, anniversary, party', 'photoCelebrate'),
  ('Birthday', 'A birthday to remember', 'photoCelebrate'),
  ('Personal', 'Family, home, anything of yours', 'photoPlan'),
  ('Other', 'Travel, a trip, anything else', 'photoCity'),
];

String kindPhoto(String type) => Art.forEventType(type);

class _Fn {
  _Fn({this.name = '', this.date, this.time, this.venue = '', this.note = ''});
  String name;
  DateTime? date;
  TimeOfDay? time;
  String venue;
  String note;
}

/// The five-step wizard: kind → details → functions (weddings only) → reminders → review.
/// Also used to edit an event, and to check what the AI read off a card before saving.
class ManualEventScreen extends StatefulWidget {
  const ManualEventScreen({super.key, this.initialType, this.prefill, this.editId});
  final String? initialType;
  final Json? prefill;
  final String? editId;

  @override
  State<ManualEventScreen> createState() => _ManualEventScreenState();
}

class _ManualEventScreenState extends State<ManualEventScreen> {
  int _step = 0;
  String _type = 'Personal';
  final _title = TextEditingController();
  final _venue = TextEditingController();
  final _city = TextEditingController();
  final _notes = TextEditingController();
  DateTime? _date;
  TimeOfDay? _time;
  bool _allDay = false;
  final List<_Fn> _fns = [];
  final Set<int> _rem = {120, 60, 30};
  bool _saving = false;
  String _source = 'manual';
  Map<String, String> _errs = {};

  bool get _wedding => _type == 'Wedding';
  List<String> get _steps => ['Type', 'Details', if (_wedding) 'Functions', 'Reminders', 'Review'];

  @override
  void initState() {
    super.initState();
    if (widget.initialType != null) {
      _type = widget.initialType!;
      _step = 1;
    }
    final p = widget.prefill;
    if (p != null) {
      _type = '${p['type'] ?? _type}';
      _title.text = '${p['title'] ?? ''}';
      _venue.text = '${p['venue'] ?? ''}';
      _city.text = '${p['city'] ?? ''}';
      _notes.text = '${p['notes'] ?? ''}';
      _date = parseDay(p['date']);
      _time = _parseTime(p['time']);
      _allDay = _time == null && p['date'] != null;
      _source = '${p['source'] ?? 'manual'}';
      for (final f in asList(p['functions'])) {
        _fns.add(_Fn(name: '${f['name'] ?? ''}', date: parseDay(f['date']), time: _parseTime(f['time']), venue: '${f['venue'] ?? ''}', note: '${f['note'] ?? ''}'));
      }
      if (p['reminders'] is List) {
        _rem
          ..clear()
          ..addAll((p['reminders'] as List).map(toInt));
      }
      _step = 1;
    }
  }

  TimeOfDay? _parseTime(dynamic v) {
    final s = '${v ?? ''}';
    final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(s);
    if (m == null) return null;
    return TimeOfDay(hour: int.parse(m.group(1)!), minute: int.parse(m.group(2)!));
  }

  String _hm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    for (final c in [_title, _venue, _city, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  bool _validate() {
    final e = <String, String>{};
    final name = _steps[_step];
    if (name == 'Details') {
      if (_title.text.trim().isEmpty) e['title'] = tr(context, 'Give it a name');
      if (_date == null) e['date'] = tr(context, 'Pick a date');
      if (!_allDay && _time == null && !_wedding) e['time'] = tr(context, 'Pick a time, or mark it all day');
    }
    if (name == 'Functions') {
      for (var i = 0; i < _fns.length; i++) {
        if (_fns[i].name.trim().isEmpty || _fns[i].date == null) e['fn$i'] = tr(context, 'Each function needs a name and a date');
      }
    }
    setState(() => _errs = e);
    return e.isEmpty;
  }

  void _next() {
    if (!_validate()) return;
    if (_step < _steps.length - 1) {
      setState(() => _step++);
    } else {
      _save();
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final body = {
      'title': _title.text.trim(),
      'type': _type,
      'date': ymd(_date!),
      'time': _allDay || _time == null ? null : _hm(_time!),
      'venue': _venue.text.trim(),
      'city': _city.text.trim(),
      'notes': _notes.text.trim(),
      'source': _source,
      'reminders': _rem.toList()..sort((a, b) => b - a),
      if (_wedding)
        'functions': [
          for (final f in _fns)
            {'name': f.name.trim(), 'date': ymd(f.date!), 'time': f.time == null ? '' : _hm(f.time!), 'venue': f.venue.trim(), 'note': f.note.trim()},
        ],
    };
    final s = Session.read(context);
    try {
      if (widget.editId != null) {
        await s.api.patch('/v1/events/${widget.editId}', body);
      } else {
        await s.api.post('/v1/events', body);
      }
      if (!mounted) return;
      s.touch();
      toast(context, widget.editId != null ? tr(context, 'Saved') : tr(context, 'Added to your agenda'));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<DateTime?> _pickDate(DateTime? init) => showDatePicker(
        context: context,
        initialDate: init ?? _date ?? DateTime.now(),
        firstDate: DateTime.now().subtract(const Duration(days: 3650)),
        lastDate: DateTime.now().add(const Duration(days: 3650)),
      );

  @override
  Widget build(BuildContext context) {
    final name = _steps[_step];
    final titles = {
      'Type': tr(context, 'What are you adding?'),
      'Details': tr(context, 'The details'),
      'Functions': tr(context, 'Every function'),
      'Reminders': tr(context, 'When to remind you'),
      'Review': tr(context, 'Check and save'),
    };
    return PopScope(
      canPop: _step == 0 || (widget.initialType != null && _step == 1) || (widget.prefill != null && _step == 1),
      onPopInvokedWithResult: (did, _) {
        if (!did) setState(() => _step--);
      },
      child: IkPage(
        header: IkHeader(
          kicker: tr(context, 'Step {a} of {b}', {'a': _step + 1, 'b': _steps.length}),
          title: titles[name]!,
          art: _wedding ? Art.jaimala : Art.cal3d,
        ),
        bottom: BottomBar(
          child: IkButton(
            _step == _steps.length - 1 ? (widget.editId != null ? tr(context, 'Save changes') : tr(context, 'Save to my agenda')) : tr(context, 'Continue'),
            icon: _step == _steps.length - 1 ? Icons.check_rounded : Icons.arrow_forward_rounded,
            loading: _saving,
            onPressed: _next,
          ),
        ),
        children: [
          _StepDots(steps: _steps.map((e) => tr(context, e)).toList(), at: _step),
          const SizedBox(height: 16),
          ...switch (name) {
            'Type' => _typeStep(),
            'Details' => _detailStep(),
            'Functions' => _fnStep(),
            'Reminders' => _remStep(),
            _ => _reviewStep(),
          },
        ],
      ),
    );
  }

  List<Widget> _typeStep() => [
        SectionTitle(tr(context, 'Choose one'), top: 0),
        for (final k in eventKinds)
          GestureDetector(
            onTap: () => setState(() => _type = k.$1),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _type == k.$1 ? IK.g0 : Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: _type == k.$1 ? IK.gold : IK.goldLine, width: _type == k.$1 ? 2 : 1),
              ),
              child: Row(children: [
                ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.asset(kindPhoto(k.$1), width: 56, height: 56, fit: BoxFit.cover)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr(context, k.$1), style: IK.h2(size: 18)),
                    Text(tr(context, k.$2), style: IK.soft(size: 11.5)),
                    if (k.$1 == 'Wedding') ...[const SizedBox(height: 4), Pill(tr(context, 'Opens a function list'), tone: Tone.gold, size: 9)],
                  ]),
                ),
                Icon(_type == k.$1 ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, color: _type == k.$1 ? IK.goldInk : IK.line2),
              ]),
            ),
          ),
      ];

  List<Widget> _detailStep() => [
        Field(
          label: _wedding ? tr(context, 'Whose wedding') : tr(context, 'Name'),
          required: true,
          controller: _title,
          hint: _wedding ? 'Vikram & Aditi Wedding' : tr(context, 'e.g. Dentist appointment'),
          error: _errs['title'],
          capitalization: TextCapitalization.sentences,
          maxLength: 80,
        ),
        Row(children: [
          Expanded(
            child: Field(
              label: _wedding ? tr(context, 'First day') : tr(context, 'Date'),
              required: true,
              readOnly: true,
              icon: Icons.calendar_month_outlined,
              controller: TextEditingController(text: _date == null ? '' : dayMonthYear(_date!)),
              error: _errs['date'],
              onTap: () async {
                final d = await _pickDate(_date);
                if (d != null) setState(() => _date = d);
              },
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Field(
              label: tr(context, 'Time'),
              readOnly: true,
              icon: Icons.schedule_rounded,
              controller: TextEditingController(text: _allDay ? tr(context, 'All day') : (_time == null ? '' : _time!.format(context))),
              error: _errs['time'],
              onTap: () async {
                final t = await showTimePicker(context: context, initialTime: _time ?? const TimeOfDay(hour: 18, minute: 0));
                if (t != null) setState(() {
                  _time = t;
                  _allDay = false;
                });
              },
            ),
          ),
        ]),
        Row(children: [
          Checkbox(value: _allDay, activeColor: IK.v6, onChanged: (v) => setState(() => _allDay = v ?? false)),
          Text(tr(context, 'All day'), style: IK.strong(size: 13)),
        ]),
        const SizedBox(height: 6),
        Field(label: tr(context, 'Venue'), controller: _venue, icon: Icons.location_on_outlined, hint: tr(context, 'Optional'), maxLength: 120),
        Field(label: tr(context, 'City'), controller: _city, icon: Icons.location_city_outlined, hint: tr(context, 'Optional'), maxLength: 40, capitalization: TextCapitalization.words),
        Field(label: tr(context, 'Notes'), controller: _notes, lines: 3, hint: tr(context, 'Dress code, what to bring, who to call'), maxLength: 500),
      ];

  List<Widget> _fnStep() => [
        Text(tr(context, 'Add each function on the card — Haldi, Sangeet, Wedding, Reception — so each one gets its own reminders.'), style: IK.soft(size: 12.5)),
        const SizedBox(height: 12),
        for (var i = 0; i < _fns.length; i++)
          IkCard(
            margin: const EdgeInsets.only(bottom: 10),
            border: _errs['fn$i'] != null ? IK.badLine : null,
            child: Column(children: [
              Row(children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: IK.v6, borderRadius: BorderRadius.circular(9)),
                  child: Text('${i + 1}', style: IK.monoS(size: 12, color: Colors.white)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    initialValue: _fns[i].name,
                    onChanged: (v) => _fns[i].name = v,
                    textCapitalization: TextCapitalization.words,
                    style: IK.strong(size: 15),
                    decoration: InputDecoration(hintText: tr(context, 'Function name'), isDense: true),
                  ),
                ),
                IconButton(icon: const Icon(Icons.delete_outline_rounded, color: IK.bad), onPressed: () => setState(() => _fns.removeAt(i))),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.calendar_month_outlined, size: 16),
                    label: Text(_fns[i].date == null ? tr(context, 'Date') : dayMonth(_fns[i].date!)),
                    onPressed: () async {
                      final d = await _pickDate(_fns[i].date);
                      if (d != null) setState(() => _fns[i].date = d);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.schedule_rounded, size: 16),
                    label: Text(_fns[i].time == null ? tr(context, 'Time') : _fns[i].time!.format(context)),
                    onPressed: () async {
                      final t = await showTimePicker(context: context, initialTime: _fns[i].time ?? const TimeOfDay(hour: 19, minute: 0));
                      if (t != null) setState(() => _fns[i].time = t);
                    },
                  ),
                ),
              ]),
              const SizedBox(height: 8),
              TextFormField(
                initialValue: _fns[i].venue,
                onChanged: (v) => _fns[i].venue = v,
                decoration: InputDecoration(hintText: tr(context, 'Venue (optional)'), isDense: true, prefixIcon: const Icon(Icons.location_on_outlined, size: 18)),
              ),
              if (_errs['fn$i'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_errs['fn$i']!, style: IK.body(size: 11.5, color: IK.bad))),
            ]),
          ),
        IkButton(tr(context, 'Add a function'), kind: BtnKind.ghost, icon: Icons.add_rounded, compact: true,
            onPressed: () => setState(() => _fns.add(_Fn(date: _fns.isEmpty ? _date : _fns.last.date)))),
      ];

  List<Widget> _remStep() {
    const opts = [10080, 1440, 180, 120, 60, 30, 15];
    return [
      Text(tr(context, 'We remind you before {what}. Pick as many as you like.', {'what': _wedding ? tr(context, 'each function') : tr(context, 'it starts')}), style: IK.soft(size: 12.5)),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final o in opts)
          FilterChip(
            label: Text(tr(context, offsetLabel(o))),
            selected: _rem.contains(o),
            selectedColor: IK.v7,
            checkmarkColor: Colors.white,
            labelStyle: IK.strong(size: 12.5, color: _rem.contains(o) ? Colors.white : IK.ink2),
            onSelected: (v) => setState(() {
              if (v) {
                if (_rem.length < 4) _rem.add(o);
              } else {
                _rem.remove(o);
              }
            }),
          ),
      ]),
      const SizedBox(height: 12),
      Note(tr(context, 'Up to four reminders. They arrive as app notifications on this phone.')),
    ];
  }

  List<Widget> _reviewStep() => [
        IkCard(
          child: Row(children: [
            ClipRRect(borderRadius: BorderRadius.circular(14), child: Image.asset(kindPhoto(_type), width: 64, height: 64, fit: BoxFit.cover)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_title.text, style: IK.h2(size: 20)),
                Text('${tr(context, _type)} · ${_date == null ? '' : dayMonthYear(_date!)}${_allDay || _time == null ? '' : ' · ${_time!.format(context)}'}', style: IK.soft(size: 12)),
                if (_venue.text.isNotEmpty) Text(_venue.text, style: IK.soft(size: 12)),
              ]),
            ),
          ]),
        ),
        if (_wedding && _fns.isNotEmpty) ...[
          SectionTitle(tr(context, 'Functions'), count: _fns.length),
          IkGroup(children: [
            for (final f in _fns)
              IkRow(
                image: Art.forFunction(f.name),
                title: f.name,
                sub: '${f.date == null ? '' : dayMonth(f.date!)}${f.time == null ? '' : ' · ${f.time!.format(context)}'}${f.venue.isEmpty ? '' : ' · ${f.venue}'}',
              ),
          ]),
        ],
        SectionTitle(tr(context, 'Reminders'), count: _rem.length),
        Wrap(spacing: 6, runSpacing: 6, children: [for (final r in _rem.toList()..sort((a, b) => b - a)) Pill(tr(context, offsetLabel(r)), tone: Tone.violet, icon: Icons.alarm_rounded)]),
        const SizedBox(height: 14),
        if (_source == 'ai') Note(tr(context, 'Read by Invite Karoo AI. Check the dates and times once before you save.'), icon: Icons.auto_awesome_rounded, tone: Tone.gold),
      ];
}

class _StepDots extends StatelessWidget {
  const _StepDots({required this.steps, required this.at});
  final List<String> steps;
  final int at;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      for (var i = 0; i < steps.length; i++) ...[
        Column(children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i < at ? IK.ok : (i == at ? IK.v7 : Colors.white),
              border: Border.all(color: i <= at ? Colors.transparent : IK.line2, width: 1.5),
            ),
            child: i < at
                ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
                : Text('${i + 1}', style: IK.monoS(size: 12, color: i == at ? Colors.white : IK.ink3)),
          ),
          const SizedBox(height: 4),
          Text(steps[i], style: IK.soft(size: 10).copyWith(fontWeight: i == at ? FontWeight.w800 : FontWeight.w500)),
        ]),
        if (i < steps.length - 1) Expanded(child: Container(height: 1.5, margin: const EdgeInsets.only(bottom: 16), color: i < at ? IK.ok : IK.line2)),
      ],
    ]);
  }
}
