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

/* ---------------- Muskelgruppen + einzelne Muskeln ---------------- */
export const MUSCLES = {
  brust: "Brust", ruecken: "Rücken", schultern: "Schultern",
  bizeps: "Bizeps", trizeps: "Trizeps", bauch: "Bauch", beine: "Beine",
};
/** Richtwert für Muskelaufbau: ca. 10 harte Sätze pro Gruppe und Woche. */
export const WEEKLY_SET_TARGET = 10;
/** Grober Richtwert für einen einzelnen Muskel/Kopf. */
export const SUB_TARGET = 6;

export const SUBS = {
  brust_upper: { g: "brust", label: "Obere Brust", tip: "Schrägbank drücken, Low to High Cable Flys" },
  brust_mid: { g: "brust", label: "Mittlere Brust", tip: "Chestpress, Bankdrücken, Butterfly" },
  brust_low: { g: "brust", label: "Untere Brust", tip: "High to Low Cable Flys, Dips" },
  trap: { g: "ruecken", label: "Trapez", tip: "Shrugs, breites Rudern hoch, Face Pulls" },
  lat: { g: "ruecken", label: "Latissimus", tip: "Latzug, Klimmzüge, Pullover" },
  rhomb: { g: "ruecken", label: "Mittlerer Rücken", tip: "Enges Rudern, Kabelrudern, T-Bar" },
  lower: { g: "ruecken", label: "Unterer Rücken", tip: "Hyperextensions, Rumänisches Kreuzheben" },
  sch_front: { g: "schultern", label: "Vordere Schulter", tip: "Schulterpresse, Frontheben (Drücken trifft sie mit)" },
  sch_side: { g: "schultern", label: "Seitliche Schulter", tip: "Seitheben (Maschine oder Kabel)" },
  sch_rear: { g: "schultern", label: "Hintere Schulter", tip: "Face Pulls, Reverse Butterfly, breites Rudern hoch" },
  biceps: { g: "bizeps", label: "Bizeps", tip: "Curls (Maschine, Kurzhantel, Kabel)" },
  brachialis: { g: "bizeps", label: "Brachialis", tip: "Hammer Curls, Brachialis-Maschine" },
  forearm: { g: "bizeps", label: "Unterarm", tip: "Hammer Curls, Reverse Curls, Farmer Walks" },
  triz_long: { g: "trizeps", label: "Trizeps langer Kopf", tip: "Überkopf-Trizepsdrücken, French Press" },
  triz_lat: { g: "trizeps", label: "Trizeps seitlich", tip: "Pushdowns, Trizeps-Presse, Dips" },
  abs: { g: "bauch", label: "Gerade Bauchmuskeln", tip: "Crunch-Maschine, Beinheben" },
  obl: { g: "bauch", label: "Schräge Bauchmuskeln", tip: "Seitliche Crunches, Kabel-Holzhacker" },
  quads: { g: "beine", label: "Quadrizeps", tip: "Beinpresse, Kniebeugen, Beinstrecker" },
  hams: { g: "beine", label: "Beinbeuger", tip: "Beinbeuger-Maschine, Rumänisches Kreuzheben" },
  glutes: { g: "beine", label: "Gesäss", tip: "Hip Thrust, Beinpresse (Füsse hoch), Ausfallschritte" },
  calves: { g: "beine", label: "Waden", tip: "Wadenheben stehend/sitzend" },
};

/* Standard-Zuordnung: Muskel -> Anteil (1 = Hauptmuskel, 0.5 = hilft mit) */
const DEFAULT_MAP = {
  chestpress: { brust_mid: 1, brust_low: 0.5, sch_front: 0.5, triz_lat: 0.5 },
  schraegbank: { brust_upper: 1, sch_front: 0.5, triz_lat: 0.5 },
  cable_h2l: { brust_low: 1, brust_mid: 0.5 },
  cable_l2h: { brust_upper: 1, brust_mid: 0.5, sch_front: 0.5 },
  latzug: { lat: 1, rhomb: 0.5, biceps: 0.5 },
  rudern_eng: { rhomb: 1, lat: 0.5, biceps: 0.5, lower: 0.5 },
  rudern_breit: { sch_rear: 1, rhomb: 1, trap: 0.5 },
  seitheben: { sch_side: 1, trap: 0.5 },
  schulterpresse: { sch_front: 1, sch_side: 0.5, triz_lat: 0.5 },
  bizeps: { biceps: 1, brachialis: 0.5 },
  brachialis: { brachialis: 1, forearm: 1, biceps: 0.5 },
  trizeps: { triz_lat: 1, triz_long: 0.5 },
  bauch_gerade: { abs: 1 },
  bauch_seitlich: { obl: 1, abs: 0.5 },
};

