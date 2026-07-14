export type EntryType = 'work' | 'vacation' | 'sick' | 'holiday' | 'other_absence';
export type EntrySource = 'clock' | 'manual' | 'migration' | 'import';
export type SyncState = 'local' | 'syncing' | 'synced' | 'pending' | 'error';
export type WeekdayTargets = Record<string, number>;
export interface BaseRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
}
export interface Project extends BaseRecord {
  name: string;
  customer: string;
  address: string;
  color: string;
  note: string;
  is_archived: boolean;
}
export interface TimeEntry extends BaseRecord {
  project_id: string | null;
  project_name_snapshot: string;
  entry_type: EntryType;
  work_date: string;
  started_at: string | null;
  ended_at: string | null;
  manual_break_minutes: number;
  automatically_added_break_minutes: number;
  activity: string;
  note: string;
  source: EntrySource;
}
export interface TimeBreak extends BaseRecord {
  time_entry_id: string;
  started_at: string;
  ended_at: string | null;
}
export interface UserSettings {
  user_id: string;
  weekday_targets: WeekdayTargets;
  automatic_break_enabled: boolean;
  locale: string;
  created_at: string;
  updated_at: string;
  revision: number;
}
export type SyncTable = 'projects' | 'time_entries' | 'time_breaks' | 'user_settings';
export interface OutboxItem {
  id: string;
  userId: string;
  table: SyncTable;
  recordId: string;
  operation: 'upsert';
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}
export interface Conflict {
  id: string;
  userId: string;
  table: SyncTable;
  recordId: string;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
}
export const DEFAULT_TARGETS: WeekdayTargets = {
  '1': 480,
  '2': 480,
  '3': 480,
  '4': 480,
  '5': 480,
  '6': 0,
  '0': 0,
};
