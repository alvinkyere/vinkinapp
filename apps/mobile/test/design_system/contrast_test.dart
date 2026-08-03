import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/design_system/vink_colors.dart';

/// Tool-based WCAG 2.1 contrast verification (docs/spec/decision-log.md D36 — hand
/// calculations are risk-flags, never certification; this file is the reproducible tool
/// that actually certifies a pairing, computed from the real hex values in
/// [VinkColors], not asserted by inspection). Implements the standard relative-luminance
/// and contrast-ratio formulas directly (https://www.w3.org/TR/WCAG21/#contrast-minimum) —
/// deliberately dependency-free so this test is itself auditable.
///
/// Thresholds: 4.5:1 for normal text, 3.0:1 for large text (>=24px any weight, or
/// >=18.66px/14pt AND bold — font weight alone never lowers the threshold, D36's own
/// correction) and for non-text UI boundaries (borders, focus rings, icon accents).

double _channelLuminance(int c) {
  final cPrime = c / 255;
  return cPrime <= 0.03928
      ? cPrime / 12.92
      : math.pow((cPrime + 0.055) / 1.055, 2.4).toDouble();
}

double _relativeLuminance(Color color) {
  // Color's r/g/b accessors are floating-point 0.0–1.0 (Flutter's wide-gamut Color API,
  // matching this codebase's own VinkColors.withValues(alpha:) usage) — convert to the
  // standard 0–255 8-bit channel value the WCAG formula is defined over.
  return 0.2126 * _channelLuminance((color.r * 255).round()) +
      0.7152 * _channelLuminance((color.g * 255).round()) +
      0.0722 * _channelLuminance((color.b * 255).round());
}

double _contrastRatio(Color a, Color b) {
  final la = _relativeLuminance(a);
  final lb = _relativeLuminance(b);
  final lighter = math.max(la, lb);
  final darker = math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/// Composites [fg] over [bg] at [alpha] (0..1) — used to compute the *effective* color of
/// a tinted background (e.g. `danger` at 12% opacity over `paper`) before measuring text
/// contrast against it, exactly what actually renders on screen.
Color _alphaBlend(Color fg, Color bg, double alpha) {
  return Color.fromARGB(
    255,
    (fg.r * 255 * alpha + bg.r * 255 * (1 - alpha)).round(),
    (fg.g * 255 * alpha + bg.g * 255 * (1 - alpha)).round(),
    (fg.b * 255 * alpha + bg.b * 255 * (1 - alpha)).round(),
  );
}

const double _aaNormalText = 4.5;
const double _aaNonText = 3.0;

void main() {
  group('WCAG AA — normal-text pairings (>=4.5:1 required)', () {
    test('ink on paper (primary text)', () {
      expect(
        _contrastRatio(VinkColors.ink, VinkColors.paper),
        greaterThanOrEqualTo(_aaNormalText),
      );
    });

    test(
      'ink on white (destructive button text, error text, error fields)',
      () {
        expect(
          _contrastRatio(VinkColors.ink, VinkColors.white),
          greaterThanOrEqualTo(_aaNormalText),
        );
      },
    );

    test('white on blue (primary button text)', () {
      expect(
        _contrastRatio(VinkColors.white, VinkColors.blue),
        greaterThanOrEqualTo(_aaNormalText),
      );
    });

    test(
      'smoke on paper (secondary text) — narrow pass, flagged for ongoing verification',
      () {
        final ratio = _contrastRatio(VinkColors.smoke, VinkColors.paper);
        expect(ratio, greaterThanOrEqualTo(_aaNormalText));
      },
    );

    test(
      'ink on the attention badge background (danger at 12% over paper) — the D36 fix for '
      'RESTRICTED/RECOVERY_REQUIRED badge text',
      () {
        final effectiveBg = _alphaBlend(
          VinkColors.danger,
          VinkColors.paper,
          0.12,
        );
        expect(
          _contrastRatio(VinkColors.ink, effectiveBg),
          greaterThanOrEqualTo(_aaNormalText),
        );
      },
    );

    test(
      'ink on the inline-error background (danger at 8% over white) — the D36 fix for '
      'VinkInlineError/VinkAmountSummary explanatory copy',
      () {
        final effectiveBg = _alphaBlend(
          VinkColors.danger,
          VinkColors.white,
          0.08,
        );
        expect(
          _contrastRatio(VinkColors.ink, effectiveBg),
          greaterThanOrEqualTo(_aaNormalText),
        );
      },
    );

    test(
      'REGRESSION GUARD: danger text on paper/white fails at normal-text size — must never '
      'be reintroduced without a verified darker dangerText token (D36)',
      () {
        expect(
          _contrastRatio(VinkColors.danger, VinkColors.paper),
          lessThan(_aaNormalText),
        );
        expect(
          _contrastRatio(VinkColors.danger, VinkColors.white),
          lessThan(_aaNormalText),
        );
      },
    );
  });

  group('WCAG AA — non-text pairings (>=3.0:1 required)', () {
    test(
      'danger border/accent on paper (destructive button border, error field border)',
      () {
        expect(
          _contrastRatio(VinkColors.danger, VinkColors.paper),
          greaterThanOrEqualTo(_aaNonText),
        );
      },
    );

    test('danger border/accent on white', () {
      expect(
        _contrastRatio(VinkColors.danger, VinkColors.white),
        greaterThanOrEqualTo(_aaNonText),
      );
    });

    test('blue focus indicator on paper', () {
      expect(
        _contrastRatio(VinkColors.blue, VinkColors.paper),
        greaterThanOrEqualTo(_aaNonText),
      );
    });
  });
}
