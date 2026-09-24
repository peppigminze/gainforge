/* ============================================================
   fitness/commands.js — benannte Aktionen (öffentliche API)
   ------------------------------------------------------------
   Jede Änderung an Fitness-Daten läuft über diese Funktionen —
   nie direkt aus einem Klick-Handler. Dadurch können später
   auch Cypher oder ein Terminal-Befehl exakt dieselben Aktionen
   auslösen (z.B. fitness.logWeight("2026-09-24", 78.6)).

   bindFitness(ctx) verbindet die Commands mit dem Speicher:
     ctx.getData()  -> aktuelles data-Objekt
     ctx.save()     -> persistieren (heute localStorage/Gist,
                       ab Priorität 2 Firestore)
     ctx.addXP(n)   -> XP vergeben
   ============================================================ */

import * as M from "./model.js";
import { todayKey } from "../dates.js";
import { previousPerformance } from "./analytics.js";

const XP_WEIGHT = 5;
const XP_EXERCISE = 5;

let ctx = null;
const listeners = new Set();

export function bindFitness(context) { ctx = context; }

/** UI abonniert Änderungen. scope sagt, was sich geändert hat ("set", "weight", "structure", "plan"). */
export function onFitnessChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function state() {
  if (!ctx) throw new Error("bindFitness() wurde nicht aufgerufen");
  return M.ensureFitness(ctx.getData());
}

function commit(scope, xp = 0, detail = {}) {
  ctx.save();
  if (xp) ctx.addXP(xp);
  listeners.forEach(fn => fn(scope, detail));
}

export const fitness = {
  /* ---------- Lesen ---------- */
  getState: () => state(),

  /* ---------- Gewicht ---------- */
  logWeight(date = todayKey(), kg) {
    const res = M.setWeight(state(), date, kg);
    commit("weight", res.isNew ? XP_WEIGHT : 0, { date });
    return res;
  },
  deleteWeight(date) {
    const res = M.deleteWeight(state(), date);
    commit("weight", res.existed ? -XP_WEIGHT : 0, { date });
    return res;
  },

  /* ---------- Training ---------- */
  /** Ein Feld eines Satzes setzen: logSet({date, templateId, exerciseId, setIndex, kg?, reps?}) */
  logSet(args) {
    const res = M.setSet(state(), args);
    const xp = res.becameLogged ? XP_EXERCISE : res.becameEmpty ? -XP_EXERCISE : 0;
    commit("set", xp, args);
    return res;
  },
  /** + Satz: addSetRow({date, templateId, exerciseId, defaultSets}) */
  addSetRow(args) {
    M.addSetRow(state(), args);
    commit("structure", 0, args);
  },
  /** Satz-Zeile entfernen (auch geplante/leere): removeSetRow({…, setIndex, defaultSets}) */
  removeSetRow(args) {
    const res = M.removeSetRow(state(), args);
    commit("structure", res.becameEmpty ? -XP_EXERCISE : 0, args);
    return res;
  },
  skipExercise(args) { M.setSkipped(state(), { ...args, skipped: true }); commit("structure", 0, args); },
  unskipExercise(args) { M.setSkipped(state(), { ...args, skipped: false }); commit("structure", 0, args); },
  /** Sätze vom letzten Mal übernehmen (nur in leere Felder). */
  copyPrevious({ date, templateId, exerciseId, defaultSets }) {
    const f = state();
    const key = M.workoutKey(date, templateId);
    const prev = previousPerformance(f, exerciseId, date, key);
    if (!prev) return { copied: 0 };
    const w0 = M.getWorkout(f, date, templateId);
    const wasLogged = M.exerciseLogged(w0, exerciseId);
    const existing = (w0 && w0.sets[exerciseId]) || [];
    let copied = 0;
    prev.sets.forEach((ps, i) => {
      const cur = existing[i];
      if (cur && (cur.kg != null || cur.reps != null)) return;
      M.setSet(f, { date, templateId, exerciseId, setIndex: i, kg: ps.kg, reps: ps.reps });
      copied++;
    });
    const w = M.getWorkout(f, date, templateId);
    if (w && M.slotCount(w, exerciseId, defaultSets) < prev.sets.length) {
      w.slots = w.slots || {}; w.slots[exerciseId] = prev.sets.length;
    }
    const nowLogged = M.exerciseLogged(M.getWorkout(f, date, templateId), exerciseId);
    commit("structure", !wasLogged && nowLogged ? XP_EXERCISE : 0, { date, templateId, exerciseId });
    return { copied };
  },
  moveWorkout(args) {
    const res = M.moveWorkout(state(), args);
    if (!res.conflict) commit("structure", 0, res);
    return res;
  },
  deleteWorkout(key) {
    const res = M.deleteWorkout(state(), key);
    commit("structure", -XP_EXERCISE * res.loggedExercises, { key });
    return res;
  },

  /* ---------- Übungen & Vorlagen ---------- */
  addExercise(name, templateId, sets = 3) {
    const f = state();
    const id = M.addExercise(f, name);
    if (templateId) M.addExerciseToTemplate(f, templateId, id, sets);
    commit("structure");
    return id;
  },
  addExerciseToTemplate(templateId, exId, sets = 3) { M.addExerciseToTemplate(state(), templateId, exId, sets); commit("structure"); },
  renameExercise(exId, name) { M.renameExercise(state(), exId, name); commit("structure"); },
  removeExerciseFromTemplate(templateId, index) { M.removeExerciseFromTemplate(state(), templateId, index); commit("structure"); },
  moveExercise(templateId, index, direction) { M.moveExerciseInTemplate(state(), templateId, index, direction); commit("structure"); },
  setTargetSets(templateId, index, sets) { M.setTargetSets(state(), templateId, index, sets); commit("structure"); },
  addTemplate(name, copyFromId) { const id = M.addTemplate(state(), name, copyFromId); commit("structure"); return id; },
  renameTemplate(templateId, name) { M.renameTemplate(state(), templateId, name); commit("structure"); },
  deleteTemplate(templateId) { M.deleteTemplate(state(), templateId); commit("structure"); },
  setWeeklyTarget(n) { state().weeklyTarget = Math.max(1, Math.min(7, Math.round(n) || 2)); commit("structure"); },

  /* ---------- Plan ---------- */
  updatePlan(patch) { M.updatePlan(state(), patch); commit("plan"); },
};
