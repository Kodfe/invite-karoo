import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../auth/auth_ui.dart';
import 'host_home.dart';
import 'host_remind.dart';
import 'host_rsvp.dart';

/// The whole guest list, filterable by function, reply, side and app.
class HostGuestsScreen extends StatefulWidget {
  const HostGuestsScreen({super.key, required this.weddingId});
  final String weddingId;
  @override
  State<HostGuestsScreen> createState() => _HostGuestsScreenState();
}

class _HostGuestsScreenState extends State<HostGuestsScreen> {
  String _who = 'all'; // all | pending | noapp | removed
  String _fn = '';
  String _side = '';
  String _q = '';
  Timer? _debounce;
  int _limit = 100;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(widget.weddingId);
    final desk = s.isGiftDesk;
    return Loader<(Json, List<Json>)>(
      version: '$_who|$_fn|$_side|$_q|$_limit|${s.dataVersion}',
      load: () async {
        final res = await Future.wait([
          s.api.get('$base/guests', query: {
            'fn': _fn,
            'status': _who == 'pending' && _fn.isNotEmpty ? 'pending' : null,
            'side': _side,
            'q': _q,
            'app': _who == 'noapp' ? 'no' : null,
            'removed': _who == 'removed' ? '1' : null,
            'limit': _limit,
          }),
          s.api.get('$base/functions'),
        ]);
        return (asJson(res[0]), asList(res[1]));
      },
      builder: (context, data, reload) {
        final (d, fns) = data;
        var guests = asList(d['guests']);
        // "not confirmed" across the whole wedding: no reply on any of their functions
        if (_who == 'pending' && _fn.isEmpty) {
          guests = guests.where((g) => asList(g['functions']).any((f) => f['rsvp'] == 'none')).toList();
        }
        final total = toInt(d['total']);
        return IkPage(
          onRefresh: reload,
          floating: desk
              ? null
              : FloatingActionButton.extended(
                  backgroundColor: IK.v7,
                  foregroundColor: Colors.white,
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  label: Text(tr(context, 'Add guest')),
                  onPressed: () async {
                    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => AddGuestScreen(weddingId: widget.weddingId, functions: fns)));
                    if (ok == true) await reload();
                  },
                ),
          header: IkHeader(
            back: false,
            title: tr(context, 'Guests'),
            sub: tr(context, '{n} invited across {f} functions', {'n': total, 'f': fns.length}),
            art: Art.family,
          ),
          children: [
            TextField(
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 400), () => setState(() => _q = v.trim()));
              },
              decoration: InputDecoration(hintText: tr(context, 'Name, number or relation'), prefixIcon: const Icon(Icons.search_rounded, color: IK.ink4)),
            ),
            const SizedBox(height: 12),
            ChipTabs(
              items: [
                ('all', tr(context, 'Everyone')),
                ('pending', tr(context, 'Not confirmed')),
                ('noapp', tr(context, 'WhatsApp only')),
                ('removed', tr(context, 'Removed')),
              ],
              value: _who,
              onChanged: (v) => setState(() => _who = v),
            ),
            const SizedBox(height: 8),
            ChipTabs(
              items: [('', tr(context, 'All functions')), for (final f in fns) ('${f['id']}', '${f['name']}')],
              value: _fn,
              onChanged: (v) => setState(() => _fn = v),
            ),
            const SizedBox(height: 8),
            ChipTabs(
              items: [('', tr(context, 'Both sides')), ('bride', tr(context, 'Bride’s side')), ('groom', tr(context, 'Groom’s side'))],
              value: _side,
              onChanged: (v) => setState(() => _side = v),
            ),
            const SizedBox(height: 12),
            Text(tr(context, '{n} guests', {'n': guests.length}), style: IK.label()),
            const SizedBox(height: 8),
            if (guests.isEmpty)
              EmptyState(art: Art.family, title: tr(context, 'No one matches'), body: tr(context, 'Try another filter or search.'))
            else
              IkGroup(children: [for (final g in guests) _GuestRow(g: g, fns: fns, weddingId: widget.weddingId, onBack: reload)]),
            if (total > guests.length && _who != 'pending')
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: IkButton(tr(context, 'Show more'), kind: BtnKind.ghost, compact: true, onPressed: () => setState(() => _limit += 100)),
              ),
            const SizedBox(height: 80),
          ],
        );
      },
    );
  }
}

