import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { legacyBackup, migrateLegacy } from '../migration';
describe('Legacy-Migration', () => {
  afterEach(async () => {
    localStorage.clear();
    await db.delete();
    await db.open();
  });
  it('migriert zt_v1 idempotent und sichert das Original', async () => {
    const raw = JSON.stringify({
      entries: [
        {
          id: 'alt-1',
          date: '2026-01-15',
          start: '08:00',
          end: '16:30',
          breakMins: 30,
          note: 'Altbestand',
        },
      ],
      active: null,
      settings: { dailyH: 8 },
    });
    localStorage.setItem('zt_v1', raw);
    const first = await migrateLegacy('migration-user');
    const second = await migrateLegacy('migration-user');
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(1);
    expect(await db.timeEntries.where('user_id').equals('migration-user').count()).toBe(1);
    expect(((await legacyBackup('migration-user')) as Record<string, string>).zt_v1).toBe(raw);
  });
  it('behält beschädigte Daten und migriert die gültige Quelle', async () => {
    localStorage.setItem('zt_v1', '{kaputt');
    localStorage.setItem(
      'zt_v2',
      JSON.stringify({
        entries: [{ date: '2026-02-02', start: '07:00', end: '15:00', note: 'gültig' }],
        active: null,
        settings: {},
      }),
    );
    const result = await migrateLegacy('partial-user');
    expect(result.status).toBe('partial');
    expect(result.imported).toBe(1);
    expect(result.errors[0]).toContain('zt_v1');
  });
});
