import { z } from 'zod';
import { db } from './db';
import { DEMO_USER_ID, type OutboxItem, type Project, type TimeBreak, type TimeEntry, type UserSettings } from './types';
const base = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
  revision: z.number().int().nonnegative(),
});
const project = base.extend({
  user_id: z.string(),
  name: z.string().max(120),
  customer: z.string().max(120),
  address: z.string().max(300),
  color: z.string().max(30),
  note: z.string().max(1000),
  is_archived: z.boolean(),
});
const entry = base.extend({
  user_id: z.string(),
  project_id: z.string().uuid().nullable(),
  project_name_snapshot: z.string().max(120),
  entry_type: z.enum(['work', 'vacation', 'sick', 'holiday', 'other_absence']),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  manual_break_minutes: z.number().int().min(0).max(1440),
  automatically_added_break_minutes: z.number().int().min(0).max(1440),
  activity: z.string().max(200),
  note: z.string().max(1000),
  source: z.enum(['clock', 'manual', 'migration', 'import']),
});
const timeBreak = base.extend({
  user_id: z.string(),
  time_entry_id: z.string().uuid(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
});
const settings = z.object({
  user_id: z.string(),
  weekday_targets: z.record(z.string(), z.number().int().min(0).max(1440)),
  automatic_break_enabled: z.boolean(),
  locale: z.string().max(20),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  revision: z.number().int().nonnegative(),
});
const schema = z.object({
  version: z.literal(2),
  projects: z.array(project).max(10000),
  entries: z.array(entry).max(100000),
  breaks: z.array(timeBreak).max(200000),
  settings,
  legacy: z.record(z.string(), z.string().nullable()).nullable().optional(),
});
export type ImportPreview = {
  projects: number;
  entries: number;
  breaks: number;
  data: z.infer<typeof schema>;
};
export function previewBackup(text: string): ImportPreview {
  const data = schema.parse(JSON.parse(text));
  const projectIds = new Set(data.projects.map((p) => p.id));
  const entryIds = new Set(data.entries.map((e) => e.id));
  const breakIds = new Set(data.breaks.map((b) => b.id));
  if (projectIds.size !== data.projects.length) throw new Error('Doppelte Baustellen-ID im Backup');
  if (entryIds.size !== data.entries.length) throw new Error('Doppelte Eintrags-ID im Backup');
  if (breakIds.size !== data.breaks.length) throw new Error('Doppelte Pausen-ID im Backup');
  for (const e of data.entries) {
    const date = new Date(`${e.work_date}T12:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== e.work_date)
      throw new Error(`Ungültiges Datum in Eintrag ${e.id}`);
    if (e.entry_type !== 'work' && (e.started_at !== null || e.ended_at !== null))
      throw new Error(`Abwesenheit enthält Arbeitszeit in Eintrag ${e.id}`);
    if (e.started_at && e.ended_at && Date.parse(e.ended_at) <= Date.parse(e.started_at))
      throw new Error(`Ungültiges Intervall in Eintrag ${e.id}`);
  }
  for (const b of data.breaks)
    if (b.ended_at && Date.parse(b.ended_at) <= Date.parse(b.started_at))
      throw new Error(`Ungültiges Pausenintervall in Pause ${b.id}`);
  for (const e of data.entries)
    if (e.project_id && !projectIds.has(e.project_id))
      throw new Error(`Unbekannte Baustelle in Eintrag ${e.id}`);
  for (const b of data.breaks)
    if (!entryIds.has(b.time_entry_id)) throw new Error(`Unbekannter Eintrag in Pause ${b.id}`);
  return {
    projects: data.projects.length,
    entries: data.entries.length,
    breaks: data.breaks.length,
    data,
  };
}
export async function importBackup(preview: ImportPreview, userId: string) {
  const shouldEnqueue = userId !== DEMO_USER_ID;
  const assertLocalOwnership = async (table: { get: (id: string) => Promise<{ user_id?: string } | undefined> }, id: string) => {
    const existing = await table.get(id);
    if (existing && existing.user_id !== userId)
      throw new Error('Backup enthält eine bereits belegte lokale ID.');
  };
  const enqueue = async (
    table: OutboxItem['table'],
    recordId: string,
    payload: Record<string, unknown>,
  ) => {
    if (!shouldEnqueue) return;
    await db.outbox.add({
      id: crypto.randomUUID(),
      userId,
      table,
      recordId,
      operation: 'upsert',
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    });
  };

  // One IndexedDB transaction prevents a failed restore from leaving a partial import.
  await db.transaction(
    'rw',
    [db.projects, db.timeEntries, db.timeBreaks, db.settings, db.outbox, db.meta],
    async () => {
      for (const p of preview.data.projects) {
        const value = { ...p, user_id: userId } as Project;
        await assertLocalOwnership(db.projects, value.id);
        await db.outbox
          .where({ table: 'projects', recordId: value.id })
          .filter((item) => item.userId === userId)
          .delete();
        await db.projects.put(value);
        await enqueue('projects', value.id, value as unknown as Record<string, unknown>);
      }
      for (const e of preview.data.entries) {
        const value = { ...e, user_id: userId, source: 'import' } as TimeEntry;
        await assertLocalOwnership(db.timeEntries, value.id);
        await db.outbox
          .where({ table: 'time_entries', recordId: value.id })
          .filter((item) => item.userId === userId)
          .delete();
        await db.timeEntries.put(value);
        await enqueue('time_entries', value.id, value as unknown as Record<string, unknown>);
      }
      for (const b of preview.data.breaks) {
        const value = { ...b, user_id: userId } as TimeBreak;
        await assertLocalOwnership(db.timeBreaks, value.id);
        await db.outbox
          .where({ table: 'time_breaks', recordId: value.id })
          .filter((item) => item.userId === userId)
          .delete();
        await db.timeBreaks.put(value);
        await enqueue('time_breaks', value.id, value as unknown as Record<string, unknown>);
      }
      const settings = { ...preview.data.settings, user_id: userId } as UserSettings;
      await db.outbox
        .where({ table: 'user_settings', recordId: userId })
        .filter((item) => item.userId === userId)
        .delete();
      await db.settings.put(settings);
      await enqueue('user_settings', userId, settings as unknown as Record<string, unknown>);
      if (preview.data.legacy) await db.meta.put({ key: `legacy-backup:${userId}`, value: preview.data.legacy });
    },
  );
}
