import 'package:flutter/material.dart';

import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';

/// Community programmes are not in this version; the search bar and the tab land here.
class CommunitiesScreen extends StatelessWidget {
  const CommunitiesScreen({super.key, this.asTab = false});
  final bool asTab;

  @override
  Widget build(BuildContext context) {
    Widget feat(String art, String t, String sub, int n) => IkRow(image: art, title: tr(context, t), sub: tr(context, sub), trailing: Text('0$n', style: IK.monoS(size: 11)));
    return IkPage(
      header: IkHeader(back: !asTab, title: tr(context, 'Communities'), sub: tr(context, 'Satsang, pravachan, garba and samaj gatherings'), art: Art.chhatri),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 22),
          decoration: BoxDecoration(
            gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF3B1F73), Color(0xFF1A0B36)]),
            borderRadius: BorderRadius.circular(24),
            boxShadow: IK.sh3,
          ),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Image.asset(Art.chhatri, height: 60), Image.asset(Art.lotus, height: 40)]),
            Image.asset(Art.instruments, height: 130),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              decoration: BoxDecoration(gradient: IK.goldGradient, borderRadius: BorderRadius.circular(20)),
              child: Text(tr(context, 'COMING SOON'), style: IK.label(size: 10.5, color: IK.v9)),
            ),
            const SizedBox(height: 12),
            Text(tr(context, 'Something beautiful is on its way'), textAlign: TextAlign.center, style: IK.kicker(size: 22, color: IK.g3)),
            const SizedBox(height: 6),
            Text(tr(context, 'Community programmes are coming soon'), textAlign: TextAlign.center, style: IK.title(size: 28, color: Colors.white)),
            const SizedBox(height: 10),
            Text(
              tr(context, 'Satsangs, pravachans, garba nights and samaj meets — follow your community once and every programme lands on your agenda, reminders already set.'),
              textAlign: TextAlign.center,
              style: IK.body(size: 12.5, color: IK.v2),
            ),
          ]),
        ),
        SectionTitle(tr(context, 'What is coming')),
        IkGroup(children: [
          feat(Art.cal3d, 'Every programme, day by day', 'The full schedule of each edition, straight on your agenda.', 1),
          feat(Art.bells, 'Reminders set for you', 'Before every programme, with nothing for you to set up.', 2),
          feat(Art.lotus, 'Follow once, every edition', 'Your community keeps reaching you, wherever it gathers next.', 3),
          feat(Art.mapsPin, 'Search by guru, venue or area', 'Find the gatherings that matter to your family.', 4),
        ]),
      ],
    );
  }
}
