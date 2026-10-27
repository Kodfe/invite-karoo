import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_family.dart';
import 'host_functions.dart';
import 'host_remind.dart';
import 'host_scan.dart';
import 'host_wedding.dart';

String hostBase(String wid) => '/v1/host/weddings/$wid';

/// The console's front page: the couple, the countdown, the four numbers, and what needs the host now.
class HostHome extends StatelessWidget {
  const HostHome({super.key, required this.weddingId, required this.onTab});
  final String weddingId;
  final ValueChanged<int> onTab;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      version: s.dataVersion,
      load: () async => asJson(await s.api.get(hostBase(weddingId))),
      builder: (context, d, reload) => _HomeBody(d: d, weddingId: weddingId, reload: reload, onTab: onTab),
    );
  }
}

class _HomeBody extends StatelessWidget {
  const _HomeBody({required this.d, required this.weddingId, required this.reload, required this.onTab});
  final Json d;
  final String weddingId;
  final Future<void> Function() reload;
  final ValueChanged<int> onTab;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final desk = s.isGiftDesk;
    final w = asJson(d['wedding']);
    final totals = asJson(d['totals']);
    final fns = asList(d['functions']);
    final guests = toInt(totals['guests']);
    final replied = guests == 0 ? 0 : (((toInt(totals['going']) + toInt(totals['not_going'])) / guests) * 100).round();
    final giftsToGive = fns.fold<int>(0, (a, f) => a + toInt(asJson(f['giftOut'])['planned']) - toInt(asJson(f['giftOut'])['given']));
    final upcoming = fns.where((f) => f['past'] != true).toList();
    final next = upcoming.isEmpty ? null : upcoming.first;
    final top = MediaQuery.paddingOf(context).top;
    final names = '${w['couple']}'.split(' & ');

    // tab numbers differ for the gift desk, which has no Functions or RSVP tab
    int tabOf(String t) => desk ? const {'guests': 1, 'gifts': 2}[t] ?? 0 : const {'functions': 1, 'rsvp': 2, 'guests': 3, 'gifts': 4}[t] ?? 0;

