# Cypher ↔ GAINFORGE

Diese Datei beschreibt, wie der Assistent **Cypher** mit GAINFORGE spricht.
Stand: v3.2 (Priorität 4, Cypher-Vorbereitung). Cypher selbst ist noch nicht gebaut.

## Überblick

```
Sprache/Text ──► Cypher (LLM mit Tools) ──► GAINFORGE.actions.call(name, args) ──► Befehle ──► Firestore
                        ▲                                                        │
                        └──────────────── Ergebnis (JSON/Text) ◄─────────────────┘
```

Alles, was die App kann, läuft über **benannte Aktionen** (`js/actions.js`).
Die App-Oberfläche, das Terminal und später Cypher benutzen dieselben Befehle.
Dadurch kann Cypher nichts, was die App nicht auch kann, und die Regeln bleiben an einem Ort:
keine Einträge in der Zukunft, XP-Vergabe, automatische Aufgaben-Erledigung usw.

## Weg A (empfohlen für den Start): Cypher im Browser andocken

In der App (oder aus einem Skript, das in der Seite läuft):

```js
GAINFORGE.cypher.attach(async (text, api) => {
  // api.tools   -> Tool-Definitionen im Format der Claude-API
  // api.call(name, args) -> { ok, result } | { ok: false, error }
  // Hier: Claude-API mit tools: api.tools aufrufen, tool_use-Blöcke
  // über api.call() ausführen, Ergebnis zurückgeben, Antworttext liefern.
  return "Antwort an Silvan";
}, { name: "Cypher" });
```

Sobald `attach()` aufgerufen ist, wird die Blase unten rechts aktiv und öffnet einen Chat.
`GAINFORGE.cypher.detach()` trennt wieder.

**Tool-Loop (Pseudocode):**

```js
let messages = [{ role: "user", content: text }];
for (;;) {
  const res = await claude({ system, tools: api.tools, messages });
  messages.push({ role: "assistant", content: res.content });
  const uses = res.content.filter(b => b.type === "tool_use");
  if (!uses.length) return res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const results = [];
  for (const u of uses) {
    const r = await api.call(u.name, u.input);
    results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r), is_error: !r.ok });
  }
  messages.push({ role: "user", content: results });
}
```

Aktionen mit ⚠ löschen Daten. Cypher soll vorher nachfragen (steht auch in der Tool-Beschreibung).

**API-Schlüssel:** Niemals in den Code von GAINFORGE (öffentliches GitHub-Repo, GitHub Pages).
Der Claude-Aufruf gehört in ein kleines Backend (Phase „Backend“ im Cypher-Plan), z.B.
lokal auf dem PC (`personalJarvis`) oder eine Cloud Function, die nur eingeloggte Nutzer akzeptiert.

## Weg B: Cypher als eigenes Programm (Python, lokal)

Cypher kann auch direkt auf Firestore zugreifen, ohne dass die App offen ist:

- **Firebase Admin SDK** mit Service-Account-Schlüssel (`firebase_admin`, nur lokal speichern, nie ins Repo).
  Umgeht die Sicherheitsregeln, also nur auf dem eigenen Gerät verwenden.
- Pfade und Felder: siehe Datenstruktur unten. **Wichtig:** Die Regeln aus der App (Satz-Zeilen,
  XP, Teilschritte) stecken in JavaScript. Ein Python-Cypher muss sie nachbauen oder, einfacher,
  nur **lesen** und Schreibaktionen über Weg A laufen lassen.

Empfehlung: Weg A zum Schreiben, Weg B höchstens zum Lesen (z.B. Morgen-Briefing).

## Aktionen

`?` = optional. Namen von Übungen, Vorlagen und Projekten dürfen verkürzt sein
(„latzug“, „2“, „moto“). Ist ein Name mehrdeutig, kommt ein Fehler mit allen Treffern zurück.
Datum: `YYYY-MM-DD`, `heute` oder `gestern`, Standard ist heute.

