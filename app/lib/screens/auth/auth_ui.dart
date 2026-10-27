import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';

const countries = [
  ('+91', '🇮🇳', 10),
  ('+971', '🇦🇪', 9),
  ('+44', '🇬🇧', 10),
  ('+1', '🇺🇸', 10),
  ('+65', '🇸🇬', 8),
  ('+61', '🇦🇺', 9),
  ('+974', '🇶🇦', 8),
  ('+966', '🇸🇦', 9),
];

int lengthFor(String cc) => countries.firstWhere((c) => c.$1 == cc, orElse: () => countries.first).$3;

/// The light, warm sign-in frame: ivory paper, a string of gold diyas in the corner,
/// the brand, a title, and one wedding illustration standing in a jharokha arch.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({super.key, required this.title, this.sub, this.art, this.back = false, this.step, required this.children, this.bottom});
  final String title;
  final String? sub;
  final String? art;
  final bool back;
  final String? step;
  final List<Widget> children;
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: IK.ivory,
        resizeToAvoidBottomInset: true,
        bottomNavigationBar: bottom,
        body: IvoryBg(
          child: Stack(children: [
            Positioned(top: -4, right: 6, child: IgnorePointer(child: Opacity(opacity: .9, child: Image.asset(Art.diyas, height: 96)))),
            ListView(
              padding: EdgeInsets.fromLTRB(20, top + 14, 20, 28),
              physics: const BouncingScrollPhysics(),
              children: [
                SizedBox(
                  height: 40,
                  child: Row(children: [
                    if (back)
                      SquareBtn(icon: Icons.arrow_back_rounded, onTap: () => Navigator.of(context).maybePop())
                    else ...[
                      Image.asset(Art.logo, width: 30, height: 30),
                      const SizedBox(width: 8),
                      const Text.rich(TextSpan(children: [
                        TextSpan(text: 'Invite ', style: TextStyle(color: IK.plum)),
                        TextSpan(text: 'Karoo', style: TextStyle(color: IK.goldInk)),
                      ]), style: TextStyle(fontFamily: IK.display, fontSize: 16, fontWeight: FontWeight.w700)),
                    ],
                    const Spacer(),
                    if (step != null) Padding(padding: const EdgeInsets.only(right: 80), child: Text(step!, style: IK.monoS(size: 11))),
                  ]),
                ),
                const SizedBox(height: 22),
                Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(title, style: IK.title(size: 30)),
                      if (sub != null) ...[const SizedBox(height: 8), Text(sub!, style: IK.soft(size: 13))],
                    ]),
                  ),
                  if (art != null) ...[const SizedBox(width: 12), ArchArt(asset: art!, width: 96, height: 112)],
                ]),
                const SizedBox(height: 22),
                ...children,
              ],
            ),
          ]),
        ),
      ),
    );
  }
}

/// the white card that holds a form on the sign-in screens
class AuthCard extends StatelessWidget {
  const AuthCard({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .94),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: IK.goldLine),
          boxShadow: IK.cardShadow,
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
}

/// country code + mobile number, one box
class PhoneField extends StatelessWidget {
  const PhoneField({super.key, required this.cc, required this.controller, required this.onCc, this.error, this.label = 'Mobile number', this.onSubmit});
  final String cc;
  final TextEditingController controller;
  final ValueChanged<String> onCc;
  final String? error;
  final String label;
  final VoidCallback? onSubmit;

  @override
  Widget build(BuildContext context) {
    final flag = countries.firstWhere((c) => c.$1 == cc, orElse: () => countries.first).$2;
    final bad = error != null;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
        decoration: BoxDecoration(
          color: bad ? IK.badBg : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: bad ? IK.badLine : IK.line, width: 1.5),
        ),
        child: Row(children: [
          const Icon(Icons.phone_rounded, size: 18, color: IK.ink4),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr(context, label), style: IK.soft(size: 10.5).copyWith(fontWeight: FontWeight.w700)),
              Row(children: [
                PopupMenuButton<String>(
                  onSelected: onCc,
                  itemBuilder: (_) => [for (final c in countries) PopupMenuItem(value: c.$1, child: Text('${c.$2}  ${c.$1}'))],
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text('$flag $cc', style: IK.strong(size: 15)),
                  ),
                ),
                Container(width: 1, height: 22, margin: const EdgeInsets.symmetric(horizontal: 10), color: IK.line2),
                Expanded(
                  child: TextField(
                    controller: controller,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => onSubmit?.call(),
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(lengthFor(cc) + 1)],
                    style: IK.monoS(size: 17, color: IK.ink, weight: FontWeight.w500).copyWith(letterSpacing: 1),
                    decoration: const InputDecoration(
                      isDense: true,
                      filled: false,
                      hintText: '98765 43210',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(vertical: 6),
                    ),
                  ),
                ),
              ]),
            ]),
          ),
        ]),
      ),
      if (bad)
        Padding(
          padding: const EdgeInsets.only(top: 6, left: 4),
          child: Row(children: [
            const Icon(Icons.error_outline_rounded, size: 14, color: IK.bad),
            const SizedBox(width: 5),
            Expanded(child: Text(error!, style: IK.body(size: 11.5, color: IK.bad, weight: FontWeight.w600))),
          ]),
        ),
    ]);
  }
}

class WaNote extends StatelessWidget {
  const WaNote(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Image.asset(Art.whatsapp, width: 18, height: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: IK.body(size: 12, color: const Color(0xFF15803D), weight: FontWeight.w600))),
        ]),
      );
}

class WaButton extends StatelessWidget {
  const WaButton({super.key, required this.label, required this.onPressed, this.loading = false});
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  @override
  Widget build(BuildContext context) => IkButton(
        label,
        kind: BtnKind.dark,
        loading: loading,
        onPressed: onPressed,
        leading: Image.asset(Art.whatsappWhite, width: 20, height: 20),
      );
}

class ShieldLine extends StatelessWidget {
  const ShieldLine(this.text, {super.key, this.icon = Icons.shield_outlined});
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 18),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 14, color: IK.ink4),
          const SizedBox(width: 6),
          Flexible(child: Text(text, textAlign: TextAlign.center, style: IK.soft(size: 11.5))),
        ]),
      );
}
