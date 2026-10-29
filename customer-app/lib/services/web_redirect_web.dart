import 'package:web/web.dart' as web;

class WebRedirect {
  static void go(String url) {
    web.window.location.assign(url);
  }
}
