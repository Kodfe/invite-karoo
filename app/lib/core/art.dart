/// The 3D artwork that came with the design, by name.
class Art {
  Art._();
  static String a(String name) => 'assets/art/$name.webp';

  static const logo = 'assets/brand/logo.png';
  static String get rings => a('rings');
  static String get family => a('family');
  static String get couple => a('couple');
  static String get jaimala => a('jaimala');
  static String get sangeet => a('sangeet');
  static String get diyas => a('diyas');
  static String get hourglass => a('hourglass');
  static String get hourglass2 => a('hourglass2');
  static String get gathbandhan => a('gathbandhan');
  static String get mandap => a('mandap');
  static String get kaleere => a('kaleere');
  static String get bells => a('bells');
  static String get lanterns => a('lanterns');
  static String get aiBox => a('aiBox');
  static String get aiStars => a('aiStars');
  static String get cal3d => a('cal3d');
  static String get calBlue => a('calBlue');
  static String get calPink => a('calpink');
  static String get calPurple => a('calpurple');
  static String get mapsPin => a('mapsPin');
  static String get whatsapp => a('whatsapp');
  static String get whatsappWhite => a('whatsappWhite');
  static const waCircle = 'assets/art/waCircle.png';
  static String get mailIc => a('mailIc');
  static String get phoneIc => a('phoneIc');
  static String get chhatri => a('chhatri');
  static String get palki => a('palki');
  static String get doliFrame => a('doliFrame');
  static String get shubhVivah => a('shubhVivah');
  static String get lotus => a('lotus');
  static String get meeting => a('meeting');
  static String get instruments => a('instruments');
  static String get live => a('live');
  static String get cplSofa => a('cplSofa');
  static String get cplLap => a('cplLap');
  static String get cplWalk => a('cplWalk');
  static String get cplStand => a('cplStand');
  static String get cplBengali => a('cplBengali');
  static String get ringCeremony => a('ringceremony');

  static const homeHeader = 'assets/photos/home_art_header.jpg';
  static const homeCouple = 'assets/photos/home_art_couple.jpg';
  static const floral = 'assets/photos/home_art_floral.png';
  static const venue = 'assets/photos/home_art_venue.jpg';
  static const photoCelebrate = 'assets/photos/art_photo_celebrate.jpg';
  static const photoCity = 'assets/photos/art_photo_city.jpg';
  static const photoHealth = 'assets/photos/art_photo_health.jpg';
  static const photoPlan = 'assets/photos/art_photo_plan.jpg';
  static const photoWork = 'assets/photos/art_photo_work.jpg';

  /// a wedding function's illustration, chosen by its name first, then its icon key
  static String forFunction(String name, [String icon = '']) {
    final n = name.toLowerCase();
    if (n.contains('haldi')) return a('cplHaldi');
    if (n.contains('mehendi') || n.contains('mehndi')) return a('mehendi');
    if (n.contains('sangeet') || n.contains('garba')) return a('cplDance');
    if (n.contains('tilak') || n.contains('puja') || n.contains('pooja')) return a('diyas');
    if (n.contains('engage') || n.contains('ring')) return a('ringceremony');
    if (n.contains('reception')) return a('cplStand');
    if (n.contains('vidai') || n.contains('bidai')) return a('palki');
    if (n.contains('baraat')) return a('chhatri');
    if (n.contains('wedding') || n.contains('phera') || n.contains('vivah') || n.contains('shaadi')) return a('cplPhere');
    switch (icon) {
      case 'music':
        return a('sangeet');
      case 'flower':
        return a('mehendi');
      case 'gift':
        return a('cplStand');
      case 'diya':
        return a('diyas');
      default:
        return a('cplRitual');
    }
  }

  /// the picture for one of the guest's own events, by type
  static String forEventType(String type) {
    switch (type) {
      case 'Appointment':
        return photoHealth;
      case 'Meeting':
        return photoWork;
      case 'Celebration':
      case 'Birthday':
        return photoCelebrate;
      case 'Wedding':
        return homeCouple;
      case 'Personal':
        return photoPlan;
      default:
        return photoCity;
    }
  }
}
