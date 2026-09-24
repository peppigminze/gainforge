/* ============================================================
   actions.js — Aktionsregister für Cypher (und Terminal/Konsole)
   ------------------------------------------------------------
   Jede Aktion: name, kind ("read" | "write"), destructive?,
   description, params (JSON-Schema-Properties), required, run(args).
   - listActions()        -> Übersicht
   - toolSchemas()        -> Array im Tool-Format der Claude-API
                             ({ name, description, input_schema })
   - callAction(name, a)  -> { ok: true, result } | { ok: false, error }
   Übungen/Vorlagen/Projekte dürfen per Name angesprochen werden
   ("Chestpress", "Training 2", "Lehre") — Auflösung passiert hier.
   Keine UI-Logik hier drin; die App ruft dieselben Befehle auf.
   ============================================================ */
import { fitness } from "./fitness/commands.js";
import { findTemplate, exerciseName, validSets, workoutKey, workoutHasData, exerciseStatus, slotCount } from "./fitness/model.js";
import { weightEntries, weeklyAverages, courseStatus, currentPhase, exerciseSeries, plateauStatus, previousPerformance } from "./fitness/analytics.js";
import { projects, projectProgress } from "./projects.js";
import { calendar, overdue } from "./calendar.js";
import { todayKey, addDays, mondayOf, isDayKey } from "./dates.js";

const actions = new Map();
let uiHooks = { open: () => false };
/** app.js reicht hier die Funktionen zum Öffnen von Panels rein. */
export function bindActionUI(hooks) { uiHooks = { ...uiHooks, ...hooks }; }

function def(name, spec) { actions.set(name, { name, kind: "write", destructive: false, required: [], params: {}, ...spec }); }

