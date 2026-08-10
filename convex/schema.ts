import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const nullableString = v.union(v.string(), v.null());
const baseRecord = {
  user_id: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
  deleted_at: nullableString,
  revision: v.number(),
};

export default defineSchema({
  ...authTables,
  profiles: defineTable({
    id: v.string(),
    display_name: nullableString,
    timezone: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
    revision: v.number(),
  }).index('by_external_id', ['id']),
  user_settings: defineTable({
    user_id: v.string(),
    weekday_targets: v.record(v.string(), v.number()),
    automatic_break_enabled: v.boolean(),
    locale: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
    revision: v.number(),
  }).index('by_user_id', ['user_id']),
  projects: defineTable({
    ...baseRecord,
    id: v.string(),
    name: v.string(),
    customer: nullableString,
    address: nullableString,
    color: nullableString,
    note: nullableString,
    is_archived: v.boolean(),
  })
    .index('by_user_id', ['user_id'])
    .index('by_external_id', ['id']),
  time_entries: defineTable({
    ...baseRecord,
    id: v.string(),
    project_id: nullableString,
    project_name_snapshot: v.string(),
    entry_type: v.union(
      v.literal('work'),
      v.literal('vacation'),
      v.literal('sick'),
      v.literal('holiday'),
      v.literal('other_absence'),
    ),
    work_date: v.string(),
    started_at: nullableString,
    ended_at: nullableString,
    manual_break_minutes: v.number(),
    automatically_added_break_minutes: v.number(),
    activity: nullableString,
    note: nullableString,
    source: v.union(
      v.literal('clock'),
      v.literal('manual'),
      v.literal('migration'),
      v.literal('import'),
    ),
  })
    .index('by_user_id', ['user_id'])
    .index('by_external_id', ['id'])
    .index('by_project_id', ['project_id']),
  time_breaks: defineTable({
    ...baseRecord,
    id: v.string(),
    time_entry_id: v.string(),
    started_at: v.string(),
    ended_at: nullableString,
  })
    .index('by_user_id', ['user_id'])
    .index('by_external_id', ['id'])
    .index('by_time_entry_id', ['time_entry_id']),
});
