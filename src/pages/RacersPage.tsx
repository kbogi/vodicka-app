import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { createRacer, deleteRacer, mergeRacers, updateRacer } from '@/db/repo';
import { useSession } from '@/store/session';
import { BigButton } from '@/components/BigButton';
import type { Racer } from '@/db/models';

export function RacersPage() {
  const { eventId } = useSession();
  const racers = useLiveQuery(
    () => eventId
      ? db.racers.where('event_id').equals(eventId).and(r => !r.deleted_at).toArray()
      : Promise.resolve([] as Racer[]),
    [eventId],
    [] as Racer[],
  );

  const sorted = useMemo(
    () => [...(racers ?? [])].sort((a, b) => a.bib_number - b.bib_number),
    [racers],
  );

  // Seskupit podle bib_number — více než jeden záznam = konflikt.
  const duplicateGroups = useMemo(() => {
    const groups = new Map<number, Racer[]>();
    for (const r of sorted) {
      const arr = groups.get(r.bib_number) ?? [];
      arr.push(r);
      groups.set(r.bib_number, arr);
    }
    return [...groups.values()].filter(g => g.length > 1);
  }, [sorted]);

  const [editing, setEditing] = useState<Racer | null>(null);
  const [showForm, setShowForm] = useState(false);

  if (!eventId) {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <p className="text-slate-400">Nejdříve vyber nebo vytvoř závod na stránce „Domů".</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Závodníci ({sorted.length})</h1>
        <BigButton onClick={() => { setEditing(null); setShowForm(true); }} className="text-base py-2 px-4">
          + Přidat
        </BigButton>
      </div>

      {duplicateGroups.length > 0 && (
        <section className="bg-rose-950/30 border border-rose-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold text-rose-300">⚠ Konflikty čísel</h2>
          <p className="text-sm text-rose-200/80">
            Stejné startovní číslo má víc závodníků. Typicky se to stane, když dvě zařízení přidají závodníka
            se stejným bibem offline. Zachovej jednu verzi — jeho starty / cíle převezmou, ostatní se smažou.
            Nebo jedné z verzí změň číslo přes „upravit".
          </p>
          {duplicateGroups.map(group => (
            <DuplicateGroup key={group[0].bib_number} group={group} onEdit={r => { setEditing(r); setShowForm(true); }} />
          ))}
        </section>
      )}

      {sorted.length === 0 ? (
        <p className="text-slate-500">Zatím žádní závodníci.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Jméno</th>
                <th className="py-2 pr-2">Kategorie</th>
                <th className="py-2 pr-2">Klub</th>
                <th className="py-2 pr-2">DNS</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="py-2 pr-2 font-mono font-bold">{r.bib_number}</td>
                  <td className="py-2 pr-2">{r.first_name} {r.last_name}</td>
                  <td className="py-2 pr-2 text-slate-400">{r.category}</td>
                  <td className="py-2 pr-2 text-slate-400">{r.club}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={r.dns}
                      onChange={e => updateRacer(r.id, { dns: e.target.checked })}
                      aria-label="DNS"
                    />
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      onClick={() => { setEditing(r); setShowForm(true); }}
                      className="px-2 py-1 text-cyan-400 hover:text-cyan-300"
                    >
                      upravit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Smazat závodníka #${r.bib_number}?`)) deleteRacer(r.id);
                      }}
                      className="px-2 py-1 text-slate-500 hover:text-rose-400"
                    >
                      smazat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <RacerForm
          eventId={eventId}
          racer={editing}
          existingBibs={sorted.map(r => r.bib_number).filter(b => b !== editing?.bib_number)}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

interface FormProps {
  eventId: string;
  racer: Racer | null;
  existingBibs: number[];
  onClose: () => void;
}

function RacerForm({ eventId, racer, existingBibs, onClose }: FormProps) {
  const nextFreeBib = useMemo(() => {
    const used = new Set(existingBibs);
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }, [existingBibs]);
  const [bib, setBib] = useState<number | ''>(racer?.bib_number ?? nextFreeBib);
  const [firstName, setFirstName] = useState(racer?.first_name ?? '');
  const [lastName, setLastName] = useState(racer?.last_name ?? '');
  const [category, setCategory] = useState(racer?.category ?? '');
  const [club, setClub] = useState(racer?.club ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const num = bib === '' ? nextFreeBib : Number(bib);
    if (!Number.isInteger(num) || num < 1) { setError('Neplatné číslo'); return; }
    if (existingBibs.includes(num)) { setError('Číslo už existuje'); return; }
    if (!lastName.trim() && !firstName.trim()) { setError('Zadej jméno nebo příjmení'); return; }
    try {
      if (racer) {
        await updateRacer(racer.id, {
          bib_number: num,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          category: category.trim(),
          club: club.trim(),
        });
      } else {
        await createRacer({
          event_id: eventId,
          bib_number: num,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          category: category.trim(),
          club: club.trim(),
        });
      }
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl p-5 max-w-md w-full space-y-3 border border-slate-700" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{racer ? 'Upravit závodníka' : 'Nový závodník'}</h2>

        <label className="block">
          <span className="text-xs uppercase text-slate-400">
            Startovní číslo {!racer && <span className="normal-case text-slate-500">(auto: {nextFreeBib})</span>}
          </span>
          <input
            type="number"
            value={bib}
            onChange={e => setBib(e.target.value === '' ? '' : Number(e.target.value))}
            onFocus={e => e.target.select()}
            placeholder={String(nextFreeBib)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-lg font-mono"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs uppercase text-slate-400">Jméno</span>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-xs uppercase text-slate-400">Příjmení</span>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2" />
          </label>
        </div>
        <label className="block">
          <span className="text-xs uppercase text-slate-400">Kategorie</span>
          <input value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-slate-400">Klub</span>
          <input value={club} onChange={e => setClub(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2" />
        </label>

        {error && <p className="text-rose-400 text-sm">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">Zrušit</button>
          <BigButton onClick={submit} variant="success" className="text-base py-2 px-4">Uložit</BigButton>
        </div>
      </div>
    </div>
  );
}

function DuplicateGroup({
  group,
  onEdit,
}: {
  group: Racer[];
  onEdit: (r: Racer) => void;
}) {
  const [startCounts, setStartCounts] = useState<Record<string, number>>({});
  const [finishCounts, setFinishCounts] = useState<Record<string, number>>({});

  // Spočítat odkazující záznamy, aby uživatel věděl, kolik se toho převezme při sloučení.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s: Record<string, number> = {};
      const f: Record<string, number> = {};
      for (const r of group) {
        s[r.id] = await db.start_entries.where('racer_id').equals(r.id).and(e => !e.deleted_at).count();
        f[r.id] = await db.finish_entries.where('racer_id').equals(r.id).and(e => !e.deleted_at).count();
      }
      if (!cancelled) {
        setStartCounts(s);
        setFinishCounts(f);
      }
    })();
    return () => { cancelled = true; };
  }, [group]);

  async function keep(keepId: string) {
    const discardIds = group.filter(r => r.id !== keepId).map(r => r.id);
    const discardLabels = group
      .filter(r => r.id !== keepId)
      .map(r => `${r.first_name} ${r.last_name}`.trim() || '(bez jména)');
    if (!confirm(
      `Zachovat tuto verzi a ostatní (${discardLabels.join(', ')}) smazat?\n` +
      `Jejich starty a cíle se převezmou na zachovanou verzi.`
    )) return;
    await mergeRacers(keepId, discardIds);
  }

  return (
    <div className="bg-slate-800/60 rounded-xl p-3 space-y-2">
      <div className="text-sm font-semibold text-rose-200">
        #{group[0].bib_number} · {group.length} verzí
      </div>
      <ul className="space-y-1">
        {group.map(r => {
          const name = `${r.first_name} ${r.last_name}`.trim() || '(bez jména)';
          const s = startCounts[r.id] ?? 0;
          const f = finishCounts[r.id] ?? 0;
          return (
            <li key={r.id} className="flex items-center gap-2 bg-slate-900/60 rounded-lg p-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate"><b>{name}</b>{r.category && <span className="text-slate-400"> · {r.category}</span>}{r.club && <span className="text-slate-400"> · {r.club}</span>}</div>
                <div className="text-xs text-slate-500">
                  vytvořen {new Date(r.created_at).toLocaleString()}
                  {(s > 0 || f > 0) && <span> · starty: {s} · cíle: {f}</span>}
                </div>
              </div>
              <button
                onClick={() => keep(r.id)}
                className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded whitespace-nowrap"
              >
                zachovat
              </button>
              <button
                onClick={() => onEdit(r)}
                className="text-xs text-cyan-400 hover:text-cyan-300 px-2"
              >
                přejmenovat
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