class _GuestRow extends StatelessWidget {
  const _GuestRow({required this.g, required this.fns, required this.weddingId, required this.onBack});
  final Json g;
  final List<Json> fns;
  final String weddingId;
  final Future<void> Function() onBack;

  @override
  Widget build(BuildContext context) {
    final inv = asList(g['functions']);
    final going = inv.where((i) => i['rsvp'] == 'going').length;
    final pending = inv.where((i) => i['rsvp'] == 'none').length;
    final no = inv.where((i) => i['rsvp'] == 'not_going').length;
    return InkWell(
      onTap: () async {
        await push(context, HostGuestScreen(weddingId: weddingId, guestId: '${g['id']}'));
        await onBack();
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        child: Row(children: [
          Avatar(name: '${g['name']}', size: 40),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text('${g['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.strong(size: 13.5))),
                const SizedBox(width: 6),
                for (final i in inv) Padding(padding: const EdgeInsets.only(right: 2), child: Dot(hexColor('${fns.where((f) => f['id'] == i['functionId']).firstOrNull?['color']}'), size: 6)),
              ]),
              Text('${g['relation']} · ${g['phonePretty']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: IK.soft(size: 11)),
            ]),
          ),
          const SizedBox(width: 6),
          if (g['active'] == false)
            Pill(tr(context, 'Removed'), tone: Tone.plain)
          else if (going > 0 && pending == 0)
            Pill(tr(context, 'Coming'), tone: Tone.ok)
          else if (no == inv.length && inv.isNotEmpty)
            Pill(tr(context, 'Not coming'), tone: Tone.bad)
          else if (going > 0)
            Pill('$going/${inv.length}', tone: Tone.ok)
          else
            Pill(tr(context, 'No reply'), tone: Tone.plain),
        ]),
      ),
    );
  }
}

