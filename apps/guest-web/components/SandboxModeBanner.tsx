// RM4C-G — distinct from SimulationBanner (which covers the mock-money card/merchant
// simulation): this specifically discloses that a REAL Stripe sandbox card flow is in use —
// genuinely processed by Stripe, but in test mode, so no real money moves. Shown only in
// stripe_sandbox mode, never in production (there is no production mode this milestone
// permits — D46's unconditional live-key rejection stays the actual guarantee).
export function SandboxModeBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-xl bg-blue/5 px-4 py-3 text-sm text-blue-deep font-sans"
    >
      <span>Test mode — no real money will be charged.</span>
    </div>
  );
}
