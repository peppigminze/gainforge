/* ============================================================
   fitness/analytics.js — Auswertungen (rein rechnerisch)
   ============================================================ */

import { dayNum, keyFromDayNum, mondayOf, addDays, addMonths, diffDays, todayKey } from "../dates.js";
import { validSets } from "./model.js";

/* ---------------- Grundfunktionen ---------------- */

/** Geschätztes 1-Wiederholungs-Maximum (Epley). Bester Vergleichswert über verschiedene Wdh.-Zahlen. */
export function e1rm(kg, reps) {
  if (!(reps > 0)) return 0;
  const w = kg || 0;
  return reps === 1 ? w : w * (1 + reps / 30);
}

export function movingAverage(values, window) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

/** Lineare Regression über Punkte {x, y}. */
export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  points.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx, at: x => my + slope * (x - mx) };
}

/* ---------------- Übungs-Verlauf ---------------- */

/** Ein Punkt pro Training, in dem die Übung geloggt wurde. */
export function exerciseSeries(f, exId) {
  return Object.values(f.workouts)
    .filter(w => validSets(w.sets[exId]).length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.templateId.localeCompare(b.templateId))
    .map(w => {
      const sets = validSets(w.sets[exId]);
      let best = sets[0], bestE = -1;
      sets.forEach(s => { const e = e1rm(s.kg, s.reps); if (e > bestE) { bestE = e; best = s; } });
      return {
        date: w.date,
        day: dayNum(w.date),
        templateId: w.templateId,
        sets,
        bestSet: best,
        e1rm: bestE,
        topKg: Math.max(...sets.map(s => s.kg || 0)),
        volume: sets.reduce((s, x) => s + (x.kg || 0) * x.reps, 0),
        totalReps: sets.reduce((s, x) => s + x.reps, 0),
      };
    });
}

export const METRICS = {
  e1rm: { label: "e1RM", unit: "kg", get: p => p.e1rm, help: "Geschätztes Maximalgewicht für 1 Wdh. aus deinem besten Satz — vergleicht z.B. 60×10 fair mit 65×8." },
  topKg: { label: "Top-Gewicht", unit: "kg", get: p => p.topKg, help: "Schwerstes Gewicht im Training." },
  volume: { label: "Volumen", unit: "kg", get: p => p.volume, help: "Summe kg × Wdh. über alle Sätze." },
  totalReps: { label: "Wdh. total", unit: "Wdh.", get: p => p.totalReps, help: "Alle Wiederholungen zusammen." },
};

/**
 * Plateau-Erkennung auf Basis e1RM.
 *  - Plateau: seit ≥ 4 Trainings UND ≥ 14 Tagen kein neuer Bestwert
 *  - Rückgang: Trend der letzten 6 Trainings < −1.5 %/Woche
 *  - Fortschritt: sonst
 */
export function plateauStatus(series) {
  if (series.length < 4) {
    return { status: "insufficient", label: "Zu wenig Daten", detail: `${series.length}/4 Trainings geloggt` };
  }
  let prIdx = 0;
  series.forEach((p, i) => { if (p.e1rm >= series[prIdx].e1rm * 1.005) prIdx = i; });
  const last = series[series.length - 1];
  const sessionsSince = series.length - 1 - prIdx;
  const daysSince = last.day - series[prIdx].day;

  const recent = series.slice(-6);
  const reg = linearRegression(recent.map(p => ({ x: p.day, y: p.e1rm })));
  const mean = recent.reduce((s, p) => s + p.e1rm, 0) / recent.length;
  const weeklyPct = reg && mean ? (reg.slope * 7 / mean) * 100 : 0;

  if (weeklyPct <= -1.5 && sessionsSince >= 2) {
    return { status: "decline", label: "Rückgang", weeklyPct, sessionsSince,
      detail: `Trend ${weeklyPct.toFixed(1)} %/Woche. Schlaf, Kalorien und Erholung prüfen.` };
  }
  if (sessionsSince >= 4 && daysSince >= 14) {
    return { status: "plateau", label: "Plateau", weeklyPct, sessionsSince,
      detail: `Seit ${sessionsSince} Trainings (${Math.round(daysSince / 7)} Wochen) kein neuer Bestwert. Idee: Wdh.-Bereich wechseln oder 1 Woche mit −10 % Gewicht neu aufbauen.` };
  }
  return { status: "progress", label: "Fortschritt", weeklyPct, sessionsSince,
    detail: sessionsSince === 0 ? "Letztes Training war ein neuer Bestwert." : `Bestwert vor ${sessionsSince} Training${sessionsSince === 1 ? "" : "s"}.` };
}

/** Letztes Training mit dieser Übung VOR einem Datum (für "Letztes Mal"-Hinweis). */
export function previousPerformance(f, exId, beforeDate, excludeKey) {
  let best = null;
  Object.entries(f.workouts).forEach(([key, w]) => {
    if (key === excludeKey || w.date > beforeDate) return;
    const sets = validSets(w.sets[exId]);
    if (!sets.length) return;
    if (!best || w.date > best.date) best = { date: w.date, sets };
  });
  return best;
}

/* ---------------- Gewicht ---------------- */

export function weightEntries(f) {
  return Object.entries(f.weights)
    .map(([date, kg]) => ({ date, day: dayNum(date), kg }))
    .sort((a, b) => a.day - b.day);
}