class HostGuestScreen extends StatelessWidget {
  const HostGuestScreen({super.key, required this.weddingId, required this.guestId});
  final String weddingId;
  final String guestId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(weddingId);
    final desk = s.isGiftDesk;
    return Loader<Json>(
      version: s.dataVersion,
      load: () async => asJson(await s.api.get('$base/guests/$guestId')),
      builder: (context, g, reload) {
        final fns = asList(g['functions']);
        final invited = fns.where((f) => f['invite'] != null).toList();
        final others = fns.where((f) => f['invite'] == null).toList();
        final gifts = asList(g['giftsReceived']);
        final removed = g['active'] == false;
        return IkPage(
          onRefresh: reload,
          header: IkHeader(
            title: '${g['name']}',
            sub: '${g['relation']} · ${g['side'] == 'bride' ? tr(context, 'Bride’s side') : tr(context, 'Groom’s side')}',
            art: Art.a('cplStand'),
            actions: [
              if (!desk)
                SquareBtn(icon: Icons.edit_outlined, onTap: () async {
                  final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => EditGuestScreen(weddingId: weddingId, g: g)));
                  if (ok == true) await reload();
                }),
            ],
          ),
          children: [
            IkCard(
              child: Column(children: [
                Avatar(name: '${g['name']}', size: 76),
                const SizedBox(height: 10),
                Text('${g['name']}', style: IK.title(size: 24)),
                Text('${g['phonePretty']}', style: IK.monoS(size: 13, color: IK.ink2)),
                const SizedBox(height: 8),
                Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
                  if ('${g['relation']}'.isNotEmpty) Pill('${g['relation']}', tone: Tone.violet),
                  Pill(g['side'] == 'bride' ? tr(context, 'Bride’s side') : tr(context, 'Groom’s side'), tone: Tone.mag),
                  Pill(g['appJoined'] == true ? tr(context, 'Has the app') : tr(context, 'WhatsApp only'), tone: g['appJoined'] == true ? Tone.ok : Tone.plain),
                  if (removed) Pill(tr(context, 'Removed'), tone: Tone.bad),
                ]),
                if ('${g['notes'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${g['notes']}', textAlign: TextAlign.center, style: IK.soft(size: 12))),
                const SizedBox(height: 14),
                Row(children: [
                  Expanded(child: IkButton(tr(context, 'Call'), kind: BtnKind.ghost, compact: true, icon: Icons.call_outlined, onPressed: () => launchUrl(Uri.parse('tel:${g['phone']}')))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: IkButton('WhatsApp', kind: BtnKind.whatsapp, compact: true, leading: Image.asset(Art.whatsappWhite, width: 16),
                        onPressed: () => launchUrl(Uri.parse('https://wa.me/${'${g['phone']}'.replaceAll('+', '')}'), mode: LaunchMode.externalApplication)),
                  ),
                ]),
              ]),
            ),
            SectionTitle(tr(context, 'Invited to'), count: invited.length),
            for (final f in invited) _InviteCard(f: f, g: g, weddingId: weddingId, reload: reload, desk: desk || removed),
            if (!desk && !removed && others.isNotEmpty) ...[
              SectionTitle(tr(context, 'Not on these functions')),
              IkGroup(children: [
                for (final f in others)
                  IkRow(
                    image: Art.forFunction('${f['name']}'),
                    title: '${f['name']}',
                    sub: '${f['dayLabel']} · ${f['timeLabel']}',
                    trailing: IkButton(tr(context, 'Add'), compact: true, kind: BtnKind.ghost, icon: Icons.add_rounded, onPressed: () async {
                      final r = await guard(context, () => s.api.put('$base/guests/$guestId/functions/${f['functionId']}', {'invited': true}));
                      if (r != null) {
                        s.touch();
                        await reload();
                      }
                    }),
                  ),
              ]),
            ],
            if (gifts.isNotEmpty) ...[
              SectionTitle(tr(context, 'Gifts from them'), count: gifts.length),
              IkGroup(children: [
                for (final x in gifts)
                  IkRow(
                    icon: Icons.redeem_rounded,
                    iconColor: IK.goldInk,
                    iconBg: IK.g1,
                    title: x['amount'] != null ? rupees(toInt(x['amount'])) : '${x['itemName']}',
                    sub: '${asJson(x['category'])['label']} · ${fns.where((f) => f['functionId'] == x['functionId']).firstOrNull?['name'] ?? ''} · ${x['recordedBy']}',
                  ),
              ]),
            ],
            if (!desk) ...[
              const SizedBox(height: 20),
              if (removed)
                IkButton(tr(context, 'Put back on the list'), kind: BtnKind.ghost, icon: Icons.undo_rounded, onPressed: () async {
                  final r = await guard(context, () => s.api.post('$base/guests/$guestId/restore'));
                  if (r != null) {
                    s.touch();
                    await reload();
                  }
                })
              else
                IkButton(tr(context, 'Take off the guest list'), kind: BtnKind.danger, icon: Icons.person_remove_outlined, onPressed: () async {
                  final ok = await confirmSheet(context,
                      title: tr(context, 'Take {n} off the list?', {'n': g['name']}),
                      body: tr(context, 'For a wrong number or someone added twice. Their replies are kept, and you can put them back. They are told in the app only — never on WhatsApp.'),
                      confirm: tr(context, 'Take off the list'),
                      danger: true);
                  if (!ok || !context.mounted) return;
                  final r = await guard(context, () => s.api.delete('$base/guests/$guestId'));
                  if (r != null) {
                    s.touch();
                    await reload();
                  }
                }),
            ],
          ],
        );
      },
    );
  }
}