/* Wenn nur die Gruppe bekannt ist (eigene Übung, Auswahl in „Muskelgruppen“) */
const GROUP_DEFAULT = {
  brust: { brust_mid: 1, brust_upper: 0.5, brust_low: 0.5, sch_front: 0.5 },
  ruecken: { lat: 1, rhomb: 1, trap: 0.5 },
  schultern: { sch_front: 1, sch_side: 0.5 },
  bizeps: { biceps: 1, brachialis: 0.5, forearm: 0.5 },
  trizeps: { triz_lat: 1, triz_long: 0.5 },
  bauch: { abs: 1, obl: 0.5 },
  beine: { quads: 1, glutes: 0.5, hams: 0.5 },
};

/* Name -> Zuordnung für eigene Übungen (erste passende Regel gewinnt) */
const GUESS = [
  [/wade|calf/i, { calves: 1 }],
  [/beinbeug|leg ?curl|ham/i, { hams: 1 }],
  [/hip ?thrust|glute|gesäss|kickback|abduk/i, { glutes: 1, hams: 0.5 }],
  [/kreuzhe|deadlift/i, { hams: 1, glutes: 1, lower: 1, trap: 0.5 }],
  [/beinstreck|leg ?ext/i, { quads: 1 }],
  [/beinpress|leg ?press|squat|kniebeug|hack|ausfall|lunge/i, { quads: 1, glutes: 0.5 }],
  [/hyperext|rückenstreck|back ?ext/i, { lower: 1, glutes: 0.5 }],
  [/shrug/i, { trap: 1 }],
  [/face ?pull|reverse ?(fly|butterfly)|hintere schulter/i, { sch_rear: 1, trap: 0.5 }],
  [/seitheb|lateral/i, { sch_side: 1, trap: 0.5 }],
  [/frontheb|front ?raise/i, { sch_front: 1 }],
  [/schulterpress|shoulder ?press|military|overhead ?press/i, { sch_front: 1, sch_side: 0.5, triz_lat: 0.5 }],
  [/hammer|brachialis/i, { brachialis: 1, forearm: 1, biceps: 0.5 }],
  [/unterarm|forearm|wrist|farmer/i, { forearm: 1 }],
  [/bizeps|biceps|curl/i, { biceps: 1, brachialis: 0.5 }],
  [/überkopf|overhead|french|skull/i, { triz_long: 1, triz_lat: 0.5 }],
  [/trizeps|triceps|pushdown|dips/i, { triz_lat: 1, triz_long: 0.5 }],
  [/seitlich.*bauch|schräg|oblique|holzhack|woodchop/i, { obl: 1, abs: 0.5 }],
  [/bauch|crunch|abs|plank|core|beinheb/i, { abs: 1 }],
  [/klimm|pull ?up|latzug|lat ?pull|pullover/i, { lat: 1, rhomb: 0.5, biceps: 0.5 }],
  [/rudern|row/i, { rhomb: 1, lat: 0.5, biceps: 0.5 }],
  [/schräg|incline|obere brust|low to high/i, { brust_upper: 1, sch_front: 0.5, triz_lat: 0.5 }],
  [/high to low|decline|untere brust/i, { brust_low: 1, brust_mid: 0.5 }],
  [/brust|chest|bank|bench|fly|flys|butterfly/i, { brust_mid: 1, brust_low: 0.5, sch_front: 0.5, triz_lat: 0.5 }],
];
export function guessMuscle(name) {
  const hit = GUESS.find(([re]) => re.test(name || ""));
  return hit ? topGroup(hit[1]) : null;
}
function topGroup(map) {
  let best = null, w = -1;
  Object.entries(map).forEach(([sub, x]) => { if (x > w) { w = x; best = SUBS[sub].g; } });
  return best;
}

