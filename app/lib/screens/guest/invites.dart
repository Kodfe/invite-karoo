import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';
import 'wedding.dart';

/// Every wedding this guest is invited to, sorted by their OWN next function.
/// Every number on a card is about this guest — never a total or another guest's reply.
class InvitesScreen extends StatefulWidget {
  const InvitesScreen({super.key, this.asTab = false});
  final bool asTab;
  @override
  State<InvitesScreen> createState() => _InvitesScreenState();
}

class _InvitesScreenState extends State<InvitesScreen> {
  final _loader = GlobalKey<LoaderState<Json>>();
  bool _finished = false;

  @override
  Widget build(BuildContext context) {
    final api = Session.of(context).api;
    return Loader<Json>(
      key: _loader,
      load: () async => asJson(await api.get('/v1/invitations', query: {'finished': '1'})),
      builder: (context, d, reload) {
        final live = asList(d['weddings']);
        final done = asList(d['finished']);
        final reply = live.fold<int>(0, (a, w) => a + toInt(w['needsReply']));
        final fns = live.fold<int>(0, (a, w) => a + toInt(w['myFunctions']));
        final list = _finished ? done : live;
        return IkPage(
          onRefresh: reload,
          header: IkHeader(
            back: !widget.asTab,
            title: tr(context, 'Your invitations'),
            sub: tr(context, '{w} weddings · {r} need a reply', {'w': live.length, 'r': reply}),
            art: Art.a('cplBengali'),
          ),
          children: [
            Row(children: [
              Expanded(child: StatTile(value: '${live.length}', label: tr(context, 'Weddings'), icon: Art.rings)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '$fns', label: tr(context, 'Functions'), icon: Art.calPurple)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '$reply', label: tr(context, 'To reply'), icon: Art.hourglass2, color: IK.mag)),
            ]),
            if (done.isNotEmpty) ...[
              const SizedBox(height: 14),
              Segmented(
                items: [('live', tr(context, 'Coming up')), ('done', '${tr(context, 'Finished')} · ${done.length}')],
                value: _finished ? 'done' : 'live',
                onChanged: (v) => setState(() => _finished = v == 'done'),
              ),
            ],
            const SizedBox(height: 14),
            if (list.isEmpty)
              EmptyState(
                art: d['state'] == 'all_finished' ? Art.gathbandhan : Art.a('waWord'),
                title: d['state'] == 'all_finished' ? tr(context, 'All celebrated') : tr(context, 'No invitations yet'),
                body: d['state'] == 'all_finished'
                    ? tr(context, 'Every wedding you were invited to has finished. New invitations will appear here.')
                    : tr(context, 'When a family adds your number to their guest list, their wedding appears here — with every function you are invited to.'),
              )
            else
              for (final w in list) WeddingCard(w: w, onBack: reload),
          ],
        );
      },
    );
  }
}

class WeddingCard extends StatelessWidget {
  const WeddingCard({super.key, required this.w, this.onBack});
  final Json w;
  final Future<void> Function()? onBack;

  @override
  Widget build(BuildContext context) {
    final next = asJson(w['next']);
    final needs = toInt(w['needsReply']);
    final couple = '${w['couple']}'.split(' & ');
    final nextDay = parseTs(next['startsAt']);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(8),
      onTap: () async {
        await push(context, WeddingScreen(weddingId: '${w['weddingId']}'));
        await onBack?.call();
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            height: 150,
            child: Stack(fit: StackFit.expand, children: [
              Pic(w['cover'] as String?, fallback: Art.homeCouple),
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, IK.ink.withValues(alpha: .75)]),
                ),
              ),
              if (needs > 0)
                Positioned(
                  top: 10,
                  right: 10,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(color: IK.mag, borderRadius: BorderRadius.circular(20)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.drafts_outlined, size: 12, color: Colors.white),
                      const SizedBox(width: 4),
                      Text(tr(context, '{n} to reply', {'n': needs}), style: IK.strong(size: 11, color: Colors.white)),
                    ]),
                  ),
                ),
              Positioned(
                left: 14,
                right: 14,
                bottom: 10,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text.rich(
                    TextSpan(children: [
                      TextSpan(text: couple.first),
                      if (couple.length > 1) const TextSpan(text: ' & ', style: TextStyle(color: IK.g3)),
                      if (couple.length > 1) TextSpan(text: couple.last),
                    ]),
                    style: IK.title(size: 27, color: Colors.white),
                  ),
                  Text('${w['families']}', style: IK.body(size: 11.5, color: IK.v1)),
                ]),
              ),
            ]),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 10, 8, 4),
          child: Row(children: [
            const Icon(Icons.calendar_month_outlined, size: 15, color: IK.v6),
            const SizedBox(width: 5),
            Text(span(w['startDate'], w['endDate']), style: IK.strong(size: 12.5, color: IK.ink2)),
            const SizedBox(width: 12),
            const Icon(Icons.location_on_outlined, size: 15, color: IK.v6),
            const SizedBox(width: 4),
            Expanded(child: Text('${w['city']}', overflow: TextOverflow.ellipsis, style: IK.strong(size: 12.5, color: IK.ink2))),
          ]),
        ),
        if (next.isNotEmpty && nextDay != null)
          Container(
            margin: const EdgeInsets.fromLTRB(4, 8, 4, 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: IK.v0, borderRadius: BorderRadius.circular(16), border: Border.all(color: IK.line)),
            child: Row(children: [
              Container(
                width: 50,
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: IK.goldLine)),
                child: Column(children: [
                  Text('${nextDay.day}', style: IK.title(size: 22)),
                  Text(DateFormatShort.mon(nextDay), style: IK.label(size: 8.5)),
                ]),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(tr(context, 'YOUR NEXT FUNCTION'), style: IK.label(size: 8.5, color: IK.goldInk)),
                  Text('${next['name']}', style: IK.h2(size: 18)),
                  Text('${next['dayLabel']} · ${next['timeLabel']}', style: IK.soft(size: 11.5)),
                ]),
              ),
              Image.asset(Art.forFunction('${next['name']}'), height: 56),
            ]),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 4, 6, 4),
          child: Row(children: [
            Pill(tr(context, '{n} functions', {'n': w['myFunctions']}), tone: Tone.violet, icon: Icons.event_note_rounded),
            const SizedBox(width: 6),
            if (needs > 0) Pill(tr(context, '{n} needs a reply', {'n': needs}), tone: Tone.mag),
            if (needs == 0 && toInt(w['going']) > 0) Pill(tr(context, 'Replied'), tone: Tone.ok, icon: Icons.check_rounded),
            const Spacer(),
            Container(
              width: 30,
              height: 30,
              decoration: const BoxDecoration(color: IK.v7, shape: BoxShape.circle),
              child: const Icon(Icons.arrow_forward_rounded, size: 17, color: Colors.white),
            ),
          ]),
        ),
      ]),
    );
  }
}

class DateFormatShort {
  static const _m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  static String mon(DateTime d) => _m[d.month - 1];
}
