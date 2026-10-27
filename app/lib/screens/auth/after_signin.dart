import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'auth_ui.dart';

/// Saves the session, clears the sign-in screens and greets the person.
/// A number that hosts a wedding is asked which side to open first.
Future<void> finishSignIn(BuildContext context, Json r, {bool isNew = false}) async {
  final s = Session.read(context);
  final nav = Navigator.of(context);
  await s.applySignIn(r);
  Push.register(s);
  nav.popUntil((route) => route.isFirst);
  nav.push(MaterialPageRoute(builder: (_) => s.hostAccess == 'granted' ? const RolePickScreen() : WelcomeScreen(isNew: isNew)));
}

class RolePickScreen extends StatefulWidget {
  const RolePickScreen({super.key});
  @override
  State<RolePickScreen> createState() => _RolePickScreenState();
}

class _RolePickScreenState extends State<RolePickScreen> {
  String _pick = 'guest';

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final h = s.activeHosting;
    Widget card(String id, String art, String t, String body, [Widget? extra]) {
      final on = _pick == id;
      return GestureDetector(
        onTap: () => setState(() => _pick = id),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: on ? IK.v0 : Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: on ? IK.v4 : IK.goldLine, width: on ? 2 : 1),
            boxShadow: IK.cardShadow,
          ),
          child: Row(children: [
            ArchArt(asset: art, width: 76, height: 86),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t, style: IK.h2(size: 19)),
                if (extra != null) ...[const SizedBox(height: 4), extra],
                const SizedBox(height: 4),
                Text(body, style: IK.soft(size: 12)),
              ]),
            ),
            const SizedBox(width: 6),
            Icon(on ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, color: on ? IK.v6 : IK.line2, size: 26),
          ]),
        ),
      );
    }

    return AuthScaffold(
      title: tr(context, 'How will you use Invite Karoo?'),
      sub: tr(context, 'This number has both. You can switch any time from your profile.'),
      children: [
        card('guest', Art.family, tr(context, 'Attend'), tr(context, 'Every invitation you have received and your own plans, on one agenda.')),
        card('host', Art.jaimala, tr(context, 'Host a wedding'), tr(context, 'Send invitations, see every reply and run the gift desk.'),
            h == null ? null : Pill('${h['couple']}', tone: Tone.mag)),
        const SizedBox(height: 4),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          const Icon(Icons.info_outline_rounded, size: 14, color: IK.ink4),
          const SizedBox(width: 6),
          Flexible(child: Text(tr(context, 'Hosting never takes you out of the guest side.'), style: IK.soft(size: 11.5))),
        ]),
        const SizedBox(height: 22),
        IkButton(tr(context, 'Continue'), icon: Icons.arrow_forward_rounded, onPressed: () async {
          final nav = Navigator.of(context);
          if (_pick == 'host' && h != null) await s.enterHost('${h['weddingId']}');
          nav.pop();
        }),
      ],
    );
  }
}

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key, this.isNew = false});
  final bool isNew;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Scaffold(
      backgroundColor: IK.ivory,
      body: IvoryBg(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 26),
            child: Column(children: [
              const Spacer(flex: 3),
              Image.asset(Art.rings, height: 170),
              const SizedBox(height: 18),
              Text(tr(context, 'Welcome, {name}', {'name': s.firstName}), textAlign: TextAlign.center, style: IK.title(size: 32)),
              const SizedBox(height: 10),
              Text(
                isNew
                    ? tr(context, 'Your account is ready. Every invitation, reminder and plan of yours now lives in one place.')
                    : tr(context, 'You are signed in. Your invitations and your plans are all waiting.'),
                textAlign: TextAlign.center,
                style: IK.soft(size: 14),
              ),
              const SizedBox(height: 28),
              IkButton(tr(context, 'Open my agenda'), icon: Icons.arrow_forward_rounded, onPressed: () => Navigator.of(context).pop()),
              const Spacer(flex: 4),
              const ShieldLine('Invite Karoo · Every invite matters', icon: Icons.favorite_border_rounded),
              const SizedBox(height: 12),
            ]),
          ),
        ),
      ),
    );
  }
}
