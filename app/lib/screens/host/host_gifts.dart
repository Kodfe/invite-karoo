import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'host_home.dart';
import 'host_scan.dart';

/// Gifts: what the family gives (to the guests on the gift list) and what it receives.
class HostGiftsScreen extends StatefulWidget {
  const HostGiftsScreen({super.key, required this.weddingId});
  final String weddingId;
  @override
  State<HostGiftsScreen> createState() => _HostGiftsScreenState();
}

class _HostGiftsScreenState extends State<HostGiftsScreen> {
  String _side = 'give';
  String? _fn;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(widget.weddingId);
    return Loader<List<Json>>(
      version: s.dataVersion,
      load: () async => asList(await s.api.get('$base/functions')),
      builder: (context, fns, reload) {
        final withGifts = fns.where((f) => toInt(asJson(f['giftOut'])['planned']) > 0).toList();
        final giveFns = withGifts.isEmpty ? fns : withGifts;
        _fn ??= giveFns.where((f) => f['past'] != true).firstOrNull?['id'] as String? ?? (giveFns.isEmpty ? null : '${giveFns.first['id']}');
        return Scaffold(
          backgroundColor: IK.ivory,
          floatingActionButton: _side == 'got'
              ? FloatingActionButton.extended(
                  backgroundColor: IK.v7,
                  foregroundColor: Colors.white,
                  icon: const Icon(Icons.add_rounded),
                  label: Text(tr(context, 'Record a gift')),
                  onPressed: () => push(context, HostGiftNewScreen(weddingId: widget.weddingId, functions: fns, functionId: _fn)),
                )
              : null,
          body: IvoryBg(
            child: RefreshIndicator(
              onRefresh: reload,
              child: ListView(padding: EdgeInsets.zero, children: [
                IkHeader(back: false, title: tr(context, 'Gifts'), sub: tr(context, 'What you give, and what you receive'), art: Art.rings),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: _sideCard('give', tr(context, 'To give'), tr(context, 'Gifts for your guests'))),
                      const SizedBox(width: 10),
                      Expanded(child: _sideCard('got', tr(context, 'Received'), tr(context, 'Gifts from your guests'))),
                    ]),
                    const SizedBox(height: 12),
                    if (_side == 'give') ...[
                      ChipTabs(
                        items: [for (final f in giveFns) ('${f['id']}', '${f['name']} · ${asJson(f['giftOut'])['given']}/${asJson(f['giftOut'])['planned']}')],
                        value: _fn ?? '',
                        onChanged: (v) => setState(() => _fn = v),
                      ),
                      const SizedBox(height: 12),
                      if (_fn != null) GiftOutList(weddingId: widget.weddingId, functionId: _fn!, functions: fns, key: ValueKey('$_fn-${s.dataVersion}')),
                    ] else
                      _Received(weddingId: widget.weddingId, functions: fns, key: ValueKey('got-${s.dataVersion}')),
                  ]),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }

  Widget _sideCard(String v, String t, String sub) {
    final on = _side == v;
    return GestureDetector(
      onTap: () => setState(() => _side = v),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: on ? IK.v0 : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: on ? IK.v4 : IK.goldLine, width: on ? 2 : 1),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(t, style: IK.strong(size: 14, color: on ? IK.v7 : IK.ink)), Text(sub, style: IK.soft(size: 11))]),
      ),
    );
  }
}

/// the gift list for one function: who gets a gift, and who already got it
class GiftOutList extends StatefulWidget {
  const GiftOutList({super.key, required this.weddingId, required this.functionId, required this.functions});
  final String weddingId;
  final String functionId;
  final List<Json> functions;
  @override
  State<GiftOutList> createState() => _GiftOutListState();
}

