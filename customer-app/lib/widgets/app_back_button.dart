import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Deep-linked pages have no navigation stack. Embedded tabs open the app menu.
class AppBackButton extends StatelessWidget {
  final String fallback;
  const AppBackButton({super.key, this.fallback = '/app'});
  @override
  Widget build(BuildContext context) {
    final embedded = GoRouterState.of(context).uri.path == '/app';
    return IconButton(
      tooltip: embedded ? 'Open menu' : context.canPop() ? 'Back' : 'Back to home',
      icon: Icon(embedded ? Icons.menu_rounded : Icons.arrow_back_rounded),
      onPressed: () {
        if (embedded) {
          context.visitAncestorElements((element) {
            if (element is StatefulElement && element.state is ScaffoldState) {
              final scaffold = element.state as ScaffoldState;
              if (scaffold.widget.drawer != null) { scaffold.openDrawer(); return false; }
            }
            return true;
          });
        }
        else if (context.canPop()) { context.pop(); }
        else { context.go(fallback); }
      },
    );
  }
}
