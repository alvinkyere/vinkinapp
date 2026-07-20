// Matches apps/mobile/lib/design_system/components/vink_simulation_notice.dart's copy and
// neutral (non-alarming) styling exactly — "never visually misrepresent mock financial
// functionality as a live issued card" applies identically on both surfaces.
export function SimulationBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-xl bg-ink/5 px-4 py-3 text-sm text-smoke font-sans"
    >
      <span aria-hidden="true">ⓘ</span>
      <span>Pilot simulation — no real card has been issued, no real money moves.</span>
    </div>
  );
}