class _GiftOutListState extends State<GiftOutList> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(widget.weddingId);
    return FutureBuilder<dynamic>(
      future: _future ??= s.api.get('$base/gift-out', query: {'fn': widget.functionId}),
      builder: (context, snap) {
        if (snap.hasError) return Note('${snap.error}', tone: Tone.bad);
        if (!snap.hasData) return const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator(color: IK.v5)));
        final d = asJson(snap.data);
        final f = asJson(d['function']);
        final planned = toInt(d['planned']);
        final given = toInt(d['given']);
        final rows = asList(d['rows']).where((r) => _q.isEmpty || '${asJson(r['guest'])['name']}'.toLowerCase().contains(_q.toLowerCase())).toList();
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(gradient: IK.consoleGradient, borderRadius: BorderRadius.circular(20), boxShadow: IK.sh3),
            child: Row(children: [
              Image.asset(Art.rings, width: 54),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text((f['giftPlan'] ?? '').toString().isEmpty ? tr(context, 'Gift for guests') : '${f['giftPlan']}', style: IK.h2(size: 20, color: Colors.white)),
                  Text(tr(context, 'At the {f} · {g} of {p} given', {'f': f['name'], 'g': given, 'p': planned}), style: IK.body(size: 11.5, color: IK.v2)),
                  const SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(value: planned == 0 ? 0 : given / planned, minHeight: 6, backgroundColor: Colors.white24, color: IK.g4),
                  ),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 10),
          IkCard(
            gradient: IK.darkGradient,
            border: Colors.transparent,
            onTap: () async {
              await push(context, HostScanScreen(weddingId: widget.weddingId, functions: widget.functions, functionId: widget.functionId));
              setState(() => _future = null);
            },
            child: Row(children: [
              Container(width: 44, height: 44, decoration: BoxDecoration(gradient: IK.goldGradient, borderRadius: BorderRadius.circular(13)), child: const Icon(Icons.qr_code_scanner_rounded, color: IK.v9)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(tr(context, 'Scan to give a gift'), style: IK.strong(size: 14, color: Colors.white)),
                  Text(tr(context, 'Scan the guest’s invitation at the desk'), style: IK.body(size: 11.5, color: IK.v2)),
                ]),
              ),
              const Icon(Icons.chevron_right_rounded, color: IK.g3),
            ]),
          ),
          SectionTitle(tr(context, 'Gift list for {f}', {'f': f['name']}), count: planned),
          TextField(
            onChanged: (v) => setState(() => _q = v.trim()),
            decoration: InputDecoration(hintText: tr(context, 'Find a guest on this list'), prefixIcon: const Icon(Icons.search_rounded, color: IK.ink4)),
          ),
          const SizedBox(height: 10),
          if (rows.isEmpty)
            Padding(padding: const EdgeInsets.all(20), child: Text(tr(context, 'Nobody on the gift list for this function.'), textAlign: TextAlign.center, style: IK.soft()))
          else
            IkGroup(children: [
              for (final r in rows)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(children: [
                    Avatar(name: '${asJson(r['guest'])['name']}', size: 38),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${asJson(r['guest'])['name']}', style: IK.strong(size: 13.5)),
                        Text(
                          r['given'] == true
                              ? tr(context, 'Given {when} by {who}', {'when': ago(r['givenAt']), 'who': r['givenBy']})
                              : '${asJson(r['guest'])['relation']} · ${asJson(r['guest'])['side'] == 'bride' ? tr(context, 'Bride’s side') : tr(context, 'Groom’s side')}',
                          style: IK.soft(size: 11),
                        ),
                      ]),
                    ),
                    if (r['given'] == true)
                      PopupMenuButton<String>(
                        icon: const Icon(Icons.check_circle_rounded, color: IK.ok),
                        onSelected: (_) async {
                          final x = await guard(context, () => s.api.post('$base/invites/${r['inviteId']}/gift-out', {'given': false}));
                          if (x != null) {
                            s.touch();
                            setState(() => _future = null);
                          }
                        },
                        itemBuilder: (_) => [PopupMenuItem(value: 'undo', child: Text(tr(context, 'Undo — not given')))],
                      )
                    else
                      IkButton(tr(context, 'Give'), compact: true, kind: BtnKind.dark, icon: Icons.card_giftcard_rounded, onPressed: () async {
                        HapticFeedback.mediumImpact();
                        final x = await guard(context, () => s.api.post('$base/invites/${r['inviteId']}/gift-out', {'given': true, 'method': 'manual'}));
                        if (x != null) {
                          s.touch();
                          setState(() => _future = null);
                        }
                      }),
                  ]),
                ),
            ]),
        ]);
      },
    );
  }

  Future<dynamic>? _future;
}

