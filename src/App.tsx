import { useCallback, useEffect, useMemo, useState } from 'react';
import { localOnlyUser, sendMagicLink, LOCAL_USER_KEY } from './auth';
import { importBackup, previewBackup } from './backup';
import { db, persistStorage } from './db';
import { formatMinutes, summarizeDay, summarizeRange, weekKeys } from './domain';
import {
  addLocalDays,
  berlinLocalToIso,
  localDateKey,
  localDateLabel,
  localTimeLabel,
} from './lib/date';
import { migrateLegacy, legacyBackup, type MigrationResult } from './migration';
import { freshBase, restore, saveLocal, softDelete } from './repository';
import { createCsv, createPdf, downloadBlob, reportRows } from './reports';
import { cloudConfigured, supabase } from './supabase';
import { installRealtime, installSyncTriggers, pullRemote, syncNow } from './sync';
import {
  DEFAULT_TARGETS,
  type EntryType,
  type Project,
  type SyncState,
  type TimeBreak,
  type TimeEntry,
  type UserSettings,
} from './types';
type Tab = 'clock' | 'times' | 'projects' | 'settings';
const syncText: Record<SyncState, string> = {
  local: 'Auf diesem Gerät gespeichert',
  syncing: 'Wird synchronisiert',
  synced: 'Alles synchronisiert',
  pending: 'Noch nicht synchronisiert',
  error: 'Synchronisierung fehlgeschlagen',
};
const typeLabel: Record<EntryType, string> = {
  work: 'Arbeit',
  vacation: 'Urlaub',
  sick: 'Krankheit',
  holiday: 'Feiertag',
  other_absence: 'Sonstige Abwesenheit',
};
interface Data {
  projects: Project[];
  entries: TimeEntry[];
  breaks: TimeBreak[];
  settings: UserSettings;
}
function defaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    weekday_targets: DEFAULT_TARGETS,
    automatic_break_enabled: true,
    locale: 'de-DE',
    created_at: now,
    updated_at: now,
    revision: 0,
  };
}

