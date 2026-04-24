import type { FinishEntry, Racer, Stage, StartEntry } from '@/db/models';
import { diffMs } from './time';

export interface StageResult {
  stage_id: string;
  racer_id: string;
  start_entry_id: string | null;
  finish_entry_id: string | null;
  duration_ms: number | null;
  note: string;
}

export interface TotalResult {
  racer: Racer;
  perStage: Record<string, StageResult>;
  total_ms: number | null;
  completed_stages: number;
  missing_stages: number;
  has_dns: boolean;
  has_dnf: boolean;
}

// For a given racer + stage, we take the earliest non-cancelled start entry
// and the earliest finish entry. Duplicates (multiple finishes for the same
// racer+stage) are still present in the raw data and surfaced separately.
export function computeStageResult(
  stage: Stage,
  racer: Racer,
  starts: StartEntry[],
  finishes: FinishEntry[],
): StageResult {
  const relevantStarts = starts
    .filter(s => !s.deleted_at && s.stage_id === stage.id && s.racer_id === racer.id)
    .sort((a, b) => (a.actual_start ?? a.scheduled_start ?? '').localeCompare(b.actual_start ?? b.scheduled_start ?? ''));
  const relevantFinishes = finishes
    .filter(f => !f.deleted_at && f.stage_id === stage.id && f.racer_id === racer.id)
    .sort((a, b) => a.finish_time.localeCompare(b.finish_time));

  const startEntry = relevantStarts.find(s => s.status === 'started') ?? relevantStarts[0];
  const finishEntry = relevantFinishes[0];

  const status = startEntry?.status ?? null;
  const note =
    status === 'dns' ? 'DNS' :
    status === 'dnf' ? 'DNF' :
    status === 'cancelled' ? 'zrušeno' :
    !startEntry ? 'bez startu' :
    !finishEntry ? 'bez cíle' :
    '';

  const duration_ms =
    startEntry && finishEntry && status === 'started' && startEntry.actual_start
      ? diffMs(startEntry.actual_start, finishEntry.finish_time)
      : null;

  return {
    stage_id: stage.id,
    racer_id: racer.id,
    start_entry_id: startEntry?.id ?? null,
    finish_entry_id: finishEntry?.id ?? null,
    duration_ms,
    note,
  };
}

export function computeTotals(
  stages: Stage[],
  racers: Racer[],
  starts: StartEntry[],
  finishes: FinishEntry[],
): TotalResult[] {
  const activeStages = stages.filter(s => !s.deleted_at).sort((a, b) => a.order_index - b.order_index);
  const activeRacers = racers.filter(r => !r.deleted_at);

  return activeRacers.map(racer => {
    const perStage: Record<string, StageResult> = {};
    let total = 0;
    let completed = 0;
    let missing = 0;
    let dns = false;
    let dnf = false;
    for (const stage of activeStages) {
      const res = computeStageResult(stage, racer, starts, finishes);
      perStage[stage.id] = res;
      if (res.duration_ms != null) {
        total += res.duration_ms;
        completed += 1;
      } else {
        missing += 1;
      }
      if (res.note === 'DNS') dns = true;
      if (res.note === 'DNF') dnf = true;
    }
    return {
      racer,
      perStage,
      total_ms: completed === activeStages.length && completed > 0 ? total : null,
      completed_stages: completed,
      missing_stages: missing,
      has_dns: dns,
      has_dnf: dnf,
    };
  }).sort((a, b) => {
    // completed > partial > DNS/DNF
    if (a.total_ms != null && b.total_ms != null) return a.total_ms - b.total_ms;
    if (a.total_ms != null) return -1;
    if (b.total_ms != null) return 1;
    return b.completed_stages - a.completed_stages;
  });
}

export function findDuplicateFinishes(finishes: FinishEntry[]): FinishEntry[][] {
  const groups = new Map<string, FinishEntry[]>();
  for (const f of finishes) {
    if (f.deleted_at || !f.racer_id) continue;
    const key = `${f.stage_id}::${f.racer_id}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

export function findUnmatchedStartEntries(entries: StartEntry[]): StartEntry[] {
  return entries.filter(e => !e.deleted_at && !e.racer_id);
}

export function findUnmatchedFinishEntries(entries: FinishEntry[]): FinishEntry[] {
  return entries.filter(e => !e.deleted_at && !e.racer_id);
}
