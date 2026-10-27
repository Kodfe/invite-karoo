import 'dart:math';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_home.dart';

/// One composer for every way in: a whole function, a slice of its guests, or one guest.
/// It always says who gets it, on which channel, and exactly what they will read.
///   WhatsApp invitation / reminder — once per function, to the whole function
///   App message — unlimited, to guests who have the app
class HostRemindScreen extends StatefulWidget {
  const HostRemindScreen({super.key, required this.weddingId, this.functionId, this.presetKind, this.presetAudience, this.guestIds, this.guestName});
  final String weddingId;
  final String? functionId;
  final String? presetKind; // rsvp_request | reminder | nudge
  final String? presetAudience; // all | pending | going | maybe | not_going | one
  final List<String>? guestIds;
  final String? guestName;

  @override
  State<HostRemindScreen> createState() => _HostRemindScreenState();
}

class _HostRemindScreenState extends State<HostRemindScreen> {
  List<Json> _fns = [];
  String? _fn;
  late String _kind = widget.presetKind ?? (widget.presetAudience != null ? 'nudge' : 'nudge');
  late String _aud = widget.presetAudience ?? 'all';
  Json? _preview;
  bool _loading = true;
  bool _sending = false;
  final _msg = TextEditingController();
  final _idem = '${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  bool get _one => _aud == 'one';

  @override
  void initState() {
    super.initState();
    _fn = widget.functionId;
    _load();
  }

