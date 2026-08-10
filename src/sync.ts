import { api } from '../convex/_generated/api';
import { convex } from './convex';
import { db } from './db';
import type { Conflict, SyncState, SyncTable } from './types';

const localTables = {
  projects: db.projects,
  time_entries: db.timeEntries,
  time_breaks: db.timeBreaks,
  user_settings: db.settings,
};
let running: Promise<void> | null = null;

type RemoteData = Awaited<ReturnType<typeof convex.query<typeof api.records.list>>>;

function remoteRecords(remote: RemoteData, table: SyncTable) {
  if (table === 'projects') return remote.projects;
  if (table === 'time_entries') return remote.entries;
  if (table === 'time_breaks') return remote.breaks;
  return remote.settings ? [remote.settings] : [];
}

function remoteId(table: SyncTable, record: Record<string, unknown>) {
  return table === 'user_settings' ? String(record.user_id) : String(record.id);
}

export async function syncNow(userId: string, onState?: (s: SyncState) => void) {
  if (running) return running;
  if (!navigator.onLine) {
    onState?.('pending');
    return;
  }
  running = (async () => {
    onState?.('syncing');
    try {
      const remote = await convex.query(api.records.list, {});
      const jobs = await db.outbox.where('userId').equals(userId).sortBy('createdAt');
      for (const job of jobs) {
        const current = remoteRecords(remote, job.table).find(
          (record) => remoteId(job.table, record as Record<string, unknown>) === job.recordId,
        ) as Record<string, unknown> | undefined;
        const localRevision = Number(job.payload.revision ?? 0);
        if (current && Number(current.revision) > localRevision) {
          const conflict: Conflict = {
            id: crypto.randomUUID(),
            userId,
            table: job.table,
            recordId: job.recordId,
            local: job.payload,
            remote: current,
            createdAt: new Date().toISOString(),
            resolvedAt: null,
          };
          await db.conflicts.add(conflict);
          await db.outbox.delete(job.id);
          continue;
        }
        const saved = (await convex.mutation(api.records.upsert, {
          table: job.table,
          payload: job.payload,
        })) as Record<string, unknown>;
        await db.transaction('rw', [localTables[job.table], db.outbox], async () => {
          await (localTables[job.table] as any).put(saved);
          await db.outbox.delete(job.id);
        });
      }
      onState?.((await db.conflicts.where('userId').equals(userId).count()) ? 'error' : 'synced');
    } catch (error) {
      for (const job of await db.outbox.where('userId').equals(userId).toArray()) {
        await db.outbox.update(job.id, {
          attempts: job.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Synchronisierung fehlgeschlagen',
        });
      }
      onState?.('error');
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function pullRemote(userId: string) {
  if (!navigator.onLine) return;
  const remote = await convex.query(api.records.list, {});
  for (const name of Object.keys(localTables) as SyncTable[]) {
    for (const value of remoteRecords(remote, name) as Record<string, unknown>[]) {
      const id = remoteId(name, value);
      const local = await (localTables[name] as any).get(id);
      if (!local || Number(value.revision) > Number(local.revision)) {
        const pending = await db.outbox.where({ table: name, recordId: id }).first();
        if (pending) {
          await db.conflicts.add({
            id: crypto.randomUUID(),
            userId,
            table: name,
            recordId: id,
            local: (local ?? pending.payload) as Record<string, unknown>,
            remote: value,
            createdAt: new Date().toISOString(),
            resolvedAt: null,
          });
        } else await (localTables[name] as any).put(value);
      }
    }
  }
}

export function installSyncTriggers(_userId: string, trigger: () => void) {
  const online = () => trigger();
  const page = () => trigger();
  const visible = () => {
    if (document.visibilityState === 'visible') trigger();
  };
  addEventListener('online', online);
  addEventListener('pageshow', page);
  document.addEventListener('visibilitychange', visible);
  return () => {
    removeEventListener('online', online);
    removeEventListener('pageshow', page);
    document.removeEventListener('visibilitychange', visible);
  };
}

export function installRealtime(userId: string, trigger: () => void) {
  const interval = window.setInterval(() => {
    if (navigator.onLine) void pullRemote(userId).then(trigger).catch(() => undefined);
  }, 30_000);
  return () => window.clearInterval(interval);
}
