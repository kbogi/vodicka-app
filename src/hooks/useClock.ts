import { useEffect, useState } from 'react';

// Tiky jsou zarovnané na násobky intervalMs ve skutečném čase (epoch),
// ne na okamžik mountu — všechny hodiny/odpočty v UI tak přeskakují
// ve stejný moment, přesně na hranici sekundy.
export function useClock(intervalMs = 250): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let h: number;
    const arm = () => {
      h = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 1);
    };
    const tick = () => {
      setNow(new Date());
      arm();
    };
    arm();
    return () => window.clearTimeout(h);
  }, [intervalMs]);
  return now;
}
