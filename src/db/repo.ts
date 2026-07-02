import { db } from './schema';
import type {
  BaseRecord,
  Event,
  FinishEntry,
  OutboxTable,
  Racer,
  Stage,
  StartEntry,
} from './models';
import { enqueueOutbox } from './outbox';
import { newId, nowIso } from '@/utils/uuid';
import { getDeviceId } from '@/sync/deviceId';
import { computeScheduledStart } from '@/utils/plan';

type Table =
  | 'events'
  | 'stages'
  | 'racers'
  | 'start_entries'
  | 'finish_entries';

function tableFor<T extends BaseRecord>(name: Table) {
  switch (name) {
    case 'events':
      return db.events as unknown as import('dexie').Table<T, string>;
    case 'stages':
      return db.stages as unknown as import('dexie').Table<T, string>;
    case 'racers':
      return db.racers as unknown as import('dexie').Table<T, string>;
    case 'start_entries':
      return db.start_entries as unknown as import('dexie').Table<T, string>;
    case 'finish_entries':
      return db.finish_entries as unknown as import('dexie').Table<T, string>;
  }
}

async function upsert<T extends BaseRecord>(
  table: Table,
  record: T,
): Promise<T> {
  const tbl = tableFor<T>(table);
  await tbl.put(record);
  await enqueueOutbox(table as OutboxTable, 'upsert', record.id, record);
  return record;
}

async function softDelete<T extends BaseRecord>(
  table: Table,
  id: string,
): Promise<void> {
  const tbl = tableFor<T>(table);
  const existing = await tbl.get(id);
  if (!existing) return;
  const next = { ...existing, deleted_at: nowIso(), updated_at: nowIso() };
  await tbl.put(next);
  await enqueueOutbox(table as OutboxTable, 'delete', id, next);
}

// ——————————————————— Events ———————————————————

