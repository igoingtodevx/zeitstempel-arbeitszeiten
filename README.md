# Zeitstempel Arbeitszeiten

Eine bewusst einfache, vollständig deutsche und local-first Arbeitszeiterfassung für iPhone und Desktop. Baustellen, Stempelvorgänge, Pausen und Änderungen werden zuerst atomar in IndexedDB gespeichert. Eine persistente Outbox synchronisiert sie anschließend mit Supabase; Netzwerkfehler löschen niemals lokale Daten.

## Architektur

- Vite, React und TypeScript Strict Mode
- Dexie/IndexedDB als primäre Datenquelle, getrennt nach `user_id`
- atomare Entitäts-/Outbox-Transaktionen, Soft Deletes und persistente Konfliktkopien
- Supabase Auth (E-Mail-Magic-Link/OTP), Realtime als Pull-Auslöser und revisionsgeprüfter Sync
- zentrale Europe/Berlin-Domainlogik für UI, Wochen-/Monatssummen, CSV und PDF
- Workbox-PWA mit App-Shell-Cache, Update-Hinweis, Safe Areas und lokalen Icons
- idempotente Migration von `zt_v1` und `zt_v2` mit unveränderter Rohdatensicherung

Ohne Supabase-Variablen startet automatisch ein lokaler Offline-Modus. Dieser ist für Entwicklung und Geräte-Tests gedacht; späteres automatisches Umschlüsseln eines lokalen Geräteprofils in ein Cloud-Konto ist bewusst nicht implementiert.

## Entwicklung

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run preview
```

Konfiguration (`.env.local`, niemals ein Service-Role-Key):

```env
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_ANON_KEY
```

## Supabase und Auth

Der im Auftrag beschriebene Ist-Stand ist nicht-destruktiv in `supabase/migrations/20260714000000_document_existing_schema.sql` dokumentiert. Die App verwendet ausschließlich die vorgegebenen Tabellen und Spalten.

In Supabase Auth müssen folgende Redirect-URLs erlaubt sein:

- lokal: `http://localhost:5173/auth/callback`
- Vercel Preview: `https://arbeitszeitenapp-*-igoingtodevxs-projects.vercel.app/auth/callback`
- Vercel Production: `https://arbeitszeitenapp.vercel.app/auth/callback`

Falls der Vercel-Projektname abweicht, wird nur die Production-URL auf die tatsächliche Domain angepasst. Preview und Production benötigen `VITE_SUPABASE_URL` sowie `VITE_SUPABASE_ANON_KEY` in der jeweiligen Vercel-Umgebung.

### Konfliktstrategie

Lokale Datensätze tragen die zuletzt bekannte Server-`revision`. Vor einem Update wird die Remote-Revision gelesen; das Update verwendet anschließend Compare-and-swap. Bei einer neueren Remote-Version werden lokale und Remote-Fassung in IndexedDB unter `conflicts` bewahrt. Der lokale Datensatz bleibt bestehen und der Sync zeigt einen Fehler; es erfolgt kein stilles Last-write-wins.

## Zeit- und Pausenregeln

Timestamps sind ISO-Instants; `work_date` ist der lokale Starttag in `Europe/Berlin`. Nachtschichten bleiben ein zusammenhängender Eintrag. Sommer-/Winterzeit wird über die tatsächliche Instant-Differenz berechnet. Sollminuten stammen ausschließlich aus `weekday_targets`. Mindestpausen werden tageweise berechnet, sodass mehrere Blöcke die Regel nicht umgehen; tatsächliche und automatisch ergänzte Pause bleiben getrennt.

## Alte Daten

Beim ersten Start werden Rohwerte aus `zt_v1` und `zt_v2` unverändert in IndexedDB gesichert, validiert, dedupliziert und mit `source=migration` sowie „Ohne Baustelle“ übernommen. Beschädigte Quellen bleiben erhalten und erzeugen einen sichtbaren Fehler. Die Original-Keys werden nicht gelöscht. Das vollständige JSON-Backup in Einstellungen enthält auch die Alt-Sicherung.

## Installation auf dem iPhone

1. Deployment in Safari öffnen und einmal vollständig laden.
2. Teilen antippen.
3. „Zum Home-Bildschirm“ wählen und bestätigen.
4. App einmal online öffnen; danach funktionieren App-Shell und lokale Daten offline.

## Manuelle iPhone-Checkliste

- Magic-Link öffnen, App schließen/neu öffnen und persistente Session prüfen.
- Baustelle anlegen, auswählen, stempeln, Pause starten, App beenden und Zustand prüfen.
- Offline Arbeitszeit erstellen, neu laden, anschließend online gehen und Syncstatus beobachten.
- Nachtschicht über Mitternacht manuell erfassen und Wochen-/Monatssumme kontrollieren.
- Zwei Blöcke am selben Tag in CSV/PDF prüfen; Tagessaldo darf nur einmal erscheinen.
- Homescreen-Icon, Standalone-Modus, Safe Areas, Touchziele und Update-Hinweis prüfen.
- JSON-Backup speichern und die Alt-Datensicherung kontrollieren.

## Verbleibende Grenzen

- Safari kann Website-Speicher unter extremem Speicherdruck trotz `navigator.storage.persist()` räumen; regelmäßige JSON-Backups bleiben sinnvoll.
- Vollständige Supabase-/Auth-E2E-Tests benötigen ein separates Testprojekt und Testkonto. Die normale Suite läuft ohne Secrets.
- PDF ist bewusst kompakt; sehr lange Notizen werden umbrochen, nicht als aufwendiges Tabellenlayout gesetzt.
