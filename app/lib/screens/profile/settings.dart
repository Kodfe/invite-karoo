import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/art.dart';
import '../../core/config.dart';
import '../../core/l10n.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'about.dart';
import 'edit_profile.dart';
import 'help.dart';
import 'notif_prefs.dart';
import 'privacy.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final prefs = (s.me?['prefs'] as Map?) ?? const {};
    return IkPage(
      header: IkHeader(title: tr(context, 'Settings'), sub: tr(context, 'Your account, alerts, privacy and data'), art: Art.cplSofa),
      children: [
        IkCard(
          onTap: () => push(context, const EditProfileScreen()),
          child: Row(children: [
            Avatar(name: s.fullName, photo: s.me?['photoUrl'] as String?, size: 52, ring: true),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.fullName, style: IK.h2(size: 20)),
                Text('${s.me?['phonePretty'] ?? ''} · ${s.me?['city'] ?? ''}', style: IK.soft(size: 12)),
              ]),
            ),
            const Icon(Icons.chevron_right_rounded, color: IK.ink4),
          ]),
        ),
        SectionTitle(tr(context, 'Account')),
        IkGroup(children: [
          IkRow(icon: Icons.person_outline_rounded, title: tr(context, 'Edit profile'), sub: tr(context, 'Name, family, city and photo'), onTap: () => push(context, const EditProfileScreen())),
          IkRow(image: Art.whatsapp, title: tr(context, 'Mobile number'), sub: '${s.me?['phonePretty'] ?? ''} · ${tr(context, 'your invitations are tied here')}',
              onTap: () => push(context, const ChangeNumberScreen())),
          IkRow(
            icon: Icons.translate_rounded,
            iconColor: IK.info,
            iconBg: IK.infoBg,
            title: tr(context, 'Language'),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [Text(languageName(s.lang), style: IK.soft(size: 12.5)), const Icon(Icons.chevron_right_rounded, color: IK.ink4)]),
            onTap: () => languageSheet(context),
          ),
        ]),
        SectionTitle(tr(context, 'Notifications')),
        IkGroup(children: [
          IkRow(icon: Icons.notifications_active_outlined, iconColor: IK.g6, iconBg: IK.g1, title: tr(context, 'Notification preferences'),
              sub: tr(context, 'WhatsApp and app · reminders before each function'), onTap: () => push(context, const NotifPrefsScreen())),
          IkRow(
            icon: Icons.bedtime_outlined,
            iconColor: IK.v6,
            title: tr(context, 'Pause all reminders'),
            sub: tr(context, 'For a few quiet days. Invitations still arrive.'),
            trailing: Switch.adaptive(
              value: prefs['pause'] == true,
              activeTrackColor: IK.ok,
              onChanged: (v) => savePrefs(context, {'pause': v}),
            ),
          ),
        ]),
        SectionTitle(tr(context, 'Privacy and data')),
        IkGroup(children: [
          IkRow(icon: Icons.shield_outlined, iconColor: IK.ok, iconBg: IK.okBg, title: tr(context, 'Privacy'), sub: tr(context, 'What we keep, and who sees it'), onTap: () => push(context, const PrivacyScreen())),
          IkRow(icon: Icons.download_outlined, title: tr(context, 'Download my data'), sub: tr(context, 'Everything we hold about you, in one file'), onTap: () => downloadData(context)),
          IkRow(icon: Icons.delete_forever_outlined, iconColor: IK.bad, iconBg: IK.badBg, title: tr(context, 'Delete my account'), titleColor: IK.bad, onTap: () => deleteAccount(context)),
        ]),
        SectionTitle(tr(context, 'About')),
        IkGroup(children: [
          IkRow(icon: Icons.help_outline_rounded, title: tr(context, 'Help'), sub: tr(context, 'Answers to the common questions'), onTap: () => push(context, const HelpScreen())),
          IkRow(icon: Icons.info_outline_rounded, title: tr(context, 'About Invite Karoo'), sub: 'Version ${Config.appVersion}', onTap: () => push(context, const AboutScreen())),
        ]),
      ],
    );
  }
}

Future<void> savePrefs(BuildContext context, Map<String, dynamic> patch) async {
  final s = Session.read(context);
  final old = Map<String, dynamic>.from((s.me?['prefs'] as Map?) ?? const {});
  // show the change at once; roll back if the server says no
  s.updateMe({...?s.me, 'prefs': {...old, ...patch}});
  final r = await guard(context, () => s.api.patch('/v1/me/prefs', patch));
  if (r == null) s.updateMe({...?s.me, 'prefs': old});
}

Future<void> languageSheet(BuildContext context) async {
  final s = Session.read(context);
  final pick = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(trIn(s.lang, 'Language'), style: IK.title(size: 24)),
        const SizedBox(height: 8),
        for (final l in languages)
          ListTile(
            title: Text(l.$2, style: IK.strong(size: 16)),
            trailing: l.$1 == s.lang ? const Icon(Icons.check_circle_rounded, color: IK.v6) : null,
            onTap: () => Navigator.pop(ctx, l.$1),
          ),
        const SizedBox(height: 10),
      ]),
    ),
  );
  if (pick != null) await s.setLang(pick);
}

Future<void> downloadData(BuildContext context) async {
  final s = Session.read(context);
  final data = await guard(context, () => s.api.get('/v1/me/export'));
  if (data == null) return;
  final dir = await getTemporaryDirectory();
  final f = File('${dir.path}/invite-karoo-my-data.json');
  await f.writeAsString(const JsonEncoder.withIndent('  ').convert(data));
  await SharePlus.instance.share(ShareParams(files: [XFile(f.path)], subject: 'Invite Karoo · my data'));
}

Future<void> deleteAccount(BuildContext context) async {
  final s = Session.read(context);
  final ok = await confirmSheet(
    context,
    title: tr(context, 'Delete your account?'),
    body: tr(context, 'Your profile, your own events and your notifications are deleted for good. Hosts keep their guest lists, but nothing links them to you any more.'),
    confirm: tr(context, 'Delete for good'),
    danger: true,
    art: Art.hourglass,
  );
  if (!ok || !context.mounted) return;
  await Push.unregister(s);
  final r = await guard(context, () => s.api.delete('/v1/me', {'confirm': 'DELETE'}));
  if (r == null) return;
  if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  await s.forget();
}

Future<void> openUrl(String url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