/// the standalone page behind a function's "Gifts" button
class GiftOutListScreen extends StatelessWidget {
  const GiftOutListScreen({super.key, required this.weddingId, required this.functionId, required this.name});
  final String weddingId;
  final String functionId;
  final String name;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return Loader<List<Json>>(
      load: () async => asList(await s.api.get('${hostBase(weddingId)}/functions')),
      builder: (context, fns, reload) => IkPage(
        onRefresh: reload,
        header: IkHeader(title: tr(context, 'Gifts'), sub: name, art: Art.rings),
        children: [GiftOutList(weddingId: weddingId, functionId: functionId, functions: fns, key: ValueKey(s.dataVersion))],
      ),
    );
  }
}

class _Received extends StatefulWidget {
  const _Received({super.key, required this.weddingId, required this.functions});
  final String weddingId;
  final List<Json> functions;
  @override
  State<_Received> createState() => _ReceivedState();
}

class _ReceivedState extends State<_Received> {
  String _fn = '';

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(widget.weddingId);
    return FutureBuilder<dynamic>(
      key: ValueKey(_fn),
      future: s.api.get('$base/gifts', query: {'fn': _fn}),
      builder: (context, snap) {
        final d = snap.hasData ? asJson(snap.data) : null;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ChipTabs(
            items: [('', tr(context, 'All functions')), for (final f in widget.functions) ('${f['id']}', '${f['name']}')],
            value: _fn,
            onChanged: (v) => setState(() => _fn = v),
          ),
          const SizedBox(height: 12),
          if (snap.hasError) Note('${snap.error}', tone: Tone.bad),
          if (d == null && !snap.hasError) const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator(color: IK.v5))),
          if (d != null) ...[
            Row(children: [
              Expanded(child: StatTile(value: '${d['total']}', label: tr(context, 'Gifts'), color: IK.goldInk)),
              const SizedBox(width: 8),
              Expanded(child: StatTile(value: rupees(toInt(d['cash'])), label: tr(context, 'Cash'), color: IK.ok)),
            ]),
            if (asList(d['byCategory']).isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final c in asList(d['byCategory'])) Pill('${tr(context, '${c['label']}')} · ${c['count']}', tone: Tone.gold),
              ]),
            ],
            SectionTitle(tr(context, 'Recorded'), count: asList(d['gifts']).length),
            if (asList(d['gifts']).isEmpty)
              Padding(padding: const EdgeInsets.all(20), child: Text(tr(context, 'No gifts recorded yet. Tap “Record a gift” or scan a guest at the desk.'), textAlign: TextAlign.center, style: IK.soft()))
            else
              IkGroup(children: [
                for (final g in asList(d['gifts']))
                  IkRow(
                    icon: asJson(g['category'])['isCash'] == true ? Icons.currency_rupee_rounded : Icons.redeem_rounded,
                    iconColor: IK.goldInk,
                    iconBg: IK.g1,
                    title: '${g['giverName']}',
                    sub: [
                      g['amount'] != null ? rupees(toInt(g['amount'])) : '${g['itemName']}',
                      '${widget.functions.where((f) => f['id'] == g['functionId']).firstOrNull?['name'] ?? ''}',
                      if ('${g['note'] ?? ''}'.isNotEmpty) '${g['note']}',
                      '${tr(context, 'by')} ${g['recordedBy']}',
                    ].join(' · '),
                    trailing: s.isOwner
                        ? IconButton(
                            icon: const Icon(Icons.delete_outline_rounded, color: IK.bad, size: 20),
                            onPressed: () async {
                              final ok = await confirmSheet(context, title: tr(context, 'Delete this gift record?'), body: '${g['giverName']}', confirm: tr(context, 'Delete'), danger: true);
                              if (!ok || !context.mounted) return;
                              final r = await guard(context, () => s.api.delete('$base/gifts/${g['id']}'));
                              if (r != null) setState(() {});
                            },
                          )
                        : null,
                  ),
              ]),
          ],
        ]);
      },
    );
  }
}

/// write down a gift received: at which function, from whom, and what it was
class HostGiftNewScreen extends StatefulWidget {
  const HostGiftNewScreen({super.key, required this.weddingId, required this.functions, this.functionId, this.guest});
  final String weddingId;
  final List<Json> functions;
  final String? functionId;
  final Json? guest;
  @override
  State<HostGiftNewScreen> createState() => _HostGiftNewScreenState();
}

