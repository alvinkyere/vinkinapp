export function SimulationBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800"
    >
      <span aria-hidden="true">&#9888;&#65039;</span>
      <span>This is a simulation — no real money moves in this build.</span>
    </div>
  );
}
