import { NavLink } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useOnline } from '@/hooks/useOnline';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { syncEngine } from '@/sync/engine';

const linkCls =
  'min-w-0 px-2 py-2 rounded-xl text-xs md:text-sm font-semibold text-center flex-1 truncate ' +
  'text-slate-300 hover:bg-slate-800';
const activeCls = 'bg-slate-700 text-white';

export function Nav() {
  const online = useOnline();
  const queueCount = useLiveQuery(() => db.outbox.count(), [], 0);
  const sync = useSyncStatus();

  const syncLabel = (() => {
    switch (sync.state) {
      case 'disabled':      return { text: 'sync vypnutý', cls: 'text-slate-500' };
      case 'offline':       return { text: '● offline', cls: 'text-amber-400' };
      case 'bootstrapping': return { text: 'stahování…', cls: 'text-cyan-400' };
      case 'syncing':       return { text: 'sync…', cls: 'text-cyan-400' };
      case 'online':        return { text: '● synced', cls: 'text-emerald-400' };
      case 'error':         return { text: '● chyba sync', cls: 'text-rose-400' };
      case 'idle':
      default:              return { text: online ? '● online' : '● offline', cls: online ? 'text-emerald-400' : 'text-amber-400' };
    }
  })();

  return (
    <nav className="bg-slate-900 border-t border-slate-800 sticky bottom-0">
      <button
        onClick={() => syncEngine.pushNow()}
        title={sync.lastError ?? (sync.lastSyncedAt ? `Poslední sync ${new Date(sync.lastSyncedAt).toLocaleTimeString()}` : '')}
        className="w-full text-[11px] font-medium px-3 py-1 flex items-center justify-end gap-1 hover:bg-slate-800/60 border-b border-slate-800"
      >
        <span className={syncLabel.cls}>{syncLabel.text}</span>
        {queueCount > 0 && <span className="text-slate-400">· {queueCount} ve frontě</span>}
      </button>
      <div className="flex gap-1 p-2">
        <NavLink to="/" end className={({ isActive }) => `${linkCls} ${isActive ? activeCls : ''}`}>
          Domů
        </NavLink>
        <NavLink to="/racers" className={({ isActive }) => `${linkCls} ${isActive ? activeCls : ''}`}>
          Závodníci
        </NavLink>
        <NavLink to="/start" className={({ isActive }) => `${linkCls} ${isActive ? activeCls : ''}`}>
          Start
        </NavLink>
        <NavLink to="/finish" className={({ isActive }) => `${linkCls} ${isActive ? activeCls : ''}`}>
          Cíl
        </NavLink>
        <NavLink to="/results" className={({ isActive }) => `${linkCls} ${isActive ? activeCls : ''}`}>
          Výsledky
        </NavLink>
      </div>
    </nav>
  );
}
