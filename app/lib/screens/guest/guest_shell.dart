import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../profile/profile.dart';
import 'add_event.dart';
import 'communities.dart';
import 'home.dart';
import 'invites.dart';

/// The guest side: Agenda · Invites · (+) · Communities · Profile
class GuestShell extends StatefulWidget {
  const GuestShell({super.key});
  @override
  State<GuestShell> createState() => _GuestShellState();
}

class _GuestShellState extends State<GuestShell> {
  int _tab = 0;
  final _keys = [GlobalKey(), GlobalKey(), GlobalKey(), GlobalKey()];

  @override
  void initState() {
    super.initState();
    // the profile counts (unread, host access) stay fresh when the app comes back
    WidgetsBinding.instance.addPostFrameCallback((_) => Session.read(context).refreshMe().catchError((_) {}));
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(key: _keys[0], onOpenInvites: () => setState(() => _tab = 1)),
      InvitesScreen(key: _keys[1], asTab: true),
      CommunitiesScreen(key: _keys[2], asTab: true),
      ProfileScreen(key: _keys[3]),
    ];
    return PopScope(
      canPop: _tab == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) setState(() => _tab = 0);
      },
      child: Scaffold(
        body: IndexedStack(index: _tab, children: pages),
        bottomNavigationBar: BottomNav(
          index: _tab,
          items: [
            (Icons.home_rounded, tr(context, 'Agenda')),
            (Icons.mail_rounded, tr(context, 'Invites')),
            (Icons.temple_hindu_rounded, tr(context, 'Communities')),
            (Icons.person_rounded, tr(context, 'Profile')),
          ],
          onTap: (i) => setState(() => _tab = i),
          onFab: () => push(context, const AddEventScreen()),
        ),
      ),
    );
  }
}

/// four tabs with a raised + in the middle, as in the design
class BottomNav extends StatelessWidget {
  const BottomNav({super.key, required this.index, required this.items, required this.onTap, this.onFab, this.dark = false});
  final int index;
  final List<(IconData, String)> items;
  final ValueChanged<int> onTap;
  final VoidCallback? onFab;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    Widget item(int i) {
      final on = i == index;
      final (icon, label) = items[i];
      return Expanded(
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap(i);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 21, color: on ? IK.v6 : IK.ink4),
              const SizedBox(height: 3),
              Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontFamily: IK.sans, fontSize: 10.5, fontWeight: on ? FontWeight.w800 : FontWeight.w600, color: on ? IK.v6 : IK.ink4)),
            ]),
          ),
        ),
      );
    }

    final fab = onFab != null;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: IK.line)),
        boxShadow: [BoxShadow(color: IK.ink.withValues(alpha: .06), blurRadius: 18, offset: const Offset(0, -4))],
      ),
      padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom),
      child: SizedBox(
        height: 60,
        child: Row(children: [
          for (var i = 0; i < items.length; i++) ...[
            if (fab && i == items.length ~/ 2)
              SizedBox(
                width: 70,
                child: Center(
                  child: GestureDetector(
                    onTap: onFab,
                    child: Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(shape: BoxShape.circle, gradient: IK.btnGradient, boxShadow: IK.btnShadow),
                      child: const Icon(Icons.add_rounded, color: Colors.white, size: 28),
                    ),
                  ),
                ),
              ),
            item(i),
          ],
        ]),
      ),
    );
  }
}
