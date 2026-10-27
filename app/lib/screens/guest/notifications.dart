import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../profile/notif_prefs.dart';

/// Five kinds of message arrive here: invitations, reminders, host messages and housekeeping.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  String _cat = 'all';
  final _key = GlobalKey<LoaderState<Json>>();

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      key: _key,
      load: () async => asJson(await s.api.get('/v1/notifications', query: {'limit': 100})),
      builder: (context, d, reload) {
        final all = asList(d['items']);
        final unread = toInt(d['unread']);
        final list = _cat == 'all' ? all : all.where((n) => n['cat'] == _cat).toList();
        int count(String c) => all.where((n) => n['cat'] == c).length;
        final groups = <String, List<Json>>{};
        for (final n in list) {
          final t = parseTs(n['createdAt']) ?? DateTime.now();
          (groups[tr(context, relDay(t))] ??= []).add(n);
        }
        Future<void> readAll() async {
          await guard(context, () => s.api.post('/v1/notifications/read-all'));
          await reload();
          s.refreshMe().catchError((_) {});
        }

        return IkPage(
          onRefresh: reload,
          header: IkHeader(
            title: tr(context, 'Notifications'),
            sub: tr(context, '{u} unread · {t} in total', {'u': unread, 't': all.length}),
            art: Art.mailIc,
            actions: [if (unread > 0) SquareBtn(icon: Icons.done_all_rounded, onTap: readAll)],
          ),
          children: [
            ChipTabs(
              items: [
                ('all', '${tr(context, 'All')} · ${all.length}'),
                ('inv', '${tr(context, 'Invites')} · ${count('inv')}'),
                ('rem', '${tr(context, 'Reminders')} · ${count('rem')}'),
                ('host', '${tr(context, 'From hosts')} · ${count('host')}'),
                ('sys', '${tr(context, 'Account')} · ${count('sys')}'),
              ],
              value: _cat,
              onChanged: (v) => setState(() => _cat = v),
            ),
            if (unread > 0) ...[
              const SizedBox(height: 12),
              IkCard(
                color: IK.g0,
                child: Row(children: [
                  Image.asset(Art.calPink, width: 34),
                  const SizedBox(width: 10),
                  Expanded(child: Text(tr(context, '{n} new', {'n': unread}), style: IK.strong(size: 14))),
                  IkButton(tr(context, 'Mark read'), compact: true, kind: BtnKind.dark, onPressed: readAll),
                ]),
              ),
            ],
            if (list.isEmpty)
              EmptyState(art: Art.bells, title: tr(context, 'All quiet'), body: tr(context, 'Invitations, reminders and messages from your hosts arrive here.'))
            else
              for (final g in groups.entries) ...[
                SectionTitle(g.key, count: g.value.length),
                for (final n in g.value) _NotifRow(n: n, onChanged: reload),
              ],
            const SizedBox(height: 10),
            Center(child: LinkText(tr(context, 'Notification preferences'), onTap: () => push(context, const NotifPrefsScreen()))),
          ],
        );
      },
    );
  }
}

class _NotifRow extends StatelessWidget {
  const _NotifRow({required this.n, required this.onChanged});
  final Json n;
  final Future<void> Function() onChanged;

  (IconData, Tone, String) get _kind => switch ('${n['cat']}') {
        'inv' => (Icons.drafts_outlined, Tone.mag, 'Invitation'),
        'rem' => (Icons.alarm_rounded, Tone.gold, 'Reminder'),
        'host' => (Icons.campaign_outlined, Tone.violet, 'From the hosts'),
        _ => (Icons.info_outline_rounded, Tone.info, 'Account'),
      };

  @override
  Widget build(BuildContext context) {
    final s = Session.read(context);
    final unread = n['read'] != true;
    final (icon, tone, label) = _kind;
    final (bg, fg) = Pill.colors(tone);
    final t = parseTs(n['createdAt']);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      leftAccent: unread ? fg : null,
      onTap: () async {
        if (unread) {
          await s.api.post('/v1/notifications/${n['id']}/read').catchError((_) => null);
          s.refreshMe().catchError((_) {});
        }
        if (!context.mounted) return;
        await _detail(context);
        await onChanged();
      },
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 42, height: 42, decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(13)), child: Icon(icon, color: fg, size: 20)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text('${n['title']}', style: IK.strong(size: 13.5).copyWith(fontWeight: unread ? FontWeight.w800 : FontWeight.w600))),
              if (t != null) Text(clock(t), style: IK.monoS(size: 10)),
            ]),
            const SizedBox(height: 3),
            Text('${n['body']}', maxLines: 3, overflow: TextOverflow.ellipsis, style: IK.soft(size: 12)),
            const SizedBox(height: 6),
            Row(children: [
              Pill(tr(context, label), tone: tone, size: 9),
              if (unread) ...[const SizedBox(width: 6), Pill(tr(context, 'New'), tone: Tone.ok, size: 9)],
            ]),
          ]),
        ),
      ]),
    );
  }

  Future<void> _detail(BuildContext context) async {
    final action = asJson(n['action']);
    final hasAction = action['type'] != null && action['type'] != 'none';
    final s = Session.read(context);
    await showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Center(child: Pill(tr(context, _kind.$3), tone: _kind.$2)),
            const SizedBox(height: 10),
            Text('${n['title']}', textAlign: TextAlign.center, style: IK.title(size: 24)),
            const SizedBox(height: 6),
            if (parseTs(n['createdAt']) != null) Center(child: Text(ago(n['createdAt']), style: IK.monoS(size: 11))),
            const SizedBox(height: 12),
            IkCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${n['body']}', style: IK.body(size: 13.5)),
                if ('${n['long'] ?? ''}'.isNotEmpty) ...[const SizedBox(height: 8), Text('${n['long']}', style: IK.soft(size: 12.5))],
              ]),
            ),
            const SizedBox(height: 14),
            if (hasAction)
              IkButton(
                action['type'] == 'function' ? tr(context, 'Open the function') : (action['type'] == 'ticket' ? tr(context, 'Open the ticket') : tr(context, 'Open')),
                icon: Icons.arrow_forward_rounded,
                onPressed: () {
                  Navigator.pop(ctx);
                  openAction(action);
                },
              ),
            const SizedBox(height: 8),
            IkButton(tr(context, 'Mark as unread'), kind: BtnKind.ghost, icon: Icons.mark_email_unread_outlined, onPressed: () async {
              Navigator.pop(ctx);
              await s.api.post('/v1/notifications/${n['id']}/unread').catchError((_) => null);
              s.refreshMe().catchError((_) {});
            }),
          ]),
        ),
      ),
    );
  }
}
