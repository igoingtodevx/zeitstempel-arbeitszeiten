import { describe, expect, it } from 'vitest';
import { previewBackup } from '../backup';
describe('JSON-Import', () => {
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
});
