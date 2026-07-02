import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useSession } from '@/store/session';
import { Clock } from '@/components/Clock';
import { BigButton } from '@/components/BigButton';
import {
  createFinishEntry,
  deleteFinishEntry,
  updateFinishEntry,
} from '@/db/repo';
import { formatClockMs, parseManualTimeToIso } from '@/utils/time';
import { nowIso } from '@/utils/uuid';
import { useClock } from '@/hooks/useClock';
import type { FinishEntry, Racer, Stage, StartEntry } from '@/db/models';

export function FinishPage() {
  const { eventId, stageId, setStage } = useSession();
  const stages = useLiveQuery(
    () => eventId ? db.stages.where('event_id').equals(eventId).and(s => !s.deleted_at).sortBy('order_index') : Promise.resolve([] as Stage[]),
    [eventId],
    [] as Stage[],
  );
  const racers = useLiveQuery(
    () => eventId ? db.racers.where('event_id').equals(eventId).and(r => !r.deleted_at).toArray() : Promise.resolve([] as Racer[]),
    [eventId],
    [] as Racer[],
  );
  const finishEntries = useLiveQuery(
    () => stageId ? db.finish_entries.where('stage_id').equals(stageId).and(f => !f.deleted_at).toArray() : Promise.resolve([] as FinishEntry[]),
    [stageId],
    [] as FinishEntry[],
  );
  const startEntries = useLiveQuery(
    () => stageId ? db.start_entries.where('stage_id').equals(stageId).and(s => !s.deleted_at).toArray() : Promise.resolve([] as StartEntry[]),
    [stageId],
    [] as StartEntry[],
  );

  const racersById = useMemo(() => {
    const m = new Map<string, Racer>();
    (racers ?? []).forEach(r => m.set(r.id, r));
    return m;
  }, [racers]);
  const racersByBib = useMemo(() => {
    const m = new Map<number, Racer>();
    (racers ?? []).forEach(r => m.set(r.bib_number, r));
    return m;
  }, [racers]);

  const finishedRacerIds = useMemo(() => {
    const s = new Set<string>();
    (finishEntries ?? []).forEach(f => { if (f.racer_id) s.add(f.racer_id); });
    return s;
  }, [finishEntries]);

  const onTrack = useMemo(() => {
    const started = new Set<string>();
    (startEntries ?? []).forEach(s => {
      if (s.status === 'started' && s.racer_id) started.add(s.racer_id);
    });
    return [...started].filter(id => !finishedRacerIds.has(id));
  }, [startEntries, finishedRacerIds]);

  const recent = useMemo(
    () => [...(finishEntries ?? [])]
      .sort((a, b) => b.finish_time.localeCompare(a.finish_time))
      .slice(0, 20),
    [finishEntries],
  );

  const [whoInput, setWhoInput] = useState('');
  const [selectedRacerId, setSelectedRacerId] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [assigningEntry, setAssigningEntry] = useState<FinishEntry | null>(null);
  const [tapFlash, setTapFlash] = useState(false);
  const lastPointerTapRef = useRef(0);

  // Parse vstupu: jen-čísla → bib; cokoliv jiného → volný text (note).
  const whoParsed = useMemo(() => {
    const trimmed = whoInput.trim();
    if (!trimmed) return { kind: 'empty' as const };
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const racer = racersByBib.get(num) ?? null;
      return { kind: 'bib' as const, num, racer };
    }
    return { kind: 'note' as const, text: trimmed };
  }, [whoInput, racersByBib]);

  // Na výběr v dropdownu: všichni aktivní závodníci, řazení na trati → nestartovali → v cíli.
  const racerStatuses = useMemo(() => {
    const onTrackSet = new Set<string>(onTrack);
    return racers
      .filter(r => !r.dns)
      .map(r => {
        const finished = finishedRacerIds.has(r.id);
        const track = onTrackSet.has(r.id);
        const prio = track ? 0 : finished ? 2 : 1;
        const statusLabel = track ? 'na trati' : finished ? 'v cíli' : 'nestartoval';
        return { racer: r, prio, statusLabel };
      })
      .sort((a, b) => a.prio - b.prio || a.racer.bib_number - b.racer.bib_number);
  }, [racers, onTrack, finishedRacerIds]);

  if (!eventId) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-400">Nejdříve vyber závod na stránce „Domů".</div>;
  }
  if (!stages || stages.length === 0) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-400">Nejdříve vytvoř úsek (stage) na stránce „Domů".</div>;
  }

  async function recordTap(pressEpochMs: number) {
    if (!stageId) return;
    setTapFlash(true);
    window.setTimeout(() => setTapFlash(false), 250);
    navigator.vibrate?.(40);
    await createFinishEntry({
      stage_id: stageId,
      racer_id: null,
      bib_guess: null,
      finish_time: new Date(pressEpochMs).toISOString(),
    });
  }

  // event.timeStamp razítkuje prohlížeč v okamžiku dotyku — čas je správný,
  // i když je main thread zrovna zablokovaný a handler doběhne později.
  function tapPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    lastPointerTapRef.current = performance.now();
    void recordTap(performance.timeOrigin + e.timeStamp);
  }

  // Fallback pro klávesnici (Enter/mezerník negeneruje pointerdown);
  // click následující po pointerdown se ignoruje, ať se tap nezdvojí.
  function tapClick() {
    if (performance.now() - lastPointerTapRef.current < 700) return;
    void recordTap(Date.now());
  }

  async function submitFinish() {
    if (!stageId) return;
    let racerId: string | null = null;
    let bibGuess: number | null = null;
    let note = '';

    if (selectedRacerId) {
      racerId = selectedRacerId;
    } else if (whoParsed.kind === 'bib') {
      racerId = whoParsed.racer?.id ?? null;
      bibGuess = whoParsed.racer ? null : whoParsed.num;
    } else if (whoParsed.kind === 'note') {
      note = whoParsed.text;
    } else {
      return; // prázdné
    }

    const finish = manualTime.trim()
      ? parseManualTimeToIso(manualTime) ?? nowIso()
      : nowIso();
    await createFinishEntry({
      stage_id: stageId,
      racer_id: racerId,
      bib_guess: bibGuess,
      finish_time: finish,
      note,
    });
    setWhoInput('');
    setSelectedRacerId('');
    setManualTime('');
  }

  const currentStage = stages.find(s => s.id === stageId) ?? null;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase text-slate-400">Úsek</label>
          <select
            value={stageId ?? ''}
            onChange={e => setStage(e.target.value || null)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-lg"
          >
            <option value="">— vyber úsek —</option>
            {stages.map(s => (
              <option key={s.id} value={s.id}>#{s.order_index} {s.name}</option>
            ))}
          </select>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase text-slate-400">Aktuální čas</div>
          <Clock size="lg" />
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-400">Na trati</div>
          <div className="text-2xl font-bold text-amber-400">{onTrack.length}</div>
        </div>
      </div>

      {stageId && (
        <>
          <div className="grid md:grid-cols-2 gap-4 items-start">
            <section className="bg-slate-800/50 rounded-2xl p-4 space-y-3">
              <h2 className="text-lg font-semibold">Tap mód — klikni když projede</h2>
              <BigButton
                variant="success"
                className={`w-full py-8 transition ${tapFlash ? 'ring-4 ring-white brightness-125' : ''}`}
                onPointerDown={tapPointerDown}
                onClick={tapClick}
              >
                <span className="block text-5xl font-bold">DOJEL</span>
                <span className={`block mt-2 text-base font-semibold ${currentStage ? 'text-emerald-900/80' : 'text-amber-200'}`}>
                  {currentStage ? `úsek: #${currentStage.order_index} ${currentStage.name}` : '⚠ vyber úsek'}
                </span>
              </BigButton>
              <p className="text-xs text-slate-500">Uloží čas bez čísla. Přiřadíš později v seznamu nebo na stránce Výsledky.</p>
            </section>

            <section className="space-y-2 md:order-last md:col-span-2">
              <h2 className="text-lg font-semibold">Posledních 20 cílů</h2>
              <ul className="space-y-1">
                {recent.map(f => (
                  <RecentFinishItem
                    key={f.id}
                    entry={f}
                    racer={f.racer_id ? racersById.get(f.racer_id) ?? null : null}
                    onAssign={() => setAssigningEntry(f)}
                  />
                ))}
                {recent.length === 0 && <li className="text-slate-500 text-sm">Zatím žádný cíl.</li>}
              </ul>
            </section>

            <section className="bg-slate-800/50 rounded-2xl p-4 space-y-3">
              <h2 className="text-lg font-semibold">Zadej číslo / popis nebo vyber</h2>
              <select
                value={selectedRacerId}
                onChange={e => { setSelectedRacerId(e.target.value); if (e.target.value) setWhoInput(''); }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-lg"
              >
                <option value="">— vyber ze seznamu —</option>
                {racerStatuses.map(({ racer, statusLabel }) => (
                  <option key={racer.id} value={racer.id}>
                    #{racer.bib_number} {racer.first_name} {racer.last_name} · {statusLabel}
                  </option>
                ))}
              </select>
              <div className="text-center text-xs text-slate-500">nebo</div>
              <input
                value={whoInput}
                onChange={e => { setWhoInput(e.target.value); if (e.target.value) setSelectedRacerId(''); }}
                placeholder={'číslo nebo popis („modrá bunda", „Jenda")'}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-2xl font-mono"
              />
              <input
                value={manualTime}
                onChange={e => setManualTime(e.target.value)}
                placeholder={'čas: HH:MM:SS.xx  nebo  -10 / -1:30 (zpět)  · prázdné = teď'}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 font-mono"
              />
              <ManualTimePreview input={manualTime} />
              <BigButton
                variant="primary"
                className="w-full text-2xl py-4"
                onClick={submitFinish}
                disabled={!selectedRacerId && whoParsed.kind === 'empty'}
              >
                Uložit cíl
              </BigButton>
              {whoParsed.kind === 'bib' && whoParsed.racer && (
                <p className="text-xs text-emerald-400">
                  #{whoParsed.num} · {whoParsed.racer.first_name} {whoParsed.racer.last_name}
                </p>
              )}
              {whoParsed.kind === 'bib' && !whoParsed.racer && (
                <p className="text-xs text-amber-400">Číslo #{whoParsed.num} není v závodnících — uloží se jako nezařazené.</p>
              )}
              {whoParsed.kind === 'note' && (
                <p className="text-xs text-slate-400">Uloží se jako nezařazený cíl s poznámkou „{whoParsed.text}".</p>
              )}
            </section>
          </div>
        </>
      )}

      {assigningEntry && (
        <AssignDialog
          entry={assigningEntry}
          racers={racers ?? []}
          onClose={() => setAssigningEntry(null)}
        />
      )}
    </div>
  );
}

