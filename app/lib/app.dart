import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/api.dart';
import 'core/art.dart';
import 'core/demo.dart';
import 'core/push.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'screens/auth/login.dart';
import 'screens/auth/onboarding.dart';
import 'screens/guest/guest_shell.dart';
import 'screens/guest/invites.dart';
import 'screens/guest/notifications.dart';
import 'screens/guest/wedding.dart';
import 'screens/guest/function.dart';
import 'screens/host/host_shell.dart';
import 'screens/profile/support.dart';
import 'widgets/ui.dart';

final navigatorKey = GlobalKey<NavigatorState>();

class InviteKarooApp extends StatelessWidget {
  const InviteKarooApp({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return MaterialApp(
      title: 'Invite Karoo',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      theme: IK.theme(),
      locale: Locale(s.lang == 'en' ? 'en' : s.lang, 'IN'),
      supportedLocales: const [Locale('en', 'IN'), Locale('hi', 'IN'), Locale('ta', 'IN'), Locale('gu', 'IN')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        // keep the design's proportions even with very large system text
        data: MediaQuery.of(context).copyWith(textScaler: MediaQuery.of(context).textScaler.clamp(maxScaleFactor: 1.25)),
        child: Demo.on ? Banner(message: 'DEMO', location: BannerLocation.topEnd, child: child!) : child!,
      ),
      home: const Root(),
    );
  }
}

/// Decides what the app shows: splash, onboarding, sign-in, the guest side or a wedding console.
class Root extends StatefulWidget {
  const Root({super.key});
  @override
  State<Root> createState() => _RootState();
}

class _RootState extends State<Root> {
  StreamSubscription<Json>? _taps;
  StreamSubscription? _fg;

  @override
  void initState() {
    super.initState();
    _taps = Push.taps.stream.listen((a) {
      final s = Session.read(context);
      if (!s.signedIn) {
        s.pendingAction = a;
        return;
      }
      openAction(a);
    });
    _fg = Push.foreground.stream.listen((m) {
      final ctx = navigatorKey.currentContext;
      final n = m.notification;
      if (ctx != null && n != null) {
        toast(ctx, '${n.title ?? ''}${n.body != null ? ' · ${n.body}' : ''}', icon: Icons.notifications_active_rounded);
        Session.read(ctx).refreshMe().catchError((_) {});
      }
    });
  }

  @override
  void dispose() {
    _taps?.cancel();
    _fg?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    Widget child;
    if (!s.ready) {
      child = const SplashScreen(key: ValueKey('splash'));
    } else if (!s.signedIn) {
      child = s.onboarded ? const LoginScreen(key: ValueKey('login')) : const OnboardingScreen(key: ValueKey('onboard'));
    } else if (s.mode == 'host' && s.activeHosting != null) {
      child = HostShell(key: ValueKey('host-${s.activeHosting!['weddingId']}'), weddingId: '${s.activeHosting!['weddingId']}');
    } else {
      child = const GuestShell(key: ValueKey('guest'));
      final pending = s.pendingAction;
      if (pending != null) {
        s.pendingAction = null;
        WidgetsBinding.instance.addPostFrameCallback((_) => openAction(pending));
      }
    }
    return AnimatedSwitcher(duration: const Duration(milliseconds: 420), child: child);
  }
}

/// open what a notification points at
void openAction(Json a) {
  final nav = navigatorKey.currentState;
  final ctx = navigatorKey.currentContext;
  if (nav == null || ctx == null) return;
  final s = Session.read(ctx);
  switch ('${a['type']}') {
    case 'function':
      nav.push(MaterialPageRoute(builder: (_) => FunctionScreen(weddingId: '${a['weddingId']}', functionId: '${a['functionId']}', focusReply: true)));
    case 'wedding':
      nav.push(MaterialPageRoute(builder: (_) => WeddingScreen(weddingId: '${a['weddingId']}')));
    case 'ticket':
      nav.push(MaterialPageRoute(builder: (_) => TicketScreen(ticketId: '${a['ticketId']}')));
    case 'screen':
      switch ('${a['screen']}') {
        case 'invites':
          nav.push(MaterialPageRoute(builder: (_) => const InvitesScreen()));
        case 'hhome':
          s.refreshMe().then((_) {
            final h = s.activeHosting;
            if (h != null) {
              nav.popUntil((r) => r.isFirst);
              s.enterHost('${h['weddingId']}');
            }
          }).catchError((_) {});
        default:
          nav.push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
      }
    default:
      nav.push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(center: Alignment(0, -0.2), radius: 1.1, colors: [Color(0xFF2E1660), IK.ink]),
          ),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                width: 190,
                height: 190,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(colors: [IK.v4.withValues(alpha: .35), IK.v4.withValues(alpha: 0)]),
                ),
                padding: const EdgeInsets.all(28),
                child: Image.asset(Art.logo),
              ),
              const SizedBox(height: 26),
              const Text('Invite Karoo',
                  style: TextStyle(fontFamily: IK.display, fontSize: 30, fontWeight: FontWeight.w600, letterSpacing: 1.5, color: Color(0xFFE6C77E))),
              const SizedBox(height: 10),
              Text('EVERY INVITE MATTERS', style: IK.monoS(size: 10, color: IK.v3.withValues(alpha: .6)).copyWith(letterSpacing: 3)),
              const SizedBox(height: 40),
              const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: IK.g4)),
            ]),
          ),
        ),
      ),
    );
  }
}
