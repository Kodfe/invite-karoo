import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';
import 'card.dart';
import 'function.dart';

/// One wedding, read from the guest's side: cover, the couple, the card, the voice
/// invitation, every function (theirs in full, the others as context), galleries and hosts.
class WeddingScreen extends StatelessWidget {
  const WeddingScreen({super.key, required this.weddingId, this.hostPreview});
  final String weddingId;

  /// the host's own "see it as a guest sees it" view passes the data in directly
  final Json? hostPreview;

  @override
  Widget build(BuildContext context) {
    final api = Session.of(context).api;
    return Loader<Json>(
      load: () async => hostPreview ?? asJson(await api.get('/v1/weddings/$weddingId')),
      builder: (context, w, reload) => WeddingBody(w: w, reload: reload, preview: hostPreview != null),
    );
  }
}

class WeddingBody extends StatelessWidget {
  const WeddingBody({super.key, required this.w, required this.reload, this.preview = false});
  final Json w;
  final Future<void> Function() reload;
  final bool preview;

  @override
  Widget build(BuildContext context) {
    final fns = asList(w['functions']);
    final mine = fns.where((f) => f['mine'] == true).length;
    final bride = asJson(w['bride']);
    final groom = asJson(w['groom']);
    final fam = asJson(w['families']);
    final card = w['card'] == null ? null : asJson(w['card']);
    final voice = w['voice'] == null ? null : asJson(w['voice']);
    final contact = w['contact'] == null ? null : asJson(w['contact']);
    return IkPage(
      onRefresh: preview ? null : reload,
      header: IkHeader(
        title: '${w['couple']}',
        sub: '${fam['brideSide'] is Map ? asJson(fam['brideSide'])['name'] : ''} · ${fam['groomSide'] is Map ? asJson(fam['groomSide'])['name'] : ''}',
        art: Art.gathbandhan,
      ),
      children: [
        CoverCarousel(media: asList(w['cover']), couple: '${w['couple']}', line: '${span(w['startDate'], w['endDate'])} · ${w['city']}'),
        const SizedBox(height: 14),
        _CoupleCard(bride: bride, groom: groom, fam: fam, city: '${w['city']}'),
        if (card != null) ...[
          const SizedBox(height: 14),
          IkGroup(children: [
            IkRow(
              image: Art.doliFrame,
              title: tr(context, 'The wedding card'),
              sub: '${card['name']} · ${card['sizeMb']} MB',
              onTap: () => push(context, CardScreen(weddingId: '${w['id']}', card: card, couple: '${w['couple']}', dates: span(w['startDate'], w['endDate']))),
            ),
          ]),
        ],
        if (voice != null) ...[const SizedBox(height: 12), VoicePlayer(url: '${voice['url']}')],
        SectionTitle(tr(context, 'The functions'), count: preview ? fns.length : '$mine / ${fns.length}'),
        for (var i = 0; i < fns.length; i++) _ThreadNode(f: fns[i], last: i == fns.length - 1, preview: preview, onBack: reload),
        if (asList(w['coupleGallery']).isNotEmpty) ...[
          SectionTitle(tr(context, 'The couple')),
          Gallery(items: asList(w['coupleGallery'])),
        ],
        if (asList(w['familyGallery']).isNotEmpty) ...[
          SectionTitle(tr(context, 'The families')),
          Gallery(items: asList(w['familyGallery'])),
        ],
        SectionTitle(tr(context, 'Your hosts')),
        IkGroup(children: [
          for (final h in asList(w['hosts'])) IkRow(icon: Icons.favorite_border_rounded, iconColor: IK.mag, iconBg: IK.magBg, title: '${h['name']}', sub: '${h['relation']}'),
          if (contact != null)
            IkRow(
              image: Art.phoneIc,
              title: tr(context, 'Call the family'),
              sub: '${contact['phonePretty']}',
              trailing: IkButton(tr(context, 'Call'), compact: true, kind: BtnKind.ghost, icon: Icons.call_rounded, onPressed: () => launchUrl(Uri.parse('tel:${contact['phone']}'))),
            ),
        ]),
        if (!preview && w['nameOnList'] != null) ...[
          const SizedBox(height: 14),
          Note(tr(context, 'You are on this list as “{name}”. The hosts see your reply for each function, never anything else on your phone.', {'name': w['nameOnList']}),
              icon: Icons.shield_outlined),
        ],
      ],
    );
  }
}

