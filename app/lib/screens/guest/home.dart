import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';
import '../profile/host_apply.dart';
import 'agenda_model.dart';
import 'communities.dart';
import 'event_detail.dart';
import 'function.dart';
import 'notifications.dart';

/// My agenda: the date rail, the host's way into their console, the invitations card,
/// and every function and plan on the chosen day (or everything after it).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onOpenInvites});
  final VoidCallback onOpenInvites;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late DateTime _from;
  late DateTime _to;
  DateTime _picked = DateTime.now();
  String _view = 'day';
  List<AgendaItem> _items = [];
  Json _inv = {};
  bool _loading = true;
  Object? _error;
  Timer? _tick;
  final _rail = ScrollController();
  int _seenVersion = -1;

  @override
  void initState() {
    super.initState();
    _range(DateTime.now());
    _load();
    // live cards update their "in 20 min" line once a minute
    _tick = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final v = Session.of(context).dataVersion;
    if (_seenVersion != -1 && v != _seenVersion) _load();
    _seenVersion = v;
  }

  @override
  void dispose() {
    _tick?.cancel();
    _rail.dispose();
    super.dispose();
  }

  void _range(DateTime around) {
    final d = DateTime(around.year, around.month, around.day);
    _from = d.subtract(const Duration(days: 45));
    _to = d.add(const Duration(days: 200));
  }

  Future<void> _load() async {
    final api = Session.read(context).api;
    try {
      final q = {'from': ymd(_from), 'to': ymd(_to)};
      final res = await Future.wait([
        api.get('/v1/invitations/agenda', query: q),
        api.get('/v1/events', query: q),
        api.get('/v1/invitations'),
      ]);
      final items = <AgendaItem>[
        ...asList(res[0]).map(AgendaItem.fromFunction),
        ...asList(res[1]).expand(expandOwn),
      ]..sort((a, b) => a.start.compareTo(b.start));
      if (!mounted) return;
      setState(() {
        _items = items;
        _inv = asJson(res[2]);
        _loading = false;
        _error = null;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollRailTo(_picked, animate: false));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e;
      });
    }
  }

  List<DateTime> get _days {
    final out = <DateTime>[];
    for (var d = _from; d.isBefore(_to); d = d.add(const Duration(days: 1))) {
      out.add(DateTime(d.year, d.month, d.day));
    }
    return out;
  }

  void _scrollRailTo(DateTime d, {bool animate = true}) {
    if (!_rail.hasClients) return;
    final i = DateTime(d.year, d.month, d.day).difference(DateTime(_from.year, _from.month, _from.day)).inDays;
    final x = (i * 58.0 - 120).clamp(0.0, _rail.position.maxScrollExtent);
    animate ? _rail.animateTo(x, duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic) : _rail.jumpTo(x);
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _picked,
      firstDate: DateTime.now().subtract(const Duration(days: 3650)),
      lastDate: DateTime.now().add(const Duration(days: 3650)),
    );
    if (d == null) return;
    setState(() {
      _picked = d;
      _view = 'day';
    });
    if (d.isBefore(_from) || !d.isBefore(_to)) {
      _range(d);
      setState(() => _loading = true);
      await _load();
    } else {
      _scrollRailTo(d);
    }
  }

  Map<DateTime, List<AgendaItem>> get _byDay {
    final m = <DateTime, List<AgendaItem>>{};
    for (final it in _items) {
      (m[it.day] ??= []).add(it);
    }
    return m;
  }

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final byDay = _byDay;
    final pickedDay = DateTime(_picked.year, _picked.month, _picked.day);
    final today = byDay[pickedDay] ?? const <AgendaItem>[];
    final upcoming = _items.where((i) => i.day.isAfter(pickedDay)).toList();

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: IK.ivory,
        body: RefreshIndicator(
          color: IK.v6,
          onRefresh: () async {
            await _load();
            await s.refreshMe().catchError((_) {});
          },
          child: CustomScrollView(physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()), slivers: [
            SliverToBoxAdapter(child: _header(s, byDay)),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  _HostGate(),
                  _InvitesCard(data: _inv, onOpen: widget.onOpenInvites),
                  const SizedBox(height: 16),
                  Segmented(
                    items: [
                      ('day', '${sameDay(_picked, DateTime.now()) ? tr(context, 'Today') : DateFormat('d MMM').format(_picked)} · ${today.length}'),
                      ('next', '${tr(context, 'Upcoming')} · ${upcoming.length}'),
                    ],
                    value: _view,
                    onChanged: (v) => setState(() => _view = v),
                  ),
                  const SizedBox(height: 6),
                ]),
              ),
            ),
            if (_loading)
              const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator(color: IK.v5))))
            else if (_error != null)
              SliverToBoxAdapter(
                child: EmptyState(
                  art: Art.lanterns,
                  title: tr(context, 'That did not load'),
                  body: '$_error',
                  action: IkButton(tr(context, 'Try again'), compact: true, icon: Icons.refresh_rounded, onPressed: () {
                    setState(() => _loading = true);
                    _load();
                  }),
                ),
              )
            else if (_view == 'day')
              ..._dayList(today)
            else
              ..._upcomingList(upcoming),
            const SliverToBoxAdapter(child: SizedBox(height: 30)),
          ]),
        ),
      ),
    );
  }

  Widget _header(Session s, Map<DateTime, List<AgendaItem>> byDay) {
    final top = MediaQuery.paddingOf(context).top;
    final h = DateTime.now().hour;
    final greet = h < 12 ? tr(context, 'Good morning') : (h < 17 ? tr(context, 'Good afternoon') : tr(context, 'Good evening'));
    final days = _days;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF2C1558),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(children: [
        Positioned.fill(child: Opacity(opacity: .55, child: Image.asset(Art.homeHeader, fit: BoxFit.cover, alignment: Alignment.centerRight))),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [const Color(0xFF1E0B40).withValues(alpha: .95), const Color(0xFF2C1558).withValues(alpha: .55)]),
            ),
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(16, top + 12, 16, 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('$greet, ${s.firstName} ${h < 17 ? '☀️' : '🌙'}', style: IK.body(size: 12.5, color: IK.v2, weight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(tr(context, '{name}’s Agenda', {'name': s.firstName}),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontFamily: IK.display, fontSize: 21, fontWeight: FontWeight.w700, color: IK.paper)),
                  const SizedBox(height: 2),
                  Text(tr(context, 'Plan. Organize. Celebrate.'), style: IK.body(size: 11.5, color: IK.g4, weight: FontWeight.w700)),
                ]),
              ),
              SquareBtn(icon: Icons.notifications_none_rounded, dark: true, badge: s.unread, onTap: () async {
                await push(context, const NotificationsScreen());
                s.refreshMe().catchError((_) {});
              }),
              const SizedBox(width: 10),
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(shape: BoxShape.circle, gradient: IK.goldGradient),
                alignment: Alignment.center,
                child: Text(initialsOf(s.fullName), style: const TextStyle(fontFamily: IK.serif, fontWeight: FontWeight.w700, fontSize: 16, color: IK.v9)),
              ),
            ]),
            const SizedBox(height: 14),
            GestureDetector(
              onTap: () => push(context, const CommunitiesScreen()),
              child: Container(
                height: 46,
                padding: const EdgeInsets.only(left: 14, right: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(color: Colors.white.withValues(alpha: .16)),
                ),
                child: Row(children: [
                  Icon(Icons.search_rounded, color: IK.v2.withValues(alpha: .8), size: 19),
                  const SizedBox(width: 9),
                  Expanded(child: Text(tr(context, 'Community, guru, venue, area…'), style: IK.body(size: 13, color: IK.v2.withValues(alpha: .7)))),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                    decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFFE11D74), Color(0xFFA21CAF)]), borderRadius: BorderRadius.circular(11)),
                    child: Text(tr(context, 'Search'), style: IK.strong(size: 12, color: Colors.white)),
                  ),
                ]),
              ),
            ),
            const SizedBox(height: 14),
            Row(children: [
              Text(DateFormat('MMMM').format(_picked), style: IK.strong(size: 13, color: IK.paper)),
              const SizedBox(width: 6),
              Text(DateFormat('yyyy').format(_picked), style: IK.strong(size: 13, color: IK.g4)),
              const Spacer(),
              if (!sameDay(_picked, DateTime.now()))
                GestureDetector(
                  onTap: () {
                    setState(() => _picked = DateTime.now());
                    _scrollRailTo(DateTime.now());
                  },
                  child: Row(children: [
                    const Icon(Icons.undo_rounded, size: 14, color: IK.g3),
                    const SizedBox(width: 4),
                    Text(tr(context, 'Today'), style: IK.strong(size: 12, color: IK.g3)),
                  ]),
                ),
            ]),
            const SizedBox(height: 10),
            SizedBox(
              height: 74,
              child: Row(children: [
                Expanded(
                  child: ListView.builder(
                    controller: _rail,
                    scrollDirection: Axis.horizontal,
                    itemCount: days.length,
                    itemExtent: 58,
                    itemBuilder: (context, i) => _railCell(days[i], byDay[days[i]] ?? const []),
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: _pickDate,
                  child: Container(
                    width: 50,
                    height: 70,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .08),
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(color: Colors.white.withValues(alpha: .14)),
                    ),
                    padding: const EdgeInsets.all(8),
                    child: Image.asset(Art.calPurple),
                  ),
                ),
              ]),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _railCell(DateTime d, List<AgendaItem> items) {
    final on = sameDay(d, _picked);
    final isToday = sameDay(d, DateTime.now());
    final dots = <Color>[];
    if (items.any((i) => i.isFn)) dots.add(IK.mag);
    if (items.any((i) => !i.isFn)) dots.add(IK.warn);
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        setState(() {
          _picked = d;
          _view = 'day';
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.symmetric(horizontal: 3),
        decoration: BoxDecoration(
          gradient: on ? const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFE11D74), Color(0xFF9D174D)]) : null,
          color: on ? null : Colors.white.withValues(alpha: .96),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: on ? Colors.transparent : IK.goldLine),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(isToday ? tr(context, 'TODAY') : DateFormat('E').format(d).toUpperCase(),
              style: TextStyle(fontFamily: IK.sans, fontSize: 8.5, fontWeight: FontWeight.w800, letterSpacing: .6, color: on ? Colors.white : IK.ink3)),
          Text('${d.day}', style: TextStyle(fontFamily: IK.serif, fontSize: 21, fontWeight: FontWeight.w700, height: 1.1, color: on ? Colors.white : IK.plum)),
          Text(DateFormat('MMM').format(d).toUpperCase(),
              style: TextStyle(fontFamily: IK.sans, fontSize: 8, fontWeight: FontWeight.w700, color: on ? Colors.white70 : IK.ink4)),
          const SizedBox(height: 3),
          SizedBox(
            height: 5,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (final c in dots) Container(width: 5, height: 5, margin: const EdgeInsets.symmetric(horizontal: 1.5), decoration: BoxDecoration(color: on ? Colors.white : c, shape: BoxShape.circle)),
            ]),
          ),
        ]),
      ),
    );
  }

  List<Widget> _dayList(List<AgendaItem> items) {
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: EmptyState(
            art: Art.cal3d,
            title: tr(context, 'A free day'),
            body: tr(context, 'Nothing on this date. Tap + to add a plan, or scan an invitation card.'),
          ),
        ),
      ];
    }
    final now = DateTime.now();
    final live = items.where((i) => i.state(now) == 'live' || i.state(now) == 'allday').toList();
    final later = items.where((i) => i.state(now) == 'later').toList();
    final done = items.where((i) => i.state(now) == 'done').toList();
    final out = <Widget>[];
    void group(String title, List<AgendaItem> list, {bool hot = false}) {
      if (list.isEmpty) return;
      out.add(SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: SectionTitle(title, count: list.length, top: 14, trailing: hot ? const Pill('LIVE', tone: Tone.live, size: 9) : null),
        ),
      ));
      out.add(SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        sliver: SliverList.builder(itemCount: list.length, itemBuilder: (c, i) => AgendaCard(item: list[i], onChanged: _load)),
      ));
    }

    group(tr(context, 'Happening now'), live, hot: live.any((i) => i.state(now) == 'live'));
    group(tr(context, 'Later'), later);
    group(tr(context, 'Done'), done);
    return out;
  }

  List<Widget> _upcomingList(List<AgendaItem> items) {
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: EmptyState(art: Art.cal3d, title: tr(context, 'Nothing ahead yet'), body: tr(context, 'New invitations and the plans you add will appear here.')),
        ),
      ];
    }
    final groups = <DateTime, List<AgendaItem>>{};
    for (final i in items) {
      (groups[i.day] ??= []).add(i);
    }
    return [
      for (final e in groups.entries) ...[
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: SectionTitle('${tr(context, relDay(e.key))} · ${weekdayDay(e.key)}', count: e.value.length, top: 14),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          sliver: SliverList.builder(itemCount: e.value.length, itemBuilder: (c, i) => AgendaCard(item: e.value[i], onChanged: _load)),
        ),
      ],
    ];
  }
}

