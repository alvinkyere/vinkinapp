'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe "has this hydrated on the client yet" flag — gates client-only reads
 * (localStorage) without a hydration mismatch. A `useSyncExternalStore`-based version was
 * tried first (the pattern React's own docs suggest to dodge the `set-state-in-effect` lint
 * rule) but its post-hydration re-check never fired in this Next 16 / React 19 combination
 * (verified live in a real browser: `hasMounted` stayed `false` indefinitely) — this plain
 * mount-effect is the classic, verified-working alternative.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see module doc above
    setMounted(true);
  }, []);
  return mounted;
}
