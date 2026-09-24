/* ============================================================
   fitness/ui.js — Kacheln + Detail-Panels (NEXUS-Stil)
   ------------------------------------------------------------
   Startseite: 3 Kacheln (Training, Gewicht, Fortschritt) mit je
   EINER Kennzahl. Alles Weitere öffnet sich erst beim Antippen.
   Liest nur über fitness.getState(), ändert nur über Commands.
   ============================================================ */

import { fitness, onFitnessChange } from "./commands.js";
import {
  exerciseName, findTemplate, validSets, workoutKey, workoutHasData, exerciseLogged,
  parseNum, slotCount, exerciseStatus,
} from "./model.js";
import {
  exerciseSeries, plateauStatus, previousPerformance, weightEntries, weeklyAverages,
  courseStatus, currentPhase, plannedWeightAt, fmtSigned, METRICS, planActive,
} from "./analytics.js";
import { renderWeightChart, renderExerciseChart, RANGES } from "./charts.js";
import { MUSCLES, SUBS, SUB_TARGET, subSets, WEEKLY_SET_TARGET, muscleOf, muscleSets, weekVolume, volumeHistory, streak, priorBest, isPR, prSetIndex, records, bodySVG } from "./gym.js";
import { e1rm } from "./analytics.js";
import { openSheet, refreshSheet, currentSheetId, setHeader } from "../ui/sheet.js";
import { sparkline, esc, toast, haptic, ICONS } from "../ui/fx.js";
import { todayKey, addDays, mondayOf, isoWeek, formatLong, formatShort, formatDate, isDayKey, DOW_SHORT, weekday } from "../dates.js";

const fmtKg = (n, d = 1) => (n == null ? "--.-" : n.toFixed(d));
const fmtVol = v => Math.round(v).toLocaleString("de-CH");
const fmtSets = n => `${Number.isInteger(n) ? n : n.toFixed(1)} Sätze`;
const setsText = sets => sets.map(s => `${s.kg ?? 0}×${s.reps}`).join(" · ");

const ui = {
  workoutDate: todayKey(),
  templateId: null,
  openEx: null,
  weightRange: "3m",
  exRange: "3m",
  metric: "e1rm",
  exerciseId: null,
  manageTpl: null,
  moveOpenKey: null,
};

let getAccent = () => ({ hex: "#00f0ff", rgb: "0,240,255" });

/* ============================================================
   INIT + ÄNDERUNGEN
   ============================================================ */
export function initFitnessUI(options = {}) {
  if (options.getAccent) getAccent = options.getAccent;
  onFitnessChange((scope, detail) => {
    renderFitnessTiles();
    const sid = currentSheetId();
    if (sid === "training") {
      if (scope === "set") refreshExerciseHead(detail.exerciseId, true);
      else renderTrainingBody();
    } else if (sid === "weight" || sid === "progress" || sid === "manage" || sid === "muscles") {
      refreshSheet();
    }
  });
}

/** Für die HUD-Zeile oben: Phase + Trainingswoche. */
export function hudInfo() {
  const f = fitness.getState();
  const ph = currentPhase(f.plan);
  const phase = ph ? (ph.state === "active" ? `${ph.seg.name} M${ph.monthNo}/${ph.seg.months}` : ph.state === "upcoming" ? "Plan startet bald" : "Plan fertig") : "";
  return { phase, week: `${weekCount(f)}/${f.weeklyTarget} Training` };
}

function weekCount(f) {
  const monday = mondayOf(todayKey()), sunday = addDays(monday, 6);
  return Object.values(f.workouts).filter(w => w.date >= monday && w.date <= sunday && workoutHasData(w)).length;
}

function suggestTemplate(f) {
  const today = todayKey();
  const todays = f.templates.find(t => workoutHasData(f.workouts[workoutKey(today, t.id)]));
  if (todays) return todays.id;
  const monday = mondayOf(today);
  const doneThisWeek = new Set(Object.values(f.workouts).filter(w => w.date >= monday && workoutHasData(w)).map(w => w.templateId));
  const open = f.templates.find(t => !doneThisWeek.has(t.id));
  return (open || f.templates[0]).id;
}

const templateLabel = (f, id) => (findTemplate(f, id) || { name: "Gelöschte Vorlage" }).name;

/* ============================================================
   KACHELN
   ============================================================ */
export function renderFitnessTiles() {
  const f = fitness.getState();
  const today = todayKey();

  /* --- Training --- */
  const count = weekCount(f);
  const nextTpl = suggestTemplate(f);
  const todayW = f.workouts[workoutKey(today, nextTpl)];
  const tpl = findTemplate(f, nextTpl);
  const doneEx = tpl ? tpl.items.filter(i => ["done", "skipped"].includes(exerciseStatus(todayW, i.exId, i.sets))).length : 0;
  const last = Object.values(f.workouts).filter(workoutHasData).sort((a, b) => b.date.localeCompare(a.date))[0];
  const running = workoutHasData(todayW);
  document.getElementById("tileTraining").innerHTML = `
    ${ICONS.training}
    <span class="t-cat"><span class="dot"></span>Training</span>
    <span class="t-big">${count}<small>von ${f.weeklyTarget} diese Woche</small></span>
    <span class="t-dots">${Array.from({ length: f.weeklyTarget }, (_, i) => `<i class="${i < count ? "on" : ""}"></i>`).join("")}</span>
    <span class="t-sub">${running ? `Heute läuft: ${esc(tpl.name)} · ${doneEx}/${tpl.items.length} Übungen` : `Als Nächstes: ${esc(tpl ? tpl.name : "–")}`}</span>
    <span class="t-foot">
      <span>${last ? `Zuletzt ${DOW_SHORT[weekday(last.date)]} ${formatShort(last.date)}` : "Noch kein Training geloggt"}</span>
      <span class="t-go">${running ? "Weiter" : "Start"} ▸</span>
    </span>`;

  /* --- Gewicht --- */
  const weekly = weeklyAverages(weightEntries(f));
  const cur = weekly.find(w => w.monday === mondayOf(today));
  const ref = cur || weekly[weekly.length - 1];
  const course = courseStatus(f, today);
  const stCls = { on: "st-ok", slow: "st-warn", fast: "st-warn", nodata: "st-mute", noplan: "st-mute" }[course.state];
  const stTxt = { on: "im Kurs", slow: "zu langsam", fast: "zu schnell", nodata: "keine Daten", noplan: "ohne Plan" }[course.state];
  const needsSetup = f.plan.configured === false;
  const todayLogged = f.weights[today] != null;
  const lastEntry = weightEntries(f).slice(-1)[0];
  document.getElementById("tileWeight").innerHTML = `
    ${ICONS.weight}
    <span class="t-cat">Gewicht</span>
    <span class="t-big">${ref ? fmtKg(ref.avg) : "--.-"}<small>kg</small></span>
    <span class="t-sub">${needsSetup ? "Tippen, um dein Ziel einzurichten" : cur ? `Schnitt diese Woche` : ref ? `Letzter Schnitt: KW ${isoWeek(ref.monday)}` : "Noch keine Messung"}</span>
    ${sparkline(weekly.slice(-8).map(w => w.avg))}
    <span class="t-foot">${needsSetup ? `<span class="t-state st-warn">Plan einrichten</span>` : todayLogged ? `<span class="t-state ${stCls}">${stTxt}</span>`
      : `<span class="t-state st-warn">heute wiegen</span>${lastEntry ? `<span class="t-muted">zuletzt ${formatShort(lastEntry.date)}</span>` : ""}`}</span>`;

  /* --- Fortschritt --- */
  const ids = exerciseIdsWithData(f);
  const stats = ids.map(id => plateauStatus(exerciseSeries(f, id)));
  const stuck = ids.filter((id, i) => stats[i].status === "plateau" || stats[i].status === "decline");
  const progress = stats.filter(s => s.status === "progress").length;
  const measurable = stats.filter(s => s.status !== "insufficient").length;
  document.getElementById("tileProgress").innerHTML = `
    ${ICONS.progress}
    <span class="t-cat">Kraft</span>
    <span class="t-big">${measurable ? progress : "–"}<small>${measurable ? `von ${measurable}` : ""}</small></span>
    <span class="t-sub">${measurable ? "Übungen werden stärker" : "Trend ab 4 Trainings pro Übung"}</span>
    <span class="t-foot">${stuck.length ? `<span class="t-state st-warn">Stockt: ${esc(exerciseName(f, stuck[0]))}${stuck.length > 1 ? ` +${stuck.length - 1}` : ""}</span>`
      : measurable ? `<span class="t-state st-ok">kein Plateau</span>`
      : `<span class="t-state st-mute">sammelt Daten</span>`}</span>`;

  /* --- Muskeln (diese Woche) --- */
  const monday = mondayOf(today);
  const ms = muscleSets(f, monday, addDays(monday, 6));
  const ss = subSets(f, monday, addDays(monday, 6));
  const lv = Object.fromEntries(Object.entries(ss).map(([k, v]) => [k, v.sets / SUB_TARGET]));
  const hit = Object.entries(ms).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const miss = Object.keys(MUSCLES).filter(g => ms[g] === 0);
  document.getElementById("tileMuscle").innerHTML = `
    <span class="t-cat">Muskeln</span>
    ${bodySVG(lv, { labels: false, cls: "mini" })}
    <span class="t-foot">${hit.length ? `<span class="t-state st-ok">${esc(MUSCLES[hit[0][0]])} ${fmtSets(hit[0][1])}</span>` : `<span class="t-state st-mute">noch leer</span>`}
      ${hit.length && miss.length ? `<span class="t-muted">fehlt: ${esc(MUSCLES[miss[0]])}</span>` : ""}</span>`;

  /* --- Volumen + Streak --- */
  const vol = weekVolume(f, monday);
  const hist = volumeHistory(f, 8, today);
  const st = streak(f, today);
  document.getElementById("tileVolume").innerHTML = `
    <span class="t-cat">Volumen</span>
    <span class="t-big">${fmtVol(vol)}<small>kg</small></span>
    <span class="t-sub">bewegt diese Woche</span>
    ${hist.some(v => v > 0) ? sparkline(hist) : ""}
    <span class="t-foot">${st.weeks ? `<span class="t-state st-ember">🔥 ${st.weeks} ${st.weeks === 1 ? "Woche" : "Wochen"} Streak</span>`
      : `<span class="t-state st-mute">noch ${st.left} bis 🔥</span>`}</span>`;
}

