/* ============================================================
   fitness/gym.js — Gym-Auswertungen
   ------------------------------------------------------------
   - PRs: Satz schlägt das bisher beste e1RM (vor diesem Tag)
   - Muskelgruppen pro Übung (Standard-Zuordnung, pro Übung
     überschreibbar über exercise.muscle) + Sätze pro Muskel
   - Volumen (kg × Wdh.) pro Woche, Wochen-Streak
   - Körper-Silhouette (vorne/hinten) als SVG
   Reine Funktionen: lesen nur, schreiben nie.
   ============================================================ */
import { validSets, workoutHasData } from "./model.js";
import { e1rm, exerciseSeries } from "./analytics.js";
import { todayKey, addDays, mondayOf } from "../dates.js";

/* ---------------- Muskelgruppen ---------------- */
export const MUSCLES = {
  brust: "Brust", ruecken: "Rücken", schultern: "Schultern",
  bizeps: "Bizeps", trizeps: "Trizeps", bauch: "Bauch", beine: "Beine",
};
/** Richtwert für Muskelaufbau: ca. 10 harte Sätze pro Muskel und Woche. */
export const WEEKLY_SET_TARGET = 10;

const DEFAULT_MAP = {
  chestpress: { p: "brust", s: ["trizeps", "schultern"] },
  schraegbank: { p: "brust", s: ["schultern", "trizeps"] },
  cable_h2l: { p: "brust", s: [] },
  cable_l2h: { p: "brust", s: ["schultern"] },
  latzug: { p: "ruecken", s: ["bizeps"] },
  rudern_eng: { p: "ruecken", s: ["bizeps"] },
  rudern_breit: { p: "ruecken", s: ["schultern"] },
  seitheben: { p: "schultern", s: [] },
  schulterpresse: { p: "schultern", s: ["trizeps"] },
  bizeps: { p: "bizeps", s: [] },
  brachialis: { p: "bizeps", s: [] },
  trizeps: { p: "trizeps", s: [] },
  bauch_gerade: { p: "bauch", s: [] },
  bauch_seitlich: { p: "bauch", s: [] },
};

const GUESS = [
  [/bein|squat|kniebeug|leg|wade|calf|ausfall|lunge|hip|glute|po\b|deadlift|kreuzhe/i, "beine"],
  [/bizeps|biceps|curl|brachialis|hammer/i, "bizeps"],
  [/trizeps|triceps|dips|pushdown|french/i, "trizeps"],
  [/bauch|crunch|abs|plank|core/i, "bauch"],
  [/schulter|shoulder|seitheb|lateral|military|overhead|face ?pull/i, "schultern"],
  [/lat|rudern|row|pull|klimm|rücken|ruecken|back/i, "ruecken"],
  [/brust|chest|bank|bench|fly|flys|butterfly|press/i, "brust"],
];
export function guessMuscle(name) {
  const hit = GUESS.find(([re]) => re.test(name || ""));
  return hit ? hit[1] : null;
}

/** { p: primär, s: [sekundär] } — exercise.muscle überschreibt die Standard-Zuordnung. */
export function muscleOf(f, exId) {
  const ex = f.exercises.find(e => e.id === exId);
  if (ex && ex.muscle && MUSCLES[ex.muscle]) {
    const d = DEFAULT_MAP[exId];
    return { p: ex.muscle, s: d && d.p === ex.muscle ? d.s : [] };
  }
  if (DEFAULT_MAP[exId]) return DEFAULT_MAP[exId];
  const g = guessMuscle(ex ? ex.name : "");
  return g ? { p: g, s: [] } : null;
}

/** Sätze pro Muskel im Zeitraum (primär = 1, sekundär = 0.5). */
export function muscleSets(f, from, to) {
  const out = Object.fromEntries(Object.keys(MUSCLES).map(k => [k, 0]));
  Object.values(f.workouts).forEach(w => {
    if (w.date < from || w.date > to) return;
    Object.entries(w.sets).forEach(([exId, sets]) => {
      const n = validSets(sets).length;
      if (!n) return;
      const m = muscleOf(f, exId);
      if (!m) return;
      out[m.p] += n;
      m.s.forEach(g => { out[g] += n * 0.5; });
    });
  });
  return out;
}

/* ---------------- Volumen + Streak ---------------- */
export function weekVolume(f, monday) {
  const sunday = addDays(monday, 6);
  let v = 0;
  Object.values(f.workouts).forEach(w => {
    if (w.date < monday || w.date > sunday) return;
    Object.values(w.sets).forEach(sets => validSets(sets).forEach(s => { v += (s.kg || 0) * s.reps; }));
  });
  return v;
}
export function volumeHistory(f, weeks = 8, today = todayKey()) {
  const m = mondayOf(today);
  return Array.from({ length: weeks }, (_, i) => weekVolume(f, addDays(m, -7 * (weeks - 1 - i))));
}

function sessionsInWeek(f, monday) {
  const sunday = addDays(monday, 6);
  return Object.values(f.workouts).filter(w => w.date >= monday && w.date <= sunday && workoutHasData(w)).length;
}
/**
 * Wochen am Stück mit erreichtem Trainingsziel. Die laufende Woche zählt,
 * sobald das Ziel erreicht ist; solange sie läuft, bricht sie den Streak nicht.
 */