function RecentFinishItem({
  entry,
  racer,
  onAssign,
}: {
  entry: FinishEntry;
  racer: Racer | null;
  onAssign: () => void;
}) {
  const label = racer
    ? `#${racer.bib_number} ${racer.first_name} ${racer.last_name}`
    : entry.bib_guess != null
      ? `#${entry.bib_guess} (nepřiřazen)`
      : entry.note
        ? `„${entry.note}" (nepřiřazen)`
        : '(nepřiřazen)';
  const time = formatClockMs(new Date(entry.finish_time));
  return (
    <li className="flex items-center gap-2 bg-slate-800/50 rounded-xl p-2">
      <span className="font-mono tabular text-emerald-400 w-28">{time}</span>
      <span className="flex-1">
        {label}
        {racer && entry.note && <span className="text-slate-400 ml-2">· {entry.note}</span>}
      </span>
      <button onClick={onAssign} className="text-xs text-cyan-400 hover:text-cyan-300 px-2">
        přiřadit
      </button>
      <button
        onClick={() => {
          if (confirm('Smazat cílový záznam?')) deleteFinishEntry(entry.id);
        }}
        className="text-xs text-slate-500 hover:text-rose-400 px-2"
      >
        ✕
      </button>
    </li>
  );
}

function ManualTimePreview({ input }: { input: string }) {
  const now = useClock(500);
  const trimmed = input.trim();
  if (!trimmed) return null;
  const iso = parseManualTimeToIso(trimmed, now);
  if (!iso) {
    return <p className="text-xs text-rose-400">Nerozpoznaný formát času.</p>;
  }
  const d = new Date(iso);
  const isRelative = trimmed[0] === '+' || trimmed[0] === '-';
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const rel = isRelative
    ? (diffSec >= 0 ? ` (za ${diffSec}s)` : ` (před ${Math.abs(diffSec)}s)`)
    : '';
  return <p className="text-xs text-slate-400">Uloží se čas: <span className="font-mono text-slate-200">{formatClockMs(d)}</span>{rel}</p>;
}

