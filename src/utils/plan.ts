import type { Stage } from '@/db/models';

// Spočítá plánovaný start dle pozice v startovce:
// scheduled = stage.first_start_at + order_index * interval
export function computeScheduledStart(stage: Stage, orderIndex: number): string | null {
  if (!stage.first_start_at) return null;
  const base = new Date(stage.first_start_at).getTime();
  const ms = base + orderIndex * stage.default_interval_seconds * 1000;
  return new Date(ms).toISOString();
}

// Pomocník pro <input type="time"> — vezme ISO a vrátí "HH:MM" (lokální čas).
export function isoToTimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Inverzní: "HH:MM" + base date → ISO. Default base = dnes.
export function timeInputToIso(hhmm: string, base: Date = new Date()): string | null {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = m[3] ? parseInt(m[3], 10) : 0;
  if (h > 23 || mm > 59 || ss > 59) return null;
  const d = new Date(base);
  d.setHours(h, mm, ss, 0);
  return d.toISOString();
}
