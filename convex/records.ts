import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const table = v.union(
  v.literal('projects'),
  v.literal('time_entries'),
  v.literal('time_breaks'),
  v.literal('user_settings'),
);

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
  args: { table, payload: v.any() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const payload = args.payload as Record<string, unknown>;
    const externalId = args.table === 'user_settings' ? userId : String(payload.id ?? '');
    if (!externalId) throw new Error('Datensatz-ID fehlt');

    const now = new Date().toISOString();
    if (args.table === 'user_settings') {
      const existing = await ctx.db
        .query('user_settings')
        .withIndex('by_user_id', (q) => q.eq('user_id', userId))
        .unique();
      const value = {
        user_id: userId,
        weekday_targets: (payload.weekday_targets ?? {}) as Record<string, number>,
        automatic_break_enabled: Boolean(payload.automatic_break_enabled),
        locale: String(payload.locale ?? 'de-DE'),
        created_at: existing?.created_at ?? String(payload.created_at ?? now),
        updated_at: now,
        revision: (existing?.revision ?? Number(payload.revision ?? 0)) + (existing ? 1 : 0),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert('user_settings', value);
      return value;
    }

    if (args.table === 'projects') {
      const existing = await ctx.db
        .query('projects')
        .withIndex('by_external_id', (q) => q.eq('id', externalId))
        .unique();
      if (existing && existing.user_id !== userId) throw new Error('Datensatz gehört einem anderen Konto');
      const value = {
        user_id: userId,
        id: externalId,
        name: String(payload.name ?? ''),
        customer: payload.customer == null ? null : String(payload.customer),
        address: payload.address == null ? null : String(payload.address),
        color: payload.color == null ? null : String(payload.color),
        note: payload.note == null ? null : String(payload.note),
        is_archived: Boolean(payload.is_archived),
        created_at: existing?.created_at ?? String(payload.created_at ?? now),
        updated_at: now,
        deleted_at: payload.deleted_at == null ? null : String(payload.deleted_at),
        revision: (existing?.revision ?? Number(payload.revision ?? 0)) + (existing ? 1 : 0),
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
      const value = {
        user_id: userId,
        id: externalId,
        project_id: payload.project_id == null ? null : String(payload.project_id),
        project_name_snapshot: String(payload.project_name_snapshot ?? 'Ohne Baustelle'),
        entry_type: payload.entry_type as 'work' | 'vacation' | 'sick' | 'holiday' | 'other_absence',
        work_date: String(payload.work_date ?? now.slice(0, 10)),
        started_at: payload.started_at == null ? null : String(payload.started_at),
        ended_at: payload.ended_at == null ? null : String(payload.ended_at),
        manual_break_minutes: Number(payload.manual_break_minutes ?? 0),
        automatically_added_break_minutes: Number(payload.automatically_added_break_minutes ?? 0),
        activity: payload.activity == null ? null : String(payload.activity),
        note: payload.note == null ? null : String(payload.note),
        source: payload.source as 'clock' | 'manual' | 'migration' | 'import',
        created_at: existing?.created_at ?? String(payload.created_at ?? now),
        updated_at: now,
        deleted_at: payload.deleted_at == null ? null : String(payload.deleted_at),
        revision: (existing?.revision ?? Number(payload.revision ?? 0)) + (existing ? 1 : 0),
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
    const value = {
      user_id: userId,
      id: externalId,
      time_entry_id: String(payload.time_entry_id ?? ''),
      started_at: String(payload.started_at ?? now),
      ended_at: payload.ended_at == null ? null : String(payload.ended_at),
      created_at: existing?.created_at ?? String(payload.created_at ?? now),
      updated_at: now,
      deleted_at: payload.deleted_at == null ? null : String(payload.deleted_at),
      revision: (existing?.revision ?? Number(payload.revision ?? 0)) + (existing ? 1 : 0),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('time_breaks', value);
    return value;
  },
});
