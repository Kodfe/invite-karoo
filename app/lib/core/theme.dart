import 'package:flutter/material.dart';

/// Design tokens, sampled from the logo artwork (same values as the HTML prototype).
class IK {
  IK._();

  // ink
  static const ink = Color(0xFF14082B);
  static const ink2 = Color(0xFF241046);
  static const ink3 = Color(0xFF6B5A8A);
  static const ink4 = Color(0xFF9C8DB8);
  // violet
  static const v9 = Color(0xFF1A0B36);
  static const v8 = Color(0xFF2A1454);
  static const v7 = Color(0xFF3B1F73);
  static const v6 = Color(0xFF4B2A8E);
  static const v5 = Color(0xFF5F37A8);
  static const v4 = Color(0xFF7C5CBF);
  static const v3 = Color(0xFFB79AE8);
  static const v2 = Color(0xFFD8C9F2);
  static const v1 = Color(0xFFEDE6F9);
  static const v0 = Color(0xFFF7F3FD);
  // gold
  static const g7 = Color(0xFF8A5A12);
  static const g6 = Color(0xFFA96C06);
  static const g5 = Color(0xFFD18A08);
  static const g4 = Color(0xFFFBAF1B);
  static const g3 = Color(0xFFFFD277);
  static const g2 = Color(0xFFFFE8B0);
  static const g1 = Color(0xFFFFF4DA);
  static const g0 = Color(0xFFFFFAEE);
  static const gold = Color(0xFFC9A24D);
  static const goldInk = Color(0xFF9A6A14);
  static const goldLine = Color(0xFFEFE2C8);
  // paper
  static const paper = Color(0xFFFFF8F4);
  static const paper2 = Color(0xFFF4EBE4);
  static const ivory = Color(0xFFFFFBF5);
  static const plum = Color(0xFF2A1454);
  static const line = Color(0xFFEBE1F5);
  static const line2 = Color(0xFFDCCDEC);
  // states
  static const ok = Color(0xFF16A34A);
  static const okBg = Color(0xFFE8F8EE);
  static const okLine = Color(0xFFB8E6C8);
  static const bad = Color(0xFFD62828);
  static const badBg = Color(0xFFFDEDED);
  static const badLine = Color(0xFFF5C9C9);
  static const info = Color(0xFF1D4ED8);
  static const infoBg = Color(0xFFE6EDFD);
  static const mag = Color(0xFFA21CAF);
  static const magBg = Color(0xFFFCF0FE);
  static const warn = Color(0xFFD97706);
  static const warnBg = Color(0xFFFFF4DA);
  static const whatsapp = Color(0xFF25D366);

  static const btnGradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [v5, v7]);
  static const goldGradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFFFE08A), g4]);
  static const darkGradient = LinearGradient(begin: Alignment(-0.4, -1), end: Alignment(0.4, 1), colors: [v8, Color(0xFF170A32)]);
  static const consoleGradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF6B1E7A), Color(0xFF2A0F3A)]);

  static final List<BoxShadow> sh1 = [
    BoxShadow(color: ink.withValues(alpha: .04), blurRadius: 2, offset: const Offset(0, 1)),
    BoxShadow(color: ink.withValues(alpha: .05), blurRadius: 8, offset: const Offset(0, 2)),
  ];
  static final List<BoxShadow> sh2 = [BoxShadow(color: ink.withValues(alpha: .09), blurRadius: 16, offset: const Offset(0, 4))];
  static final List<BoxShadow> sh3 = [BoxShadow(color: ink.withValues(alpha: .26), blurRadius: 40, spreadRadius: -12, offset: const Offset(0, 16))];
  static final List<BoxShadow> btnShadow = [BoxShadow(color: v6.withValues(alpha: .55), blurRadius: 24, spreadRadius: -8, offset: const Offset(0, 10))];
  static final List<BoxShadow> cardShadow = [
    BoxShadow(color: const Color(0xFF5B340A).withValues(alpha: .5), blurRadius: 26, spreadRadius: -20, offset: const Offset(0, 12)),
  ];

  // type
  static const display = 'Cinzel';
  static const serif = 'Cormorant';
  static const sans = 'Jakarta';
  static const mono = 'DMMono';
  static const script = 'Pinyon';

  static TextStyle title({double size = 30, Color color = plum}) =>
      TextStyle(fontFamily: serif, fontSize: size, fontWeight: FontWeight.w700, color: color, height: 1.08);
  static TextStyle h2({double size = 20, Color color = plum}) =>
      TextStyle(fontFamily: serif, fontSize: size, fontWeight: FontWeight.w700, color: color, height: 1.15);
  static TextStyle kicker({double size = 19, Color color = goldInk}) => TextStyle(fontFamily: script, fontSize: size, color: color, height: 1.15);
  static TextStyle body({double size = 13.5, Color color = ink2, FontWeight weight = FontWeight.w500, double height = 1.5}) =>
      TextStyle(fontFamily: sans, fontSize: size, color: color, fontWeight: weight, height: height);
  static TextStyle strong({double size = 14, Color color = ink}) =>
      TextStyle(fontFamily: sans, fontSize: size, color: color, fontWeight: FontWeight.w800, height: 1.3);
  static TextStyle soft({double size = 12.5, Color color = ink3}) =>
      TextStyle(fontFamily: sans, fontSize: size, color: color, height: 1.55, fontWeight: FontWeight.w500);
  static TextStyle label({double size = 10.5, Color color = ink3}) =>
      TextStyle(fontFamily: sans, fontSize: size, fontWeight: FontWeight.w800, letterSpacing: 1.2, color: color);
  static TextStyle monoS({double size = 11, Color color = ink3, FontWeight weight = FontWeight.w400}) =>
      TextStyle(fontFamily: mono, fontSize: size, color: color, fontWeight: weight);

  static ThemeData theme() {
    final base = ThemeData(
      useMaterial3: true,
      fontFamily: sans,
      colorScheme: ColorScheme.fromSeed(seedColor: v5, primary: v6, secondary: g4, surface: ivory),
      scaffoldBackgroundColor: ivory,
    );
    OutlineInputBorder box(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: c, width: 1.5));
    return base.copyWith(
      textTheme: base.textTheme.apply(fontFamily: sans, bodyColor: ink, displayColor: ink),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: ink2,
        contentTextStyle: body(color: paper, weight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 15),
        hintStyle: body(size: 15, color: ink4),
        border: box(line),
        enabledBorder: box(line),
        focusedBorder: box(v4),
        errorBorder: box(badLine),
        focusedErrorBorder: box(bad),
        errorStyle: body(size: 11.5, color: bad, weight: FontWeight.w600),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: ivory,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      }),
    );
  }
}

/// Function colours as hex strings from the API → Color.
Color hexColor(String? hex, [Color fallback = IK.v4]) {
  if (hex == null || hex.length < 7) return fallback;
  final v = int.tryParse(hex.replaceFirst('#', ''), radix: 16);
  if (v == null) return fallback;
  return Color(0xFF000000 | v);
}
