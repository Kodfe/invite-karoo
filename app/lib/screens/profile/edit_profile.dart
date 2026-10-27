import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../auth/auth_ui.dart';

/// A draft: nothing reaches the account until Save.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});
  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final Session _s = Session.read(context);
  late final _first = TextEditingController(text: '${_s.me?['firstName'] ?? ''}');
  late final _family = TextEditingController(text: '${_s.me?['familyName'] ?? ''}');
  late final _city = TextEditingController(text: '${_s.me?['city'] ?? ''}');
  late final _email = TextEditingController(text: '${_s.me?['email'] ?? ''}');
  Map<String, String> _errs = {};
  bool _busy = false;
  bool _photoBusy = false;

  @override
  void dispose() {
    for (final c in [_first, _family, _city, _email]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _errs = {};
    });
    try {
      final me = asJson(await _s.api.patch('/v1/me', {
        'firstName': _first.text.trim(),
        'familyName': _family.text.trim(),
        'city': _city.text.trim(),
        'email': _email.text.trim(),
      }));
      _s.updateMe(me);
      if (!mounted) return;
      toast(context, tr(context, 'Saved'));
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _errs = e.fields);
      if (e.fields.isEmpty && mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _photo() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(tr(context, 'Take a photo')), onTap: () => Navigator.pop(ctx, 'camera')),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(tr(context, 'Choose from gallery')), onTap: () => Navigator.pop(ctx, 'gallery')),
          if (_s.me?['photoUrl'] != null)
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded, color: IK.bad),
              title: Text(tr(context, 'Remove photo'), style: const TextStyle(color: IK.bad)),
              onTap: () => Navigator.pop(ctx, 'remove'),
            ),
        ]),
      ),
    );
    if (choice == null) return;
    setState(() => _photoBusy = true);
    try {
      if (choice == 'remove') {
        _s.updateMe(asJson(await _s.api.delete('/v1/me/photo')));
      } else {
        // squared and shrunk on the phone before it is sent
        final x = await ImagePicker().pickImage(
          source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery,
          maxWidth: 800,
          maxHeight: 800,
          imageQuality: 85,
        );
        if (x == null) return;
        _s.updateMe(asJson(await _s.api.upload('/v1/me/photo', files: {'file': x.path})));
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Future<void> _changeNumber() async {
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const ChangeNumberScreen()));
    if (done == true && mounted) toast(context, tr(context, 'Your number is changed'));
  }

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return IkPage(
      header: IkHeader(title: tr(context, 'Edit profile'), sub: tr(context, 'How hosts see you on their guest list'), art: Art.a('cplStand')),
      bottom: BottomBar(child: IkButton(tr(context, 'Save changes'), icon: Icons.check_rounded, loading: _busy, onPressed: _save)),
      children: [
        Center(
          child: Column(children: [
            Stack(children: [
              Avatar(name: '${_first.text} ${_family.text}', photo: s.me?['photoUrl'] as String?, size: 104, ring: true),
              if (_photoBusy) const Positioned.fill(child: Center(child: CircularProgressIndicator(color: IK.g4))),
            ]),
            const SizedBox(height: 10),
            IkButton(tr(context, 'Change photo'), compact: true, kind: BtnKind.ghost, icon: Icons.photo_camera_outlined, onPressed: _photo),
          ]),
        ),
        const SizedBox(height: 18),
        IkCard(
          child: Column(children: [
            Row(children: [
              Expanded(child: Field(label: tr(context, 'First name'), required: true, controller: _first, error: _errs['firstName'], maxLength: 30, capitalization: TextCapitalization.words, onChanged: (_) => setState(() {}))),
              const SizedBox(width: 10),
              Expanded(child: Field(label: tr(context, 'Family name'), required: true, controller: _family, error: _errs['familyName'], maxLength: 30, capitalization: TextCapitalization.words, onChanged: (_) => setState(() {}))),
            ]),
            Field(label: tr(context, 'City'), required: true, controller: _city, error: _errs['city'], maxLength: 40, capitalization: TextCapitalization.words),
            Field(
              label: tr(context, 'Email'),
              controller: _email,
              keyboard: TextInputType.emailAddress,
              hint: tr(context, 'Optional'),
              error: _errs['email'],
              helper: tr(context, 'Only for account help. Hosts never see it.'),
              maxLength: 80,
            ),
            Align(alignment: Alignment.centerLeft, child: Text(tr(context, 'MOBILE NUMBER'), style: IK.label())),
            const SizedBox(height: 7),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(color: IK.paper2.withValues(alpha: .6), borderRadius: BorderRadius.circular(14), border: Border.all(color: IK.line)),
              child: Row(children: [
                const Icon(Icons.lock_outline_rounded, size: 17, color: IK.ink4),
                const SizedBox(width: 10),
                Expanded(child: Text('${s.me?['phonePretty'] ?? ''}', style: IK.strong(size: 15))),
                TextButton(onPressed: _changeNumber, child: Text(tr(context, 'Change'))),
              ]),
            ),
            const SizedBox(height: 6),
            Align(alignment: Alignment.centerLeft, child: Text(tr(context, 'Your invitations are tied to this number.'), style: IK.soft(size: 11.5))),
          ]),
        ),
        const SizedBox(height: 14),
        Note(tr(context, 'Hosts see your name, family name and city next to your reply, so they know who is coming.'), icon: Icons.groups_outlined),
      ],
    );
  }
}

class ChangeNumberScreen extends StatefulWidget {
  const ChangeNumberScreen({super.key});
  @override
  State<ChangeNumberScreen> createState() => _ChangeNumberScreenState();
}

class _ChangeNumberScreenState extends State<ChangeNumberScreen> {
  final _mobile = TextEditingController();
  final _code = TextEditingController();
  String _cc = '+91';
  bool _sent = false;
  bool _busy = false;
  String? _err;

  Future<void> _go() async {
    final s = Session.read(context);
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      if (!_sent) {
        await s.api.post('/v1/me/phone/request', {'cc': _cc, 'mobile': _mobile.text.trim()});
        setState(() => _sent = true);
      } else {
        final me = asJson(await s.api.post('/v1/me/phone/verify', {'cc': _cc, 'mobile': _mobile.text.trim(), 'code': _code.text.trim()}));
        s.updateMe(me);
        // every old session ended on the server; sign in again on the new number
        if (mounted) Navigator.of(context).pop(true);
        await s.signOut();
      }
    } on ApiException catch (e) {
      setState(() => _err = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      back: true,
      title: tr(context, 'Change your number'),
      sub: tr(context, 'We send a code to the new number. After that you sign in with it.'),
      art: Art.phoneIc,
      children: [
        AuthCard(children: [
          PhoneField(cc: _cc, controller: _mobile, onCc: (v) => setState(() => _cc = v), label: 'New mobile number', error: _sent ? null : _err),
          if (_sent) ...[
            const SizedBox(height: 14),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
              textAlign: TextAlign.center,
              style: IK.monoS(size: 26, color: IK.ink).copyWith(letterSpacing: 12),
              decoration: InputDecoration(hintText: '••••', errorText: _err),
            ),
          ],
          const SizedBox(height: 14),
          WaButton(label: _sent ? tr(context, 'Verify and change') : tr(context, 'Send code on WhatsApp'), loading: _busy, onPressed: _go),
        ]),
        ShieldLine(tr(context, 'Invitations sent to your old number will not move across automatically. Ask the hosts to update it.')),
      ],
    );
  }
}
