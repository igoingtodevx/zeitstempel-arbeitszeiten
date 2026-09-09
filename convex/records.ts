import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const table = v.union(
  v.literal('projects'),
  v.literal('time_entries'),
  v.literal('time_breaks'),
  v.literal('user_settings'),
);

const entryTypes = new Set(['work', 'vacation', 'sick', 'holiday', 'other_absence']);
const entrySources = new Set(['clock', 'manual', 'migration', 'import']);

async function requireUser(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Nicht angemeldet');
  return identity.subject;
}

function stripSystemFields<T extends Record<string, unknown>>(record: T) {
  const publicRecord = { ...record };
  delete publicRecord._id;
  delete publicRecord._creationTime;
  return publicRecord;
}

function payloadObject(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Ungültige Datensatzdaten');
  return payload as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${field} ist ungültig`);
  return value;
}

function nullableText(value: unknown, field: string, max: number) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${field} ist ungültig`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number, fallback = 0) {
  const result = value == null ? fallback : value;
  if (typeof result !== 'number' || !Number.isInteger(result) || result < min || result > max)
    throw new Error(`${field} ist ungültig`);
  return result;
}

function instant(value: unknown, field: string, fallback: string | null = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error(`${field} ist ungültig`);
  return value;
}

function dateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('work_date ist ungültig');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('work_date ist ungültig');
  return value;
}

function boolean(value: unknown, field: string, fallback = false) {
  const result = value == null ? fallback : value;
  if (typeof result !== 'boolean') throw new Error(`${field} ist ungültig`);
  return result;
}

function targets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('weekday_targets ist ungültig');
  const result: Record<string, number> = {};
  for (const [key, target] of Object.entries(value)) result[key] = integer(target, `Sollzeit ${key}`, 0, 1440);
  return result;
}

function expectedRevision(value: unknown, fallback: number) {
  const result = value == null ? fallback : value;
  if (typeof result !== 'number' || !Number.isInteger(result) || result < 0)
    throw new Error('Revision ist ungültig');
  return result;
}

function assertRevision(
  existing: { revision: number; created_at: string } | null,
  expected: number,
  payload: Record<string, unknown>,
) {
  if ((existing?.revision ?? 0) !== expected)
    throw new Error(`SYNC_CONFLICT: erwartet Revision ${expected}, aktuell ${existing?.revision ?? 0}`);
  if (existing && expected === 0 && payload.created_at !== existing.created_at)
    throw new Error('SYNC_CONFLICT: Datensatz wurde parallel angelegt');
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [projects, entries, breaks, settings] = await Promise.all([
      ctx.db.query('projects').withIndex('by_user_id', (q) => q.eq('user_id', userId)).collect(),
      ctx.db.query('time_entries').withIndex('by_user_id', (q) => q.eq('user_id', userId)).collect(),
      ctx.db.query('time_breaks').withIndex('by_user_id', (q) => q.eq('user_id', userId)).collect(),
      ctx.db.query('user_settings').withIndex('by_user_id', (q) => q.eq('user_id', userId)).unique(),
    ]);
    return {
      projects: projects.map(stripSystemFields),
      entries: entries.map(stripSystemFields),
      breaks: breaks.map(stripSystemFields),
      settings: settings ? stripSystemFields(settings) : null,
    };
  },
});

