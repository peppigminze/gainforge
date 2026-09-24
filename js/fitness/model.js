/* ============================================================
   fitness/model.js — Datenmodell + reine Mutationen
   ------------------------------------------------------------
   Kein DOM, kein Speichern. Alles hier arbeitet auf dem Objekt
   data.fitness und ist dadurch testbar und später 1:1 auf
   Firestore abbildbar (siehe Kommentar "FIRESTORE" unten).

   data.fitness = {
     version: 3,
     exercises: [{ id, name }],                       // Übungs-Bibliothek
     templates: [{ id, name, items: [{ exId, sets }] }], // Trainings-Vorlagen
     workouts: {                                        // key = "YYYY-MM-DD_<templateId>"
       "2026-09-24_s1": { date, templateId, sets: { <exId>: [{ kg, reps }] },
                          slots?: { <exId>: n },   // Anzahl Satz-Zeilen, falls ≠ Vorlage (0 = übersprungen)
                          updatedAt }
     },
     weights: { "2026-09-24": 78.6 },                   // key = Kalendertag
     plan: { startDate, startWeight, heightCm, startBf, creatineG, phases: [...] },
     weeklyTarget: 2
   }

   FIRESTORE (Priorität 2): workouts/<key> und weights/<date>
   werden je ein eigenes Dokument unter users/<uid>/… — die Keys
   sind bereits eindeutig und stabil, deshalb gibt es dort keine
   Überschreib-Konflikte mehr wie beim Gist-Sync.
   ============================================================ */

import { todayKey, toDayKey, isDayKey } from "../dates.js";

export const FITNESS_VERSION = 3;

/* Übungen wie bisher im Code — IDs bleiben identisch, damit die alte Historie passt. */
const SEED_EXERCISES = [
  { id: "chestpress", name: "Chestpress" },
  { id: "schraegbank", name: "Schrägbank drücken" },
  { id: "cable_h2l", name: "High to Low Cable Flys" },
  { id: "cable_l2h", name: "Low to High Cable Flys" },
  { id: "latzug", name: "Latzug" },
  { id: "rudern_eng", name: "Enges Rudern" },
  { id: "rudern_breit", name: "Breites Rudern hoch" },
  { id: "seitheben", name: "Seitheben an Maschine" },
  { id: "schulterpresse", name: "Schulterpresse" },
  { id: "bizeps", name: "Bizeps" },
  { id: "brachialis", name: "Brachialis" },
  { id: "trizeps", name: "Trizeps Presse" },
  { id: "bauch_gerade", name: "Gerade Bauchmuskelmaschine" },
  { id: "bauch_seitlich", name: "Seitliche Bauchmuskelmaschine" },
];
/* Ziel-Sätze pro Übung (in der App änderbar). */
const SEED_SETS = {
  chestpress: 2, schraegbank: 2, cable_h2l: 2, cable_l2h: 2, latzug: 3, rudern_eng: 3,
  rudern_breit: 2, seitheben: 3, schulterpresse: 3, bizeps: 3, brachialis: 2, trizeps: 2,
  bauch_gerade: 2, bauch_seitlich: 2,
};

function seedTemplates() {
  const rest = SEED_EXERCISES.map(e => e.id).filter(id => id !== "chestpress" && id !== "schraegbank");
  const item = exId => ({ exId, sets: SEED_SETS[exId] || 3 });
  return [
    { id: "s1", name: "Training 1", items: ["schraegbank", "chestpress", ...rest].map(item) },
    { id: "s2", name: "Training 2", items: ["chestpress", "schraegbank", ...rest].map(item) },
  ];
}

