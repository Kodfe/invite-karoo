import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/art.dart';
import '../core/format.dart';
import '../core/l10n.dart';
import '../core/theme.dart';

/* ───────────────────────── backgrounds ───────────────────────── */

/// ivory paper with a soft dawn wash — every light screen sits on this
class IvoryBg extends StatelessWidget {
  const IvoryBg({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    Widget wash(Alignment a, double r, Color c) => Positioned.fill(
          child: IgnorePointer(
            child: DecoratedBox(decoration: BoxDecoration(gradient: RadialGradient(center: a, radius: r, colors: [c, c.withValues(alpha: 0)]))),
          ),
        );
    return Container(
      color: IK.ivory,
      child: Stack(children: [
        wash(const Alignment(-1, -1), 1.1, IK.v2.withValues(alpha: .55)),
        wash(const Alignment(1, -0.9), 1.0, const Color(0xFFFFD6BA).withValues(alpha: .45)),
        wash(const Alignment(0, 1.2), 1.0, IK.g2.withValues(alpha: .3)),
        Positioned.fill(child: child),
      ]),
    );
  }
}

/* ───────────────────────── header ───────────────────────── */

class SquareBtn extends StatelessWidget {
  const SquareBtn({super.key, required this.icon, required this.onTap, this.dark = false, this.badge});
  final IconData icon;
  final VoidCallback? onTap;
  final bool dark;
  final int? badge;

  @override
  Widget build(BuildContext context) {
    return Stack(clipBehavior: Clip.none, children: [
      Material(
        color: dark ? Colors.white.withValues(alpha: .12) : Colors.white.withValues(alpha: .88),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(13),
          side: BorderSide(color: dark ? Colors.white.withValues(alpha: .18) : IK.line),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(13),
          onTap: onTap,
          child: SizedBox(width: 40, height: 40, child: Icon(icon, size: 20, color: dark ? IK.paper : IK.v7)),
        ),
      ),
      if (badge != null && badge! > 0)
        Positioned(
          right: -4,
          top: -4,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5),
            constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
            decoration: BoxDecoration(color: IK.bad, borderRadius: BorderRadius.circular(9), border: Border.all(color: Colors.white, width: 1.5)),
            alignment: Alignment.center,
            child: Text(badge! > 99 ? '99+' : '$badge',
                style: const TextStyle(fontFamily: IK.sans, fontSize: 9.5, fontWeight: FontWeight.w800, color: Colors.white)),
          ),
        ),
    ]);
  }
}

/// the illustration standing in a gold jharokha arch at the top right of a screen
class ArchArt extends StatelessWidget {
  const ArchArt({super.key, required this.asset, this.width = 92, this.height = 106, this.fit = BoxFit.contain});
  final String asset;
  final double width;
  final double height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.vertical(top: Radius.circular(width / 2), bottom: const Radius.circular(14)),
        border: Border.all(color: IK.gold.withValues(alpha: .55), width: 1.2),
        gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF4ECFF), Color(0xFFFFEFF4)]),
        boxShadow: [BoxShadow(color: IK.gold.withValues(alpha: .25), blurRadius: 18, spreadRadius: -8, offset: const Offset(0, 10))],
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
        child: Image.asset(asset, fit: fit, alignment: Alignment.bottomCenter),
      ),
    );
  }
}

