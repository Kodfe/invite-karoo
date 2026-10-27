import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';
import 'add_event.dart';
import 'event_detail.dart';
import 'manual.dart';

/// Everything the guest added themselves, ready to edit.
class EventLogScreen extends StatefulWidget {
  const EventLogScreen({super.key});
  @override
  State<EventLogScreen> createState() => _EventLogScreenState();
}

class _EventLogScreenState extends State<EventLogScreen> {
  String _tab = 'all';
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<List<Json>>(
      version: s.dataVersion,
      load: () async => asList(await s.api.get('/v1/events/log')),
      builder: (context, all, reload) {
        final today = DateTime.now();
        final t0 = DateTime(today.year, today.month, today.day);
        bool upcoming(Json e) => !(parseDay(e['date']) ?? t0).isBefore(t0);
        final list = all.where((e) {
          if (_tab == 'up' && !upcoming(e)) return false;
          if (_tab == 'past' && upcoming(e)) return false;
          if (_tab == 'ai' && e['source'] != 'ai') return false;
          if (_q.isNotEmpty) {
            final hay = '${e['title']} ${e['venue']} ${e['city']} ${e['type']}'.toLowerCase();
            if (!hay.contains(_q.toLowerCase())) return false;
          }
          return true;
        }).toList()
          ..sort((a, b) => '${b['date']}'.compareTo('${a['date']}'));
        return IkPage(
          onRefresh: reload,
          header: IkHeader(
            title: tr(context, 'Event log'),
            sub: tr(context, '{n} events you added yourself', {'n': all.length}),
            art: Art.cplSofa,
            actions: [SquareBtn(icon: Icons.add_rounded, onTap: () => push(context, const AddEventScreen()))],
          ),
          children: [
            ChipTabs(
              items: [
                ('all', '${tr(context, 'All')} · ${all.length}'),
                ('up', '${tr(context, 'Upcoming')} · ${all.where(upcoming).length}'),
                ('past', '${tr(context, 'Past')} · ${all.where((e) => !upcoming(e)).length}'),
                ('ai', '${tr(context, 'From scans')} · ${all.where((e) => e['source'] == 'ai').length}'),
              ],
              value: _tab,
              onChanged: (v) => setState(() => _tab = v),
            ),
            const SizedBox(height: 12),
            TextField(
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(hintText: tr(context, 'Search your events…'), prefixIcon: const Icon(Icons.search_rounded, color: IK.ink4)),
            ),
            const SizedBox(height: 14),
            if (list.isEmpty)
              EmptyState(art: Art.cal3d, title: tr(context, 'Nothing here'), body: tr(context, 'Events you add or scan appear in this list.'))
            else
              for (final e in list) _LogCard(e: e, reload: reload),
          ],
        );
      },
    );
  }
}

class _LogCard extends StatelessWidget {
  const _LogCard({required this.e, required this.reload});
  final Json e;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final d = parseDay(e['date']);
    final type = '${e['type']}';
    final s = Session.read(context);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 12),
      leftAccent: e['source'] == 'ai' ? IK.mag : IK.g4,
      onTap: () async {
        await push(context, EventDetailScreen(event: e));
        await reload();
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          ClipRRect(borderRadius: BorderRadius.circular(14), child: Pic(e['imageUrl'] as String?, fallback: Art.forEventType(type), width: 64, height: 64)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${e['title']}', style: IK.h2(size: 19)),
              Text('${e['time'] ?? tr(context, 'All day')}${d == null ? '' : ' · ${weekdayDay(d)}'}', style: IK.soft(size: 12)),
              if ('${e['venue'] ?? ''}'.isNotEmpty) Text('${e['venue']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.soft(size: 12)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, children: [
                Pill(tr(context, type), tone: Tone.gold),
                Pill(e['source'] == 'ai' ? tr(context, 'AI scan') : tr(context, 'Typed in'), tone: Tone.violet),
              ]),
            ]),
          ),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: IkButton(tr(context, 'Edit'), compact: true, kind: BtnKind.ghost, icon: Icons.edit_outlined, onPressed: () async {
              await push(context, ManualEventScreen(prefill: e, editId: '${e['id']}'));
              await reload();
            }),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: IkButton(tr(context, 'Duplicate'), compact: true, kind: BtnKind.ghost, icon: Icons.copy_rounded, onPressed: () async {
              await push(context, ManualEventScreen(prefill: {...e, 'title': '${e['title']} (copy)'}));
              await reload();
            }),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: IkButton(tr(context, 'Delete'), compact: true, kind: BtnKind.danger, icon: Icons.delete_outline_rounded, onPressed: () async {
              final ok = await confirmSheet(context, title: tr(context, 'Delete this event?'), body: '${e['title']}', confirm: tr(context, 'Delete'), danger: true);
              if (!ok || !context.mounted) return;
              final r = await guard(context, () => s.api.delete('/v1/events/${e['id']}'));
              if (r != null) {
                s.touch();
                await reload();
              }
            }),
          ),
        ]),
      ]),
    );
  }
}
