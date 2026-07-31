'use client';

import { useEffect, useState } from 'react';

/**
 * RM4B (D47): a genuinely live "now," not a render-time-only snapshot. RM4A shortened the
 * default Vink submission window from 24h to 7 minutes, so `countdownLabel(deadline)` computed
 * once at initial render (the pre-RM4B behavior) could sit frozen or stale for the entire time
 * a page is open — invisible at 24h granularity, a real, visible problem at minutes-scale.
 * `countdownLabel`'s own copy (Phase 6 §13) is untouched by this hook — only how often it's
 * recomputed changes.
 */
export function useNow(intervalMs = 1_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
