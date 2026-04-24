import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(duration);
dayjs.extend(customParseFormat);

export function formatClock(d: Date = new Date()): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function formatClockMs(d: Date = new Date()): string {
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${formatClock(d)}.${ms}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hs = Math.floor((ms % 1000) / 10);
  const hh = h > 0 ? `${h}:` : '';
  return `${hh}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(hs).padStart(2, '0')}`;
}

// Krátký formát bez setin (pro odpočty a jiné zobrazení, kde setiny jen ruší).
export function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = h > 0 ? `${h}:` : '';
  return `${hh}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function diffMs(startIso: string, endIso: string): number {
  return new Date(endIso).getTime() - new Date(startIso).getTime();
}

// Parse manual time entry. Supports:
//   Absolutní: "HH:MM:SS", "HH:MM:SS.ms", "MM:SS", "MM:SS.ms" → daná hodina na datumu `base`.
//   Relativní od `base`: "-10" (10 s zpět), "-1:30" (90 s zpět), "+5.5", "-0:01:00".
export function parseManualTimeToIso(input: string, base: Date = new Date()): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Relativní offset od base (+/- prefix).
  if (trimmed[0] === '+' || trimmed[0] === '-') {
    const sign = trimmed[0] === '-' ? -1 : 1;
    const rest = trimmed.slice(1);
    if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(rest)) return null;
    const parts = rest.split(':');
    let seconds: number;
    if (parts.length === 1) {
      seconds = parseFloat(parts[0]);
    } else if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseFloat(parts[1]);
      seconds = m * 60 + s;
    } else {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const s = parseFloat(parts[2]);
      seconds = h * 3600 + m * 60 + s;
    }
    if (!Number.isFinite(seconds)) return null;
    return new Date(base.getTime() + sign * Math.round(seconds * 1000)).toISOString();
  }

  // Absolutní wall-clock čas.
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : base.getHours();
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const msStr = m[4] ?? '0';
  const milliseconds = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const d = new Date(base);
  d.setHours(hours, minutes, seconds, milliseconds);
  return d.toISOString();
}