/// one agenda row: picture, name, place, a live status line, and the reply tag
class AgendaCard extends StatelessWidget {
  const AgendaCard({super.key, required this.item, this.onChanged});
  final AgendaItem item;
  final VoidCallback? onChanged;

  String _status(BuildContext context) {
    final now = DateTime.now();
    switch (item.state(now)) {
      case 'done':
        return tr(context, 'Finished');
      case 'allday':
        return tr(context, 'All day');
      case 'live':
        final left = item.end.difference(now).inMinutes;
        return '${tr(context, 'Live')} · ${left >= 60 ? '${left ~/ 60} h ${left % 60} min' : '$left min'} ${tr(context, 'left')}';
      default:
        final mins = item.start.difference(now).inMinutes;
        if (mins < 60) return tr(context, 'In {n} min', {'n': mins});
        if (mins < 24 * 60) return '${tr(context, 'In {n} h', {'n': mins ~/ 60})} · ${clock(item.start)}';
        return clock(item.start);
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = item.state();
    final tag = item.tag;
    final accent = item.isFn ? hexColor('${item.raw['color']}', IK.mag) : IK.warn;
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      leftAccent: st == 'done' ? IK.line2 : accent,
      onTap: () async {
        if (item.isFn) {
          await push(context, FunctionScreen(weddingId: '${item.raw['weddingId']}', functionId: '${item.raw['id']}'));
        } else {
          await push(context, EventDetailScreen(event: item.raw));
        }
        onChanged?.call();
      },
      child: Opacity(
        opacity: st == 'done' ? .6 : 1,
        child: Row(children: [
          PicThumb(item.image, contain: item.imageContain),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.h2(size: 18)),
              const SizedBox(height: 1),
              Text(item.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.soft(size: 11.5)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Pill(_status(context),
                    tone: st == 'live' ? Tone.live : (st == 'done' ? Tone.plain : Tone.info),
                    icon: st == 'live' ? null : (st == 'done' ? Icons.check_rounded : Icons.schedule_rounded)),
                if (tag == 'need') Pill(tr(context, 'Reply needed'), tone: Tone.mag, icon: Icons.drafts_outlined),
                if (tag == 'ok') Pill(tr(context, 'Going'), tone: Tone.ok, icon: Icons.check_rounded),
                if (tag == 'no') Pill(tr(context, 'Not going'), tone: Tone.bad, icon: Icons.close_rounded),
                if (!item.isFn) Pill(tr(context, 'Mine'), tone: Tone.gold),
              ]),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: IK.ink4),
        ]),
      ),
    );
  }
}

