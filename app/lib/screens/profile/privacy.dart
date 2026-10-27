import 'package:flutter/material.dart';

import '../../core/art.dart';
import '../../core/config.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'settings.dart';

class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  Future<void> _set(BuildContext context, String k, bool v) async {
    final s = Session.read(context);
    final old = Map<String, dynamic>.from((s.me?['privacy'] as Map?) ?? const {});
    s.updateMe({...?s.me, 'privacy': {...old, k: v}});
    final r = await guard(context, () => s.api.patch('/v1/me/privacy', {k: v}));
    if (r == null) s.updateMe({...?s.me, 'privacy': old});
  }

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final p = (s.me?['privacy'] as Map?) ?? const {};
    Widget chips(List<String> items, {Tone tone = Tone.violet}) => Wrap(spacing: 6, runSpacing: 6, children: [
          for (final i in items) Pill(tr(context, i), tone: tone, icon: tone == Tone.violet ? Icons.check_rounded : Icons.close_rounded),
        ]);
    Widget who(IconData icon, String title, Widget body) => Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(width: 40, height: 40, decoration: BoxDecoration(color: IK.v1, borderRadius: BorderRadius.circular(13)), child: Icon(icon, color: IK.v6, size: 19)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: IK.strong(size: 14)), const SizedBox(height: 8), body])),
          ]),
        );
    return IkPage(
      header: IkHeader(title: tr(context, 'Privacy'), sub: tr(context, 'What we keep, and who sees it'), art: Art.mandap),
      children: [
        IkCard(
          gradient: IK.darkGradient,
          border: Colors.transparent,
          child: Row(children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(gradient: IK.goldGradient, borderRadius: BorderRadius.circular(14)),
              child: const Icon(Icons.shield_rounded, color: IK.v9),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr(context, 'Your number stays yours'), style: IK.h2(size: 20, color: Colors.white)),
                const SizedBox(height: 4),
                Text(tr(context, 'Other guests never see your number, your reply or which functions you are going to.'), style: IK.body(size: 12, color: IK.v2)),
              ]),
            ),
          ]),
        ),
        SectionTitle(tr(context, 'Who sees what')),
        IkGroup(children: [
          who(Icons.favorite_border_rounded, tr(context, 'The family that invited you'), chips(['Your name', 'Your city', 'Your reply', 'Headcount', 'When you open it'])),
          who(Icons.groups_outlined, tr(context, 'Other guests'), chips(['Nothing about you'], tone: Tone.gold)),
          who(Icons.verified_user_outlined, tr(context, 'The Invite Karoo team'), chips(['Your account', 'Tickets you raise'])),
        ]),
        SectionTitle(tr(context, 'Your controls')),
        IkGroup(children: [
          IkRow(
            icon: Icons.location_on_outlined,
            title: tr(context, 'Show my city to hosts'),
            sub: tr(context, 'Helps a family tell two guests with the same name apart'),
            trailing: Switch.adaptive(value: p['city'] != false, activeTrackColor: IK.ok, onChanged: (v) => _set(context, 'city', v)),
          ),
          IkRow(
            icon: Icons.visibility_outlined,
            title: tr(context, 'Let hosts see when I opened it'),
            sub: tr(context, 'So they know the invitation reached you'),
            trailing: Switch.adaptive(value: p['seen'] != false, activeTrackColor: IK.ok, onChanged: (v) => _set(context, 'seen', v)),
          ),
        ]),
        SectionTitle(tr(context, 'More')),
        IkGroup(children: [
          IkRow(icon: Icons.policy_outlined, title: tr(context, 'Privacy policy'), onTap: () => openUrl(Config.privacyUrl)),
          IkRow(icon: Icons.download_outlined, title: tr(context, 'Download my data'), onTap: () => downloadData(context)),
          IkRow(icon: Icons.delete_forever_outlined, iconColor: IK.bad, iconBg: IK.badBg, title: tr(context, 'Delete my account'), titleColor: IK.bad, onTap: () => deleteAccount(context)),
        ]),
      ],
    );
  }
}