export function defaultPlan(startDate = todayKey(), startWeight = 78.5) {
  return {
    startDate,
    startWeight,
    heightCm: 183,
    startBf: 11,
    creatineG: 5,
    phases: [
      { id: "bulk", name: "Bulk", months: 7, kcalMin: 3450, kcalMax: 3500, proteinMin: 175, proteinMax: 190, targetWeight: 85, targetBf: "15–16" },
      { id: "cut", name: "Cut", months: 3, kcalMin: 2350, kcalMax: 2450, proteinMin: 200, proteinMax: 210, targetWeight: 82.5, targetBf: "10–11" },
    ],
  };
}

export function defaultFitness() {
  return {
    version: FITNESS_VERSION,
    exercises: SEED_EXERCISES.map(e => ({ ...e })),
    templates: seedTemplates(),
    workouts: {},
    weights: {},
    plan: defaultPlan(),
    weeklyTarget: 2,
  };
}

/* ---------------- Hilfen ---------------- */
export const workoutKey = (date, templateId) => `${date}_${templateId}`;

export function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

/** Zahl aus Eingabe lesen — akzeptiert "62,5" und "62.5". Leer -> null. */
export function parseNum(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Ein Satz zählt, sobald Wiederholungen > 0 eingetragen sind (kg darf leer = Körpergewicht sein). */
export const isValidSet = s => !!s && Number.isFinite(s.reps) && s.reps > 0;
const isEmptySet = s => !s || (s.kg == null && s.reps == null);

export const validSets = sets => (sets || []).filter(isValidSet);
export const exerciseLogged = (workout, exId) => !!workout && validSets(workout.sets[exId]).length > 0;
export const workoutHasData = w => !!w && Object.keys(w.sets).some(exId => exerciseLogged(w, exId));

/** Wie viele Satz-Zeilen zeigt eine Übung in diesem Training? */
export function slotCount(workout, exId, defaultSets) {
  const stored = (workout && workout.sets[exId]) ? workout.sets[exId].length : 0;
  const override = workout && workout.slots ? workout.slots[exId] : undefined;
  return Math.max(override ?? defaultSets, stored);
}

/** "todo" | "partial" | "done" | "skipped" */
export function exerciseStatus(workout, exId, defaultSets) {
  const slots = slotCount(workout, exId, defaultSets);
  const logged = workout ? validSets(workout.sets[exId]).length : 0;
  if (slots === 0) return "skipped";
  if (logged === 0) return "todo";
  return logged >= slots ? "done" : "partial";
}

export const findExercise = (f, id) => f.exercises.find(e => e.id === id);
export const findTemplate = (f, id) => f.templates.find(t => t.id === id);
export const exerciseName = (f, id) => (findExercise(f, id) || { name: id }).name;

/* ============================================================
   MIGRATION: alte Struktur (workoutLog / weightLog) -> v3
   Idempotent: läuft nur, wenn data.fitness fehlt oder veraltet.
   Die alten Felder bleiben unangetastet als Backup liegen.
   ============================================================ */
export function ensureFitness(data) {
  if (data.fitness && data.fitness.version === FITNESS_VERSION) {
    sanitize(data.fitness);
    return data.fitness;
  }
  const f = defaultFitness();

  // Gewichte
  const legacyWeights = Array.isArray(data.weightLog) ? data.weightLog : [];
  legacyWeights.forEach(w => {
    const date = toDayKey(w && w.date);
    const kg = parseNum(w && w.weight);
    if (date && kg) f.weights[date] = kg;
  });

  // Trainings — Einträge mit gleichem Tag + Session werden zusammengeführt
  const legacyWorkouts = Array.isArray(data.workoutLog) ? data.workoutLog : [];
  legacyWorkouts.forEach(w => {
    const date = toDayKey(w && w.date);
    if (!date || !w.exercises) return;
    const templateId = w.session === 2 ? "s2" : "s1";
    const key = workoutKey(date, templateId);
    const target = f.workouts[key] || { date, templateId, sets: {}, updatedAt: Date.now() };
    Object.entries(w.exercises).forEach(([exId, rec]) => {
      const kg = parseNum(rec && rec.weight);
      const reps = parseNum(rec && rec.reps);
      if (kg == null && reps == null) return;
      if (!findExercise(f, exId)) f.exercises.push({ id: exId, name: exId });
      const prev = target.sets[exId] && target.sets[exId][0];
      target.sets[exId] = [{ kg: kg ?? (prev ? prev.kg : null), reps: reps != null ? Math.round(reps) : (prev ? prev.reps : null) }];
    });
    if (Object.keys(target.sets).length) f.workouts[key] = target;
  });

  // Plan-Start: erster Gewichtseintrag, sonst heute
  const firstWeightDate = Object.keys(f.weights).sort()[0];
  if (firstWeightDate) f.plan = defaultPlan(firstWeightDate, f.weights[firstWeightDate]);

  f.migratedAt = new Date().toISOString();
  data.fitness = f;
  return f;
}

/** Repariert inkonsistente Daten (z.B. nach Import oder Sync). */
function sanitize(f) {
  f.exercises = Array.isArray(f.exercises) ? f.exercises : [];
  f.templates = Array.isArray(f.templates) && f.templates.length ? f.templates : seedTemplates();
  f.workouts = f.workouts && typeof f.workouts === "object" ? f.workouts : {};
  f.weights = f.weights && typeof f.weights === "object" ? f.weights : {};
  f.plan = f.plan || defaultPlan();
  f.weeklyTarget = f.weeklyTarget || 2;

  // Workout-Keys müssen exakt zu date + templateId passen (Schutz gegen verschobene Daten)
  Object.entries(f.workouts).forEach(([key, w]) => {
    if (!w || !isDayKey(w.date) || !w.templateId) { delete f.workouts[key]; return; }
    w.sets = w.sets && typeof w.sets === "object" ? w.sets : {};
    if (w.slots && typeof w.slots !== "object") delete w.slots;
    const expected = workoutKey(w.date, w.templateId);
    if (expected !== key) {
      delete f.workouts[key];
      if (!f.workouts[expected]) f.workouts[expected] = w;
      else mergeWorkoutInto(f.workouts[expected], w);
    }
  });
  Object.keys(f.weights).forEach(k => { if (!isDayKey(k)) delete f.weights[k]; });
}

function mergeWorkoutInto(target, source) {
  Object.entries(source.sets || {}).forEach(([exId, sets]) => {
    if (!validSets(target.sets[exId]).length) target.sets[exId] = sets;
  });
  Object.entries(source.slots || {}).forEach(([exId, n]) => {
    if (!target.slots || target.slots[exId] === undefined) { target.slots = target.slots || {}; target.slots[exId] = n; }
  });
  target.updatedAt = Date.now();
}

/* ============================================================
   MUTATIONEN — Training
   ============================================================ */
export function getWorkout(f, date, templateId) {
  return f.workouts[workoutKey(date, templateId)] || null;
}

function getOrCreateWorkout(f, date, templateId) {
  if (!isDayKey(date)) throw new Error("Ungültiges Datum: " + date);
  if (date > todayKey()) throw new Error("Datum liegt in der Zukunft");
  const key = workoutKey(date, templateId);
  if (!f.workouts[key]) f.workouts[key] = { date, templateId, sets: {}, updatedAt: Date.now() };
  return f.workouts[key];
}

function cleanupExercise(f, w, exId) {
  const sets = w.sets[exId] || [];
  while (sets.length && isEmptySet(sets[sets.length - 1])) sets.pop();
  if (!sets.length) delete w.sets[exId];
  if (w.slots && !Object.keys(w.slots).length) delete w.slots;
  if (!Object.keys(w.sets).length && !w.slots) delete f.workouts[workoutKey(w.date, w.templateId)];
}

function setSlotOverride(w, exId, n, defaultSets) {
  if (n === defaultSets) { if (w.slots) delete w.slots[exId]; }
  else { w.slots = w.slots || {}; w.slots[exId] = n; }
}

/**
 * Setzt kg und/oder Wiederholungen eines Satzes.
 * patch = { kg?: number|null, reps?: number|null }
 * Rückgabe: { becameLogged, becameEmpty } für die XP-Vergabe.
 */
export function setSet(f, { date, templateId, exerciseId, setIndex, kg, reps }) {
  const w = getOrCreateWorkout(f, date, templateId);
  const before = exerciseLogged(w, exerciseId);
  const sets = w.sets[exerciseId] || (w.sets[exerciseId] = []);
  while (sets.length <= setIndex) sets.push({ kg: null, reps: null });
  if (kg !== undefined) sets[setIndex].kg = kg;
  if (reps !== undefined) sets[setIndex].reps = reps == null ? null : Math.round(reps);
  w.updatedAt = Date.now();
  const after = exerciseLogged(w, exerciseId);
  cleanupExercise(f, w, exerciseId);
  return { becameLogged: !before && after, becameEmpty: before && !after };
}

/** Eine Satz-Zeile hinzufügen (wird gespeichert, bleibt nach Neustart). */
export function addSetRow(f, { date, templateId, exerciseId, defaultSets }) {
  const w = getOrCreateWorkout(f, date, templateId);
  setSlotOverride(w, exerciseId, slotCount(w, exerciseId, defaultSets) + 1, defaultSets);
  w.updatedAt = Date.now();
  cleanupExercise(f, w, exerciseId);
}

/**
 * Eine Satz-Zeile entfernen — egal ob leer oder ausgefüllt, geplant oder zusätzlich.
 * Beispiel: Vorlage sagt 2 Sätze, du machst nur 1 -> zweite Zeile weg, Übung zählt als erledigt.
 */
export function removeSetRow(f, { date, templateId, exerciseId, setIndex, defaultSets }) {
  const w = getOrCreateWorkout(f, date, templateId);
  const before = exerciseLogged(w, exerciseId);
  const visible = slotCount(w, exerciseId, defaultSets);
  const sets = w.sets[exerciseId];
  if (sets && setIndex < sets.length) sets.splice(setIndex, 1);
  setSlotOverride(w, exerciseId, Math.max(0, visible - 1), defaultSets);
  w.updatedAt = Date.now();
  const after = exerciseLogged(w, exerciseId);
  cleanupExercise(f, w, exerciseId);
  return { becameEmpty: before && !after };
}

/** Übung in diesem Training überspringen (nur wenn noch nichts geloggt) bzw. wieder aufnehmen. */
export function setSkipped(f, { date, templateId, exerciseId, skipped, defaultSets }) {
  const w = getOrCreateWorkout(f, date, templateId);
  if (skipped) {
    if (exerciseLogged(w, exerciseId)) throw new Error("Übung hat schon Sätze — erst die Sätze entfernen");
    delete w.sets[exerciseId];
    setSlotOverride(w, exerciseId, 0, defaultSets);
  } else {
    setSlotOverride(w, exerciseId, defaultSets, defaultSets);
  }
  w.updatedAt = Date.now();
  cleanupExercise(f, w, exerciseId);
}

/**
 * Verschiebt ein Training auf einen anderen Tag / eine andere Vorlage.
 * merge=false und Ziel belegt -> { conflict: true } (nichts geändert).
 */
export function moveWorkout(f, { fromKey, toDate, toTemplateId, merge = false }) {
  const src = f.workouts[fromKey];
  if (!src) throw new Error("Training nicht gefunden");
  if (!isDayKey(toDate)) throw new Error("Ungültiges Datum: " + toDate);
  if (toDate > todayKey()) throw new Error("Datum liegt in der Zukunft");
  const tpl = toTemplateId || src.templateId;
  const toKey = workoutKey(toDate, tpl);
  if (toKey === fromKey) return { key: toKey };
  const existing = f.workouts[toKey];
  if (existing && !merge) return { conflict: true, key: toKey };
  delete f.workouts[fromKey];
  if (existing) mergeWorkoutInto(existing, src);
  else f.workouts[toKey] = { ...src, date: toDate, templateId: tpl, updatedAt: Date.now() };
  return { key: toKey };
}

export function deleteWorkout(f, key) {
  const w = f.workouts[key];
  if (!w) return { loggedExercises: 0 };
  const loggedExercises = Object.keys(w.sets).filter(id => exerciseLogged(w, id)).length;
  delete f.workouts[key];
  return { loggedExercises };
}

/* ============================================================
   MUTATIONEN — Gewicht
   ============================================================ */
export function setWeight(f, date, kg) {
  if (!isDayKey(date)) throw new Error("Ungültiges Datum: " + date);
  if (date > todayKey()) throw new Error("Datum liegt in der Zukunft");
  if (!(kg > 20 && kg < 400)) throw new Error("Unplausibles Gewicht: " + kg);
  const isNew = f.weights[date] == null;
  f.weights[date] = Math.round(kg * 10) / 10;
  return { isNew };
}
export function deleteWeight(f, date) {
  const existed = f.weights[date] != null;
  delete f.weights[date];
  return { existed };
}

/* ============================================================
   MUTATIONEN — Übungen & Vorlagen
   ============================================================ */
export function addExercise(f, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Name fehlt");
  const existing = f.exercises.find(e => e.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const id = uid("ex");
  f.exercises.push({ id, name: clean });
  return id;
}

/** Umbenennen ändert den Namen überall — die ID (und damit der Verlauf) bleibt. */
/** Muskelgruppe einer Übung setzen (null = Standard/automatisch). */
export function setExerciseMuscle(f, exId, group) {
  const ex = f.exercises.find(e => e.id === exId);
  if (!ex) throw new Error("Übung nicht gefunden");
  if (group) ex.muscle = group; else delete ex.muscle;
}

export function renameExercise(f, exId, name) {
  const ex = findExercise(f, exId);
  const clean = String(name || "").trim();
  if (ex && clean) ex.name = clean;
}

export function addExerciseToTemplate(f, templateId, exId, sets = 3) {
  const t = findTemplate(f, templateId);
  if (!t || t.items.some(i => i.exId === exId)) return;
  t.items.push({ exId, sets });
}

export function removeExerciseFromTemplate(f, templateId, index) {
  const t = findTemplate(f, templateId);
  if (t) t.items.splice(index, 1);
}

export function moveExerciseInTemplate(f, templateId, index, direction) {
  const t = findTemplate(f, templateId);
  const j = index + direction;
  if (!t || j < 0 || j >= t.items.length) return;
  [t.items[index], t.items[j]] = [t.items[j], t.items[index]];
}

export function setTargetSets(f, templateId, index, sets) {
  const t = findTemplate(f, templateId);
  if (t && t.items[index]) t.items[index].sets = Math.max(1, Math.min(10, Math.round(sets) || 1));
}

export function addTemplate(f, name, copyFromId) {
  const src = copyFromId && findTemplate(f, copyFromId);
  const id = uid("tpl");
  f.templates.push({ id, name: String(name || "Neues Training").trim(), items: src ? src.items.map(i => ({ ...i })) : [] });
  return id;
}

export function renameTemplate(f, templateId, name) {
  const t = findTemplate(f, templateId);
  const clean = String(name || "").trim();
  if (t && clean) t.name = clean;
}

/** Vorlage löschen — geloggte Trainings bleiben (mit ihrem Namen-Fallback) erhalten. */
export function deleteTemplate(f, templateId) {
  if (f.templates.length <= 1) throw new Error("Mindestens eine Vorlage muss bleiben");
  f.templates = f.templates.filter(t => t.id !== templateId);
}

export function updatePlan(f, patch) {
  f.plan = { ...f.plan, ...patch, phases: patch.phases || f.plan.phases };
}
