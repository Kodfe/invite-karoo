import 'package:flutter/widgets.dart';

import 'session.dart';
import 'strings_gu.dart';
import 'strings_hi.dart';
import 'strings_ta.dart';

/// The app is written in English; each English line is its own key.
/// A line with no translation yet shows in English, so nothing is ever blank.
///   tr(context, 'Welcome back')
///   tr(context, 'Hi {name}', {'name': 'Mitesh'})
String tr(BuildContext context, String en, [Map<String, Object?> args = const {}]) {
  return trIn(Session.of(context).lang, en, args);
}

String trIn(String lang, String en, [Map<String, Object?> args = const {}]) {
  final table = switch (lang) {
    'hi' => hiStrings,
    'ta' => taStrings,
    'gu' => guStrings,
    _ => const <String, String>{},
  };
  var s = table[en] ?? en;
  args.forEach((k, v) => s = s.replaceAll('{$k}', '${v ?? ''}'));
  return s;
}

const languages = [
  ('en', 'English'),
  ('hi', 'हिन्दी'),
  ('ta', 'தமிழ்'),
  ('gu', 'ગુજરાતી'),
];

String languageName(String code) => languages.firstWhere((l) => l.$1 == code, orElse: () => languages.first).$2;
