# Zeitstempel Arbeitszeiten

Eine bewusst einfache, vollständig deutsche und local-first Arbeitszeiterfassung für iPhone und Desktop. Baustellen, Stempelvorgänge, Pausen und Änderungen werden zuerst atomar in IndexedDB gespeichert. Eine persistente Outbox synchronisiert sie anschließend mit Convex; Netzwerkfehler löschen niemals lokale Daten.

## Architektur

- Vite, React und TypeScript Strict Mode
- Dexie/IndexedDB als primäre Datenquelle, getrennt nach `user_id`
- atomare Entitäts-/Outbox-Transaktionen, Soft Deletes und persistente Konfliktkopien
- Convex Auth mit E-Mail/Passwort, reaktive Queries und revisionsgeprüfter Sync
- zentrale Europe/Berlin-Domainlogik für UI, Wochen-/Monatssummen, CSV und PDF
- Workbox-PWA mit App-Shell-Cache, Update-Hinweis, Safe Areas und lokalen Icons
- idempotente Migration von `zt_v1` und `zt_v2` mit unveränderter Rohdatensicherung

Ohne `VITE_CONVEX_URL` kann die lokale Demo ohne Konto gestartet werden. Echte Konten und Synchronisierung benötigen ein erreichbares Convex-Deployment.

Convex ist das Backend der App. Der lokale Entwicklungs-Stack wird mit `npm run convex:once` gestartet. Das Production-Build nutzt die bereitgestellte Convex-Cloud-Deployment-URL aus `.env.production`; das Schema liegt in `convex/schema.ts`, Auth in `convex/auth.ts`, Datenzugriff in `convex/records.ts`. Es ist keine Datenmigration erforderlich, weil das frühere Backend leer ist.

## Status und Umfang

**Implementierter Browser/PWA-Prototyp.** Der aktuelle Quellstand enthält die lokale Zeiterfassung, Convex-Auth/Sync, Offline-Outbox, Konfliktkopien, Migration, CSV/PDF-Export und eine Demo ohne Login. Eine native iOS-App oder ein separates Mobile-Binary ist nicht Bestandteil dieses Repositories.

Eine separate Feature-Roadmap ist im Repository nicht festgelegt. Für einen produktiven Betrieb müssen ein erreichbares Convex-Deployment und ein separates Testkonto für den vollständigen Auth-E2E-Pfad vorhanden sein; beides wird hier nicht als bereits bereitgestellt behauptet.

## Öffentliche Vorschau ohne Login

Die Oberfläche kann ohne Konto als lokale Demo geöffnet werden:

- Verifizierte anonyme Production-Demo: `https://arbeitszeitenapp.vercel.app/?demo=1`
- lokal: `http://localhost:5173/?demo=1`

Die Demo legt ausschließlich Beispieldaten in einem getrennten lokalen `demo-preview`-Profil an. Änderungen werden nicht an Convex gesendet. Echte Arbeitsdaten bleiben hinter dem Convex-Auth-Login geschützt. Auf der Login-Seite gibt es zusätzlich den Button „Demo ansehen – ohne Login“.

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

Lokale Konfiguration (`.env.local`):

```env
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
```

Das Production-Build verwendet `.env.production` mit der öffentlichen Convex-Cloud-URL. Diese URLs sind keine Geheimnisse; Authentifizierung und Arbeitsdaten bleiben serverseitig geschützt.

## Auth und Sync

Neue Konten werden direkt über Convex Auth mit E-Mail und Passwort erstellt. Arbeitsdaten bleiben zuerst in IndexedDB und werden über die Convex-Outbox synchronisiert. Convex filtert alle Daten serverseitig nach dem angemeldeten Konto.

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

- Mit E-Mail und Passwort anmelden, App schließen/neu öffnen und persistente Session prüfen.
- Baustelle anlegen, auswählen, stempeln, Pause starten, App beenden und Zustand prüfen.
- Offline Arbeitszeit erstellen, neu laden, anschließend online gehen und Syncstatus beobachten.
- Nachtschicht über Mitternacht manuell erfassen und Wochen-/Monatssumme kontrollieren.
- Zwei Blöcke am selben Tag in CSV/PDF prüfen; Tagessaldo darf nur einmal erscheinen.
- Homescreen-Icon, Standalone-Modus, Safe Areas, Touchziele und Update-Hinweis prüfen.
- JSON-Backup speichern und die Alt-Datensicherung kontrollieren.

## Verbleibende Grenzen

- Safari kann Website-Speicher unter extremem Speicherdruck trotz `navigator.storage.persist()` räumen; regelmäßige JSON-Backups bleiben sinnvoll.
- Vollständige Convex-Auth-E2E-Tests benötigen ein separates Testkonto. Die normale Suite läuft ohne Secrets.
- PDF ist bewusst kompakt; sehr lange Notizen werden umbrochen, nicht als aufwendiges Tabellenlayout gesetzt.
