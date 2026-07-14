import { db } from './db';
import { supabase } from './supabase';
import type { Conflict, SyncState, SyncTable } from './types';
const localTables = {
  projects: db.projects,
  time_entries: db.timeEntries,
  time_breaks: db.timeBreaks,
  user_settings: db.settings,
};
let running: Promise<void> | null = null;
export async function syncNow(userId: string, onState?: (s: SyncState) => void) {
  if (running) return running;
  if (!supabase || !navigator.onLine) {
    onState?.('pending');
    return;
  }
  running = (async () => {
    onState?.('syncing');
    try {
      const jobs = await db.outbox.where('userId').equals(userId).sortBy('createdAt');
      for (const job of jobs) {
        try {
          const idColumn = job.table === 'user_settings' ? 'user_id' : 'id';
          const { data: remote, error: readError } = await supabase
            .from(job.table)
            .select('*')
            .eq(idColumn, job.recordId)
            .maybeSingle();
          if (readError) throw readError;
          const localRevision = Number(job.payload.revision ?? 0);
          if (remote && Number(remote.revision) > localRevision) {
            const conflict: Conflict = {
              id: crypto.randomUUID(),
              userId,
              table: job.table,
              recordId: job.recordId,
              local: job.payload,
              remote: remote as Record<string, unknown>,
              createdAt: new Date().toISOString(),
              resolvedAt: null,
            };
            await db.conflicts.add(conflict);
            await db.outbox.delete(job.id);
            continue;
          }
          const mutable = { ...job.payload };
          delete mutable.revision;
          delete mutable.updated_at;
          delete mutable.created_at;
          const query = remote
            ? supabase
                .from(job.table)
                .update(mutable)
                .eq(idColumn, job.recordId)
                .eq('revision', localRevision)
                .select()
                .maybeSingle()
            : supabase.from(job.table).insert(job.payload).select().maybeSingle();
          const { data, error } = await query;
          if (error) throw error;
          if (!data) throw new Error('Konflikt: Datensatz wurde gleichzeitig geändert');
          await db.transaction('rw', [localTables[job.table], db.outbox], async () => {
            await (localTables[job.table] as any).put(data);
            await db.outbox.delete(job.id);
          });
        } catch (error) {
          await db.outbox.update(job.id, {
            attempts: job.attempts + 1,
            lastError: error instanceof Error ? error.message : 'Synchronisierung fehlgeschlagen',
          });
          throw error;
        }
      }
      onState?.((await db.conflicts.where('userId').equals(userId).count()) ? 'error' : 'synced');
    } catch {
      onState?.('error');
    } finally {
      running = null;
    }
  })();
  return running;
}
export async function pullRemote(userId: string) {
  if (!supabase || !navigator.onLine) return;
  for (const name of Object.keys(localTables) as SyncTable[]) {
    const { data, error } = await supabase.from(name).select('*').eq('user_id', userId);
    if (error) throw error;
    for (const remote of data ?? []) {
      const id = name === 'user_settings' ? remote.user_id : remote.id;
      const local = await (localTables[name] as any).get(id);
      if (!local || Number(remote.revision) > Number(local.revision)) {
        const pending = await db.outbox.where({ table: name, recordId: id }).first();
        if (pending) {
          await db.conflicts.add({
            id: crypto.randomUUID(),
            userId,
            table: name,
            recordId: id,
            local: local as Record<string, unknown>,
            remote,
            createdAt: new Date().toISOString(),
            resolvedAt: null,
          });
        } else await (localTables[name] as any).put(remote);
      }
    }
  }
}
export function installSyncTriggers(userId: string, trigger: () => void) {
  const online = () => trigger(),
    page = () => trigger(),
    visible = () => {
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
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client.channel(`zeitstempel-${userId}`);
  for (const table of ['projects', 'time_entries', 'time_breaks', 'user_settings'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
      trigger,
    );
  }
  channel.subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
