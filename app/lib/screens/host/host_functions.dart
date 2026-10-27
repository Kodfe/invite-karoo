import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_gifts.dart';
import 'host_home.dart';
import 'host_remind.dart';
import 'host_rsvp.dart';

class HostFunctionsScreen extends StatelessWidget {
  const HostFunctionsScreen({super.key, required this.weddingId});
  final String weddingId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<List<Json>>(
      version: s.dataVersion,
      load: () async => asList(await s.api.get('${hostBase(weddingId)}/functions')),
      builder: (context, fns, reload) {
        final first = fns.isEmpty ? null : fns.first['startsAt'];
        final last = fns.isEmpty ? null : fns.last['startsAt'];
        return IkPage(
          onRefresh: reload,
          header: IkHeader(
            back: false,
            title: tr(context, 'Functions'),
            sub: '${tr(context, '{n} functions', {'n': fns.length})}${first == null ? '' : ' · ${span(first.toString().substring(0, 10), last.toString().substring(0, 10))}'}',
            art: Art.mandap,
          ),
          children: [
            for (final f in fns) HostFnCard(f: f, weddingId: weddingId, onBack: reload),
            const SizedBox(height: 8),
            Note(tr(context, 'Functions are set up by the Invite Karoo team. To add or move one, write to us from Help and support.'), icon: Icons.info_outline_rounded),
          ],
        );
      },
    );
  }
}

