import 'package:flutter/material.dart';

import '../core/theme.dart';

/// An image that may be a bundled asset or a URL from the server, with a soft placeholder.
class Pic extends StatelessWidget {
  const Pic(this.src, {super.key, this.fit = BoxFit.cover, this.width, this.height, this.fallback, this.alignment = Alignment.center});
  final String? src;
  final BoxFit fit;
  final double? width;
  final double? height;
  final String? fallback;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    final s = (src == null || src!.isEmpty) ? fallback : src;
    if (s == null) return _blank();
    if (s.startsWith('http')) {
      return Image.network(
        s,
        fit: fit,
        width: width,
        height: height,
        alignment: alignment,
        loadingBuilder: (c, child, p) => p == null ? child : _blank(),
        errorBuilder: (c, e, st) => fallback != null ? Image.asset(fallback!, fit: fit, width: width, height: height, alignment: alignment) : _blank(),
      );
    }
    return Image.asset(s, fit: fit, width: width, height: height, alignment: alignment);
  }

  Widget _blank() => Container(
        width: width,
        height: height,
        decoration: const BoxDecoration(gradient: LinearGradient(colors: [IK.v1, IK.g1])),
      );
}

/// rounded picture tile used on agenda and list rows
class Thumb extends StatelessWidget {
  const Thumb(this.src, {super.key, this.size = 58, this.radius = 16, this.contain = false, this.bg});
  final String src;
  final double size;
  final double radius;
  final bool contain;
  final Color? bg;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: contain ? const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF4ECFF), Color(0xFFFFEFF4)]) : null,
        color: bg,
        border: Border.all(color: IK.goldLine),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: EdgeInsets.all(contain ? 4 : 0),
        child: Pic(src, fit: contain ? BoxFit.contain : BoxFit.cover, alignment: contain ? Alignment.bottomCenter : Alignment.center),
      ),
    );
  }
}