export const upsert = mutation({
  args: { table, payload: v.any(), expectedRevision: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const payload = payloadObject(args.payload);
    const payloadRevision = integer(payload.revision, 'Revision', 0, Number.MAX_SAFE_INTEGER);
    const expected = expectedRevision(args.expectedRevision, payloadRevision);
    const now = new Date().toISOString();

    if (args.table === 'user_settings') {
      const existing = await ctx.db
        .query('user_settings')
        .withIndex('by_user_id', (q) => q.eq('user_id', userId))
        .unique();
      assertRevision(existing, expected, payload);
      const value = {
        user_id: userId,
        weekday_targets: targets(payload.weekday_targets ?? {}),
        automatic_break_enabled: boolean(payload.automatic_break_enabled, 'automatic_break_enabled'),
        locale: text(payload.locale, 'locale', 20, 'de-DE'),
        created_at: existing?.created_at ?? instant(payload.created_at, 'created_at', now) ?? now,
        updated_at: now,
        revision: expected + (existing ? 1 : 0),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert('user_settings', value);
      return value;
    }

    const externalId = text(payload.id, 'Datensatz-ID', 200);
    if (!externalId) throw new Error('Datensatz-ID fehlt');

    if (args.table === 'projects') {
      const existing = await ctx.db
        .query('projects')
        .withIndex('by_external_id', (q) => q.eq('id', externalId))
        .unique();
      if (existing && existing.user_id !== userId) throw new Error('Datensatz gehört einem anderen Konto');
      assertRevision(existing, expected, payload);
      const value = {
        user_id: userId,
        id: externalId,
        name: text(payload.name, 'name', 120),
        customer: nullableText(payload.customer, 'customer', 120),
        address: nullableText(payload.address, 'address', 300),
        color: nullableText(payload.color, 'color', 30),
        note: nullableText(payload.note, 'note', 1000),
        is_archived: boolean(payload.is_archived, 'is_archived'),
        created_at: existing?.created_at ?? instant(payload.created_at, 'created_at', now) ?? now,
        updated_at: now,
        deleted_at: instant(payload.deleted_at, 'deleted_at'),
        revision: expected + (existing ? 1 : 0),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert('projects', value);
      return value;
    }

    if (args.table === 'time_entries') {
      const existing = await ctx.db
        .query('time_entries')
        .withIndex('by_external_id', (q) => q.eq('id', externalId))
        .unique();
      if (existing && existing.user_id !== userId) throw new Error('Datensatz gehört einem anderen Konto');
      assertRevision(existing, expected, payload);
      const entryType = text(payload.entry_type, 'entry_type', 30);
      const source = text(payload.source, 'source', 30);
      if (!entryTypes.has(entryType) || !entrySources.has(source)) throw new Error('Eintragstyp ist ungültig');
      const startedAt = instant(payload.started_at, 'started_at');
      const endedAt = instant(payload.ended_at, 'ended_at');
      if (entryType === 'work' && startedAt && endedAt && Date.parse(endedAt) <= Date.parse(startedAt))
        throw new Error('Das Ende muss nach dem Start liegen');
      if (entryType !== 'work' && (startedAt || endedAt))
        throw new Error('Abwesenheiten dürfen keine Arbeitszeit enthalten');
      const value = {
        user_id: userId,
        id: externalId,
        project_id: nullableText(payload.project_id, 'project_id', 200),
        project_name_snapshot: text(payload.project_name_snapshot, 'project_name_snapshot', 120, 'Ohne Baustelle'),
        entry_type: entryType as 'work' | 'vacation' | 'sick' | 'holiday' | 'other_absence',
        work_date: dateKey(payload.work_date ?? now.slice(0, 10)),
        started_at: startedAt,
        ended_at: endedAt,
        manual_break_minutes: integer(payload.manual_break_minutes, 'manual_break_minutes', 0, 1440),
        automatically_added_break_minutes: integer(
          payload.automatically_added_break_minutes,
          'automatically_added_break_minutes',
          0,
          1440,
        ),
        activity: nullableText(payload.activity, 'activity', 200),
        note: nullableText(payload.note, 'note', 1000),
        source: source as 'clock' | 'manual' | 'migration' | 'import',
        created_at: existing?.created_at ?? instant(payload.created_at, 'created_at', now) ?? now,
        updated_at: now,
        deleted_at: instant(payload.deleted_at, 'deleted_at'),
        revision: expected + (existing ? 1 : 0),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert('time_entries', value);
      return value;
    }

    const existing = await ctx.db
      .query('time_breaks')
      .withIndex('by_external_id', (q) => q.eq('id', externalId))
      .unique();
    if (existing && existing.user_id !== userId) throw new Error('Datensatz gehört einem anderen Konto');
    assertRevision(existing, expected, payload);
    const startedAt = instant(payload.started_at, 'started_at');
    if (!startedAt) throw new Error('started_at ist ungültig');
    const endedAt = instant(payload.ended_at, 'ended_at');
    if (endedAt && Date.parse(endedAt) <= Date.parse(startedAt)) throw new Error('Das Ende muss nach dem Start liegen');
    const value = {
      user_id: userId,
      id: externalId,
      time_entry_id: text(payload.time_entry_id, 'time_entry_id', 200),
      started_at: startedAt,
      ended_at: endedAt,
      created_at: existing?.created_at ?? instant(payload.created_at, 'created_at', now) ?? now,
      updated_at: now,
      deleted_at: instant(payload.deleted_at, 'deleted_at'),
      revision: expected + (existing ? 1 : 0),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('time_breaks', value);
    return value;
  },
});
