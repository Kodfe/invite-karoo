import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_gifts.dart';
import 'host_home.dart';

/// The gift desk. Every guest's invitation in the app carries a code; the host (or a family
/// member with access) scans it to hand over a gift, or to write down one received.
class HostScanScreen extends StatefulWidget {
  const HostScanScreen({super.key, required this.weddingId, required this.functions, this.functionId});
  final String weddingId;
  final List<Json> functions;
  final String? functionId;
  @override
  State<HostScanScreen> createState() => _HostScanScreenState();
}

class _HostScanScreenState extends State<HostScanScreen> {
  final _cam = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  String _mode = 'give'; // give | record
  late String? _fn = widget.functionId ?? _defaultFn();
  bool _busy = false;
  String? _lastCode;

  String? _defaultFn() {
    final live = widget.functions.where((f) => f['past'] != true).toList();
    if (live.isNotEmpty) return '${live.first['id']}';
    return widget.functions.isEmpty ? null : '${widget.functions.last['id']}';
  }

  @override
  void dispose() {
    _cam.dispose();
    super.dispose();
  }

  Future<void> _onCode(String code) async {
    if (_busy || _fn == null) return;
    _busy = true;
    _lastCode = code;
    HapticFeedback.mediumImpact();
    final s = Session.read(context);
    try {
      final r = asJson(await s.api.post('${hostBase(widget.weddingId)}/scan', {'code': code, 'functionId': _fn}));
      if (!mounted) return;
      await _result(r);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      // a short pause so the same card is not read twice while it is still in front of the camera
      await Future.delayed(const Duration(milliseconds: 900));
      _busy = false;
    }
  }