class _InviteCard extends StatelessWidget {
  const _InviteCard({required this.f, required this.g, required this.weddingId, required this.reload, required this.desk});
  final Json f;
  final Json g;
  final String weddingId;
  final Future<void> Function() reload;
  final bool desk;

  @override
  Widget build(BuildContext context) {
    final s = Session.read(context);
    final i = asJson(f['invite']);
    final rsvp = '${i['rsvp']}';
    final color = hexColor('${f['color']}');
    final (bg, fg, icon, text) = switch (rsvp) {
      'going' => (IK.okBg, IK.ok, Icons.check_circle_rounded, tr(context, 'Coming · {n} people', {'n': i['pax']})),
      'maybe' => (IK.g1, IK.g6, Icons.help_rounded, tr(context, 'Maybe')),
      'not_going' => (IK.badBg, IK.bad, Icons.cancel_rounded, tr(context, 'Not coming')),
      _ => (IK.paper2, IK.ink3, Icons.hourglass_empty_rounded, tr(context, 'No reply yet')),
    };
    return IkCard(
      margin: const EdgeInsets.only(bottom: 10),
      leftAccent: color,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Image.asset(Art.forFunction('${f['name']}'), width: 46, height: 46),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${f['dayLabel']} · ${f['timeLabel']}', style: IK.label(size: 9.5, color: color)),
              Text('${f['name']}', style: IK.h2(size: 18)),
            ]),
          ),
          if (i['giftOut'] == true) Pill(i['giftOutGiven'] == true ? tr(context, 'Gift given') : tr(context, 'Gift'), tone: Tone.mag, icon: Icons.card_giftcard_rounded),
        ]),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(13)),
          child: Row(children: [
            Icon(icon, color: fg, size: 22),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(text, style: IK.strong(size: 13, color: fg)),
                if (i['respondedAt'] != null)
                  Text('${i['byHost'] == true ? tr(context, 'Marked by family') : tr(context, 'Replied in the app')} · ${ago(i['respondedAt'])}', style: IK.soft(size: 11)),
                if ('${i['remark'] ?? ''}'.isNotEmpty) Text('“${i['remark']}”', style: IK.soft(size: 11)),
              ]),
            ),
          ]),
        ),
        if (!desk) ...[
          const SizedBox(height: 10),
          Row(children: [
            if (f['past'] != true)
              Expanded(
                child: IkButton(tr(context, 'Remind'), compact: true, kind: BtnKind.dark, icon: Icons.notifications_active_outlined,
                    onPressed: () => push(context, HostRemindScreen(weddingId: weddingId, functionId: '${f['functionId']}', presetAudience: 'one', guestIds: ['${g['id']}'], guestName: '${g['name']}'))),
              ),
            if (f['past'] != true) const SizedBox(width: 8),
            Expanded(
              child: IkButton(tr(context, 'Change reply'), compact: true, kind: BtnKind.ghost, icon: Icons.edit_note_rounded, onPressed: () async {
                final ok = await markReplySheet(context, weddingId: weddingId, inviteId: '${i['id']}', name: '${g['name']}', current: rsvp, pax: toInt(i['pax']), remark: '${i['remark'] ?? ''}');
                if (ok) await reload();
              }),
            ),
            const SizedBox(width: 4),
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_horiz_rounded, color: IK.ink3),
              onSelected: (v) async {
                final base = hostBase(weddingId);
                Object? r;
                if (v == 'gift') r = await guard(context, () => s.api.put('$base/guests/${g['id']}/functions/${f['functionId']}', {'invited': true, 'giftOut': !(i['giftOut'] == true)}));
                if (v == 'remove') r = await guard(context, () => s.api.put('$base/guests/${g['id']}/functions/${f['functionId']}', {'invited': false}));
                if (r != null) {
                  s.touch();
                  await reload();
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'gift', child: Text(i['giftOut'] == true ? tr(context, 'Take off the gift list') : tr(context, 'Put on the gift list'))),
                PopupMenuItem(value: 'remove', child: Text(tr(context, 'Remove from this function'), style: const TextStyle(color: IK.bad))),
              ],
            ),
          ]),
        ],
      ]),
    );
  }
}

