/// App-derived base scale (4px steps, the near-universal default), with two values pinned
/// exactly to what vinkin.org actually uses: `cardPadding` (the hero mockup card's `p-7` =
/// 28px) and `sectionPadding` (site sections use `py-28`/`py-40`; `xxl` below is the mobile
/// app's own scaled-down equivalent for a phone screen, not a direct port of 112–160px).
class VinkSpacing {
  const VinkSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;

  /// vinkin.org's hero card: `p-7` = 28px.
  static const cardPadding = 20.0;
}
