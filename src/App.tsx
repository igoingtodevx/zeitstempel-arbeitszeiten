import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { LOCAL_USER_KEY } from './auth';
import { importBackup, previewBackup } from './backup';
import { db, persistStorage } from './db';
import { DEMO_MODE_KEY, DEMO_USER_ID, ensureDemoData, isDemoUser, resetDemoData } from './demo';
import { formatMinutes, summarizeDay, summarizeRange, validateTimeEntry, weekKeys } from './domain';
import {
  addLocalDays,
  berlinLocalToIso,
  localDateKey,
  localDateLabel,
  localTimeLabel,
} from './lib/date';
import { migrateLegacy, legacyBackup, type MigrationResult } from './migration';
import { freshBase, resolveConflict, restore, saveLocal, softDelete } from './repository';
import { createCsv, createPdf, downloadBlob, reportRows } from './reports';
import { convexConfigured } from './convex';
import { installRealtime, installSyncTriggers, pullRemote, syncNow } from './sync';
import {
  DEFAULT_TARGETS,
  type Conflict,
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
  conflicts: Conflict[];
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
    [syncState, setSyncState] = useState<SyncState>(convexConfigured ? 'pending' : 'local'),
    [migration, setMigration] = useState<MigrationResult | null>(null);
  const demoMode = isDemoUser(userId);
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
      conflicts: await db.conflicts
        .where('userId')
        .equals(uid)
        .filter((c) => !c.resolvedAt)
        .toArray(),
    });
  }, []);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const currentUser = useQuery(api.currentUser.get, isAuthenticated ? {} : 'skip');
  useEffect(() => {
    const demoRequested =
      localStorage.getItem(DEMO_MODE_KEY) === '1' ||
      new URLSearchParams(location.search).get('demo') === '1';
    if (demoRequested) {
      localStorage.setItem(DEMO_MODE_KEY, '1');
      setUserId(DEMO_USER_ID);
      setAuthReady(true);
      return;
    }
    if (authLoading || (isAuthenticated && currentUser === undefined)) return;
    if (currentUser) {
      localStorage.removeItem(DEMO_MODE_KEY);
      localStorage.setItem(LOCAL_USER_KEY, currentUser.id);
      setUserId(currentUser.id);
    } else {
      setUserId(null);
    }
    setAuthReady(true);
  }, [authLoading, currentUser, isAuthenticated]);
  useEffect(() => {
    if (!userId) return;
    const demo = isDemoUser(userId);
    void (async () => {
      await persistStorage();
      if (demo) {
        await ensureDemoData();
        setMigration(null);
      } else {
        const result = await migrateLegacy(userId);
        setMigration(result);
      }
      await refresh(userId);
      if (!demo && convexConfigured && navigator.onLine) {
        try {
          await pullRemote(userId);
          await refresh(userId);
        } catch {
          setSyncState('error');
        }
        await syncNow(userId, setSyncState);
      } else if (demo) {
        setSyncState('local');
      }
    })();
    const removeTriggers = demo
      ? () => undefined
      : installSyncTriggers(
          userId,
          () => void syncNow(userId, setSyncState).then(() => refresh(userId)),
        );
    const removeRealtime = demo
      ? () => undefined
      : installRealtime(userId, () => void pullRemote(userId).then(() => refresh(userId)));
    return () => {
      removeTriggers();
      removeRealtime();
    };
  }, [userId, refresh]);
  const pending = useCallback(async () => {
    if (!userId) return;
    const demo = isDemoUser(userId);
    await refresh(userId);
    setSyncState(demo || !convexConfigured ? 'local' : 'pending');
    if (!demo && convexConfigured) void syncNow(userId, setSyncState).then(() => refresh(userId));
  }, [userId, refresh]);
  async function handleSync() {
    if (!userId) return;
    if (isDemoUser(userId)) {
      setNotice('Demo-Modus: Diese Daten bleiben nur auf diesem Gerät.');
      return;
    }
    await syncNow(userId, setSyncState);
    await refresh(userId);
  }
  function enterDemo() {
    localStorage.setItem(DEMO_MODE_KEY, '1');
    const url = new URL(location.href);
    url.searchParams.set('demo', '1');
    history.replaceState(null, '', url);
    setData(null);
    setMigration(null);
    setSyncState('local');
    setTab('clock');
    setUserId(DEMO_USER_ID);
  }
  async function leaveSession() {
    try {
      if (userId && !isDemoUser(userId)) await signOut();
    } finally {
      localStorage.removeItem(LOCAL_USER_KEY);
      localStorage.removeItem(DEMO_MODE_KEY);
      const url = new URL(location.href);
      url.searchParams.delete('demo');
      history.replaceState(null, '', url);
      setData(null);
      setMigration(null);
      setNotice('');
      setUserId(null);
    }
  }
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
        onDemo={enterDemo}
        onSubmit={async (password, mode) => {
          try {
            const formData = new FormData();
            formData.set('email', email);
            formData.set('password', password);
            formData.set('flow', mode);
            await signIn('password', formData);
            setAuthMessage('Anmeldung erfolgreich.');
          } catch {
            setAuthMessage(
              mode === 'signIn'
                ? 'Anmeldung nicht möglich. Bitte E-Mail und Passwort prüfen.'
                : 'Konto konnte nicht erstellt werden. Bitte Eingaben prüfen und erneut versuchen.',
            );
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
  const activeEntries = data.entries.filter(
    (e) => !e.deleted_at && e.entry_type === 'work' && !e.ended_at,
  );
  const active = activeEntries[0];
  const multipleActive = activeEntries.length > 1;
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
    if (!userId) return;
    if (multipleActive) {
      setNotice('Mehrere offene Arbeitszeiten gefunden. Bitte zuerst einen Eintrag schließen.');
      return;
    }
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
    const normalized = {
      ...entry,
      work_date:
        entry.entry_type === 'work' && entry.started_at ? localDateKey(entry.started_at) : entry.work_date,
    };
    const validation = validateTimeEntry(normalized);
    if (validation.length) {
      setNotice(validation[0]!);
      return;
    }
    if (normalized.entry_type === 'work' && normalized.source === 'manual' && !normalized.ended_at) {
      setNotice('Manuelle Einträge brauchen ein Ende.');
      return;
    }
    const anotherActive = data!.entries.find(
      (candidate) =>
        candidate.id !== normalized.id &&
        !candidate.deleted_at &&
        candidate.entry_type === 'work' &&
        !candidate.ended_at,
    );
    if (anotherActive && normalized.entry_type === 'work' && !normalized.ended_at) {
      setNotice('Es läuft bereits eine Arbeitszeit.');
      return;
    }
    await saveLocal('time_entries', normalized);
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
              ? 'Heute'
              : tab === 'times'
                ? 'Zeiten'
                : tab === 'projects'
                  ? 'Baustellen'
                  : 'Einstellungen'}
          </h1>
        </div>
        <button
          className={`sync ${syncState}`}
          onClick={() => void handleSync()}
          aria-label="Jetzt synchronisieren"
        >
          ● {syncText[syncState]}
        </button>
      </header>
      {demoMode && (
        <aside className="banner demo-banner" role="status">
          <div>
            <strong>Demo-Modus</strong>
            <span>Beispieldaten zum Anschauen. Es wird nichts in die Cloud synchronisiert.</span>
          </div>
          <div className="demo-actions">
            <button
              className="secondary"
              onClick={() =>
                void (async () => {
                  await resetDemoData();
                  await refresh(DEMO_USER_ID);
                  setNotice('Demo zurückgesetzt.');
                })()
              }
            >
              Demo zurücksetzen
            </button>
            <button className="secondary" onClick={() => void leaveSession()}>
              Zur Anmeldung
            </button>
          </div>
        </aside>
      )}
      {multipleActive && (
        <aside className="banner warning" role="alert">
          Mehrere offene Arbeitszeiten gefunden. Bitte unter „Zeiten“ Einträge schließen, bevor du weiter stempelst.
        </aside>
      )}
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
            <section className="quick-entry">
              <div>
                <span className="eyebrow">Schnell erfassen</span>
                <h2>Arbeitszeit eintragen</h2>
                <p>Beginn, Ende und Pause eintragen – fertig. Du kannst alles später ändern.</p>
              </div>
              <button className="primary-entry" onClick={() => setEntryDialog(newEntry(userId, today))}>
                Arbeitszeit eintragen
              </button>
            </section>
            <section>
              <div className="section-title">
                <div>
                  <h2>Heute</h2>
                  <p className="section-subtitle">{formatMinutes(todaySummary.work)} erfasst</p>
                </div>
                <button className="secondary small-action" onClick={() => setEntryDialog(newEntry(userId, today))}>
                  + Eintrag
                </button>
              </div>
              <EntryList
                entries={recent.filter((e) => e.work_date === today).slice(0, 5)}
                onEdit={setEntryDialog}
              />
            </section>
            <section className="hero clock-card">
              <div className="clock-card-heading">
                <div>
                  <span className="eyebrow">Optional</span>
                  <h2>Stempeluhr</h2>
                </div>
                <span className="optional-badge">Komfortfunktion</span>
              </div>
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
                    <strong>Nicht gestartet</strong>
                    <span>Nur nutzen, wenn du live stempeln möchtest.</span>
                  </>
                )}
              </p>
              <p className="break-summary">
                Pause {formatMinutes(todaySummary.recordedBreak)} · automatisch ergänzt{' '}
                {formatMinutes(todaySummary.automaticBreak)} · netto{' '}
                {formatMinutes(todaySummary.work)}
              </p>
              <button className={`clock-action ${active ? 'stop' : ''}`} onClick={() => void startStop()}>
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
            demoMode={demoMode}
            onSaved={pending}
            onLogout={() => void leaveSession()}
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
            onResolve={async (id, choice) => {
              await resolveConflict(id, choice);
              await pending();
              setNotice('Konflikt aufgelöst.');
            }}
          />
        )}
      </main>
      <nav aria-label="Hauptnavigation">
        {(
          [
            ['clock', 'Heute'],
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
          isNew={!data.entries.some((entry) => entry.id === entryDialog.id)}
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
  onDemo,
  onSubmit,
}: {
  email: string;
  setEmail: (s: string) => void;
  message: string;
  onDemo: () => void;
  onSubmit: (password: string, mode: 'signIn' | 'signUp') => void | Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  return (
    <main className="login">
      <div className="login-card">
        <span className="eyebrow">Zeitstempel</span>
        <h1>Einfach Arbeitszeit erfassen</h1>
        <p>Deine Arbeitszeiten bleiben auch offline verfügbar und werden bei Verbindung sicher synchronisiert.</p>
        <label>
          E-Mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
        </label>
        <button onClick={() => onSubmit(password, mode)}>
          {mode === 'signIn' ? 'Anmelden' : 'Konto erstellen'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        >
          {mode === 'signIn' ? 'Neues Konto erstellen' : 'Bereits registriert? Anmelden'}
        </button>
        <div className="login-divider" aria-hidden="true">
          <span>oder</span>
        </div>
        <button type="button" className="secondary" onClick={onDemo}>
          Demo ansehen – ohne Login
        </button>
        <p className="hint">Die Demo nutzt nur lokale Beispieldaten und verändert kein Konto.</p>
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
        <article className="entry" key={e.id}>
          <button className="entry-main" onClick={() => onEdit(e)} aria-label="Eintrag bearbeiten">
            <span>
              <strong>
                {e.entry_type === 'work' ? e.project_name_snapshot || 'Ohne Baustelle' : typeLabel[e.entry_type]}
              </strong>
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
              <small>{e.note || e.activity || 'Tippen zum Bearbeiten'}</small>
            </span>
          </button>
          {onDelete && (
            <button className="entry-delete" onClick={() => onDelete(e)} aria-label="Eintrag löschen">
              Löschen
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
function EntryDialog({
  value,
  isNew,
  projects,
  onClose,
  onSave,
}: {
  value: TimeEntry;
  isNew: boolean;
  projects: Project[];
  onClose: () => void;
  onSave: (v: TimeEntry) => void;
}) {
  const [v, setV] = useState(value);
  const [startTime, setStartTime] = useState(() => localClock(value.started_at));
  const [endTime, setEndTime] = useState(() => localClock(value.ended_at));
  const [nextDay, setNextDay] = useState(() =>
    Boolean(value.ended_at && localDateKey(value.ended_at) !== value.work_date),
  );
  function localClock(iso: string | null) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  }
  function parseLocalTime(time: string, dayOffset = 0) {
    if (!time) return null;
    try {
      return berlinLocalToIso(v.work_date, time, dayOffset);
    } catch {
      return null;
    }
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
            started_at: v.entry_type === 'work' ? parseLocalTime(startTime) : null,
            ended_at: v.entry_type === 'work' ? parseLocalTime(endTime, nextDay ? 1 : 0) : null,
            project_name_snapshot: project?.name ?? 'Ohne Baustelle',
            updated_at: new Date().toISOString(),
          });
        }}
      >
        <div className="dialog-heading">
          <span className="eyebrow">{isNew ? 'Neu' : 'Ändern'}</span>
          <h2>{isNew ? 'Arbeitszeit eintragen' : 'Eintrag bearbeiten'}</h2>
          <p>
            {isNew
              ? 'Nur das Nötige eintragen. Alles kann später korrigiert werden.'
              : 'Änderungen werden direkt auf diesem Gerät gespeichert.'}
          </p>
        </div>
        <label>
          Typ
          <select
            value={v.entry_type}
            onChange={(e) => {
              const entryType = e.target.value as EntryType;
              setV({
                ...v,
                entry_type: entryType,
                started_at: entryType === 'work' ? v.started_at : null,
                ended_at: entryType === 'work' ? v.ended_at : null,
                manual_break_minutes: entryType === 'work' ? v.manual_break_minutes : 0,
                automatically_added_break_minutes: entryType === 'work' ? v.automatically_added_break_minutes : 0,
              });
            }}
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
        {v.entry_type === 'work' && (
          <>
            <label>
              Baustelle
              <select
                value={v.project_id ?? ''}
                onChange={(e) => setV({ ...v, project_id: e.target.value || null })}
              >
                <option value="">Ohne Baustelle</option>
                {projects
                  .filter((p) => !p.deleted_at && !p.is_archived)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid time-grid">
              <label>
                Start
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </label>
              <label>
                Ende
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required={v.source === 'manual'}
                />
              </label>
              <label>
                Pause in Minuten
                <input
                  type="number"
                  min="0"
                  max="600"
                  value={v.manual_break_minutes}
                  onChange={(e) => setV({ ...v, manual_break_minutes: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="check next-day">
              <input
                type="checkbox"
                checked={nextDay}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setNextDay(checked);
                }}
              />{' '}
              Ende ist am nächsten Tag
            </label>
          </>
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
  demoMode,
  onSaved,
  onLogout,
  onBackup,
  onImport,
  onResolve,
}: {
  data: Data;
  demoMode: boolean;
  onSaved: () => Promise<void>;
  onLogout: () => void;
  onBackup: () => void;
  onImport: (file: File) => Promise<void>;
  onResolve: (id: string, choice: 'local' | 'remote') => Promise<void>;
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
      {data.conflicts.length > 0 && (
        <section>
          <h2>Synchronisationskonflikte</h2>
          <p className="hint">
            Beide Versionen sind sicher gespeichert. Wähle, welche wiederhergestellt werden soll.
          </p>
          {data.conflicts.map((c) => (
            <div className="conflict" key={c.id}>
              <strong>
                {c.table} · {c.recordId.slice(0, 8)}
              </strong>
              <div>
                <button className="secondary" onClick={() => void onResolve(c.id, 'remote')}>
                  Cloud-Version
                </button>
                <button onClick={() => void onResolve(c.id, 'local')}>Meine Version</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {(convexConfigured || demoMode) && (
        <section>
          {demoMode && (
            <p className="hint">
              Du bist in der öffentlichen Vorschau. Deine Änderungen bleiben lokal.
            </p>
          )}
          <button className="danger" onClick={onLogout}>
            {demoMode ? 'Demo verlassen' : 'Abmelden'}
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