    String countdown() {
      if (next == null) return tr(context, 'Every function has finished. Thank you for celebrating with Invite Karoo.');
      final start = parseTs(next['startsAt'])!;
      final days = DateTime(start.year, start.month, start.day).difference(DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day)).inDays;
      if (days <= 0) return tr(context, 'The {f} is today at {t}.', {'f': next['name'], 't': next['timeLabel']});
      if (days == 1) return tr(context, 'The {f} is tomorrow at {t}.', {'f': next['name'], 't': next['timeLabel']});
      return tr(context, 'The {f} is in {n} days.', {'f': next['name'], 'n': days});
    }

    final needs = <Widget>[];
    if (!desk) {
      for (final a in asList(d['alerts'])) {
        final f = fns.where((x) => x['id'] == a['functionId']).firstOrNull;
        needs.add(_NeedRow(
          color: IK.bad,
          title: f == null ? '${a['text']}' : tr(context, '{f}: invitations not sent yet', {'f': f['name']}),
          sub: tr(context, 'Send the WhatsApp invitation so guests can reply'),
          action: f == null ? null : tr(context, 'Send'),
          onTap: f == null ? null : () => push(context, HostRemindScreen(weddingId: weddingId, functionId: '${f['id']}', presetKind: 'rsvp_request')),
        ));
      }
      for (final f in upcoming) {
        final start = parseTs(f['startsAt']);
        final c = asJson(f['counts']);
        if (start != null && start.difference(DateTime.now()).inHours < 36) {
          needs.add(_NeedRow(
            color: IK.ok,
            title: tr(context, '{f} is {when}', {'f': f['name'], 'when': tr(context, relDay(start)).toLowerCase()}),
            sub: tr(context, 'Remind the {n} who are coming', {'n': c['going']}),
            action: tr(context, 'Remind'),
            onTap: () => push(context, HostRemindScreen(weddingId: weddingId, functionId: '${f['id']}', presetAudience: 'going')),
          ));
        }
        if (toInt(c['none']) > 0 && f['blasts'] is Map && asJson(f['blasts'])['rsvp_request'] != null) {
          needs.add(_NeedRow(
            color: IK.g5,
            title: tr(context, '{n} haven’t confirmed {f}', {'n': c['none'], 'f': f['name']}),
            sub: tr(context, 'They get a reply link on WhatsApp and in the app'),
            action: tr(context, 'Remind'),
            onTap: () => push(context, HostRemindScreen(weddingId: weddingId, functionId: '${f['id']}', presetAudience: 'pending')),
          ));
        }
      }
    }

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: IK.ivory,
        body: RefreshIndicator(
          onRefresh: reload,
          child: ListView(padding: EdgeInsets.zero, physics: const AlwaysScrollableScrollPhysics(), children: [
            Container(
              height: 330 + top,
              decoration: const BoxDecoration(color: Color(0xFF2A0F3A), borderRadius: BorderRadius.vertical(bottom: Radius.circular(30))),
              clipBehavior: Clip.antiAlias,
              child: Stack(fit: StackFit.expand, children: [
                Image.asset(Art.homeCouple, fit: BoxFit.cover, alignment: Alignment.topCenter),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [
                      const Color(0xFF2A0F3A).withValues(alpha: .35),
                      const Color(0xFF2A0F3A).withValues(alpha: .7),
                      const Color(0xFF2A0F3A),
                    ]),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(16, top + 10, 16, 16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      GestureDetector(
                        onTap: () => s.enterGuest(),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                          decoration: BoxDecoration(color: Colors.white.withValues(alpha: .14), borderRadius: BorderRadius.circular(13), border: Border.all(color: Colors.white24)),
                          child: Row(children: [
                            const Icon(Icons.arrow_back_rounded, size: 16, color: Colors.white),
                            const SizedBox(width: 6),
                            Text(tr(context, 'My agenda'), style: IK.strong(size: 12.5, color: Colors.white)),
                          ]),
                        ),
                      ),
                      const Spacer(),
                      SquareBtn(icon: Icons.groups_2_outlined, dark: true, onTap: () => push(context, HostFamilyScreen(weddingId: weddingId))),
                      const SizedBox(width: 8),
                      SquareBtn(icon: Icons.auto_awesome_mosaic_outlined, dark: true, onTap: () => push(context, HostWeddingScreen(weddingId: weddingId))),
                    ]),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                      decoration: BoxDecoration(gradient: IK.goldGradient, borderRadius: BorderRadius.circular(20)),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        const Icon(Icons.auto_awesome_rounded, size: 13, color: IK.v9),
                        const SizedBox(width: 5),
                        Text(desk ? tr(context, 'GIFT DESK') : tr(context, 'WEDDING CONSOLE'), style: IK.label(size: 9.5, color: IK.v9)),
                      ]),
                    ),
                    const SizedBox(height: 8),
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(text: names.first),
                        if (names.length > 1) const TextSpan(text: ' & ', style: TextStyle(color: IK.g4)),
                        if (names.length > 1) TextSpan(text: names.last),
                      ]),
                      style: IK.title(size: 36, color: Colors.white),
                    ),
                    const SizedBox(height: 4),
                    Row(children: [
                      const Icon(Icons.calendar_month_outlined, size: 14, color: IK.v2),
                      const SizedBox(width: 5),
                      Text(span(w['startDate'], w['endDate']), style: IK.body(size: 12.5, color: IK.v1, weight: FontWeight.w600)),
                      const SizedBox(width: 12),
                      const Icon(Icons.location_on_outlined, size: 14, color: IK.v2),
                      const SizedBox(width: 4),
                      Text('${w['city']}', style: IK.body(size: 12.5, color: IK.v1, weight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: .1), borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.white24)),
                      child: Row(children: [
                        if (next != null) ...[
                          Text('${_daysTo(next)}', style: IK.title(size: 34, color: IK.g4)),
                          const SizedBox(width: 10),
                        ],
                        Expanded(child: Text(countdown(), style: IK.body(size: 12.5, color: Colors.white, weight: FontWeight.w600))),
                      ]),
                    ),
                  ]),
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 30),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (w['status'] != 'active' || w['sendingEnabled'] == false) ...[
                  Note(
                    w['status'] == 'paused'
                        ? tr(context, 'This wedding is paused by the Invite Karoo team. Guests cannot reply and nothing is sent.')
                        : (w['status'] == 'ended' ? tr(context, 'This wedding has ended.') : tr(context, 'Sending is switched off for this wedding. Contact the Invite Karoo team.')),
                    tone: Tone.gold,
                    icon: Icons.pause_circle_outline_rounded,
                  ),
                  const SizedBox(height: 12),
                ],
                Row(children: [
                  Expanded(child: StatTile(value: '$guests', label: tr(context, 'Guests'), onTap: () => onTab(tabOf('guests')))),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(value: '$replied%', label: tr(context, 'Replied'), color: IK.ok, onTap: desk ? null : () => onTab(tabOf('rsvp')))),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(value: '${fns.length}', label: tr(context, 'Functions'), onTap: desk ? null : () => onTab(tabOf('functions')))),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(value: '$giftsToGive', label: tr(context, 'Gifts to give'), color: IK.mag, onTap: () => onTab(tabOf('gifts')))),
                ]),
                const SizedBox(height: 12),
                IkCard(
                  gradient: IK.darkGradient,
                  border: Colors.transparent,
                  onTap: () => push(context, HostScanScreen(weddingId: weddingId, functions: fns)),
                  child: Row(children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(gradient: IK.goldGradient, borderRadius: BorderRadius.circular(13)),
                      child: const Icon(Icons.qr_code_scanner_rounded, color: IK.v9),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(tr(context, 'Open the gift desk'), style: IK.strong(size: 14.5, color: Colors.white)),
                        Text(tr(context, 'Scan a guest’s invitation to give or record a gift'), style: IK.body(size: 11.5, color: IK.v2)),
                      ]),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: IK.g3),
                  ]),
                ),
                if (needs.isNotEmpty) ...[
                  SectionTitle(tr(context, 'Needs you now'), count: needs.length),
                  IkGroup(children: needs),
                ],
                if (!desk) ...[
                  SectionTitle(tr(context, 'Functions'), trailing: LinkText(tr(context, 'All'), onTap: () => onTab(tabOf('functions')), size: 12)),
                  for (final f in fns) HostFnCard(f: f, weddingId: weddingId, onBack: reload),
                  if (asList(d['recent']).isNotEmpty) ...[
                    SectionTitle(tr(context, 'Latest replies')),
                    IkGroup(children: [
                      for (final r in asList(d['recent']))
                        IkRow(
                          title: '${r['name']}',
                          sub: '${r['functionName']} · ${ago(r['at'])}${r['byHost'] == true ? ' · ${tr(context, 'by you')}' : ''}',
                          icon: r['rsvp'] == 'going' ? Icons.check_circle_rounded : (r['rsvp'] == 'maybe' ? Icons.help_rounded : Icons.cancel_rounded),
                          iconColor: r['rsvp'] == 'going' ? IK.ok : (r['rsvp'] == 'maybe' ? IK.g5 : IK.bad),
                          iconBg: r['rsvp'] == 'going' ? IK.okBg : (r['rsvp'] == 'maybe' ? IK.g1 : IK.badBg),
                          trailing: r['rsvp'] == 'going' ? Pill('${r['pax']} ${tr(context, 'people')}', tone: Tone.ok) : null,
                        ),
                    ]),
                  ],
                ],
                const SizedBox(height: 16),
                Center(child: Text('${tr(context, 'Signed in as')} ${asJson(d['me'])['name']} · ${_roleName(context, '${asJson(d['me'])['role']}')}', style: IK.soft(size: 11.5))),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  int _daysTo(Json f) {
    final start = parseTs(f['startsAt'])!;
    final n = DateTime.now();
    final d = DateTime(start.year, start.month, start.day).difference(DateTime(n.year, n.month, n.day)).inDays;
    return d < 0 ? 0 : d;
  }

  String _roleName(BuildContext context, String r) => r == 'owner' ? tr(context, 'Owner') : (r == 'giftdesk' ? tr(context, 'Gift desk') : tr(context, 'Family'));
}