/// the ivory header every light screen uses: back, title in Cormorant, the screen's own
/// illustration in a gold arch, and kaleere hanging from the corner
class IkHeader extends StatelessWidget {
  const IkHeader({
    super.key,
    required this.title,
    this.kicker,
    this.sub,
    this.art,
    this.back = true,
    this.actions = const [],
    this.onBack,
    this.hang = true,
  });
  final String title;
  final String? kicker;
  final String? sub;
  final String? art;
  final bool back;
  final List<Widget> actions;
  final VoidCallback? onBack;
  final bool hang;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Stack(children: [
      if (hang)
        Positioned(
          top: -6,
          right: 8,
          child: IgnorePointer(child: Opacity(opacity: .95, child: Image.asset(Art.kaleere, height: 88))),
        ),
      Padding(
        padding: EdgeInsets.fromLTRB(16, top + 10, 16, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            height: 40,
            child: Row(children: [
              if (back) SquareBtn(icon: Icons.arrow_back_rounded, onTap: onBack ?? () => Navigator.of(context).maybePop()),
              const Spacer(),
              for (final a in actions) ...[a, const SizedBox(width: 8)],
              if (hang) const SizedBox(width: 62),
            ]),
          ),
          const SizedBox(height: 10),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (kicker != null) Text(kicker!, style: IK.kicker()),
                Text(title, style: IK.title()),
                if (sub != null) ...[
                  const SizedBox(height: 6),
                  Text(sub!, style: IK.soft(size: 12.5)),
                ],
              ]),
            ),
            if (art != null) ...[const SizedBox(width: 10), ArchArt(asset: art!)],
          ]),
        ]),
      ),
    ]);
  }
}

/// A full light page: ivory background, header, scrolling body, optional bottom bar.
class IkPage extends StatelessWidget {
  const IkPage({
    super.key,
    required this.header,
    required this.children,
    this.bottom,
    this.onRefresh,
    this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 28),
    this.floating,
  });
  final Widget header;
  final List<Widget> children;
  final Widget? bottom;
  final Future<void> Function()? onRefresh;
  final EdgeInsets padding;
  final Widget? floating;

  @override
  Widget build(BuildContext context) {
    Widget list = ListView(
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      padding: EdgeInsets.zero,
      children: [
        header,
        Padding(padding: padding, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)),
      ],
    );
    if (onRefresh != null) list = RefreshIndicator(color: IK.v6, onRefresh: onRefresh!, child: list);
    return Scaffold(
      backgroundColor: IK.ivory,
      floatingActionButton: floating,
      body: IvoryBg(child: list),
      bottomNavigationBar: bottom,
    );
  }
}

/// a fixed action bar at the foot of a form
class BottomBar extends StatelessWidget {
  const BottomBar({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 10, 16, 10 + MediaQuery.paddingOf(context).bottom),
      decoration: BoxDecoration(
        color: IK.ivory.withValues(alpha: .96),
        border: const Border(top: BorderSide(color: IK.goldLine)),
      ),
      child: child,
    );
  }
}

/* ───────────────────────── buttons ───────────────────────── */

enum BtnKind { primary, gold, whatsapp, ghost, danger, dark }

