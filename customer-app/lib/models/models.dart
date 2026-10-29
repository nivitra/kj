class Studio {
  final String id, name;
  final String? logoUrl;
  const Studio({required this.id, required this.name, this.logoUrl});
  factory Studio.fromJson(Map<String, dynamic> j) => Studio(
        id: j['id'] as String,
        name: j['name'] as String? ?? 'Studio',
        logoUrl: j['logoUrl'] as String?,
      );
}

class StudioPackage {
  final String id, name;
  final String? description, workflowMode, priceLabel;
  final double basePrice;
  final int? includedPhotos;
  final double? pricePerExtraPhoto;
  final bool active;

  const StudioPackage({
    required this.id,
    required this.name,
    this.description,
    this.workflowMode,
    required this.basePrice,
    this.includedPhotos,
    this.pricePerExtraPhoto,
    this.active = true,
    this.priceLabel,
  });

  factory StudioPackage.fromJson(Map<String, dynamic> j) => StudioPackage(
        id: j['id'] as String,
        name: j['name'] as String? ?? j['title'] as String? ?? '',
        description: j['description'] as String?,
        workflowMode: j['workflowMode'] as String?,
        basePrice: (j['basePrice'] is num)
            ? (j['basePrice'] as num).toDouble()
            : (j['price'] is num)
                ? (j['price'] as num).toDouble()
                : 0,
        includedPhotos: j['includedPhotos'] as int?,
        pricePerExtraPhoto: j['pricePerExtraPhoto'] is num
            ? (j['pricePerExtraPhoto'] as num).toDouble()
            : null,
        active: j['active'] != false,
        priceLabel: j['priceLabel'] as String?,
      );

  String get displayPrice {
    if (priceLabel != null && priceLabel!.trim().isNotEmpty) return priceLabel!;
    if (basePrice > 0) return '₹${basePrice.toStringAsFixed(0)} onwards';
    return 'Contact for price';
  }
}

class Customer {
  final String id, name;
  final String? email, phone, loginId, status;
  final Studio? studio;
  final StudioPackage? package;
  final StudioPackage? requestedPackage;
  final bool weddingExperience;
  final String? brideName, groomName, weddingVenue;
  final String? couplePhotoUrl, weddingCoverUrl, bookingPhotoUrl;
  final DateTime? weddingDate;
  final String? albumStatus, deliveryStatus, photographerName, cinematographerName, weddingNotes;

  const Customer({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.loginId,
    this.status,
    this.studio,
    this.package,
    this.requestedPackage,
    this.weddingExperience = false,
    this.brideName,
    this.groomName,
    this.weddingVenue,
    this.couplePhotoUrl,
    this.weddingCoverUrl,
    this.bookingPhotoUrl,
    this.weddingDate,
    this.albumStatus,
    this.deliveryStatus,
    this.photographerName,
    this.cinematographerName,
    this.weddingNotes,
  });

  factory Customer.fromJson(Map<String, dynamic> j) => Customer(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        email: j['email'] as String?,
        phone: j['phone'] as String?,
        loginId: j['loginId'] as String?,
        status: j['status'] as String?,
        studio: j['studio'] != null
            ? Studio.fromJson(Map<String, dynamic>.from(j['studio'] as Map))
            : null,
        package: j['package'] is Map
            ? StudioPackage.fromJson(Map<String, dynamic>.from(j['package'] as Map))
            : null,
        requestedPackage: j['requestedPackage'] is Map
            ? StudioPackage.fromJson(Map<String, dynamic>.from(j['requestedPackage'] as Map))
            : null,
        weddingExperience: j['weddingExperience'] == true,
        brideName: j['brideName'] as String?,
        groomName: j['groomName'] as String?,
        weddingVenue: j['weddingVenue'] as String?,
        couplePhotoUrl: j['couplePhotoUrl'] as String?,
        weddingCoverUrl: j['weddingCoverUrl'] as String?,
        bookingPhotoUrl: j['bookingPhotoUrl'] as String?,
        weddingDate: j['weddingDate'] != null ? DateTime.tryParse(j['weddingDate'].toString()) : null,
        albumStatus: j['albumStatus'] as String?,
        deliveryStatus: j['deliveryStatus'] as String?,
        photographerName: j['photographerName'] as String?,
        cinematographerName: j['cinematographerName'] as String?,
        weddingNotes: j['weddingNotes'] as String?,
      );
}