/// add a guest the team did not import — the host's own late additions
class AddGuestScreen extends StatefulWidget {
  const AddGuestScreen({super.key, required this.weddingId, required this.functions});
  final String weddingId;
  final List<Json> functions;
  @override
  State<AddGuestScreen> createState() => _AddGuestScreenState();
}

class _AddGuestScreenState extends State<AddGuestScreen> {
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _relation = TextEditingController();
  final _notes = TextEditingController();
  String _cc = '+91';
  String _side = 'groom';
  int _pax = 1;
  final Map<String, bool> _fns = {}; // functionId → gift
  Map<String, String> _errs = {};
  bool _busy = false;

  Future<void> _save() async {
    final e = <String, String>{};
    if (_name.text.trim().isEmpty) e['name'] = tr(context, 'Enter a name');
    if (_mobile.text.trim().length < 8) e['phone'] = tr(context, 'Enter a valid mobile number');
    if (_fns.isEmpty) e['functions'] = tr(context, 'Pick at least one function');
    setState(() => _errs = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    final s = Session.read(context);
    try {
      await s.api.post('${hostBase(widget.weddingId)}/guests', {
        'name': _name.text.trim(),
        'phone': _mobile.text.trim(),
        'cc': _cc,
        'side': _side,
        'relation': _relation.text.trim(),
        'expectedPax': _pax,
        'notes': _notes.text.trim(),
        'functions': [for (final x in _fns.entries) {'functionId': x.key, 'giftOut': x.value}],
      });
      s.touch();
      if (!mounted) return;
      toast(context, tr(context, 'Added to the guest list'));
      Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      setState(() => _errs = err.fields);
      if (mounted) showError(context, err);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return IkPage(
      header: IkHeader(title: tr(context, 'Add a guest'), sub: tr(context, 'Pick the functions they are invited to'), art: Art.family),
      bottom: BottomBar(child: IkButton(tr(context, 'Add to the list'), icon: Icons.person_add_alt_1_rounded, loading: _busy, onPressed: _save)),
      children: [
        Field(label: tr(context, 'Name'), required: true, controller: _name, error: _errs['name'], capitalization: TextCapitalization.words, maxLength: 60),
        Padding(padding: const EdgeInsets.only(bottom: 15), child: PhoneField(cc: _cc, controller: _mobile, onCc: (v) => setState(() => _cc = v), error: _errs['phone'])),
        Row(children: [
          Expanded(child: Field(label: tr(context, 'Relation'), controller: _relation, hint: tr(context, 'e.g. Cousin'), capitalization: TextCapitalization.words, maxLength: 40)),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 15),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tr(context, 'SIDE'), style: IK.label()),
                const SizedBox(height: 7),
                Segmented(items: [('bride', tr(context, 'Bride')), ('groom', tr(context, 'Groom'))], value: _side, onChanged: (v) => setState(() => _side = v)),
              ]),
            ),
          ),
        ]),
        Row(children: [
          Expanded(child: Text(tr(context, 'Expected people'), style: IK.strong(size: 13.5))),
          IconButton(onPressed: _pax > 1 ? () => setState(() => _pax--) : null, icon: const Icon(Icons.remove_circle_outline_rounded)),
          Text('$_pax', style: IK.title(size: 22)),
          IconButton(onPressed: _pax < 20 ? () => setState(() => _pax++) : null, icon: const Icon(Icons.add_circle_outline_rounded)),
        ]),
        SectionTitle(tr(context, 'Invited to'), top: 10),
        if (_errs['functions'] != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_errs['functions']!, style: IK.body(size: 12, color: IK.bad))),
        IkGroup(children: [
          for (final f in widget.functions)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Row(children: [
                Checkbox(
                  value: _fns.containsKey('${f['id']}'),
                  activeColor: IK.v6,
                  onChanged: (v) => setState(() => v == true ? _fns['${f['id']}'] = false : _fns.remove('${f['id']}')),
                ),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${f['name']}', style: IK.strong(size: 13.5)),
                    Text('${f['dayLabel']} · ${f['timeLabel']}', style: IK.soft(size: 11)),
                  ]),
                ),
                if (_fns.containsKey('${f['id']}'))
                  FilterChip(
                    label: Text(tr(context, 'Gift')),
                    avatar: const Icon(Icons.card_giftcard_rounded, size: 15),
                    selected: _fns['${f['id']}'] == true,
                    onSelected: (v) => setState(() => _fns['${f['id']}'] = v),
                  ),
              ]),
            ),
        ]),
        const SizedBox(height: 14),
        Field(label: tr(context, 'Notes'), controller: _notes, lines: 2, maxLength: 300, hint: tr(context, 'Only your family sees this')),
      ],
    );
  }
}