class CoverCarousel extends StatefulWidget {
  const CoverCarousel({super.key, required this.media, required this.couple, required this.line});
  final List<Json> media;
  final String couple;
  final String line;
  @override
  State<CoverCarousel> createState() => _CoverCarouselState();
}

class _CoverCarouselState extends State<CoverCarousel> {
  final _pc = PageController();
  int _i = 0;
  Timer? _auto;

  @override
  void initState() {
    super.initState();
    if (widget.media.length > 1) {
      _auto = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!_pc.hasClients) return;
        _pc.animateToPage((_i + 1) % widget.media.length, duration: const Duration(milliseconds: 600), curve: Curves.easeInOutCubic);
      });
    }
  }

  @override
  void dispose() {
    _auto?.cancel();
    _pc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.media.isEmpty ? [<String, dynamic>{'url': Art.homeCouple, 'type': 'image'}] : widget.media;
    final names = widget.couple.split(' & ');
    return Container(
      height: 250,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(22), boxShadow: IK.sh3, border: Border.all(color: IK.goldLine, width: 3)),
      clipBehavior: Clip.antiAlias,
      child: Stack(fit: StackFit.expand, children: [
        NotificationListener<ScrollStartNotification>(
          onNotification: (n) {
            if (n.dragDetails != null) _auto?.cancel(); // a swipe hands control to the guest for good
            return false;
          },
          child: PageView.builder(
            controller: _pc,
            itemCount: items.length,
            onPageChanged: (i) => setState(() => _i = i),
            itemBuilder: (c, i) {
              final m = items[i];
              final video = m['type'] == 'video';
              return Stack(fit: StackFit.expand, children: [
                Pic(video ? m['posterUrl'] as String? : m['url'] as String?, fallback: Art.homeCouple),
                if (video) const Center(child: Icon(Icons.play_circle_fill_rounded, color: Colors.white, size: 54)),
              ]);
            },
          ),
        ),
        IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.center, end: Alignment.bottomCenter, colors: [Colors.transparent, IK.ink.withValues(alpha: .8)])),
          ),
        ),
        Positioned(
          left: 16,
          right: 16,
          bottom: 14,
          child: IgnorePointer(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(
                TextSpan(children: [
                  TextSpan(text: names.first),
                  if (names.length > 1) const TextSpan(text: ' & ', style: TextStyle(color: IK.g3)),
                  if (names.length > 1) TextSpan(text: names.last),
                ]),
                style: IK.title(size: 32, color: Colors.white),
              ),
              const SizedBox(height: 2),
              Row(children: [
                const Icon(Icons.calendar_month_outlined, size: 13, color: IK.v1),
                const SizedBox(width: 5),
                Text(widget.line, style: IK.body(size: 12, color: IK.v1, weight: FontWeight.w600)),
              ]),
            ]),
          ),
        ),
        if (items.length > 1)
          Positioned(
            top: 12,
            right: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(color: Colors.black.withValues(alpha: .35), borderRadius: BorderRadius.circular(20)),
              child: Row(children: [
                for (var n = 0; n < items.length; n++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    width: n == _i ? 16 : 5,
                    height: 5,
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: n == _i ? 1 : .5), borderRadius: BorderRadius.circular(3)),
                  ),
              ]),
            ),
          ),
      ]),
    );
  }
}

class _CoupleCard extends StatelessWidget {
  const _CoupleCard({required this.bride, required this.groom, required this.fam, required this.city});
  final Json bride;
  final Json groom;
  final Json fam;
  final String city;

