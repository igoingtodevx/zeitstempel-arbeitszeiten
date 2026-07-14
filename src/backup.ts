import { z } from 'zod';
import { saveLocal } from './repository';
import type { Project, TimeBreak, TimeEntry, UserSettings } from './types';
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
  for (const p of preview.data.projects)
    await saveLocal('projects', { ...p, user_id: userId } as Project);
  for (const e of preview.data.entries)
    await saveLocal('time_entries', { ...e, user_id: userId, source: 'import' } as TimeEntry);
  for (const b of preview.data.breaks)
    await saveLocal('time_breaks', { ...b, user_id: userId } as TimeBreak);
  await saveLocal('user_settings', { ...preview.data.settings, user_id: userId } as UserSettings);
}
