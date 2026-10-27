import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/format.dart';

/// One row of the agenda: an Invite Karoo wedding function, or something the guest added.
class AgendaItem {
  AgendaItem._({
    required this.kind,
    required this.start,
    required this.end,
    required this.allDay,
    required this.title,
    required this.sub,
    required this.image,
    required this.imageContain,
    required this.raw,
  });

  /// 'fn' = a function of a wedding the guest is invited to · 'own' = the guest's own event
  final String kind;
  final DateTime start;
  final DateTime end;
  final bool allDay;
  final String title;
  final String sub;
  final String image;
  final bool imageContain;
  final Json raw;

  bool get isFn => kind == 'fn';
  DateTime get day => DateTime(start.year, start.month, start.day);

  /// 'live' | 'done' | 'later' | 'allday'
  String state([DateTime? now]) {
    final n = now ?? DateTime.now();
    if (allDay) return sameDay(start, n) ? 'allday' : (end.isBefore(n) ? 'done' : 'later');
    if (end.isBefore(n)) return 'done';
    if (!start.isAfter(n)) return 'live';
    return 'later';
  }

  /// 'need' | 'ok' | 'no' | '' — the reply tag on a function card
  String get tag {
    if (!isFn) return '';
    final r = '${raw['rsvp']}';
    final w = '${asJson(raw['window'])['state']}';
    if (r == 'going') return 'ok';
    if (r == 'not_going') return 'no';
    if (r == 'none' && (w == 'open' || w == 'soon')) return 'need';
    return '';
  }

  static AgendaItem fromFunction(Json f) {
    final s = parseTs(f['startsAt']) ?? DateTime.now();
    final e = parseTs(f['endsAt']) ?? s.add(const Duration(hours: 4));
    return AgendaItem._(
      kind: 'fn',
      start: s,
      end: e,
      allDay: false,
      title: '${f['name']}',
      sub: '${f['couple'] ?? ''} · ${f['venueName'] ?? ''}',
      image: Art.forFunction('${f['name']}', '${f['icon'] ?? ''}'),
      imageContain: true,
      raw: f,
    );
  }

  static AgendaItem fromEvent(Json e) {
    final d = parseDay(e['date']) ?? DateTime.now();
    final t = '${e['time'] ?? ''}';
    final allDay = t.isEmpty || t == 'null';
    DateTime s = d;
    if (!allDay) {
      final p = t.split(':');
      s = DateTime(d.year, d.month, d.day, int.tryParse(p[0]) ?? 0, int.tryParse(p.length > 1 ? p[1] : '0') ?? 0);
    }
    final end = allDay ? DateTime(d.year, d.month, d.day, 23, 59) : s.add(const Duration(hours: 2));
    final fns = asList(e['functions']);
    final venue = '${e['venue'] ?? ''}';
    return AgendaItem._(
      kind: 'own',
      start: s,
      end: end,
      allDay: allDay,
      title: '${e['title']}',
      sub: e['isWedding'] == true && fns.isNotEmpty ? '${fns.length} functions${venue.isEmpty ? '' : ' · $venue'}' : venue,
      image: (e['imageUrl'] as String?) ?? Art.forEventType('${e['type']}'),
      imageContain: false,
      raw: e,
    );
  }
}

/// a guest's own wedding (typed in or scanned) also places each of its functions on its day
List<AgendaItem> expandOwn(Json e) {
  final out = <AgendaItem>[AgendaItem.fromEvent(e)];
  for (final f in asList(e['functions'])) {
    final d = '${f['date'] ?? ''}';
    if (d.isEmpty || d == '${e['date']}') continue;
    out.add(AgendaItem.fromEvent({
      ...e,
      'title': '${f['name']} · ${e['title']}',
      'date': d,
      'time': (f['time'] == null || '${f['time']}'.isEmpty) ? null : f['time'],
      'venue': f['venue'] ?? e['venue'],
      'functions': const [],
      'isWedding': false,
    }));
  }
  return out;
}