  @override
  Widget build(BuildContext context) {
    Widget side(String label, Json p) => Expanded(
          child: Column(children: [
            Text(tr(context, label), style: IK.kicker(size: 20)),
            const SizedBox(height: 2),
            Text('${p['name']}', textAlign: TextAlign.center, style: IK.title(size: 20)),
            if ((p['parents'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(tr(context, label == 'Bride' ? 'Daughter of {p}' : 'Son of {p}', {'p': p['parents']}), textAlign: TextAlign.center, style: IK.soft(size: 11)),
            ],
          ]),
        );
    return IkCard(
      padding: const EdgeInsets.fromLTRB(12, 16, 12, 16),
      child: Column(children: [
        Image.asset(Art.shubhVivah, height: 54),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          side('Bride', bride),
          Padding(padding: const EdgeInsets.only(top: 14), child: Image.asset(Art.gathbandhan, width: 54)),
          side('Groom', groom),
        ]),
        const SizedBox(height: 12),
        Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
          for (final k in ['brideSide', 'groomSide'])
            if (fam[k] is Map) Pill('${asJson(fam[k])['name']}', tone: Tone.violet, icon: Icons.groups_outlined),
          Pill(city, tone: Tone.violet, icon: Icons.location_on_outlined),
        ]),
      ]),
    );
  }
}

class _ThreadNode extends StatelessWidget {
  const _ThreadNode({required this.f, required this.last, required this.preview, required this.onBack});
  final Json f;
  final bool last;
  final bool preview;
  final Future<void> Function() onBack;

  @override
  Widget build(BuildContext context) {
    final mine = f['mine'] == true || preview;
    final color = hexColor('${f['color']}');
    final past = f['past'] == true;
    final rsvp = '${f['rsvp'] ?? 'none'}';
    final win = '${asJson(f['window'])['state']}';
    Widget status;
    if (!mine) {
      status = Text('${f['reason'] ?? ''}', style: IK.soft(size: 11));
    } else if (preview) {
      status = const SizedBox.shrink();
    } else if (rsvp == 'going') {
      status = Pill(tr(context, 'Going · {n}', {'n': f['pax']}), tone: Tone.ok, icon: Icons.check_rounded);
    } else if (rsvp == 'not_going') {
      status = Pill(tr(context, 'Not going'), tone: Tone.bad, icon: Icons.close_rounded);
    } else if (rsvp == 'maybe') {
      status = Pill(tr(context, 'Maybe'), tone: Tone.gold);
    } else if (win == 'open' || win == 'soon') {
      status = Pill(win == 'soon' ? tr(context, 'Reply closing soon') : tr(context, 'Reply needed'), tone: Tone.mag, icon: Icons.drafts_outlined);
    } else {
      status = Pill(tr(context, 'Replies closed'), tone: Tone.plain);
    }
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 26,
          child: Column(children: [
            const SizedBox(height: 18),
            Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(color: mine ? color : Colors.white, shape: BoxShape.circle, border: Border.all(color: color, width: 2.5)),
            ),
            if (!last) Expanded(child: Container(width: 2, color: IK.goldLine)),
          ]),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Opacity(
            opacity: mine ? (past ? .65 : 1) : .55,
            child: IkCard(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(12),
              onTap: mine && !preview
                  ? () async {
                      await push(context, FunctionScreen(weddingId: '${f['weddingId']}', functionId: '${f['id']}'));
                      await onBack();
                    }
                  : null,
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${f['dayLabel']} · ${f['timeLabel']}', style: IK.label(size: 9.5, color: color)),
                    const SizedBox(height: 2),
                    Text('${f['name']}', style: IK.h2(size: 19)),
                    Row(children: [
                      const Icon(Icons.location_on_outlined, size: 13, color: IK.ink4),
                      const SizedBox(width: 3),
                      Expanded(child: Text('${f['venueName']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.soft(size: 11.5))),
                    ]),
                    const SizedBox(height: 6),
                    Row(children: [
                      Flexible(child: status),
                      if (past) ...[const SizedBox(width: 6), Pill(tr(context, 'Finished'), tone: Tone.plain)],
                    ]),
                  ]),
                ),
                Image.asset(Art.forFunction('${f['name']}', '${f['icon'] ?? ''}'), height: 64),
                if (mine && !preview) const Icon(Icons.chevron_right_rounded, color: IK.ink4),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}

class Gallery extends StatelessWidget {
  const Gallery({super.key, required this.items});
  final List<Json> items;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (c, i) => const SizedBox(width: 8),
        itemBuilder: (c, i) => GestureDetector(
          onTap: () => Navigator.of(context).push(PageRouteBuilder(
            opaque: true,
            pageBuilder: (_, __, ___) => Lightbox(urls: items.map((m) => '${m['url']}').toList(), start: i),
          )),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Pic('${items[i]['url']}', width: 96, height: 120),
          ),
        ),
      ),
    );
  }
}

