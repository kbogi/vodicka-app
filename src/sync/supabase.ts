import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// Při špatném signálu (online, ale skoro nic neteče) visí fetch bez timeoutu
// i minuty a blokuje sync frontu. Radši rychle selhat — engine to za chvíli
// zkusí znovu.
const FETCH_TIMEOUT_MS = 8_000;

const fetchWithTimeout: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = init.signal
    ? typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, timeout])
      : init.signal
    : timeout;
  return fetch(input, { ...init, signal });
};

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
      global: {
        fetch: fetchWithTimeout,
      },
    })
  : null;

export const SYNC_TABLES = [
  'events',
  'stages',
  'racers',
  'start_entries',
  'finish_entries',
] as const;

export type SyncTable = typeof SYNC_TABLES[number];
