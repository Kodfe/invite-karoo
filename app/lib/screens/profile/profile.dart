import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../guest/event_log.dart';
import '../guest/invites.dart';
import '../guest/notifications.dart';
import 'edit_profile.dart';
import 'host_apply.dart';
import 'settings.dart';
import 'support.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final me = s.me ?? const {};
    final counts = (me['counts'] as Map?) ?? const {};
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: IK.ivory,
        body: RefreshIndicator(
          onRefresh: () => s.refreshMe(),
          child: ListView(padding: EdgeInsets.zero, physics: const AlwaysScrollableScrollPhysics(), children: [
            Stack(clipBehavior: Clip.none, children: [
              Container(
                height: 300 + top,
                decoration: const BoxDecoration(color: Color(0xFF2C1558), borderRadius: BorderRadius.vertical(bottom: Radius.circular(30))),
                clipBehavior: Clip.antiAlias,
                child: Stack(fit: StackFit.expand, children: [
                  Opacity(opacity: .35, child: Image.asset(Art.homeHeader, fit: BoxFit.cover)),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [const Color(0xFF2C1558).withValues(alpha: .6), const Color(0xFF1A0B36)]),
                    ),
                  ),
                ]),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(16, top + 10, 16, 0),
                child: Column(children: [
                  Row(children: [
                    const SizedBox(width: 40),
                    Expanded(child: Center(child: Text(tr(context, 'MY PROFILE'), style: IK.label(size: 11, color: IK.v2)))),
                    SquareBtn(icon: Icons.notifications_none_rounded, dark: true, badge: s.unread, onTap: () => push(context, const NotificationsScreen())),
                    const SizedBox(width: 8),
                    SquareBtn(icon: Icons.settings_outlined, dark: true, onTap: () => push(context, const SettingsScreen())),
                  ]),
                  const SizedBox(height: 14),
                  GestureDetector(
                    onTap: () => push(context, const EditProfileScreen()),
                    child: Stack(children: [
                      Avatar(name: s.fullName, photo: me['photoUrl'] as String?, size: 96, ring: true),
                      Positioned(
                        right: 0,
                        bottom: 4,
                        child: Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(color: IK.g4, shape: BoxShape.circle, border: Border.all(color: IK.v9, width: 2)),
                          child: const Icon(Icons.edit_rounded, size: 14, color: IK.v9),
                        ),
                      ),
                    ]),
                  ),
                  const SizedBox(height: 10),
                  Text(s.fullName, style: IK.title(size: 28, color: Colors.white)),
                  const SizedBox(height: 8),
                  Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
                    _DarkPill(icon: Icons.phone_rounded, text: '${me['phonePretty'] ?? ''}', badge: tr(context, 'Verified')),
                    if ('${me['city'] ?? ''}'.isNotEmpty) _DarkPill(icon: Icons.location_on_outlined, text: '${me['city']}'),
                    if (s.hostAccess == 'granted') _DarkPill(icon: Icons.favorite_rounded, text: tr(context, 'Wedding host')),
                  ]),
                ]),
              ),
              Positioned(
                left: 16,
                right: 16,
                top: 260 + top,
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(color: IK.ivory, borderRadius: BorderRadius.circular(22), border: Border.all(color: IK.goldLine), boxShadow: IK.sh3),
                  child: Row(children: [
                    _Stat(art: Art.rings, n: '${counts['functionsInvited'] ?? 0}', label: tr(context, 'Functions')),
                    _Stat(art: Art.calPurple, n: '${counts['ownEvents'] ?? 0}', label: tr(context, 'My events')),
                    _Stat(art: Art.mailIc, n: '${counts['unreadNotifications'] ?? 0}', label: tr(context, 'Unread')),
                  ]),
                ),
              ),
            ]),
            const SizedBox(height: 70),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 30),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (s.hosting.isNotEmpty) ...[
                  Segmented(
                    items: [('guest', tr(context, 'Attending')), ('host', tr(context, 'Hosting'))],
                    value: 'guest',
                    onChanged: (v) {
                      if (v == 'host') {
                        if (s.hosting.length == 1) {
                          s.enterHost('${s.hosting.first['weddingId']}');
                        } else {
                          _pickWedding(context, s);
                        }
                      }
                    },
                  ),
                  const SizedBox(height: 6),
                ],
                _Label(tr(context, 'MY ACTIVITY')),
                IkGroup(children: [
                  IkRow(image: Art.mailIc, title: tr(context, 'Your invitations'), sub: tr(context, 'Every wedding you are invited to'), onTap: () => push(context, const InvitesScreen())),
                  IkRow(image: Art.cal3d, title: tr(context, 'Event log'), sub: tr(context, 'Everything you added, ready to edit'), onTap: () => push(context, const EventLogScreen())),
                ]),
                _Label(tr(context, 'HOSTING')),
                IkGroup(children: [
                  if (s.hostAccess == 'granted')
                    for (final h in s.hosting)
                      IkRow(
                        image: Art.jaimala,
                        title: '${h['couple']}',
                        sub: '${span(h['startDate'], h['endDate'])} · ${h['role'] == 'owner' ? tr(context, 'Owner') : (h['role'] == 'giftdesk' ? tr(context, 'Gift desk') : tr(context, 'Family'))}',
                        onTap: () => s.enterHost('${h['weddingId']}'),
                      )
                  else
                    IkRow(
                      image: Art.jaimala,
                      title: s.hostAccess == 'pending' ? tr(context, 'Your application is with our team') : tr(context, 'Host a wedding'),
                      sub: s.hostAccess == 'pending' ? tr(context, 'We will message you on WhatsApp') : tr(context, 'We set the whole wedding up for you'),
                      onTap: () => push(context, const HostApplyScreen()),
                    ),
                ]),
                _Label(tr(context, 'ACCOUNT')),
                IkGroup(children: [
                  IkRow(icon: Icons.person_outline_rounded, title: tr(context, 'Edit profile'), sub: tr(context, 'Name, family, city and photo'), onTap: () => push(context, const EditProfileScreen())),
                  IkRow(icon: Icons.settings_outlined, title: tr(context, 'Settings'), sub: tr(context, 'Alerts, language, privacy and data'), onTap: () => push(context, const SettingsScreen())),
                  IkRow(icon: Icons.support_agent_rounded, iconColor: IK.ok, iconBg: IK.okBg, title: tr(context, 'Help and support'), sub: tr(context, 'A real person reads every ticket'), onTap: () => push(context, const SupportScreen())),
                ]),
                const SizedBox(height: 16),
                IkButton(tr(context, 'Sign out'), kind: BtnKind.ghost, icon: Icons.logout_rounded, onPressed: () async {
                  final ok = await confirmSheet(context, title: tr(context, 'Sign out?'), body: tr(context, 'Your invitations stay safe. Sign in again with your number any time.'), confirm: tr(context, 'Sign out'), danger: true);
                  if (!ok) return;
                  await Push.unregister(s);
                  await s.signOut();
                }),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _pickWedding(BuildContext context, Session s) async {
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final h in s.hosting)
            ListTile(
              leading: Image.asset(Art.jaimala, width: 40),
              title: Text('${h['couple']}', style: IK.h2(size: 18)),
              subtitle: Text(span(h['startDate'], h['endDate'])),
              onTap: () => Navigator.pop(ctx, '${h['weddingId']}'),
            ),
        ]),
      ),
    );
    if (id != null) s.enterHost(id);
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.fromLTRB(4, 18, 4, 8), child: Text(text, style: IK.label(size: 10.5)));
}

class _Stat extends StatelessWidget {
  const _Stat({required this.art, required this.n, required this.label});
  final String art;
  final String n;
  final String label;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Image.asset(art, height: 30),
          const SizedBox(height: 4),
          Text(n, style: IK.title(size: 24)),
          Text(label, style: IK.soft(size: 11).copyWith(fontWeight: FontWeight.w700)),
        ]),
      );
}

class _DarkPill extends StatelessWidget {
  const _DarkPill({required this.icon, required this.text, this.badge});
  final IconData icon;
  final String text;
  final String? badge;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: .1), borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.white24)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 13, color: IK.g3),
          const SizedBox(width: 5),
          Text(text, style: IK.strong(size: 11.5, color: Colors.white)),
          if (badge != null) ...[const SizedBox(width: 6), Pill(badge!, tone: Tone.ok, size: 8.5)],
        ]),
      );
}
