# SILVAN.OS v3

Persönliches Life-Dashboard im HUD/Terminal-Look. Installierbar als PWA, Login und Daten über Firebase (funktioniert auch offline).

## Was neu ist (v3.2 · NEXUS-Look)

- **Neues Design** im Stil von NEXUS: Glass-Kacheln mit Neon-Kante, Orbitron + JetBrains Mono, Grid/Scanlines/Sweep im Hintergrund, Boot-Sequenz, Reticle beim Antippen. Akzentfarbe unter Einstellungen wählbar.
- **Infos erst beim Antippen:** Die Startseite zeigt pro Bereich nur eine Kennzahl. Details öffnen sich im Panel (Handy: Bottom-Sheet, nach unten wischen oder Zurück-Geste schliesst; Desktop: rechts).
- **Training als Akkordeon:** immer nur eine Übung offen, nach dem letzten Satz automatisch die nächste. Jede Satz-Zeile lässt sich entfernen, auch geplante (1 statt 2 Sätze → Übung gilt als erledigt). „+ Satz“ und „Überspringen“ werden gespeichert. „Übernehmen“ füllt die Werte vom letzten Mal ein.
- **Terminal** (Knopf `>_`): `gewicht 78.6 [gestern]`, `status`, `training [nr]`, `plateau`, `todo <text>`, `theme <farbe>`, `help`.
- **Logik-Fixes:** keine Einträge in der Zukunft; Projekt-Fortschritt zählt Teilschritte; alle Teilschritte erledigt → Aufgabe erledigt; Sparziel-Bonus nur einmal; offene Aufgaben früherer Tage „nach heute holen“; Aufgaben im Planer umbenennbar.

## Was neu ist (v3 · Fitness)

- **Datums-Bugfix:** Trainings werden über Datum + Vorlage gespeichert (`2026-09-24_s1`), nicht mehr über „aktuelle Woche + Session“. Nachtragen in vergangenen Wochen funktioniert, nichts springt mehr auf „heute“. Datumswerte sind reine `YYYY-MM-DD`-Strings, gerechnet wird zeitzonenfrei (`js/dates.js`). Alte Duplikate werden beim ersten Start automatisch zusammengeführt.
- **Sätze einzeln loggen** (kg × Wdh. pro Satz), mit „Letztes Mal“-Werten als Platzhalter. `62,5` mit Komma geht auch.
- **Übungen & Vorlagen verwalten:** hinzufügen, umbenennen, Reihenfolge ▲▼, Ziel-Sätze, entfernen, eigene Vorlagen anlegen/kopieren/löschen. Der Verlauf hängt an der Übungs-ID und bleibt beim Umbenennen oder Entfernen erhalten.
- **Letzte Trainings:** öffnen, Datum/Vorlage ändern (verschieben, bei Bedarf zusammenführen), löschen.
- **Fortschritts-Chart pro Übung:** echte Zeitachse, Metriken e1RM / Top-Gewicht / Volumen / Wdh., Ø über 3 Trainings, Trendlinie, Zeitraum 4 W / 3 M / 6 M / Alles.
- **Plateau-Radar:** Plateau = seit ≥ 4 Trainings und ≥ 2 Wochen kein neuer e1RM-Bestwert; Rückgang = Trend < −1.5 %/Woche.
- **Gewicht:** Morgengewicht mit wählbarem Datum, Kalenderwochen-Durchschnitt als Hauptzahl, Chart mit Tageswerten als Punkte + Wochen-Ø-Linie + gestrichelter Plan-Linie.
- **Bulk/Cut-Plan** (editierbar): aktuelle Phase, kcal/Protein-Ziel, und ob der Wochenschnitt im Kurs liegt (±0.5 kg um die Soll-Linie) inkl. konkreter Anpassung.

## Was in v2 dazukam

