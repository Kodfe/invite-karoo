import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'signup.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pc = PageController();
  int _i = 0;

  static final _slides = [
    (Art.jaimala, 'Invite with love', 'Your wedding invites, sent in one go', 'Add every function once — your whole guest list gets the invite on WhatsApp.'),
    (Art.a('cplDance'), 'Never miss a ritual', 'Reminders for every function', 'Haldi, Sangeet, Wedding — remind exactly the right guests, in one click.'),
    (Art.cplBengali, 'Plans made simple', 'Just scan it & save it', 'Invite Karoo AI reads the card and saves every function for you.'),
  ];

  Future<void> _finish({bool signup = false}) async {
    final s = Session.read(context);
    await s.setOnboarded();
    if (!mounted) return;
    // Root now shows the sign-in screen; a new person goes straight on to create an account
    if (signup) push(context, const SignupScreen());
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final last = _i == _slides.length - 1;
    final slide = _slides[_i];
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: IK.ivory,
        body: IvoryBg(
          child: Column(children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, top + 12, 16, 0),
              child: Row(children: [
                Image.asset(Art.logo, width: 30, height: 30),
                const SizedBox(width: 8),
                const Text.rich(
                  TextSpan(children: [TextSpan(text: 'Invite ', style: TextStyle(color: IK.plum)), TextSpan(text: 'Karoo', style: TextStyle(color: IK.goldInk))]),
                  style: TextStyle(fontFamily: IK.display, fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                if (!last)
                  TextButton(
                    onPressed: () => _pc.animateToPage(_slides.length - 1, duration: const Duration(milliseconds: 400), curve: Curves.easeOutCubic),
                    style: TextButton.styleFrom(backgroundColor: Colors.white, shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 16)),
                    child: Text(tr(context, 'Skip'), style: IK.strong(size: 13, color: IK.v7)),
                  ),
              ]),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pc,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _i = i),
                itemBuilder: (context, i) => Padding(
                  padding: const EdgeInsets.fromLTRB(28, 18, 28, 8),
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(200), bottom: Radius.circular(24)),
                      border: Border.all(color: IK.gold.withValues(alpha: .55), width: 1.4),
                      gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF1E8FF), Color(0xFFFFF0F4)]),
                      boxShadow: [BoxShadow(color: IK.gold.withValues(alpha: .25), blurRadius: 30, spreadRadius: -10, offset: const Offset(0, 16))],
                    ),
                    padding: const EdgeInsets.fromLTRB(12, 30, 12, 0),
                    child: Image.asset(_slides[i].$1, fit: BoxFit.contain, alignment: Alignment.bottomCenter),
                  ),
                ),
              ),
            ),
            Container(
              margin: EdgeInsets.fromLTRB(16, 4, 16, 16 + MediaQuery.paddingOf(context).bottom),
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 16),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .92),
                borderRadius: BorderRadius.circular(26),
                border: Border.all(color: IK.goldLine),
                boxShadow: IK.cardShadow,
              ),
              child: Column(children: [
                Text(tr(context, slide.$2), style: IK.kicker(size: 21)),
                const SizedBox(height: 4),
                Text(tr(context, slide.$3), textAlign: TextAlign.center, style: IK.title(size: 27)),
                const SizedBox(height: 10),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Container(width: 40, height: 1, color: IK.gold.withValues(alpha: .5)),
                  const Padding(padding: EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.local_florist_rounded, size: 12, color: IK.gold)),
                  Container(width: 40, height: 1, color: IK.gold.withValues(alpha: .5)),
                ]),
                const SizedBox(height: 10),
                Text(tr(context, slide.$4), textAlign: TextAlign.center, style: IK.soft(size: 13)),
                const SizedBox(height: 14),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  for (var n = 0; n < _slides.length; n++)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: n == _i ? 22 : 7,
                      height: 7,
                      decoration: BoxDecoration(color: n == _i ? IK.v6 : IK.v2, borderRadius: BorderRadius.circular(4)),
                    ),
                ]),
                const SizedBox(height: 16),
                if (last) ...[
                  IkButton(tr(context, 'Get started'), icon: Icons.arrow_forward_rounded, onPressed: () => _finish(signup: true)),
                  const SizedBox(height: 4),
                  LinkText(tr(context, 'I already have an account'), onTap: () => _finish()),
                ] else
                  IkButton(tr(context, 'Next'),
                      icon: Icons.arrow_forward_rounded,
                      onPressed: () => _pc.nextPage(duration: const Duration(milliseconds: 380), curve: Curves.easeOutCubic)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
