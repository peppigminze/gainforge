/* ============================================================
   fitness/charts.js — Diagramme (Chart.js 4, global "Chart")
   ------------------------------------------------------------
   X-Achse = echte Zeit (Tagesnummern, linear) statt Kategorien:
   Abstände zwischen Punkten entsprechen den echten Tagen, Lücken
   im Training sind sichtbar, und kein Adapter-Plugin ist nötig.
   ============================================================ */

import { dayNum, todayKey, formatDayNum, formatLong, keyFromDayNum, isoWeek } from "../dates.js";
import { movingAverage, linearRegression, planTimeline, plannedWeightAt, METRICS } from "./analytics.js";

export const RANGES = { "4w": { label: "4 W", days: 28 }, "3m": { label: "3 M", days: 91 }, "6m": { label: "6 M", days: 182 }, all: { label: "Alles", days: null } };

const charts = new Map();

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function theme(accent) {
  return {
    accent: accent.hex,
    accentA: a => `rgba(${accent.rgb},${a})`,
    amber: cssVar("--warn", "#ffb547"),
    muted: "rgba(200,215,245,.55)",
    grid: "rgba(150,200,255,.07)",
  };
}

function windowFor(range, days) {
  const today = dayNum(todayKey());
  const cfg = RANGES[range] || RANGES["3m"];
  const first = days.length ? Math.min(...days) - 3 : today - 28;
  // Nie mehr leere Fläche zeigen als nötig: Fenster beginnt frühestens beim ersten Datenpunkt
  let min = cfg.days ? Math.max(today - cfg.days, first) : first;
  const max = today + 1;
  if (max - min < 14) min = max - 14;
  return { min: min - 1, max };
}

function stepFor(span) {
  if (span <= 35) return 7;
  if (span <= 100) return 14;
  if (span <= 200) return 28;
  return Math.ceil(span / 6 / 30) * 30;
}

function baseOptions(t, win, yTitle) {
  const span = win.max - win.min;
  const tickFont = { family: "JetBrains Mono", size: 10 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "nearest", intersect: false, axis: "x" },
    plugins: {
      legend: { display: true, position: "bottom", labels: { color: t.muted, font: tickFont, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 } },
      tooltip: { backgroundColor: "rgba(4,8,18,0.95)", borderColor: t.accentA(0.4), borderWidth: 1, titleFont: tickFont, bodyFont: tickFont, padding: 10 },
    },
    scales: {
      x: {
        type: "linear", min: win.min, max: win.max,
        ticks: { color: t.muted, font: tickFont, stepSize: stepFor(span), callback: v => formatDayNum(Math.round(v)), maxRotation: 0, autoSkipPadding: 12 },
        grid: { color: t.grid, drawTicks: false },
      },
      y: {
        ticks: { color: t.muted, font: tickFont, maxTicksLimit: 6 },
        grid: { color: t.grid, drawTicks: false },
        title: { display: !!yTitle, text: yTitle, color: t.muted, font: tickFont },
      },
    },
  };
}

function draw(canvas, config) {
  const prev = charts.get(canvas.id);
  if (prev) prev.destroy();
  charts.set(canvas.id, new Chart(canvas, config));
}

function paddedBounds(values, pad) {
  if (!values.length) return {};
  const lo = Math.min(...values), hi = Math.max(...values);
  return { suggestedMin: Math.floor((lo - pad) * 2) / 2, suggestedMax: Math.ceil((hi + pad) * 2) / 2 };
}