export function App() {
  const [userId, setUserId] = useState<string | null>(null),
    [authReady, setAuthReady] = useState(false),
    [email, setEmail] = useState(''),
    [authMessage, setAuthMessage] = useState('');
  const [tab, setTab] = useState<Tab>('clock'),
    [data, setData] = useState<Data | null>(null),
    [syncState, setSyncState] = useState<SyncState>(cloudConfigured ? 'pending' : 'local'),
    [migration, setMigration] = useState<MigrationResult | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(() =>
      localStorage.getItem('zeitstempel:selected-project'),
    ),
    [entryDialog, setEntryDialog] = useState<TimeEntry | null>(null),
    [projectDialog, setProjectDialog] = useState<Project | null>(null),
    [notice, setNotice] = useState(''),
    [undoId, setUndoId] = useState<string | null>(null);
  const refresh = useCallback(async (uid: string) => {
    const settings = (await db.settings.get(uid)) ?? defaultSettings(uid);
    setData({
      projects: await db.projects.where('user_id').equals(uid).toArray(),
      entries: await db.timeEntries.where('user_id').equals(uid).toArray(),
      breaks: await db.timeBreaks.where('user_id').equals(uid).toArray(),
      settings,
    });
  }, []);
  useEffect(() => {
    void (async () => {
      if (!supabase) {
        const id = localOnlyUser();
        setUserId(id);
        setAuthReady(true);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        localStorage.setItem(LOCAL_USER_KEY, session.user.id);
        setUserId(session.user.id);
      } else if (!navigator.onLine) {
        setUserId(localStorage.getItem(LOCAL_USER_KEY));
      }
      setAuthReady(true);
      supabase.auth.onAuthStateChange((_e, s) => {
        setUserId(s?.user.id ?? null);
        if (s) localStorage.setItem(LOCAL_USER_KEY, s.user.id);
      });
    })();
  }, []);
  useEffect(() => {
    if (!userId) return;
    void (async () => {
      await persistStorage();
      const result = await migrateLegacy(userId);
      setMigration(result);
      await refresh(userId);
      if (cloudConfigured && navigator.onLine) {
        try {
          await pullRemote(userId);
          await refresh(userId);
        } catch {
          setSyncState('error');
        }
        await syncNow(userId, setSyncState);
      }
    })();
    const removeTriggers = installSyncTriggers(
      userId,
      () => void syncNow(userId, setSyncState).then(() => refresh(userId)),
    );
    const removeRealtime = installRealtime(
      userId,
      () => void pullRemote(userId).then(() => refresh(userId)),
    );
    return () => {
      removeTriggers();
      removeRealtime();
    };
  }, [userId, refresh]);
  const pending = useCallback(async () => {
    if (!userId) return;
    await refresh(userId);
    setSyncState(cloudConfigured ? 'pending' : 'local');
    void syncNow(userId, setSyncState).then(() => refresh(userId));
  }, [userId, refresh]);
  if (!authReady)
    return (
      <main className="center">
        <p>Lade lokale Daten …</p>
      </main>
    );
  if (!userId)
    return (
      <Login
        email={email}
        setEmail={setEmail}
        message={authMessage}
        onSubmit={async () => {
          try {
            await sendMagicLink(email);
            setAuthMessage('Anmeldelink gesendet. Bitte E-Mail öffnen.');
          } catch (e) {
            setAuthMessage(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen');
          }
        }}
      />
    );
  if (!data)
    return (
      <main className="center">
        <p>Arbeitszeiten werden geladen …</p>
      </main>
    );
  const active = data.entries.find((e) => !e.deleted_at && e.entry_type === 'work' && !e.ended_at);
  const openBreak = active
    ? data.breaks.find((b) => b.time_entry_id === active.id && !b.deleted_at && !b.ended_at)
    : undefined;
  const today = localDateKey();
  const todaySummary = summarizeDay(
    today,
    data.entries,
    data.breaks,
    data.settings.weekday_targets,
    new Date(),
    data.settings.automatic_break_enabled,
  );
  const week = summarizeRange(
    weekKeys(today),
    data.entries,
    data.breaks,
    data.settings.weekday_targets,
    new Date(),
    data.settings.automatic_break_enabled,
  );
  async function startStop() {
    if (active) {
      const ended = new Date().toISOString();
      if (openBreak)
        await saveLocal('time_breaks', { ...openBreak, ended_at: ended, updated_at: ended });
      await saveLocal('time_entries', { ...active, ended_at: ended, updated_at: ended });
      setNotice('Arbeitszeit beendet.');
      await pending();
      return;
    }
    const p = data!.projects.find((x) => x.id === selectedProject);
    const now = new Date().toISOString();
    await saveLocal('time_entries', {
      ...freshBase(userId!),
      project_id: p?.id ?? null,
      project_name_snapshot: p?.name ?? 'Ohne Baustelle',
      entry_type: 'work',
      work_date: localDateKey(now),
      started_at: now,
      ended_at: null,
      manual_break_minutes: 0,
      automatically_added_break_minutes: 0,
      activity: '',
      note: '',
      source: 'clock',
    });
    setNotice('Arbeitszeit gestartet.');
    await pending();
  }
  async function toggleBreak() {
    if (!active) return;
    const now = new Date().toISOString();
    if (openBreak) await saveLocal('time_breaks', { ...openBreak, ended_at: now, updated_at: now });
    else
      await saveLocal('time_breaks', {
        ...freshBase(userId!),
        time_entry_id: active.id,
        started_at: now,
        ended_at: null,
      });
    await pending();
  }
  async function saveEntry(entry: TimeEntry) {
    await saveLocal('time_entries', entry);
    setEntryDialog(null);
    await pending();
  }
  async function saveProject(project: Project) {
    await saveLocal('projects', project);
    setProjectDialog(null);
    await pending();
  }
  const recent = data.entries
    .filter((e) => !e.deleted_at)
    .sort((a, b) => (b.started_at ?? b.work_date).localeCompare(a.started_at ?? a.work_date));
  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">Zeitstempel</span>
          <h1>
            {tab === 'clock'
              ? 'Arbeitszeit'
              : tab === 'times'
                ? 'Zeiten'
                : tab === 'projects'
                  ? 'Baustellen'
                  : 'Einstellungen'}
          </h1>
        </div>
        <button
          className={`sync ${syncState}`}
          onClick={() => void syncNow(userId, setSyncState).then(() => refresh(userId))}
          aria-label="Jetzt synchronisieren"
        >
          ● {syncText[syncState]}
        </button>
      </header>
      {migration && migration.status !== 'none' && (
        <aside className={`banner ${migration.errors.length ? 'warning' : ''}`}>
          {migration.imported} alte Einträge übernommen.
          {migration.errors.length > 0 &&
            ` ${migration.errors.length} Fehler – Originaldaten bleiben gesichert.`}
        </aside>
      )}
      {notice && (
        <div
          className="toast"
          role="status"
          onClick={() =>
            void (async () => {
              if (undoId) {
                await restore('time_entries', undoId);
                setUndoId(null);
                await pending();
              }
              setNotice('');
            })()
          }
        >
          {notice}
        </div>
      )}
      <main>
        {tab === 'clock' && (
          <>
            <section className="hero">
              <label htmlFor="project-select">Baustelle</label>
              <select
                id="project-select"
                value={selectedProject ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setSelectedProject(v);
                  if (v) localStorage.setItem('zeitstempel:selected-project', v);
                  else localStorage.removeItem('zeitstempel:selected-project');
                }}
                disabled={Boolean(active)}
              >
                <option value="">Ohne Baustelle</option>
                {data.projects
                  .filter((p) => !p.deleted_at && !p.is_archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <p className="run-state">
                {active ? (
                  <>
                    <strong>{active.project_name_snapshot}</strong>
                    <span>
                      Seit {localTimeLabel(active.started_at)} ·{' '}
                      {openBreak ? 'Pause läuft' : 'Arbeitszeit läuft'}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Bereit</strong>
                    <span>Heute {formatMinutes(todaySummary.work)} erfasst</span>
                  </>
                )}
              </p>
              <p className="break-summary">
                Pause {formatMinutes(todaySummary.recordedBreak)} · automatisch ergänzt{' '}
                {formatMinutes(todaySummary.automaticBreak)} · netto{' '}
                {formatMinutes(todaySummary.work)}
              </p>
              <button className={`stamp ${active ? 'stop' : ''}`} onClick={() => void startStop()}>
                {active ? 'Arbeit beenden' : 'Arbeit starten'}
              </button>
              {active && (
                <button className="pause" onClick={() => void toggleBreak()}>
                  {openBreak ? 'Pause beenden' : 'Pause starten'}
                </button>
              )}
            </section>
            <section>
              <div className="section-title">
                <h2>Zuletzt</h2>
              </div>
              <EntryList
                entries={recent.filter((e) => e.work_date !== today).slice(0, 3)}
                onEdit={setEntryDialog}
              />
            </section>
            <section>
              <div className="section-title">
                <h2>Heute</h2>
                <button onClick={() => setEntryDialog(newEntry(userId, today))}>+ Eintrag</button>
              </div>
              <EntryList
                entries={recent.filter((e) => e.work_date === today).slice(0, 5)}
                onEdit={setEntryDialog}
              />
            </section>
            <section className="progress">
              <h2>Diese Woche</h2>
              <div className="meter">
                <i
                  style={{
                    width: `${Math.min(100, week.target ? (week.worked / week.target) * 100 : 0)}%`,
                  }}
                />
              </div>
              <p>
                <strong>{formatMinutes(week.worked)}</strong> von {formatMinutes(week.target)} ·{' '}
                <span className={week.balance < 0 ? 'negative' : 'positive'}>
                  {formatMinutes(week.balance, true)}
                </span>
              </p>
            </section>
          </>
        )}
        {tab === 'times' && (
          <>
            <div className="section-title">
              <p>{recent.length} Einträge</p>
              <button onClick={() => setEntryDialog(newEntry(userId, today))}>+ Neu</button>
            </div>
            <EntryList
              entries={recent}
              onEdit={setEntryDialog}
              onDelete={async (e) => {
                await softDelete('time_entries', e.id);
                setUndoId(e.id);
                setNotice('Eintrag gelöscht · Tippen zum Rückgängig machen');
                await pending();
              }}
            />
            <ExportPanel data={data} />
          </>
        )}
        {tab === 'projects' && (
          <>
            <div className="section-title">
              <p>
                {data.projects.filter((p) => !p.deleted_at && !p.is_archived).length} aktive
                Baustellen
              </p>
              <button onClick={() => setProjectDialog(newProject(userId))}>+ Baustelle</button>
            </div>
            <div className="cards">
              {data.projects
                .filter((p) => !p.deleted_at)
                .map((p) => (
                  <article className="project-card" key={p.id}>
                    <i style={{ background: p.color }} />
                    <div>
                      <h3>{p.name}</h3>
                      <p>
                        {p.customer || p.address || 'Keine Zusatzangaben'}
                        {p.is_archived ? ' · Archiviert' : ''}
                      </p>
                    </div>
                    <button onClick={() => setProjectDialog(p)}>Bearbeiten</button>
                  </article>
                ))}
            </div>
          </>
        )}
        {tab === 'settings' && (
          <Settings
            data={data}
            onSaved={pending}
            onLogout={async () => {
              await supabase?.auth.signOut();
              localStorage.removeItem(LOCAL_USER_KEY);
              setUserId(null);
            }}
            onBackup={async () => {
              const backup = {
                version: 2,
                exportedAt: new Date().toISOString(),
                projects: data.projects,
                entries: data.entries,
                breaks: data.breaks,
                settings: data.settings,
                legacy: await legacyBackup(userId),
              };
              downloadBlob(
                new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
                `zeitstempel-backup-${today}.json`,
              );
            }}
            onImport={async (file) => {
              try {
                const preview = previewBackup(await file.text());
                if (
                  confirm(
                    `${preview.projects} Baustellen, ${preview.entries} Einträge und ${preview.breaks} Pausen importieren?`,
                  )
                ) {
                  await importBackup(preview, userId);
                  await pending();
                  setNotice('Backup erfolgreich importiert.');
                }
              } catch (error) {
                setNotice(
                  error instanceof Error ? `Import ungültig: ${error.message}` : 'Import ungültig.',
                );
              }
            }}
          />
        )}
      </main>
      <nav aria-label="Hauptnavigation">
        {(
          [
            ['clock', 'Stempeln'],
            ['times', 'Zeiten'],
            ['projects', 'Baustellen'],
            ['settings', 'Einstellungen'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {entryDialog && (
        <EntryDialog
          value={entryDialog}
          projects={data.projects}
          onClose={() => setEntryDialog(null)}
          onSave={saveEntry}
        />
      )}{' '}
      {projectDialog && (
        <ProjectDialog
          value={projectDialog}
          onClose={() => setProjectDialog(null)}
          onSave={saveProject}
        />
      )}
    </div>
  );
}
function Login({
  email,
  setEmail,
  message,
  onSubmit,
}: {
  email: string;
  setEmail: (s: string) => void;
  message: string;
  onSubmit: () => void;
}) {
  return (
    <main className="login">
      <div className="login-card">
        <span className="eyebrow">Zeitstempel</span>
        <h1>Einfach Arbeitszeit erfassen</h1>
        <p>Deine vorhandenen Daten bleiben auch ohne Verbindung auf diesem Gerät verfügbar.</p>
        <label>
          E-Mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <button onClick={onSubmit}>Anmeldelink senden</button>
        {message && <p role="status">{message}</p>}
      </div>
    </main>
  );
}
function newEntry(userId: string, date: string): TimeEntry {
  return {
    ...freshBase(userId),
    project_id: null,
    project_name_snapshot: 'Ohne Baustelle',
    entry_type: 'work',
    work_date: date,
    started_at: null,
    ended_at: null,
    manual_break_minutes: 0,
    automatically_added_break_minutes: 0,
    activity: '',
    note: '',
    source: 'manual',
  };
}
function newProject(userId: string): Project {
  return {
    ...freshBase(userId),
    name: '',
    customer: '',
    address: '',
    color: '#34765f',
    note: '',
    is_archived: false,
  };
}
function EntryList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: TimeEntry[];
  onEdit: (e: TimeEntry) => void;
  onDelete?: (e: TimeEntry) => void;
}) {
  if (!entries.length) return <div className="empty">Noch keine Einträge.</div>;
  return (
    <div className="entries">
      {entries.map((e) => (
        <button className="entry" key={e.id} onClick={() => onEdit(e)}>
          <span>
            <strong>{e.project_name_snapshot || typeLabel[e.entry_type]}</strong>
            <small>
              {localDateLabel(e.work_date)} · {typeLabel[e.entry_type]}
            </small>
          </span>
          <span>
            <strong>
              {e.entry_type === 'work'
                ? `${localTimeLabel(e.started_at)}–${localTimeLabel(e.ended_at)}`
                : typeLabel[e.entry_type]}
            </strong>
            <small>{e.note || e.activity || 'Bearbeiten'}</small>
          </span>
          {onDelete && (
            <i
              role="button"
              tabIndex={0}
              onClick={(ev) => {
                ev.stopPropagation();
                onDelete(e);
              }}
            >
              Löschen
            </i>
          )}
        </button>
      ))}
    </div>
  );
}
function EntryDialog({
  value,
  projects,
  onClose,
  onSave,
}: {
  value: TimeEntry;
  projects: Project[];
  onClose: () => void;
  onSave: (v: TimeEntry) => void;
}) {
  const [v, setV] = useState(value);
  function localInput(iso: string | null) {
    if (!iso) return '';
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
    return parts.replace(' ', 'T');
  }
  function parseLocal(s: string) {
    if (!s) return null;
    const [date, time] = s.split('T');
    return berlinLocalToIso(date!, time!);
  }
  return (
    <div className="overlay" role="presentation">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          const project = projects.find((p) => p.id === v.project_id);
          void onSave({
            ...v,
            project_name_snapshot: project?.name ?? 'Ohne Baustelle',
            updated_at: new Date().toISOString(),
          });
        }}
      >
        <h2>Eintrag bearbeiten</h2>
        <label>
          Typ
          <select
            value={v.entry_type}
            onChange={(e) => setV({ ...v, entry_type: e.target.value as EntryType })}
          >
            {Object.entries(typeLabel).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Datum
          <input
            type="date"
            value={v.work_date}
            onChange={(e) => setV({ ...v, work_date: e.target.value })}
            required
          />
        </label>
        <label>
          Baustelle
          <select
            value={v.project_id ?? ''}
            onChange={(e) => setV({ ...v, project_id: e.target.value || null })}
          >
            <option value="">Ohne Baustelle</option>
            {projects
              .filter((p) => !p.deleted_at)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {v.entry_type === 'work' && (
          <div className="form-grid">
            <label>
              Start
              <input
                type="datetime-local"
                value={localInput(v.started_at)}
                onChange={(e) => setV({ ...v, started_at: parseLocal(e.target.value) })}
                required
              />
            </label>
            <label>
              Ende
              <input
                type="datetime-local"
                value={localInput(v.ended_at)}
                onChange={(e) => setV({ ...v, ended_at: parseLocal(e.target.value) })}
              />
            </label>
            <label>
              Pause (Min.)
              <input
                type="number"
                min="0"
                max="600"
                value={v.manual_break_minutes}
                onChange={(e) => setV({ ...v, manual_break_minutes: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <label>
          Tätigkeit
          <input
            maxLength={200}
            value={v.activity}
            onChange={(e) => setV({ ...v, activity: e.target.value })}
          />
        </label>
        <label>
          Notiz
          <textarea
            maxLength={1000}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button>Speichern</button>
        </div>
      </form>
    </div>
  );
}
function ProjectDialog({
  value,
  onClose,
  onSave,
}: {
  value: Project;
  onClose: () => void;
  onSave: (v: Project) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <div className="overlay">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ ...v, updated_at: new Date().toISOString() });
        }}
      >
        <h2>Baustelle</h2>
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={120}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Kunde
          <input
            maxLength={120}
            value={v.customer}
            onChange={(e) => setV({ ...v, customer: e.target.value })}
          />
        </label>
        <label>
          Adresse
          <input
            maxLength={300}
            value={v.address}
            onChange={(e) => setV({ ...v, address: e.target.value })}
          />
        </label>
        <label>
          Farbe
          <input
            type="color"
            value={v.color}
            onChange={(e) => setV({ ...v, color: e.target.value })}
          />
        </label>
        <label>
          Notiz
          <textarea
            maxLength={1000}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={v.is_archived}
            onChange={(e) => setV({ ...v, is_archived: e.target.checked })}
          />{' '}
          Baustelle archivieren
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button>Speichern</button>
        </div>
      </form>
    </div>
  );
}
function Settings({
  data,
  onSaved,
  onLogout,
  onBackup,
  onImport,
}: {
  data: Data;
  onSaved: () => Promise<void>;
  onLogout: () => void;
  onBackup: () => void;
  onImport: (file: File) => Promise<void>;
}) {
  const [s, setS] = useState(data.settings);
  async function save() {
    await saveLocal('user_settings', { ...s, updated_at: new Date().toISOString() });
    await onSaved();
  }
  return (
    <div className="settings">
      <section>
        <h2>Sollzeiten</h2>
        {(
          [
            ['1', 'Montag'],
            ['2', 'Dienstag'],
            ['3', 'Mittwoch'],
            ['4', 'Donnerstag'],
            ['5', 'Freitag'],
            ['6', 'Samstag'],
            ['0', 'Sonntag'],
          ] as [string, string][]
        ).map(([key, label]) => (
          <label className="target" key={key}>
            {label}
            <input
              type="number"
              min="0"
              max="1440"
              step="15"
              value={s.weekday_targets[key] ?? 0}
              onChange={(e) =>
                setS({
                  ...s,
                  weekday_targets: { ...s.weekday_targets, [key]: Number(e.target.value) },
                })
              }
            />
            <span>Min.</span>
          </label>
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={s.automatic_break_enabled}
            onChange={(e) => setS({ ...s, automatic_break_enabled: e.target.checked })}
          />{' '}
          Mindestpause automatisch ergänzen
        </label>
        <button onClick={() => void save()}>Einstellungen speichern</button>
      </section>
      <section>
        <h2>Daten</h2>
        <button className="secondary" onClick={onBackup}>
          Vollständiges JSON-Backup
        </button>
        <label className="file-button">
          JSON-Backup importieren
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
              e.target.value = '';
            }}
          />
        </label>
        <p className="hint">
          Lokale Daten sind nach Benutzer getrennt und bleiben bei App-Updates erhalten.
        </p>
      </section>
      {cloudConfigured && (
        <section>
          <button className="danger" onClick={onLogout}>
            Abmelden
          </button>
        </section>
      )}
    </div>
  );
}
function ExportPanel({ data }: { data: Data }) {
  const today = localDateKey();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`),
    [to, setTo] = useState(today);
  const keys = useMemo(() => {
    const out: string[] = [];
    let key = from;
    while (key <= to && out.length < 3700) {
      out.push(key);
      key = addLocalDays(key, 1);
    }
    return out;
  }, [from, to]);
  const rows = useMemo(
    () =>
      reportRows(
        keys,
        data.entries,
        data.breaks,
        data.projects,
        data.settings.weekday_targets,
        data.settings.automatic_break_enabled,
      ),
    [keys, data],
  );
  return (
    <section className="exports">
      <h2>Auswertungen</h2>
      <div className="export-range">
        <label>
          Von
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Bis
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div>
        <button
          className="secondary"
          onClick={() =>
            downloadBlob(
              new Blob([createCsv(rows)], { type: 'text/csv;charset=utf-8' }),
              'arbeitszeiten.csv',
            )
          }
        >
          CSV
        </button>
        <button
          className="secondary"
          onClick={() => downloadBlob(createPdf(rows), 'stundennachweis.pdf')}
        >
          PDF
        </button>
      </div>
    </section>
  );
}