export async function createEvent(input: { name: string; date: string }): Promise<Event> {
  const now = nowIso();
  return upsert<Event>('events', {
    id: newId(),
    name: input.name,
    date: input.date,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

export async function updateEvent(id: string, patch: Partial<Event>): Promise<void> {
  const existing = await db.events.get(id);
  if (!existing) return;
  await upsert<Event>('events', { ...existing, ...patch, id, updated_at: nowIso() });
}

export async function deleteEvent(id: string): Promise<void> {
  await softDelete('events', id);
}

// ——————————————————— Stages ———————————————————

export async function createStage(input: {
  event_id: string;
  name: string;
  order_index: number;
  default_interval_seconds?: number;
  first_start_at?: string | null;
}): Promise<Stage> {
  const now = nowIso();
  return upsert<Stage>('stages', {
    id: newId(),
    event_id: input.event_id,
    name: input.name,
    order_index: input.order_index,
    default_interval_seconds: input.default_interval_seconds ?? 30,
    first_start_at: input.first_start_at ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

export async function updateStage(id: string, patch: Partial<Stage>): Promise<void> {
  const existing = await db.stages.get(id);
  if (!existing) return;
  const next: Stage = { ...existing, ...patch, id, updated_at: nowIso() };
  await upsert<Stage>('stages', next);
  // Když se změnil první start nebo interval, přepočítat všem naplánovaným scheduled_start
  if (
    patch.first_start_at !== undefined ||
    patch.default_interval_seconds !== undefined
  ) {
    await recomputeScheduledStarts(id);
  }
}

export async function deleteStage(id: string): Promise<void> {
  await softDelete('stages', id);
}

// ——————————————————— Racers ———————————————————

export async function createRacer(input: {
  event_id: string;
  bib_number: number;
  first_name: string;
  last_name: string;
  category?: string;
  club?: string;
  dob?: string | null;
  notes?: string;
}): Promise<Racer> {
  const now = nowIso();
  return upsert<Racer>('racers', {
    id: newId(),
    event_id: input.event_id,
    bib_number: input.bib_number,
    first_name: input.first_name,
    last_name: input.last_name,
    category: input.category ?? '',
    club: input.club ?? '',
    dob: input.dob ?? null,
    notes: input.notes ?? '',
    dns: false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

export async function updateRacer(id: string, patch: Partial<Racer>): Promise<void> {
  const existing = await db.racers.get(id);
  if (!existing) return;
  await upsert<Racer>('racers', { ...existing, ...patch, id, updated_at: nowIso() });
}

export async function deleteRacer(id: string): Promise<void> {
  await softDelete('racers', id);
}

// Sloučí duplicitní závodníky: zachová `keepId`, všechny `discardIds`
// soft-deletne a jejich start_entries / finish_entries převede na `keepId`.
export async function mergeRacers(keepId: string, discardIds: string[]): Promise<void> {
  const keep = await db.racers.get(keepId);
  if (!keep || keep.deleted_at) throw new Error('Závodník k zachování neexistuje.');

  for (const discardId of discardIds) {
    if (discardId === keepId) continue;
    const starts = await db.start_entries.where('racer_id').equals(discardId).toArray();
    for (const s of starts) {
      if (s.deleted_at) continue;
      await upsert<StartEntry>('start_entries', { ...s, racer_id: keepId, updated_at: nowIso() });
    }
    const finishes = await db.finish_entries.where('racer_id').equals(discardId).toArray();
    for (const f of finishes) {
      if (f.deleted_at) continue;
      await upsert<FinishEntry>('finish_entries', { ...f, racer_id: keepId, updated_at: nowIso() });
    }
    await softDelete('racers', discardId);
  }
}

// ——————————————————— StartEntry (plánování startovky) ———————————————————

async function getLiveStartEntries(stageId: string): Promise<StartEntry[]> {
  const all = await db.start_entries.where('stage_id').equals(stageId).toArray();
  return all
    .filter(e => !e.deleted_at)
    .sort((a, b) => a.order_index - b.order_index);
}

// Další volný order_index — po smazání odstartovaného zůstávají v číslování
// mezery, takže `live.length` by mohlo kolidovat s existujícím indexem.
function nextOrderIndex(live: StartEntry[]): number {
  return live.length ? live[live.length - 1].order_index + 1 : 0;
}

async function getStageOrThrow(stageId: string): Promise<Stage> {
  const stage = await db.stages.get(stageId);
  if (!stage || stage.deleted_at) throw new Error('Stage neexistuje');
  return stage;
}

// Spočítá scheduled_start pro další (nový) záznam — navazuje na poslední existující
// (jeho scheduled_start + interval), aby respektoval ruční posuny. Fallback: stage.first_start_at.
// Pokud by kandidát vyšel do minulosti (ještě + buffer), posune se po intervalech dopředu,
// aby nový závodník nezačal startovat hned nebo v minulosti.
const ENROLL_BUFFER_MS = 10_000;

function nextScheduledStart(stage: Stage, live: StartEntry[]): string | null {
  const intervalMs = stage.default_interval_seconds * 1000;

  let baseIso: string | null;
  if (live.length === 0) {
    baseIso = stage.first_start_at;
  } else {
    const last = live[live.length - 1];
    if (last.scheduled_start) {
      baseIso = new Date(new Date(last.scheduled_start).getTime() + intervalMs).toISOString();
    } else {
      baseIso = computeScheduledStart(stage, live.length);
    }
  }
  if (!baseIso) return null;

  let baseMs = new Date(baseIso).getTime();
  const floor = Date.now() + ENROLL_BUFFER_MS;
  if (intervalMs > 0) {
    while (baseMs < floor) baseMs += intervalMs;
  } else if (baseMs < floor) {
    baseMs = floor;
  }
  return new Date(baseMs).toISOString();
}

// Přidá závodníka (existujícího nebo jen přes číslo) na konec startovky.
export async function enrollInStage(input: {
  stage_id: string;
  racer_id: string | null;
  bib_guess?: number | null;
}): Promise<StartEntry> {
  const stage = await getStageOrThrow(input.stage_id);
  const live = await getLiveStartEntries(stage.id);
  const orderIndex = nextOrderIndex(live);
  const scheduled = nextScheduledStart(stage, live);
  const now = nowIso();
  return upsert<StartEntry>('start_entries', {
    id: newId(),
    stage_id: stage.id,
    racer_id: input.racer_id,
    bib_guess: input.bib_guess ?? null,
    order_index: orderIndex,
    scheduled_start: scheduled,
    actual_start: null,
    status: 'pending',
    device_id: getDeviceId(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

// Vygeneruje startovku ze všech závodníků eventu podle čísla, kteří ještě v stage nejsou a nemají DNS.
export async function generateStartovka(stageId: string): Promise<number> {
  const stage = await getStageOrThrow(stageId);
  const racers = await db.racers.where('event_id').equals(stage.event_id).toArray();
  const eligible = racers
    .filter(r => !r.deleted_at && !r.dns)
    .sort((a, b) => a.bib_number - b.bib_number);

  const existing = await getLiveStartEntries(stage.id);
  const alreadyEnrolled = new Set(existing.map(e => e.racer_id).filter(Boolean));
  const toAdd = eligible.filter(r => !alreadyEnrolled.has(r.id));

  const working = [...existing];
  const now = nowIso();
  for (const racer of toAdd) {
    const orderIndex = nextOrderIndex(working);
    const scheduled = nextScheduledStart(stage, working);
    const entry: StartEntry = {
      id: newId(),
      stage_id: stage.id,
      racer_id: racer.id,
      bib_guess: null,
      order_index: orderIndex,
      scheduled_start: scheduled,
      actual_start: null,
      status: 'pending',
      device_id: getDeviceId(),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await upsert<StartEntry>('start_entries', entry);
    working.push(entry);
  }
  return toAdd.length;
}

// Přepočte scheduled_start pending záznamů dle formule (first_start_at + idx*interval).
// Neharaší s already-started (ty mají historický scheduled_start = actual_start).
// Volá se při změně stage.first_start_at nebo intervalu — přepíše případné ruční posuny.
export async function recomputeScheduledStarts(stageId: string): Promise<void> {
  const stage = await getStageOrThrow(stageId);
  const live = await getLiveStartEntries(stage.id);
  for (const entry of live) {
    if (entry.status === 'started') continue;
    const scheduled = computeScheduledStart(stage, entry.order_index);
    if (scheduled !== entry.scheduled_start) {
      await upsert<StartEntry>('start_entries', { ...entry, scheduled_start: scheduled, updated_at: nowIso() });
    }
  }
}

// Posun pending startů o delta sekund (např. pro pauzu kvůli nestíhání na trati).
// Never touches already-started entries. Returns počet upravených záznamů.
export async function shiftPendingStarts(stageId: string, deltaSeconds: number): Promise<number> {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return 0;
  const live = await getLiveStartEntries(stageId);
  let affected = 0;
  for (const entry of live) {
    if (entry.status !== 'pending' || !entry.scheduled_start) continue;
    const newTime = new Date(new Date(entry.scheduled_start).getTime() + deltaSeconds * 1000).toISOString();
    await upsert<StartEntry>('start_entries', { ...entry, scheduled_start: newTime, updated_at: nowIso() });
    affected++;
  }
  return affected;
}

// Swap pozice i scheduled_start se sousedem — posuny zůstanou zachované.
export async function moveStartEntry(id: string, direction: 'up' | 'down'): Promise<void> {
  const entry = await db.start_entries.get(id);
  if (!entry || entry.deleted_at) return;
  const live = await getLiveStartEntries(entry.stage_id);
  const idx = live.findIndex(e => e.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= live.length) return;
  const a = live[idx];
  const b = live[swapIdx];
  const now = nowIso();
  await upsert<StartEntry>('start_entries', {
    ...a,
    order_index: b.order_index,
    scheduled_start: b.scheduled_start,
    updated_at: now,
  });
  await upsert<StartEntry>('start_entries', {
    ...b,
    order_index: a.order_index,
    scheduled_start: a.scheduled_start,
    updated_at: now,
  });
}

// Odebere záznam ze startovky. Přeplánování se týká výhradně pending
// záznamů: každý pending pod odebraným zdědí pozici i čas předchozího
// pending slotu (pauzy v rozvrhu se zachovají). Odstartovaní / DNS / DNF
// zůstávají nedotčení — dřív se posouvali i oni a pending závodník mohl
// zdědit plánovaný čas z minulosti, načež ho auto-start okamžitě
// „odstartoval".
export async function unenrollStartEntry(id: string): Promise<void> {
  const entry = await db.start_entries.get(id);
  if (!entry || entry.deleted_at) return;
  const stageId = entry.stage_id;

  // Snapshot pending slotů PŘED smazáním.
  const before = await getLiveStartEntries(stageId);
  const pendingSlots = before
    .filter(e => e.status === 'pending')
    .map(e => ({ order_index: e.order_index, scheduled_start: e.scheduled_start }));

  await softDelete('start_entries', id);

  // Mazání ne-pending záznamu plán nemění.
  if (entry.status !== 'pending') return;

  const after = await getLiveStartEntries(stageId);
  const pendingAfter = after.filter(e => e.status === 'pending');
  const now = nowIso();
  for (let i = 0; i < pendingAfter.length; i++) {
    const e = pendingAfter[i];
    const slot = pendingSlots[i];
    if (!slot) break;
    if (e.order_index !== slot.order_index || e.scheduled_start !== slot.scheduled_start) {
      await upsert<StartEntry>('start_entries', {
        ...e,
        order_index: slot.order_index,
        scheduled_start: slot.scheduled_start,
        updated_at: now,
      });
    }
  }
}

// Označí záznam jako odstartovaný na daný čas (default scheduled_start).
export async function markStarted(id: string, at?: string): Promise<void> {
  const entry = await db.start_entries.get(id);
  if (!entry || entry.deleted_at) return;
  const actual = at ?? entry.scheduled_start ?? nowIso();
  await upsert<StartEntry>('start_entries', {
    ...entry,
    actual_start: actual,
    status: 'started',
    updated_at: nowIso(),
  });
}

// Nouzový start mimo plán (zařadí ad hoc na konec s actual_start = now).
export async function quickStart(input: {
  stage_id: string;
  racer_id: string | null;
  bib_guess?: number | null;
}): Promise<StartEntry> {
  const stage = await getStageOrThrow(input.stage_id);
  const live = await getLiveStartEntries(stage.id);
  const orderIndex = nextOrderIndex(live);
  const now = nowIso();
  return upsert<StartEntry>('start_entries', {
    id: newId(),
    stage_id: stage.id,
    racer_id: input.racer_id,
    bib_guess: input.bib_guess ?? null,
    order_index: orderIndex,
    scheduled_start: computeScheduledStart(stage, orderIndex),
    actual_start: now,
    status: 'started',
    device_id: getDeviceId(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

export async function updateStartEntry(id: string, patch: Partial<StartEntry>): Promise<void> {
  const existing = await db.start_entries.get(id);
  if (!existing || existing.deleted_at) return;
  await upsert<StartEntry>('start_entries', { ...existing, ...patch, id, updated_at: nowIso() });
}

export async function deleteStartEntry(id: string): Promise<void> {
  await softDelete('start_entries', id);
}

// ——————————————————— FinishEntry ———————————————————

export async function createFinishEntry(input: {
  stage_id: string;
  racer_id: string | null;
  bib_guess?: number | null;
  finish_time: string;
  note?: string;
}): Promise<FinishEntry> {
  const now = nowIso();
  return upsert<FinishEntry>('finish_entries', {
    id: newId(),
    stage_id: input.stage_id,
    racer_id: input.racer_id,
    bib_guess: input.bib_guess ?? null,
    finish_time: input.finish_time,
    device_id: getDeviceId(),
    note: input.note ?? '',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

export async function updateFinishEntry(id: string, patch: Partial<FinishEntry>): Promise<void> {
  const existing = await db.finish_entries.get(id);
  if (!existing) return;
  await upsert<FinishEntry>('finish_entries', { ...existing, ...patch, id, updated_at: nowIso() });
}

export async function deleteFinishEntry(id: string): Promise<void> {
  await softDelete('finish_entries', id);
}
