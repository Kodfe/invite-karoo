import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api.dart';
import '../../core/art.dart';
import '../../core/l10n.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/pic.dart';
import '../../widgets/ui.dart';

/// The invitation card the hosts uploaded — shown page by page, or as the PDF itself.
/// Invite Karoo never changes it.
class CardScreen extends StatefulWidget {
  const CardScreen({super.key, required this.weddingId, required this.card, required this.couple, required this.dates});
  final String weddingId;
  final Json card;
  final String couple;
  final String dates;

  @override
  State<CardScreen> createState() => _CardScreenState();
}

class _CardScreenState extends State<CardScreen> {
  final _pc = PageController();
  int _page = 0;
  String? _pdfPath;
  bool _loadingPdf = false;

  List<String> get _pages => (widget.card['pages'] as List? ?? const []).map((e) => '$e').toList();

  @override
  void initState() {
    super.initState();
    if (_pages.isEmpty) _fetchPdf();
  }

  Future<String?> _fetchPdf() async {
    if (_pdfPath != null) return _pdfPath;
    if (widget.card['pdfUrl'] == null) return null;
    setState(() => _loadingPdf = true);
    try {
      final bytes = await Session.read(context).api.bytes('/v1/weddings/${widget.weddingId}/card.pdf');
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/${'${widget.card['name']}'.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_')}');
      await f.writeAsBytes(bytes, flush: true);
      if (mounted) setState(() => _pdfPath = f.path);
      return f.path;
    } catch (e) {
      if (mounted) showError(context, e);
      return null;
    } finally {
      if (mounted) setState(() => _loadingPdf = false);
    }
  }

  Future<void> _share() async {
    final path = await _fetchPdf();
    final text = '${widget.couple} · ${widget.dates}';
    if (path != null) {
      await SharePlus.instance.share(ShareParams(files: [XFile(path)], text: text));
    } else {
      await SharePlus.instance.share(ShareParams(text: text));
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = _pages;
    Widget viewer;
    if (pages.isNotEmpty) {
      viewer = Column(children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: IK.goldLine, width: 3), boxShadow: IK.sh3),
            clipBehavior: Clip.antiAlias,
            child: PageView.builder(
              controller: _pc,
              itemCount: pages.length,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (c, i) => InteractiveViewer(maxScale: 4, child: Pic(pages[i], fit: BoxFit.contain)),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: IkButton(tr(context, 'Previous'), kind: BtnKind.ghost, compact: true, icon: Icons.chevron_left_rounded,
                onPressed: _page == 0 ? null : () => _pc.previousPage(duration: const Duration(milliseconds: 300), curve: Curves.easeOut)),
          ),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Text('${_page + 1} / ${pages.length}', style: IK.monoS(size: 13))),
          Expanded(
            child: IkButton(tr(context, 'Next'), kind: BtnKind.ghost, compact: true, icon: Icons.chevron_right_rounded,
                onPressed: _page >= pages.length - 1 ? null : () => _pc.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeOut)),
          ),
        ]),
      ]);
    } else if (_pdfPath != null) {
      viewer = Container(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: IK.goldLine, width: 3)),
        clipBehavior: Clip.antiAlias,
        child: PdfViewer.file(_pdfPath!),
      );
    } else {
      viewer = Center(
        child: _loadingPdf
            ? const CircularProgressIndicator(color: IK.v5)
            : EmptyState(art: Art.doliFrame, title: tr(context, 'The card is not here yet'), body: tr(context, 'The hosts have not uploaded their card.')),
      );
    }
    return Scaffold(
      backgroundColor: IK.ivory,
      body: IvoryBg(
        child: Column(children: [
          IkHeader(
            title: tr(context, 'The invitation'),
            sub: '${widget.couple} · ${widget.dates}',
            art: Art.chhatri,
            actions: [SquareBtn(icon: Icons.ios_share_rounded, onTap: _share)],
          ),
          Expanded(child: Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 10), child: viewer)),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(children: [
                const Icon(Icons.shield_outlined, size: 14, color: IK.ink4),
                const SizedBox(width: 6),
                Expanded(child: Text(tr(context, 'This is the card the hosts uploaded. Invite Karoo does not change it.'), style: IK.soft(size: 11))),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
