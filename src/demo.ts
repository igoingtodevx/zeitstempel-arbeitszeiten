import { db } from './db';
import { addLocalDays, berlinLocalToIso, localDateKey } from './lib/date';
import { freshBase, saveLocal } from './repository';
import { DEFAULT_TARGETS, DEMO_USER_ID, type Project, type TimeEntry } from './types';

export { DEMO_USER_ID } from './types';

export const DEMO_MODE_KEY = 'zeitstempel:demo-mode';

export function isDemoUser(userId: string | null) {
  return userId === DEMO_USER_ID;
}

function demoProject(id: string, name: string, color: string): Project {
  return {
    ...freshBase(DEMO_USER_ID),
    id,
    name,
    customer: 'Beispielkunde',
    address: 'Siegen',
    color,
    note: 'Beispielprojekt für die öffentliche Vorschau.',
    is_archived: false,
  };
}

function demoEntry(
  id: string,
  project: Project,
  workDate: string,
  startedAt: string,
  endedAt: string,
  activity: string,
): TimeEntry {
  return {
    ...freshBase(DEMO_USER_ID),
    id,
    project_id: project.id,
    project_name_snapshot: project.name,
    entry_type: 'work',
    work_date: workDate,
    started_at: startedAt,
    ended_at: endedAt,
    manual_break_minutes: 15,
    automatically_added_break_minutes: 0,
    activity,
    note: 'Beispieldaten – nicht synchronisiert.',
    source: 'clock',
  };
}

export async function ensureDemoData() {
  if (!(await db.settings.get(DEMO_USER_ID))) {
    const now = new Date().toISOString();
    await saveLocal(
      'user_settings',
      {
        user_id: DEMO_USER_ID,
        weekday_targets: DEFAULT_TARGETS,
        automatic_break_enabled: true,
        locale: 'de-DE',
        created_at: now,
        updated_at: now,
        revision: 0,
      },
      false,
    );
  }

  if (await db.projects.get('demo-project-neubau')) return;

  const now = new Date();
  const todayStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const todayEnd = new Date(now.getTime() - 30 * 60 * 1000);
  const today = localDateKey(todayStart);
  const yesterday = addLocalDays(today, -1);
  const mainProject = demoProject('demo-project-neubau', 'Neubau Müller', '#34765f');
  const secondProject = demoProject('demo-project-sanierung', 'Altbau-Sanierung', '#b1763d');
  const todayEntry = demoEntry(
    'demo-entry-today',
    mainProject,
    today,
    todayStart.toISOString(),
    todayEnd.toISOString(),
    'Montage und Innenausbau',
  );
  const yesterdayEntry = demoEntry(
    'demo-entry-yesterday',
    secondProject,
    yesterday,
    berlinLocalToIso(yesterday, '07:30'),
    berlinLocalToIso(yesterday, '15:45'),
    'Vorbereitung',
  );

  await saveLocal('projects', mainProject, false);
  await saveLocal('projects', secondProject, false);
  await saveLocal('time_entries', todayEntry, false);
  await saveLocal('time_entries', yesterdayEntry, false);
  await saveLocal(
    'time_breaks',
    {
      ...freshBase(DEMO_USER_ID),
      id: 'demo-break-today',
      time_entry_id: todayEntry.id,
      started_at: new Date(todayStart.getTime() + 60 * 60 * 1000).toISOString(),
      ended_at: new Date(todayStart.getTime() + 75 * 60 * 1000).toISOString(),
    },
    false,
  );
}
