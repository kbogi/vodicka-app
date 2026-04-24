import { db } from '@/db/schema';
import type { OutboxItem } from '@/db/models';
import { SYNC_TABLES, supabase, supabaseConfigured, type SyncTable } from './supabase';
import { applyRemoteRow } from './applyRemote';

export type SyncState =
  | 'disabled'
  | 'idle'
  | 'bootstrapping'
  | 'syncing'
  | 'online'
  | 'offline'
  | 'error';

export interface SyncStatus {
  state: SyncState;
  queue: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

type Listener = (s: SyncStatus) => void;

class SyncEngine {
  private status: SyncStatus = {
    state: supabaseConfigured ? 'idle' : 'disabled',
    queue: 0,
    lastError: null,
    lastSyncedAt: null,
  };
  private listeners = new Set<Listener>();
  private pushTimer: number | null = null;
  private pullTimer: number | null = null;
  private channels: ReturnType<NonNullable<typeof supabase>['channel']>[] = [];
  private started = false;
  private pushingNow = false;
  private pullingNow = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!supabaseConfigured || !supabase) {
      this.emit({ state: 'disabled' });
      return;
    }
    this.started = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);

    // Aktualizuj queue count pokud se mění outbox.
    // Dexie nemá nativní change subscription, takže jen pollujeme před každým pushem.

    if (!navigator.onLine) {
      this.emit({ state: 'offline' });
    } else {
      await this.bootstrap();
      this.startRealtime();
      this.schedulePush(500);
      this.schedulePull(10_000); // polling fallback když realtime nechodí
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.pushTimer) {
      window.clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.pullTimer) {
      window.clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }
    for (const ch of this.channels) supabase?.removeChannel(ch);
    this.channels = [];
  }

  private onOnline = async () => {
    this.emit({ state: 'syncing' });
    await this.bootstrap();
    this.startRealtime();
    this.schedulePush(500);
    this.schedulePull(10_000);
  };

  private onOffline = () => {
    this.emit({ state: 'offline' });
  };

  private async bootstrap(): Promise<void> {
    if (!supabase) return;
    this.emit({ state: 'bootstrapping', lastError: null });
    try {
      for (const table of SYNC_TABLES) {
        const { data, error } = await supabase.from(table).select('*');
        if (error) throw error;
        if (data) {
          for (const row of data) {
            await applyRemoteRow(table, row as never);
          }
        }
      }
      this.emit({ state: 'online', lastSyncedAt: new Date().toISOString() });
    } catch (e) {
      this.emit({ state: 'error', lastError: formatError(e) });
    }
  }

  private startRealtime(): void {
    if (!supabase) return;
    for (const ch of this.channels) supabase.removeChannel(ch);
    this.channels = [];

    for (const table of SYNC_TABLES) {
      const channel = supabase
        .channel(`db-${table}`)
        .on(
          'postgres_changes' as never,
          { event: '*', schema: 'public', table },
          async (payload: { new?: unknown; eventType: string }) => {
            const row = payload.new as never;
            if (row && typeof row === 'object') {
              await applyRemoteRow(table, row);
              this.emit({ lastSyncedAt: new Date().toISOString() });
            }
          },
        )
        .subscribe();
      this.channels.push(channel);
    }
  }

  private schedulePush(delayMs: number): void {
    if (this.pushTimer) window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => this.pushNow(), delayMs);
  }

  private schedulePull(delayMs: number): void {
    if (this.pullTimer) window.clearTimeout(this.pullTimer);
    this.pullTimer = window.setTimeout(() => this.pullNow(), delayMs);
  }

  async pullNow(): Promise<void> {
    if (!supabase || this.pullingNow) return;
    if (!navigator.onLine) {
      this.schedulePull(15_000);
      return;
    }
    this.pullingNow = true;
    try {
      for (const table of SYNC_TABLES) {
        const { data, error } = await supabase.from(table).select('*');
        if (error) throw error;
        if (data) {
          for (const row of data) {
            await applyRemoteRow(table, row as never);
          }
        }
      }
      this.emit({ lastSyncedAt: new Date().toISOString() });
    } catch (e) {
      this.emit({ state: 'error', lastError: formatError(e) });
    } finally {
      this.pullingNow = false;
      this.schedulePull(10_000);
    }
  }

  async pushNow(): Promise<void> {
    if (!supabase || this.pushingNow) return;
    if (!navigator.onLine) {
      this.emit({ state: 'offline' });
      this.schedulePush(5_000);
      return;
    }
    this.pushingNow = true;
    try {
      const queue = await db.outbox.orderBy('created_at').toArray();
      this.emit({ queue: queue.length });
      if (queue.length === 0) {
        this.emit({ state: 'online' });
      } else {
        this.emit({ state: 'syncing' });
        await this.drainQueue(queue);
        const remaining = await db.outbox.count();
        this.emit({
          queue: remaining,
          state: remaining === 0 ? 'online' : 'syncing',
          lastSyncedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      this.emit({ state: 'error', lastError: formatError(e) });
    } finally {
      this.pushingNow = false;
      // Nový tik: rychlejší cyklus pokud něco zbývá, pomalejší keep-alive jinak.
      const remaining = await db.outbox.count();
      this.schedulePush(remaining > 0 ? 1_500 : 10_000);
    }
  }

  private async drainQueue(items: OutboxItem[]): Promise<void> {
    if (!supabase) return;

    // Per (table, record_id) si necháme jen nejnovější payload (items přicházejí
    // seřazené podle created_at, takže pozdější přepíše dřívější). Všechny outbox
    // id pro daný záznam si pamatujeme v mapě, ať je po úspěchu smažeme všechny.
    // Bez toho by Supabase upsert selhal s "ON CONFLICT DO UPDATE command cannot
    // affect row a second time", pokud ve frontě jsou dvě mutace stejného záznamu.
    const latestByRecord = new Map<string, OutboxItem>();
    const outboxIdsByRecord = new Map<string, string[]>();
    for (const it of items) {
      const key = `${it.table}:${it.record_id}`;
      latestByRecord.set(key, it);
      const arr = outboxIdsByRecord.get(key) ?? [];
      arr.push(it.id);
      outboxIdsByRecord.set(key, arr);
    }

    // Seskupit nejnovější záznamy per tabulka. Op neřešíme — i soft-delete je upsert.
    const groups = new Map<SyncTable, OutboxItem[]>();
    for (const it of latestByRecord.values()) {
      const table = it.table as SyncTable;
      const arr = groups.get(table) ?? [];
      arr.push(it);
      groups.set(table, arr);
    }

    for (const [table, batch] of groups) {
      const payloads = batch.map(b => b.payload);
      console.log(`[sync] push ${table} ×${batch.length}`);
      const { error } = await supabase.from(table).upsert(payloads as never, { onConflict: 'id' });
      if (error) {
        console.error(`[sync] push ${table} selhal:`, error.message, error.details, error.hint, payloads);
        for (const it of batch) {
          const ids = outboxIdsByRecord.get(`${it.table}:${it.record_id}`) ?? [];
          for (const outboxId of ids) {
            const existing = await db.outbox.get(outboxId);
            if (existing) {
              await db.outbox.update(outboxId, {
                attempts: (existing.attempts ?? 0) + 1,
                last_error: error.message,
              });
            }
          }
        }
        throw error;
      }
      const idsToDelete: string[] = [];
      for (const it of batch) {
        idsToDelete.push(...(outboxIdsByRecord.get(`${it.table}:${it.record_id}`) ?? []));
      }
      await db.outbox.bulkDelete(idsToDelete);
    }
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const syncEngine = new SyncEngine();