class BulkRawOffer {
  final bool enabled, live, purchased, pending;
  final double? price;
  final String? priceLabel, headline, body, invoiceId, invoiceNumber;
  final int? daysLeft, photoCount;

  const BulkRawOffer({
    this.enabled = false,
    this.live = false,
    this.purchased = false,
    this.pending = false,
    this.price,
    this.priceLabel,
    this.headline,
    this.body,
    this.invoiceId,
    this.invoiceNumber,
    this.daysLeft,
    this.photoCount,
  });

  factory BulkRawOffer.fromJson(Map<String, dynamic>? j) {
    if (j == null) return const BulkRawOffer();
    return BulkRawOffer(
      enabled: j['enabled'] == true,
      live: j['live'] == true,
      purchased: j['purchased'] == true,
      pending: j['pending'] == true,
      price: j['price'] is num ? (j['price'] as num).toDouble() : null,
      priceLabel: j['priceLabel'] as String?,
      headline: j['headline'] as String?,
      body: j['body'] as String?,
      invoiceId: j['invoiceId'] as String?,
      invoiceNumber: j['invoiceNumber'] as String?,
      daysLeft: (j['daysLeft'] as num?)?.toInt(),
      photoCount: (j['photoCount'] as num?)?.toInt(),
    );
  }
}

class Gallery {
  final String id, name, status;
  final String? description, coverPhotoUrl, eventDate, purpose, workflowMode;
  final String? createdAt, ageLabel, expiresAt, packageName;
  final bool downloadEnabled, paymentComplete, faceSearchEnabled;
  final bool downloadsAllowed, selectionEnabled, rawAccess;
  final String accessMode;
  final String? accessLabel;
  final bool extrasBillable;
  final double? extraRate;
  final int includedLimit;
  final int photoCount;
  final BulkRawOffer bulkRawOffer;

  const Gallery({
    required this.id,
    required this.name,
    required this.status,
    this.description,
    this.coverPhotoUrl,
    this.eventDate,
    this.purpose,
    this.workflowMode,
    this.createdAt,
    this.ageLabel,
    this.expiresAt,
    this.packageName,
    required this.downloadEnabled,
    required this.paymentComplete,
    required this.faceSearchEnabled,
    this.downloadsAllowed = false,
    this.selectionEnabled = true,
    this.rawAccess = false,
    this.accessMode = 'SELECTION',
    this.accessLabel,
    this.extrasBillable = true,
    this.extraRate,
    this.includedLimit = 0,
    required this.photoCount,
    this.bulkRawOffer = const BulkRawOffer(),
  });

  factory Gallery.fromJson(Map<String, dynamic> j) => Gallery(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        status: j['status'] as String? ?? 'DRAFT',
        description: j['description'] as String?,
        coverPhotoUrl: j['coverPhotoUrl'] as String?,
        eventDate: j['eventDate']?.toString(),
        purpose: j['purpose'] as String?,
        workflowMode: j['workflowMode'] as String?,
        createdAt: j['createdAt']?.toString(),
        ageLabel: j['ageLabel'] as String?,
        expiresAt: j['expiresAt']?.toString(),
        packageName: j['packageName'] as String?,
        downloadEnabled: j['downloadEnabled'] == true,
        paymentComplete: j['paymentComplete'] == true,
        faceSearchEnabled: j['faceSearchEnabled'] == true,
        downloadsAllowed: j['downloadsAllowed'] == true
            || j['rawAccess'] == true
            || j['accessMode'] == 'RAW'
            || (j['downloadsAllowed'] == null && j['downloadEnabled'] == true),
        rawAccess: j['rawAccess'] == true || j['accessMode'] == 'RAW',
        accessMode: (j['accessMode'] as String?) ??
            (j['rawAccess'] == true ? 'RAW' : 'SELECTION'),
        accessLabel: j['accessLabel'] as String?,
        extrasBillable: j['extrasBillable'] != false,
        extraRate: (j['extraRate'] as num?)?.toDouble(),
        includedLimit: (j['includedLimit'] as num?)?.toInt() ?? 0,
        selectionEnabled: j['accessMode'] == 'RAW' || j['rawAccess'] == true || j['accessMode'] == 'VIEW'
            ? false
            : j['selectionEnabled'] != false &&
            j['workflowMode'] != 'DOWNLOAD_ONLY' &&
            j['purpose'] != 'DELIVERY' &&
            j['selectionEnabled'] != false,
        photoCount: (j['_count'] is Map ? j['_count']['photos'] : j['photoCount']) as int? ?? 0,
        bulkRawOffer: BulkRawOffer.fromJson(
          j['bulkRawOffer'] is Map ? Map<String, dynamic>.from(j['bulkRawOffer'] as Map) : null,
        ),
      );

