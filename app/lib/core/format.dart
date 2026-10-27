import 'package:intl/intl.dart';

DateTime? parseTs(dynamic v) {
  if (v == null) return null;
  return DateTime.tryParse('$v')?.toLocal();
}

/// YYYY-MM-DD → DateTime (local midnight)
DateTime? parseDay(dynamic v) {
  if (v == null) return null;
  final s = '$v';
  if (s.length < 10) return null;
  final y = int.tryParse(s.substring(0, 4));
  final m = int.tryParse(s.substring(5, 7));
  final d = int.tryParse(s.substring(8, 10));
  if (y == null || m == null || d == null) return null;
  return DateTime(y, m, d);
}

String ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String dayMonth(DateTime d) => DateFormat('d MMM').format(d);
String dayMonthYear(DateTime d) => DateFormat('d MMM yyyy').format(d);
String weekdayDay(DateTime d) => DateFormat('EEE, d MMM').format(d);
String clock(DateTime d) => DateFormat('h:mm a').format(d);
String hhmm(DateTime d) => DateFormat('HH:mm').format(d);

/// "23 – 28 May 2026" or "30 May – 2 Jun 2026"
String span(dynamic from, dynamic to) {
  final a = parseDay(from);
  final b = parseDay(to);
  if (a == null) return '';
  if (b == null || ymd(a) == ymd(b)) return dayMonthYear(a);
  if (a.month == b.month && a.year == b.year) return '${a.day} – ${b.day} ${DateFormat('MMM yyyy').format(b)}';
  return '${dayMonth(a)} – ${dayMonthYear(b)}';
}

bool sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

/// "Today", "Tomorrow", "In 3 days", "2 days ago"
String relDay(DateTime d, [DateTime? now]) {
  final n = now ?? DateTime.now();
  final a = DateTime(d.year, d.month, d.day);
  final b = DateTime(n.year, n.month, n.day);
  final diff = a.difference(b).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  if (diff == -1) return 'Yesterday';
  if (diff > 1) return 'In $diff days';
  return '${-diff} days ago';
}

/// "just now", "12 min ago", "3 h ago", "22 May, 6:30 PM"
String ago(dynamic ts) {
  final t = parseTs(ts);
  if (t == null) return '';
  final m = DateTime.now().difference(t).inMinutes;
  if (m < 1) return 'just now';
  if (m < 60) return '$m min ago';
  if (m < 360) return '${m ~/ 60} h ago';
  return '${dayMonth(t)}, ${clock(t)}';
}

/// minutes before → "1 day before", "3 hours before", "30 min before"
String offsetLabel(int min) {
  if (min % 10080 == 0) return '${min ~/ 10080} week${min == 10080 ? '' : 's'} before';
  if (min % 1440 == 0) return '${min ~/ 1440} day${min == 1440 ? '' : 's'} before';
  if (min % 60 == 0) return '${min ~/ 60} hour${min == 60 ? '' : 's'} before';
  return '$min min before';
}

String rupees(num v) => '₹${NumberFormat.decimalPattern('en_IN').format(v)}';

String initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

int toInt(dynamic v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
