import 'package:flutter/material.dart';

import '../../core/l10n.dart';
import '../../core/session.dart';
import '../guest/guest_shell.dart';
import 'host_functions.dart';
import 'host_gifts.dart';
import 'host_guests.dart';
import 'host_home.dart';
import 'host_rsvp.dart';

/// The wedding console: Console · Functions · RSVP · Guests · Gifts.
/// A family member with "gift desk only" access sees the console, guests and gifts.
class HostShell extends StatefulWidget {
  const HostShell({super.key, required this.weddingId});
  final String weddingId;
  @override
  State<HostShell> createState() => _HostShellState();
}

class _HostShellState extends State<HostShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final w = widget.weddingId;
    final desk = s.isGiftDesk;
    final tabs = <(IconData, String, Widget)>[
      (Icons.dashboard_rounded, tr(context, 'Console'), HostHome(weddingId: w, onTab: (i) => setState(() => _tab = i))),
      if (!desk) (Icons.event_note_rounded, tr(context, 'Functions'), HostFunctionsScreen(weddingId: w)),
      if (!desk) (Icons.mark_email_read_rounded, tr(context, 'RSVP'), HostRsvpScreen(weddingId: w)),
      (Icons.groups_rounded, tr(context, 'Guests'), HostGuestsScreen(weddingId: w)),
      (Icons.card_giftcard_rounded, tr(context, 'Gifts'), HostGiftsScreen(weddingId: w)),
    ];
    final i = _tab.clamp(0, tabs.length - 1);
    return PopScope(
      canPop: i == 0,
      onPopInvokedWithResult: (did, _) {
        if (!did) setState(() => _tab = 0);
      },
      child: Scaffold(
        body: IndexedStack(index: i, children: [for (final t in tabs) t.$3]),
        bottomNavigationBar: BottomNav(
          index: i,
          items: [for (final t in tabs) (t.$1, t.$2)],
          onTap: (n) => setState(() => _tab = n),
        ),
      ),
    );
  }
}

/// tab indexes for the full console, used by the "go to" shortcuts on the console home
class HostTab {
  static const console = 0;
  static const functions = 1;
  static const rsvp = 2;
  static const guests = 3;
  static const gifts = 4;
}