export function streak(f, today = todayKey()) {
  const target = f.weeklyTarget || 2;
  let m = mondayOf(today);
  const thisWeekDone = sessionsInWeek(f, m) >= target;
  let n = thisWeekDone ? 1 : 0;
  m = addDays(m, -7);
  while (sessionsInWeek(f, m) >= target) { n++; m = addDays(m, -7); }
  return { weeks: n, thisWeekDone, left: Math.max(0, target - sessionsInWeek(f, mondayOf(today))) };
}

/* ---------------- PRs ---------------- */
/** Bestwerte VOR einem Datum (dieser Tag zählt nicht mit). */
export function priorBest(f, exId, beforeDate) {
  const prev = exerciseSeries(f, exId).filter(s => s.date < beforeDate);
  if (!prev.length) return null;
  return { e1rm: Math.max(...prev.map(s => s.e1rm)), topKg: Math.max(...prev.map(s => s.topKg)), sessions: prev.length };
}
/** Ist dieser Satz ein neuer Bestwert? (braucht mindestens ein früheres Training) */
export function isPR(prior, set) {
  if (!prior || !set || !(set.reps > 0)) return false;
  return e1rm(set.kg, set.reps) > prior.e1rm * 1.001;
}
/** Index des PR-Satzes in einer Übung dieses Trainings (bester Satz, falls er den alten Bestwert schlägt), sonst -1. */
export function prSetIndex(f, exId, date, sets) {
  const prior = priorBest(f, exId, date);
  let best = -1, bestE = -1;
  (sets || []).forEach((s, i) => {
    if (!isPR(prior, s)) return;
    const e = e1rm(s.kg, s.reps);
    if (e > bestE) { bestE = e; best = i; }
  });
  return best;
}
/** Bestwerte-Wand: pro Übung bestes e1RM und schwerster Satz. */
export function records(f) {
  return f.exercises.map(ex => {
    const s = exerciseSeries(f, ex.id);
    if (!s.length) return null;
    const bestE = s.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
    let heavy = null, heavyDate = null;
    s.forEach(x => x.sets.forEach(set => {
      if (!heavy || (set.kg || 0) > (heavy.kg || 0) || ((set.kg || 0) === (heavy.kg || 0) && set.reps > heavy.reps)) { heavy = set; heavyDate = x.date; }
    }));
    return { exId: ex.id, name: ex.name, e1rm: bestE.e1rm, e1rmSet: bestE.bestSet, e1rmDate: bestE.date, heavy, heavyDate, sessions: s.length };
  }).filter(Boolean);
}

/* ---------------- Körper-Silhouette ---------------- */
// Halbe Figur (linke Körperhälfte, x 0..50); rechts wird gespiegelt. Kantige HUD-Formen.
const FRONT = [
  ["schultern", "27,30 38,28 37,41 26,44"],
  ["brust", "39,29 50,31 50,45 39,44 37,35"],
  ["bizeps", "25,46 34,44 32,61 24,61"],
  ["", "23,63 31,63 29,81 22,80"],
  ["bauch", "37,47 41,48 41,71 38,69"],
  ["bauch", "43,47 49,47 49,54 43,54"],
  ["bauch", "43,56 49,56 49,63 43,63"],
  ["bauch", "43,65 49,65 49,72 43,72"],
  ["", "40,74 50,74 50,84 44,84"],
  ["beine", "38,86 49,86 47,120 39,120"],
  ["beine", "39,124 47,124 46,150 40,150"],
];
const BACK = [
  ["ruecken", "42,25 50,24 50,34 43,33"],
  ["schultern", "27,30 38,28 37,41 26,44"],
  ["ruecken", "38,34 49,36 49,58 41,62 36,47"],
  ["ruecken", "43,60 50,60 50,72 44,72"],
  ["trizeps", "25,46 34,44 32,61 24,61"],
  ["", "23,63 31,63 29,81 22,80"],
  ["beine", "40,74 50,76 50,88 39,88"],
  ["beine", "39,90 49,90 47,120 40,120"],
  ["beine", "39,124 47,124 46,150 40,150"],
];
const mirror = pts => pts.split(" ").map(p => { const [x, y] = p.split(","); return `${100 - +x},${y}`; }).join(" ");

function figure(parts, dx, level) {
  const head = `<polygon points="${dx + 50},4 ${dx + 58},9 ${dx + 58},19 ${dx + 50},24 ${dx + 42},19 ${dx + 42},9" class="bm-n"/>`;
  const neck = `<polygon points="${dx + 46},24 ${dx + 54},24 ${dx + 55},28 ${dx + 45},28" class="bm-n"/>`;
  const poly = ([g, pts]) => {
    const shift = s => s.split(" ").map(p => { const [x, y] = p.split(","); return `${+x + dx},${y}`; }).join(" ");
    const lv = g ? level(g) : -1;
    const attr = g ? `class="bm-m" data-g="${g}" style="--lv:${lv.toFixed(2)}"` : `class="bm-n"`;
    return `<polygon points="${shift(pts)}" ${attr}/><polygon points="${shift(mirror(pts))}" ${attr}/>`;
  };
  return head + neck + parts.map(poly).join("");
}

/** levels: { gruppe: 0..1 } */
export function bodySVG(levels, { labels = true, cls = "" } = {}) {
  const level = g => Math.max(0, Math.min(1, levels[g] || 0));
  return `<svg class="bodymap ${cls}" viewBox="0 0 200 ${labels ? 166 : 154}" aria-hidden="true">
    ${figure(FRONT, 0, level)}${figure(BACK, 100, level)}
    ${labels ? `<text x="50" y="164" class="bm-l">VORNE</text><text x="150" y="164" class="bm-l">HINTEN</text>` : ""}
  </svg>`;
}
