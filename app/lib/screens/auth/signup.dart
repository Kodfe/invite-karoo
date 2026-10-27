import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'after_signin.dart';
import 'auth_ui.dart';
import 'login.dart';
import 'otp.dart';

/// Create an account. Two ways in:
///  - fresh: details + number, then the code (the profile rides along with the code)
///  - [signupTicket]: the number was already confirmed at sign-in, only the details are missing
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key, this.signupTicket, this.phonePretty});
  final String? signupTicket;
  final String? phonePretty;

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _first = TextEditingController();
  final _family = TextEditingController();
  final _city = TextEditingController();
  final _mobile = TextEditingController();
  String _cc = '+91';
  Map<String, String> _errs = {};
  bool _busy = false;

  bool get _hasTicket => widget.signupTicket != null;

  @override
  void dispose() {
    for (final c in [_first, _family, _city, _mobile]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, String> _validate() {
    final e = <String, String>{};
    if (_first.text.trim().isEmpty) e['firstName'] = tr(context, 'Enter your first name');
    if (_family.text.trim().isEmpty) e['familyName'] = tr(context, 'Enter your family name');
    if (_city.text.trim().length < 2) e['city'] = tr(context, 'Enter your city');
    if (!_hasTicket && _mobile.text.trim().length < lengthFor(_cc)) e['mobile'] = tr(context, 'Enter a valid mobile number');
    return e;
  }

  Map<String, String> get _profile => {
        'firstName': _first.text.trim(),
        'familyName': _family.text.trim(),
        'city': _city.text.trim(),
        'lang': Session.read(context).lang,
      };

  Future<void> _go() async {
    final e = _validate();
    setState(() => _errs = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    final s = Session.read(context);
    try {
      if (_hasTicket) {
        final r = asJson(await s.api.post('/v1/auth/signup', {..._profile, 'signupTicket': widget.signupTicket}));
        if (!mounted) return;
        await finishSignIn(context, r, isNew: true);
      } else {
        final r = asJson(await s.api.post('/v1/auth/otp/request', {'cc': _cc, 'mobile': _mobile.text.trim(), 'purpose': 'signup'}));
        if (!mounted) return;
        push(context, OtpScreen(cc: _cc, mobile: _mobile.text.trim(), sentTo: '${r['to']}', resendIn: toSec(r['resendIn']), profile: _profile));
      }
    } on ApiException catch (err) {
      setState(() => _errs = err.fields.isNotEmpty ? err.fields : {'_': err.message});
      if (err.fields.isEmpty) showError(context, err);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      back: true,
      title: tr(context, 'Join Invite Karoo'),
      sub: tr(context, 'A few details so hosts can recognise you at the venue.'),
      art: Art.sangeet,
      children: [
        AuthCard(children: [
          Field(label: tr(context, 'First name'), required: true, controller: _first, hint: 'Mahesh', icon: Icons.person_outline_rounded,
              error: _errs['firstName'], capitalization: TextCapitalization.words, maxLength: 30),
          Field(label: tr(context, 'Family name'), required: true, controller: _family, hint: 'Ranka', icon: Icons.groups_outlined,
              error: _errs['familyName'], capitalization: TextCapitalization.words, maxLength: 30),
          if (_hasTicket)
            Padding(
              padding: const EdgeInsets.only(bottom: 15),
              child: Row(children: [
                const Icon(Icons.verified_rounded, color: IK.ok, size: 18),
                const SizedBox(width: 8),
                Text(widget.phonePretty ?? '', style: IK.strong(size: 15)),
                const SizedBox(width: 8),
                Pill(tr(context, 'Verified'), tone: Tone.ok),
              ]),
            )
          else
            Padding(
              padding: const EdgeInsets.only(bottom: 15),
              child: PhoneField(cc: _cc, controller: _mobile, error: _errs['mobile'], onCc: (v) => setState(() => _cc = v)),
            ),
          Field(label: tr(context, 'City'), required: true, controller: _city, hint: 'Chennai', icon: Icons.location_on_outlined,
              error: _errs['city'], capitalization: TextCapitalization.words, maxLength: 40),
          if (!_hasTicket) WaNote(tr(context, 'We’ll confirm your number with a 4-digit code on WhatsApp.')),
          if (_hasTicket)
            IkButton(tr(context, 'Create my account'), icon: Icons.check_rounded, loading: _busy, onPressed: _go)
          else
            WaButton(label: tr(context, 'Send code on WhatsApp'), loading: _busy, onPressed: _go),
        ]),
        ShieldLine(tr(context, 'Only you and your hosts see these details.'), icon: Icons.lock_outline_rounded),
        if (!_hasTicket) ...[
          const SizedBox(height: 14),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text(tr(context, 'Already have an account?'), style: IK.soft(size: 13.5)),
            LinkText(tr(context, 'Sign in'), onTap: () => Navigator.of(context).popUntil((r) => r.isFirst)),
          ]),
        ],
      ],
    );
  }
}
