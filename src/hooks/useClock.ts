import { useEffect, useState } from 'react';

export function useClock(intervalMs = 250): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(h);
  }, [intervalMs]);
  return now;
}