function exerciseIdsWithData(f) {
  const order = [];
  f.templates.forEach(t => t.items.forEach(i => { if (!order.includes(i.exId)) order.push(i.exId); }));
  f.exercises.forEach(e => { if (!order.includes(e.id)) order.push(e.id); });
  return order.filter(id => exerciseSeries(f, id).length > 0);
}

/* ============================================================
   PANEL: GEWICHT
   ============================================================ */
export function openWeight({ focus = false } = {}) {
  const f = fitness.getState();
  const ph = currentPhase(f.plan);
  if (f.plan.configured === false) ui.wizard = ui.wizard || newWizard(f);
  openSheet({
    id: "weight", cat: "Körper", title: "Gewicht",
    sub: f.plan.configured === false ? "Ziel einrichten" : ph && ph.state === "active" ? `${ph.seg.name} · Monat ${ph.monthNo} von ${ph.seg.months}` : planActive(f.plan) ? "Plan" : "ohne Plan",
    bind: bindWeight, render: renderWeightBody,
  });
  if (focus && !ui.wizard) setTimeout(() => { const i = document.querySelector("#sheetBody [data-w='kg']"); if (i) i.focus(); }, 450);
}

/* ---------- Einrichtungs-Assistent (erstes Öffnen) ---------- */
const GOALS = {
  bulk: { label: "Aufbauen", phases: ["bulk"] },
  cut: { label: "Definieren", phases: ["cut"] },
  bulkcut: { label: "Aufbauen → Definieren", phases: ["bulk", "cut"] },
  hold: { label: "Halten", phases: ["hold"] },
};
const PHASE_DEF = {
  bulk: { name: "Bulk", months: 6 },
  cut: { name: "Cut", months: 3 },
  hold: { name: "Halten", months: 6 },
};
function newWizard(f) {
  const last = weightEntries(f).slice(-1)[0];
  const w = { goal: "bulk", weight: last ? String(last.kg) : "", height: f.plan.heightCm ? String(f.plan.heightCm) : "", start: todayKey(), creatine: "", phases: [] };
  buildWizardPhases(w);
  return w;
}
/** Grobe Startwerte aus dem Körpergewicht (Erhaltung ≈ 33 kcal/kg). Nur Vorschläge. */
function suggest(type, kg, fromKg) {
  const r5 = n => Math.round(n / 50) * 50;
  kg = fromKg; // Werte der Phase ab ihrem Startgewicht rechnen
  const base = kg * 33;
  if (type === "bulk") { const to = +(fromKg + 0.8 * PHASE_DEF.bulk.months).toFixed(1); return { targetWeight: to, kcalMin: r5(base + 300), kcalMax: r5(base + 400), proteinMin: Math.round(kg * 1.8), proteinMax: Math.round(kg * 2.0) }; }
  if (type === "cut") { const to = +(fromKg * (1 - 0.005 * 4.3 * PHASE_DEF.cut.months)).toFixed(1); return { targetWeight: to, kcalMin: r5(base - 550), kcalMax: r5(base - 450), proteinMin: Math.round(kg * 2.0), proteinMax: Math.round(kg * 2.3) }; }
  return { targetWeight: +fromKg.toFixed(1), kcalMin: r5(base - 100), kcalMax: r5(base + 100), proteinMin: Math.round(kg * 1.6), proteinMax: Math.round(kg * 2.0) };
}
function buildWizardPhases(w) {
  const kg = parseNum(w.weight);
  let from = kg;
  w.phases = GOALS[w.goal].phases.map(type => {
    const d = PHASE_DEF[type];
    const sug = kg ? suggest(type, kg, from) : {};
    if (sug.targetWeight) from = sug.targetWeight;
    const val = k => (sug[k] != null ? String(sug[k]) : "");
    return { type, name: d.name, months: String(d.months), targetWeight: val("targetWeight"), kcalMin: val("kcalMin"), kcalMax: val("kcalMax"), proteinMin: val("proteinMin"), proteinMax: val("proteinMax") };
  });
}
function wizardHTML(w) {
  const fld = (k, label, value, mode = "decimal", i = null) =>
    `<label>${label}<input class="field" ${i === null ? `data-wz="${k}"` : `data-wzp="${i}" data-k="${k}"`} inputmode="${mode}" value="${esc(value)}"></label>`;
  return `
    <div class="callout"><b>Willkommen</b>Richte kurz dein Ziel ein. Danach vergleicht die App deinen Wochenschnitt mit deinem Plan und zeigt dir Kalorien- und Proteinziel.</div>
    <div class="psec">Dein Ziel</div>
    <div class="seg wrap">${Object.entries(GOALS).map(([k, g]) => `<button type="button" data-goal="${k}" class="${w.goal === k ? "on" : ""}">${g.label}</button>`).join("")}</div>
    <div class="psec">Über dich</div>
    <div class="form-grid">
      ${fld("weight", "Gewicht heute (kg)", w.weight)}
      ${fld("height", "Grösse (cm, optional)", w.height, "numeric")}
      <label>Start<input class="field" type="date" data-wz="start" value="${w.start}"></label>
      ${fld("creatine", "Kreatin g/Tag (optional)", w.creatine)}
    </div>
    ${w.phases.map((ph, i) => `
      <div class="phase-box">
        <div class="phase-title">${i + 1}. ${esc(ph.name)}</div>
        <div class="form-grid">
          ${fld("months", "Dauer (Monate)", ph.months, "numeric", i)}
          ${fld("targetWeight", "Zielgewicht (kg)", ph.targetWeight, "decimal", i)}
          ${fld("kcalMin", "kcal von", ph.kcalMin, "numeric", i)}
          ${fld("kcalMax", "kcal bis", ph.kcalMax, "numeric", i)}
          ${fld("proteinMin", "Protein g von", ph.proteinMin, "numeric", i)}
          ${fld("proteinMax", "Protein g bis", ph.proteinMax, "numeric", i)}
        </div>
      </div>`).join("")}
    <p class="hint">Die Werte sind grobe Vorschläge aus deinem Gewicht (Erhaltung ≈ 33 kcal pro kg). Passe sie an, falls du deine Zahlen kennst. Alles lässt sich später unter „Plan bearbeiten“ ändern.</p>
    <button type="button" class="btn ghost block" data-wz-act="suggest" style="margin-top:10px">Vorschläge neu berechnen</button>
    <button type="button" class="btn primary block" data-wz-act="save" style="margin-top:10px">Plan speichern</button>
    <button type="button" class="link" data-wz-act="skip" style="display:block;margin:10px auto 0">Überspringen, nur Gewicht tracken</button>`;
}
function saveWizard(body) {
  const w = ui.wizard;
  const kg = parseNum(w.weight);
  const bad = sel => { const el = body.querySelector(sel); flash(el); return false; };
  if (!(kg > 20 && kg < 400)) return bad('[data-wz="weight"]');
  if (!isDayKey(w.start)) return bad('[data-wz="start"]');
  const phases = [];
  for (let i = 0; i < w.phases.length; i++) {
    const ph = w.phases[i];
    const num = k => parseNum(ph[k]);
    const months = Math.round(num("months") || 0);
    if (!(months >= 1 && months <= 36)) return bad(`[data-wzp="${i}"][data-k="months"]`);
    if (!(num("targetWeight") > 20 && num("targetWeight") < 400)) return bad(`[data-wzp="${i}"][data-k="targetWeight"]`);
    for (const k of ["kcalMin", "kcalMax", "proteinMin", "proteinMax"]) if (!(num(k) > 0)) return bad(`[data-wzp="${i}"][data-k="${k}"]`);
    if (num("kcalMin") > num("kcalMax")) return bad(`[data-wzp="${i}"][data-k="kcalMax"]`);
    if (num("proteinMin") > num("proteinMax")) return bad(`[data-wzp="${i}"][data-k="proteinMax"]`);
    phases.push({ id: `${ph.type}_${i + 1}`, name: ph.name, months, targetWeight: num("targetWeight"),
      kcalMin: Math.round(num("kcalMin")), kcalMax: Math.round(num("kcalMax")), proteinMin: Math.round(num("proteinMin")), proteinMax: Math.round(num("proteinMax")), targetBf: "" });
  }
  fitness.updatePlan({ configured: true, startDate: w.start, startWeight: kg, heightCm: parseNum(w.height), creatineG: parseNum(w.creatine) || 0, phases });
  if (fitness.getState().weights[todayKey()] == null) fitness.logWeight(todayKey(), kg);
  ui.wizard = null;
  setHeader({ sub: phases.length ? `${phases[0].name} · Monat 1 von ${phases[0].months}` : "ohne Plan" });
  refreshSheet();
  body.scrollTo({ top: 0 });
  toast("Plan gespeichert");
  return true;
}