class IkButton extends StatelessWidget {
  const IkButton(this.label,
      {super.key, this.onPressed, this.icon, this.kind = BtnKind.primary, this.loading = false, this.height = 56, this.compact = false, this.leading});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final BtnKind kind;
  final bool loading;
  final double height;
  final bool compact;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    Gradient? gradient;
    Color bg = Colors.white;
    Color fg = IK.paper;
    BorderSide? border;
    List<BoxShadow>? shadow;
    switch (kind) {
      case BtnKind.primary:
        gradient = IK.btnGradient;
        shadow = IK.btnShadow;
      case BtnKind.gold:
        gradient = IK.goldGradient;
        fg = IK.v9;
        shadow = [BoxShadow(color: IK.g5.withValues(alpha: .45), blurRadius: 20, spreadRadius: -8, offset: const Offset(0, 8))];
      case BtnKind.whatsapp:
        gradient = const LinearGradient(colors: [Color(0xFF25D366), Color(0xFF128C3E)]);
        shadow = [BoxShadow(color: IK.ok.withValues(alpha: .4), blurRadius: 20, spreadRadius: -8, offset: const Offset(0, 8))];
      case BtnKind.ghost:
        bg = Colors.white;
        fg = IK.v7;
        border = const BorderSide(color: IK.line2, width: 1.2);
      case BtnKind.danger:
        bg = IK.badBg;
        fg = IK.bad;
        border = const BorderSide(color: IK.badLine);
      case BtnKind.dark:
        gradient = const LinearGradient(colors: [IK.v8, IK.v9]);
    }
    final r = BorderRadius.circular(compact ? 13 : 17);
    return Opacity(
      opacity: disabled && !loading ? .55 : 1,
      child: Container(
        height: compact ? 42 : height,
        decoration: BoxDecoration(
          color: gradient == null ? bg : null,
          gradient: gradient,
          borderRadius: r,
          border: border == null ? null : Border.fromBorderSide(border),
          boxShadow: disabled ? null : shadow,
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: r,
            onTap: disabled
                ? null
                : () {
                    HapticFeedback.selectionClick();
                    onPressed!();
                  },
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: compact ? 14 : 18),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, mainAxisSize: compact ? MainAxisSize.min : MainAxisSize.max, children: [
                if (loading)
                  SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: fg))
                else ...[
                  if (leading != null) ...[leading!, const SizedBox(width: 9)],
                  if (icon != null) ...[Icon(icon, size: compact ? 17 : 19, color: fg), const SizedBox(width: 9)],
                  Flexible(
                    child: Text(label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontFamily: IK.sans, fontWeight: FontWeight.w800, fontSize: compact ? 13 : 15.5, color: fg)),
                  ),
                ],
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class LinkText extends StatelessWidget {
  const LinkText(this.text, {super.key, required this.onTap, this.color = IK.v6, this.size = 13.5});
  final String text;
  final VoidCallback onTap;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(text, style: TextStyle(fontFamily: IK.sans, fontWeight: FontWeight.w800, fontSize: size, color: color)),
        ),
      );
}

/* ───────────────────────── surfaces ───────────────────────── */

/// the ivory card with a gold hairline used across the app
class IkCard extends StatelessWidget {
  const IkCard(
      {super.key,
      required this.child,
      this.padding = const EdgeInsets.all(14),
      this.onTap,
      this.color,
      this.border,
      this.margin,
      this.radius = 20,
      this.gradient,
      this.leftAccent});
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? border;
  final EdgeInsets? margin;
  final double radius;
  final Gradient? gradient;
  final Color? leftAccent;

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(radius);
    Widget inner = Padding(padding: padding, child: child);
    if (leftAccent != null) {
      inner = Stack(children: [
        inner,
        Positioned(left: 0, top: 0, bottom: 0, child: Container(width: 4, color: leftAccent)),
      ]);
    }
    return Container(
      margin: margin,
      decoration: BoxDecoration(
        color: gradient == null ? (color ?? const Color(0xFFFFFDF8).withValues(alpha: .92)) : null,
        gradient: gradient,
        borderRadius: r,
        border: Border.all(color: border ?? IK.goldLine.withValues(alpha: .95)),
        boxShadow: IK.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(type: MaterialType.transparency, child: InkWell(onTap: onTap, child: inner)),
    );
  }
}

/// a grouped list card (settings style): rows separated by dashed gold rules
class IkGroup extends StatelessWidget {
  const IkGroup({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const DashedDivider());
      rows.add(children[i]);
    }
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF8).withValues(alpha: .9),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: IK.goldLine.withValues(alpha: .95)),
        boxShadow: IK.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(type: MaterialType.transparency, child: Column(children: rows)),
    );
  }
}

class DashedDivider extends StatelessWidget {
  const DashedDivider({super.key, this.indent = 14});
  final double indent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: indent),
      child: LayoutBuilder(builder: (context, c) {
        final n = (c.maxWidth / 7).floor();
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(n, (_) => Container(width: 3.5, height: 1, color: IK.gold.withValues(alpha: .32))),
        );
      }),
    );
  }
}

