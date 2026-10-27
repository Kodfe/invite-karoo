import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';

/// One function the guest is invited to, and the only place that sends a reply.
/// Choosing never saves: the reply reaches the hosts only on "Send my reply".
class FunctionScreen extends StatefulWidget {
  const FunctionScreen({super.key, required this.weddingId, required this.functionId, this.focusReply = false});
  final String weddingId;
  final String functionId;
  final bool focusReply;

  @override
  State<FunctionScreen> createState() => _FunctionScreenState();
}

class _FunctionScreenState extends State<FunctionScreen> {
  Json? _f;
  Object? _error;
  String? _draft; // going | not_going
  int _pax = 1;
  bool _editing = false;
  bool _sending = false;
  bool _justSent = false;
  final _replyKey = GlobalKey();

  String get _base => '/v1/weddings/${widget.weddingId}/functions/${widget.functionId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final f = asJson(await Session.read(context).api.get(_base));
      if (!mounted) return;
      setState(() {
        _f = f;
        _error = null;
      });
      if (widget.focusReply) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final c = _replyKey.currentContext;
          if (c != null) Scrollable.ensureVisible(c, duration: const Duration(milliseconds: 400), alignment: .2);
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    if (_draft == null) return;
    setState(() => _sending = true);
    final s = Session.read(context);
    try {
      final f = asJson(await s.api.post('$_base/rsvp', {'rsvp': _draft, 'pax': _draft == 'going' ? _pax : 0}));
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      setState(() {
        _f = f;
        _editing = false;
        _draft = null;
        _justSent = true;
      });
      s.touch();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _saveReminders(List<int> off, List<int> mine) async {
    final f = await guard(context, () async => asJson(await Session.read(context).api.put('$_base/reminders', {'offDefaults': off, 'mine': mine})));
    if (f != null && mounted) setState(() => _f = f);
  }

  @override
  Widget build(BuildContext context) {
    if (_f == null) return _error == null ? const LoadingView() : ErrorView(error: _error, onRetry: _load);
    final f = _f!;
    final color = hexColor('${f['color']}');
    final gift = f['gift'] == null ? null : asJson(f['gift']);
    return IkPage(
      onRefresh: _load,
      header: IkHeader(title: '${f['name']}', sub: '${f['couple'] ?? ''}', art: Art.forFunction('${f['name']}', '${f['icon'] ?? ''}')),
      children: [
        IkCard(
          leftAccent: color,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr(context, 'Your function'), style: IK.kicker(size: 20)),
            Text('${f['name']}', style: IK.title(size: 28)),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Pill('${f['dayLabel']}', tone: Tone.violet, icon: Icons.calendar_month_outlined, size: 11),
              Pill('${f['timeLabel']}${f['endLabel'] != null ? ' – ${f['endLabel']}' : ''}', tone: Tone.violet, icon: Icons.schedule_rounded, size: 11),
              if (f['live'] == true) Pill(tr(context, 'Live now'), tone: Tone.live, size: 11),
              if (f['past'] == true) Pill(tr(context, 'Finished'), tone: Tone.plain, size: 11),
            ]),
          ]),
        ),
        if (f['clash'] != null) ...[
          const SizedBox(height: 12),
          Note('${tr(context, 'Two at once.')} ${f['clash']}. ${tr(context, 'You will have to choose — Invite Karoo will not pick for you.')}',
              tone: Tone.gold, icon: Icons.warning_amber_rounded),
        ],
        const SizedBox(height: 12),
        KeyedSubtree(key: _replyKey, child: _replyCard(f)),
        SectionTitle(tr(context, 'Where')),
        IkCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Image.asset(Art.mapsPin, width: 36),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${f['venueName']}', style: IK.strong(size: 15)),
                  if ((f['venueAddress'] ?? '').toString().isNotEmpty) Text('${f['venueAddress']}', style: IK.soft(size: 12.5)),
                ]),
              ),
            ]),
            if (f['mapsUrl'] != null) ...[
              const SizedBox(height: 12),
              IkButton(tr(context, 'Open in Google Maps'), kind: BtnKind.ghost, icon: Icons.map_outlined, compact: true,
                  onPressed: () => launchUrl(Uri.parse('${f['mapsUrl']}'), mode: LaunchMode.externalApplication)),
            ],
          ]),
        ),
        if ((f['dressCode'] ?? '').toString().isNotEmpty || (f['notes'] ?? '').toString().isNotEmpty) ...[
          SectionTitle(tr(context, 'Good to know')),
          IkGroup(children: [
            if ((f['dressCode'] ?? '').toString().isNotEmpty)
              IkRow(icon: Icons.checkroom_rounded, iconColor: IK.mag, iconBg: IK.magBg, title: tr(context, 'Dress code'), sub: '${f['dressCode']}'),
            if ((f['notes'] ?? '').toString().isNotEmpty)
              IkRow(icon: Icons.sticky_note_2_outlined, iconColor: IK.g6, iconBg: IK.g1, title: tr(context, 'From the hosts'), sub: '${f['notes']}'),
          ]),
        ],
        if (gift != null || f['past'] != true) ...[
          SectionTitle(tr(context, 'Your invitation code')),
          _QrCard(weddingId: widget.weddingId, gift: gift),
        ],
        if (f['past'] != true) ...[
          SectionTitle(tr(context, 'Reminders')),
          _Reminders(r: asJson(f['reminders']), onSave: _saveReminders),
        ],
      ],
    );
  }

  Widget _replyCard(Json f) {
    final win = asJson(f['window']);
    final state = '${win['state']}';
    final rsvp = '${f['rsvp']}';
    final closes = parseTs(win['closesAt']);
    final answered = rsvp != 'none';
    final canReply = (state == 'open' || state == 'soon') && f['past'] != true;
    final children = <Widget>[
      Row(children: [
        const Icon(Icons.drafts_outlined, size: 18, color: IK.v6),
        const SizedBox(width: 8),
        Expanded(child: Text(tr(context, 'Your reply'), style: IK.h2(size: 19))),
        if (state == 'closed') Pill(tr(context, 'closed'), tone: Tone.bad),
        if (state == 'soon') Pill(tr(context, 'closing soon'), tone: Tone.gold),
      ]),
      const SizedBox(height: 10),
    ];

    if (answered && !_editing) {
      final going = rsvp == 'going';
      children.add(Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: going ? IK.okBg : (rsvp == 'maybe' ? IK.g1 : IK.badBg),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: going ? IK.okLine : (rsvp == 'maybe' ? IK.g2 : IK.badLine)),
        ),
        child: Row(children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: going ? IK.ok : (rsvp == 'maybe' ? IK.g5 : IK.bad),
            child: Icon(going ? Icons.check_rounded : (rsvp == 'maybe' ? Icons.help_outline_rounded : Icons.close_rounded), color: Colors.white),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                going
                    ? tr(context, 'You are going · {n} {p}', {'n': f['pax'], 'p': toInt(f['pax']) == 1 ? tr(context, 'person') : tr(context, 'people')})
                    : (rsvp == 'maybe' ? tr(context, 'You said maybe') : tr(context, 'You are not going')),
                style: IK.strong(size: 14),
              ),
              Text(
                f['byHost'] == true
                    ? tr(context, 'Recorded by the hosts')
                    : '${_justSent ? tr(context, 'Sent to the hosts just now') : tr(context, 'Sent to the hosts')}${parseTs(f['respondedAt']) != null && !_justSent ? ' · ${dayMonth(parseTs(f['respondedAt'])!)}' : ''}',
                style: IK.soft(size: 11.5),
              ),
            ]),
          ),
        ]),
      ));
      if (canReply) {
        children.add(const SizedBox(height: 10));
        children.add(IkButton(tr(context, 'Change my reply'), kind: BtnKind.ghost, compact: true, icon: Icons.edit_outlined, onPressed: () {
          setState(() {
            _editing = true;
            _draft = rsvp == 'maybe' ? null : rsvp;
            _pax = toInt(f['pax']) > 0 ? toInt(f['pax']) : 1;
          });
        }));
      }
    } else if (canReply) {
      Widget choice(String v, String label, IconData icon, Color c) {
        final on = _draft == v;
        return Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _draft = v),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: on ? c.withValues(alpha: .1) : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: on ? c : IK.line, width: on ? 2 : 1.2),
              ),
              child: Column(children: [
                Icon(icon, color: on ? c : IK.ink4),
                const SizedBox(height: 4),
                Text(label, style: IK.strong(size: 13.5, color: on ? c : IK.ink2)),
              ]),
            ),
          ),
        );
      }

      children.addAll([
        Row(children: [
          choice('going', tr(context, 'Coming'), Icons.check_circle_outline_rounded, IK.ok),
          const SizedBox(width: 10),
          choice('not_going', tr(context, 'Not coming'), Icons.cancel_outlined, IK.bad),
        ]),
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          child: _draft == 'going'
              ? Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(children: [
                    Expanded(child: Text(tr(context, 'How many people, including you?'), style: IK.strong(size: 13))),
                    _Stepper(value: _pax, min: 1, max: 20, onChanged: (v) => setState(() => _pax = v)),
                  ]),
                )
              : const SizedBox(width: double.infinity),
        ),
        const SizedBox(height: 14),
        IkButton(tr(context, 'Send my reply'), icon: Icons.send_rounded, loading: _sending, onPressed: _draft == null ? null : _send),
        if (_editing) ...[
          const SizedBox(height: 6),
          Center(child: LinkText(tr(context, 'Keep my earlier reply'), onTap: () => setState(() => _editing = false))),
        ],
      ]);
    } else if (state == 'never') {
      children.add(Note(tr(context, 'This function was added close to the day, so there is no reply in the app. The hosts will call you.'), icon: Icons.call_outlined));
    } else {
      children.add(Note(tr(context, 'Replies closed a day before this starts. Call the hosts if anything changes.'), icon: Icons.lock_clock_outlined, tone: Tone.plain));
    }

    if (canReply && closes != null) {
      children.add(Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [
          const Icon(Icons.schedule_rounded, size: 14, color: IK.ink4),
          const SizedBox(width: 6),
          Expanded(child: Text(tr(context, 'You can reply until {d}', {'d': '${weekdayDay(closes)}, ${clock(closes)}'}), style: IK.soft(size: 11.5))),
        ]),
      ));
    }
    return IkCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.value, required this.min, required this.max, required this.onChanged});
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget b(IconData i, bool on, int to) => Material(
          color: on ? IK.v1 : IK.paper2,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: on ? () => onChanged(to) : null,
            child: SizedBox(width: 38, height: 38, child: Icon(i, size: 18, color: on ? IK.v7 : IK.ink4)),
          ),
        );
    return Row(children: [
      b(Icons.remove_rounded, value > min, value - 1),
      SizedBox(width: 40, child: Text('$value', textAlign: TextAlign.center, style: IK.title(size: 24))),
      b(Icons.add_rounded, value < max, value + 1),
    ]);
  }
}

