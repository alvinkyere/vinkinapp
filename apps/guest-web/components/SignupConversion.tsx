/**
 * PV10 deliverable "optional signup conversion" (master plan). No web registration flow
 * exists anywhere in the product yet — account creation is the organizer Flutter app's
 * (PV9) — so this is an honest, non-blocking informational prompt, not a fake web signup
 * form. Guests can dismiss it and keep using the link with no account, exactly as the
 * exit gate requires ("no account creation").
 */
export function SignupConversion() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Liked splitting the bill this way?</p>
      <p className="mt-1">
        You don&apos;t need an account to use VinkIn as a guest — but organizers create their own
        Vinks from the VinkIn mobile app.
      </p>
    </div>
  );
}
