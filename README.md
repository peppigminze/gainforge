# SILVAN.OS v3

Persönliches Life-Dashboard im HUD/Terminal-Look. Installierbar als PWA, Daten lokal + optional Cloud-Sync über eine private GitHub Gist.

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

PWA-Installation (Homescreen) braucht HTTPS — GitHub Pages liefert das automatisch. Lokal über `file://` funktioniert der Service Worker nicht zuverlässig, über `localhost` schon.

## App aufs Handy installieren

- **Android/Chrome:** Seite öffnen → Menü (⋮) → "Zum Startbildschirm hinzufügen" / "App installieren"
- **iOS/Safari:** Seite öffnen → Teilen-Icon → "Zum Home-Bildschirm"

Danach läuft SILVAN.OS wie eine native App (eigenes Icon, kein Browser-UI, funktioniert offline für die Oberfläche selbst).

## Mehrere Konten / Login

Beim Start fragt SILVAN.OS nach einem Konto (E-Mail/Benutzername + Passwort). So können sich mehrere Personen dasselbe Gerät teilen, ohne sich die Daten zu vermischen — jedes Konto hat seine eigenen Fitness-/Projekt-/Kalenderdaten.

Wichtig: Es gibt keinen eigenen Server. Das Passwort schützt nur den Login-Bildschirm auf diesem Gerät (lokal geprüft per PBKDF2-Hash) — es wird nirgends hochgeladen und lässt sich bei Verlust nicht zurücksetzen, ausser durch Neuanlegen des Kontos. Damit ein Konto **geräteübergreifend** dieselben Daten zeigt, braucht jedes Konto beim ersten Verbinden auf einem neuen Gerät seinen eigenen GitHub-Token (s. Cloud Sync unten) — der Token identifiziert dabei die private Gist mit den echten Daten.

Bereits bestehende (Vor-Account-)Daten auf einem Gerät werden beim ersten Start automatisch als erstes Konto übernommen, nichts geht verloren.

## Geräteübergreifend synchronisieren (Cloud Sync)

Cloud Sync ist die Grundlage für Konten, die auf mehreren Geräten dieselben Daten zeigen sollen. Pro Konto einmal einrichten:

1. [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) → **Generate new token**
2. Permissions → Account permissions → **Gists: Read and write**
3. Token generieren, kopieren
4. Beim Verbinden eines neuen Kontos im Login-Bildschirm (oder danach in der App oben auf **EINRICHTEN**) → Token einfügen → **VERBINDEN**
5. Auf jedem weiteren Gerät mit derselben E-Mail + demselben Token einloggen → App findet die Gist automatisch

Der Token bleibt nur in `localStorage` des jeweiligen Geräts (pro Konto separat) und geht ausschliesslich direkt an `api.github.com`. Änderungen synct die App automatisch (leicht verzögert, gebündelt). Ohne Verbindung läuft ein Konto rein lokal auf diesem Gerät; **EXPORT/IMPORT** unten bleibt zusätzlich als manuelles JSON-Backup.

## Struktur

```
silvanos/
├── index.html
├── style.css
├── app.js                 # ES-Modul: Konten, Sync, Projekte, Kalender, Theme
├── js/
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
- Standard-Inhalte der drei mitgelieferten Projekt-Panels: `defaultProjects()` in `app.js` — greift aber nur beim allerersten Start (danach übernimmt `localStorage`/die Gist)
- Alles andere (Projekte, Aufgaben, Kalender) editierst du direkt in der laufenden App
