import { db } from '@/db/schema';
import type {
  Event,
  FinishEntry,
  Racer,
  Stage,
  StartEntry,
} from '@/db/models';
import type { SyncTable } from './supabase';

type AnyRow = Event | Stage | Racer | StartEntry | FinishEntry;

// Aplikuje příchozí řádek ze Supabase do lokální Dexie.
// LWW: pokud lokální updated_at ≥ remote updated_at, zachováme lokál.
export async function applyRemoteRow(table: SyncTable, row: AnyRow): Promise<void> {
  if (!row || !row.id) return;
  const tbl = tableFor(table);
  const existing = (await tbl.get(row.id)) as AnyRow | undefined;
  if (existing) {
    if (existing.updated_at && row.updated_at && existing.updated_at >= row.updated_at) {
      return; // lokál je stejně nový nebo novější
    }
  }
  await tbl.put(row as never);
}

function tableFor(table: SyncTable) {
  switch (table) {
    case 'events':         return db.events;
    case 'stages':         return db.stages;
    case 'racers':         return db.racers;
    case 'start_entries':  return db.start_entries;
    case 'finish_entries': return db.finish_entries;
  }
}