  bool get isPublished => status == 'PUBLISHED';
  bool get isDeliveryGallery =>
      purpose == 'DELIVERY' || workflowMode == 'DOWNLOAD_ONLY';
  bool get isRawMode => accessMode == 'RAW' || rawAccess;
  bool get isViewOnly => accessMode == 'VIEW';
}

class Photo {
  final String id, filename;
  final String mediaType; // IMAGE | VIDEO
  final String? thumbnailUrl, previewUrl, downloadUrl, streamUrl, galleryId;
  final int? width, height, durationMs, fileSize;
  final bool isFavorite;
  /// True when original can be signed on demand (list no longer bulk-presigns).
  final bool downloadAvailable;

  const Photo({
    required this.id,
    required this.filename,
    this.mediaType = 'IMAGE',
    this.thumbnailUrl,
    this.previewUrl,
    this.downloadUrl,
    this.streamUrl,
    this.galleryId,
    this.width,
    this.height,
    this.durationMs,
    this.fileSize,
    required this.isFavorite,
    this.downloadAvailable = false,
  });

  bool get isVideo => mediaType == 'VIDEO';

  /// Whether the client can attempt a full-original download.
  bool get canDownload =>
      (downloadUrl != null && downloadUrl!.isNotEmpty) || downloadAvailable;

  factory Photo.fromJson(Map<String, dynamic> j) => Photo(
        id: j['id'] as String,
        filename: j['filename'] as String? ?? '',
        mediaType: (j['mediaType'] as String?) ?? 'IMAGE',
        thumbnailUrl: j['thumbnailUrl'] as String?,
        previewUrl: j['previewUrl'] as String?,
        downloadUrl: j['downloadUrl'] as String?,
        streamUrl: j['streamUrl'] as String?,
        galleryId: j['galleryId'] as String?,
        width: j['width'] as int?,
        height: j['height'] as int?,
        durationMs: j['durationMs'] as int?,
        fileSize: (j['fileSize'] as num?)?.toInt(),
        isFavorite: j['isFavorite'] == true,
        downloadAvailable: j['downloadAvailable'] == true ||
            (j['downloadUrl'] is String && (j['downloadUrl'] as String).isNotEmpty),
      );

  Photo copyWith({bool? isFavorite, String? downloadUrl, bool? downloadAvailable}) => Photo(
        id: id,
        filename: filename,
        mediaType: mediaType,
        thumbnailUrl: thumbnailUrl,
        previewUrl: previewUrl,
        downloadUrl: downloadUrl ?? this.downloadUrl,
        streamUrl: streamUrl,
        galleryId: galleryId,
        width: width,
        height: height,
        durationMs: durationMs,
        fileSize: fileSize,
        isFavorite: isFavorite ?? this.isFavorite,
        downloadAvailable: downloadAvailable ?? this.downloadAvailable,
      );
}

class SelectionState {
  final int revision;
  final String status;
  final DateTime? submittedAt;
  final int count;
  final Map<String, dynamic>? estimate;
  final List<dynamic>? history;
  final String selectionPhase;
  final int? includedLimit;
  final int? slotsRemaining;
  final bool extrasUnlocked;
  final String? phaseLabel;
  final String? phaseHint;
  final String? statusLabel;
  final List<String> lockedPhotoIds;
  final List<String> billedExtraPhotoIds;
  final List<String> pendingExtraPhotoIds;
  final double extraRate;

  const SelectionState({
    required this.status,
    this.revision = 0,
    this.submittedAt,
    required this.count,
    this.estimate,
    this.history,
    this.selectionPhase = 'INCLUDED',
    this.includedLimit,
    this.slotsRemaining,
    this.extrasUnlocked = false,
    this.phaseLabel,
    this.phaseHint,
    this.statusLabel,
    this.lockedPhotoIds = const [],
    this.billedExtraPhotoIds = const [],
    this.pendingExtraPhotoIds = const [],
    this.extraRate = 350,
  });

