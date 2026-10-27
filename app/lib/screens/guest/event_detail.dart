import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';
import 'manual.dart';

/// One of the guest's own events. It is theirs alone — no reply, no host, no function screen.
class EventDetailScreen extends StatelessWidget {
  const EventDetailScreen({super.key, required this.event});
  final Json event;

  Future<void> _delete(BuildContext context) async {
    final ok = await confirmSheet(context,
        title: tr(context, 'Delete this event?'), body: '${event['title']}', confirm: tr(context, 'Delete'), danger: true, art: Art.cal3d);
    if (!ok || !context.mounted) return;
    final s = Session.read(context);
    final r = await guard(context, () => s.api.delete('/v1/events/${event['id']}'));
    if (r == null) return;
    s.touch();
    if (context.mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final e = event;
    final date = parseDay(e['date']);
    final fns = asList(e['functions']);
    final type = '${e['type']}';
    return IkPage(
      header: IkHeader(kicker: tr(context, 'Your own plans'), title: '${e['title']}', sub: tr(context, type), art: e['isWedding'] == true ? Art.jaimala : Art.cal3d),
      bottom: BottomBar(
        child: Row(children: [
          Expanded(
            child: IkButton(tr(context, 'Edit'), icon: Icons.edit_outlined, onPressed: () async {
              final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ManualEventScreen(prefill: e, editId: '${e['id']}')));
              if (done == true && context.mounted) Navigator.of(context).pop(true);
            }),
          ),
          const SizedBox(width: 10),
          SizedBox(width: 120, child: IkButton(tr(context, 'Delete'), kind: BtnKind.danger, icon: Icons.delete_outline_rounded, onPressed: () => _delete(context))),
        ]),
      ),
      children: [
        ClipRRect(borderRadius: BorderRadius.circular(20), child: Pic(e['imageUrl'] as String?, fallback: Art.forEventType(type), height: 170)),
        const SizedBox(height: 14),
        IkGroup(children: [
          IkRow(
            icon: Icons.calendar_month_outlined,
            title: date == null ? '' : weekdayDay(date),
            sub: e['time'] == null ? tr(context, 'All day') : '${e['time']}',
          ),
          if ('${e['venue'] ?? ''}'.isNotEmpty || '${e['city'] ?? ''}'.isNotEmpty)
            IkRow(icon: Icons.location_on_outlined, title: '${e['venue'] ?? ''}', sub: '${e['city'] ?? ''}'),
          if ('${e['notes'] ?? ''}'.isNotEmpty) IkRow(icon: Icons.sticky_note_2_outlined, iconColor: IK.g6, iconBg: IK.g1, title: tr(context, 'Notes'), sub: '${e['notes']}'),
          IkRow(
            icon: e['source'] == 'ai' ? Icons.auto_awesome_rounded : Icons.edit_note_rounded,
            iconColor: IK.mag,
            iconBg: IK.magBg,
            title: e['source'] == 'ai' ? tr(context, 'Scanned from a card') : tr(context, 'Typed in by you'),
            sub: tr(context, 'Only you can see this'),
          ),
        ]),
        if (fns.isNotEmpty) ...[
          SectionTitle(tr(context, 'Functions'), count: fns.length),
          IkGroup(children: [
            for (final f in fns)
              IkRow(
                image: Art.forFunction('${f['name']}'),
                title: '${f['name']}',
                sub: [
                  if (parseDay(f['date']) != null) weekdayDay(parseDay(f['date'])!),
                  if ('${f['time'] ?? ''}'.isNotEmpty) '${f['time']}',
                  if ('${f['venue'] ?? ''}'.isNotEmpty) '${f['venue']}',
                ].join(' · '),
              ),
          ]),
        ],
        SectionTitle(tr(context, 'Reminders')),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final r in (e['reminders'] as List? ?? const []))
            Pill(tr(context, offsetLabel(toInt(r))), tone: Tone.violet, icon: Icons.alarm_rounded),
        ]),
      ],
    );
  }
}
