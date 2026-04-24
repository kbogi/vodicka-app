import { useEffect, useState } from 'react';
import { syncEngine, type SyncStatus } from '@/sync/engine';

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => syncEngine.getStatus());
  useEffect(() => syncEngine.subscribe(setStatus), []);
  return status;
}