- **Fitness:** fixe Übungsreihenfolge (Chestpress → Schrägbank → Cable Flys H2L/L2H → Latzug → Rudern eng/breit → Seitheben → Schulterpresse → Bizeps → Brachialis → Trizeps → Bauch gerade/seitlich), 2x/Woche. Pro Übung Gewicht (kg) + Wiederholungen loggen, und im **Übungs-Verlauf** unten einzeln per Dropdown den Gewichts- und Reps-Verlauf als Chart ansehen.
- **Kalender statt Roadmap:** Sektion 05 ist jetzt ein **Tagesplaner** — Wochenstreifen zum Navigieren, pro Tag frei Aufgaben hinzufügen/abhaken.
- **Lehre / Moto-Fonds / Steal & Escape sind jetzt generische, frei editierbare Projekt-Panels:**
  - Titel direkt anklicken & umbenennen
  - Aufgaben hinzufügen/umbenennen/löschen, mit optionalen Teilschritten (aufklappbar)
  - Optionales Zahlenziel (z.B. Sparfortschritt) hinzufügen/entfernen — nicht nur für Moto, für jedes Projekt
  - Ganze Projekte löschen oder über **+ NEUES PROJEKT / TAB** neue anlegen — die Nummerierung (02, 03, 04...) passt sich automatisch an
- **Als App installierbar (PWA):** Manifest + Service Worker für Offline-Start und "Zum Homescreen hinzufügen" auf dem Handy.

## Lokal testen

`index.html` direkt öffnen, oder für sauberes PWA/Service-Worker-Verhalten:
```bash
python3 -m http.server
```
dann `http://localhost:8000` öffnen.

## Auf GitHub pushen

```bash
cd silvanos
git init
git add .
git commit -m "SILVAN.OS v2"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/silvanos.git
git push -u origin main
```

## Live hosten mit GitHub Pages (gratis, nötig für PWA-Installation)

1. Repo auf GitHub → **Settings → Pages**
2. Source: **Deploy from a branch** → Branch `main`, Ordner `/ (root)` → Save
3. Nach ~1 Minute läuft es unter `https://DEIN-USERNAME.github.io/silvanos/`

PWA-Installation (Homescreen) braucht HTTPS — GitHub Pages liefert das automatisch. Über `file://` startet die App nicht (ES-Module + Firebase), über `localhost` schon. Für lokales Testen `localhost` zusätzlich in Firebase unter *Authorized domains* eintragen (ist standardmässig drin).

## App aufs Handy installieren

- **Android/Chrome:** Seite öffnen → Menü (⋮) → "Zum Startbildschirm hinzufügen" / "App installieren"
- **iOS/Safari:** Seite öffnen → Teilen-Icon → "Zum Home-Bildschirm"

Danach läuft SILVAN.OS wie eine native App (eigenes Icon, kein Browser-UI, funktioniert offline für die Oberfläche selbst).

## Login & Daten (Firebase)

SILVAN.OS nutzt **Firebase Authentication** (E-Mail/Passwort) und **Cloud Firestore**. Die E-Mail ist nur ein eindeutiger Login-Name: Sie muss nicht existieren, es wird nichts verschickt. Jeder Nutzer sieht ausschliesslich seine eigenen Daten. Der Login bleibt gespeichert wie bei einer normalen App.

- **Offline:** Firestore hat einen lokalen Cache. Änderungen ohne Netz werden gespeichert und automatisch hochgeladen. Die Anzeige oben neben dem Namen zeigt ✓ / SYNC / OFFLINE / FEHLER.
- **Mehrere Geräte:** Änderungen erscheinen live auf allen eingeloggten Geräten.
- **Erstes Login:** Liegen auf dem Gerät noch Daten der alten Version (lokale Konten / Gist-Sync), bietet die App an, sie zu übernehmen. Alternativ ein JSON-Backup importieren oder leer starten. Alte GitHub-Tokens werden dabei vom Gerät gelöscht.
- **Passwort vergessen:** Da keine echte E-Mail nötig ist, geht Zurücksetzen per Mail nicht. In der Firebase Console unter *Authentication → Users* kann das Passwort neu gesetzt oder das Konto gelöscht werden.