/// one row of an [IkGroup]
class IkRow extends StatelessWidget {
  const IkRow(
      {super.key, required this.title, this.sub, this.icon, this.iconColor, this.iconBg, this.image, this.trailing, this.onTap, this.chevron = true, this.titleColor});
  final String title;
  final String? sub;
  final IconData? icon;
  final Color? iconColor;
  final Color? iconBg;
  final String? image;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool chevron;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(children: [
          if (icon != null || image != null) ...[
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: image != null ? Colors.white : (iconBg ?? IK.v1),
                borderRadius: BorderRadius.circular(13),
                border: image != null ? Border.all(color: IK.goldLine) : null,
              ),
              alignment: Alignment.center,
              child: image != null ? Image.asset(image!, width: 30, height: 30, fit: BoxFit.contain) : Icon(icon, size: 19, color: iconColor ?? IK.v6),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: IK.strong(size: 14, color: titleColor ?? IK.ink)),
              if (sub != null && sub!.isNotEmpty) ...[const SizedBox(height: 2), Text(sub!, style: IK.soft(size: 11.5))],
            ]),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
          if (onTap != null && chevron && trailing == null) const Icon(Icons.chevron_right_rounded, color: IK.ink4),
        ]),
      ),
    );
  }
}

/// section heading with a small gold motif — "Who has access", "Invited to"
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.count, this.trailing, this.top = 22});
  final String text;
  final Object? count;
  final Widget? trailing;
  final double top;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(2, top, 2, 12),
      child: Row(children: [
        Image.asset(Art.lotus, width: 18, height: 18),
        const SizedBox(width: 8),
        Flexible(child: Text(text, style: IK.h2())),
        const SizedBox(width: 10),
        Expanded(child: Container(height: 1, color: IK.gold.withValues(alpha: .3))),
        if (count != null) ...[const SizedBox(width: 8), Text('$count', style: IK.monoS(size: 11))],
        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ]),
    );
  }
}

/* ───────────────────────── chips ───────────────────────── */

enum Tone { violet, gold, ok, bad, info, mag, plain, live }

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = Tone.violet, this.icon, this.size = 10});
  final String text;
  final Tone tone;
  final IconData? icon;
  final double size;

  static (Color, Color) colors(Tone t) => switch (t) {
        Tone.violet => (IK.v1, IK.v6),
        Tone.gold => (IK.g1, IK.g6),
        Tone.ok => (IK.okBg, const Color(0xFF15803D)),
        Tone.bad => (IK.badBg, IK.bad),
        Tone.info => (IK.infoBg, IK.info),
        Tone.mag => (IK.magBg, IK.mag),
        Tone.plain => (IK.paper2, IK.ink3),
        Tone.live => (const Color(0xFFFDE9E9), const Color(0xFFB91C1C)),
      };

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = colors(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (tone == Tone.live) ...[
          Container(width: 5, height: 5, decoration: const BoxDecoration(color: Color(0xFFDC2626), shape: BoxShape.circle)),
          const SizedBox(width: 5),
        ],
        if (icon != null) ...[Icon(icon, size: size + 2, color: fg), const SizedBox(width: 4)],
        Text(text, style: TextStyle(fontFamily: IK.sans, fontSize: size, fontWeight: FontWeight.w800, letterSpacing: .3, color: fg)),
      ]),
    );
  }
}

/// a row of tappable filter chips ("All · 9", "Upcoming · 7")
class ChipTabs extends StatelessWidget {
  const ChipTabs({super.key, required this.items, required this.value, required this.onChanged, this.dark = false});
  final List<(String, String)> items; // (value, label)
  final String value;
  final ValueChanged<String> onChanged;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.zero,
        itemCount: items.length,
        separatorBuilder: (context, i) => const SizedBox(width: 7),
        itemBuilder: (context, i) {
          final (v, label) = items[i];
          final on = v == value;
          return GestureDetector(
            onTap: () => onChanged(v),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: on ? (dark ? IK.g4 : IK.v7) : (dark ? Colors.white.withValues(alpha: .08) : Colors.white),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: on ? Colors.transparent : (dark ? Colors.white.withValues(alpha: .14) : IK.line)),
              ),
              child: Text(label,
                  style: TextStyle(
                      fontFamily: IK.sans,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: on ? (dark ? IK.v9 : Colors.white) : (dark ? IK.paper.withValues(alpha: .8) : IK.ink3))),
            ),
          );
        },
      ),
    );
  }
}

