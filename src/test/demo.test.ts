import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { DEMO_USER_ID, ensureDemoData, isDemoUser } from '../demo';

describe('öffentliche Demo', () => {
  afterEach(async () => {
    await db.delete();
    await db.open();
  });

  it('legt lokale Beispieldaten idempotent ohne Outbox an', async () => {
    expect(isDemoUser(DEMO_USER_ID)).toBe(true);
    await ensureDemoData();
    await ensureDemoData();

    expect(await db.projects.where('user_id').equals(DEMO_USER_ID).count()).toBe(2);
    expect(await db.timeEntries.where('user_id').equals(DEMO_USER_ID).count()).toBe(2);
    expect(await db.timeBreaks.where('user_id').equals(DEMO_USER_ID).count()).toBe(1);
    expect(await db.outbox.where('userId').equals(DEMO_USER_ID).count()).toBe(0);
  });
});