| Aktion | Art | Parameter | Beschreibung |
|---|---|---|---|
| `fitness_status` | lesen | – | Überblick: aktuelle Bulk/Cut-Phase, Wochenschnitt Gewicht, Kurs zum Plan, Trainings diese Woche, Tagesziele (kcal, Protein). |
| `fitness_workout` | lesen | `date`?, `template`? | Stand eines Trainings: pro Übung Status (todo/partial/done/skipped), geloggte Sätze und Werte vom letzten Mal. |
| `fitness_exercise_history` | lesen | `exercise`, `limit`? | Verlauf einer Übung: letzte Trainings mit Sätzen und geschätztem Maximalgewicht (e1RM), plus Plateau-Status. |
| `fitness_plateaus` | lesen | – | Plateau-Radar: für jede geloggte Übung, ob sie Fortschritt macht, stagniert oder abfällt. |
| `fitness_list` | lesen | – | Alle Übungen und Vorlagen (mit geplanten Sätzen pro Übung). |
| `calendar_list` | lesen | `date`? | Aufgaben eines Tages plus offene Aufgaben der letzten 14 Tage. |
| `projects_list` | lesen | – | Alle Projekte mit Fortschritt, offenen Aufgaben und Sparziel. |
| `fitness_log_weight` | schreiben | `kg`, `date`? | Morgengewicht eintragen (überschreibt einen bestehenden Wert am selben Tag). |
| `fitness_delete_weight` | schreiben ⚠ | `date` | Gewichtseintrag eines Tages löschen. |
| `fitness_log_set` | schreiben | `exercise`, `set`, `kg`?, `reps`?, `date`?, `template`? | Einen Satz loggen: Gewicht und/oder Wiederholungen. Fehlende Satz-Zeilen werden automatisch ergänzt. |
| `fitness_remove_set` | schreiben | `exercise`, `set`, `date`?, `template`? | Eine Satz-Zeile entfernen (auch geplante). Beispiel: nur 1 von 2 Sätzen gemacht -> Satz 2 entfernen. |
| `fitness_skip_exercise` | schreiben | `exercise`, `date`?, `template`? | Übung in diesem Training überspringen (nur wenn noch nichts geloggt ist). |
| `fitness_copy_previous` | schreiben | `exercise`, `date`?, `template`? | Sätze vom letzten Mal in leere Felder übernehmen ('wie letztes Mal'). |
| `calendar_add_task` | schreiben | `text`, `date`? | Aufgabe im Tagesplaner eintragen. |
| `calendar_complete_task` | schreiben | `task`, `date`?, `done`? | Aufgabe im Tagesplaner als erledigt (oder wieder offen) markieren. Suche per Text. |
| `calendar_remove_task` | schreiben ⚠ | `task`, `date`? | Aufgabe aus dem Tagesplaner löschen. |
| `calendar_carry_over` | schreiben | – | Alle offenen Aufgaben der letzten 14 Tage auf heute verschieben. |
| `projects_add_task` | schreiben | `project`, `text`, `parent_task`? | Aufgabe (oder mit 'parent_task' einen Teilschritt) zu einem Projekt hinzufügen. |
| `projects_complete_task` | schreiben | `project`, `task`, `subtask`?, `done`? | Projekt-Aufgabe oder Teilschritt abhaken. Sind alle Teilschritte erledigt, wird die Aufgabe automatisch erledigt. |
| `projects_set_goal` | schreiben | `project`, `current`, `target`? | Stand eines Spar-/Zahlenziels setzen, z.B. Moto-Fonds auf 1400 CHF. |
| `ui_open` | schreiben | `view`, `project`? | Ein Panel in der App öffnen. |

Testen ohne Cypher im Terminal (`>_`):

```
actions
call fitness_status
call fitness_log_weight {"kg":78.6,"date":"gestern"}
call fitness_log_set {"exercise":"Chestpress","set":1,"kg":60,"reps":10}
```

In der Browser-Konsole: `await GAINFORGE.actions.call("projects_list")`, `GAINFORGE.actions.tools()`.

## Datenstruktur (Firestore)

Projekt `silvanos-1e7a0`, Login per E-Mail/Passwort. Alles liegt unter der UID des Nutzers.
Die Sicherheitsregeln (`firestore.rules`) erlauben nur Zugriff auf die eigene UID.

```
users/{uid}
  schema, email, xp, _created, _updated
  projects: [{ id, title, goal: { current, target, unit, rewarded } | null,
               tasks: [{ id, name, done, subtasks: [{ id, text, done }] }] }]
  fitness: { version: 3, weeklyTarget,
             exercises: [{ id, name }],
             templates: [{ id, name, items: [{ exId, sets }] }],
             plan: { startDate, startWeight, heightCm, creatineG,
                     phases: [{ name, months, kcalMin, kcalMax, proteinMin, proteinMax, targetWeight, targetBf }] } }

users/{uid}/workouts/{YYYY-MM-DD}_{templateId}
  date, templateId, updatedAt
  sets:  { <exId>: [{ kg, reps }] }     # kg null = Körpergewicht, Satz zählt ab reps > 0
  slots: { <exId>: n }                  # optional: Anzahl Satz-Zeilen ≠ Vorlage, 0 = übersprungen

users/{uid}/weights/{YYYY-MM-DD}      date, kg
users/{uid}/calendar/{YYYY-MM-DD}     date, tasks: [{ id, text, done }]
```

Regeln, die jede Schreibquelle einhalten muss:

- Daten sind reine Tagesstrings (`YYYY-MM-DD`), keine Zeitstempel mit Zeitzone. Keine Daten in der Zukunft.
- Ein Training ist eindeutig durch Datum + Vorlage (Dokument-ID).
- XP: Übung erstmals geloggt +5, Gewicht +2 (einmal pro Tag), Aufgabe +10, Teilschritt +5, Sparziel +50 (einmalig über `rewarded`).
- Aufgabe mit Teilschritten gilt als erledigt, sobald alle Teilschritte erledigt sind.

## Nächste Schritte (Cypher-Plan)

1. Kleines Backend mit dem Claude-API-Schlüssel (lokal oder Cloud Function), prüft das Firebase-ID-Token.
2. Handler für `GAINFORGE.cypher.attach()`, der Text an das Backend schickt und den Tool-Loop ausführt.
3. Sprache: Web Speech API (Diktieren) in der Blase, danach TTS für Antworten.
4. Optional: Morgen-Briefing aus `fitness_status` + `calendar_list` + `projects_list`.
