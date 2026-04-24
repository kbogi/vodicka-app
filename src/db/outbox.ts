import { db } from './schema';
import type { OutboxItem, OutboxOp, OutboxTable } from './models';
import { newId, nowIso } from '@/utils/uuid';

export async function enqueueOutbox(
  table: OutboxTable,
  op: OutboxOp,
  record_id: string,
  payload: unknown,
): Promise<void> {
  const item: OutboxItem = {
    id: newId(),
    table,
    op,
    record_id,
    payload,
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
  };
  await db.outbox.add(item);
}
