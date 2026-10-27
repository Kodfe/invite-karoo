import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_guests.dart';
import 'host_home.dart';
import 'host_remind.dart';

/// Who is coming, function by function.
class HostRsvpScreen extends StatelessWidget {
  const HostRsvpScreen({super.key, required this.weddingId});
  final String weddingId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      version: s.dataVersion,
      load: () async => asJson(await s.api.get(hostBase(weddingId))),
      builder: (context, d, reload) {
        final t = asJson(d['totals']);
        final fns = asList(d['functions']);
        final guests = toInt(t['guests']);
        final replied = guests == 0 ? 0 : (((toInt(t['going']) + toInt(t['not_going'])) / guests) * 100).round();
        return IkPage(
          onRefresh: reload,
          header: IkHeader(back: false, title: tr(context, 'RSVP'), sub: tr(context, 'Who is coming, function by function'), art: Art.mailIc),
          children: [
            IkCard(
              child: Column(children: [
                Row(children: [
                  _big('${t['going']}', tr(context, 'Coming to something'), IK.ok),
                  _big('${t['not_going']}', tr(context, 'Not coming at all'), IK.bad),
                  _big('${t['pending']}', tr(context, 'No reply yet'), IK.v4),
                ]),
                const SizedBox(height: 12),
                const DashedDivider(indent: 0),
                const SizedBox(height: 12),
                Row(children: [
                  const Icon(Icons.mark_email_read_outlined, color: IK.ok, size: 18),
                  const SizedBox(width: 8),
                  Expanded(child: Text(tr(context, 'Replied so far'), style: IK.strong(size: 13.5))),
                  Text('$replied%', style: IK.title(size: 26, color: IK.ok)),
                ]),
              ]),
            ),
            SectionTitle(tr(context, 'By function')),
            for (final f in fns) _FnRsvpCard(f: f, weddingId: weddingId, onBack: reload),
          ],
        );
      },
    );
  }

  Widget _big(String n, String l, Color c) => Expanded(
        child: Column(children: [
          Text(n, style: IK.title(size: 30, color: c)),
          Text(l, textAlign: TextAlign.center, style: IK.soft(size: 10.5).copyWith(fontWeight: FontWeight.w700)),
        ]),
      );
}

class _FnRsvpCard extends StatelessWidget {
  const _FnRsvpCard({required this.f, required this.weddingId, required this.onBack});
  final Json f;
  final String weddingId;
  final Future<void> Function() onBack;

  @override
  Widget build(BuildContext context) {
    final c = asJson(f['counts']);
    final color = hexColor('${f['color']}');
    Widget stat(Color col, String text) => Row(mainAxisSize: MainAxisSize.min, children: [Dot(col), const SizedBox(width: 4), Text(text, style: IK.soft(size: 11))]);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      leftAccent: color,
      onTap: () async {
        await push(context, RsvpBoardScreen(weddingId: weddingId, functionId: '${f['id']}', name: '${f['name']}'));
        await onBack();
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${f['dayLabel']}', style: IK.label(size: 9.5, color: color)),
        Text('${f['name']}', style: IK.h2(size: 20)),
        const SizedBox(height: 8),
        ReplyBar(going: toInt(c['going']), maybe: toInt(c['maybe']), notGoing: toInt(c['not_going']), none: toInt(c['none'])),
        const SizedBox(height: 8),
        Wrap(spacing: 12, runSpacing: 4, children: [
          stat(IK.ok, '${c['going']} ${tr(context, 'coming')}'),
          stat(IK.g4, '${c['maybe']} ${tr(context, 'maybe')}'),
          stat(const Color(0xFFE05252), '${c['not_going']} ${tr(context, 'not coming')}'),
          stat(IK.v2, '${c['none']} ${tr(context, 'no reply')}'),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          const Icon(Icons.groups_outlined, size: 14, color: IK.v6),
          const SizedBox(width: 5),
          Text('${c['pax']} ${tr(context, 'people expected')}', style: IK.strong(size: 12, color: IK.v6)),
        ]),
      ]),
    );
  }
}

