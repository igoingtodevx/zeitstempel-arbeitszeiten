import { api } from '../convex/_generated/api';
import { convex } from './convex';
import { db } from './db';
import { hasUnresolvedConflict } from './repository';
import type { Conflict, OutboxItem, SyncState, SyncTable } from './types';

const localTables = {
  projects: db.projects,
  time_entries: db.timeEntries,
  time_breaks: db.timeBreaks,
  user_settings: db.settings,
};
const running = new Map<string, Promise<void>>();

type RemoteData = Awaited<ReturnType<typeof convex.query<typeof api.records.list>>>;

type RemoteRecord = Record<string, unknown>;

function remoteRecords(remote: RemoteData, table: SyncTable): RemoteRecord[] {
  if (table === 'projects') return remote.projects as RemoteRecord[];
  if (table === 'time_entries') return remote.entries as RemoteRecord[];
  if (table === 'time_breaks') return remote.breaks as RemoteRecord[];
  return remote.settings ? [remote.settings as RemoteRecord] : [];
}

function remoteId(table: SyncTable, record: RemoteRecord) {
  return table === 'user_settings' ? String(record.user_id) : String(record.id);
}

function sameSyncedData(local: RemoteRecord, remote: RemoteRecord) {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  keys.delete('revision');
  keys.delete('updated_at');
  for (const key of keys) {
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) return false;
  }
  return true;
}

async function storeConflict(userId: string, job: OutboxItem, remote: RemoteRecord) {
  if (await hasUnresolvedConflict(userId, job.table, job.recordId)) {
    await db.outbox.delete(job.id);
    return;
  }
  const conflict: Conflict = {
    id: crypto.randomUUID(),
    userId,
    table: job.table,
    recordId: job.recordId,
    local: job.payload,
    remote,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  await db.transaction('rw', [db.conflicts, db.outbox], async () => {
    await db.conflicts.add(conflict);
    await db.outbox.delete(job.id);
  });
}

async function acceptAlreadySynced(job: OutboxItem, remote: RemoteRecord) {
  await db.transaction('rw', [localTables[job.table], db.outbox], async () => {
    await (localTables[job.table] as any).put(remote);
    await db.outbox.delete(job.id);
  });
}

async function freshRemoteRecord(table: SyncTable, recordId: string) {
  const remote = await convex.query(api.records.list, {});
  return remoteRecords(remote, table).find((record) => remoteId(table, record) === recordId);
}

export async function syncNow(userId: string, onState?: (s: SyncState) => void) {
  const existingRun = running.get(userId);
  if (existingRun) return existingRun;
  if (!navigator.onLine) {
    onState?.('pending');
    return;
  }

  const task = (async () => {
    onState?.('syncing');
    try {
      const remote = await convex.query(api.records.list, {});
      const jobs = await db.outbox.where('userId').equals(userId).sortBy('createdAt');
      for (const job of jobs) {
        const current = remoteRecords(remote, job.table).find(
          (record) => remoteId(job.table, record) === job.recordId,
        );
        const localRevision = Number(job.payload.revision ?? 0);
        if (current && Number(current.revision) > localRevision) {
          if (sameSyncedData(job.payload, current)) await acceptAlreadySynced(job, current);
          else await storeConflict(userId, job, current);
          continue;
        }

        try {
          const saved = (await convex.mutation(api.records.upsert, {
            table: job.table,
            payload: job.payload,
            expectedRevision: localRevision,
          })) as RemoteRecord;
          await db.transaction('rw', [localTables[job.table], db.outbox], async () => {
            await (localTables[job.table] as any).put(saved);
            await db.outbox.delete(job.id);
          });
        } catch (error) {
          // The remote may have changed after the initial list query. Re-read once
          // and turn a CAS race into an explicit conflict instead of retrying LWW.
          const latest = await freshRemoteRecord(job.table, job.recordId);
          if (latest && Number(latest.revision) > localRevision) {
            if (sameSyncedData(job.payload, latest)) await acceptAlreadySynced(job, latest);
            else await storeConflict(userId, job, latest);
            continue;
          }
          throw error;
        }
      }
      const unresolved = await db.conflicts
        .where('userId')
        .equals(userId)
        .filter((conflict) => !conflict.resolvedAt)
        .count();
      onState?.(unresolved ? 'error' : 'synced');
    } catch (error) {
      for (const job of await db.outbox.where('userId').equals(userId).toArray()) {
        await db.outbox.update(job.id, {
          attempts: job.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Synchronisierung fehlgeschlagen',
        });
      }
      onState?.('error');
    }
  })();
  running.set(userId, task);
  try {
    await task;
  } finally {
    if (running.get(userId) === task) running.delete(userId);
  }
}

export async function pullRemote(userId: string) {
  if (!navigator.onLine) return;
  const remote = await convex.query(api.records.list, {});
  for (const name of Object.keys(localTables) as SyncTable[]) {
    for (const value of remoteRecords(remote, name)) {
      const id = remoteId(name, value);
      const local = (await (localTables[name] as any).get(id)) as RemoteRecord | undefined;
      const pending = await db.outbox
        .where({ table: name, recordId: id })
        .filter((job) => job.userId === userId)
        .first();
      if (pending) {
        if (sameSyncedData(pending.payload, value)) await acceptAlreadySynced(pending, value);
        else if (Number(value.revision) > Number(local?.revision ?? pending.payload.revision ?? 0))
          await storeConflict(userId, pending, value);
        continue;
      }
      if (!local || Number(value.revision) > Number(local.revision)) {
        await (localTables[name] as any).put(value);
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
