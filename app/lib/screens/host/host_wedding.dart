import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/session.dart';
import '../../widgets/ui.dart';
import '../guest/wedding.dart';
import 'host_home.dart';

/// "What your guests see": the wedding page, exactly as a guest opens it.
/// The card, photos and functions are set up by the Invite Karoo team.
class HostWeddingScreen extends StatelessWidget {
  const HostWeddingScreen({super.key, required this.weddingId});
  final String weddingId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<Json>(
      load: () async => asJson(await s.api.get('${hostBase(weddingId)}/details')),
      builder: (context, d, reload) => WeddingBody(w: d, reload: reload, preview: true),
    );
  }
}
