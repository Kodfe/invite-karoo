import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'auth_ui.dart';
import 'otp.dart';
import 'signup.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  String _cc = '+91';
  String? _err;
  bool _busy = false;

  @override
  void dispose() {
    _mobile.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final m = _mobile.text.trim();
    if (m.length < lengthFor(_cc)) {
      setState(() => _err = tr(context, 'Enter your {n}-digit mobile number', {'n': lengthFor(_cc)}));
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      final r = asJson(await Session.read(context).api.post('/v1/auth/otp/request', {'cc': _cc, 'mobile': m, 'purpose': 'login'}));
      if (!mounted) return;
      push(context, OtpScreen(cc: _cc, mobile: m, sentTo: '${r['to'] ?? '$_cc $m'}', resendIn: toSec(r['resendIn'])));
    } on ApiException catch (e) {
      setState(() => _err = e.fields['mobile'] ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: tr(context, 'Welcome back'),
      sub: tr(context, 'Enter your mobile number to sign in.'),
      art: Art.couple,
      children: [
        AuthCard(children: [
          PhoneField(cc: _cc, controller: _mobile, error: _err, onCc: (v) => setState(() => _cc = v), onSubmit: _send),
          WaNote(tr(context, 'We’ll send a 4-digit code to this number on WhatsApp.')),
          WaButton(label: tr(context, 'Send code on WhatsApp'), loading: _busy, onPressed: _send),
        ]),
        ShieldLine(tr(context, 'We never share your number or message your contacts.')),
        const SizedBox(height: 18),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(tr(context, 'New here?'), style: IK.soft(size: 13.5)),
          LinkText(tr(context, 'Create an account'), onTap: () => push(context, const SignupScreen())),
        ]),
      ],
    );
  }
}

int toSec(dynamic v) => v is num ? v.toInt() : 30;