/// One function's replies in four tabs. Guests without the app come first: they are the ones to call.
class RsvpBoardScreen extends StatefulWidget {
  const RsvpBoardScreen({super.key, required this.weddingId, required this.functionId, required this.name});
  final String weddingId;
  final String functionId;
  final String name;
  @override
  State<RsvpBoardScreen> createState() => _RsvpBoardScreenState();
}

class _RsvpBoardScreenState extends State<RsvpBoardScreen> {
  String _tab = 'pending';

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      version: '$_tab-${s.dataVersion}',
      load: () async => asJson(await s.api.get('${hostBase(widget.weddingId)}/functions/${widget.functionId}/rsvp', query: {'tab': _tab})),
      builder: (context, d, reload) {
        final c = asJson(d['counts']);
        final rows = asList(d['rows']);
        return IkPage(
          onRefresh: reload,
          header: IkHeader(title: widget.name, sub: tr(context, 'Replies'), art: Art.mailIc),
          floating: _tab == 'pending' && rows.isNotEmpty
              ? FloatingActionButton.extended(
                  backgroundColor: IK.v7,
                  foregroundColor: Colors.white,
                  icon: const Icon(Icons.notifications_active_outlined),
                  label: Text(tr(context, 'Remind all {n}', {'n': rows.length})),
                  onPressed: () => push(context, HostRemindScreen(weddingId: widget.weddingId, functionId: widget.functionId, presetAudience: 'pending')),
                )
              : null,
          children: [
            ChipTabs(
              items: [
                ('pending', '${tr(context, 'No reply')} · ${c['none']}'),
                ('going', '${tr(context, 'Coming')} · ${c['going']}'),
                ('maybe', '${tr(context, 'Maybe')} · ${c['maybe']}'),
                ('not_going', '${tr(context, 'Not coming')} · ${c['not_going']}'),
              ],
              value: _tab,
              onChanged: (v) => setState(() => _tab = v),
            ),
            const SizedBox(height: 12),
            if (rows.isEmpty)
              EmptyState(art: Art.hourglass2, title: tr(context, 'Nobody here'), body: _tab == 'pending' ? tr(context, 'Everyone on this function has replied.') : '')
            else
              for (final r in rows) ReplyRow(r: r, weddingId: widget.weddingId, onChanged: reload),
            const SizedBox(height: 70),
          ],
        );
      },
    );
  }
}

class ReplyRow extends StatelessWidget {
  const ReplyRow({super.key, required this.r, required this.weddingId, required this.onChanged});
  final Json r;
  final String weddingId;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final g = asJson(r['guest']);
    final s = Session.read(context);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      onTap: () async {
        await push(context, HostGuestScreen(weddingId: weddingId, guestId: '${g['id']}'));
        await onChanged();
      },
      child: Column(children: [
        Row(children: [
          Avatar(name: '${g['name']}', size: 42),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${g['name']}', style: IK.strong(size: 14)),
              Text('${g['relation']} · ${g['phonePretty']}', style: IK.soft(size: 11.5)),
            ]),
          ),
          if (g['appJoined'] == true) Pill(tr(context, 'Has the app'), tone: Tone.ok, size: 9) else Pill(tr(context, 'No app'), tone: Tone.plain, size: 9),
        ]),
        if (r['rsvp'] != 'none' || toInt(r['callAttempts']) > 0) ...[
          const SizedBox(height: 8),
          Row(children: [
            if (r['rsvp'] == 'going') Pill('${r['pax']} ${tr(context, 'people')}', tone: Tone.ok, icon: Icons.groups_outlined),
            if (r['byHost'] == true) ...[const SizedBox(width: 6), Pill(tr(context, 'Marked by family'), tone: Tone.violet)],
            if (toInt(r['callAttempts']) > 0) ...[const SizedBox(width: 6), Pill(tr(context, 'Called {n}×', {'n': r['callAttempts']}), tone: Tone.gold, icon: Icons.call_outlined)],
            const Spacer(),
            if (r['respondedAt'] != null) Text(ago(r['respondedAt']), style: IK.monoS(size: 10)),
          ]),
        ],
        if ('${r['remark'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Align(alignment: Alignment.centerLeft, child: Text('“${r['remark']}”', style: IK.soft(size: 11.5)))),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: IkButton(tr(context, 'Call'), compact: true, kind: BtnKind.ghost, icon: Icons.call_outlined, onPressed: () async {
              // tapping dial counts as an attempt even before we know how it went
              s.api.post('${hostBase(weddingId)}/invites/${r['inviteId']}/call', {}).catchError((_) => null);
              await launchUrl(Uri.parse('tel:${g['phone']}'));
            }),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: IkButton(tr(context, 'Mark reply'), compact: true, kind: BtnKind.dark, icon: Icons.edit_note_rounded, onPressed: () async {
              final ok = await markReplySheet(context, weddingId: weddingId, inviteId: '${r['inviteId']}', name: '${g['name']}', current: '${r['rsvp']}', pax: toInt(r['pax']), remark: '${r['remark'] ?? ''}');
              if (ok) await onChanged();
            }),
          ),
        ]),
      ]),
    );
  }
}

