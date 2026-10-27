import 'package:flutter/material.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import '../auth/auth_ui.dart';
import 'host_home.dart';

/// Family members sign in with their own number and help run the console.
/// Only the owner adds or removes them.
class HostFamilyScreen extends StatelessWidget {
  const HostFamilyScreen({super.key, required this.weddingId});
  final String weddingId;

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final base = hostBase(weddingId);
    return Loader<Json>(
      load: () async => asJson(await s.api.get('$base/family')),
      builder: (context, d, reload) {
        final members = asList(d['members']);
        final max = toInt(d['max']);
        final owner = asJson(d['owner']);
        final isOwner = asJson(d['me'])['role'] == 'owner';
        return IkPage(
          onRefresh: reload,
          header: IkHeader(title: tr(context, 'Family access'), sub: tr(context, 'Run the console together'), art: Art.cplSofa),
          bottom: isOwner && members.length < max
              ? BottomBar(
                  child: IkButton(tr(context, 'Add a family member'), icon: Icons.person_add_alt_1_rounded, onPressed: () async {
                    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _AddFamily(weddingId: weddingId)));
                    if (ok == true) await reload();
                  }),
                )
              : null,
          children: [
            IkCard(
              gradient: IK.darkGradient,
              border: Colors.transparent,
              child: Row(children: [
                Image.asset(Art.family, width: 70),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(tr(context, '{n} of {m} family members', {'n': members.length, 'm': max}), style: IK.h2(size: 20, color: Colors.white)),
                    const SizedBox(height: 4),
                    Text(tr(context, 'They sign in with their own number and help you send reminders, mark replies and run the gift desk.'), style: IK.body(size: 11.5, color: IK.v2)),
                    const SizedBox(height: 8),
                    Row(children: [
                      for (var i = 0; i < max; i++)
                        Container(width: 22, height: 5, margin: const EdgeInsets.only(right: 4), decoration: BoxDecoration(color: i < members.length ? IK.g4 : Colors.white24, borderRadius: BorderRadius.circular(3))),
                    ]),
                  ]),
                ),
              ]),
            ),
            SectionTitle(tr(context, 'Who has access')),
            IkGroup(children: [
              IkRow(
                icon: Icons.verified_user_rounded,
                iconColor: IK.goldInk,
                iconBg: IK.g1,
                title: owner['isMe'] == true ? tr(context, 'You · Owner') : tr(context, 'Owner'),
                sub: '${owner['phonePretty']}',
                trailing: Pill(tr(context, 'Owner'), tone: Tone.gold, icon: Icons.shield_outlined),
              ),
              for (final m in members)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(children: [
                    Avatar(name: '${m['name']}', size: 40),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${m['name']} · ${m['relation']}', style: IK.strong(size: 13.5)),
                        Text('${m['phonePretty']}', style: IK.soft(size: 11.5)),
                        const SizedBox(height: 4),
                        if (isOwner)
                          PopupMenuButton<String>(
                            onSelected: (v) async {
                              final r = await guard(context, () => s.api.patch('$base/family/${m['id']}', {'role': v}));
                              if (r != null) await reload();
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(value: 'cohost', child: Text(tr(context, 'Full access'))),
                              PopupMenuItem(value: 'giftdesk', child: Text(tr(context, 'Gift desk only'))),
                            ],
                            child: Pill(m['role'] == 'giftdesk' ? '${tr(context, 'Gift desk only')} ▾' : '${tr(context, 'Full access')} ▾', tone: Tone.violet),
                          )
                        else
                          Pill(m['role'] == 'giftdesk' ? tr(context, 'Gift desk only') : tr(context, 'Full access'), tone: Tone.violet),
                      ]),
                    ),
                    if (isOwner)
                      IconButton(
                        icon: const Icon(Icons.delete_outline_rounded, color: IK.bad),
                        onPressed: () async {
                          final ok = await confirmSheet(context,
                              title: tr(context, 'Remove {n}?', {'n': m['name']}), body: tr(context, 'They lose access to the console at once.'), confirm: tr(context, 'Remove'), danger: true);
                          if (!ok || !context.mounted) return;
                          final r = await guard(context, () => s.api.delete('$base/family/${m['id']}'));
                          if (r != null) await reload();
                        },
                      ),
                  ]),
                ),
            ]),
            if (!isOwner) ...[const SizedBox(height: 12), Note(tr(context, 'Only the owner can add or remove family members.'))],
          ],
        );
      },
    );
  }
}

class _AddFamily extends StatefulWidget {
  const _AddFamily({required this.weddingId});
  final String weddingId;
  @override
  State<_AddFamily> createState() => _AddFamilyState();
}

class _AddFamilyState extends State<_AddFamily> {
  final _name = TextEditingController();
  final _rel = TextEditingController();
  final _mobile = TextEditingController();
  String _cc = '+91';
  String _role = 'cohost';
  Map<String, String> _errs = {};
  bool _busy = false;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _errs = {};
    });
    try {
      await Session.read(context).api.post('${hostBase(widget.weddingId)}/family', {
        'name': _name.text.trim(),
        'relation': _rel.text.trim(),
        'phone': _mobile.text.trim(),
        'cc': _cc,
        'role': _role,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _errs = e.fields);
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return IkPage(
      header: IkHeader(title: tr(context, 'Add a family member'), sub: tr(context, 'They sign in with this number'), art: Art.family),
      bottom: BottomBar(child: IkButton(tr(context, 'Give access'), icon: Icons.check_rounded, loading: _busy, onPressed: _save)),
      children: [
        Field(label: tr(context, 'Name'), required: true, controller: _name, error: _errs['name'], capitalization: TextCapitalization.words, maxLength: 60),
        Field(label: tr(context, 'Relation'), required: true, controller: _rel, error: _errs['relation'], hint: tr(context, 'e.g. Brother'), capitalization: TextCapitalization.words, maxLength: 40),
        PhoneField(cc: _cc, controller: _mobile, onCc: (v) => setState(() => _cc = v), error: _errs['phone']),
        const SizedBox(height: 16),
        Text(tr(context, 'WHAT THEY CAN DO'), style: IK.label()),
        const SizedBox(height: 8),
        for (final r in [
          ('cohost', 'Full access', 'Replies, reminders, guests and the gift desk'),
          ('giftdesk', 'Gift desk only', 'Scan guests, give and record gifts — nothing else'),
        ])
          GestureDetector(
            onTap: () => setState(() => _role = r.$1),
            child: Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _role == r.$1 ? IK.v0 : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: _role == r.$1 ? IK.v4 : IK.goldLine, width: _role == r.$1 ? 2 : 1),
              ),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(tr(context, r.$2), style: IK.strong(size: 14)), Text(tr(context, r.$3), style: IK.soft(size: 11.5))])),
                Icon(_role == r.$1 ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded, color: _role == r.$1 ? IK.v6 : IK.line2),
              ]),
            ),
          ),
      ],
    );
  }
}
