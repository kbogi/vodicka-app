import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { createEvent, createStage, deleteEvent } from '@/db/repo';
import { useSession } from '@/store/session';
import { BigButton } from '@/components/BigButton';
import dayjs from 'dayjs';
import type { Event, Stage } from '@/db/models';

export function HomePage() {
  const { eventId, stageId, setEvent, setStage } = useSession();

  const events = useLiveQuery(
    () => db.events.filter(e => !e.deleted_at).toArray(),
    [],
    [] as Event[],
  );
  const stages = useLiveQuery(
    () => eventId ? db.stages.where('event_id').equals(eventId).and(s => !s.deleted_at).sortBy('order_index') : Promise.resolve([] as Stage[]),
    [eventId],
    [] as Stage[],
  );

  const [newEventName, setNewEventName] = useState('');
  const [newEventDate, setNewEventDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [newStageName, setNewStageName] = useState('');
  const [newStageInterval, setNewStageInterval] = useState(30);

  async function handleCreateEvent() {
    if (!newEventName.trim()) return;
    const e = await createEvent({ name: newEventName.trim(), date: newEventDate });
    setEvent(e.id);
    setNewEventName('');
  }

  async function handleCreateStage() {
    if (!eventId || !newStageName.trim()) return;
    const order = (stages?.length ?? 0) + 1;
    await createStage({
      event_id: eventId,
      name: newStageName.trim(),
      order_index: order,
      default_interval_seconds: newStageInterval,
    });
    setNewStageName('');
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Vodičská časomíra</h1>
        <p className="text-slate-400">Časomíra pro enduro MTB</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Závod (event)</h2>
        {events && events.length > 0 ? (
          <ul className="space-y-2">
            {events.map(e => (
              <li
                key={e.id}
                className={`flex items-center gap-2 p-3 rounded-xl border ${eventId === e.id ? 'border-cyan-500 bg-slate-800' : 'border-slate-700'}`}
              >
                <button className="flex-1 text-left" onClick={() => setEvent(e.id)}>
                  <div className="font-semibold">{e.name}</div>
                  <div className="text-sm text-slate-400">{e.date}</div>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Smazat závod „${e.name}"?`)) {
                      deleteEvent(e.id);
                      if (eventId === e.id) setEvent(null);
                    }
                  }}
                  className="text-slate-500 hover:text-rose-400 px-2"
                  aria-label="Smazat"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500 text-sm">Zatím žádný závod.</p>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newEventName}
            onChange={e => setNewEventName(e.target.value)}
            placeholder="Název nového závodu"
            className="flex-1 min-w-[12rem] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"
          />
          <input
            type="date"
            value={newEventDate}
            onChange={e => setNewEventDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"
          />
          <BigButton onClick={handleCreateEvent} className="text-base py-2 px-4">
            + Přidat
          </BigButton>
        </div>
      </section>

      {eventId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Úseky (stages)</h2>
          {stages && stages.length > 0 ? (
            <ul className="space-y-2">
              {stages.map(s => (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 p-3 rounded-xl border ${stageId === s.id ? 'border-cyan-500 bg-slate-800' : 'border-slate-700'}`}
                >
                  <button className="flex-1 text-left" onClick={() => setStage(s.id)}>
                    <div className="font-semibold">#{s.order_index} — {s.name}</div>
                    <div className="text-sm text-slate-400">interval {s.default_interval_seconds} s</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500 text-sm">Zatím žádný úsek.</p>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={newStageName}
              onChange={e => setNewStageName(e.target.value)}
              placeholder="Název úseku (např. SS1)"
              className="flex-1 min-w-[10rem] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"
            />
            <input
              type="number"
              min={5}
              max={600}
              value={newStageInterval}
              onChange={e => setNewStageInterval(Number(e.target.value) || 30)}
              className="w-24 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"
              aria-label="Interval startu v sekundách"
            />
            <BigButton onClick={handleCreateStage} className="text-base py-2 px-4">
              + Přidat úsek
            </BigButton>
          </div>
        </section>
      )}

      <section className="text-sm text-slate-500 pt-6 border-t border-slate-800">
        <p>Data se ukládají lokálně v prohlížeči (IndexedDB) a po připojení k internetu se synchronizují s cloudem.</p>
      </section>
    </div>
  );
}
