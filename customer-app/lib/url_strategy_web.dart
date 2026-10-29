import 'package:flutter_web_plugins/flutter_web_plugins.dart';

/// Use path-based URLs: https://app…/share/TOKEN
/// (not https://app…/#/share/TOKEN)
void configureUrlStrategy() {
  setUrlStrategy(PathUrlStrategy());
}
