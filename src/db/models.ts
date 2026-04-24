export type ID = string;
export type ISOTime = string;

export type EntryStatus = 'pending' | 'started' | 'dns' | 'dnf' | 'cancelled';

export interface BaseRecord {
  id: ID;
  created_at: ISOTime;
  updated_at: ISOTime;
  deleted_at: ISOTime | null;
}

export interface Event extends BaseRecord {
  name: string;
  date: string;
}

export interface Stage extends BaseRecord {
  event_id: ID;
  name: string;
  order_index: number;
  default_interval_seconds: number;
  first_start_at: ISOTime | null;
}

export interface Racer extends BaseRecord {
  event_id: ID;
  bib_number: number;
  first_name: string;
  last_name: string;
  category: string;
  club: string;
  dob: string | null;
  notes: string;
  dns: boolean;
}

export interface StartEntry extends BaseRecord {
  stage_id: ID;
  racer_id: ID | null;
  bib_guess: number | null;
  order_index: number;
  scheduled_start: ISOTime | null;
  actual_start: ISOTime | null;
  status: EntryStatus;
  device_id: string;
}

export interface FinishEntry extends BaseRecord {
  stage_id: ID;
  racer_id: ID | null;
  bib_guess: number | null;
  finish_time: ISOTime;
  device_id: string;
  note: string;
}

export type OutboxOp = 'upsert' | 'delete';
export type OutboxTable =
  | 'events'
  | 'stages'
  | 'racers'
  | 'start_entries'
  | 'finish_entries';

export interface OutboxItem {
  id: ID;
  table: OutboxTable;
  op: OutboxOp;
  record_id: ID;
  payload: unknown;
  created_at: ISOTime;
  attempts: number;
  last_error: string | null;
}