  Future<void> _result(Json r) async {
    final s = Session.read(context);
    final base = hostBase(widget.weddingId);
    if (r['found'] != true) {
      await showModalBottomSheet(
        context: context,
        showDragHandle: true,
        builder: (ctx) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.qr_code_2_rounded, size: 54, color: IK.bad),
              const SizedBox(height: 8),
              Text(tr(context, 'Not on this guest list'), style: IK.title(size: 22)),
              const SizedBox(height: 6),
              Text('${r['message'] ?? ''}', textAlign: TextAlign.center, style: IK.soft()),
              const SizedBox(height: 14),
              IkButton(tr(context, 'Scan again'), onPressed: () => Navigator.pop(ctx)),
            ]),
          ),
        ),
      );
      return;
    }
    final g = asJson(r['guest']);
    final f = asJson(r['function']);
    final inv = r['invite'] == null ? null : asJson(r['invite']);
    final status = '${r['status']}';
    final received = asList(r['received']);
    await showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) {
        Widget? action;
        Widget? info;
        if (_mode == 'give') {
          switch (status) {
            case 'on_gift_list':
              info = Note(tr(context, 'On the gift list. {g}', {'g': f['giftPlan'] ?? ''}), tone: Tone.mag, icon: Icons.card_giftcard_rounded);
              action = IkButton(tr(context, 'Mark as given'), kind: BtnKind.gold, icon: Icons.check_rounded, onPressed: () async {
                final x = await guard(ctx, () => s.api.post('$base/invites/${inv!['id']}/gift-out', {'given': true, 'method': 'qr'}));
                if (x != null && ctx.mounted) {
                  s.touch();
                  Navigator.pop(ctx);
                  toast(context, tr(context, 'Gift given to {n}', {'n': g['name']}));
                }
              });
            case 'already_given':
              info = Note(tr(context, 'Already given {when} by {who}. Nothing to do.', {'when': ago(inv?['givenAt']), 'who': inv?['givenBy'] ?? ''}), tone: Tone.ok, icon: Icons.check_circle_outline_rounded);
            case 'not_on_gift_list':
              info = Note(tr(context, 'Not on the gift list for the {f}.', {'f': f['name']}), tone: Tone.gold, icon: Icons.info_outline_rounded);
              action = IkButton(tr(context, 'Give anyway, add to the list'), kind: BtnKind.ghost, icon: Icons.add_rounded, onPressed: () async {
                final x = await guard(ctx, () => s.api.post('$base/invites/${inv!['id']}/gift-out', {'given': true, 'method': 'qr', 'addToList': true}));
                if (x != null && ctx.mounted) {
                  s.touch();
                  Navigator.pop(ctx);
                  toast(context, tr(context, 'Gift given to {n}', {'n': g['name']}));
                }
              });
            default:
              info = Note(tr(context, 'Not invited to the {f}.', {'f': f['name']}), tone: Tone.bad, icon: Icons.warning_amber_rounded);
          }
        } else {
          if (status == 'not_invited') info = Note(tr(context, 'Not invited to the {f}, but you can still record it.', {'f': f['name']}), tone: Tone.gold);
          action = IkButton(tr(context, 'Record their gift'), icon: Icons.favorite_border_rounded, onPressed: () async {
            Navigator.pop(ctx);
            await push(context, HostGiftNewScreen(weddingId: widget.weddingId, functions: widget.functions, functionId: _fn, guest: g));
          });
        }
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Avatar(name: '${g['name']}', size: 54),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${g['name']}', style: IK.title(size: 22)),
                    Text('${g['relation']} · ${g['phonePretty']}', style: IK.soft(size: 12)),
                    if (inv != null && inv['rsvp'] == 'going') Text(tr(context, 'Coming · {n} people', {'n': inv['pax']}), style: IK.body(size: 12, color: IK.ok, weight: FontWeight.w700)),
                  ]),
                ),
              ]),
              const SizedBox(height: 14),
              if (info != null) info,
              if (received.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(tr(context, 'Already recorded from them here: {n}', {'n': received.map((x) => x['amount'] != null ? rupees(toInt(x['amount'])) : '${x['itemName']}').join(', ')}),
                    style: IK.soft(size: 12)),
              ],
              const SizedBox(height: 14),
              if (action != null) ...[action, const SizedBox(height: 8)],
              IkButton(tr(context, 'Scan the next guest'), kind: BtnKind.ghost, onPressed: () => Navigator.pop(ctx)),
            ]),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: const Color(0xFF0E0722),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                SquareBtn(icon: Icons.arrow_back_rounded, dark: true, onTap: () => Navigator.of(context).maybePop()),
                const SizedBox(width: 12),
                Text(tr(context, 'Gift desk'), style: IK.title(size: 26, color: Colors.white)),
                const Spacer(),
                SquareBtn(icon: Icons.flashlight_on_outlined, dark: true, onTap: () => _cam.toggleTorch()),
              ]),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: .07), borderRadius: BorderRadius.circular(16)),
                child: Row(children: [
                  for (final m in [('give', Icons.card_giftcard_rounded, tr(context, 'Give a gift')), ('record', Icons.favorite_border_rounded, tr(context, 'Record a gift'))])
                    Expanded(
                      child: GestureDetector(
                        onTap: () => setState(() => _mode = m.$1),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 160),
                          height: 42,
                          decoration: BoxDecoration(gradient: _mode == m.$1 ? IK.goldGradient : null, borderRadius: BorderRadius.circular(12)),
                          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Icon(m.$2, size: 16, color: _mode == m.$1 ? IK.v9 : IK.v2),
                            const SizedBox(width: 6),
                            Text(m.$3, style: IK.strong(size: 13, color: _mode == m.$1 ? IK.v9 : IK.v2)),
                          ]),
                        ),
                      ),
                    ),
                ]),
              ),
              const SizedBox(height: 10),
              ChipTabs(dark: true, items: [for (final f in widget.functions) ('${f['id']}', '${f['name']}')], value: _fn ?? '', onChanged: (v) => setState(() => _fn = v)),
              const SizedBox(height: 16),
              Expanded(
                child: Center(
                  child: AspectRatio(
                    aspectRatio: 1,
                    child: Stack(children: [
                      Positioned.fill(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(26),
                          child: MobileScanner(
                            controller: _cam,
                            onDetect: (capture) {
                              final v = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
                              if (v != null && v.isNotEmpty) _onCode(v);
                            },
                          ),
                        ),
                      ),
                      Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: _Corners()))),
                    ]),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(tr(context, 'Ask the guest to open their invitation in the app, and scan the code on it.'), textAlign: TextAlign.center, style: IK.body(size: 12.5, color: IK.v2)),
              const SizedBox(height: 14),
              if (_lastCode != null && !_busy)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: IkButton(tr(context, 'Read the last code again'), kind: BtnKind.gold, icon: Icons.refresh_rounded, onPressed: () => _onCode(_lastCode!)),
                ),
              IkButton(
                tr(context, 'No phone? Find them by name'),
                kind: BtnKind.dark,
                icon: Icons.search_rounded,
                onPressed: _fn == null
                    ? null
                    : () {
                        if (_mode == 'give') {
                          final f = widget.functions.where((x) => x['id'] == _fn).firstOrNull;
                          push(context, GiftOutListScreen(weddingId: widget.weddingId, functionId: _fn!, name: '${f?['name'] ?? ''}'));
                        } else {
                          push(context, HostGiftNewScreen(weddingId: widget.weddingId, functions: widget.functions, functionId: _fn));
                        }
                      },
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Corners extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = IK.g4
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    const l = 36.0;
    const m = 14.0;
    final w = size.width;
    final h = size.height;
    for (final c in [
      [Offset(m, m + l), Offset(m, m), Offset(m + l, m)],
      [Offset(w - m - l, m), Offset(w - m, m), Offset(w - m, m + l)],
      [Offset(m, h - m - l), Offset(m, h - m), Offset(m + l, h - m)],
      [Offset(w - m - l, h - m), Offset(w - m, h - m), Offset(w - m, h - m - l)],
    ]) {
      canvas.drawPath(Path()..moveTo(c[0].dx, c[0].dy)..lineTo(c[1].dx, c[1].dy)..lineTo(c[2].dx, c[2].dy), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