/* ---------------- Gewicht ---------------- */
export function renderWeightChart(canvas, { entries, weekly, plan, range, accent }) {
  const t = theme(accent);
  const win = windowFor(range, entries.map(e => e.day));
  const inWin = p => p.day >= win.min && p.day <= win.max;

  const daily = entries.filter(inWin).map(e => ({ x: e.day, y: e.kg, date: e.date }));
  const weeks = weekly.filter(inWin).map(w => ({ x: w.day, y: +w.avg.toFixed(2), n: w.n, monday: w.monday }));

  // Soll-Linie: Fenster-Ränder + Phasen-Grenzen
  const planPts = [];
  if (plan && plan.startDate) {
    const xs = [win.min, win.max, ...planTimeline(plan).flatMap(s => [dayNum(s.start), dayNum(s.end)])]
      .filter(x => x >= win.min && x <= win.max && x >= dayNum(plan.startDate));
    [...new Set(xs)].sort((a, b) => a - b).forEach(x => {
      const p = plannedWeightAt(plan, keyFromDayNum(x));
      if (p) planPts.push({ x, y: +p.weight.toFixed(2) });
    });
  }

  const opts = baseOptions(t, win, "kg");
  Object.assign(opts.scales.y, paddedBounds([...daily, ...planPts].map(p => p.y), 0.4));
  opts.plugins.tooltip.callbacks = {
    title: items => formatLong(keyFromDayNum(Math.round(items[0].parsed.x))),
    label: item => {
      const r = item.raw;
      if (item.datasetIndex === 0) return ` Morgengewicht ${r.y.toFixed(1)} kg`;
      if (item.datasetIndex === 1) return ` Ø KW ${isoWeek(r.monday)}: ${r.y.toFixed(2)} kg (${r.n} Messungen)`;
      return ` Soll ${r.y.toFixed(1)} kg`;
    },
  };

  draw(canvas, {
    type: "scatter",
    data: {
      datasets: [
        { label: "Tageswert", data: daily, pointRadius: 3, pointHoverRadius: 5, backgroundColor: t.accentA(0.35), borderColor: "transparent", order: 3 },
        { label: "Wochen-Ø", data: weeks, showLine: true, tension: 0.25, borderWidth: 2.5, borderColor: t.accent, backgroundColor: t.accent, pointRadius: 3.5, pointHoverRadius: 6, order: 1 },
        { label: "Plan", data: planPts, showLine: true, borderDash: [6, 5], borderWidth: 1.5, borderColor: t.amber, pointRadius: 0, pointHoverRadius: 0, order: 2 },
      ],
    },
    options: opts,
  });
}

/* ---------------- Übung ---------------- */
export function renderExerciseChart(canvas, { series, metric, range, accent, templateName }) {
  const t = theme(accent);
  const m = METRICS[metric] || METRICS.e1rm;
  const win = windowFor(range, series.map(p => p.day));
  const visible = series.filter(p => p.day >= win.min && p.day <= win.max);

  const pts = visible.map(p => ({ x: p.day, y: +m.get(p).toFixed(1), p }));
  const avg = movingAverage(pts.map(p => p.y), 3);
  const avgPts = pts.map((p, i) => ({ x: p.x, y: +avg[i].toFixed(1) }));
  const reg = linearRegression(pts);
  const trendPts = reg && pts.length >= 3 ? [{ x: pts[0].x, y: +reg.at(pts[0].x).toFixed(1) }, { x: pts[pts.length - 1].x, y: +reg.at(pts[pts.length - 1].x).toFixed(1) }] : [];

  const opts = baseOptions(t, win, `${m.label} (${m.unit})`);
  const vals = pts.map(p => p.y);
  const pad = vals.length ? Math.max(1, (Math.max(...vals) - Math.min(...vals)) * 0.15) : 1;
  Object.assign(opts.scales.y, paddedBounds(vals, pad));
  opts.plugins.tooltip.callbacks = {
    title: items => formatLong(keyFromDayNum(Math.round(items[0].parsed.x))),
    label: item => {
      if (item.datasetIndex === 0) {
        const p = item.raw.p;
        return [` ${m.label}: ${item.raw.y} ${m.unit}`, ` ${p.sets.map(s => `${s.kg ?? 0}×${s.reps}`).join(" · ")}`, ` ${templateName(p.templateId)}`];
      }
      return ` Ø 3 Trainings: ${item.raw.y}`;
    },
  };
  opts.plugins.tooltip.filter = item => item.datasetIndex !== 2;

  draw(canvas, {
    type: "scatter",
    data: {
      datasets: [
        { label: "Training", data: pts, pointRadius: 4, pointHoverRadius: 6, backgroundColor: t.accentA(0.45), borderColor: t.accent, borderWidth: 1, order: 2 },
        { label: "Ø 3 Trainings", data: avgPts, showLine: true, tension: 0.3, borderWidth: 2.5, borderColor: t.accent, pointRadius: 0, pointHoverRadius: 0, order: 1 },
        { label: "Trend", data: trendPts, showLine: true, borderDash: [6, 5], borderWidth: 1.5, borderColor: t.amber, pointRadius: 0, pointHoverRadius: 0, order: 3 },
      ],
    },
    options: opts,
  });
  return { visible, reg };
}