  Future<void> _load() async {
    final s = Session.read(context);
    try {
      _fns = asList(await s.api.get('${hostBase(widget.weddingId)}/functions')).where((f) => f['past'] != true).toList();
      _fn ??= _fns.isEmpty ? null : '${_fns.first['id']}';
      _defaultText();
      await _loadPreview();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Json? get _f => _fns.where((f) => f['id'] == _fn).firstOrNull;

  void _defaultText() {
    final f = _f;
    if (f == null) return;
    final when = '${f['dayLabel']}, ${f['timeLabel']}';
    _msg.text = switch (_aud) {
      'pending' => trIn(Session.read(context).lang, 'We would love to know if you can make it to the {f} on {w}. Please reply in the app.', {'f': f['name'], 'w': when}),
      'going' => trIn(Session.read(context).lang, 'See you at the {f} on {w} at {v}!', {'f': f['name'], 'w': when, 'v': f['venueName']}),
      _ => trIn(Session.read(context).lang, 'A reminder about the {f} on {w} at {v}.', {'f': f['name'], 'w': when, 'v': f['venueName']}),
    };
  }

  Future<void> _loadPreview() async {
    if (_fn == null || _kind == 'nudge') {
      setState(() => _preview = null);
      return;
    }
    final p = asJson(await Session.read(context).api.get('${hostBase(widget.weddingId)}/functions/$_fn/blasts/preview', query: {'kind': _kind}));
    if (mounted) setState(() => _preview = p);
  }

  Future<void> _send() async {
    final f = _f;
    if (f == null) return;
    final s = Session.read(context);
    final base = hostBase(widget.weddingId);
    if (_kind != 'nudge') {
      final p = _preview!;
      final ok = await confirmSheet(
        context,
        title: _kind == 'rsvp_request' ? tr(context, 'Send the {f} invitation?', {'f': f['name']}) : tr(context, 'Send the {f} reminder?', {'f': f['name']}),
        body: tr(context, 'It goes on WhatsApp to {n} guests, and into the app for the {a} who have it. This can be sent only once.', {'n': p['recipientCount'], 'a': p['withApp']}),
        confirm: tr(context, 'Send to {n} guests', {'n': p['recipientCount']}),
        art: Art.whatsapp,
      );
      if (!ok) return;
      setState(() => _sending = true);
      try {
        final r = asJson(await s.api.post('$base/functions/$_fn/blasts', {'kind': _kind, 'idempotencyKey': _idem}));
        s.touch();
        if (!mounted) return;
        toast(context, r['state'] == 'failed' ? tr(context, 'Sending failed. Try again.') : tr(context, 'Sending to {n} guests', {'n': r['recipientCount']}));
        Navigator.of(context).pop(true);
      } catch (e) {
        if (mounted) showError(context, e);
      } finally {
        if (mounted) setState(() => _sending = false);
      }
      return;
    }
    if (_msg.text.trim().length < 2) {
      toast(context, tr(context, 'Write a short message first'), icon: Icons.edit_outlined);
      return;
    }
    setState(() => _sending = true);
    try {
      final r = asJson(await s.api.post('$base/nudges', {
        'functionId': _fn,
        'audience': _aud,
        if (widget.guestIds != null) 'guestIds': widget.guestIds,
        'message': _msg.text.trim(),
      }));
      s.touch();
      if (!mounted) return;
      final without = toInt(r['withoutApp']);
      toast(context, tr(context, 'Sent in the app to {n}', {'n': r['appCount']}) + (without > 0 ? ' · ${tr(context, '{n} do not have the app', {'n': without})}' : ''));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingView();
    final f = _f;
    final p = _preview;
    final blastDone = p != null && p['alreadySent'] != null;
    final canBlast = p != null && p['canSend'] == true;
    return IkPage(
      header: IkHeader(
        title: _one ? tr(context, 'Remind {n}', {'n': '${widget.guestName ?? ''}'.split(' ').first}) : tr(context, 'Send a reminder'),
        sub: tr(context, 'On WhatsApp and in the app'),
        art: Art.bells,
      ),
      bottom: f == null
          ? null
          : BottomBar(
              child: IkButton(
                _kind == 'nudge' ? tr(context, 'Send in the app') : (_kind == 'rsvp_request' ? tr(context, 'Send the invitation') : tr(context, 'Send the WhatsApp reminder')),
                icon: Icons.send_rounded,
                loading: _sending,
                kind: _kind == 'nudge' ? BtnKind.primary : BtnKind.whatsapp,
                onPressed: _kind == 'nudge' || canBlast ? _send : null,
              ),
            ),
      children: [
        if (f == null)
          EmptyState(art: Art.hourglass, title: tr(context, 'Nothing left to remind'), body: tr(context, 'Every function has finished.'))
        else ...[
          if (!_one && widget.functionId == null) ...[
            Text(tr(context, 'WHICH FUNCTION'), style: IK.label()),
            const SizedBox(height: 8),
            ChipTabs(
              items: [for (final x in _fns) ('${x['id']}', '${x['name']}')],
              value: _fn ?? '',
              onChanged: (v) async {
                setState(() => _fn = v);
                _defaultText();
                await _loadPreview();
              },
            ),
            const SizedBox(height: 16),
          ],
          IkCard(
            child: Row(children: [
              Image.asset(Art.forFunction('${f['name']}'), width: 52, height: 52),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${f['name']}', style: IK.h2(size: 19)),
                  Text('${f['dayLabel']} · ${f['timeLabel']} · ${f['venueName']}', style: IK.soft(size: 11.5)),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          Text(tr(context, 'HOW'), style: IK.label()),
          const SizedBox(height: 8),
          if (!_one) ...[
            _channel('rsvp_request', Art.whatsapp, tr(context, 'WhatsApp invitation'), tr(context, 'Once · every guest on this function, with a reply link')),
            _channel('reminder', Art.whatsapp, tr(context, 'WhatsApp reminder'), tr(context, 'Once · everyone who has not said no')),
          ],
          _channel('nudge', Art.bells, tr(context, 'App message'), tr(context, 'Any time · guests who have the app')),
          if (_one)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: IkButton(tr(context, 'Message from my own WhatsApp'), kind: BtnKind.ghost, compact: true, leading: Image.asset(Art.whatsapp, width: 18), onPressed: () async {
                final g = await guard(context, () => Session.read(context).api.get('${hostBase(widget.weddingId)}/guests/${widget.guestIds!.first}'));
                if (g == null) return;
                final phone = '${asJson(g)['phone']}'.replaceAll('+', '');
                launchUrl(Uri.parse('https://wa.me/$phone?text=${Uri.encodeComponent(_msg.text)}'), mode: LaunchMode.externalApplication);
              }),
            ),
          const SizedBox(height: 8),
          if (_kind == 'nudge') ...[
            if (!_one) ...[
              Text(tr(context, 'WHO GETS IT'), style: IK.label()),
              const SizedBox(height: 8),
              ChipTabs(
                items: [
                  ('all', tr(context, 'Everyone invited')),
                  ('pending', tr(context, 'No reply yet')),
                  ('going', tr(context, 'Coming')),
                  ('maybe', tr(context, 'Maybe')),
                ],
                value: _aud,
                onChanged: (v) => setState(() {
                  _aud = v;
                  _defaultText();
                }),
              ),
              const SizedBox(height: 14),
            ],
            Field(label: tr(context, 'Message'), controller: _msg, lines: 4, maxLength: 300),
            Note(tr(context, 'Guests without the app do not get app messages. Use the WhatsApp invitation or reminder for them, or call.'), icon: Icons.info_outline_rounded),
          ] else if (p != null) ...[
            if (blastDone)
              Note(
                tr(context, 'Already sent {when} to {n} guests. It goes only once.', {'when': ago(asJson(p['alreadySent'])['sentAt']), 'n': asJson(p['alreadySent'])['recipientCount']}),
                tone: Tone.ok,
                icon: Icons.check_circle_outline_rounded,
              )
            else ...[
              Row(children: [
                Expanded(child: StatTile(value: '${p['recipientCount']}', label: tr(context, 'On WhatsApp'), color: IK.ok)),
                const SizedBox(width: 8),
                Expanded(child: StatTile(value: '${p['withApp']}', label: tr(context, 'Also in the app'))),
              ]),
              const SizedBox(height: 12),
              Text(tr(context, 'WHAT THEY READ'), style: IK.label()),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFDCF8C6), borderRadius: BorderRadius.circular(14)),
                child: Text('${p['sampleText']}', style: IK.body(size: 13, color: const Color(0xFF111B21))),
              ),
              if (!canBlast)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Note(
                    _kind == 'reminder' ? tr(context, 'Send the invitation for this function first.') : tr(context, 'Sending is not possible right now.'),
                    tone: Tone.gold,
                    icon: Icons.info_outline_rounded,
                  ),
                ),
            ],
          ],
        ],
      ],
    );
  }

  Widget _channel(String kind, String art, String title, String sub) {
    final on = _kind == kind;
    return GestureDetector(
      onTap: () async {
        setState(() => _kind = kind);
        await _loadPreview();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: on ? IK.v0 : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: on ? IK.v4 : IK.goldLine, width: on ? 2 : 1),
        ),
        child: Row(children: [
          Image.asset(art, width: 30, height: 30),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: IK.strong(size: 14)), Text(sub, style: IK.soft(size: 11.5))])),
          Icon(on ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded, color: on ? IK.v6 : IK.line2),
        ]),
      ),
    );
  }
}
