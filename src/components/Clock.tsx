import { useClock } from '@/hooks/useClock';
import { formatClock } from '@/utils/time';

interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Clock({ size = 'lg' }: Props) {
  const now = useClock(250);
  const cls =
    size === 'xl' ? 'text-7xl md:text-9xl' :
    size === 'lg' ? 'text-5xl md:text-7xl' :
    size === 'md' ? 'text-3xl md:text-4xl' :
    'text-xl';
  return (
    <div className={`tabular font-bold ${cls}`}>{formatClock(now)}</div>
  );
}