/// two big segmented options ("Today · Upcoming", "Attending · Hosting")
class Segmented extends StatelessWidget {
  const Segmented({super.key, required this.items, required this.value, required this.onChanged});
  final List<(String, String)> items;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: IK.paper2.withValues(alpha: .8), borderRadius: BorderRadius.circular(16), border: Border.all(color: IK.goldLine)),
      child: Row(
        children: [
          for (final it in items)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(it.$1),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: it.$1 == value ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: it.$1 == value ? IK.sh1 : null,
                  ),
                  child: Text(it.$2,
                      style: TextStyle(fontFamily: IK.sans, fontSize: 13, fontWeight: FontWeight.w800, color: it.$1 == value ? IK.v7 : IK.ink3)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/* ───────────────────────── people ───────────────────────── */

class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.photo, this.size = 40, this.ring = false});
  final String name;
  final String? photo;
  final double size;
  final bool ring;

  static const _palette = [
    [Color(0xFF7C5CBF), Color(0xFF4B2A8E)],
    [Color(0xFFC026D3), Color(0xFF86198F)],
    [Color(0xFF6D28D9), Color(0xFF3B1F73)],
    [Color(0xFFD97706), Color(0xFF92400E)],
    [Color(0xFF0F766E), Color(0xFF134E4A)],
    [Color(0xFFDB2777), Color(0xFF9D174D)],
  ];

  @override
  Widget build(BuildContext context) {
    final c = _palette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _palette.length];
    final hasPhoto = photo != null && photo!.isNotEmpty;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: c),
        border: ring ? Border.all(color: IK.g4, width: 3) : null,
        image: hasPhoto ? DecorationImage(image: NetworkImage(photo!), fit: BoxFit.cover) : null,
      ),
      alignment: Alignment.center,
      child: hasPhoto
          ? null
          : Text(initialsOf(name), style: TextStyle(fontFamily: IK.serif, fontWeight: FontWeight.w700, fontSize: size * .38, color: Colors.white)),
    );
  }
}

/* ───────────────────────── forms ───────────────────────── */

class Field extends StatelessWidget {
  const Field({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.required = false,
    this.error,
    this.keyboard,
    this.icon,
    this.maxLength,
    this.lines = 1,
    this.onChanged,
    this.prefix,
    this.helper,
    this.readOnly = false,
    this.onTap,
    this.capitalization = TextCapitalization.none,
    this.formatters,
    this.autofocus = false,
  });
  final String label;
  final TextEditingController? controller;
  final String? hint;
  final bool required;
  final String? error;
  final TextInputType? keyboard;
  final IconData? icon;
  final int? maxLength;
  final int lines;
  final ValueChanged<String>? onChanged;
  final Widget? prefix;
  final String? helper;
  final bool readOnly;
  final VoidCallback? onTap;
  final TextCapitalization capitalization;
  final List<TextInputFormatter>? formatters;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 15),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text.rich(TextSpan(text: label.toUpperCase(), style: IK.label(), children: [
          if (required) const TextSpan(text: ' *', style: TextStyle(color: IK.bad)),
        ])),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          keyboardType: keyboard,
          maxLength: maxLength,
          minLines: lines,
          maxLines: lines,
          onChanged: onChanged,
          readOnly: readOnly,
          onTap: onTap,
          autofocus: autofocus,
          textCapitalization: capitalization,
          inputFormatters: formatters,
          style: IK.body(size: 15, color: IK.ink, weight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: hint,
            counterText: '',
            errorText: error,
            prefixIcon: prefix ?? (icon != null ? Icon(icon, size: 19, color: IK.ink4) : null),
            fillColor: error != null ? IK.badBg : Colors.white,
          ),
        ),
        if (helper != null) ...[const SizedBox(height: 6), Text(helper!, style: IK.soft(size: 11.5))],
      ]),
    );
  }
}

