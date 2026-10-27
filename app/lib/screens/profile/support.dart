import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'help.dart';

const ticketCategories = [
  ('invitation', 'An invitation', Icons.drafts_outlined),
  ('rsvp', 'A reply or reminder', Icons.alarm_rounded),
  ('hosting', 'Hosting a wedding', Icons.favorite_border_rounded),
  ('account', 'My account', Icons.person_outline_rounded),
  ('app', 'The app is not working', Icons.bug_report_outlined),
  ('general', 'Something else', Icons.chat_bubble_outline_rounded),
];

String categoryLabel(String c) => ticketCategories.firstWhere((x) => x.$1 == c, orElse: () => ticketCategories.last).$2;

class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key});
  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  String _tab = 'open';

  @override
  Widget build(BuildContext context) {
    final api = Session.of(context).api;
    return Loader<List<Json>>(
      load: () async => asList(await api.get('/v1/tickets')),
      builder: (context, all, reload) {
        final open = all.where((t) => t['status'] != 'closed').toList();
        final done = all.where((t) => t['status'] == 'closed').toList();
        final list = _tab == 'open' ? open : done;
        return IkPage(
          onRefresh: reload,
          header: IkHeader(title: tr(context, 'Help and support'), sub: tr(context, '{o} open · {r} resolved', {'o': open.length, 'r': done.length}), art: Art.lanterns),
          children: [
            IkCard(
              gradient: IK.darkGradient,
              border: Colors.transparent,
              onTap: () async {
                final made = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const NewTicketScreen()));
                if (made == true) await reload();
              },
              child: Row(children: [
                Container(width: 46, height: 46, decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(14)), child: const Icon(Icons.chat_bubble_outline_rounded, color: IK.g3)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Pill(tr(context, 'REPLIES WITHIN A DAY'), tone: Tone.gold, size: 8.5),
                    const SizedBox(height: 6),
                    Text(tr(context, 'Ask us something'), style: IK.h2(size: 20, color: Colors.white)),
                    Text(tr(context, 'A real person reads every ticket. Tell us what happened and we will pick it up.'), style: IK.body(size: 11.5, color: IK.v2)),
                  ]),
                ),
                const Icon(Icons.arrow_forward_rounded, color: IK.g3),
              ]),
            ),
            const SizedBox(height: 14),
            Segmented(
              items: [('open', '${tr(context, 'Open')} · ${open.length}'), ('done', '${tr(context, 'Resolved')} · ${done.length}')],
              value: _tab,
              onChanged: (v) => setState(() => _tab = v),
            ),
            const SizedBox(height: 12),
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 18),
                child: Text(_tab == 'open' ? tr(context, 'No open tickets.') : tr(context, 'Nothing resolved yet.'), textAlign: TextAlign.center, style: IK.soft(size: 13)),
              )
            else
              for (final t in list)
                IkCard(
                  margin: const EdgeInsets.only(bottom: 10),
                  leftAccent: t['status'] == 'answered' ? IK.g4 : null,
                  onTap: () async {
                    await push(context, TicketScreen(ticketId: '${t['id']}'));
                    await reload();
                  },
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text('${t['number']}', style: IK.monoS(size: 10)),
                      const Spacer(),
                      Text(ago(t['updatedAt']), style: IK.monoS(size: 10)),
                    ]),
                    const SizedBox(height: 4),
                    Text('${t['subject']}', style: IK.strong(size: 14)),
                    if ('${t['lastMessage'] ?? ''}'.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text('${t['lastMessage']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: IK.soft(size: 12)),
                    ],
                    const SizedBox(height: 8),
                    Row(children: [
                      Pill(tr(context, categoryLabel('${t['category']}')), tone: Tone.violet, size: 9),
                      const SizedBox(width: 6),
                      Pill(
                        t['status'] == 'answered' ? tr(context, 'Answered') : (t['status'] == 'closed' ? tr(context, 'Resolved') : tr(context, 'In progress')),
                        tone: t['status'] == 'answered' ? Tone.ok : (t['status'] == 'closed' ? Tone.plain : Tone.gold),
                        size: 9,
                      ),
                      const Spacer(),
                      if (toInt(t['unread']) > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: IK.bad, borderRadius: BorderRadius.circular(10)),
                          child: Text('${t['unread']}', style: IK.strong(size: 10, color: Colors.white)),
                        ),
                    ]),
                  ]),
                ),
            SectionTitle(tr(context, 'Before you write in')),
            IkGroup(children: [
              for (final a in helpArticles)
                IkRow(image: Art.a(a.art), title: tr(context, a.title), sub: tr(context, a.kicker), onTap: () => push(context, HelpArticleScreen(a: a))),
            ]),
          ],
        );
      },
    );
  }
}

