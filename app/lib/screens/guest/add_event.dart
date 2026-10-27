import 'package:flutter/material.dart';

import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'ai_scan.dart';
import 'manual.dart';

/// Anything of the guest's own — a wedding they were invited to on paper, a clinic visit, a trip.
class AddEventScreen extends StatelessWidget {
  const AddEventScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Widget kind(String type, String asset, String label) => GestureDetector(
          onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ManualEventScreen(initialType: type))),
          child: Container(
            width: 100,
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: IK.goldLine), boxShadow: IK.cardShadow),
            clipBehavior: Clip.antiAlias,
            child: Column(children: [
              SizedBox(height: 86, width: 100, child: Image.asset(asset, fit: BoxFit.cover)),
              Padding(padding: const EdgeInsets.all(8), child: Text(label, style: IK.strong(size: 12))),
            ]),
          ),
        );
    return IkPage(
      header: IkHeader(kicker: tr(context, 'Your own plans'), title: tr(context, 'Add an event'), sub: tr(context, 'Anything of yours — we keep the reminders'), art: Art.bells),
      children: [
        Text(tr(context, 'A wedding you are attending, a meeting, a clinic visit, a trip. It joins your agenda in the right order.'), style: IK.soft(size: 13)),
        const SizedBox(height: 14),
        IkCard(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              height: 150,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: const LinearGradient(colors: [Color(0xFFF1E8FF), Color(0xFFFFF0F4)]),
              ),
              child: Stack(children: [
                Center(child: Image.asset(Art.doliFrame, height: 130)),
                Positioned(right: 30, top: 14, child: Image.asset(Art.aiStars, height: 36)),
              ]),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Image.asset(Art.aiBox, width: 22),
              const SizedBox(width: 6),
              Text(tr(context, 'The fastest way'), style: IK.kicker(size: 18)),
            ]),
            Text(tr(context, 'Scan the invitation card'), style: IK.title(size: 24)),
            const SizedBox(height: 6),
            Text(tr(context, 'We read the names, every date, the venue and each function — then set the reminders.'), style: IK.soft(size: 12.5)),
            const SizedBox(height: 12),
            IkButton(tr(context, 'Scan a card'), icon: Icons.document_scanner_outlined, compact: true,
                onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const AiScanScreen()))),
          ]),
        ),
        const SizedBox(height: 12),
        IkGroup(children: [
          IkRow(
            icon: Icons.edit_note_rounded,
            iconColor: IK.g6,
            iconBg: IK.g1,
            title: tr(context, 'Add it yourself'),
            sub: tr(context, 'Type the details — you choose every reminder'),
            onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const ManualEventScreen())),
          ),
        ]),
        SectionTitle(tr(context, 'Or start from a kind')),
        SizedBox(
          height: 128,
          child: ListView(scrollDirection: Axis.horizontal, children: [
            kind('Wedding', Art.homeCouple, tr(context, 'Wedding')),
            const SizedBox(width: 10),
            kind('Meeting', Art.photoWork, tr(context, 'Meeting')),
            const SizedBox(width: 10),
            kind('Appointment', Art.photoHealth, tr(context, 'Appointment')),
            const SizedBox(width: 10),
            kind('Celebration', Art.photoCelebrate, tr(context, 'Celebration')),
            const SizedBox(width: 10),
            kind('Other', Art.photoCity, tr(context, 'Travel & other')),
          ]),
        ),
      ],
    );
  }
}