/// the host's doorway into their console (or into hosting at all)
class _HostGate extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final access = s.hostAccess;
    if (access == 'granted') {
      final h = s.activeHosting!;
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(gradient: IK.consoleGradient, borderRadius: BorderRadius.circular(22), boxShadow: IK.sh3),
        clipBehavior: Clip.antiAlias,
        child: Stack(children: [
          Positioned(left: -10, top: 0, bottom: 0, child: Opacity(opacity: .25, child: Image.asset(Art.floral, fit: BoxFit.fitHeight))),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              ClipRRect(borderRadius: BorderRadius.circular(16), child: Image.asset(Art.homeCouple, width: 76, height: 96, fit: BoxFit.cover)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    const Icon(Icons.favorite_rounded, size: 12, color: IK.g4),
                    const SizedBox(width: 5),
                    Text(tr(context, 'YOUR WEDDING'), style: IK.label(size: 9.5, color: IK.g4)),
                    if (s.role != 'owner') ...[
                      const SizedBox(width: 6),
                      Pill(s.isGiftDesk ? tr(context, 'Gift desk') : tr(context, 'Family'), tone: Tone.gold, size: 8.5),
                    ],
                  ]),
                  const SizedBox(height: 4),
                  Text('${h['couple']}', style: IK.title(size: 24, color: Colors.white)),
                  const SizedBox(height: 2),
                  Text('${span(h['startDate'], h['endDate'])} · ${h['city']}', style: IK.body(size: 11.5, color: IK.v2)),
                  const SizedBox(height: 10),
                  IkButton(tr(context, 'Open wedding console'), kind: BtnKind.gold, compact: true, icon: Icons.arrow_forward_rounded, onPressed: () {
                    Navigator.of(context).popUntil((r) => r.isFirst);
                    s.enterHost('${h['weddingId']}');
                  }),
                ]),
              ),
            ]),
          ),
        ]),
      );
    }
    if (access == 'pending') {
      return IkCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Row(children: [
          Image.asset(Art.hourglass, height: 56),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(tr(context, 'Your wedding is being set up'), style: IK.h2(size: 18)),
              const SizedBox(height: 2),
              Text(tr(context, 'Our team has your application. We will message you on WhatsApp when the console is ready.'), style: IK.soft(size: 12)),
            ]),
          ),
        ]),
      );
    }
    return IkCard(
      margin: const EdgeInsets.only(bottom: 12),
      onTap: () => push(context, const HostApplyScreen()),
      child: Row(children: [
        Image.asset(Art.jaimala, height: 60),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(tr(context, 'Hosting a wedding?'), style: IK.h2(size: 18)),
            const SizedBox(height: 2),
            Text(tr(context, 'Our team sets up every function and your whole guest list for you.'), style: IK.soft(size: 12)),
          ]),
        ),
        const Icon(Icons.chevron_right_rounded, color: IK.ink4),
      ]),
    );
  }
}

