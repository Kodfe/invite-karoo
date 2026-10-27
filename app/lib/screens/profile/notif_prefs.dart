import 'package:flutter/material.dart';

import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/ui.dart';
import 'settings.dart';

class NotifPrefsScreen extends StatelessWidget {
  const NotifPrefsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Session.of(context);
    final p = (s.me?['prefs'] as Map?) ?? const {};
    final remAt = ((p['remAt'] as List?) ?? const [1440, 180]).map(toInt).toList();
    Widget sw(String key, {bool def = true}) => Switch.adaptive(
          value: p[key] == null ? def : p[key] == true,
          activeTrackColor: IK.ok,
          onChanged: (v) => savePrefs(context, {key: v}),
        );
    return IkPage(
      header: IkHeader(title: tr(context, 'Notification preferences'), sub: tr(context, 'How and when we reach you'), art: Art.hourglass),
      children: [
        SectionTitle(tr(context, 'Where we reach you'), top: 6),
        IkGroup(children: [
          IkRow(image: Art.whatsapp, title: 'WhatsApp', sub: tr(context, 'On {n}', {'n': s.me?['phonePretty'] ?? ''}), trailing: sw('wa')),
          IkRow(image: Art.phoneIc, title: tr(context, 'App notifications'), sub: tr(context, 'On this phone'), trailing: sw('push')),
          IkRow(icon: Icons.sms_outlined, title: tr(context, 'SMS if WhatsApp fails'), sub: tr(context, 'Only when a WhatsApp message cannot be delivered'), trailing: sw('sms', def: false)),
        ]),
        SectionTitle(tr(context, 'What we tell you')),
        IkGroup(children: [
          IkRow(icon: Icons.drafts_outlined, iconColor: IK.mag, iconBg: IK.magBg, title: tr(context, 'New invitations'), sub: tr(context, 'The moment a family invites you'), trailing: sw('inv')),
          IkRow(icon: Icons.alarm_rounded, iconColor: IK.g6, iconBg: IK.g1, title: tr(context, 'Reminders before each function'), sub: tr(context, 'Pick when, below'), trailing: sw('rem')),
          if (p['rem'] != false)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                for (final o in const [10080, 1440, 180, 60, 30])
                  ChoiceChip(
                    label: Text(tr(context, offsetLabel(o))),
                    selected: remAt.contains(o),
                    selectedColor: IK.v7,
                    labelStyle: IK.strong(size: 12, color: remAt.contains(o) ? Colors.white : IK.ink2),
                    onSelected: (v) {
                      final next = [...remAt];
                      if (v) {
                        next.add(o);
                      } else {
                        next.remove(o);
                      }
                      if (next.isEmpty) return;
                      savePrefs(context, {'remAt': next.take(4).toList()});
                    },
                  ),
              ]),
            ),
          IkRow(icon: Icons.campaign_outlined, title: tr(context, 'Messages from hosts'), sub: tr(context, 'Updates the family sends about a function'), trailing: sw('nudge')),
          IkRow(icon: Icons.support_agent_rounded, iconColor: IK.ok, iconBg: IK.okBg, title: tr(context, 'Replies from our team'), sub: tr(context, 'When we answer your ticket'), trailing: sw('msgs')),
        ]),
        SectionTitle(tr(context, 'Quiet hours')),
        IkGroup(children: [
          IkRow(icon: Icons.bedtime_outlined, title: tr(context, 'Quiet hours'), sub: tr(context, 'Anything due in this window waits until it ends'), trailing: sw('quiet', def: false)),
          if (p['quiet'] == true)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Row(children: [
                Expanded(child: _TimeBtn(label: tr(context, 'From'), value: '${p['qFrom'] ?? '22:00'}', onPick: (v) => savePrefs(context, {'qFrom': v}))),
                const SizedBox(width: 10),
                Expanded(child: _TimeBtn(label: tr(context, 'To'), value: '${p['qTo'] ?? '07:00'}', onPick: (v) => savePrefs(context, {'qTo': v}))),
              ]),
            ),
          IkRow(icon: Icons.pause_circle_outline_rounded, title: tr(context, 'Pause all reminders'), sub: tr(context, 'Invitations still arrive'), trailing: sw('pause', def: false)),
        ]),
      ],
    );
  }
}

class _TimeBtn extends StatelessWidget {
  const _TimeBtn({required this.label, required this.value, required this.onPick});
  final String label;
  final String value;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final parts = value.split(':');
    final t = TimeOfDay(hour: int.tryParse(parts[0]) ?? 22, minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0);
    return OutlinedButton(
      onPressed: () async {
        final r = await showTimePicker(context: context, initialTime: t);
        if (r != null) onPick('${r.hour.toString().padLeft(2, '0')}:${r.minute.toString().padLeft(2, '0')}');
      },
      child: Text('$label · ${t.format(context)}'),
    );
  }
}