/** Durchschnitt pro Kalenderwoche (Mo–So). Punkt liegt auf Donnerstag = Wochenmitte. */
export function weeklyAverages(entries) {
  const byWeek = new Map();
  entries.forEach(e => {
    const monday = mondayOf(e.date);
    if (!byWeek.has(monday)) byWeek.set(monday, []);
    byWeek.get(monday).push(e.kg);
  });
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monday, kgs]) => ({
      monday,
      day: dayNum(monday) + 3,
      avg: kgs.reduce((s, v) => s + v, 0) / kgs.length,
      n: kgs.length,
    }));
}

/* ---------------- Bulk/Cut-Plan ---------------- */

/** Phasen mit konkreten Start-/Enddaten und Start-/Zielgewicht. */
/** Hat der Nutzer einen Plan mit mindestens einer Phase eingerichtet? */
export function planActive(plan) {
  return !!(plan && plan.configured !== false && Array.isArray(plan.phases) && plan.phases.length && plan.startDate && Number.isFinite(+plan.startWeight));
}

export function planTimeline(plan) {
  if (!planActive(plan)) return [];
  let start = plan.startDate;
  let fromWeight = plan.startWeight;
  return plan.phases.map(ph => {
    const end = addMonths(start, ph.months);
    const seg = { ...ph, start, end, fromWeight, toWeight: ph.targetWeight };
    start = end;
    fromWeight = ph.targetWeight;
    return seg;
  });
}

/** Soll-Gewicht an einem Tag (linear innerhalb der Phase). */
export function plannedWeightAt(plan, dateKey) {
  const tl = planTimeline(plan);
  if (!tl.length || dateKey < tl[0].start) return null;
  const seg = tl.find(s => dateKey >= s.start && dateKey < s.end) || tl[tl.length - 1];
  const total = diffDays(seg.start, seg.end);
  const t = Math.min(1, Math.max(0, diffDays(seg.start, dateKey) / total));
  return { phase: seg, weight: seg.fromWeight + (seg.toWeight - seg.fromWeight) * t, weeklyRate: (seg.toWeight - seg.fromWeight) / (total / 7) };
}

export function currentPhase(plan, today = todayKey()) {
  const tl = planTimeline(plan);
  if (!tl.length) return null;
  if (today < tl[0].start) return { seg: tl[0], idx: 0, state: "upcoming", monthNo: 0 };
  const idx = tl.findIndex(s => today >= s.start && today < s.end);
  if (idx === -1) return { seg: tl[tl.length - 1], idx: tl.length - 1, state: "finished", monthNo: tl[tl.length - 1].months };
  const seg = tl[idx];
  let monthNo = 1;
  while (monthNo < seg.months && addMonths(seg.start, monthNo) <= today) monthNo++;
  return { seg, idx, state: "active", monthNo };
}

/**
 * Liegt der Wochendurchschnitt im Plan?
 * Basis ist die aktuelle Woche, falls ≥ 3 Messungen, sonst die letzte volle Woche.
 * Toleranz ±0.5 kg um die Soll-Linie.
 */
export function courseStatus(f, today = todayKey()) {
  const weeks = weeklyAverages(weightEntries(f));
  if (!weeks.length) return { state: "nodata", title: "Noch keine Daten", text: "Trag dein Morgengewicht ein — ab 3 Messungen pro Woche zählt der Wochenschnitt." };

  const thisMonday = mondayOf(today);
  let ref = weeks[weeks.length - 1];
  if (ref.monday === thisMonday && ref.n < 3 && weeks.length > 1) ref = weeks[weeks.length - 2];

  const refMid = keyFromDayNum(ref.day);
  const soll = plannedWeightAt(f.plan, refMid);
  const recent = weeks.filter(w => w.n >= 2).slice(-4);
  const reg = linearRegression(recent.map(w => ({ x: w.day, y: w.avg })));
  const rate = reg ? reg.slope * 7 : null;

  if (!planActive(f.plan)) return { state: "noplan", ref, rate, title: "Kein Plan", text: "Ohne Plan zeigt die App nur deinen Verlauf. Unter „Plan“ kannst du Ziel, Kalorien und Protein festlegen." };
  if (!soll) return { state: "nodata", ref, rate, title: "Plan startet noch", text: "Plan-Startdatum liegt in der Zukunft." };

  const diff = ref.avg - soll.weight;
  const isBulk = soll.phase.toWeight >= soll.phase.fromWeight;
  const base = { ref, soll, diff, rate, phase: soll.phase };
  const abs = Math.abs(diff).toFixed(1);

  if (Math.abs(diff) <= 0.5) {
    return { ...base, state: "on", title: "Im Kurs", text: `${fmtSigned(diff)} kg zur Soll-Linie. Kalorien so beibehalten.` };
  }
  if (isBulk) {
    return diff < 0
      ? { ...base, state: "slow", title: "Bulk zu langsam", text: `${abs} kg unter Soll. Ca. +150–200 kcal/Tag, 2 Wochen beobachten.` }
      : { ...base, state: "fast", title: "Bulk zu schnell", text: `${abs} kg über Soll. Ca. −100–150 kcal/Tag, damit weniger Fett dazukommt.` };
  }
  return diff > 0
    ? { ...base, state: "slow", title: "Cut zu langsam", text: `${abs} kg über Soll. Ca. −150 kcal/Tag oder mehr Alltagsbewegung.` }
    : { ...base, state: "fast", title: "Cut zu schnell", text: `${abs} kg unter Soll. Ca. +100–150 kcal/Tag, um Muskeln zu schützen.` };
}

export function fmtSigned(n, digits = 1) {
  if (Math.abs(n) < 0.5 * 10 ** -digits) return "±" + (0).toFixed(digits);
  return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(digits);
}

export { addDays };
