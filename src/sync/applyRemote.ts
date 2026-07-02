import type { Table } from 'dexie';
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

// Aplikuje příchozí řádek ze Supabase do lokální Dexie (realtime eventy).
export async function applyRemoteRow(table: SyncTable, row: AnyRow): Promise<void> {
  await applyRemoteRows(table, [row]);
}

// Dávková varianta pro bootstrap/pull: jedna transakce + bulkPut, aby se
// liveQuery v UI probudilo jednou per tabulka, ne per řádek.
// LWW: pokud lokální updated_at ≥ remote updated_at, zachováme lokál.
export async function applyRemoteRows(table: SyncTable, rows: AnyRow[]): Promise<void> {
  const valid = rows.filter(r => r && r.id);
  if (valid.length === 0) return;
  const tbl = tableFor(table) as unknown as Table<AnyRow, string>;
  await db.transaction('rw', tbl, async () => {
    const existing = await tbl.bulkGet(valid.map(r => r.id));
    const toPut = valid.filter((row, i) => {
      const local = existing[i];
      if (!local) return true;
      if (local.updated_at && row.updated_at && local.updated_at >= row.updated_at) {
        return false; // lokál je stejně nový nebo novější
      }
      return true;
    });
    if (toPut.length > 0) await tbl.bulkPut(toPut);
  });
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
