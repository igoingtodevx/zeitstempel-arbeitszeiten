import { afterEach, describe, expect, it } from 'vitest';
import { ZeitstempelDB } from '../db';
describe('IndexedDB', () => {
  const names: string[] = [];
  afterEach(async () => {
    for (const name of names) await new ZeitstempelDB(name).delete();
  });
  it('persistiert Daten und Outbox', async () => {
    const name = `test-${crypto.randomUUID()}`;
    names.push(name);
    const first = new ZeitstempelDB(name);
    const now = new Date().toISOString();
    await first.transaction('rw', [first.projects, first.outbox], async () => {
      await first.projects.add({
        id: 'p',
        user_id: 'u',
        name: 'Bau',
        customer: '',
        address: '',
        color: '#000',
        note: '',
        is_archived: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        revision: 0,
      });
      await first.outbox.add({
        id: 'o',
        userId: 'u',
        table: 'projects',
        recordId: 'p',
        operation: 'upsert',
        payload: { id: 'p' },
        createdAt: now,
        attempts: 0,
        lastError: null,
      });
    });
    first.close();
    const reopened = new ZeitstempelDB(name);
    expect(await reopened.projects.get('p')).toBeTruthy();
    expect(await reopened.outbox.count()).toBe(1);
    reopened.close();
  });
});