class _HostGiftNewScreenState extends State<HostGiftNewScreen> {
  late String? _fn = widget.functionId ?? (widget.functions.isEmpty ? null : '${widget.functions.first['id']}');
  late Json? _guest = widget.guest;
  bool _walkIn = false;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _amount = TextEditingController();
  final _item = TextEditingController();
  final _note = TextEditingController();
  List<Json> _cats = [];
  String? _cat;
  Map<String, String> _errs = {};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Session.read(context).api.get('${hostBase(widget.weddingId)}/gift-categories').then((v) {
      if (!mounted) return;
      setState(() {
        _cats = asList(v).where((c) => c['active'] != false).toList();
        _cat = _cats.isEmpty ? null : '${_cats.first['id']}';
      });
    }).catchError((_) {});
  }

  Json? get _c => _cats.where((c) => c['id'] == _cat).firstOrNull;

  Future<void> _pickGuest() async {
    final picked = await showModalBottomSheet<Json>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _GuestPicker(weddingId: widget.weddingId),
    );
    if (picked != null) setState(() => _guest = picked);
  }

  Future<void> _save() async {
    final c = _c;
    final e = <String, String>{};
    if (_fn == null) e['fn'] = tr(context, 'Pick the function');
    if (_guest == null && (!_walkIn || _name.text.trim().isEmpty)) e['from'] = tr(context, 'Who gave it?');
    if (c == null) e['cat'] = tr(context, 'Pick what it was');
    if (c != null && c['isCash'] == true && (int.tryParse(_amount.text.replaceAll(RegExp(r'\D'), '')) ?? 0) <= 0) e['amount'] = tr(context, 'Enter the amount');
    if (c != null && c['isCash'] != true && _item.text.trim().isEmpty) e['itemName'] = tr(context, 'Say what the gift was');
    setState(() => _errs = e);
    if (e.isNotEmpty) return;
    setState(() => _busy = true);
    final s = Session.read(context);
    final isCash = c!['isCash'] == true;
    try {
      await s.api.post('${hostBase(widget.weddingId)}/gifts', {
        'functionId': _fn,
        'guestId': _guest?['id'],
        if (_guest == null) 'giverName': _name.text.trim(),
        if (_guest == null && _phone.text.trim().isNotEmpty) 'giverPhone': _phone.text.trim(),
        'categoryId': _cat,
        if (isCash) 'amount': int.parse(_amount.text.replaceAll(RegExp(r'\D'), '')),
        if (!isCash) 'itemName': _item.text.trim(),
        'note': _note.text.trim(),
        'method': widget.guest != null ? 'qr' : 'manual',
      });
      s.touch();
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      toast(context, tr(context, 'Gift recorded'));
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
    final c = _c;
    return IkPage(
      header: IkHeader(title: tr(context, 'Record a gift'), sub: tr(context, 'Kept with the function it was given at'), art: Art.rings),
      bottom: BottomBar(child: IkButton(tr(context, 'Save the gift'), icon: Icons.check_rounded, loading: _busy, onPressed: _save)),
      children: [
        SectionTitle(tr(context, 'At which function'), top: 0),
        ChipTabs(items: [for (final f in widget.functions) ('${f['id']}', '${f['name']}')], value: _fn ?? '', onChanged: (v) => setState(() => _fn = v)),
        SectionTitle(tr(context, 'From')),
        if (_guest != null)
          IkCard(
            child: Row(children: [
              Avatar(name: '${_guest!['name']}', size: 42),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${_guest!['name']}', style: IK.strong(size: 14)), Text('${_guest!['relation'] ?? ''} · ${_guest!['phonePretty'] ?? ''}', style: IK.soft(size: 11.5))])),
              if (widget.guest == null) TextButton(onPressed: () => setState(() => _guest = null), child: Text(tr(context, 'Change'))),
            ]),
          )
        else if (_walkIn) ...[
          Field(label: tr(context, 'Name'), required: true, controller: _name, error: _errs['from'] ?? _errs['giverName'], capitalization: TextCapitalization.words, maxLength: 60),
          Field(label: tr(context, 'Mobile (optional)'), controller: _phone, keyboard: TextInputType.phone, maxLength: 15),
          LinkText(tr(context, 'Pick from the guest list instead'), onTap: () => setState(() => _walkIn = false)),
        ] else ...[
          IkButton(tr(context, 'Pick from the guest list'), kind: BtnKind.ghost, icon: Icons.search_rounded, onPressed: _pickGuest),
          const SizedBox(height: 6),
          Center(child: LinkText(tr(context, 'Someone not on the list'), onTap: () => setState(() => _walkIn = true))),
          if (_errs['from'] != null) Text(_errs['from']!, style: IK.body(size: 12, color: IK.bad)),
        ],
        SectionTitle(tr(context, 'What was it')),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final x in _cats)
            ChoiceChip(
              label: Text(tr(context, '${x['label']}')),
              selected: _cat == x['id'],
              selectedColor: IK.v7,
              showCheckmark: false,
              labelStyle: IK.strong(size: 12.5, color: _cat == x['id'] ? Colors.white : IK.ink2),
              onSelected: (_) => setState(() => _cat = '${x['id']}'),
            ),
          ActionChip(
            avatar: const Icon(Icons.add_rounded, size: 16),
            label: Text(tr(context, 'New kind')),
            onPressed: () async {
              final label = await _ask(context, tr(context, 'A new kind of gift'), tr(context, 'e.g. Silverware'));
              if (label == null || label.trim().length < 2 || !context.mounted) return;
              final r = await guard(context, () => Session.read(context).api.post('${hostBase(widget.weddingId)}/gift-categories', {'label': label.trim()}));
              if (r != null) {
                setState(() {
                  _cats.add(asJson(r));
                  _cat = '${asJson(r)['id']}';
                });
              }
            },
          ),
        ]),
        const SizedBox(height: 14),
        if (c != null && c['isCash'] == true)
          Field(label: tr(context, 'Amount (₹)'), required: true, controller: _amount, keyboard: TextInputType.number, error: _errs['amount'], icon: Icons.currency_rupee_rounded,
              formatters: [FilteringTextInputFormatter.digitsOnly], maxLength: 9)
        else if (c != null)
          Field(label: tr(context, 'What it was'), required: true, controller: _item, error: _errs['itemName'], hint: tr(context, 'e.g. Silver tray'), maxLength: 80, capitalization: TextCapitalization.sentences),
        Field(label: tr(context, 'Note'), controller: _note, hint: tr(context, 'Optional'), maxLength: 200),
      ],
    );
  }
}