function renderWeightBody(body) {
  if (ui.wizard) { body.innerHTML = wizardHTML(ui.wizard); return; }
  const f = fitness.getState();
  const today = todayKey();
  const entries = weightEntries(f);
  const weekly = weeklyAverages(entries);
  const thisMonday = mondayOf(today);
  const cur = weekly.find(w => w.monday === thisMonday);
  const prev = weekly.find(w => w.monday === addDays(thisMonday, -7));
  const course = courseStatus(f, today);
  const planNow = plannedWeightAt(f.plan, today);
  const ph = currentPhase(f.plan);
  const s = ph ? ph.seg : null;
  const p = f.plan;
  const selDate = body.dataset.date && isDayKey(body.dataset.date) ? body.dataset.date : today;
  const existing = f.weights[selDate];
  const cls = { on: "ok", slow: "warn", fast: "warn", nodata: "", noplan: "" }[course.state];
  const openAcc = [...body.querySelectorAll("details[open]")].map(d => d.dataset.acc);

  body.innerHTML = `
    <div class="psec">Morgengewicht</div>
    <form class="form-row" data-form="weight" autocomplete="off">
      <input type="date" class="field" data-w="date" value="${selDate}" max="${today}" aria-label="Datum">
      <input type="text" inputmode="decimal" enterkeyhint="done" class="field" data-w="kg" placeholder="${existing != null ? fmtKg(existing) + " kg" : "kg"}" aria-label="Gewicht in kg">
      <button type="submit" class="btn primary">${existing != null ? "Ändern" : "Log"}</button>
    </form>

    <div class="psec">Woche</div>
    <div class="kv">
      <div><b>Schnitt KW ${isoWeek(today)}</b><span class="hl">${cur ? fmtKg(cur.avg) : "--.-"}</span><em>${cur ? `${cur.n}/7 Messungen` : "noch keine"}</em></div>
      <div><b>Vorwoche</b><span>${prev ? fmtKg(prev.avg) + " kg" : "--"}</span><em>${cur && prev ? fmtSigned(cur.avg - prev.avg, 2) + " kg" : ""}</em></div>
      <div><b>Tempo</b><span>${course.rate != null ? fmtSigned(course.rate, 2) : "--"}</span><em>${planNow ? `kg/W · Soll ${fmtSigned(planNow.weeklyRate, 2)}` : "kg/Woche"}</em></div>
    </div>
    <div class="callout ${cls}"><b>${esc(course.title)}</b>${esc(course.text)}
      ${course.soll ? `<span class="meta">Ist Ø ${fmtKg(course.ref.avg, 2)} kg (KW ${isoWeek(course.ref.monday)}) · Soll ${fmtKg(course.soll.weight, 2)} kg</span>` : ""}</div>
    ${s ? `<div class="tags">
      <span><b>${s.kcalMin}–${s.kcalMax}</b> kcal</span><span><b>${s.proteinMin}–${s.proteinMax} g</b> Protein</span>
      ${p.creatineG ? `<span>Kreatin <b>${p.creatineG} g</b></span>` : ""}<span>Ziel <b>${s.targetWeight} kg</b>${s.targetBf ? ` · ${esc(s.targetBf)} % KFA` : ""}</span></div>` : ""}

    <div class="seg-row"><div class="seg" data-seg="wrange">${rangeButtons(ui.weightRange)}</div></div>
    <div class="chart-box"><canvas id="weightChart"></canvas></div>
    <p class="hint">Punkte = Tageswerte · Linie = Wochenschnitt · gestrichelt = Plan</p>

    <details class="acc" data-acc="entries" ${openAcc.includes("entries") ? "open" : ""}>
      <summary>Einträge</summary>
      <div class="acc-body" style="padding:0">
        <div class="rows" style="border:0;border-radius:0">
        ${[...entries].reverse().slice(0, 30).map(e => `
          <div class="r" data-date="${e.date}">
            <button type="button" class="r-main" data-act="edit">${formatLong(e.date)}</button>
            <span class="r-val">${fmtKg(e.kg)} kg</span>
            <button type="button" class="ico del" data-act="del" aria-label="Löschen">✕</button>
          </div>`).join("") || `<div class="empty">Noch keine Einträge.</div>`}
        </div>
      </div>
    </details>

    <details class="acc" data-acc="plan" ${openAcc.includes("plan") ? "open" : ""}>
      <summary>${planActive(p) ? "Plan bearbeiten" : "Plan einrichten"}</summary>
      <div class="acc-body">
        ${planActive(p) ? `<form data-form="plan">${planFormHTML(p)}</form>` : ""}
        <button type="button" class="btn ${planActive(p) ? "ghost" : "primary"} block" data-wz-act="restart" style="margin-top:${planActive(p) ? 10 : 0}px">${planActive(p) ? "Plan neu einrichten" : "Ziel & Plan einrichten"}</button>
      </div>
    </details>`;

  renderWeightChart(body.querySelector("#weightChart"), { entries, weekly, plan: f.plan, range: ui.weightRange, accent: getAccent() });
}

function planFormHTML(p) {
  const fld = (name, label, value, type = "text", mode = "decimal") =>
    `<label>${label}<input class="field" name="${name}" type="${type}" ${type === "text" ? `inputmode="${mode}"` : ""} value="${esc(value)}"></label>`;
  return `
    <div class="form-grid">
      ${fld("startDate", "Planstart", p.startDate, "date")}
      ${fld("startWeight", "Start (kg)", p.startWeight)}
      ${fld("heightCm", "Grösse (cm)", p.heightCm, "text", "numeric")}
      ${fld("creatineG", "Kreatin (g)", p.creatineG)}
    </div>
    ${p.phases.map((ph, i) => `
      <div class="phase-box">
        <div class="phase-title">Phase ${i + 1}</div>
        <div class="form-grid">
          ${fld(`ph${i}_name`, "Name", ph.name, "text", "text")}
          ${fld(`ph${i}_months`, "Monate", ph.months, "text", "numeric")}
          ${fld(`ph${i}_kcalMin`, "kcal von", ph.kcalMin, "text", "numeric")}
          ${fld(`ph${i}_kcalMax`, "kcal bis", ph.kcalMax, "text", "numeric")}
          ${fld(`ph${i}_proteinMin`, "Protein von", ph.proteinMin, "text", "numeric")}
          ${fld(`ph${i}_proteinMax`, "Protein bis", ph.proteinMax, "text", "numeric")}
          ${fld(`ph${i}_targetWeight`, "Ziel (kg)", ph.targetWeight)}
          ${fld(`ph${i}_targetBf`, "Ziel-KFA %", ph.targetBf, "text", "text")}
        </div>
      </div>`).join("")}
    <button type="submit" class="btn primary block" style="margin-top:12px">Plan speichern</button>`;
}

