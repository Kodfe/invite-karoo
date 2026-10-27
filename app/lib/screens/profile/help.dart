import 'package:flutter/material.dart';

import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../guest/event_log.dart';
import '../guest/invites.dart';
import 'notif_prefs.dart';
import 'support.dart';

class HelpArticle {
  const HelpArticle(this.id, this.title, this.kicker, this.art, this.intro, this.steps, this.cta, this.open);
  final String id;
  final String title;
  final String kicker;
  final String art;
  final String intro;
  final List<(String, String)> steps;
  final String cta;
  final Widget Function() open;
}

final helpArticles = [
  HelpArticle('remind', 'Reminders not arriving', 'Reminders', 'cal3d', 'Most missed reminders come down to one of four things. Check them in this order.', const [
    ('WhatsApp is on this number', 'Reminders go to the number you signed in with. If your WhatsApp runs on another number, ask us to move your account.'),
    ('Reminders are not paused', 'A pause in Settings stops every reminder until you turn it off.'),
    ('Quiet hours are not in the way', 'Anything due inside quiet hours waits until they end.'),
    ('Your phone allows Invite Karoo', 'Check that notifications for Invite Karoo are switched on in your phone’s settings.'),
  ], 'Open notification preferences', () => const NotifPrefsScreen()),
  HelpArticle('moved', 'The hosts moved a function', 'Invitations', 'hourglass', 'Your reminders move with it automatically. There is nothing for you to reset.', const [
    ('You are told straight away', 'A change notice arrives showing the new time.'),
    ('Every reminder moves too', 'The app’s own and any you added yourself are rebuilt around the new time.'),
    ('Your reply stays as it was', 'If the new time does not suit you, open the function and change your reply.'),
  ], 'Open my invitations', () => const InvitesScreen()),
  HelpArticle('scan', 'The scan read my card wrong', 'Your events', 'aiBox', 'A scan saves an ordinary event you can edit like any other. Fix it in a few taps.', const [
    ('Open your event log', 'Every event you scanned or typed in is listed there.'),
    ('Tap Edit on the event', 'Change the name, date, time or venue — each function has its own fields.'),
    ('Save it', 'Your reminders are rebuilt around the corrected time.'),
    ('Next time, scan in good light', 'Lay the card flat and keep the whole card inside the frame.'),
  ], 'Open my event log', () => const EventLogScreen()),
];

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});
  @override
  Widget build(BuildContext context) => IkPage(
        header: IkHeader(title: tr(context, 'Help'), sub: tr(context, 'Answers to the common questions'), art: Art.lanterns),
        children: [
          IkGroup(children: [
            for (final a in helpArticles)
              IkRow(image: Art.a(a.art), title: tr(context, a.title), sub: tr(context, a.kicker), onTap: () => push(context, HelpArticleScreen(a: a))),
          ]),
          const SizedBox(height: 14),
          IkButton(tr(context, 'Still stuck? Ask us'), kind: BtnKind.ghost, icon: Icons.chat_bubble_outline_rounded, onPressed: () => push(context, const SupportScreen())),
        ],
      );
}

class HelpArticleScreen extends StatefulWidget {
  const HelpArticleScreen({super.key, required this.a});
  final HelpArticle a;
  @override
  State<HelpArticleScreen> createState() => _HelpArticleScreenState();
}

class _HelpArticleScreenState extends State<HelpArticleScreen> {
  bool? _vote;

  @override
  Widget build(BuildContext context) {
    final a = widget.a;
    return IkPage(
      header: IkHeader(title: tr(context, a.title), sub: '${tr(context, 'Help')} · ${tr(context, a.kicker)}', art: Art.a(a.art)),
      children: [
        Text(tr(context, a.intro), style: IK.soft(size: 13.5)),
        const SizedBox(height: 14),
        IkGroup(children: [
          for (var i = 0; i < a.steps.length; i++)
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(shape: BoxShape.circle, gradient: IK.goldGradient),
                  child: Text('${i + 1}', style: IK.strong(size: 13, color: IK.v9)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr(context, a.steps[i].$1), style: IK.strong(size: 14)),
                    const SizedBox(height: 3),
                    Text(tr(context, a.steps[i].$2), style: IK.soft(size: 12.5)),
                  ]),
                ),
              ]),
            ),
        ]),
        const SizedBox(height: 16),
        IkButton(tr(context, a.cta), icon: Icons.arrow_forward_rounded, onPressed: () => push(context, a.open())),
        const SizedBox(height: 16),
        IkCard(
          child: Row(children: [
            Expanded(child: Text(_vote == null ? tr(context, 'Did this help?') : tr(context, 'Thank you for telling us.'), style: IK.strong(size: 14))),
            if (_vote == null) ...[
              TextButton(onPressed: () => setState(() => _vote = true), child: Text(tr(context, 'Yes'))),
              TextButton(onPressed: () => setState(() => _vote = false), child: Text(tr(context, 'No'))),
            ],
          ]),
        ),
        const SizedBox(height: 10),
        Center(child: LinkText(tr(context, 'Still stuck? Ask us'), onTap: () => push(context, const SupportScreen()))),
      ],
    );
  }
}
