import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useSession } from '@/store/session';
import { Clock } from '@/components/Clock';
import { BigButton } from '@/components/BigButton';
import {
  createRacer,
  enrollInStage,
  generateStartovka,
  markStarted,
  moveStartEntry,
  quickStart,
  shiftPendingStarts,
  unenrollStartEntry,
  updateStage,
  updateStartEntry,
} from '@/db/repo';
import { useClock } from '@/hooks/useClock';
import { formatClock, formatDurationShort } from '@/utils/time';
import { isoToTimeInput, timeInputToIso } from '@/utils/plan';
import type { Racer, Stage, StartEntry } from '@/db/models';

export function StartPage() {
  const { eventId, stageId, setStage } = useSession();
  const now = useClock(500);

  const stages = useLiveQuery(
    () => eventId ? db.stages.where('event_id').equals(eventId).and(s => !s.deleted_at).sortBy('order_index') : Promise.resolve([] as Stage[]),
    [eventId],
    [] as Stage[],
  );
  const stage = useMemo(() => stages.find(s => s.id === stageId) ?? null, [stages, stageId]);

  const racers = useLiveQuery(
    () => eventId ? db.racers.where('event_id').equals(eventId).and(r => !r.deleted_at).toArray() : Promise.resolve([] as Racer[]),
    [eventId],
    [] as Racer[],
  );
  const startEntries = useLiveQuery(
    () => stageId ? db.start_entries.where('stage_id').equals(stageId).and(s => !s.deleted_at).toArray() : Promise.resolve([] as StartEntry[]),
    [stageId],
    [] as StartEntry[],
  );

  const racersById = useMemo(() => {
    const m = new Map<string, Racer>();
    racers.forEach(r => m.set(r.id, r));
    return m;
  }, [racers]);
  const enrolledRacerIds = useMemo(() => {
    const s = new Set<string>();
    startEntries.forEach(e => { if (e.racer_id) s.add(e.racer_id); });
    return s;
  }, [startEntries]);
  const availableRacers = useMemo(
    () => racers
      .filter(r => !r.dns && !enrolledRacerIds.has(r.id))
      .sort((a, b) => a.bib_number - b.bib_number),
    [racers, enrolledRacerIds],
  );

  const sortedPlan = useMemo(
    () => [...startEntries].sort((a, b) => a.order_index - b.order_index),
    [startEntries],
  );

  // Auto-mark jako started, když čas projde naplánovaný start.
  useEffect(() => {
    if (!stage?.first_start_at) return;
    const pending = sortedPlan.filter(
      e => e.status === 'pending' && e.scheduled_start && new Date(e.scheduled_start).getTime() <= now.getTime()
    );
    for (const e of pending) {
      void markStarted(e.id);
    }
  }, [now, sortedPlan, stage?.first_start_at]);

  const nextPending = useMemo(
    () => sortedPlan.find(e => e.status === 'pending'),
    [sortedPlan],
  );
  const nextCountdownMs = useMemo(() => {
    if (!nextPending?.scheduled_start) return null;
    return new Date(nextPending.scheduled_start).getTime() - now.getTime();
  }, [nextPending, now]);

  if (!eventId) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-400">Nejdříve vyber závod na stránce „Domů".</div>;
  }
  if (!stages || stages.length === 0) {
    return <div className="p-4 max-w-3xl mx-auto text-slate-400">Nejdříve vytvoř úsek (stage) na stránce „Domů".</div>;
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <header className="flex flex-wrap gap-3 items-center justify-between">
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
          <Clock size="xl" />
        </div>
      </header>

      {stage && (
        <>
          {stage.first_start_at && (
            <NextUp entry={nextPending ?? null} racer={nextPending?.racer_id ? racersById.get(nextPending.racer_id) ?? null : null} countdownMs={nextCountdownMs} />
          )}

          <StageHeader stage={stage} plannedCount={sortedPlan.length} />

          <PlanList plan={sortedPlan} racersById={racersById} />

          <EnrollSection
            stage={stage}
            availableRacers={availableRacers}
            allRacers={racers}
            eventId={stage.event_id}
          />

          <QuickStart stage={stage} racers={racers} />
        </>
      )}
    </div>
  );
}