/** Muskel-Zuordnung einer Übung: { sub: Anteil } — oder null, wenn unbekannt. */
export function subMapOf(f, exId) {
  const ex = f.exercises.find(e => e.id === exId);
  if (ex && ex.muscle && MUSCLES[ex.muscle]) {
    const d = DEFAULT_MAP[exId];
    if (d && topGroup(d) === ex.muscle) return d;
    const g = GUESS.find(([re]) => re.test(ex.name || ""));
    if (g && topGroup(g[1]) === ex.muscle) return g[1];
    return GROUP_DEFAULT[ex.muscle];
  }
  if (DEFAULT_MAP[exId]) return DEFAULT_MAP[exId];
  const g = GUESS.find(([re]) => re.test(ex ? ex.name : ""));
  return g ? g[1] : null;
}

/** Kompatibel zu früher: { p: Hauptgruppe, s: [weitere Gruppen] } */
export function muscleOf(f, exId) {
  const map = subMapOf(f, exId);
  if (!map) return null;
  const p = topGroup(map);
  const s = [...new Set(Object.keys(map).map(k => SUBS[k].g))].filter(g => g !== p);
  return { p, s, map };
}

/**
 * Sätze pro einzelnem Muskel im Zeitraum.
 * -> { sub: { sets, by: { exId: sets } } }
 */
export function subSets(f, from, to) {
  const out = Object.fromEntries(Object.keys(SUBS).map(k => [k, { sets: 0, by: {} }]));
  Object.values(f.workouts).forEach(w => {
    if (w.date < from || w.date > to) return;
    Object.entries(w.sets).forEach(([exId, sets]) => {
      const n = validSets(sets).length;
      if (!n) return;
      const map = subMapOf(f, exId);
      if (!map) return;
      Object.entries(map).forEach(([sub, share]) => {
        out[sub].sets += n * share;
        out[sub].by[exId] = (out[sub].by[exId] || 0) + n * share;
      });
    });
  });
  return out;
}

