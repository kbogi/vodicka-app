import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useSession } from '@/store/session';
import {
  computeTotals,
  findDuplicateFinishes,
  findUnmatchedFinishEntries,
  findUnmatchedStartEntries,
} from '@/utils/results';
import { formatClockMs, formatDuration } from '@/utils/time';
import {
  deleteFinishEntry,
  deleteStartEntry,
  updateFinishEntry,
  updateStartEntry,
} from '@/db/repo';
import type { FinishEntry, Racer, Stage, StartEntry } from '@/db/models';

export function ResultsPage() {
  const { eventId } = useSession();
  const stages = useLiveQuery(
    () => eventId ? db.stages.where('event_id').equals(eventId).and(s => !s.deleted_at).sortBy('order_index') : Promise.resolve([] as Stage[]),
    [eventId], [] as Stage[],
  );
  const racers = useLiveQuery(
    () => eventId ? db.racers.where('event_id').equals(eventId).and(r => !r.deleted_at).toArray() : Promise.resolve([] as Racer[]),
    [eventId], [] as Racer[],
  );
  const stageIds = useMemo(() => (stages ?? []).map(s => s.id), [stages]);
  const startEntries = useLiveQuery(
    () => stageIds.length ? db.start_entries.where('stage_id').anyOf(stageIds).and(s => !s.deleted_at).toArray() : Promise.resolve([] as StartEntry[]),
    [stageIds.join('|')], [] as StartEntry[],
  );
  const finishEntries = useLiveQuery(
    () => stageIds.length ? db.finish_entries.where('stage_id').anyOf(stageIds).and(f => !f.deleted_at).toArray() : Promise.resolve([] as FinishEntry[]),
    [stageIds.join('|')], [] as FinishEntry[],
  );

  const [categoryFilter, setCategoryFilter] = useState('');

  const results = useMemo(() => {
    return computeTotals(stages ?? [], racers ?? [], startEntries ?? [], finishEntries ?? []);
  }, [stages, racers, startEntries, finishEntries]);
  const filtered = useMemo(() => {
    if (!categoryFilter) return results;
    return results.filter(r => r.racer.category === categoryFilter);
  }, [results, categoryFilter]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    (racers ?? []).forEach(r => { if (r.category) s.add(r.category); });
    return [...s].sort();
  }, [racers]);

  const duplicates = useMemo(() => findDuplicateFinishes(finishEntries ?? []), [finishEntries]);
  const unmatchedStarts = useMemo(() => findUnmatchedStartEntries(startEntries ?? []), [startEntries]);
  const unmatchedFinishes = useMemo(() => findUnmatchedFinishEntries(finishEntries ?? []), [finishEntries]);

  const racersById = useMemo(() => {
    const m = new Map<string, Racer>();
    (racers ?? []).forEach(r => m.set(r.id, r));
    return m;
  }, [racers]);
  const stagesById = useMemo(() => {
    const m = new Map<string, Stage>();
    (stages ?? []).forEach(s => m.set(s.id, s));
    return m;
  }, [stages]);

  if (!eventId) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-400">Nejdříve vyber závod na stránce „Domů".</div>;
  }

  function exportCsv() {
    const header = ['poradi', 'cislo', 'jmeno', 'kategorie', 'klub', ...(stages ?? []).map(s => s.name), 'celkem', 'poznamka'];
    const rows = filtered.map((r, i) => {
      const stageCols = (stages ?? []).map(s => {
        const res = r.perStage[s.id];
        return res?.duration_ms != null ? formatDuration(res.duration_ms) : (res?.note ?? '');
      });
      const total = r.total_ms != null ? formatDuration(r.total_ms) : '';
      const note = r.has_dns ? 'DNS' : r.has_dnf ? 'DNF' : r.missing_stages > 0 ? `chybí ${r.missing_stages}` : '';
      return [
        String(i + 1),
        String(r.racer.bib_number),
        `${r.racer.first_name} ${r.racer.last_name}`.trim(),
        r.racer.category,
        r.racer.club,
        ...stageCols,
        total,
        note,
      ];
    });
    const csv = [header, ...rows]
      .map(row => row.map(cell => {
        const s = String(cell ?? '');
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vysledky-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h1 className="text-2xl font-bold">Výsledky</h1>
        <div className="flex gap-2 items-center">
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"
            >
              <option value="">Všechny kategorie</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button onClick={exportCsv} className="bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-sm">
            Export CSV
          </button>
        </div>
      </div>

      {(stages ?? []).length === 0 ? (
        <p className="text-slate-500">Žádné úseky.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Číslo</th>
                <th className="py-2 pr-2">Jméno</th>
                <th className="py-2 pr-2">Kat.</th>
                {(stages ?? []).map(s => (
                  <th key={s.id} className="py-2 pr-2 font-mono">{s.name}</th>
                ))}
                <th className="py-2 pr-2 font-mono">Celkem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.racer.id} className="border-b border-slate-800/60">
                  <td className="py-2 pr-2 text-slate-400">{r.total_ms != null ? i + 1 : '—'}</td>
                  <td className="py-2 pr-2 font-mono font-bold">{r.racer.bib_number}</td>
                  <td className="py-2 pr-2">{r.racer.first_name} {r.racer.last_name}</td>
                  <td className="py-2 pr-2 text-slate-400">{r.racer.category}</td>
                  {(stages ?? []).map(s => {
                    const res = r.perStage[s.id];
                    return (
                      <td key={s.id} className="py-2 pr-2 font-mono tabular">
                        {res?.duration_ms != null ? (
                          <span className="text-slate-200">{formatDuration(res.duration_ms)}</span>
                        ) : (
                          <span className="text-slate-500">{res?.note || '—'}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2 pr-2 font-mono tabular font-bold">
                    {r.total_ms != null ? formatDuration(r.total_ms) : <span className="text-slate-500">—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4 + (stages ?? []).length + 1} className="py-4 text-slate-500 text-center">Zatím nic.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {duplicates.length > 0 && (
        <section className="bg-rose-950/30 border border-rose-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold text-rose-300">⚠ Konflikty — duplicitní cíle</h2>
          <p className="text-sm text-rose-200/80">Pro stejného závodníka na stejném úseku existuje víc cílových záznamů. Vyber ten správný, ostatní smaž.</p>
          <ul className="space-y-3">
            {duplicates.map((group, idx) => {
              const first = group[0];
              const racer = first.racer_id ? racersById.get(first.racer_id) : null;
              const stage = stagesById.get(first.stage_id);
              const header = racer
                ? `#${racer.bib_number} ${racer.first_name} ${racer.last_name}`.trim()
                : '(neznámý závodník)';
              return (
                <li key={idx} className="space-y-1">
                  <div className="text-sm font-semibold text-rose-200">
                    {header}
                    {stage && <span className="text-slate-400 font-normal"> · {stage.name}</span>}
                  </div>
                  {group.map(f => (
                    <div key={f.id} className="flex items-center gap-2 bg-slate-800 rounded-xl p-2 ml-4">
                      <span className="font-mono text-emerald-400 w-28">{formatClockMs(new Date(f.finish_time))}</span>
                      {f.note && <span className="text-xs italic text-slate-400">„{f.note}"</span>}
                      <span className="text-xs text-slate-500">device {f.device_id.slice(0, 6)}</span>
                      <button
                        onClick={() => deleteFinishEntry(f.id)}
                        className="ml-auto text-xs text-rose-400 hover:text-rose-300"
                      >
                        smazat
                      </button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(unmatchedStarts.length > 0 || unmatchedFinishes.length > 0) && (
        <section className="bg-amber-950/20 border border-amber-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold text-amber-300">Nezařazené záznamy</h2>
          {unmatchedStarts.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-slate-200 mb-1">Starty bez závodníka ({unmatchedStarts.length})</h3>
              <ul className="space-y-1">
                {unmatchedStarts.map(e => (
                  <UnmatchedStartRow key={e.id} entry={e} racers={racers ?? []} />
                ))}
              </ul>
            </div>
          )}
          {unmatchedFinishes.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm text-slate-200 mb-1">Cíle bez závodníka ({unmatchedFinishes.length})</h3>
              <ul className="space-y-1">
                {unmatchedFinishes.map(e => (
                  <UnmatchedFinishRow key={e.id} entry={e} racers={racers ?? []} />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UnmatchedStartRow({ entry, racers }: { entry: StartEntry; racers: Racer[] }) {
  const [bib, setBib] = useState(entry.bib_guess?.toString() ?? '');
  async function assign() {
    const num = Number(bib.trim());
    if (!Number.isInteger(num) || num < 1) return;
    const racer = racers.find(r => r.bib_number === num);
    await updateStartEntry(entry.id, {
      racer_id: racer?.id ?? null,
      bib_guess: racer ? null : num,
    });
  }
  return (
    <li className="flex items-center gap-2 bg-slate-800 rounded-xl p-2">
      <span className="font-mono text-cyan-400 w-28">
        {entry.actual_start ? formatClockMs(new Date(entry.actual_start)) :
          entry.scheduled_start ? <span className="text-slate-500">plán {formatClockMs(new Date(entry.scheduled_start))}</span> :
          <span className="text-slate-500">—</span>}
      </span>
      <input
        inputMode="numeric"
        value={bib}
        onChange={e => setBib(e.target.value.replace(/\D/g, ''))}
        placeholder="bib"
        className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 font-mono"
      />
      <button onClick={assign} className="text-xs bg-cyan-600 hover:bg-cyan-500 px-2 py-1 rounded">přiřadit</button>
      <button onClick={() => { if (confirm('Smazat?')) deleteStartEntry(entry.id); }} className="ml-auto text-xs text-slate-500 hover:text-rose-400">✕</button>
    </li>
  );
}

function UnmatchedFinishRow({ entry, racers }: { entry: FinishEntry; racers: Racer[] }) {
  const [bib, setBib] = useState(entry.bib_guess?.toString() ?? '');
  async function assign() {
    const num = Number(bib.trim());
    if (!Number.isInteger(num) || num < 1) return;
    const racer = racers.find(r => r.bib_number === num);
    await updateFinishEntry(entry.id, {
      racer_id: racer?.id ?? null,
      bib_guess: racer ? null : num,
    });
  }
  return (
    <li className="flex items-center gap-2 bg-slate-800 rounded-xl p-2">
      <span className="font-mono text-emerald-400 w-28">{formatClockMs(new Date(entry.finish_time))}</span>
      {entry.note && <span className="text-slate-300 italic">„{entry.note}"</span>}
      <input
        inputMode="numeric"
        value={bib}
        onChange={e => setBib(e.target.value.replace(/\D/g, ''))}
        placeholder="bib"
        className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 font-mono"
      />
      <button onClick={assign} className="text-xs bg-cyan-600 hover:bg-cyan-500 px-2 py-1 rounded">přiřadit</button>
      <button onClick={() => { if (confirm('Smazat?')) deleteFinishEntry(entry.id); }} className="ml-auto text-xs text-slate-500 hover:text-rose-400">✕</button>
    </li>
  );
}