function StageHeader({ stage, plannedCount }: { stage: Stage; plannedCount: number }) {
  const [editing, setEditing] = useState(false);
  const [timeInput, setTimeInput] = useState(isoToTimeInput(stage.first_start_at));
  const [interval, setInterval] = useState(stage.default_interval_seconds);

  useEffect(() => {
    setTimeInput(isoToTimeInput(stage.first_start_at));
    setInterval(stage.default_interval_seconds);
  }, [stage.first_start_at, stage.default_interval_seconds]);

  async function save() {
    const iso = timeInput ? timeInputToIso(timeInput) : null;
    await updateStage(stage.id, {
      first_start_at: iso,
      default_interval_seconds: interval,
    });
    setEditing(false);
  }

  return (
    <section className="bg-slate-800/50 rounded-2xl p-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase text-slate-400">Úsek</div>
          <div className="text-xl font-bold truncate">{stage.name}</div>
        </div>
        <button
          onClick={() => setEditing(v => !v)}
          className="bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-sm whitespace-nowrap"
        >
          {editing ? 'zavřít' : 'nastavit'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="min-w-0">
          <div className="text-xs uppercase text-slate-400">První start</div>
          <div className="text-lg md:text-2xl font-mono tabular font-bold">
            {stage.first_start_at
              ? isoToTimeInput(stage.first_start_at)
              : <span className="text-amber-400">—</span>}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase text-slate-400">Interval</div>
          <div className="text-lg md:text-2xl font-mono tabular font-bold">{stage.default_interval_seconds}s</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase text-slate-400">Naplánováno</div>
          <div className="text-lg md:text-2xl font-mono tabular font-bold">{plannedCount}</div>
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap gap-3 items-end mt-4 border-t border-slate-700 pt-4">
          <label className="block">
            <span className="text-xs uppercase text-slate-400">První start (HH:MM)</span>
            <input
              type="time"
              value={timeInput}
              onChange={e => setTimeInput(e.target.value)}
              className="block bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xl font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase text-slate-400">Interval (s)</span>
            <input
              type="number"
              min={5}
              max={600}
              value={interval}
              onChange={e => setInterval(Number(e.target.value) || 30)}
              className="block w-24 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xl font-mono"
            />
          </label>
          <BigButton variant="success" onClick={save} className="text-base py-2 px-4">
            Uložit
          </BigButton>
          <p className="text-xs text-slate-500 w-full">
            Změna přepočítá plánované časy <b>pending</b> závodníkům. Už odstartované zůstávají beze změny.
            Pokud chceš jen pauzu (zdržení) bez změny baseline, použij tlačítka „Posun plánu" níže.
          </p>
        </div>
      )}

      <ShiftControls stageId={stage.id} intervalSeconds={stage.default_interval_seconds} />
    </section>
  );
}

function ShiftControls({ stageId, intervalSeconds }: { stageId: string; intervalSeconds: number }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function shift(deltaSec: number) {
    const n = await shiftPendingStarts(stageId, deltaSec);
    const sign = deltaSec > 0 ? '+' : '−';
    setFeedback(n === 0 ? 'Žádní pending závodníci.' : `${n} startů posunuto o ${sign}${Math.abs(deltaSec)} s`);
    window.setTimeout(() => setFeedback(null), 3500);
  }

  return (
    <div className="flex flex-wrap gap-2 items-center mt-4 border-t border-slate-700 pt-4">
      <span className="text-xs uppercase text-slate-400 mr-2">Posun plánu (jen pending)</span>
      <button onClick={() => shift(-intervalSeconds)} className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5 font-mono">
        − {intervalSeconds} s
      </button>
      <button onClick={() => shift(intervalSeconds)} className="bg-amber-700 hover:bg-amber-600 rounded-lg px-3 py-1.5 font-mono">
        + {intervalSeconds} s
      </button>
      {feedback && <span className="text-sm text-emerald-300 ml-2">{feedback}</span>}
    </div>
  );
}