/// Recording a reply for someone is always the family's doing, on either side of the 24-hour window.
Future<bool> markReplySheet(BuildContext context,
    {required String weddingId, required String inviteId, required String name, String current = 'none', int pax = 1, String remark = ''}) async {
  final s = Session.read(context);
  var choice = current == 'none' ? 'going' : current;
  var people = pax < 1 ? 1 : pax;
  final note = TextEditingController(text: remark);
  var busy = false;
  final r = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.viewInsetsOf(ctx).bottom),
        child: SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(trIn(s.lang, 'Mark the reply for {n}', {'n': name}), textAlign: TextAlign.center, style: IK.title(size: 22)),
            const SizedBox(height: 14),
            Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [
              for (final o in const [('going', 'Coming'), ('maybe', 'Maybe'), ('not_going', 'Not coming'), ('none', 'No reply')])
                ChoiceChip(
                  label: Text(trIn(s.lang, o.$2)),
                  selected: choice == o.$1,
                  selectedColor: IK.v7,
                  showCheckmark: false,
                  labelStyle: IK.strong(size: 13, color: choice == o.$1 ? Colors.white : IK.ink2),
                  onSelected: (_) => set(() => choice = o.$1),
                ),
            ]),
            if (choice == 'going') ...[
              const SizedBox(height: 14),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                IconButton.filledTonal(onPressed: people > 1 ? () => set(() => people--) : null, icon: const Icon(Icons.remove_rounded)),
                SizedBox(width: 70, child: Text('$people', textAlign: TextAlign.center, style: IK.title(size: 30))),
                IconButton.filledTonal(onPressed: people < 20 ? () => set(() => people++) : null, icon: const Icon(Icons.add_rounded)),
              ]),
              Center(child: Text(trIn(s.lang, 'people, including them'), style: IK.soft(size: 12))),
            ],
            const SizedBox(height: 14),
            TextField(controller: note, maxLength: 200, decoration: InputDecoration(hintText: trIn(s.lang, 'Note for the family (optional)'), counterText: '')),
            const SizedBox(height: 14),
            IkButton(trIn(s.lang, 'Save reply'), icon: Icons.check_rounded, loading: busy, onPressed: () async {
              set(() => busy = true);
              try {
                await s.api.post('${hostBase(weddingId)}/invites/$inviteId/rsvp', {'rsvp': choice, 'pax': choice == 'going' ? people : 0, 'remark': note.text.trim()});
                s.touch();
                if (ctx.mounted) Navigator.pop(ctx, true);
              } catch (e) {
                set(() => busy = false);
                if (ctx.mounted) showError(ctx, e);
              }
            }),
          ]),
        ),
      ),
    ),
  );
  return r ?? false;
}