/// a note box with an icon: info, warning, ok
class Note extends StatelessWidget {
  const Note(this.text, {super.key, this.icon = Icons.info_outline_rounded, this.tone = Tone.violet, this.child});
  final String text;
  final IconData icon;
  final Tone tone;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = Pill.colors(tone);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg.withValues(alpha: .7), borderRadius: BorderRadius.circular(14), border: Border.all(color: fg.withValues(alpha: .18))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 17, color: fg),
        const SizedBox(width: 9),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(text, style: IK.body(size: 12.5, color: IK.ink2, height: 1.55)),
            if (child != null) ...[const SizedBox(height: 8), child!],
          ]),
        ),
      ]),
    );
  }
}

/* ───────────────────────── loading / empty / error ───────────────────────── */

/// Loads [load], shows a spinner, an error with retry, or [builder] with the data.
/// The builder gets `reload` so pull-to-refresh and actions can refetch.
class Loader<T> extends StatefulWidget {
  const Loader({super.key, required this.load, required this.builder, this.dark = false, this.version});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final bool dark;

  /// when this changes the data is fetched again, keeping the old data on screen meanwhile
  final Object? version;

  @override
  State<Loader<T>> createState() => LoaderState<T>();
}

class LoaderState<T> extends State<Loader<T>> {
  T? _data;
  bool _has = false;
  Object? _error;
  bool _busy = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  @override
  void didUpdateWidget(covariant Loader<T> old) {
    super.didUpdateWidget(old);
    if (old.version != widget.version) reload();
  }

  Future<void> reload() async {
    if (!_has && mounted) setState(() => _busy = true);
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        _data = d;
        _has = true;
        _error = null;
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _busy = false;
      });
      if (_has) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_has) return widget.builder(context, _data as T, reload);
    if (_busy) return LoadingView(dark: widget.dark);
    return ErrorView(error: _error, onRetry: reload);
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.dark = false});
  final bool dark;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: dark ? IK.ink : IK.ivory,
        body: dark
            ? const Center(child: CircularProgressIndicator(color: IK.g4, strokeWidth: 2.6))
            : const IvoryBg(child: Center(child: CircularProgressIndicator(color: IK.v5, strokeWidth: 2.6))),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, this.error, required this.onRetry});
  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final net = error is ApiException && (error as ApiException).isNetwork;
    return Scaffold(
      backgroundColor: IK.ivory,
      body: IvoryBg(
        child: SafeArea(
          child: Column(children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Navigator.of(context).canPop() ? SquareBtn(icon: Icons.arrow_back_rounded, onTap: () => Navigator.of(context).maybePop()) : const SizedBox(height: 40),
              ),
            ),
            Expanded(
              child: EmptyState(
                art: net ? Art.lanterns : Art.hourglass,
                title: net ? tr(context, 'You are offline') : tr(context, 'That did not load'),
                body: error?.toString() ?? '',
                action: IkButton(tr(context, 'Try again'), icon: Icons.refresh_rounded, onPressed: onRetry, compact: true),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.art, required this.title, this.body = '', this.action});
  final String art;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 30),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, mainAxisSize: MainAxisSize.min, children: [
        Image.asset(art, height: 120),
        const SizedBox(height: 14),
        Text(title, textAlign: TextAlign.center, style: IK.title(size: 24)),
        if (body.isNotEmpty) ...[const SizedBox(height: 8), Text(body, textAlign: TextAlign.center, style: IK.soft(size: 13))],
        if (action != null) ...[const SizedBox(height: 18), action!],
      ]),
    );
  }
}

/* ───────────────────────── feedback ───────────────────────── */