class _InvitesCard extends StatelessWidget {
  const _InvitesCard({required this.data, required this.onOpen});
  final Json data;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final weddings = asList(data['weddings']);
    final reply = weddings.fold<int>(0, (a, w) => a + toInt(w['needsReply']));
    final fns = weddings.fold<int>(0, (a, w) => a + toInt(w['myFunctions']));
    final body = weddings.isEmpty
        ? tr(context, 'When a family invites you, their wedding appears here with every function you are invited to.')
        : tr(context, '{w} weddings, every function you are invited to, with the dates, the venue and your reply.', {'w': weddings.length});
    return GestureDetector(
      onTap: onOpen,
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF4A1259), Color(0xFF2A0F3A)]),
          borderRadius: BorderRadius.circular(22),
          boxShadow: IK.sh3,
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Pic(weddings.isNotEmpty ? weddings.first['cover'] as String? : null, fallback: Art.homeCouple, width: 76, height: 96),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.drafts_outlined, size: 12, color: IK.g4),
                  const SizedBox(width: 5),
                  Text(tr(context, 'YOUR INVITATIONS'), style: IK.label(size: 9.5, color: IK.g4)),
                ]),
                const SizedBox(height: 4),
                Text(tr(context, 'Check all your wedding invites'), style: IK.h2(size: 19, color: Colors.white)),
                const SizedBox(height: 4),
                Text(body, maxLines: 3, overflow: TextOverflow.ellipsis, style: IK.body(size: 11.5, color: IK.v2, height: 1.4)),
                const SizedBox(height: 8),
                Row(children: [
                  if (reply > 0) ...[Pill(tr(context, '{n} to reply', {'n': reply}), tone: Tone.mag), const SizedBox(width: 6)],
                  if (fns > 0) Pill(tr(context, '{n} functions', {'n': fns}), tone: Tone.gold),
                  const Spacer(),
                  const Icon(Icons.arrow_forward_rounded, color: IK.g3, size: 20),
                ]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
