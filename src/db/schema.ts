import Dexie, { type Table } from 'dexie';
import type {
  Event,
  Stage,
  Racer,
  StartEntry,
  FinishEntry,
  OutboxItem,
} from './models';

export class VodickaDB extends Dexie {
  events!: Table<Event, string>;
  stages!: Table<Stage, string>;
  racers!: Table<Racer, string>;
  start_entries!: Table<StartEntry, string>;
  finish_entries!: Table<FinishEntry, string>;
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super('vodicka');

    this.version(1).stores({
      events: 'id, date, deleted_at',
      stages: 'id, event_id, order_index, deleted_at',
      racers: 'id, event_id, bib_number, [event_id+bib_number], deleted_at',
      start_entries: 'id, stage_id, racer_id, actual_start, deleted_at',
      finish_entries: 'id, stage_id, racer_id, finish_time, deleted_at',
      outbox: 'id, table, record_id, created_at',
    });

    this.version(2).stores({
      events: 'id, date, deleted_at',
      stages: 'id, event_id, order_index, deleted_at',
      racers: 'id, event_id, bib_number, [event_id+bib_number], deleted_at',
      start_entries: 'id, stage_id, racer_id, [stage_id+order_index], actual_start, deleted_at',
      finish_entries: 'id, stage_id, racer_id, finish_time, deleted_at',
      outbox: 'id, table, record_id, created_at',
    }).upgrade(async tx => {
      // Doplnit first_start_at na stages
      await tx.table('stages').toCollection().modify(stage => {
        if (stage.first_start_at === undefined) stage.first_start_at = null;
      });
      // Doplnit order_index na start_entries podle pořadí vzniku
      const byStage = new Map<string, any[]>();
      await tx.table('start_entries').toCollection().each(e => {
        const arr = byStage.get(e.stage_id) ?? [];
        arr.push(e);
        byStage.set(e.stage_id, arr);
      });
      for (const list of byStage.values()) {
        list.sort((a, b) => String(a.actual_start ?? a.created_at).localeCompare(String(b.actual_start ?? b.created_at)));
        for (let i = 0; i < list.length; i++) {
          await tx.table('start_entries').update(list[i].id, { order_index: i });
        }
      }
    });
  }
}

export const db = new VodickaDB();