  factory SelectionState.fromJson(Map<String, dynamic> j) {
    final est = j['estimate'] is Map
        ? Map<String, dynamic>.from(j['estimate'] as Map)
        : <String, dynamic>{};
    if (j['billing'] is Map && est['billing'] == null) {
      est['billing'] = j['billing'];
    }
    final phase = (j['selectionPhase'] ?? est['selectionPhase'] ?? 'INCLUDED').toString();
    final limit = (j['includedLimit'] as num?)?.toInt()
        ?? (est['includedPhotos'] as num?)?.toInt()
        ?? (est['includedLimit'] as num?)?.toInt()
        ?? (est['selectionLimit'] as num?)?.toInt();
    final lockedRaw = j['lockedPhotoIds'] ?? est['lockedPhotoIds'];
    final locked = lockedRaw is List
        ? lockedRaw.map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
        : <String>[];
    List<String> idList(dynamic raw) => raw is List
        ? raw.map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
        : <String>[];
    final billed = idList(j['billedExtraPhotoIds'] ?? est['billedExtraPhotoIds']);
    final pending = idList(j['pendingExtraPhotoIds'] ?? est['pendingExtraPhotoIds']);
    final rate = (j['extraRate'] as num?)?.toDouble()
        ?? (est['pricePerExtraEdited'] as num?)?.toDouble()
        ?? (est['pricePerExtraPhoto'] as num?)?.toDouble()
        ?? (est['extraRate'] as num?)?.toDouble()
        ?? 350;
    return SelectionState(
      revision: (j['revision'] as num?)?.toInt() ?? 0,
      status: j['status'] as String? ?? 'OPEN',
      submittedAt: j['submittedAt'] != null ? DateTime.tryParse(j['submittedAt'].toString()) : null,
      count: j['count'] as int? ?? 0,
      estimate: est.isEmpty ? null : est,
      history: j['history'] is List ? List<dynamic>.from(j['history'] as List) : null,
      selectionPhase: phase,
      includedLimit: limit,
      slotsRemaining: (j['slotsRemaining'] as num?)?.toInt()
          ?? (est['slotsRemaining'] as num?)?.toInt(),
      extrasUnlocked: j['extrasUnlocked'] == true || est['extrasUnlocked'] == true || phase == 'EXTRAS',
      phaseLabel: (j['phaseLabel'] ?? est['phaseLabel'])?.toString(),
      phaseHint: (j['phaseHint'] ?? est['phaseHint'] ?? est['nextStep'])?.toString(),
      statusLabel: j['statusLabel']?.toString(),
      lockedPhotoIds: locked,
      billedExtraPhotoIds: billed,
      pendingExtraPhotoIds: pending,
      extraRate: rate > 0 ? rate : 0,
    );
  }

  bool get isSubmitted => status == 'SUBMITTED';
  bool get isOpen => status == 'OPEN' || status == 'UNLOCKED';
  bool get isIncludedPhase => selectionPhase != 'EXTRAS';
  bool get isExtrasPhase => selectionPhase == 'EXTRAS';
  bool isLocked(String photoId) => lockedPhotoIds.contains(photoId);
  bool isBilledExtra(String photoId) => billedExtraPhotoIds.contains(photoId);
}

class ContractItem {
  final String id, title, status;
  final DateTime? sentAt, viewedAt, acceptedAt;

  const ContractItem({
    required this.id,
    required this.title,
    required this.status,
    this.sentAt,
    this.viewedAt,
    this.acceptedAt,
  });

  factory ContractItem.fromJson(Map<String, dynamic> j) => ContractItem(
        id: j['id'] as String,
        title: j['title'] as String? ?? 'Contract',
        status: j['status'] as String? ?? 'SENT',
        sentAt: j['sentAt'] != null ? DateTime.tryParse(j['sentAt'].toString()) : null,
        viewedAt: j['viewedAt'] != null ? DateTime.tryParse(j['viewedAt'].toString()) : null,
        acceptedAt: j['acceptedAt'] != null ? DateTime.tryParse(j['acceptedAt'].toString()) : null,
      );

  bool get isAccepted => status == 'ACCEPTED';
}