void toast(BuildContext context, String message, {IconData icon = Icons.check_circle_rounded}) {
  final m = ScaffoldMessenger.maybeOf(context);
  m?.hideCurrentSnackBar();
  m?.showSnackBar(SnackBar(
    content: Row(children: [Icon(icon, color: IK.g3, size: 18), const SizedBox(width: 10), Expanded(child: Text(message))]),
    duration: const Duration(seconds: 3),
  ));
}

void showError(BuildContext context, Object e) {
  toast(context, e is ApiException ? e.message : tr(context, 'Something went wrong. Please try again.'), icon: Icons.error_outline_rounded);
}

/// run an async action; on failure show the error and return null
Future<T?> guard<T>(BuildContext context, Future<T> Function() fn) async {
  try {
    return await fn();
  } catch (e) {
    if (context.mounted) showError(context, e);
    return null;
  }
}

Future<bool> confirmSheet(
  BuildContext context, {
  required String title,
  String body = '',
  required String confirm,
  bool danger = false,
  String? art,
}) async {
  final cancel = tr(context, 'Cancel');
  final r = await showModalBottomSheet<bool>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (art != null) ...[Center(child: Image.asset(art, height: 84)), const SizedBox(height: 10)],
          Text(title, textAlign: TextAlign.center, style: IK.title(size: 24)),
          if (body.isNotEmpty) ...[const SizedBox(height: 8), Text(body, textAlign: TextAlign.center, style: IK.soft(size: 13.5))],
          const SizedBox(height: 18),
          IkButton(confirm, kind: danger ? BtnKind.danger : BtnKind.primary, onPressed: () => Navigator.pop(ctx, true)),
          const SizedBox(height: 8),
          IkButton(cancel, kind: BtnKind.ghost, onPressed: () => Navigator.pop(ctx, false)),
        ]),
      ),
    ),
  );
  return r ?? false;
}

/// push a screen
Future<T?> push<T>(BuildContext context, Widget screen) => Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => screen));

/// numbers card: "241 Guests"
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.value, required this.label, this.color = IK.plum, this.icon, this.onTap});
  final String value;
  final String label;
  final Color color;
  final String? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: .9), borderRadius: BorderRadius.circular(16), border: Border.all(color: IK.goldLine)),
        child: Column(children: [
          if (icon != null) ...[Image.asset(icon!, height: 30), const SizedBox(height: 4)],
          Text(value, style: TextStyle(fontFamily: IK.serif, fontSize: 24, fontWeight: FontWeight.w700, color: color, height: 1)),
          const SizedBox(height: 4),
          Text(label, textAlign: TextAlign.center, style: IK.soft(size: 10.5).copyWith(fontWeight: FontWeight.w700)),
        ]),
      ),
    );
  }
}

/// colour bar of replies: going / maybe / not going / none
class ReplyBar extends StatelessWidget {
  const ReplyBar({super.key, required this.going, required this.maybe, required this.notGoing, required this.none, this.height = 7});
  final int going;
  final int maybe;
  final int notGoing;
  final int none;
  final double height;

  @override
  Widget build(BuildContext context) {
    final total = going + maybe + notGoing + none;
    if (total == 0) return Container(height: height, decoration: BoxDecoration(color: IK.line, borderRadius: BorderRadius.circular(4)));
    Widget seg(int n, Color c) => n == 0 ? const SizedBox.shrink() : Expanded(flex: n, child: Container(color: c));
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: SizedBox(
        height: height,
        child: Row(children: [seg(going, IK.ok), seg(maybe, IK.g4), seg(notGoing, const Color(0xFFE05252)), seg(none, IK.v2)]),
      ),
    );
  }
}

/// small coloured dot used for function colours
class Dot extends StatelessWidget {
  const Dot(this.color, {super.key, this.size = 7});
  final Color color;
  final double size;
  @override
  Widget build(BuildContext context) => Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle));
}
