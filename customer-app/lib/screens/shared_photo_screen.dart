import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../widgets/app_back_button.dart';
import 'photo_viewer_screen.dart';

/// Reloadable photo destination; all image URLs and permissions come from the gallery API.
class SharedPhotoScreen extends StatefulWidget {
  final String galleryId, photoId;
  const SharedPhotoScreen({super.key, required this.galleryId, required this.photoId});
  @override
  State<SharedPhotoScreen> createState() => _SharedPhotoScreenState();
}
class _SharedPhotoScreenState extends State<SharedPhotoScreen> {
  Map<String,dynamic>? _data;
  String? _error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final data = await ApiService.getGalleryPhotos(widget.galleryId, photoId: widget.photoId);
      if (!mounted) return;
      if ((data['photos'] as List).isEmpty) { setState(() => _error = 'This photo is no longer available. Open the gallery to see your current photos.'); }
      else { setState(() => _data = data); }
    } catch (e) { if (mounted) setState(() => _error = ApiService.errorMessage(e) ?? 'Could not open this photo.'); }
  }
  @override
  Widget build(BuildContext context) {
    if (_data != null) return PhotoViewerScreen(galleryId: widget.galleryId, photos: _data!['photos'] as List<Photo>, initialIndex: 0, selectionEnabled: false, downloadsAllowed: _data!['downloadsAllowed'] == true);
    return Scaffold(appBar: AppBar(leading: AppBackButton(fallback: '/gallery/${widget.galleryId}'), title: const Text('Shared photo')), body: Center(child: Padding(padding: const EdgeInsets.all(24), child: _error == null ? const CircularProgressIndicator() : Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.photo_outlined, size: 40), const SizedBox(height: 16), Text(_error!, textAlign: TextAlign.center), const SizedBox(height: 16), OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again'))]))));
  }
}
