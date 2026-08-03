import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/app/deep_links.dart';

void main() {
  group('ENG3 Slice 4: deepLinkRouteFor', () {
    test(
      'vinkin://vinks/:vinkId routes to the existing /vinks/:vinkId route',
      () {
        expect(
          deepLinkRouteFor(Uri.parse('vinkin://vinks/abc-123')),
          '/vinks/abc-123',
        );
      },
    );

    test('a real-shaped UUID vinkId round-trips exactly', () {
      const vinkId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      expect(
        deepLinkRouteFor(Uri.parse('vinkin://vinks/$vinkId')),
        '/vinks/$vinkId',
      );
    });

    test('the hosted Universal Link routes to the same Vink', () {
      expect(
        deepLinkRouteFor(
          Uri.parse('https://join.vinkin.org/app/vinks/abc-123'),
        ),
        '/vinks/abc-123',
      );
    });

    test('an HTTPS link on another host is ignored', () {
      expect(
        deepLinkRouteFor(Uri.parse('https://example.com/app/vinks/abc-123')),
        isNull,
      );
    });

    test('an unrelated path on join.vinkin.org is ignored', () {
      expect(
        deepLinkRouteFor(Uri.parse('https://join.vinkin.org/g/guest-token')),
        isNull,
      );
    });

    test(
      'a host other than "vinks" is ignored — e.g. a guest token link (apps/guest-web '
      "own route, never this app's)",
      () {
        expect(
          deepLinkRouteFor(Uri.parse('vinkin://g/some-guest-token')),
          isNull,
        );
      },
    );

    test('no vinkId segment at all is ignored', () {
      expect(deepLinkRouteFor(Uri.parse('vinkin://vinks/')), isNull);
      expect(deepLinkRouteFor(Uri.parse('vinkin://vinks')), isNull);
      expect(
        deepLinkRouteFor(Uri.parse('https://join.vinkin.org/app/vinks/')),
        isNull,
      );
    });

    test(
      'an extra path segment is ignored — never guesses which one is the real id',
      () {
        expect(
          deepLinkRouteFor(Uri.parse('vinkin://vinks/abc-123/extra')),
          isNull,
        );
      },
    );

    test(
      'a completely unrelated URL never crashes and always returns null',
      () {
        expect(deepLinkRouteFor(Uri.parse('https://vinkin.org/')), isNull);
        expect(
          deepLinkRouteFor(Uri.parse('mailto:someone@example.com')),
          isNull,
        );
      },
    );
  });
}
