import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'after_signin.dart';
import 'auth_ui.dart';
import 'signup.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.cc, required this.mobile, required this.sentTo, this.resendIn = 30, this.profile});
  final String cc;
  final String mobile;
  final String sentTo;
  final int resendIn;

  /// sent along with the code when the person filled in the sign-up form first
  final Map<String, String>? profile;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final _code = TextEditingController();
  final _focus = FocusNode();
  Timer? _t;
  int _left = 30;
  bool _busy = false;
  String? _err;
  bool _ok = false;

  @override
  void initState() {
    super.initState();
    _startTimer(widget.resendIn);
    _focus.addListener(() => setState(() {}));
    _code.addListener(() {
      setState(() {
        if (_code.text.isNotEmpty) _err = null;
      });
      if (_code.text.length == 4) _verify();
    });
  }

  void _startTimer(int s) {
    _t?.cancel();
    _left = s;
    _t = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _left = _left > 0 ? _left - 1 : 0);
      if (_left == 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    _code.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_busy || _code.text.length != 4) return;
    setState(() => _busy = true);
    final s = Session.read(context);
    try {
      final r = asJson(await s.api.post('/v1/auth/otp/verify', {
        'cc': widget.cc,
        'mobile': widget.mobile,
        'code': _code.text,
        'platform': Platform.isIOS ? 'ios' : 'android',
        if (widget.profile != null) 'profile': widget.profile,
      }));
      if (!mounted) return;
      setState(() => _ok = true);
      HapticFeedback.mediumImpact();
      if (r['status'] == 'needs_profile') {
        Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => SignupScreen(signupTicket: '${r['signupTicket']}', phonePretty: '${r['phone'] ?? ''}'),
        ));
      } else {
        await finishSignIn(context, r, isNew: r['isNew'] == true);
      }
    } on ApiException catch (e) {
      HapticFeedback.heavyImpact();
      _code.clear();
      setState(() => _err = e.message);
      _focus.requestFocus();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    final s = Session.read(context);
    final r = await guard(context, () => s.api.post('/v1/auth/otp/request', {'cc': widget.cc, 'mobile': widget.mobile, 'purpose': widget.profile == null ? 'login' : 'signup'}));
    if (r != null && mounted) {
      _startTimer((asJson(r)['resendIn'] as num?)?.toInt() ?? 30);
      toast(context, tr(context, 'A new code is on its way on WhatsApp'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final code = _code.text;
    return AuthScaffold(
      back: true,
      step: tr(context, 'Step 2 of 2'),
      title: tr(context, 'Enter the code'),
      art: Art.hourglass,
      children: [
        Transform.translate(
          offset: const Offset(0, -12),
          child: Row(children: [
            Flexible(child: Text.rich(TextSpan(style: IK.soft(size: 13), children: [
              TextSpan(text: '${tr(context, 'Sent on')} '),
              TextSpan(text: 'WhatsApp', style: IK.strong(size: 13)),
              TextSpan(text: ' ${tr(context, 'to')} '),
              TextSpan(text: widget.sentTo, style: IK.strong(size: 13)),
            ]))),
            const SizedBox(width: 4),
            TextButton.icon(
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.edit_outlined, size: 14),
              label: Text(tr(context, 'Change')),
              style: TextButton.styleFrom(foregroundColor: IK.v6, textStyle: IK.strong(size: 12.5)),
            ),
          ]),
        ),
        AuthCard(children: [
          Text(tr(context, '4-digit code'), textAlign: TextAlign.center, style: IK.soft(size: 12).copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: () => _focus.requestFocus(),
            child: Stack(children: [
              // the real field, invisible, so paste and SMS autofill both work
              Opacity(
                opacity: 0,
                child: SizedBox(
                  height: 72,
                  child: TextField(
                    controller: _code,
                    focusNode: _focus,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                  ),
                ),
              ),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                for (var i = 0; i < 4; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    margin: const EdgeInsets.symmetric(horizontal: 5.5),
                    width: 60,
                    height: 70,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _err != null ? IK.badBg : _ok ? IK.okBg : (i < code.length ? IK.v0 : Colors.white),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        width: 2,
                        color: _err != null
                            ? IK.badLine
                            : _ok
                                ? IK.okLine
                                : (i == code.length && _focus.hasFocus ? IK.v4 : (i < code.length ? IK.v3 : IK.line)),
                      ),
                      boxShadow: IK.sh1,
                    ),
                    child: Text(i < code.length ? code[i] : '',
                        style: IK.monoS(size: 28, color: _err != null ? IK.bad : (_ok ? IK.ok : IK.ink), weight: FontWeight.w500)),
                  ),
              ]),
            ]),
          ),
          if (_err != null) ...[
            const SizedBox(height: 10),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.error_outline_rounded, size: 14, color: IK.bad),
              const SizedBox(width: 5),
              Flexible(child: Text(_err!, textAlign: TextAlign.center, style: IK.body(size: 12, color: IK.bad, weight: FontWeight.w600))),
            ]),
          ],
          const SizedBox(height: 14),
          Center(
            child: _left > 0
                ? Text.rich(TextSpan(style: IK.soft(size: 12.5), children: [
                    TextSpan(text: '${tr(context, 'Resend code in')} '),
                    TextSpan(text: '0:${_left.toString().padLeft(2, '0')}', style: IK.monoS(size: 12.5, color: IK.ink2, weight: FontWeight.w500)),
                  ]))
                : LinkText(tr(context, 'Resend code'), onTap: _resend),
          ),
          const SizedBox(height: 14),
          IkButton(tr(context, 'Verify and continue'), icon: Icons.check_rounded, loading: _busy, onPressed: code.length == 4 ? _verify : null),
        ]),
        ShieldLine(tr(context, 'Code not arriving? Check WhatsApp on this number, or wait for the timer and ask again.'), icon: Icons.chat_bubble_outline_rounded),
      ],
    );
  }
}