/* ---------------- Auflösung von Namen ---------------- */
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function resolveDate(d) {
  if (d == null || d === "" || d === "heute" || d === "today") return todayKey();
  if (d === "gestern" || d === "yesterday") return addDays(todayKey(), -1);
  if (isDayKey(d)) return d;
  const m = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(String(d).trim());
  if (m) { const k = `${m[3] || todayKey().slice(0, 4)}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (isDayKey(k)) return k; }
  throw new Error(`Datum nicht erkannt: "${d}" (erwartet YYYY-MM-DD, "heute" oder "gestern")`);
}

function pick(list, query, label, getName) {
  const q = norm(query);
  if (!q) throw new Error(`${label} fehlt`);
  const exact = list.filter(x => norm(x.id) === q || norm(getName(x)) === q);
  if (exact.length === 1) return exact[0];
  const part = list.filter(x => norm(getName(x)).includes(q));
  if (part.length === 1) return part[0];
  if (!part.length) throw new Error(`${label} "${query}" nicht gefunden. Vorhanden: ${list.map(getName).join(", ")}`);
  throw new Error(`${label} "${query}" ist mehrdeutig: ${part.map(getName).join(", ")}`);
}

const findExercise = q => pick(fitness.getState().exercises, q, "Übung", e => e.name);
function findTpl(q) {
  const f = fitness.getState();
  if (/^\d+$/.test(String(q))) { const t = f.templates[+q - 1]; if (t) return t; }
  return pick(f.templates, q, "Vorlage", t => t.name);
}
/** Welche Vorlage ist gemeint, wenn keine angegeben ist? Die vom Tag, sonst die erste mit der Übung. */
function templateFor(exId, date, tplQuery) {
  const f = fitness.getState();
  if (tplQuery) return findTpl(tplQuery);
  const withEx = f.templates.filter(t => t.items.some(i => i.exId === exId));
  const sameDay = withEx.find(t => workoutHasData(f.workouts[workoutKey(date, t.id)]));
  if (sameDay) return sameDay;
  const anyDay = f.templates.find(t => workoutHasData(f.workouts[workoutKey(date, t.id)]));
  if (anyDay && (withEx.includes(anyDay) || !withEx.length)) return anyDay;
  if (withEx.length) return withEx[0];
  throw new Error(`"${exerciseName(f, exId)}" ist in keiner Vorlage — "template" angeben`);
}
function setContext(a) {
  const ex = findExercise(a.exercise);
  const date = resolveDate(a.date);
  const tpl = templateFor(ex.id, date, a.template);
  const item = tpl.items.find(i => i.exId === ex.id);
  return { ex, date, tpl, defaultSets: item ? item.sets : 0 };
}
const findProject = q => pick(projects.list(), q, "Projekt", p => p.title);
const findTask = (p, q) => pick(p.tasks, q, "Aufgabe", t => t.name);
const setsText = sets => sets.map(s => `${s.kg ?? 0}×${s.reps}`).join(", ");

/* ---------------- Gemeinsame Parameter ---------------- */
const P = {
  date: { type: "string", description: "Datum YYYY-MM-DD, 'heute' oder 'gestern'. Standard: heute." },
  exercise: { type: "string", description: "Übungsname oder -ID, z.B. 'Chestpress'" },
  template: { type: "string", description: "Vorlage (Name oder Nummer, z.B. 'Training 2' oder '2'). Optional, wird sonst erraten." },
  set: { type: "integer", description: "Satznummer, beginnt bei 1" },
  project: { type: "string", description: "Projektname, z.B. 'Lehre'" },
};

/* ============================================================
   LESEN
   ============================================================ */
def("fitness_status", {
  kind: "read", description: "Überblick: aktuelle Bulk/Cut-Phase, Wochenschnitt Gewicht, Kurs zum Plan, Trainings diese Woche, Tagesziele (kcal, Protein).",
  run: () => {
    const f = fitness.getState();
    const today = todayKey();
    const weekly = weeklyAverages(weightEntries(f));
    const cur = weekly.find(w => w.monday === mondayOf(today));
    const c = courseStatus(f, today);
    const ph = currentPhase(f.plan);
    const monday = mondayOf(today);
    const done = Object.values(f.workouts).filter(w => w.date >= monday && w.date <= addDays(monday, 6) && workoutHasData(w));
    return {
      today,
      phase: ph && ph.state === "active" ? { name: ph.seg.name, month: ph.monthNo, of: ph.seg.months, kcal: [ph.seg.kcalMin, ph.seg.kcalMax], protein_g: [ph.seg.proteinMin, ph.seg.proteinMax], target_kg: ph.seg.targetWeight } : (ph ? ph.state : null),
      weight: { week_avg_kg: cur ? +cur.avg.toFixed(2) : null, measurements_this_week: cur ? cur.n : 0, weighed_today: f.weights[today] != null, course: c.state, course_text: `${c.title}. ${c.text}`, rate_kg_per_week: c.rate },
      training: { this_week: done.length, target: f.weeklyTarget, sessions: done.map(w => ({ date: w.date, template: (findTemplate(f, w.templateId) || {}).name })) },
      creatine_g: f.plan.creatineG,
    };
  },
});
def("fitness_workout", {
  kind: "read", description: "Stand eines Trainings: pro Übung Status (todo/partial/done/skipped), geloggte Sätze und Werte vom letzten Mal.",
  params: { date: P.date, template: P.template },
  run: a => {
    const f = fitness.getState();
    const date = resolveDate(a.date);
    const tpl = a.template ? findTpl(a.template) : (f.templates.find(t => workoutHasData(f.workouts[workoutKey(date, t.id)])) || f.templates[0]);
    const key = workoutKey(date, tpl.id);
    const w = f.workouts[key];
    return {
      date, template: tpl.name,
      exercises: tpl.items.map(i => {
        const prev = previousPerformance(f, i.exId, date, key);
        return {
          exercise: exerciseName(f, i.exId), status: exerciseStatus(w, i.exId, i.sets), planned_sets: slotCount(w, i.exId, i.sets),
          logged: w ? setsText(validSets(w.sets[i.exId])) : "", last_time: prev ? `${prev.date}: ${setsText(prev.sets)}` : null,
        };
      }),
    };
  },
});
def("fitness_exercise_history", {
  kind: "read", description: "Verlauf einer Übung: letzte Trainings mit Sätzen und geschätztem Maximalgewicht (e1RM), plus Plateau-Status.",
  params: { exercise: P.exercise, limit: { type: "integer", description: "Anzahl Trainings (Standard 6)" } }, required: ["exercise"],
  run: a => {
    const ex = findExercise(a.exercise);
    const series = exerciseSeries(fitness.getState(), ex.id);
    const st = plateauStatus(series);
    return { exercise: ex.name, status: st.status, status_text: `${st.label}: ${st.detail}`,
      sessions: series.slice(-(a.limit || 6)).map(s => ({ date: s.date, sets: setsText(s.sets), e1rm_kg: +s.e1rm.toFixed(1) })) };
  },
});
def("fitness_plateaus", {
  kind: "read", description: "Plateau-Radar: für jede geloggte Übung, ob sie Fortschritt macht, stagniert oder abfällt.",
  run: () => {
    const f = fitness.getState();
    return f.exercises.map(e => ({ e, s: exerciseSeries(f, e.id) })).filter(x => x.s.length)
      .map(x => { const st = plateauStatus(x.s); return { exercise: x.e.name, status: st.status, weekly_pct: st.weeklyPct }; });
  },
});
def("fitness_list", {
  kind: "read", description: "Alle Übungen und Vorlagen (mit geplanten Sätzen pro Übung).",
  run: () => {
    const f = fitness.getState();
    return { exercises: f.exercises.map(e => e.name), templates: f.templates.map((t, i) => ({ nr: i + 1, name: t.name, items: t.items.map(it => `${exerciseName(f, it.exId)} ×${it.sets}`) })) };
  },
});
def("calendar_list", {
  kind: "read", description: "Aufgaben eines Tages plus offene Aufgaben der letzten 14 Tage.",
  params: { date: P.date },
  run: a => {
    const date = resolveDate(a.date);
    return { date, tasks: calendar.tasks(date).map(t => ({ text: t.text, done: t.done })), overdue: overdue().map(o => ({ date: o.date, text: o.task.text })) };
  },
});
def("projects_list", {
  kind: "read", description: "Alle Projekte mit Fortschritt, offenen Aufgaben und Sparziel.",
  run: () => projects.list().map(p => ({
    project: p.title, progress_pct: Math.round(projectProgress(p)),
    goal: p.goal ? `${p.goal.current}/${p.goal.target} ${p.goal.unit}` : null,
    open_tasks: p.tasks.filter(t => !t.done).map(t => t.name + ((t.subtasks || []).length ? ` (${t.subtasks.filter(s => s.done).length}/${t.subtasks.length})` : "")),
  })),
});

/* ============================================================
   SCHREIBEN
   ============================================================ */
def("fitness_log_weight", {
  description: "Morgengewicht eintragen (überschreibt einen bestehenden Wert am selben Tag).",
  params: { kg: { type: "number", description: "Gewicht in kg, z.B. 78.6" }, date: P.date }, required: ["kg"],
  run: a => { const date = resolveDate(a.date); fitness.logWeight(date, +a.kg); return `${(+a.kg).toFixed(1)} kg am ${date} gespeichert`; },
});
def("fitness_delete_weight", {
  destructive: true, description: "Gewichtseintrag eines Tages löschen.",
  params: { date: P.date }, required: ["date"],
  run: a => { const date = resolveDate(a.date); fitness.deleteWeight(date); return `Gewicht vom ${date} gelöscht`; },
});
def("fitness_log_set", {
  description: "Einen Satz loggen: Gewicht und/oder Wiederholungen. Fehlende Satz-Zeilen werden automatisch ergänzt.",
  params: { exercise: P.exercise, set: P.set, kg: { type: "number", description: "Gewicht in kg (0 = Körpergewicht)" }, reps: { type: "integer", description: "Wiederholungen" }, date: P.date, template: P.template },
  required: ["exercise", "set"],
  run: a => {
    const c = setContext(a);
    const idx = Math.max(1, Math.round(+a.set)) - 1;
    while (slotCount(fitness.getState().workouts[workoutKey(c.date, c.tpl.id)], c.ex.id, c.defaultSets) <= idx) {
      fitness.addSetRow({ date: c.date, templateId: c.tpl.id, exerciseId: c.ex.id, defaultSets: c.defaultSets });
    }
    const patch = {};
    if (a.kg !== undefined) patch.kg = a.kg === null ? null : +a.kg;
    if (a.reps !== undefined) patch.reps = a.reps === null ? null : Math.round(+a.reps);
    if (!Object.keys(patch).length) throw new Error("kg oder reps angeben");
    fitness.logSet({ date: c.date, templateId: c.tpl.id, exerciseId: c.ex.id, setIndex: idx, ...patch });
    return `${c.ex.name} Satz ${idx + 1}: ${patch.kg ?? "–"} kg × ${patch.reps ?? "–"} (${c.tpl.name}, ${c.date})`;
  },
});
def("fitness_remove_set", {
  description: "Eine Satz-Zeile entfernen (auch geplante). Beispiel: nur 1 von 2 Sätzen gemacht -> Satz 2 entfernen.",
  params: { exercise: P.exercise, set: P.set, date: P.date, template: P.template }, required: ["exercise", "set"],
  run: a => { const c = setContext(a); fitness.removeSetRow({ date: c.date, templateId: c.tpl.id, exerciseId: c.ex.id, setIndex: Math.round(+a.set) - 1, defaultSets: c.defaultSets }); return `${c.ex.name}: Satz ${a.set} entfernt`; },
});
def("fitness_skip_exercise", {
  description: "Übung in diesem Training überspringen (nur wenn noch nichts geloggt ist).",
  params: { exercise: P.exercise, date: P.date, template: P.template }, required: ["exercise"],
  run: a => { const c = setContext(a); fitness.skipExercise({ date: c.date, templateId: c.tpl.id, exerciseId: c.ex.id, defaultSets: c.defaultSets }); return `${c.ex.name} übersprungen`; },
});
def("fitness_copy_previous", {
  description: "Sätze vom letzten Mal in leere Felder übernehmen ('wie letztes Mal').",
  params: { exercise: P.exercise, date: P.date, template: P.template }, required: ["exercise"],
  run: a => { const c = setContext(a); const r = fitness.copyPrevious({ date: c.date, templateId: c.tpl.id, exerciseId: c.ex.id, defaultSets: c.defaultSets }); return `${c.ex.name}: ${r.copied} Sätze übernommen`; },
});
def("calendar_add_task", {
  description: "Aufgabe im Tagesplaner eintragen.",
  params: { text: { type: "string", description: "Aufgabentext" }, date: P.date }, required: ["text"],
  run: a => { const date = resolveDate(a.date); calendar.addTask(date, a.text); return `Eingetragen für ${date}: ${a.text}`; },
});
def("calendar_complete_task", {
  description: "Aufgabe im Tagesplaner als erledigt (oder wieder offen) markieren. Suche per Text.",
  params: { task: { type: "string", description: "Text oder Teil davon" }, date: P.date, done: { type: "boolean", description: "Standard true" } }, required: ["task"],
  run: a => {
    const date = resolveDate(a.date);
    const t = pick(calendar.tasks(date), a.task, "Aufgabe", x => x.text);
    const want = a.done !== false;
    if (t.done !== want) calendar.toggleTask(date, t.id);
    return `${t.text}: ${want ? "erledigt" : "offen"}`;
  },
});
def("calendar_remove_task", {
  destructive: true, description: "Aufgabe aus dem Tagesplaner löschen.",
  params: { task: { type: "string", description: "Text oder Teil davon" }, date: P.date }, required: ["task"],
  run: a => { const date = resolveDate(a.date); const t = pick(calendar.tasks(date), a.task, "Aufgabe", x => x.text); calendar.removeTask(date, t.id); return `Gelöscht: ${t.text}`; },
});
def("calendar_carry_over", {
  description: "Alle offenen Aufgaben der letzten 14 Tage auf heute verschieben.",
  run: () => `${calendar.carryOver()} Aufgaben nach heute geholt`,
});
def("projects_add_task", {
  description: "Aufgabe (oder mit 'parent_task' einen Teilschritt) zu einem Projekt hinzufügen.",
  params: { project: P.project, text: { type: "string", description: "Aufgabentext" }, parent_task: { type: "string", description: "Optional: bestehende Aufgabe, unter die ein Teilschritt kommt" } },
  required: ["project", "text"],
  run: a => {
    const p = findProject(a.project);
    if (a.parent_task) { const t = findTask(p, a.parent_task); projects.addSub(p.id, t.id, a.text); return `Teilschritt bei „${t.name}“: ${a.text}`; }
    projects.addTask(p.id, a.text); return `Aufgabe in ${p.title}: ${a.text}`;
  },
});
def("projects_complete_task", {
  description: "Projekt-Aufgabe oder Teilschritt abhaken. Sind alle Teilschritte erledigt, wird die Aufgabe automatisch erledigt.",
  params: { project: P.project, task: { type: "string", description: "Aufgabe" }, subtask: { type: "string", description: "Optional: Teilschritt dieser Aufgabe" }, done: { type: "boolean", description: "Standard true" } },
  required: ["project", "task"],
  run: a => {
    const p = findProject(a.project); const t = findTask(p, a.task); const want = a.done !== false;
    if (a.subtask) { const s = pick(t.subtasks || [], a.subtask, "Teilschritt", x => x.text); if (s.done !== want) projects.toggleSub(p.id, t.id, s.id); return `${s.text}: ${want ? "erledigt" : "offen"}`; }
    if (t.done !== want) projects.toggleTask(p.id, t.id);
    return `${t.name}: ${want ? "erledigt" : "offen"}`;
  },
});
def("projects_set_goal", {
  description: "Stand eines Spar-/Zahlenziels setzen, z.B. Moto-Fonds auf 1400 CHF.",
  params: { project: P.project, current: { type: "number", description: "Aktueller Stand" }, target: { type: "number", description: "Optional: neues Ziel" } },
  required: ["project", "current"],
  run: a => {
    const p = findProject(a.project);
    if (!p.goal) throw new Error(`${p.title} hat kein Zahlenziel`);
    projects.setGoal(p.id, { current: +a.current, ...(a.target != null ? { target: +a.target } : {}) });
    return `${p.title}: ${a.current}/${p.goal.target} ${p.goal.unit}`;
  },
});
def("ui_open", {
  description: "Ein Panel in der App öffnen.",
  params: { view: { type: "string", enum: ["training", "weight", "progress", "calendar", "settings", "project", "home"], description: "Was geöffnet werden soll" }, project: P.project },
  required: ["view"],
  run: a => {
    const extra = a.view === "project" ? { id: findProject(a.project).id } : {};
    uiHooks.open(a.view, extra);
    return `${a.view} geöffnet`;
  },
});

/* ============================================================
   ÖFFENTLICHE SCHNITTSTELLE
   ============================================================ */
export function listActions() {
  return [...actions.values()].map(({ name, kind, destructive, description, params, required }) => ({ name, kind, destructive, description, params, required }));
}

/** Tool-Definitionen im Format der Claude-API (tools: [...]). */
export function toolSchemas() {
  return [...actions.values()].map(a => ({
    name: a.name,
    description: `${a.description}${a.destructive ? " ACHTUNG: löscht Daten, vorher nachfragen." : ""}`,
    input_schema: { type: "object", properties: a.params, required: a.required },
  }));
}

export async function callAction(name, args = {}) {
  const a = actions.get(name);
  if (!a) return { ok: false, error: `Unbekannte Aktion: ${name}` };
  try {
    const missing = a.required.filter(k => args[k] === undefined || args[k] === null || args[k] === "");
    if (missing.length) throw new Error(`Fehlende Parameter: ${missing.join(", ")}`);
    const result = await a.run(args || {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