function NextUp({
  entry,
  racer,
  countdownMs,
}: {
  entry: StartEntry | null;
  racer: Racer | null;
  countdownMs: number | null;
}) {
  if (!entry) {
    return (
      <section className="bg-slate-800/50 rounded-2xl p-6 text-center text-slate-500">
        Všichni naplánovaní závodníci už odstartovali.
      </section>
    );
  }
  const name = racer
    ? `${racer.first_name} ${racer.last_name}`.trim()
    : entry.bib_guess != null
      ? `(nepřiřazený #${entry.bib_guess})`
      : '(nepřiřazený)';
  const bib = racer ? `#${racer.bib_number}` : entry.bib_guess != null ? `#${entry.bib_guess}` : '#?';
  const imminent = countdownMs != null && countdownMs < 10_000;
  const label = countdownMs == null
    ? '—'
    : countdownMs > 0
      ? `za ${formatDurationShort(countdownMs)}`
      : `zmeškáno o ${formatDurationShort(-countdownMs)}`;
  return (
    <section className={`rounded-2xl p-4 md:p-6 border-2 transition-colors ${imminent ? 'bg-emerald-900/40 border-emerald-500' : 'bg-slate-800/50 border-slate-700'}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase text-slate-400">Na řadě</div>
          <div className="text-5xl md:text-7xl font-bold font-mono tabular">{bib}</div>
          <div className="text-lg md:text-2xl truncate">{name}</div>
          {racer && (
            <div className="text-sm text-slate-400 truncate">{racer.category}{racer.club ? ` · ${racer.club}` : ''}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs uppercase text-slate-400">Plánovaný start</div>
          <div className="text-2xl md:text-4xl font-mono tabular font-bold">
            {entry.scheduled_start ? formatClock(new Date(entry.scheduled_start)) : '—'}
          </div>
          <div className={`text-base md:text-xl font-mono tabular mt-1 ${imminent ? 'text-emerald-300' : 'text-slate-400'}`}>
            {label}
          </div>
          <BigButton
            variant="success"
            className="mt-3 text-base md:text-xl py-2 md:py-3 px-4 md:px-6"
            onClick={() => markStarted(entry.id)}
          >
            Start teď
          </BigButton>
        </div>
      </div>
    </section>
  );
}

function PlanList({
  plan,
  racersById,
}: {
  plan: StartEntry[];
  racersById: Map<string, Racer>;
}) {
  if (plan.length === 0) {
    return <p className="text-slate-500 p-4 text-center">Startovka je prázdná. Přidej závodníky dole.</p>;
  }
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Startovka ({plan.length})</h2>
        <span className="text-xs text-slate-500">pořadí · čas · číslo · jméno · stav</span>
      </div>
      <ul className="space-y-1">
        {plan.map((entry, idx) => (
          <PlanRow
            key={entry.id}
            entry={entry}
            racer={entry.racer_id ? racersById.get(entry.racer_id) ?? null : null}
            isFirst={idx === 0}
            isLast={idx === plan.length - 1}
          />
        ))}
      </ul>
    </section>
  );
}

function PlanRow({
  entry,
  racer,
  isFirst,
  isLast,
}: {
  entry: StartEntry;
  racer: Racer | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  const label = racer
    ? `${racer.first_name} ${racer.last_name}`.trim()
    : entry.bib_guess != null ? `(bez závodníka)` : '(nepřiřazený)';
  const bib = racer ? `#${racer.bib_number}` : entry.bib_guess != null ? `#${entry.bib_guess}?` : '#?';

  const statusBadge = (() => {
    switch (entry.status) {
      case 'started':
        return <span className="text-emerald-400">✓ start</span>;
      case 'dns':
        return <span className="text-rose-400">✗ DNS</span>;
      case 'dnf':
        return <span className="text-amber-400">⚠ DNF</span>;
      case 'pending':
        return <span className="text-slate-400">○ čeká</span>;
      default:
        return <span className="text-slate-500">{entry.status}</span>;
    }
  })();

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-slate-800/50 rounded-xl p-2 text-sm">
      <span className="text-slate-500 w-6 text-right shrink-0">{entry.order_index + 1}.</span>
      <span className="font-mono tabular text-cyan-400 shrink-0">
        {entry.scheduled_start ? formatClock(new Date(entry.scheduled_start)) : '—'}
      </span>
      <span className="font-mono font-bold shrink-0">{bib}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="shrink-0">{statusBadge}</span>
      <div className="flex items-center gap-1 ml-auto shrink-0">
        <button
          onClick={() => moveStartEntry(entry.id, 'up')}
          disabled={isFirst || entry.status !== 'pending'}
          className="px-1.5 py-0.5 text-slate-400 hover:text-white disabled:opacity-25"
          aria-label="Posun nahoru"
        >↑</button>
        <button
          onClick={() => moveStartEntry(entry.id, 'down')}
          disabled={isLast || entry.status !== 'pending'}
          className="px-1.5 py-0.5 text-slate-400 hover:text-white disabled:opacity-25"
          aria-label="Posun dolů"
        >↓</button>
        {entry.status !== 'dns' ? (
          <button
            onClick={() => updateStartEntry(entry.id, { status: 'dns', actual_start: null })}
            className="px-2 py-0.5 text-rose-400 hover:text-rose-300 text-xs"
          >DNS</button>
        ) : (
          <button
            onClick={() => updateStartEntry(entry.id, { status: 'pending' })}
            className="px-2 py-0.5 text-slate-400 hover:text-white text-xs"
          >obnov</button>
        )}
        {entry.status === 'started' && (
          <button
            onClick={() => updateStartEntry(entry.id, { status: 'dnf' })}
            className="px-2 py-0.5 text-amber-400 hover:text-amber-300 text-xs"
          >DNF</button>
        )}
        <button
          onClick={() => { if (confirm('Odebrat ze startovky? Pořadí se posune.')) unenrollStartEntry(entry.id); }}
          className="px-2 py-0.5 text-slate-500 hover:text-rose-400 text-xs"
          aria-label="Odebrat ze startovky"
        >✕</button>
      </div>
    </li>
  );
}

function EnrollSection({
  stage,
  availableRacers,
  allRacers,
  eventId,
}: {
  stage: Stage;
  availableRacers: Racer[];
  allRacers: Racer[];
  eventId: string;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [newBib, setNewBib] = useState('');
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [bibTouched, setBibTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !stage.first_start_at;

  const nextFreeBib = useMemo(() => {
    const used = new Set(allRacers.map(r => r.bib_number));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }, [allRacers]);

  // Auto-předvyplnění: dokud uživatel do políčka nesahne, drž tam další volné číslo.
  useEffect(() => {
    if (!bibTouched) setNewBib(String(nextFreeBib));
  }, [nextFreeBib, bibTouched]);

  async function addOne() {
    if (!selectedId) return;
    await enrollInStage({ stage_id: stage.id, racer_id: selectedId });
    setSelectedId('');
  }

  async function addAll() {
    if (!confirm(`Přidat všechny závodníky (${availableRacers.length}) do startovky?`)) return;
    await generateStartovka(stage.id);
  }

  async function createAndEnroll() {
    setError(null);
    const trimmed = newBib.trim();
    const num = trimmed === '' ? nextFreeBib : Number(trimmed);
    if (!Number.isInteger(num) || num < 1) {
      setError('Neplatné startovní číslo.');
      return;
    }
    if (allRacers.some(r => r.bib_number === num)) {
      setError(`Číslo #${num} už existuje v závodnících — použij dropdown nahoře.`);
      return;
    }
    const racer = await createRacer({
      event_id: eventId,
      bib_number: num,
      first_name: newFirst.trim(),
      last_name: newLast.trim(),
      category: newCategory.trim(),
    });
    await enrollInStage({ stage_id: stage.id, racer_id: racer.id });
    // Reset + další volné číslo se nastaví samo přes useEffect (bibTouched=false)
    setNewBib('');
    setBibTouched(false);
    setNewFirst('');
    setNewLast('');
    setNewCategory('');
  }

  return (
    <section className="bg-slate-800/50 rounded-2xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">Přidat do startovky</h2>
      {disabled && (
        <p className="text-sm text-amber-400">Nejdřív nastav první start nahoře.</p>
      )}

      {/* Z existujících závodníků */}
      {availableRacers.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm uppercase text-slate-400">Z existujících závodníků</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              disabled={disabled}
              className="flex-1 min-w-[15rem] bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"
            >
              <option value="">— vyber závodníka —</option>
              {availableRacers.map(r => (
                <option key={r.id} value={r.id}>
                  #{r.bib_number} {r.first_name} {r.last_name}{r.category ? ` (${r.category})` : ''}
                </option>
              ))}
            </select>
            <BigButton variant="primary" onClick={addOne} disabled={disabled || !selectedId} className="text-base py-2 px-4">
              + Přidat jednoho
            </BigButton>
            <BigButton variant="neutral" onClick={addAll} disabled={disabled} className="text-base py-2 px-4">
              + Přidat všechny ({availableRacers.length})
            </BigButton>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Všichni existující závodníci už jsou ve startovce (nebo mají DNS).</p>
      )}

      {/* Nový závodník */}
      <div className="space-y-2 border-t border-slate-700 pt-4">
        <h3 className="text-sm uppercase text-slate-400">Nový závodník (není v seznamu)</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <label className="block">
            <span className="text-xs text-slate-400">Číslo (auto: {nextFreeBib})</span>
            <input
              inputMode="numeric"
              pattern="\d*"
              value={newBib}
              onChange={e => { setNewBib(e.target.value.replace(/\D/g, '')); setBibTouched(true); }}
              onFocus={e => e.target.select()}
              placeholder={String(nextFreeBib)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xl font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Jméno</span>
            <input
              value={newFirst}
              onChange={e => setNewFirst(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Příjmení</span>
            <input
              value={newLast}
              onChange={e => setNewLast(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Kategorie</span>
            <input
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"
            />
          </label>
          <BigButton
            variant="success"
            onClick={createAndEnroll}
            disabled={disabled}
            className="text-base py-2 px-4"
          >
            + Vytvořit a zařadit
          </BigButton>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <p className="text-xs text-slate-500">
          Závodník se uloží i do seznamu v „Závodníci", takže ho najdeš i pro další úseky.
        </p>
      </div>
    </section>
  );
}

function QuickStart({ stage, racers }: { stage: Stage; racers: Racer[] }) {
  const [bib, setBib] = useState('');
  const racersByBib = useMemo(() => {
    const m = new Map<number, Racer>();
    racers.forEach(r => m.set(r.bib_number, r));
    return m;
  }, [racers]);

  async function submit() {
    const num = Number(bib.trim());
    if (!Number.isInteger(num) || num < 1) return;
    const racer = racersByBib.get(num) ?? null;
    await quickStart({
      stage_id: stage.id,
      racer_id: racer?.id ?? null,
      bib_guess: racer ? null : num,
    });
    setBib('');
  }

  return (
    <details className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700">
      <summary className="cursor-pointer font-semibold text-slate-300">
        Nouzový start (mimo plán)
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-slate-500">
          Okamžitý start na aktuální čas (actual_start = teď). Použij jen když závodník startuje mimo plán
          (např. předjížděl se nebo přijel pozdě).
        </p>
        <div className="flex gap-2 items-center">
          <input
            inputMode="numeric"
            pattern="\d*"
            value={bib}
            onChange={e => setBib(e.target.value.replace(/\D/g, ''))}
            placeholder="startovní číslo"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xl font-mono"
          />
          <BigButton variant="danger" onClick={submit} className="text-base py-2 px-4">
            Odstartuj teď
          </BigButton>
        </div>
      </div>
    </details>
  );
}