class EditGuestScreen extends StatefulWidget {
  const EditGuestScreen({super.key, required this.weddingId, required this.g});
  final String weddingId;
  final Json g;
  @override
  State<EditGuestScreen> createState() => _EditGuestScreenState();
}

class _EditGuestScreenState extends State<EditGuestScreen> {
  late final _name = TextEditingController(text: '${widget.g['name']}');
  late final _relation = TextEditingController(text: '${widget.g['relation'] ?? ''}');
  late final _notes = TextEditingController(text: '${widget.g['notes'] ?? ''}');
  late String _side = '${widget.g['side']}';
  late int _pax = toInt(widget.g['expectedPax']) < 1 ? 1 : toInt(widget.g['expectedPax']);
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    final s = Session.read(context);
    final r = await guard(context, () => s.api.patch('${hostBase(widget.weddingId)}/guests/${widget.g['id']}', {
          'name': _name.text.trim(),
          'relation': _relation.text.trim(),
          'notes': _notes.text.trim(),
          'side': _side,
          'expectedPax': _pax,
        }));
    if (mounted) setState(() => _busy = false);
    if (r != null && mounted) {
      s.touch();
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return IkPage(
      header: IkHeader(title: tr(context, 'Edit guest'), sub: '${widget.g['phonePretty']}', art: Art.family),
      bottom: BottomBar(child: IkButton(tr(context, 'Save changes'), icon: Icons.check_rounded, loading: _busy, onPressed: _save)),
      children: [
        Field(label: tr(context, 'Name'), required: true, controller: _name, capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Relation'), controller: _relation, capitalization: TextCapitalization.words, maxLength: 40),
        Text(tr(context, 'SIDE'), style: IK.label()),
        const SizedBox(height: 7),
        Segmented(items: [('bride', tr(context, 'Bride’s side')), ('groom', tr(context, 'Groom’s side'))], value: _side, onChanged: (v) => setState(() => _side = v)),
        const SizedBox(height: 15),
        Row(children: [
          Expanded(child: Text(tr(context, 'Expected people'), style: IK.strong(size: 13.5))),
          IconButton(onPressed: _pax > 1 ? () => setState(() => _pax--) : null, icon: const Icon(Icons.remove_circle_outline_rounded)),
          Text('$_pax', style: IK.title(size: 22)),
          IconButton(onPressed: _pax < 20 ? () => setState(() => _pax++) : null, icon: const Icon(Icons.add_circle_outline_rounded)),
        ]),
        const SizedBox(height: 10),
        Field(label: tr(context, 'Notes'), controller: _notes, lines: 3, maxLength: 300),
        Note(tr(context, 'To change the number, take this guest off the list and add them again with the right number.'), icon: Icons.info_outline_rounded),
      ],
    );
  }
}
