import { newId } from '@/utils/uuid';

const STORAGE_KEY = 'vodicka.device_id';

let cached: string | null = null;

export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const id = newId();
    localStorage.setItem(STORAGE_KEY, id);
    cached = id;
    return id;
  } catch {
    const id = newId();
    cached = id;
    return id;
  }
}