Future<String?> _ask(BuildContext context, String title, String hint) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: IK.h2()),
      content: TextField(controller: c, autofocus: true, decoration: InputDecoration(hintText: hint)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: Text(trIn(Session.read(context).lang, 'Cancel'))),
        FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: Text(trIn(Session.read(context).lang, 'Add'))),
      ],
    ),
  );
}

class _GuestPicker extends StatefulWidget {
  const _GuestPicker({required this.weddingId});
  final String weddingId;
  @override
  State<_GuestPicker> createState() => _GuestPickerState();
}

class _GuestPickerState extends State<_GuestPicker> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * .8,
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom),
        child: Column(children: [
          TextField(
            autofocus: true,
            onChanged: (v) => setState(() => _q = v.trim()),
            decoration: InputDecoration(hintText: tr(context, 'Name or number'), prefixIcon: const Icon(Icons.search_rounded)),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: FutureBuilder<dynamic>(
              key: ValueKey(_q),
              future: s.api.get('${hostBase(widget.weddingId)}/guests', query: {'q': _q, 'limit': 30}),
              builder: (context, snap) {
                if (!snap.hasData) return const Center(child: CircularProgressIndicator(color: IK.v5));
                final list = asList(asJson(snap.data)['guests']);
                return ListView(children: [
                  for (final g in list)
                    ListTile(
                      leading: Avatar(name: '${g['name']}', size: 38),
                      title: Text('${g['name']}', style: IK.strong(size: 14)),
                      subtitle: Text('${g['relation']} · ${g['phonePretty']}'),
                      onTap: () => Navigator.pop(context, g),
                    ),
                ]);
              },
            ),
          ),
        ]),
      ),
    );
  }
}
