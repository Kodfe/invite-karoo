import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/art.dart';
import '../../core/config.dart';
import '../../core/l10n.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'privacy.dart';
import 'settings.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const news = [
      'Every wedding you are invited to, in one list',
      'Reply to each function on its own — Haldi, Sangeet, Reception',
      'Scan a printed card and the AI saves every function',
      'Reminders that move when the hosts move a function',
      'Community programmes are on the way',
    ];
    return IkPage(
      header: IkHeader(title: tr(context, 'About'), sub: tr(context, 'Invite Karoo for guests'), art: Art.gathbandhan),
      children: [
        Center(
          child: Column(children: [
            Container(
              width: 130,
              height: 150,
              decoration: BoxDecoration(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(70), bottom: Radius.circular(20)),
                border: Border.all(color: IK.gold.withValues(alpha: .6), width: 1.4),
                gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF4ECFF), Color(0xFFFFEFF4)]),
              ),
              padding: const EdgeInsets.all(18),
              child: Image.asset(Art.logo),
            ),
            const SizedBox(height: 14),
            Text('Invite Karoo', style: IK.title(size: 32)),
            Text(tr(context, 'Every invite matters'), style: IK.kicker(size: 22)),
            const SizedBox(height: 8),
            Pill('Version ${Config.appVersion}', tone: Tone.plain, icon: Icons.auto_awesome_rounded),
          ]),
        ),
        SectionTitle(tr(context, 'In this version')),
        IkGroup(children: [for (final n in news) IkRow(icon: Icons.check_rounded, iconColor: IK.ok, iconBg: IK.okBg, title: tr(context, n))]),
        SectionTitle(tr(context, 'More')),
        IkGroup(children: [
          IkRow(
            icon: Icons.share_outlined,
            iconColor: IK.mag,
            iconBg: IK.magBg,
            title: tr(context, 'Share with family'),
            sub: tr(context, 'Send the app to someone on your guest list'),
            onTap: () => SharePlus.instance.share(ShareParams(text: tr(context, 'I use Invite Karoo for every wedding invitation and function. Try it: https://invitekaroo.com'))),
          ),
          IkRow(icon: Icons.description_outlined, title: tr(context, 'Terms of use'), onTap: () => openUrl(Config.termsUrl)),
          IkRow(icon: Icons.shield_outlined, iconColor: IK.ok, iconBg: IK.okBg, title: tr(context, 'Privacy'), onTap: () => push(context, const PrivacyScreen())),
          IkRow(icon: Icons.layers_outlined, iconColor: IK.info, iconBg: IK.infoBg, title: tr(context, 'Fonts and licences'), sub: tr(context, 'The open-source work this app is built on'),
              onTap: () => showLicensePage(context: context, applicationName: 'Invite Karoo', applicationVersion: Config.appVersion)),
        ]),
        const SizedBox(height: 20),
        Center(child: Text(tr(context, 'Made with love in India · © 2026 Invite Karoo'), style: IK.soft(size: 11.5))),
      ],
    );
  }
}
