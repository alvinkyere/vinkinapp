'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe "has this hydrated on the client yet" flag — gates client-only reads
 * (localStorage) without a hydration mismatch. See apps/guest-web/lib/use-has-mounted.ts
 * for why this is a plain mount-effect rather than the `useSyncExternalStore` pattern React
 * docs suggest: that version's post-hydration re-check never fired in this Next 16 /
 * React 19 / Turbopack-dev combination, verified directly in PV10.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see module doc above
    setMounted(true);
  }, []);
  return mounted;
}