### Einrichtung (einmalig, schon erledigt für `silvanos-1e7a0`)

1. Firebase-Projekt anlegen, Web-App registrieren, Config in `js/firebase.js` eintragen
2. *Authentication → Sign-in method* → **E-Mail/Passwort** aktivieren
3. *Firestore Database* anlegen
4. *Firestore → Regeln*: Inhalt von [`firestore.rules`](firestore.rules) einfügen → **Veröffentlichen**
5. *Authentication → Settings → Authorized domains*: `peppigminze.github.io` hinzufügen

### Datenmodell (Firestore)

```
users/{uid}                                 Profil + kleine Daten
  schema, email, xp, projects[],
  fitness { version, exercises[], templates[], plan{}, weeklyTarget }
users/{uid}/workouts/{YYYY-MM-DD_<tplId>}   { date, templateId, sets{ <exId>: [{kg, reps}] }, updatedAt }
users/{uid}/weights/{YYYY-MM-DD}            { date, kg }
users/{uid}/calendar/{YYYY-MM-DD}           { date, tasks[{id, text, done}] }
```

Die App hält alles in einem `data`-Objekt; `js/store.js` bildet es auf diese Dokumente ab und schreibt bei jeder Änderung nur die Dokumente, die sich geändert haben. Cypher kann später mit dem Firebase-SDK (oder Admin-SDK) direkt auf dieselben Pfade zugreifen.

**EXPORT/IMPORT** unten bleibt als manuelles JSON-Backup.

## Struktur

```
silvanos/
├── index.html
├── style.css
├── app.js                 # verbindet: Login, Kacheln, Panels, Einstellungen, Terminal-Befehle, Boot
├── firestore.rules        # Sicherheitsregeln (in Firebase Console einfügen)
├── js/
│   ├── firebase.js        # Firebase-SDK + Config (einzige Stelle)
│   ├── store.js           # data <-> Firestore-Dokumente, Diff-Speichern, Live-Updates
│   ├── legacy.js          # alte lokale Daten für die Migration finden
│   ├── core.js            # gemeinsamer Kontext (Daten, Speichern, XP, Änderungs-Events)
│   ├── projects.js        # Projekte: Befehle, Kacheln, Panel
│   ├── calendar.js        # Tagesplaner: Befehle, Kachel, Panel
│   ├── ui/
│   │   ├── sheet.js       # Detail-Panel / Bottom-Sheet
│   │   ├── fx.js          # Boot, Reticle, Toast, Sparkline, Ring
│   │   └── terminal.js    # Terminal + Befehlsregister (runCommand)
│   ├── dates.js           # zeitzonensichere Kalendertag-Logik
│   └── fitness/
│       ├── model.js       # Datenmodell, Migration, reine Mutationen
│       ├── analytics.js   # e1RM, Trends, Plateau, Wochen-Ø, Plan-Kurs
│       ├── charts.js      # Chart.js-Diagramme
│       ├── commands.js    # benannte Aktionen (öffentliche API, Cypher-ready)
│       └── ui.js          # Darstellung + Eingaben
├── manifest.json          # PWA-Manifest
├── service-worker.js      # Offline-Caching des App-Shells
├── serve.js               # optionaler lokaler Dev-Server (node serve.js)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md
```

## Anpassen

- Übungen, Vorlagen und Bulk/Cut-Plan: direkt in der App (Fitness → „Übungen & Vorlagen verwalten“ bzw. „Bulk/Cut-Plan bearbeiten“)
- Alle Fitness-Aktionen gibt es auch als Funktionen, z.B. in der Browser-Konsole: `SILVAN.fitness.logWeight("2026-09-24", 78.6)`
- Standard-Inhalte der Projekt-Panels: `defaultProjects()` in `app.js`. Greift nur bei einem neuen Konto ohne übernommene Daten.
- Alles andere (Projekte, Aufgaben, Kalender) editierst du direkt in der laufenden App