class _QrCard extends StatefulWidget {
  const _QrCard({required this.weddingId, required this.gift});
  final String weddingId;
  final Json? gift;
  @override
  State<_QrCard> createState() => _QrCardState();
}

class _QrCardState extends State<_QrCard> {
  late final Future<dynamic> _qr = Session.read(context).api.get('/v1/weddings/${widget.weddingId}/qr');

  @override
  Widget build(BuildContext context) {
    final gift = widget.gift;
    return FutureBuilder<dynamic>(
      future: _qr,
      builder: (context, snap) {
        final code = snap.hasData ? '${asJson(snap.data)['code']}' : null;
        return IkCard(
          child: Row(children: [
            Container(
              width: 104,
              height: 104,
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: IK.line)),
              child: code == null
                  ? const Center(child: CircularProgressIndicator(strokeWidth: 2, color: IK.v5))
                  : QrImageView(data: code, padding: EdgeInsets.zero, eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: IK.v9),
                      dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: IK.v9)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr(context, 'Show this at the venue'), style: IK.strong(size: 14)),
                const SizedBox(height: 4),
                Text(tr(context, 'The family scans it at the gift desk, so nobody has to look you up by name.'), style: IK.soft(size: 12)),
                if (gift != null) ...[
                  const SizedBox(height: 8),
                  Pill(gift['given'] == true ? tr(context, 'Gift received') : tr(context, 'A gift is waiting for you'), tone: Tone.gold, icon: Icons.card_giftcard_rounded),
                ],
              ]),
            ),
          ]),
        );
      },
    );
  }
}