/// fully opaque photo viewer with pinch to zoom
class Lightbox extends StatefulWidget {
  const Lightbox({super.key, required this.urls, this.start = 0});
  final List<String> urls;
  final int start;
  @override
  State<Lightbox> createState() => _LightboxState();
}

class _LightboxState extends State<Lightbox> {
  late final PageController _pc = PageController(initialPage: widget.start);
  late int _i = widget.start;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(children: [
        PageView.builder(
          controller: _pc,
          itemCount: widget.urls.length,
          onPageChanged: (i) => setState(() => _i = i),
          itemBuilder: (c, i) => InteractiveViewer(maxScale: 4, child: Center(child: Pic(widget.urls[i], fit: BoxFit.contain))),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              SquareBtn(icon: Icons.close_rounded, dark: true, onTap: () => Navigator.of(context).pop()),
              const Spacer(),
              Text('${_i + 1} / ${widget.urls.length}', style: IK.monoS(size: 13, color: Colors.white)),
            ]),
          ),
        ),
      ]),
    );
  }
}

class VoicePlayer extends StatefulWidget {
  const VoicePlayer({super.key, required this.url});
  final String url;
  @override
  State<VoicePlayer> createState() => _VoicePlayerState();
}

class _VoicePlayerState extends State<VoicePlayer> {
  final _p = AudioPlayer();
  bool _playing = false;
  Duration _pos = Duration.zero;
  Duration _dur = Duration.zero;
  final _subs = <StreamSubscription>[];

  @override
  void initState() {
    super.initState();
    _subs.add(_p.onPlayerStateChanged.listen((s) => setState(() => _playing = s == PlayerState.playing)));
    _subs.add(_p.onPositionChanged.listen((d) => setState(() => _pos = d)));
    _subs.add(_p.onDurationChanged.listen((d) => setState(() => _dur = d)));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _p.dispose();
    super.dispose();
  }

  String _fmt(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final frac = _dur.inMilliseconds == 0 ? 0.0 : (_pos.inMilliseconds / _dur.inMilliseconds).clamp(0.0, 1.0);
    return IkCard(
      gradient: const LinearGradient(colors: [Color(0xFF4A1259), Color(0xFF2A0F3A)]),
      border: Colors.transparent,
      child: Row(children: [
        GestureDetector(
          onTap: () async {
            if (_playing) {
              await _p.pause();
            } else {
              await _p.play(UrlSource(widget.url));
            }
          },
          child: Container(
            width: 48,
            height: 48,
            decoration: const BoxDecoration(shape: BoxShape.circle, gradient: IK.goldGradient),
            child: Icon(_playing ? Icons.pause_rounded : Icons.play_arrow_rounded, color: IK.v9, size: 28),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr(context, 'A voice invitation from the hosts'), style: IK.strong(size: 13.5, color: Colors.white)),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(value: frac, minHeight: 4, backgroundColor: Colors.white24, color: IK.g4),
            ),
            const SizedBox(height: 4),
            Text('${_fmt(_pos)} / ${_fmt(_dur)}', style: IK.monoS(size: 10.5, color: IK.v2)),
          ]),
        ),
      ]),
    );
  }
}