function bindWeight(body) {
  body.addEventListener("input", e => {
    const w = ui.wizard; if (!w) return;
    const el = e.target;
    if (el.dataset.wz) w[el.dataset.wz] = el.value;
    else if (el.dataset.wzp) w.phases[+el.dataset.wzp][el.dataset.k] = el.value;
  });
  body.addEventListener("change", e => {
    // Gewicht im Assistenten eingetragen und Phasen noch leer -> Vorschläge füllen
    const w = ui.wizard;
    if (w && e.target.dataset.wz === "weight" && parseNum(w.weight) && w.phases.every(p => !p.kcalMin)) { buildWizardPhases(w); refreshSheet(); }
  });
  body.addEventListener("click", e => {
    const g = e.target.closest("[data-goal]");
    if (g && ui.wizard) { ui.wizard.goal = g.dataset.goal; buildWizardPhases(ui.wizard); refreshSheet(); return; }
    const a = e.target.closest("[data-wz-act]");
    if (!a) return;
    const act = a.dataset.wzAct;
    if (act === "suggest") { if (!parseNum(ui.wizard.weight)) { flash(body.querySelector('[data-wz="weight"]')); return; } buildWizardPhases(ui.wizard); refreshSheet(); }
    else if (act === "save") saveWizard(body);
    else if (act === "skip") {
      fitness.updatePlan({ configured: true, phases: [] });
      ui.wizard = null; setHeader({ sub: "ohne Plan" }); refreshSheet();
    } else if (act === "restart") {
      ui.wizard = newWizard(fitness.getState()); setHeader({ sub: "Ziel einrichten" }); refreshSheet(); body.scrollTo({ top: 0 });
    }
  }, true);
  body.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === "weight") {
      const dateIn = form.querySelector("[data-w='date']");
      const kgIn = form.querySelector("[data-w='kg']");
      const kg = parseNum(kgIn.value);
      if (!isDayKey(dateIn.value) || dateIn.value > todayKey()) return flash(dateIn);
      if (!(kg > 20 && kg < 400)) return flash(kgIn);
      body.dataset.date = dateIn.value;
      kgIn.blur();
      fitness.logWeight(dateIn.value, kg);
      haptic();
      toast(`${fmtKg(kg)} kg am ${formatShort(dateIn.value)} gespeichert`);
    } else if (form.dataset.form === "plan") {
      savePlan(form);
    }
  });
  body.addEventListener("change", e => {
    if (e.target.dataset.w === "date") { body.dataset.date = e.target.value; refreshSheet(); }
  });
  body.addEventListener("click", e => {
    const segBtn = e.target.closest("[data-seg='wrange'] button");
    if (segBtn) { ui.weightRange = segBtn.dataset.range; refreshSheet(); return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const date = b.closest("[data-date]").dataset.date;
    if (b.dataset.act === "del") { if (confirm(`Gewicht vom ${formatLong(date)} löschen?`)) fitness.deleteWeight(date); }
    else { body.dataset.date = date; refreshSheet(); body.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => body.querySelector("[data-w='kg']").focus(), 250); }
  });
}

function savePlan(form) {
  const val = n => form.elements[n].value;
  const num = n => parseNum(val(n));
  const f = fitness.getState();
  const phases = f.plan.phases.map((ph, i) => ({
    ...ph,
    name: val(`ph${i}_name`).trim() || ph.name,
    months: Math.max(1, Math.round(num(`ph${i}_months`) || ph.months)),
    kcalMin: num(`ph${i}_kcalMin`) ?? ph.kcalMin, kcalMax: num(`ph${i}_kcalMax`) ?? ph.kcalMax,
    proteinMin: num(`ph${i}_proteinMin`) ?? ph.proteinMin, proteinMax: num(`ph${i}_proteinMax`) ?? ph.proteinMax,
    targetWeight: num(`ph${i}_targetWeight`) ?? ph.targetWeight,
    targetBf: val(`ph${i}_targetBf`).trim() || ph.targetBf,
  }));
  if (!isDayKey(val("startDate"))) return flash(form.elements.startDate);
  fitness.updatePlan({
    startDate: val("startDate"), startWeight: num("startWeight") ?? f.plan.startWeight,
    heightCm: num("heightCm") ?? f.plan.heightCm, creatineG: num("creatineG") ?? f.plan.creatineG, phases,
  });
  toast("Plan gespeichert");
}

/* ============================================================
   PANEL: TRAINING (Vollbild, Übungen als Akkordeon)
   ============================================================ */
export function openTraining({ date, templateId } = {}) {
  const f = fitness.getState();
  ui.workoutDate = date && isDayKey(date) && date <= todayKey() ? date : todayKey();
  if (templateId && (findTemplate(f, templateId) || f.workouts[workoutKey(ui.workoutDate, templateId)])) ui.templateId = templateId;
  else if (!date || !ui.templateId || !findTemplate(f, ui.templateId)) ui.templateId = suggestTemplate(f);
  ui.openEx = firstOpenExercise(f);
  openSheet({
    id: "training", cat: "Training", title: templateLabel(f, ui.templateId), sub: formatLong(ui.workoutDate), full: true,
    actions: [{ label: "Vorlagen", onClick: () => openManage() }],
    bind: bindTraining, render: () => renderTrainingBody(),
  });
}

function items(f) {
  const tpl = findTemplate(f, ui.templateId);
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const list = tpl ? tpl.items.map(i => ({ ...i, inTemplate: true })) : [];
  if (w) Object.keys(w.sets).forEach(exId => { if (!list.some(i => i.exId === exId)) list.push({ exId, sets: w.sets[exId].length, inTemplate: false }); });
  return list;
}

function firstOpenExercise(f) {
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const it = items(f).find(i => ["todo", "partial"].includes(exerciseStatus(w, i.exId, i.sets)));
  return it ? it.exId : null;
}

function progressHTML(list, w) {
  const finished = list.filter(i => ["done", "skipped"].includes(exerciseStatus(w, i.exId, i.sets))).length;
  const setCount = w ? Object.keys(w.sets).reduce((n, id) => n + validSets(w.sets[id]).length, 0) : 0;
  return `<span>${finished}/${list.length} Übungen</span><span class="bar"><i style="width:${list.length ? (finished / list.length) * 100 : 0}%"></i></span><span>${setCount} Sätze</span>`;
}

function renderTrainingBody() {
  if (currentSheetId() !== "training") return;
  const body = document.getElementById("sheetBody");
  const f = fitness.getState();
  const today = todayKey();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const list = items(f);
  const tabs = [...f.templates];
  if (!findTemplate(f, ui.templateId)) tabs.push({ id: ui.templateId, name: "Gelöschte Vorlage" });
  setHeader({ title: templateLabel(f, ui.templateId), sub: formatLong(ui.workoutDate) + (ui.workoutDate === today ? " · heute" : "") });
  const top = body.scrollTop;

  body.innerHTML = `
    <div class="w-nav">
      <button type="button" class="ico" data-act="day-prev" aria-label="Vorheriger Tag">‹</button>
      <input type="date" class="field" data-act-date value="${ui.workoutDate}" max="${today}" aria-label="Trainingsdatum">
      <button type="button" class="ico" data-act="day-next" aria-label="Nächster Tag" ${ui.workoutDate >= today ? "disabled" : ""}>›</button>
      ${ui.workoutDate !== today ? `<button type="button" class="btn small" data-act="day-today">Heute</button>` : `<span></span>`}
    </div>
    <div class="seg" style="margin-top:10px">${tabs.map(t => {
      const done = workoutHasData(f.workouts[workoutKey(ui.workoutDate, t.id)]);
      return `<button type="button" data-tpl="${esc(t.id)}" class="${t.id === ui.templateId ? "on" : ""} ${done ? "done" : ""}">${esc(t.name)}${done ? " ✓" : ""}</button>`;
    }).join("")}</div>
    ${ui.workoutDate !== today ? `<p class="w-where past">Du trägst für ${formatLong(ui.workoutDate)} nach.</p>` : ""}
    <div class="w-prog">${progressHTML(list, w)}</div>
    <div class="exs">${list.map(i => exerciseHTML(f, w, i)).join("") || `<div class="empty">Diese Vorlage ist leer. Oben rechts unter „Vorlagen“ Übungen hinzufügen.</div>`}</div>
    <details class="acc" data-acc="recent" ${ui.moveOpenKey ? "open" : ""}>
      <summary>Letzte Trainings</summary>
      <div class="acc-body" style="padding:0">${recentHTML(f)}</div>
    </details>`;
  body.scrollTop = top;
}

function exMeta(f, w, item, st) {
  if (st === "skipped") return "übersprungen";
  const sets = w ? validSets(w.sets[item.exId]) : [];
  if (sets.length) return (prSetIndex(f, item.exId, ui.workoutDate, w.sets[item.exId]) >= 0 ? "🏆 PR · " : "") + setsText(sets);
  if (!item.inTemplate) return "nicht in dieser Vorlage";
  const prev = previousPerformance(f, item.exId, ui.workoutDate, workoutKey(ui.workoutDate, ui.templateId));
  return prev ? `zuletzt ${setsText(prev.sets)}` : "noch nie geloggt";
}