class _NeedRow extends StatelessWidget {
  const _NeedRow({required this.color, required this.title, required this.sub, this.action, this.onTap});
  final Color color;
  final String title;
  final String sub;
  final String? action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(children: [
          Dot(color, size: 9),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: IK.strong(size: 13.5)),
              const SizedBox(height: 2),
              Text(sub, style: IK.soft(size: 11.5)),
            ]),
          ),
          if (action != null) IkButton(action!, compact: true, kind: BtnKind.dark, icon: Icons.notifications_active_outlined, onPressed: onTap),
        ]),
      );
}

/// a function in the console: date, name, venue, the reply bar and its counts
class HostFnCard extends StatelessWidget {
  const HostFnCard({super.key, required this.f, required this.weddingId, this.onBack});
  final Json f;
  final String weddingId;
  final Future<void> Function()? onBack;

  @override
  Widget build(BuildContext context) {
    final c = asJson(f['counts']);
    final color = hexColor('${f['color']}');
    final start = parseTs(f['startsAt']);
    final giftOut = asJson(f['giftOut']);
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      leftAccent: color,
      onTap: () async {
        await push(context, HostFunctionScreen(weddingId: weddingId, functionId: '${f['id']}'));
        await onBack?.call();
      },
      child: Opacity(
        opacity: f['past'] == true ? .6 : 1,
        child: Row(children: [
          Container(
            width: 64,
            height: 72,
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(32), bottom: Radius.circular(10)),
              gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF4ECFF), Color(0xFFFFEFF4)]),
              border: Border.all(color: IK.goldLine),
            ),
            child: Image.asset(Art.forFunction('${f['name']}', '${f['icon'] ?? ''}'), fit: BoxFit.contain, alignment: Alignment.bottomCenter),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text('${f['dayLabel']} · ${f['timeLabel']}', style: IK.label(size: 9.5, color: color))),
                if (start != null && f['past'] != true && start.difference(DateTime.now()).inDays < 7) ...[
                  const SizedBox(width: 6),
                  Pill(tr(context, relDay(start)), tone: Tone.gold, size: 8.5),
                ],
              ]),
              Text('${f['name']}', style: IK.h2(size: 19)),
              Row(children: [
                const Icon(Icons.location_on_outlined, size: 12, color: IK.ink4),
                const SizedBox(width: 3),
                Expanded(child: Text('${f['venueName']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.soft(size: 11.5))),
              ]),
              const SizedBox(height: 7),
              ReplyBar(going: toInt(c['going']), maybe: toInt(c['maybe']), notGoing: toInt(c['not_going']), none: toInt(c['none'])),
              const SizedBox(height: 6),
              Wrap(spacing: 10, children: [
                Text('${c['invited']} ${tr(context, 'invited')}', style: IK.soft(size: 11)),
                Text('${c['going']} ${tr(context, 'coming')} · ${c['pax']} ${tr(context, 'people')}', style: IK.body(size: 11, color: IK.ok, weight: FontWeight.w700)),
                if (toInt(giftOut['planned']) > 0) Text('${giftOut['planned']} ${tr(context, 'gifts')}', style: IK.body(size: 11, color: IK.mag, weight: FontWeight.w700)),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}
