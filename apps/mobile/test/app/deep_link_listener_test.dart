import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vinkin_mobile/app/deep_link_listener.dart';

GoRouter _testRouter() => GoRouter(
  initialLocation: '/home',
  routes: [
    GoRoute(
      path: '/home',
      builder: (context, state) => const Text('Home screen'),
    ),
    GoRoute(
      path: '/vinks/:vinkId',
      builder: (context, state) =>
          Text('Lobby for ${state.pathParameters['vinkId']}'),
    ),
  ],
);

void main() {
  testWidgets(
    'ENG3 Slice 4: a live vinkin://vinks/:vinkId link navigates the real router',
    (tester) async {
      final router = _testRouter();
      final controller = StreamController<Uri>();
      final listener = DeepLinkListener(
        router,
        getInitialLink: () async => null,
        uriLinkStream: () => controller.stream,
      );
      addTearDown(listener.dispose);
      addTearDown(controller.close);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      expect(find.text('Home screen'), findsOneWidget);

      controller.add(Uri.parse('vinkin://vinks/abc-123'));
      await tester.pumpAndSettle();

      expect(find.text('Lobby for abc-123'), findsOneWidget);
    },
  );

  testWidgets(
    'ENG3 Slice 4: a cold-start link (getInitialLink) navigates on startup',
    (tester) async {
      final router = _testRouter();
      final listener = DeepLinkListener(
        router,
        getInitialLink: () async => Uri.parse('vinkin://vinks/cold-start-id'),
        uriLinkStream: () => const Stream<Uri>.empty(),
      );
      addTearDown(listener.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      expect(find.text('Lobby for cold-start-id'), findsOneWidget);
    },
  );

  testWidgets(
    'ENG3 Slice 4: an unrecognized link is ignored — no navigation, no crash',
    (tester) async {
      final router = _testRouter();
      final controller = StreamController<Uri>();
      final listener = DeepLinkListener(
        router,
        getInitialLink: () async => null,
        uriLinkStream: () => controller.stream,
      );
      addTearDown(listener.dispose);
      addTearDown(controller.close);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      expect(find.text('Home screen'), findsOneWidget);

      controller.add(Uri.parse('vinkin://g/some-guest-token'));
      await tester.pumpAndSettle();

      expect(find.text('Home screen'), findsOneWidget);
    },
  );
}
