/// Short-lived in-memory cache for portal CMS payloads (home / packages / portfolio).
/// Avoids re-hitting the API on every tab switch.
class PortalCache {
  PortalCache._();
  static final Map<String, _Entry> _map = {};

  static const Duration defaultTtl = Duration(minutes: 3);

  static T? get<T>(String key) {
    final e = _map[key];
    if (e == null) return null;
    if (DateTime.now().isAfter(e.expires)) {
      _map.remove(key);
      return null;
    }
    return e.value as T?;
  }

  static void set(String key, Object? value, {Duration ttl = defaultTtl}) {
    if (value == null) return;
    _map[key] = _Entry(value, DateTime.now().add(ttl));
  }

  static void invalidate([String? prefix]) {
    if (prefix == null) {
      _map.clear();
      return;
    }
    _map.removeWhere((k, _) => k.startsWith(prefix));
  }
}

class _Entry {
  final Object value;
  final DateTime expires;
  _Entry(this.value, this.expires);
}