class NewTicketScreen extends StatefulWidget {
  const NewTicketScreen({super.key});
  @override
  State<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends State<NewTicketScreen> {
  String _cat = 'general';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  Map<String, String> _errs = {};
  bool _busy = false;

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _errs = {};
    });
    try {
      await Session.read(context).api.post('/v1/tickets', {'subject': _subject.text.trim(), 'body': _body.text.trim(), 'category': _cat});
      if (!mounted) return;
      toast(context, tr(context, 'Sent. We reply within a day.'));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _errs = e.fields);
      if (e.fields.isEmpty && mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return IkPage(
      header: IkHeader(title: tr(context, 'Ask us something'), sub: tr(context, 'A real person reads every ticket'), art: Art.mailIc),
      bottom: BottomBar(child: IkButton(tr(context, 'Send'), icon: Icons.send_rounded, loading: _busy, onPressed: _send)),
      children: [
        Text(tr(context, 'WHAT IS IT ABOUT'), style: IK.label()),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final c in ticketCategories)
            ChoiceChip(
              avatar: Icon(c.$3, size: 16, color: _cat == c.$1 ? Colors.white : IK.v6),
              label: Text(tr(context, c.$2)),
              selected: _cat == c.$1,
              selectedColor: IK.v7,
              showCheckmark: false,
              labelStyle: IK.strong(size: 12, color: _cat == c.$1 ? Colors.white : IK.ink2),
              onSelected: (_) => setState(() => _cat = c.$1),
            ),
        ]),
        const SizedBox(height: 16),
        Field(label: tr(context, 'Subject'), required: true, controller: _subject, error: _errs['subject'], maxLength: 100, capitalization: TextCapitalization.sentences,
            hint: tr(context, 'e.g. I cannot see my invitation')),
        Field(label: tr(context, 'Tell us more'), required: true, controller: _body, error: _errs['body'], lines: 6, maxLength: 2000, capitalization: TextCapitalization.sentences,
            hint: tr(context, 'Which wedding or function, what you expected, and what happened')),
      ],
    );
  }
}

class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.ticketId});
  final String ticketId;
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  final _reply = TextEditingController();
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final api = Session.of(context).api;
    return Loader<Json>(
      load: () async => asJson(await api.get('/v1/tickets/${widget.ticketId}')),
      builder: (context, t, reload) {
        final closed = t['status'] == 'closed';
        Future<void> send() async {
          if (_reply.text.trim().isEmpty) return;
          setState(() => _busy = true);
          final r = await guard(context, () => api.post('/v1/tickets/${widget.ticketId}/messages', {'body': _reply.text.trim()}));
          if (mounted) setState(() => _busy = false);
          if (r != null) {
            _reply.clear();
            await reload();
          }
        }

        return Scaffold(
          backgroundColor: IK.ivory,
          body: IvoryBg(
            child: Column(children: [
              IkHeader(
                title: '${t['subject']}',
                sub: '${t['number']} · ${tr(context, categoryLabel('${t['category']}'))}',
                hang: false,
                actions: [
                  if (!closed)
                    TextButton(
                      onPressed: () async {
                        final ok = await confirmSheet(context, title: tr(context, 'Mark this as resolved?'), confirm: tr(context, 'Resolve'));
                        if (!ok) return;
                        await guard(context, () => api.post('/v1/tickets/${widget.ticketId}/close'));
                        await reload();
                      },
                      child: Text(tr(context, 'Resolve')),
                    ),
                ],
              ),
              Expanded(
                child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 16), children: [
                  for (final m in asList(t['messages']))
                    Align(
                      alignment: m['author'] == 'user' ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .8),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          gradient: m['author'] == 'user' ? IK.btnGradient : null,
                          color: m['author'] == 'user' ? null : Colors.white,
                          border: m['author'] == 'user' ? null : Border.all(color: IK.goldLine),
                          borderRadius: BorderRadius.only(
                            topLeft: const Radius.circular(18),
                            topRight: const Radius.circular(18),
                            bottomLeft: Radius.circular(m['author'] == 'user' ? 18 : 6),
                            bottomRight: Radius.circular(m['author'] == 'user' ? 6 : 18),
                          ),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          if (m['author'] != 'user') Text(tr(context, 'Invite Karoo team'), style: IK.label(size: 9, color: IK.goldInk)),
                          Text('${m['body']}', style: IK.body(size: 13, color: m['author'] == 'user' ? Colors.white : IK.ink2)),
                          const SizedBox(height: 4),
                          Text(ago(m['createdAt']), style: IK.monoS(size: 9.5, color: m['author'] == 'user' ? IK.v2 : IK.ink4)),
                        ]),
                      ),
                    ),
                  if (closed)
                    Padding(padding: const EdgeInsets.only(top: 10), child: Note(tr(context, 'This ticket is resolved. Open a new one if you still need help.'), tone: Tone.ok, icon: Icons.check_circle_outline_rounded)),
                ]),
              ),
              if (!closed)
                BottomBar(
                  child: Row(children: [
                    Expanded(
                      child: TextField(
                        controller: _reply,
                        minLines: 1,
                        maxLines: 4,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(hintText: tr(context, 'Write a reply…')),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(width: 52, height: 52, child: IkButton('', icon: Icons.send_rounded, compact: true, loading: _busy, onPressed: send)),
                  ]),
                ),
            ]),
          ),
        );
      },
    );
  }
}
