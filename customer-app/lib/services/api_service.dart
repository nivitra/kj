import 'package:dio/dio.dart';
import '../models/models.dart';
import 'cognito_auth_service.dart';
import 'session_store.dart';

/// Backend base URL. Override at build:
///   flutter build apk --dart-define=API_URL=https://api.yourdomain.com/api
///   flutter build web --dart-define=API_URL=https://api.warmkelvin.com/api
const String kApiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://api.warmkelvin.com/api',
);

class ApiService {
  static final _store = SessionStore.instance;
  static Dio? _dio;

  static Dio get dio {
    _dio ??= Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 45),
      headers: {'Accept': 'application/json'},
    ))
      ..interceptors.add(InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Prefer Cognito access token; fall back to password-session token.
          String? token;
          try {
            token = await CognitoAuthService.instance.getAccessToken();
          } catch (_) {}
          token ??= await _store.readCustomerToken();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (err, handler) async {
          // Only wipe session on real auth failures — not on 500/BigInt bugs.
          if (err.response?.statusCode == 401) {
            try {
              await CognitoAuthService.instance.refreshTokens();
              final token = await CognitoAuthService.instance.getAccessToken();
              if (token != null && err.requestOptions.extra['retried'] != true) {
                final opts = err.requestOptions;
                opts.headers['Authorization'] = 'Bearer $token';
                opts.extra['retried'] = true;
                final client = _dio;
                if (client != null) {
                  final clone = await client.fetch(opts);
                  return handler.resolve(clone);
                }
              }
            } catch (_) {}
            // Do not auto-delete password token here — let AuthNotifier decide.
          }
          handler.next(err);
        },
      ));
    return _dio!;
  }

  static dynamic _data(Response res) {
    final body = res.data;
    if (body is Map && body.containsKey('data')) return body['data'];
    return body;
  }

  /// Public unwrap helper for portal modules.
  static dynamic unwrapData(Response res) => _data(res);

  static String? errorMessage(Object e) {
    if (e is DioException) {
      // Network / unreachable API — most common APK issue on local Wi‑Fi.
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.connectionError) {
        return 'Couldn’t connect. Check your internet and try again.';
      }
      final d = e.response?.data;
      if (d is Map) {
        if (d['error'] is Map) return d['error']['message']?.toString();
        if (d['error'] is String) return d['error'] as String;
        if (d['message'] != null) return d['message'].toString();
      }
      if (e.response?.statusCode == 401) {
        return 'Invalid login ID or password.';
      }
      return e.message;
    }
    return e.toString();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  static Future<void> _saveSessionToken(Map<String, dynamic> data) async {
    final token = data['token']?.toString();
    if (token != null && token.isNotEmpty) {
      await _store.writeCustomerToken(token);
    }
  }

  /// Sign in with phone number (or legacy loginId) + password.
  static Future<Map<String, dynamic>> login(String phoneOrLoginId, String password) async {
    final id = phoneOrLoginId.trim();
    final res = await dio.post('/auth/customer/login', data: {
      'phone': id,
      'loginId': id,
      'password': password,
    });
    final data = Map<String, dynamic>.from(_data(res) as Map);
    await _saveSessionToken(data);
    return data;
  }

  static Future<Map<String, dynamic>> register({
    required String name,
    required String phone,
    required String password,
  }) async {
    final res = await dio.post('/auth/customer/register', data: {
      'name': name.trim(),
      'phone': phone.trim(),
      'password': password,
    });
    final data = Map<String, dynamic>.from(_data(res) as Map);
    await _saveSessionToken(data);
    return data;
  }

  /// Request WhatsApp OTP to create a new account (name + phone).
  static Future<Map<String, dynamic>> requestSignupOtp({
    required String name,
    required String phone,
  }) async {
    final res = await dio.post('/auth/customer/signup-otp', data: {
      'name': name.trim(),
      'phone': phone.trim(),
    });
    final data = _data(res);
    if (data is Map) return Map<String, dynamic>.from(data);
    return {'message': 'We sent a 6-digit code to WhatsApp.'};
  }

  /// Verify WhatsApp signup code and start a session.
  static Future<Map<String, dynamic>> verifySignupOtp({
    required String phone,
    required String code,
    String? name,
  }) async {
    final res = await dio.post('/auth/customer/signup-otp-verify', data: {
      'phone': phone.trim(),
      'code': code.trim(),
      if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
    });
    final data = Map<String, dynamic>.from(_data(res) as Map);
    await _saveSessionToken(data);
    return data;
  }

  /// Request WhatsApp OTP for password reset.
  static Future<String> forgotPassword(String phone) async {
    final res = await dio.post('/auth/customer/forgot-password', data: {
      'phone': phone.trim(),
    });
    final data = _data(res);
    if (data is Map && data['message'] != null) return data['message'].toString();
    return 'If an account exists, a WhatsApp code was sent.';
  }

  /// Complete password reset with phone + WhatsApp OTP + new password.
  static Future<String> resetPassword({
    required String phone,
    required String code,
    required String password,
  }) async {
    final res = await dio.post('/auth/customer/reset-password', data: {
      'phone': phone.trim(),
      'code': code.trim(),
      'password': password,
    });
    final data = _data(res);
    if (data is Map && data['message'] != null) return data['message'].toString();
    return 'Password updated.';
  }

  /// Request passwordless login OTP via WhatsApp.
  static Future<Map<String, dynamic>> requestLoginOtp(String phone) async {
    final res = await dio.post('/auth/customer/otp-request', data: {
      'phone': phone.trim(),
    });
    final data = _data(res);
    if (data is Map) return Map<String, dynamic>.from(data);
    return {'message': 'If an account exists, a WhatsApp code was sent.'};
  }

  /// Complete passwordless login with phone + OTP.
  static Future<Map<String, dynamic>> loginWithOtp({
    required String phone,
    required String code,
  }) async {
    final res = await dio.post('/auth/customer/otp-login', data: {
      'phone': phone.trim(),
      'code': code.trim(),
    });
    final data = Map<String, dynamic>.from(_data(res) as Map);
    await _saveSessionToken(data);
    return data;
  }

  /// After Cognito PKCE, provision / sync local Customer with the access token.
  static Future<Customer> establishCognitoSession(String accessToken) async {
    final bare = Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 20),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $accessToken',
      },
    ));
    // Also POST session for explicit provision
    try {
      await bare.post('/auth/customer/session', data: {'accessToken': accessToken});
    } catch (_) {
      // GET /me below will still create-if-missing via middleware
    }
    final res = await bare.get('/customers/me');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    if (body is Map && body['customer'] is Map) {
      return Customer.fromJson(Map<String, dynamic>.from(body['customer'] as Map));
    }
    return Customer.fromJson(Map<String, dynamic>.from(body));
  }

  static Future<void> clearLocalSession() async {
    await _store.clearCustomerToken();
    await _store.delete('customer_id');
    _dio = null;
  }

  static Future<Customer> getMe() async {
    // Prefer /customers/me (full wedding + package profile). Fall back to auth/me.
    try {
      final res = await dio.get('/customers/me');
      final body = _data(res);
      if (body is Map && body['customer'] is Map) {
        return Customer.fromJson(Map<String, dynamic>.from(body['customer'] as Map));
      }
      return Customer.fromJson(Map<String, dynamic>.from(body));
    } catch (_) {
      final res = await dio.get('/auth/customer/me');
      final body = _data(res);
      if (body is Map && body['customer'] is Map) {
        return Customer.fromJson(Map<String, dynamic>.from(body['customer'] as Map));
      }
      return Customer.fromJson(Map<String, dynamic>.from(body));
    }
  }

  /// Active studio packages the client can browse / select.
  static Future<Map<String, dynamic>> getPackages() async {
    final res = await dio.get('/customers/packages');
    final data = Map<String, dynamic>.from(_data(res) as Map);
    final list = (data['packages'] as List? ?? [])
        .map((j) => StudioPackage.fromJson(Map<String, dynamic>.from(j as Map)))
        .toList();
    return {
      'packages': list,
      'currentPackageId': data['currentPackageId'] as String?,
      'requestedPackageId': data['requestedPackageId'] as String?,
    };
  }

  /// Customer selects / requests a package.
  static Future<Customer> requestPackage(String packageId) async {
    final res = await dio.post('/customers/me/package-request', data: {
      'packageId': packageId,
    });
    final body = _data(res);
    if (body is Map && body['customer'] is Map) {
      return Customer.fromJson(Map<String, dynamic>.from(body['customer'] as Map));
    }
    return Customer.fromJson(Map<String, dynamic>.from(body));
  }

  /// Request edit / reschedule of shoot timeslot
  static Future<Map<String, dynamic>> requestReschedule({
    String? jobId,
    required String requestedDate,
    required String requestedTime,
    String? note,
  }) async {
    final res = await dio.post('/portal/reschedule', data: {
      if (jobId != null) 'jobId': jobId,
      'requestedDate': requestedDate,
      'requestedTime': requestedTime,
      'note': note,
    });
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<void> logout() async {
    try {
      await CognitoAuthService.instance.logout(localOnly: true);
    } catch (_) {}
    await clearLocalSession();
  }

  // ── Galleries ─────────────────────────────────────────────────────────────

  static Future<List<Gallery>> getMyGalleries() async {
    final res = await dio.get('/galleries/my/galleries');
    final body = _data(res);
    final list = body is Map ? body['galleries'] : (res.data is Map ? res.data['galleries'] : null);
    return (list as List? ?? [])
        .map((j) => Gallery.fromJson(Map<String, dynamic>.from(j as Map)))
        .toList();
  }

  static Future<Map<String, dynamic>> getGalleryPhotos(
    String galleryId, {
    int page = 1,
    int limit = 60,
    String? photoId,
  }) async {
    final res = await dio.get(
      '/galleries/my/$galleryId/photos',
      queryParameters: {'page': page, 'limit': limit, if (photoId != null) 'photoId': photoId},
    );
    // This route returns raw JSON (not always envelope).
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    final map = Map<String, dynamic>.from(body);
    final galMap = Map<String, dynamic>.from(map['gallery'] as Map);
    if (map['bulkRawOffer'] != null) galMap['bulkRawOffer'] = map['bulkRawOffer'];
    if (map['rawAccess'] == true) galMap['rawAccess'] = true;
    if (map['accessMode'] != null) galMap['accessMode'] = map['accessMode'];
    if (map['selectionEnabled'] != null) galMap['selectionEnabled'] = map['selectionEnabled'];
    if (map['downloadsAllowed'] != null) galMap['downloadsAllowed'] = map['downloadsAllowed'];
    if (map['faceSearchEnabled'] != null) galMap['faceSearchEnabled'] = map['faceSearchEnabled'];
    if (map['extraRate'] != null) galMap['extraRate'] = map['extraRate'];
    if (map['includedLimit'] != null) galMap['includedLimit'] = map['includedLimit'];
    if (map['extrasBillable'] != null) galMap['extrasBillable'] = map['extrasBillable'];
    if (map['accessLabel'] != null) galMap['accessLabel'] = map['accessLabel'];
    return {
      'photos': (map['photos'] as List? ?? [])
          .map((j) {
            final m = Map<String, dynamic>.from(j as Map);
            m['galleryId'] = galleryId;
            return Photo.fromJson(m);
          })
          .toList(),
      'total': map['total'] ?? 0,
      'pages': map['pages'] ?? 1,
      'gallery': Gallery.fromJson(galMap),
      'workflowMode': map['workflowMode'] ?? 'SELECT_ONLY',
      'purpose': map['purpose'] ?? 'GENERAL',
      'downloadsAllowed': map['downloadsAllowed'] == true,
      'rawAccess': map['rawAccess'] == true,
      'selectionEnabled': map['selectionEnabled'] != false,
      'bulkRawOffer': map['bulkRawOffer'],
    };
  }

  static Future<Map<String, dynamic>> requestRawDump(String galleryId) async {
    final res = await dio.post('/galleries/my/$galleryId/raw-dump');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    return Map<String, dynamic>.from(body);
  }

  /// On-demand original download URL (list responses no longer bulk-presign originals).
  static Future<String> getPhotoDownloadUrl(String galleryId, String photoId) async {
    final res = await dio.get('/galleries/my/$galleryId/photos/$photoId/download-url');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    final map = Map<String, dynamic>.from(body);
    final url = map['downloadUrl'] as String?;
    if (url == null || url.isEmpty) {
      throw StateError('Download is not available for this file yet.');
    }
    return url;
  }

  static Future<String> getGuestPhotoDownloadUrl({
    required String guestAccessToken,
    required String photoId,
  }) async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      headers: {'Authorization': 'Bearer $guestAccessToken'},
      connectTimeout: const Duration(seconds: 20),
    )).get('/share/guest/photos/$photoId/download-url');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    final map = Map<String, dynamic>.from(body);
    final url = map['downloadUrl'] as String?;
    if (url == null || url.isEmpty) {
      throw StateError('Download is not available for this file yet.');
    }
    return url;
  }

  // ── Gallery share (QR / relatives) ────────────────────────────────────────

  static Future<Map<String, dynamic>> createShareLink(
    String galleryId, {
    String? label,
  }) async {
    final res = await dio.post('/share/my/$galleryId/share-links', data: {
      if (label != null && label.isNotEmpty) 'label': label,
    });
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<List<Map<String, dynamic>>> listShareLinks(String galleryId) async {
    final res = await dio.get('/share/my/$galleryId/share-links');
    final data = Map<String, dynamic>.from(_data(res) as Map);
    return (data['links'] as List? ?? [])
        .map((j) => Map<String, dynamic>.from(j as Map))
        .toList();
  }

  static Future<void> revokeShareLink(String linkId) async {
    await dio.delete('/share/my/share-links/$linkId');
  }

  static Future<Map<String, dynamic>> publicSharePreview(String token) async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 20),
    )).get('/share/public/$token');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    return Map<String, dynamic>.from(body);
  }

  static Future<Map<String, dynamic>> publicShareRegister({
    required String token,
    required String name,
    required String phone,
  }) async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 20),
    )).post('/share/public/$token/register', data: {
      'name': name.trim(),
      'phone': phone.trim(),
    });
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    return Map<String, dynamic>.from(body);
  }

  static Future<void> bindGuestFaceSession({
    required String guestAccessToken,
    required String sessionId,
  }) async {
    await Dio(BaseOptions(
      baseUrl: kApiUrl,
      headers: {'Authorization': 'Bearer $guestAccessToken'},
    )).post('/share/guest/face-session', data: {'sessionId': sessionId});
  }

  static Future<Map<String, dynamic>> guestPhotos(String guestAccessToken) async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      headers: {'Authorization': 'Bearer $guestAccessToken'},
    )).get('/share/guest/photos');
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    return Map<String, dynamic>.from(body);
  }

  /// Unlock full gallery for a guest share session with the studio-configured code.
  static Future<Map<String, dynamic>> guestFullAccess({
    required String guestAccessToken,
    required String code,
  }) async {
    final res = await Dio(BaseOptions(
      baseUrl: kApiUrl,
      headers: {'Authorization': 'Bearer $guestAccessToken'},
      connectTimeout: const Duration(seconds: 20),
    )).post('/share/guest/full-access', data: {'code': code.trim()});
    final body = res.data is Map && res.data['data'] != null ? res.data['data'] : res.data;
    return Map<String, dynamic>.from(body as Map? ?? {});
  }

  // ── Favorites ─────────────────────────────────────────────────────────────

  /// Returns favorited + live selection estimate (soft limit / overage).
  static Future<Map<String, dynamic>> toggleFavorite(String photoId, {bool? selected}) async {
    final res = await dio.post('/photos/$photoId/favorite', data: {if (selected != null) 'selected': selected});
    final body = _data(res);
    if (body is Map) return Map<String, dynamic>.from(body);
    if (res.data is Map) return Map<String, dynamic>.from(res.data as Map);
    return {'favorited': false};
  }

  static Future<List<Photo>> getFavorites({String? galleryId}) async {
    final res = await dio.get(
      '/photos/my/favorites',
      queryParameters: galleryId != null ? {'galleryId': galleryId} : null,
    );
    final body = _data(res);
    final list = body is Map
        ? body['favorites']
        : (res.data is Map ? res.data['favorites'] : null);
    return (list as List? ?? []).map((j) {
      final m = Map<String, dynamic>.from(j as Map);
      // favorites may nest photo
      if (m['thumbnailUrl'] == null && m['photo'] is Map) {
        return Photo.fromJson(Map<String, dynamic>.from(m['photo'] as Map))
            .copyWith(isFavorite: true);
      }
      return Photo.fromJson(m).copyWith(isFavorite: true);
    }).toList();
  }

  // ── Selection (finalize hearted photos) ───────────────────────────────────

  static Future<SelectionState> getSelection(String galleryId) async {
    final res = await dio.get('/selections/my/$galleryId');
    return SelectionState.fromJson(Map<String, dynamic>.from(_data(res) as Map));
  }

  static Future<SelectionState> submitSelection(
    String galleryId, {
    String? note,
    List<Map<String, String>>? classifications,
    int? revision,
  }) async {
    final res = await dio.post('/selections/my/$galleryId/submit', data: {
      if (revision != null) 'revision': revision,
      if (note != null && note.isNotEmpty) 'note': note,
      if (classifications != null && classifications.isNotEmpty)
        'classifications': classifications,
    });
    return SelectionState.fromJson(Map<String, dynamic>.from(_data(res) as Map));
  }

  static Future<List<Photo>> getSelectionItems(String galleryId) async {
    final pack = await getSelectionItemsDetailed(galleryId);
    return (pack['items'] as List? ?? [])
        .map((j) => Photo.fromJson({
              ...Map<String, dynamic>.from(j as Map),
              'filename': j['filename'] ?? '',
              'isFavorite': true,
            }))
        .toList();
  }

  /// Full selection items payload: deliveryType, FREE/EXTRA badge, estimate, rates.
  static Future<Map<String, dynamic>> getSelectionItemsDetailed(String galleryId) async {
    final res = await dio.get('/selections/my/$galleryId/items');
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  /// Live dual-rate bill preview while assigning Raw/Edited.
  static Future<Map<String, dynamic>> previewSelection(
    String galleryId, {
    required List<Map<String, String>> classifications,
  }) async {
    final res = await dio.post('/selections/my/$galleryId/preview', data: {
      'classifications': classifications,
    });
    final body = Map<String, dynamic>.from(_data(res) as Map);
    if (body['estimate'] is Map) {
      return Map<String, dynamic>.from(body['estimate'] as Map);
    }
    return body;
  }

  // ── Contracts ─────────────────────────────────────────────────────────────

  static Future<List<ContractItem>> getContracts() async {
    final res = await dio.get('/contracts/my');
    final data = Map<String, dynamic>.from(_data(res) as Map);
    return (data['contracts'] as List? ?? [])
        .map((j) => ContractItem.fromJson(Map<String, dynamic>.from(j as Map)))
        .toList();
  }

  static Future<String> viewContract(String id) async {
    final res = await dio.get('/contracts/my/$id/view');
    final data = Map<String, dynamic>.from(_data(res) as Map);
    return data['url'] as String;
  }

  static Future<void> acceptContract(String id) async {
    await dio.post('/contracts/my/$id/accept');
  }

  // ── Face search ───────────────────────────────────────────────────────────

  /// Dio that can carry an explicit Bearer (guest shadow customer) without
  /// touching the primary client's SessionStore token.
  static Dio _authDio([String? bearer]) {
    if (bearer == null || bearer.isEmpty) return dio;
    return Dio(BaseOptions(
      baseUrl: kApiUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 45),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $bearer',
      },
    ));
  }

  static Future<Map<String, dynamic>> faceConsent({String? bearerToken}) async {
    final res = await _authDio(bearerToken).post('/face/consent');
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<Map<String, dynamic>> faceUploadUrl({
    required String consentId,
    required String contentType,
    String? galleryId,
    String? bearerToken,
  }) async {
    final res = await _authDio(bearerToken).post('/face/search/upload-url', data: {
      'consentId': consentId,
      'contentType': contentType,
      if (galleryId != null) 'galleryId': galleryId,
    });
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  /// Direct-to-S3 PUT against a backend-presigned URL.
  ///
  /// Signature contract (backend `getSignedUploadUrl`):
  ///   - Only Content-Type is signed — send that, and nothing else that
  ///     would need signing (especially never x-amz-server-side-encryption).
  ///   - SSE is applied by the bucket default encryption rule.
  static Future<void> putSelfie(String uploadUrl, List<int> bytes, String contentType) async {
    final client = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 60),
      // Do not inherit default Accept / Content-Type that could diverge
      // from the signed ContentType on the presigned URL.
      headers: const {},
    ));
    final res = await client.put(
      uploadUrl,
      data: Stream.fromIterable([bytes]),
      options: Options(
        headers: {
          'Content-Type': contentType,
          'Content-Length': bytes.length,
        },
        contentType: contentType,
        // Prevent Dio from rewriting Content-Type (e.g. charset=utf-8).
        responseType: ResponseType.plain,
        validateStatus: (s) => s != null && s < 500,
      ),
    );
    if (res.statusCode == null || res.statusCode! >= 300) {
      final body = res.data?.toString() ?? '';
      throw DioException(
        requestOptions: res.requestOptions,
        response: res,
        message: 'Selfie upload failed (${res.statusCode})'
            '${body.isNotEmpty ? ': ${body.length > 200 ? body.substring(0, 200) : body}' : ''}',
      );
    }
  }

  static Future<Map<String, dynamic>> faceSubmit(String sessionId, {String? bearerToken}) async {
    final res = await _authDio(bearerToken).post('/face/search/submit', data: {'sessionId': sessionId});
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<Map<String, dynamic>> faceStatus(String sessionId, {String? bearerToken}) async {
    final res = await _authDio(bearerToken).get('/face/search/$sessionId');
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<Map<String, dynamic>> faceResults(String sessionId, {int page = 1, String? bearerToken}) async {
    final res = await _authDio(bearerToken).get(
      '/face/search/$sessionId/results',
      queryParameters: {'page': page, 'limit': 60},
    );
    final data = Map<String, dynamic>.from(_data(res) as Map);
    final list = (data['results'] as List? ?? [])
        .map((j) => Photo.fromJson({
              ...Map<String, dynamic>.from(j as Map),
              'filename': j['filename'] ?? '',
            }))
        .toList();
    return {
      'status': data['status'],
      'total': data['total'] ?? list.length,
      'disclaimer': data['disclaimer'],
      'results': list,
    };
  }

  static Future<Map<String, dynamic>> faceBroader(String sessionId, {String? bearerToken}) async {
    final res = await _authDio(bearerToken).post('/face/search/$sessionId/broader', data: {'confirm': true});
    return Map<String, dynamic>.from(_data(res) as Map);
  }

  static Future<void> faceDataDelete() async {
    await dio.post('/face/data/delete');
  }
}