function exerciseHTML(f, w, item) {
  const st = exerciseStatus(w, item.exId, item.sets);
  const slots = slotCount(w, item.exId, item.sets);
  const logged = w ? validSets(w.sets[item.exId]).length : 0;
  const open = ui.openEx === item.exId;
  return `
  <div class="ex ${open ? "open" : ""}" data-exid="${esc(item.exId)}" data-sets="${item.sets}" data-st="${st}" style="--p:${slots ? (logged / slots) * 100 : 0}%">
    <button type="button" class="ex-head" data-act="toggle-ex" aria-expanded="${open}">
      <span class="ex-mark">${st === "done" ? "✓" : st === "skipped" ? "–" : ""}</span>
      <span class="ex-txt"><span class="ex-name">${esc(exerciseName(f, item.exId))}</span><span class="ex-meta">${esc(exMeta(f, w, item, st))}</span></span>
      <span class="ex-count">${st === "skipped" ? "" : `${logged}/${slots}<small>Sätze</small>`}</span>
    </button>
    ${open ? exerciseBodyHTML(f, w, item, st, slots) : ""}
  </div>`;
}

function exerciseBodyHTML(f, w, item, st, slots) {
  if (st === "skipped") {
    return `<div class="ex-body"><div class="ex-actions"><button type="button" class="btn small" data-act="unskip">Wieder aufnehmen</button></div></div>`;
  }
  const sets = (w && w.sets[item.exId]) || [];
  const prev = previousPerformance(f, item.exId, ui.workoutDate, workoutKey(ui.workoutDate, ui.templateId));
  const canCopy = prev && prev.sets.some((_, i) => !sets[i] || (sets[i].kg == null && sets[i].reps == null));
  const rows = [];
  const prIdx = prSetIndex(f, item.exId, ui.workoutDate, sets);
  for (let i = 0; i < slots; i++) {
    const s = sets[i] || { kg: null, reps: null };
    const ph = prev ? (prev.sets[i] || prev.sets[prev.sets.length - 1]) : null;
    const isLogged = Number.isFinite(s.reps) && s.reps > 0;
    rows.push(`
      <div class="set ${isLogged ? "logged" : ""} ${i === prIdx ? "pr" : ""}" data-idx="${i}">
        <span class="set-no">${i === prIdx ? "PR" : i + 1}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" data-field="kg" value="${s.kg ?? ""}" placeholder="${ph && ph.kg != null ? ph.kg : "kg"}" aria-label="Satz ${i + 1} kg">
        <span class="set-x">×</span>
        <input type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off" data-field="reps" class="${s.kg != null && !isLogged ? "need" : ""}" value="${s.reps ?? ""}" placeholder="${ph ? ph.reps : "Wdh."}" aria-label="Satz ${i + 1} Wiederholungen">
        <button type="button" class="ico del" data-act="remove-set" aria-label="Satz ${i + 1} entfernen">✕</button>
      </div>`);
  }
  return `
    <div class="ex-body">
      ${prev ? `<div class="ex-last"><span>Zuletzt ${formatShort(prev.date)}: <b>${setsText(prev.sets)}</b></span>${canCopy ? `<button type="button" class="btn small" data-act="copy">Werte übernehmen</button>` : ""}</div>` : ""}
      ${slots ? `<div class="set-lbl"><span>#</span><span>KG</span><span></span><span>WDH</span><span></span></div>` : ""}
      ${rows.join("")}
      <div class="ex-actions">
        <button type="button" class="btn small ghost" data-act="add-set">+ Satz</button>
        ${!exerciseLogged(w, item.exId) ? `<button type="button" class="btn small ghost" data-act="skip">Überspringen</button>` : ""}
      </div>
    </div>`;
}

/** Nach einer Satz-Eingabe nur Kopf der Übung + Fortschritt aktualisieren (Inputs bleiben, kein Fokusverlust). */
function refreshExerciseHead(exId, maybeAdvance) {
  const body = document.getElementById("sheetBody");
  const el = body.querySelector(`.ex[data-exid="${CSS.escape(exId)}"]`);
  if (!el) return renderTrainingBody();
  const f = fitness.getState();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const list = items(f);
  const item = list.find(i => i.exId === exId);
  if (!item) return;
  const before = el.dataset.st;
  const st = exerciseStatus(w, exId, item.sets);
  const slots = slotCount(w, exId, item.sets);
  const logged = w ? validSets(w.sets[exId]).length : 0;
  el.dataset.st = st;
  el.style.setProperty("--p", `${slots ? (logged / slots) * 100 : 0}%`);
  el.querySelector(".ex-mark").textContent = st === "done" ? "✓" : "";
  el.querySelector(".ex-count").innerHTML = `${logged}/${slots}<small>Sätze</small>`;
  el.querySelector(".ex-meta").textContent = exMeta(f, w, item, st);
  const prIdx = prSetIndex(f, exId, ui.workoutDate, w ? w.sets[exId] : []);
  el.querySelectorAll(".set").forEach(row => {
    const i = +row.dataset.idx;
    const s = w && w.sets[exId] ? w.sets[exId][i] : null;
    const ok = s && Number.isFinite(s.reps) && s.reps > 0;
    row.classList.toggle("logged", !!ok);
    row.classList.toggle("pr", i === prIdx);
    row.querySelector(".set-no").textContent = i === prIdx ? "PR" : i + 1;
    row.querySelector("[data-field='reps']").classList.toggle("need", !!(s && s.kg != null && !ok));
  });
  const skipBtn = el.querySelector("[data-act='skip']");
  if (skipBtn && logged) skipBtn.remove();

  const prog = body.querySelector(".w-prog");
  if (prog) prog.innerHTML = progressHTML(list, w);
  const tab = body.querySelector(`.seg [data-tpl="${CSS.escape(ui.templateId)}"]`);
  if (tab) { const has = workoutHasData(w); tab.classList.toggle("done", has); tab.textContent = templateLabel(f, ui.templateId) + (has ? " ✓" : ""); }

  // Übung fertig -> nächste offene Übung aufklappen
  if (maybeAdvance && before !== "done" && st === "done") {
    haptic();
    setTimeout(() => {
      if (currentSheetId() !== "training" || ui.openEx !== exId) return;
      const a = document.activeElement;
      if (a && el.contains(a) && a.matches("input[data-field]")) return; // tippt noch in dieser Übung
      advanceFrom(exId);
    }, 400);
  }
}

function advanceFrom(exId) {
  const f = fitness.getState();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const list = items(f);
  const idx = list.findIndex(i => i.exId === exId);
  const next = list.slice(idx + 1).concat(list.slice(0, idx)).find(i => ["todo", "partial"].includes(exerciseStatus(w, i.exId, i.sets)));
  if (document.activeElement) document.activeElement.blur();
  ui.openEx = next ? next.exId : null;
  renderTrainingBody();
  if (next) scrollToExercise(next.exId);
  else toast("Training komplett ✓");
}

function scrollToExercise(exId) {
  const body = document.getElementById("sheetBody");
  const el = body.querySelector(`.ex[data-exid="${CSS.escape(exId)}"]`);
  if (el) body.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
}

function setWorkoutDate(date) {
  if (!isDayKey(date) || date > todayKey()) return;
  ui.workoutDate = date;
  ui.moveOpenKey = null;
  ui.openEx = firstOpenExercise(fitness.getState());
  renderTrainingBody();
}

function bindTraining(body) {
  body.addEventListener("change", e => {
    const input = e.target;
    if (input.matches("[data-act-date]")) {
      if (isDayKey(input.value) && input.value <= todayKey()) setWorkoutDate(input.value);
      else { input.value = ui.workoutDate; toast("Datum in der Zukunft geht nicht", "err"); }
      return;
    }
    if (!input.matches("input[data-field]")) return;
    const ex = input.closest(".ex");
    const setIndex = +input.closest(".set").dataset.idx;
    const field = input.dataset.field;
    const value = parseNum(input.value);
    if (input.value.trim() !== "" && value == null) return flash(input);
    if (value != null && (value < 0 || value > (field === "kg" ? 1000 : 200))) return flash(input);
    if (field === "reps" && value != null) input.value = Math.round(value);
    try {
      fitness.logSet({ date: ui.workoutDate, templateId: ui.templateId, exerciseId: ex.dataset.exid, setIndex, [field]: value });
      checkPR(ex.dataset.exid, setIndex);
    } catch (err) { toast(err.message, "err"); }
  });

  // Enter: kg -> Wdh. -> nächster Satz; nach dem letzten Feld Tastatur zu
  body.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !e.target.matches("input[data-field]")) return;
    e.preventDefault();
    const inputs = [...e.target.closest(".ex").querySelectorAll("input[data-field]")];
    const i = inputs.indexOf(e.target);
    if (inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
  });

  // Tastatur zu (Feld verlassen) und Übung fertig -> weiter zur nächsten
  body.addEventListener("focusout", e => {
    if (!e.target.matches("input[data-field]")) return;
    const ex = e.target.closest(".ex");
    setTimeout(() => {
      if (currentSheetId() !== "training" || !ex.isConnected) return;
      const a = document.activeElement;
      if (a && ex.contains(a)) return;
      if (ex.dataset.st === "done" && ui.openEx === ex.dataset.exid && !(a && a.closest && a.closest(".ex"))) advanceFrom(ex.dataset.exid);
    }, 450);
  });

  body.addEventListener("click", e => {
    const tab = e.target.closest(".seg [data-tpl]");
    if (tab) { ui.templateId = tab.dataset.tpl; ui.openEx = firstOpenExercise(fitness.getState()); renderTrainingBody(); return; }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const ex = b.closest(".ex");
    const exId = ex && ex.dataset.exid;
    const base = { date: ui.workoutDate, templateId: ui.templateId, exerciseId: exId, defaultSets: ex ? +ex.dataset.sets : 0 };
    try {
      switch (b.dataset.act) {
        case "day-prev": setWorkoutDate(addDays(ui.workoutDate, -1)); break;
        case "day-next": setWorkoutDate(addDays(ui.workoutDate, 1)); break;
        case "day-today": setWorkoutDate(todayKey()); break;
        case "toggle-ex":
          ui.openEx = ui.openEx === exId ? null : exId;
          renderTrainingBody();
          if (ui.openEx) scrollToExercise(exId);
          break;
        case "add-set": {
          fitness.addSetRow(base);
          const rows = body.querySelectorAll(`.ex[data-exid="${CSS.escape(exId)}"] input[data-field='kg']`);
          if (rows.length) rows[rows.length - 1].focus();
          break;
        }
        case "remove-set": {
          const wasDone = ex.dataset.st === "done";
          fitness.removeSetRow({ ...base, setIndex: +b.closest(".set").dataset.idx });
          const now = body.querySelector(`.ex[data-exid="${CSS.escape(exId)}"]`);
          if (!wasDone && now && now.dataset.st === "done") { haptic(); setTimeout(() => { if (ui.openEx === exId) advanceFrom(exId); }, 350); }
          break;
        }
        case "skip": fitness.skipExercise(base); advanceFrom(exId); break;
        case "unskip": fitness.unskipExercise(base); break;
        case "copy": {
          const r = fitness.copyPrevious(base);
          if (r.copied) { haptic(); toast(`${r.copied} ${r.copied === 1 ? "Satz" : "Sätze"} übernommen · anpassen falls nötig`); }
          break;
        }
        default: recentAction(b);
      }
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ---------- PR-Moment ---------- */
const celebrated = new Map(); // "datum|übung" -> bereits gefeiertes e1RM
function checkPR(exId, setIndex) {
  const f = fitness.getState();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const set = w && w.sets[exId] ? w.sets[exId][setIndex] : null;
  const prior = priorBest(f, exId, ui.workoutDate);
  if (!isPR(prior, set)) return;
  const key = `${ui.workoutDate}|${exId}`;
  const now = e1rm(set.kg, set.reps);
  if (celebrated.has(key) && now <= celebrated.get(key)) return;
  celebrated.set(key, now);
  celebratePR({ name: exerciseName(f, exId), set, now, gain: now - prior.e1rm, heavier: (set.kg || 0) > prior.topKg });
}

function celebratePR({ name, set, now, gain, heavier }) {
  let el = document.getElementById("prFlash");
  if (!el) { el = document.createElement("div"); el.id = "prFlash"; document.body.appendChild(el); el.addEventListener("click", () => el.classList.remove("on")); }
  const sparks = Array.from({ length: 26 }, () => {
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 150;
    return `<i style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d - 40).toFixed(0)}px;--t:${(0.6 + Math.random() * 0.6).toFixed(2)}s"></i>`;
  }).join("");
  el.innerHTML = `<div class="pr-box">
      <div class="pr-sparks">${sparks}</div>
      <div class="pr-trophy">🏆</div>
      <div class="pr-title">NEW PR</div>
      <div class="pr-ex">${esc(name)}</div>
      <div class="pr-set">${set.kg ?? 0} kg × ${set.reps}</div>
      <div class="pr-meta">e1RM ${now.toFixed(1)} kg · +${gain.toFixed(1)} kg${heavier ? " · schwerster Satz bisher" : ""}</div>
    </div>`;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 120]);
  clearTimeout(celebratePR.t);
  celebratePR.t = setTimeout(() => el.classList.remove("on"), 2800);
}