/// the app's two default reminders (switchable) and the guest's own, private
class _Reminders extends StatelessWidget {
  const _Reminders({required this.r, required this.onSave});
  final Json r;
  final Future<void> Function(List<int> offDefaults, List<int> mine) onSave;

  @override
  Widget build(BuildContext context) {
    final defaults = asList(r['defaults']);
    final mine = asList(r['mine']);
    final off = defaults.where((d) => d['on'] != true).map((d) => toInt(d['offset'])).toList();
    final mineOff = mine.map((m) => toInt(m['offset'])).toList();
    return IkGroup(children: [
      for (final d in defaults)
        if (d['possible'] == true)
          IkRow(
            icon: Icons.notifications_active_outlined,
            title: tr(context, offsetLabel(toInt(d['offset']))),
            sub: tr(context, 'From Invite Karoo'),
            trailing: Switch.adaptive(
              value: d['on'] == true,
              activeTrackColor: IK.ok,
              onChanged: (v) {
                final o = toInt(d['offset']);
                final next = [...off]..remove(o);
                if (!v) next.add(o);
                onSave(next, mineOff);
              },
            ),
          ),
      for (final m in mine)
        IkRow(
          icon: Icons.alarm_rounded,
          iconColor: IK.g6,
          iconBg: IK.g1,
          title: tr(context, offsetLabel(toInt(m['offset']))),
          sub: tr(context, 'Yours · the hosts do not see this'),
          trailing: IconButton(
            icon: const Icon(Icons.delete_outline_rounded, color: IK.bad),
            onPressed: () => onSave(off, [...mineOff]..remove(toInt(m['offset']))),
          ),
        ),
      if (mine.length < 4)
        IkRow(
          icon: Icons.add_alarm_rounded,
          title: tr(context, 'Add my own reminder'),
          onTap: () async {
            const choices = [10080, 2880, 1440, 720, 360, 180, 120, 60, 30, 15];
            final pick = await showModalBottomSheet<int>(
              context: context,
              showDragHandle: true,
              builder: (ctx) => SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final c in choices)
                      if (!mineOff.contains(c))
                        ActionChip(label: Text(trIn(Session.read(context).lang, offsetLabel(c))), onPressed: () => Navigator.pop(ctx, c)),
                  ]),
                ),
              ),
            );
            if (pick != null) onSave(off, [...mineOff, pick]);
          },
        ),
    ]);
  }
}
