import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'core/push.dart';
import 'core/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final session = Session();
  runApp(SessionScope(session: session, child: const InviteKarooApp()));
  // the splash shows while these run
  await Push.init();
  await session.init();
  if (session.signedIn) Push.register(session);
}