/** Sätze pro Gruppe: pro Übung zählt der höchste Anteil innerhalb der Gruppe (Chestpress = 1 Satz Brust, nicht 1.5). */
export function muscleSets(f, from, to) {
  const out = Object.fromEntries(Object.keys(MUSCLES).map(k => [k, 0]));
  Object.values(f.workouts).forEach(w => {
    if (w.date < from || w.date > to) return;
    Object.entries(w.sets).forEach(([exId, sets]) => {
      const n = validSets(sets).length;
      const map = n && subMapOf(f, exId);
      if (!map) return;
      const per = {};
      Object.entries(map).forEach(([sub, share]) => { const g = SUBS[sub].g; per[g] = Math.max(per[g] || 0, share); });
      Object.entries(per).forEach(([g, share]) => { out[g] += n * share; });
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
// Linke Körperhälfte (x 0..50), rechts wird gespiegelt. [muskel, punkte]
const FRONT = [
  ["trap", "45,25 47,28 39,30 37,28"],
  ["sch_side", "26,32 33,29 32,40 25,43"],
  ["sch_front", "33,29 38,30 37,40 32,40"],
  ["brust_upper", "39,30 50,31 50,36 38,35"],
  ["brust_mid", "38,35.6 50,36.6 50,41 38,40.4"],
  ["brust_low", "38,41 50,41.6 50,45.5 40,45.5"],
  ["biceps", "25,45 32,42 32,55 26,57"],
  ["brachialis", "26,57.6 32,55.6 31,61 24,62"],
  ["forearm", "23,63 31,62 29,81 22,80"],
  ["obl", "37,47 41,48 41,71 38,69"],
  ["abs", "43,47 49,47 49,54 43,54"],
  ["abs", "43,56 49,56 49,63 43,63"],
  ["abs", "43,65 49,65 49,72 43,72"],
  ["", "40,74 50,74 50,84 44,84"],
  ["quads", "38,86 49,86 47,120 39,120"],
  ["calves", "39,124 47,124 46,150 40,150"],
];
const BACK = [
  ["trap", "43,24 50,23 50,36 45,32 38,29"],
  ["sch_side", "26,33 31,31 32,41 25,44"],
  ["sch_rear", "31,31 38,29 37,40 32,41"],
  ["rhomb", "45,32.8 50,36.8 50,50 45,46 41.5,36.5"],
  ["lat", "38,33 41,36.4 44.6,46.6 50,50.8 50,58 41,62 36,48"],
  ["lower", "43,62 50,59 50,72 44,72"],
  ["triz_lat", "24,46 29,44 30,61 24,61"],
  ["triz_long", "29.6,44 34,43 33,60 30.6,61"],
  ["forearm", "23,63 31,63 29,81 22,80"],
  ["glutes", "40,74 50,76 50,88 39,88"],
  ["hams", "39,90 49,90 47,120 40,120"],
  ["calves", "39,124 47,124 46,150 40,150"],
];
/** Ausschnitt(e) pro Gruppe für die Detailansicht (mehrere = nebeneinander, z.B. vorne + hinten). */
const FOCUS_VIEW = {
  brust: ["22 19 56 32"], ruecken: ["112 18 76 60"], bauch: ["28 42 44 34"],
  bizeps: ["18 40 18 43"], trizeps: ["120 41 17 22"],
  schultern: ["22 25 18 20", "122 25 18 20"],
  beine: ["30 70 40 84", "130 70 40 84"],
};
const mirrorPts = pts => pts.split(" ").map(p => { const [x, y] = p.split(","); return `${100 - +x},${y}`; }).join(" ");
const shiftPts = (pts, dx) => pts.split(" ").map(p => { const [x, y] = p.split(","); return `${+x + dx},${y}`; }).join(" ");
function centroid(pts) {
  const a = pts.split(" ").map(p => p.split(",").map(Number));
  return [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
}

function figure(parts, dx, level, focus) {
  const head = `<polygon points="${dx + 50},4 ${dx + 58},9 ${dx + 58},19 ${dx + 50},24 ${dx + 42},19 ${dx + 42},9" class="bm-n"/>`;
  const neck = `<polygon points="${dx + 46},24 ${dx + 54},24 ${dx + 55},28 ${dx + 45},28" class="bm-n"/>`;
  return head + neck + parts.map(([sub, pts]) => {
    if (!sub) return `<polygon points="${shiftPts(pts, dx)}" class="bm-n"/><polygon points="${shiftPts(mirrorPts(pts), dx)}" class="bm-n"/>`;
    const g = SUBS[sub].g;
    const lv = Math.max(0, Math.min(1, level(sub)));
    const dim = focus && g !== focus ? " bm-dim" : "";
    const attr = `class="bm-m${dim}" data-g="${g}" data-sub="${sub}" style="--lv:${lv.toFixed(2)}"`;
    return `<polygon points="${shiftPts(pts, dx)}" ${attr}/><polygon points="${shiftPts(mirrorPts(pts), dx)}" ${attr}/>`;
  }).join("");
}

/**
 * levels: { muskel: 0..1 }
 * focus: Gruppen-ID -> Ausschnitt + Nummern an den Muskeln dieser Gruppe
 */
export function bodySVG(levels, { labels = true, cls = "", focus = null } = {}) {
  const level = k => levels[k] || 0;
  const body = `${figure(FRONT, 0, level, focus)}${figure(BACK, 100, level, focus)}`;
  if (!focus) {
    return `<svg class="bodymap ${cls}" viewBox="0 0 200 ${labels ? 166 : 154}" aria-hidden="${labels ? "false" : "true"}">${body}
      ${labels ? `<text x="50" y="164" class="bm-l">VORNE</text><text x="150" y="164" class="bm-l">HINTEN</text>` : ""}</svg>`;
  }
  // Nummern: jeder Muskel der Gruppe bekommt eine Nummer im ersten Ausschnitt, in dem er sichtbar ist
  const views = FOCUS_VIEW[focus].map(v => ({ vb: v.split(" ").map(Number), badges: "" }));
  const order = Object.keys(SUBS).filter(k => SUBS[k].g === focus);
  order.forEach((sub, idx) => {
    for (const [parts, dx] of [[FRONT, 0], [BACK, 100]]) {
      const poly = parts.find(([k]) => k === sub);
      if (!poly) continue;
      const [cx, cy] = centroid(shiftPts(poly[1], dx));
      const v = views.find(({ vb }) => cx >= vb[0] && cx <= vb[0] + vb[2] && cy >= vb[1] && cy <= vb[1] + vb[3]);
      if (!v) continue;
      const r = Math.min(v.vb[2], v.vb[3] * 1.4) / 60;
      v.badges += `<g class="bm-badge"><circle cx="${cx}" cy="${cy}" r="${2.6 * r}"/><text x="${cx}" y="${cy + 0.2 * r}" font-size="${3 * r}">${idx + 1}</text></g>`;
      return;
    }
  });
  return `<div class="bm-views n${views.length}">${views.map(v => `<svg class="bodymap zoom ${cls}" viewBox="${v.vb.join(" ")}" aria-hidden="true">${body}${v.badges}</svg>`).join("")}</div>`;
}
