import { afterEach, describe, expect, it } from 'vitest';
import { importBackup, previewBackup } from '../backup';
import { db } from '../db';
describe('JSON-Import', () => {
  afterEach(async () => {
    await db.delete();
    await db.open();
  });
  it('weist beschädigtes JSON zurück', () => expect(() => previewBackup('{kaputt')).toThrow());
  it('weist ungültige IDs vor jeder Mutation zurück', () => {
    const invalid = {
      version: 2,
      projects: [],
      entries: [
        {
          id: 'keine-uuid',
          user_id: 'fremd',
          project_id: null,
          project_name_snapshot: 'Ohne Baustelle',
          entry_type: 'work',
          work_date: '2026-07-14',
          started_at: '2026-07-14T06:00:00.000Z',
          ended_at: '2026-07-14T14:00:00.000Z',
          manual_break_minutes: 0,
          automatically_added_break_minutes: 0,
          activity: '',
          note: '',
          source: 'import',
          created_at: '2026-07-14T06:00:00.000Z',
          updated_at: '2026-07-14T14:00:00.000Z',
          deleted_at: null,
          revision: 0,
        },
      ],
      breaks: [],
      settings: {
        user_id: 'fremd',
        weekday_targets: { '1': 480 },
        automatic_break_enabled: true,
        locale: 'de-DE',
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:00:00.000Z',
        revision: 0,
      },
    };
    expect(() => previewBackup(JSON.stringify(invalid))).toThrow();
  });
  it('importiert atomar, trennt den Benutzer und bewahrt Alt-Backups', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const data = {
      version: 2,
      projects: [],
      entries: [
        {
          id,
          user_id: 'altes-konto',
          project_id: null,
          project_name_snapshot: 'Ohne Baustelle',
          entry_type: 'work',
          work_date: '2026-07-14',
          started_at: '2026-07-14T06:00:00.000Z',
          ended_at: '2026-07-14T14:00:00.000Z',
          manual_break_minutes: 30,
          automatically_added_break_minutes: 0,
          activity: 'Montage',
          note: 'Äußere Tür',
          source: 'manual',
          created_at: '2026-07-14T06:00:00.000Z',
          updated_at: '2026-07-14T14:00:00.000Z',
          deleted_at: null,
          revision: 2,
        },
      ],
      breaks: [],
      settings: {
        user_id: 'altes-konto',
        weekday_targets: { '1': 480 },
        automatic_break_enabled: true,
        locale: 'de-DE',
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:00:00.000Z',
        revision: 2,
      },
      legacy: { zt_v1: '{"entries":[]}' },
    };
    await importBackup(previewBackup(JSON.stringify(data)), 'neues-konto');
    expect((await db.timeEntries.get(id))?.user_id).toBe('neues-konto');
    expect(await db.outbox.where('userId').equals('neues-konto').count()).toBe(2);
    expect(await db.meta.get('legacy-backup:neues-konto')).toEqual({
      key: 'legacy-backup:neues-konto',
      value: { zt_v1: '{"entries":[]}' },
    });
  });
});
