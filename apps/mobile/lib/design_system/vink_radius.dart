/// vinkin.org's actual radius scale (docs/design/vinkin-design-system.md), including the
/// arbitrary `rounded-[2rem]` (32px) used specifically on the hero's Vink-card mockup —
/// the direct reference for this app's own Vink cards.
class VinkRadius {
  const VinkRadius._();

  static const lg = 8.0;
  static const xl = 12.0;
  static const xxl = 16.0;
  static const xxxl = 24.0;

  /// The site's Vink-card mockup radius (`rounded-[2rem]`) — used for `VinkSurfaceCard`.
  static const card = 20.0;

  /// Every button on the site is a pill.
  static const pill = 9999.0;
}