class HostFunctionScreen extends StatelessWidget {
  const HostFunctionScreen({super.key, required this.weddingId, required this.functionId});
  final String weddingId;
  final String functionId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      version: s.dataVersion,
      load: () async => asJson(await s.api.get('${hostBase(weddingId)}/functions/$functionId')),
      builder: (context, f, reload) {
        final c = asJson(f['counts']);
        final blasts = asJson(f['blasts']);
        final inv = blasts['rsvp_request'] == null ? null : asJson(blasts['rsvp_request']);
        final rem = blasts['reminder'] == null ? null : asJson(blasts['reminder']);
        final giftOut = asJson(f['giftOut']);
        final received = asJson(f['giftsReceived']);
        final closes = parseTs(f['closesAt']);
        final past = f['past'] == true;
        return IkPage(
          onRefresh: reload,
          header: IkHeader(title: '${f['name']}', sub: '${f['dayLabel']} · ${f['timeLabel']}', art: Art.forFunction('${f['name']}', '${f['icon'] ?? ''}')),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(gradient: IK.consoleGradient, borderRadius: BorderRadius.circular(22), boxShadow: IK.sh3),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.auto_awesome_rounded, size: 13, color: IK.g4),
                  const SizedBox(width: 5),
                  Text(tr(context, 'SET UP BY INVITE KAROO'), style: IK.label(size: 9.5, color: IK.g4)),
                ]),
                const SizedBox(height: 6),
                Text('${f['name']}', style: IK.title(size: 28, color: Colors.white)),
                const SizedBox(height: 8),
                _line(Icons.calendar_month_outlined, '${f['dayLabel']} · ${f['timeLabel']}${f['endLabel'] != null ? ' – ${f['endLabel']}' : ''}'),
                _line(Icons.location_on_outlined, '${f['venueName']}${(f['venueAddress'] ?? '').toString().isEmpty ? '' : '\n${f['venueAddress']}'}'),
                if ((f['dressCode'] ?? '').toString().isNotEmpty) _line(Icons.checkroom_rounded, '${f['dressCode']}'),
                if ((f['notes'] ?? '').toString().isNotEmpty) _line(Icons.sticky_note_2_outlined, '${f['notes']}'),
                const SizedBox(height: 12),
                Row(children: [
                  if (f['mapsUrl'] != null || (f['venueAddress'] ?? '').toString().isNotEmpty)
                    _darkBtn(Icons.map_outlined, tr(context, 'Map'), () {
                      final url = f['mapsUrl'] ?? 'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent('${f['venueName']}, ${f['venueAddress']}')}';
                      launchUrl(Uri.parse('$url'), mode: LaunchMode.externalApplication);
                    }),
                  _darkBtn(Icons.mark_email_read_outlined, tr(context, 'RSVP'), () => push(context, RsvpBoardScreen(weddingId: weddingId, functionId: functionId, name: '${f['name']}'))),
                  _darkBtn(Icons.card_giftcard_rounded, tr(context, 'Gifts'), () => push(context, GiftOutListScreen(weddingId: weddingId, functionId: functionId, name: '${f['name']}'))),
                ]),
              ]),
            ),
            SectionTitle(tr(context, 'Replies')),
            IkCard(
              child: Column(children: [
                Row(children: [
                  _num('${c['going']}', tr(context, 'Coming'), IK.ok),
                  _num('${c['maybe']}', tr(context, 'Maybe'), IK.g5),
                  _num('${c['not_going']}', tr(context, 'Not coming'), IK.bad),
                  _num('${c['none']}', tr(context, 'No reply'), IK.v4),
                ]),
                const SizedBox(height: 10),
                ReplyBar(going: toInt(c['going']), maybe: toInt(c['maybe']), notGoing: toInt(c['not_going']), none: toInt(c['none']), height: 9),
                const SizedBox(height: 12),
                Row(children: [
                  const Icon(Icons.groups_outlined, color: IK.v6, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text(tr(context, 'Expected headcount'), style: IK.strong(size: 13.5))),
                  Text('${c['pax']}', style: IK.title(size: 26, color: IK.ok)),
                ]),
                if (toInt(c['byHost']) > 0)
                  Align(alignment: Alignment.centerLeft, child: Text(tr(context, '{n} replies were marked by your family', {'n': c['byHost']}), style: IK.soft(size: 11.5))),
                const SizedBox(height: 10),
                Note(
                  f['window'] == 'never'
                      ? tr(context, 'Added close to the day, so guests cannot reply in the app. Mark replies for them after you call.')
                      : (closes != null && closes.isAfter(DateTime.now())
                          ? tr(context, 'Guests can reply until {d}. After that, you can still mark replies for them.', {'d': '${weekdayDay(closes)}, ${clock(closes)}'})
                          : tr(context, 'Replies are closed for guests. You can still mark replies for them.')),
                  icon: Icons.schedule_rounded,
                ),
                const SizedBox(height: 10),
                IkButton(tr(context, 'See every reply'), kind: BtnKind.ghost, compact: true, icon: Icons.list_alt_rounded,
                    onPressed: () => push(context, RsvpBoardScreen(weddingId: weddingId, functionId: functionId, name: '${f['name']}'))),
              ]),
            ),
            SectionTitle(tr(context, 'Reminders')),
            IkGroup(children: [
              IkRow(
                image: Art.whatsapp,
                title: tr(context, 'WhatsApp invitation'),
                sub: inv == null
                    ? tr(context, 'Not sent yet · goes once, to every guest on this function')
                    : '${_state(context, '${inv['state']}')} · ${inv['recipientCount']} ${tr(context, 'guests')}${inv['sentAt'] != null ? ' · ${ago(inv['sentAt'])}' : ''}',
                trailing: inv == null && !past
                    ? IkButton(tr(context, 'Send'), compact: true, kind: BtnKind.whatsapp,
                        onPressed: () => push(context, HostRemindScreen(weddingId: weddingId, functionId: functionId, presetKind: 'rsvp_request')))
                    : Icon(inv == null ? Icons.remove_circle_outline_rounded : Icons.check_circle_rounded, color: inv == null ? IK.ink4 : IK.ok),
              ),
              IkRow(
                image: Art.whatsapp,
                title: tr(context, 'WhatsApp reminder'),
                sub: rem == null
                    ? tr(context, 'Once, to everyone who has not said no')
                    : '${_state(context, '${rem['state']}')} · ${rem['recipientCount']} ${tr(context, 'guests')}${rem['sentAt'] != null ? ' · ${ago(rem['sentAt'])}' : ''}',
                trailing: rem == null && inv != null && !past
                    ? IkButton(tr(context, 'Send'), compact: true, kind: BtnKind.whatsapp,
                        onPressed: () => push(context, HostRemindScreen(weddingId: weddingId, functionId: functionId, presetKind: 'reminder')))
                    : Icon(rem == null ? Icons.remove_circle_outline_rounded : Icons.check_circle_rounded, color: rem == null ? IK.ink4 : IK.ok),
              ),
              IkRow(
                icon: Icons.notifications_active_outlined,
                title: tr(context, 'App message'),
                sub: tr(context, 'Unlimited · to guests who have the app'),
                onTap: past ? null : () => push(context, HostRemindScreen(weddingId: weddingId, functionId: functionId, presetKind: 'nudge')),
              ),
            ]),
            SectionTitle(tr(context, 'Gifts')),
            Row(children: [
              Expanded(
                child: StatTile(
                  value: '${giftOut['given']} / ${giftOut['planned']}',
                  label: tr(context, 'Given'),
                  color: IK.mag,
                  onTap: () => push(context, GiftOutListScreen(weddingId: weddingId, functionId: functionId, name: '${f['name']}')),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: '${received['count']}', label: tr(context, 'Received'), color: IK.goldInk)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: rupees(toInt(received['cash'])), label: tr(context, 'Cash'), color: IK.ok)),
            ]),
            if ((f['giftPlan'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 10),
              Note(tr(context, 'Gift for guests at this function: {g}', {'g': f['giftPlan']}), icon: Icons.card_giftcard_rounded, tone: Tone.mag),
            ],
          ],
        );
      },
    );
  }

  static String _state(BuildContext context, String s) => switch (s) {
        'sent' => tr(context, 'Sent'),
        'sending' => tr(context, 'Sending'),
        'queued' => tr(context, 'Queued'),
        'failed' => tr(context, 'Failed — you can send again'),
        _ => s,
      };

  Widget _line(IconData i, String t) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(i, size: 15, color: IK.g3),
          const SizedBox(width: 8),
          Expanded(child: Text(t, style: IK.body(size: 12.5, color: Colors.white))),
        ]),
      );

  Widget _darkBtn(IconData i, String t, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Material(
          color: Colors.white.withValues(alpha: .12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Colors.white24)),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(i, size: 15, color: Colors.white),
                const SizedBox(width: 6),
                Text(t, style: IK.strong(size: 12, color: Colors.white)),
              ]),
            ),
          ),
        ),
      );

  Widget _num(String n, String label, Color c) => Expanded(
        child: Column(children: [
          Text(n, style: IK.title(size: 26, color: c)),
          Text(label, textAlign: TextAlign.center, style: IK.soft(size: 10.5).copyWith(fontWeight: FontWeight.w700)),
        ]),
      );
}