/* ---------- Letzte Trainings ---------- */
function recentHTML(f) {
  const list = Object.entries(f.workouts).filter(([, w]) => workoutHasData(w))
    .sort((a, b) => b[1].date.localeCompare(a[1].date) || a[1].templateId.localeCompare(b[1].templateId)).slice(0, 12);
  if (!list.length) return `<div class="empty">Noch keine Trainings geloggt.</div>`;
  return `<div class="rows" style="border:0;border-radius:0">${list.map(([key, w]) => {
    const n = Object.keys(w.sets).filter(id => exerciseLogged(w, id)).length;
    const open = ui.moveOpenKey === key;
    return `<div data-key="${esc(key)}">
      <div class="r">
        <button type="button" class="r-main" data-act="w-open">${DOW_SHORT[weekday(w.date)]} ${formatDate(w.date)} · ${esc(templateLabel(f, w.templateId))}</button>
        <span class="r-val">${n} Üb.</span>
        <button type="button" class="ico" data-act="w-move" aria-label="Datum ändern">⇄</button>
        <button type="button" class="ico del" data-act="w-del" aria-label="Löschen">✕</button>
      </div>
      ${open ? `<div class="form-row" style="padding:0 8px 10px">
        <input type="date" class="field" value="${w.date}" max="${todayKey()}">
        <select class="field">${f.templates.map(t => `<option value="${esc(t.id)}" ${t.id === w.templateId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <button type="button" class="btn small primary" data-act="w-move-ok">OK</button>
      </div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function recentAction(b) {
  const row = b.closest("[data-key]"); if (!row) return;
  const key = row.dataset.key;
  const f = fitness.getState();
  const w = f.workouts[key];
  if (!w) return;
  switch (b.dataset.act) {
    case "w-open":
      ui.workoutDate = w.date; ui.templateId = w.templateId; ui.moveOpenKey = null;
      ui.openEx = firstOpenExercise(f); renderTrainingBody();
      document.getElementById("sheetBody").scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "w-move": ui.moveOpenKey = ui.moveOpenKey === key ? null : key; renderTrainingBody(); break;
    case "w-move-ok": {
      const toDate = row.querySelector("input[type=date]").value;
      const toTemplateId = row.querySelector("select").value;
      if (!isDayKey(toDate) || toDate > todayKey()) return flash(row.querySelector("input[type=date]"));
      let res = fitness.moveWorkout({ fromKey: key, toDate, toTemplateId });
      if (res.conflict) {
        if (!confirm(`Am ${formatLong(toDate)} gibt es schon „${templateLabel(f, toTemplateId)}“. Zusammenführen?`)) return;
        res = fitness.moveWorkout({ fromKey: key, toDate, toTemplateId, merge: true });
      }
      ui.moveOpenKey = null; ui.workoutDate = toDate; ui.templateId = toTemplateId;
      renderTrainingBody(); toast(`Verschoben auf ${formatShort(toDate)}`);
      break;
    }
    case "w-del":
      if (confirm(`Training vom ${formatLong(w.date)} komplett löschen?`)) fitness.deleteWorkout(key);
      break;
  }
}

/* ============================================================
   PANEL: VORLAGEN VERWALTEN
   ============================================================ */
export function openManage() {
  const f = fitness.getState();
  if (!ui.manageTpl || !findTemplate(f, ui.manageTpl)) ui.manageTpl = findTemplate(f, ui.templateId) ? ui.templateId : f.templates[0].id;
  openSheet({
    id: "manage", cat: "Training", title: "Vorlagen", sub: "Übungen, Reihenfolge, Sätze", full: true,
    back: () => openTraining({ date: ui.workoutDate, templateId: ui.templateId }),
    bind: bindManage, render: renderManage,
  });
}

function renderManage(body) {
  const f = fitness.getState();
  const tpl = findTemplate(f, ui.manageTpl) || f.templates[0];
  ui.manageTpl = tpl.id;
  const notIn = f.exercises.filter(ex => !tpl.items.some(i => i.exId === ex.id));
  const accOpen = !!body.querySelector("details[open]:not([data-acc])");
  const musOpen = !!body.querySelector('details[data-acc="muscles"][open]');
  body.innerHTML = `
    <div class="seg">${f.templates.map(t => `<button type="button" data-mtpl="${esc(t.id)}" class="${t.id === tpl.id ? "on" : ""}">${esc(t.name)}</button>`).join("")}</div>
    <div class="psec">Übungen · ${tpl.items.length}</div>
    <div class="rows">
      ${tpl.items.map((it, i) => `
        <div class="mg-item" data-idx="${i}" data-exid="${esc(it.exId)}">
          <button type="button" class="ico" data-mg="up" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">▲</button>
          <button type="button" class="ico" data-mg="down" ${i === tpl.items.length - 1 ? "disabled" : ""} aria-label="Nach unten">▼</button>
          <input class="field" data-mg-name value="${esc(exerciseName(f, it.exId))}" aria-label="Übungsname">
          <input class="field sets" data-mg-sets inputmode="numeric" value="${it.sets}" aria-label="Geplante Sätze">
          <button type="button" class="ico del" data-mg="remove" aria-label="Aus Vorlage entfernen">✕</button>
        </div>`).join("") || `<div class="empty">Noch keine Übungen.</div>`}
    </div>
    <p class="hint">Name gilt in allen Vorlagen. Zahl rechts = geplante Sätze. Entfernen löscht keinen Verlauf.</p>
    <div class="psec">Hinzufügen</div>
    <div class="stack">
      ${notIn.length ? `<div class="form-row" style="grid-template-columns:minmax(0,1fr) auto">
        <select class="field" data-mg-existing aria-label="Vorhandene Übung">${notIn.map(ex => `<option value="${esc(ex.id)}">${esc(ex.name)}</option>`).join("")}</select>
        <button type="button" class="btn small" data-mg="add-existing">+</button></div>` : ""}
      <form class="form-row" data-mg-form style="grid-template-columns:minmax(0,1fr) auto">
        <input class="field" data-mg-new placeholder="Neue Übung, z.B. Beinpresse" enterkeyhint="done">
        <button type="submit" class="btn small primary">Anlegen</button>
      </form>
    </div>
    <details class="acc" data-acc="muscles" ${musOpen ? "open" : ""}>
      <summary>Muskelgruppen</summary>
      <div class="acc-body stack">
        ${f.exercises.map(ex => { const m = muscleOf(f, ex.id); return `<label class="lbl-field">${esc(ex.name)}
          <select class="field" data-mg-muscle="${esc(ex.id)}">
            <option value="">${m && !ex.muscle ? `Automatisch (${esc(MUSCLES[m.p])})` : "Automatisch"}</option>
            ${Object.entries(MUSCLES).map(([k, v]) => `<option value="${k}" ${ex.muscle === k ? "selected" : ""}>${v}</option>`).join("")}
          </select></label>`; }).join("")}
      </div>
    </details>
    <details class="acc" ${accOpen ? "open" : ""}>
      <summary>Vorlage bearbeiten</summary>
      <div class="acc-body stack">
        <label class="lbl-field">Name der Vorlage<input class="field" data-mg-tplname value="${esc(tpl.name)}"></label>
        <label class="lbl-field">Trainings pro Woche (Ziel)<input class="field" data-mg-weekly inputmode="numeric" value="${f.weeklyTarget}"></label>
        <button type="button" class="btn ghost" data-mg="add-tpl">+ Neue Vorlage</button>
        <button type="button" class="btn ghost" data-mg="copy-tpl">Vorlage kopieren</button>
        <button type="button" class="btn danger" data-mg="del-tpl" ${f.templates.length <= 1 ? "disabled" : ""}>Vorlage löschen</button>
      </div>
    </details>`;
}

function bindManage(body) {
  body.addEventListener("change", e => {
    const el = e.target;
    const row = el.closest(".mg-item");
    if (el.matches("[data-mg-name]")) fitness.renameExercise(row.dataset.exid, el.value);
    else if (el.matches("[data-mg-sets]")) fitness.setTargetSets(ui.manageTpl, +row.dataset.idx, parseNum(el.value));
    else if (el.matches("[data-mg-tplname]")) fitness.renameTemplate(ui.manageTpl, el.value);
    else if (el.matches("[data-mg-weekly]")) fitness.setWeeklyTarget(parseNum(el.value));
    else if (el.matches("[data-mg-muscle]")) { fitness.setExerciseMuscle(el.dataset.mgMuscle, el.value); toast("Muskelgruppe gespeichert"); }
  });
  body.addEventListener("submit", e => {
    e.preventDefault();
    const input = body.querySelector("[data-mg-new]");
    if (!input.value.trim()) return flash(input);
    fitness.addExercise(input.value, ui.manageTpl, 3);
    toast("Übung angelegt");
  });
  body.addEventListener("click", e => {
    const t = e.target.closest("[data-mtpl]");
    if (t) { ui.manageTpl = t.dataset.mtpl; refreshSheet(); return; }
    const b = e.target.closest("[data-mg]");
    if (!b || b.disabled) return;
    const row = b.closest(".mg-item");
    const idx = row ? +row.dataset.idx : -1;
    const f = fitness.getState();
    try {
      switch (b.dataset.mg) {
        case "up": fitness.moveExercise(ui.manageTpl, idx, -1); break;
        case "down": fitness.moveExercise(ui.manageTpl, idx, 1); break;
        case "remove": fitness.removeExerciseFromTemplate(ui.manageTpl, idx); break;
        case "add-existing": fitness.addExerciseToTemplate(ui.manageTpl, body.querySelector("[data-mg-existing]").value, 3); break;
        case "add-tpl":
        case "copy-tpl": {
          const name = prompt("Name der neuen Vorlage:", b.dataset.mg === "copy-tpl" ? `${findTemplate(f, ui.manageTpl).name} (Kopie)` : `Training ${f.templates.length + 1}`);
          if (name) { ui.manageTpl = fitness.addTemplate(name, b.dataset.mg === "copy-tpl" ? ui.manageTpl : null); refreshSheet(); }
          break;
        }
        case "del-tpl": {
          const tp = findTemplate(f, ui.manageTpl);
          if (!confirm(`Vorlage „${tp.name}“ löschen? Geloggte Trainings bleiben erhalten.`)) return;
          ui.manageTpl = null;
          if (ui.templateId === tp.id) ui.templateId = null;
          fitness.deleteTemplate(tp.id);
          if (!ui.templateId) ui.templateId = fitness.getState().templates[0].id;
          break;
        }
      }
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   PANEL: FORTSCHRITT
   ============================================================ */
export function openProgress(exId) {
  if (exId) ui.exerciseId = exId;
  openSheet({ id: "progress", cat: "Analyse", title: "Fortschritt", sub: "e1RM, Trend und Plateaus", bind: bindProgress, render: renderProgress });
}

function renderProgress(body) {
  const f = fitness.getState();
  const ids = exerciseIdsWithData(f);
  if (!ids.length) {
    body.innerHTML = `<div class="empty" style="margin-top:30px">Sobald du Sätze loggst, erscheinen hier Charts und das Plateau-Radar.</div>`;
    return;
  }
  if (!ui.exerciseId || !ids.includes(ui.exerciseId)) ui.exerciseId = ids[0];
  const series = exerciseSeries(f, ui.exerciseId);
  const m = METRICS[ui.metric];
  const status = plateauStatus(series);
  const rank = { plateau: 0, decline: 1, progress: 2, insufficient: 3 };
  const radar = ids.map(id => ({ id, name: exerciseName(f, id), st: plateauStatus(exerciseSeries(f, id)) }))
    .sort((a, b) => rank[a.st.status] - rank[b.st.status] || a.name.localeCompare(b.name));
  const stCls = { progress: "ok", plateau: "warn", decline: "bad", insufficient: "" }[status.status];
  const pr = series.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
  const last = series[series.length - 1];

  body.innerHTML = `
    <select class="field" data-p-ex aria-label="Übung">${ids.map(id => `<option value="${esc(id)}" ${id === ui.exerciseId ? "selected" : ""}>${esc(exerciseName(f, id))}</option>`).join("")}</select>
    <div class="seg-row">
      <div class="seg" data-seg="metric">${Object.entries(METRICS).map(([k, x]) => `<button type="button" data-metric="${k}" class="${k === ui.metric ? "on" : ""}">${x.label}</button>`).join("")}</div>
      <div class="seg" data-seg="exrange">${rangeButtons(ui.exRange)}</div>
    </div>
    <div class="chart-box lg"><canvas id="exChart"></canvas></div>
    <p class="hint">${esc(m.help)}</p>
    <div class="kv" style="margin-top:12px">
      <div><b>Bestwert</b><span>${pr.e1rm.toFixed(1)} kg</span><em>${pr.bestSet.kg ?? 0}×${pr.bestSet.reps} · ${formatShort(pr.date)}</em></div>
      <div><b>Zeitraum</b><span data-change>--</span><em>${esc(m.label)}</em></div>
      <div><b>Zuletzt</b><span>${formatShort(last.date)}</span><em>${esc(setsText(last.sets))}</em></div>
    </div>
    <div class="callout ${stCls}"><b>${esc(status.label)}</b>${esc(status.detail)}</div>
    <details class="acc" data-acc="records" ${body.querySelector('details[data-acc="records"][open]') ? "open" : ""}>
      <summary>🏆 Bestwerte</summary>
      <div class="acc-body" style="padding:0"><div class="rows" style="border:0;border-radius:0">
      ${records(f).sort((a, b) => b.e1rm - a.e1rm).map(r => `<div class="r" data-ex="${esc(r.exId)}">
        <span class="r-main">${esc(r.name)}<span class="r-sub">schwerster Satz ${r.heavy.kg ?? 0}×${r.heavy.reps} · ${formatShort(r.heavyDate)}</span></span>
        <span class="r-val"><b>${r.e1rm.toFixed(1)}</b> kg<br><small>${r.e1rmSet.kg ?? 0}×${r.e1rmSet.reps}</small></span></div>`).join("")}
      </div></div>
    </details>
    <div class="psec">Plateau-Radar</div>
    <div class="rows radar">${radar.map(r => {
      const c = { progress: "var(--ok)", plateau: "var(--warn)", decline: "var(--bad)", insufficient: "var(--dim)" }[r.st.status];
      return `<div class="r ${r.id === ui.exerciseId ? "on" : ""}" data-ex="${esc(r.id)}">
        <span class="r-main">${esc(r.name)}</span>
        <span class="r-val">${r.st.weeklyPct != null ? fmtSigned(r.st.weeklyPct, 1) + "%/W" : ""}</span>
        <span class="badge" style="color:${c}">${esc(r.st.label)}</span></div>`;
    }).join("")}</div>`;

  const { visible } = renderExerciseChart(body.querySelector("#exChart"), {
    series, metric: ui.metric, range: ui.exRange, accent: getAccent(), templateName: id => templateLabel(f, id),
  });
  if (visible.length >= 2) {
    const a = m.get(visible[0]), z = m.get(visible[visible.length - 1]);
    const pct = a ? ((z - a) / a) * 100 : 0;
    const el = body.querySelector("[data-change]");
    el.textContent = `${fmtSigned(pct, 1)} %`;
    el.style.color = pct >= 0 ? "var(--ok)" : "var(--bad)";
  }
}

function bindProgress(body) {
  body.addEventListener("change", e => { if (e.target.matches("[data-p-ex]")) { ui.exerciseId = e.target.value; refreshSheet(); } });
  body.addEventListener("click", e => {
    const mb = e.target.closest("[data-metric]"); if (mb) { ui.metric = mb.dataset.metric; refreshSheet(); return; }
    const rb = e.target.closest("[data-seg='exrange'] button"); if (rb) { ui.exRange = rb.dataset.range; refreshSheet(); return; }
    const row = e.target.closest("[data-ex]");
    if (row) { ui.exerciseId = row.dataset.ex; refreshSheet(); body.scrollTo({ top: 0, behavior: "smooth" }); }
  });
}

/* ---------------- Helfer ---------------- */
function rangeButtons(active) {
  return Object.entries(RANGES).map(([k, r]) => `<button type="button" data-range="${k}" class="${k === active ? "on" : ""}">${r.label}</button>`).join("");
}
function flash(el) {
  if (!el) return;
  el.classList.add("invalid");
  el.focus();
  setTimeout(() => el.classList.remove("invalid"), 1500);
}

/* ============================================================
   PANEL: MUSKELN (Übersicht + Detail pro Gruppe)
   ============================================================ */
export function openMuscles(group = null) {
  ui.muscleFocus = group;
  openSheet({ id: "muscles", cat: "Körper", title: "Muskeln", sub: "Harte Sätze pro Muskel", bind: bindMuscles, render: renderMuscles });
}
const fmtN = n => (Math.round(n * 10) / 10).toString();
const stateCls = (n, target) => (n === 0 ? "st-bad" : n < target * 0.6 ? "st-warn" : "st-ok");

function renderMuscles(body) {
  const f = fitness.getState();
  const today = todayKey();
  const weeks = ui.muscleWeeks || 1;
  const to = addDays(mondayOf(today), 6);
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  const ss = subSets(f, from, to);
  const gs = muscleSets(f, from, to);
  const per = n => n / weeks;
  const lv = Object.fromEntries(Object.entries(ss).map(([k, v]) => [k, per(v.sets) / SUB_TARGET]));
  const focus = ui.muscleFocus;
  const range = `<div class="seg"><button type="button" data-mw="1" class="${weeks === 1 ? "on" : ""}">Diese Woche</button><button type="button" data-mw="4" class="${weeks === 4 ? "on" : ""}">Ø 4 Wochen</button></div>`;
  setHeader({ title: focus ? MUSCLES[focus] : "Muskeln", sub: focus ? `${fmtN(per(gs[focus]))} Sätze ${weeks === 1 ? "diese Woche" : "pro Woche"} · Richtwert ~${WEEKLY_SET_TARGET}` : "Tippe auf einen Muskel für Details" });

  if (!focus) {
    const noMap = f.exercises.filter(e => !muscleOf(f, e.id));
    body.innerHTML = `${range}
      <div class="bm-wrap tap">${bodySVG(lv)}</div>
      <div class="psec">Gruppen ${weeks === 1 ? "diese Woche" : "pro Woche (Ø)"}</div>
      <div class="rows">${Object.entries(MUSCLES).map(([g, label]) => {
        const n = per(gs[g]);
        const subs = Object.keys(SUBS).filter(k => SUBS[k].g === g);
        const weak = subs.filter(k => per(ss[k].sets) < SUB_TARGET * 0.5).length;
        return `<button type="button" class="r mus link-row" data-focus="${g}">
          <span class="r-main">${label}${weak ? `<span class="r-sub st-warn">${weak} von ${subs.length} zu wenig</span>` : `<span class="r-sub">${subs.length} Muskeln ok</span>`}</span>
          <span class="mus-bar"><i style="width:${Math.min(100, (n / WEEKLY_SET_TARGET) * 100)}%"></i></span>
          <span class="r-val ${stateCls(n, WEEKLY_SET_TARGET)}">${fmtN(n)}</span><span class="chev">›</span></button>`;
      }).join("")}</div>
      <p class="hint">Richtwert: etwa ${WEEKLY_SET_TARGET} harte Sätze pro Gruppe und Woche. Übungen, die einen Muskel nur mittreffen (z.B. Trizeps bei Chestpress), zählen halb.</p>
      ${noMap.length ? `<div class="callout warn"><b>Ohne Muskelgruppe</b>${noMap.map(e => esc(e.name)).join(", ")} · zuordnen unter Training → Vorlagen → Muskelgruppen</div>` : ""}`;
    return;
  }

  const subs = Object.keys(SUBS).filter(k => SUBS[k].g === focus);
  body.innerHTML = `
    <button type="button" class="link back-link" data-focus="">‹ Alle Muskeln</button>
    ${range}
    <div class="bm-wrap zoom tap">${bodySVG(lv, { focus })}</div>
    <div class="psec">Einzelne Muskeln</div>
    <div class="subs-list">${subs.map((k, i) => {
      const n = per(ss[k].sets);
      const by = Object.entries(ss[k].by).sort((a, b) => b[1] - a[1]);
      const cls = stateCls(n, SUB_TARGET);
      return `<div class="sub-card">
        <div class="sub-top"><span class="num">${i + 1}</span><b>${SUBS[k].label}</b>
          <span class="r-val ${cls}">${fmtN(n)} <small>/ ~${SUB_TARGET}</small></span></div>
        <span class="mus-bar"><i style="width:${Math.min(100, (n / SUB_TARGET) * 100)}%"></i></span>
        <div class="sub-by">${by.length ? by.map(([id, x]) => `${esc(exerciseName(f, id))} <b>${fmtN(per(x))}</b>`).join(" · ") : "Noch nicht trainiert"}</div>
        ${n < SUB_TARGET * 0.6 ? `<div class="sub-tip">Mehr davon: ${esc(SUBS[k].tip)}</div>` : ""}
      </div>`;
    }).join("")}</div>
    <p class="hint">Zahl = Sätze ${weeks === 1 ? "diese Woche" : "pro Woche im Schnitt"}. Hauptmuskel einer Übung zählt ganz, mitbeteiligte Muskeln halb. Richtwert pro einzelnem Muskel grob ~${SUB_TARGET}.</p>`;
}

function bindMuscles(body) {
  body.addEventListener("click", e => {
    const b = e.target.closest("[data-mw]");
    if (b) { ui.muscleWeeks = +b.dataset.mw; refreshSheet(); return; }
    const fcs = e.target.closest("[data-focus]");
    if (fcs) { ui.muscleFocus = fcs.dataset.focus || null; refreshSheet(); body.scrollTo({ top: 0 }); return; }
    const poly = e.target.closest(".bm-m");
    if (poly) { ui.muscleFocus = poly.dataset.g; refreshSheet(); body.scrollTo({ top: 0 }); }
  });
}
