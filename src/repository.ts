import { db } from './db';
import type { OutboxItem, Project, SyncTable, TimeBreak, TimeEntry, UserSettings } from './types';
type LocalRecord = Project | TimeEntry | TimeBreak | UserSettings;
const tableMap = {
  projects: db.projects,
  time_entries: db.timeEntries,
  time_breaks: db.timeBreaks,
  user_settings: db.settings,
};
function recordId(table: SyncTable, value: LocalRecord) {
  return table === 'user_settings'
    ? (value as UserSettings).user_id
    : (value as Project | TimeEntry | TimeBreak).id;
}
export async function saveLocal<T extends LocalRecord>(
  table: SyncTable,
  value: T,
  enqueue = true,
): Promise<T> {
  const id = recordId(table, value);
  const userId = 'user_id' in value ? value.user_id : '';
  const outbox: OutboxItem = {
    id: crypto.randomUUID(),
    userId,
    table,
    recordId: id,
    operation: 'upsert',
    payload: value as unknown as Record<string, unknown>,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  await db.transaction('rw', [tableMap[table], db.outbox], async () => {
    await (tableMap[table] as any).put(value);
    if (enqueue) {
      await db.outbox.where({ table, recordId: id }).delete();
      await db.outbox.add(outbox);
    }
  });
  return value;
}
export async function softDelete(table: 'projects' | 'time_entries' | 'time_breaks', id: string) {
  const localTable = tableMap[table] as any;
  const item = await localTable.get(id);
  if (!item) return;
  return saveLocal(table, {
    ...item,
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
export async function restore(table: 'projects' | 'time_entries' | 'time_breaks', id: string) {
  const localTable = tableMap[table] as any;
  const item = await localTable.get(id);
  if (!item) return;
  return saveLocal(table, { ...item, deleted_at: null, updated_at: new Date().toISOString() });
}
export function freshBase(userId: string) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    revision: 0,
  };
}
export async function resolveConflict(id: string, choice: 'local' | 'remote') {
  const conflict = await db.conflicts.get(id);
  if (!conflict) return;
  const table = tableMap[conflict.table] as any;
  if (choice === 'remote') await table.put(conflict.remote);
  else
    await saveLocal(conflict.table, {
      ...conflict.local,
      revision: Number(conflict.remote.revision ?? 0),
      updated_at: new Date().toISOString(),
    } as LocalRecord);
  await db.conflicts.update(id, { resolvedAt: new Date().toISOString() });
}
