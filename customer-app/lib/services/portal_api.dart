import 'api_service.dart';
import 'portal_cache.dart';

/// Customer Portal V2 read/write APIs (CMS-driven content).
class PortalApi {
  static Future<List<dynamic>> announcements({String? id}) async {
    final response = await ApiService.dio.get('/portal/announcements', queryParameters: {if (id != null) 'id': id});
    return (ApiService.unwrapData(response)['announcements'] as List?) ?? [];
  }

  static Future<Map<String, dynamic>> home({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<Map<String, dynamic>>('home');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/home');
    final data = Map<String, dynamic>.from(ApiService.unwrapData(res));
    PortalCache.set('home', data);
    // Seed related caches from home payload when present
    if (data['packages'] is List) {
      PortalCache.set('packages', List<dynamic>.from(data['packages'] as List));
    }
    if (data['portfolio'] is List) {
      PortalCache.set('portfolio_list', List<dynamic>.from(data['portfolio'] as List));
    }
    if (data['profile'] is Map) {
      PortalCache.set('profile', Map<String, dynamic>.from(data['profile'] as Map));
    }
    return data;
  }

  static Future<List<dynamic>> packages({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<List<dynamic>>('packages');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/packages');
    final data = ApiService.unwrapData(res);
    final list = (data['packages'] as List?) ?? [];
    PortalCache.set('packages', list);
    return list;
  }

  /// Grid list — cover only (fast). Full multi-media via [portfolioItem].
  static Future<List<dynamic>> portfolio({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<List<dynamic>>('portfolio');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/portfolio');
    final data = ApiService.unwrapData(res);
    final list = (data['items'] as List?) ?? [];
    PortalCache.set('portfolio', list);
    return list;
  }

  /// Full media for one Our Work item (open detail).
  /// Always hits the network so multi-photo sets stay fresh (list is cover-only).
  static Future<Map<String, dynamic>> portfolioItem(String id) async {
    final cacheKey = 'portfolio_item_$id';
    final res = await ApiService.dio.get('/portal/portfolio/$id');
    final data = ApiService.unwrapData(res);
    final item = Map<String, dynamic>.from(
      (data is Map && data['item'] is Map)
          ? data['item'] as Map
          : (data is Map ? data : <String, dynamic>{}),
    );
    // Only cache complete multi-media payloads
    final media = item['media'];
    final count = (item['mediaCount'] as num?)?.toInt() ?? 0;
    if (media is List && (media.length > 1 || count <= 1)) {
      PortalCache.set(cacheKey, item, ttl: const Duration(minutes: 5));
    }
    return item;
  }

  static Future<Map<String, dynamic>> booking() async {
    final res = await ApiService.dio.get('/portal/booking-status');
    final data = ApiService.unwrapData(res);
    if (data is Map && data['booking'] is Map) {
      return Map<String, dynamic>.from(data['booking'] as Map);
    }
    return <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> weddingInquiryCatalog() async {
    final res = await ApiService.dio.get('/portal/wedding-inquiry/catalog');
    final data = ApiService.unwrapData(res);
    return Map<String, dynamic>.from(data is Map ? data : {});
  }

  static Future<Map<String, dynamic>?> getWeddingInquiry() async {
    final res = await ApiService.dio.get('/portal/wedding-inquiry');
    final data = ApiService.unwrapData(res);
    if (data is Map && data['inquiry'] is Map) {
      return Map<String, dynamic>.from(data['inquiry'] as Map);
    }
    return null;
  }

  static Future<Map<String, dynamic>> submitWeddingInquiry(Map<String, dynamic> body) async {
    final res = await ApiService.dio.post('/portal/wedding-inquiry', data: body);
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map? ?? {});
  }

  /// Wedding hub: days, deliverables, delivery timeline, booking progress.
  static Future<Map<String, dynamic>> weddingPlan({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<Map<String, dynamic>>('wedding_plan');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/wedding-plan');
    final data = ApiService.unwrapData(res);
    final plan = Map<String, dynamic>.from(
      (data is Map && data['plan'] is Map)
          ? data['plan'] as Map
          : (data is Map ? data : <String, dynamic>{}),
    );
    PortalCache.set('wedding_plan', plan, ttl: const Duration(minutes: 2));
    return plan;
  }

  static Future<Map<String, dynamic>> contact({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<Map<String, dynamic>>('contact');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/contact');
    final data = ApiService.unwrapData(res);
    final contact = Map<String, dynamic>.from(data['contact'] as Map? ?? {});
    PortalCache.set('contact', contact, ttl: const Duration(minutes: 5));
    return contact;
  }

  /// Customer account profile (+ optional nested studio branding).
  static Future<Map<String, dynamic>> profile({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<Map<String, dynamic>>('profile_full');
      if (hit != null) return hit;
      final fromHome = PortalCache.get<Map<String, dynamic>>('profile');
      if (fromHome != null) return fromHome;
    }
    final res = await ApiService.dio.get('/portal/profile');
    final data = ApiService.unwrapData(res);
    final profile = Map<String, dynamic>.from(data['profile'] as Map? ?? {});
    // Attach studio map when present so Profile UI can brand without a second call.
    if (data is Map && data['studio'] is Map) {
      profile['_studio'] = Map<String, dynamic>.from(data['studio'] as Map);
    }
    PortalCache.set('profile_full', profile);
    return profile;
  }

  /// Full portal profile payload including studio branding.
  static Future<Map<String, dynamic>> profileBundle() async {
    final res = await ApiService.dio.get('/portal/profile');
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map? ?? {});
  }

  static Future<void> updateProfile({String? name, String? phone}) async {
    await ApiService.dio.patch('/portal/profile', data: {
      if (name != null) 'name': name,
      if (phone != null) 'phone': phone,
    });
  }

  /// Create enquiry / book request. BOOK requires [requestedDate] + [requestedTime].
  /// Returns lead payload including slotStatus.
  static Future<Map<String, dynamic>> createLead({
    String? packageId,
    String? message,
    String source = 'ENQUIRE',
    String? couponCode,
    DateTime? requestedDate,
    String? requestedTime,
  }) async {
    final res = await ApiService.dio.post('/portal/lead', data: {
      if (packageId != null) 'packageId': packageId,
      if (message != null) 'message': message,
      'source': source,
      if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode,
      if (requestedDate != null)
        'requestedDate': requestedDate.toIso8601String().split('T').first,
      if (requestedTime != null && requestedTime.isNotEmpty) 'requestedTime': requestedTime,
    });
    final data = ApiService.unwrapData(res);
    if (data is Map) return Map<String, dynamic>.from(data);
    return {};
  }

  static Future<Map<String, dynamic>> myBookingRequests({bool force = false}) async {
    if (!force) {
      final hit = PortalCache.get<Map<String, dynamic>>('my_requests');
      if (hit != null) return hit;
    }
    final res = await ApiService.dio.get('/portal/my-requests');
    final data = Map<String, dynamic>.from(ApiService.unwrapData(res) as Map);
    PortalCache.set('my_requests', data, ttl: const Duration(minutes: 1));
    return data;
  }

  static Future<Map<String, dynamic>> validateCoupon({
    required String code,
    String? packageId,
    num? orderAmount,
  }) async {
    final res = await ApiService.dio.post('/billing/coupons/validate', data: {
      'code': code.trim().toUpperCase(),
      if (packageId != null) 'packageId': packageId,
      if (orderAmount != null) 'orderAmount': orderAmount,
    });
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map);
  }

  static Future<Map<String, dynamic>> applyCoupon({
    required String code,
    String? packageId,
    num? orderAmount,
    String? note,
  }) async {
    final res = await ApiService.dio.post('/billing/coupons/apply', data: {
      'code': code.trim().toUpperCase(),
      if (packageId != null) 'packageId': packageId,
      if (orderAmount != null) 'orderAmount': orderAmount,
      if (note != null) 'note': note,
    });
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map);
  }

  static Future<List<dynamic>> invoices() async {
    final res = await ApiService.dio.get('/billing/invoices');
    final data = ApiService.unwrapData(res);
    return (data['invoices'] as List?) ?? [];
  }

  /// One-stop customer billing: summary + invoices with payment ledger.
  static Future<Map<String, dynamic>> billingAccount() async {
    final res = await ApiService.dio.get('/billing/account');
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map? ?? {});
  }

  static Future<Map<String, dynamic>> invoice(String id) async {
    final res = await ApiService.dio.get('/billing/invoices/$id');
    final data = ApiService.unwrapData(res);
    return Map<String, dynamic>.from(data['invoice'] as Map? ?? {});
  }

  /// Generate invoice PDF and return signed URL payload: { url, filename, title }.
  static Future<Map<String, dynamic>> receiptPdf(String id) async {
    final response = await ApiService.dio.get('/billing/receipts/$id/pdf');
    return Map<String, dynamic>.from(ApiService.unwrapData(response));
  }

  static Future<Map<String, dynamic>> invoicePdf(String id) async {
    final res = await ApiService.dio.get('/billing/invoices/$id/pdf');
    final data = ApiService.unwrapData(res);
    return Map<String, dynamic>.from(data as Map? ?? {});
  }

  /// Apply a studio coupon to a SENT invoice (no payments recorded yet).
  static Future<Map<String, dynamic>> applyInvoiceCoupon(String invoiceId, String code) async {
    final res = await ApiService.dio.post(
      '/billing/invoices/$invoiceId/apply-coupon',
      data: {'code': code.trim().toUpperCase()},
    );
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map? ?? {});
  }

  static Future<Map<String, dynamic>> myAgreements() async {
    final res = await ApiService.dio.get('/agreements/my');
    return Map<String, dynamic>.from(ApiService.unwrapData(res) as Map);
  }

  static Future<String> agreementPdfUrl(String id) async {
    final res = await ApiService.dio.get('/agreements/my/$id/pdf');
    final data = ApiService.unwrapData(res);
    return (data['url'] ?? '').toString();
  }
}
