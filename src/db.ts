import Dexie, { type EntityTable } from 'dexie';
import type { Conflict, OutboxItem, Project, TimeBreak, TimeEntry, UserSettings } from './types';
export interface MetaRecord {
  key: string;
  value: unknown;
}
export class ZeitstempelDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  timeEntries!: EntityTable<TimeEntry, 'id'>;
  timeBreaks!: EntityTable<TimeBreak, 'id'>;
  settings!: EntityTable<UserSettings, 'user_id'>;
  outbox!: EntityTable<OutboxItem, 'id'>;
  conflicts!: EntityTable<Conflict, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;
  constructor(name = 'zeitstempel-v2') {
    super(name);
    this.version(1).stores({
      projects: 'id,user_id,[user_id+is_archived],updated_at',
      timeEntries: 'id,user_id,work_date,[user_id+work_date],project_id,ended_at,updated_at',
      timeBreaks: 'id,user_id,time_entry_id,ended_at,updated_at',
      settings: 'user_id',
      outbox: 'id,userId,table,recordId,createdAt',
      conflicts: 'id,userId,recordId,resolvedAt',
      meta: 'key',
    });
    this.version(2).stores({ outbox: 'id,userId,table,recordId,[table+recordId],createdAt' });
  }
}
export const db = new ZeitstempelDB();
export async function persistStorage() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