function AssignDialog({
  entry,
  racers,
  onClose,
}: {
  entry: FinishEntry;
  racers: Racer[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(entry.racer_id ?? '');
  const [bib, setBib] = useState(entry.bib_guess?.toString() ?? '');

  const sorted = useMemo(
    () => [...racers].filter(r => !r.dns).sort((a, b) => a.bib_number - b.bib_number),
    [racers],
  );

  async function save() {
    if (selectedId) {
      await updateFinishEntry(entry.id, { racer_id: selectedId, bib_guess: null });
      onClose();
      return;
    }
    if (!bib.trim()) {
      await updateFinishEntry(entry.id, { racer_id: null, bib_guess: null });
      onClose();
      return;
    }
    const num = Number(bib.trim());
    const racer = racers.find(r => r.bib_number === num);
    await updateFinishEntry(entry.id, {
      racer_id: racer?.id ?? null,
      bib_guess: racer ? null : num,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl p-5 max-w-md w-full space-y-3 border border-slate-700" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Přiřadit číslo</h2>
        <div className="text-sm text-slate-400">
          Čas: <span className="font-mono text-emerald-400">{formatClockMs(new Date(entry.finish_time))}</span>
          {entry.note && <span className="ml-2 italic">· „{entry.note}"</span>}
        </div>
        <select
          value={selectedId}
          onChange={e => { setSelectedId(e.target.value); if (e.target.value) setBib(''); }}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-3 text-lg"
        >
          <option value="">— vyber ze seznamu —</option>
          {sorted.map(r => (
            <option key={r.id} value={r.id}>
              #{r.bib_number} {r.first_name} {r.last_name}
            </option>
          ))}
        </select>
        <div className="text-center text-xs text-slate-500">nebo</div>
        <input
          inputMode="numeric"
          value={bib}
          onChange={e => { setBib(e.target.value.replace(/\D/g, '')); if (e.target.value) setSelectedId(''); }}
          placeholder="startovní číslo (prázdné = zrušit)"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-2xl font-mono"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">Zrušit</button>
          <BigButton onClick={save} variant="success" className="text-base py-2 px-4">Uložit</BigButton>
        </div>
      </div>
    </div>
  );
}
