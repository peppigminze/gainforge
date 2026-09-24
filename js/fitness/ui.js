/* ============================================================
   fitness/ui.js — Darstellung + Eingaben
   ------------------------------------------------------------
   Liest nur über fitness.getState() und ändert nur über die
   Commands aus commands.js. Klick-Handler enthalten keine
   Datenlogik.
   ============================================================ */

import { fitness, onFitnessChange } from "./commands.js";
import { exerciseName, findTemplate, validSets, workoutKey, workoutHasData, exerciseLogged, parseNum } from "./model.js";
import {
  exerciseSeries, plateauStatus, previousPerformance, weightEntries, weeklyAverages,
  courseStatus, currentPhase, plannedWeightAt, fmtSigned, METRICS, e1rm,
} from "./analytics.js";
import { renderWeightChart, renderExerciseChart, RANGES } from "./charts.js";
import { todayKey, addDays, mondayOf, isoWeek, formatLong, formatShort, formatDate, isDayKey } from "../dates.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtKg = (n, d = 1) => (n == null ? "--.-" : n.toFixed(d));

const ui = {
  workoutDate: todayKey(),
  templateId: null,
  extraSlots: {},
  weightRange: "3m",
  exRange: "3m",
  metric: "e1rm",
  exerciseId: null,
  manageTpl: null,
  moveOpenKey: null,
};

let getAccent = () => ({ hex: "#4CE0B3", rgb: "76,224,179" });
let initialized = false;

/* ============================================================
   INIT
   ============================================================ */
export function initFitnessUI(options) {
  if (options && options.getAccent) getAccent = options.getAccent;
  if (initialized) return;
  initialized = true;

  bindWeightEvents();
  bindWorkoutEvents();
  bindManageEvents();
  bindProgressEvents();

  onFitnessChange((scope, detail) => {
    if (scope === "set") {
      refreshExerciseCard(detail.exerciseId);
      renderSessionTabs();
      renderSaveInfo();
      renderWeekCount();
      renderRecentWorkouts();
      renderProgress();
    } else if (scope === "weight" || scope === "plan") {
      renderWeight();
      if (scope === "plan") renderPlanForm();
    } else {
      renderWorkout();
      renderProgress();
    }
  });
}

export function renderFitness() {
  const f = fitness.getState();
  if (!ui.templateId || !findTemplate(f, ui.templateId)) ui.templateId = suggestTemplate(f);
  renderWeight();
  renderPlanForm();
  renderWorkout();
  renderProgress();
}

/** Vorschlag: erste Vorlage, die diese Woche noch nicht trainiert wurde. */
function suggestTemplate(f) {
  const monday = mondayOf(todayKey());
  const doneThisWeek = new Set(Object.values(f.workouts).filter(w => w.date >= monday && workoutHasData(w)).map(w => w.templateId));
  const open = f.templates.find(t => !doneThisWeek.has(t.id));
  return (open || f.templates[0]).id;
}

function templateLabel(f, id) {
  const t = findTemplate(f, id);
  return t ? t.name : "Gelöschte Vorlage";
}

function rangeButtons(containerId, active) {
  $(containerId).innerHTML = Object.entries(RANGES)
    .map(([key, r]) => `<button type="button" data-range="${key}" class="${key === active ? "active" : ""}">${r.label}</button>`)
    .join("");
}

/* ============================================================
   GEWICHT
   ============================================================ */
function renderWeight() {
  const f = fitness.getState();
  const today = todayKey();
  const entries = weightEntries(f);
  const weekly = weeklyAverages(entries);
  const thisMonday = mondayOf(today);
  const cur = weekly.find(w => w.monday === thisMonday);
  const prev = weekly.find(w => w.monday === addDays(thisMonday, -7));

  $("wkAvgLabel").textContent = `Ø KW ${isoWeek(today)}`;
  $("wkAvg").textContent = cur ? fmtKg(cur.avg) : "--.-";
  $("wkAvgSub").textContent = cur ? `${cur.n} von 7 Messungen${cur.n < 3 ? " · noch wenig Werte" : ""}` : "Diese Woche noch nichts eingetragen";
  $("wkPrev").textContent = prev ? fmtKg(prev.avg) + " kg" : "--.-";
  $("wkDelta").textContent = cur && prev ? `${fmtSigned(cur.avg - prev.avg, 2)} kg zur Vorwoche` : "";

  const course = courseStatus(f, today);
  const planNow = plannedWeightAt(f.plan, today);
  $("wkRate").textContent = course.rate != null ? `${fmtSigned(course.rate, 2)} kg` : "--";
  $("wkRatePlan").textContent = planNow ? `pro Woche · Plan ${fmtSigned(planNow.weeklyRate, 2)}` : "pro Woche";

  const box = $("courseBox");
  box.className = "fx-course state-" + course.state;
  box.innerHTML = `
    <span class="fx-course-title">${esc(course.title)}</span>
    <span class="fx-course-text">${esc(course.text)}</span>
    ${course.soll ? `<span class="fx-course-meta">Ist Ø ${fmtKg(course.ref.avg, 2)} kg (KW ${isoWeek(course.ref.monday)}) · Soll ${fmtKg(course.soll.weight, 2)} kg</span>` : ""}`;

  const phase = currentPhase(f.plan, today);
  const p = f.plan;
  if (phase) {
    const s = phase.seg;
    $("phaseLabel").textContent =
      phase.state === "upcoming" ? `Plan startet am ${formatDate(s.start)}` :
      phase.state === "finished" ? "Plan abgeschlossen" :
      `${s.name} · Monat ${phase.monthNo} von ${s.months}`;
    $("phaseTargets").innerHTML = `
      <span><b>${s.kcalMin}–${s.kcalMax}</b> kcal</span>
      <span><b>${s.proteinMin}–${s.proteinMax} g</b> Protein</span>
      <span>Kreatin <b>${p.creatineG} g</b></span>
      <span>Ziel ${s.name}: <b>${s.targetWeight} kg</b> bei ${esc(s.targetBf)} % KFA bis ${formatDate(s.end)}</span>`;
  }

  if (!isDayKey($("weightDate").value)) $("weightDate").value = today;
  syncWeightFormHint();

  rangeButtons("weightRange", ui.weightRange);
  renderWeightChart($("weightChart"), { entries, weekly, plan: f.plan, range: ui.weightRange, accent: getAccent() });

  const list = [...entries].reverse().slice(0, 21);
  $("weightList").innerHTML = list.length
    ? list.map(e => `
        <div class="fx-row" data-date="${e.date}">
          <button type="button" class="fx-row-main" data-action="edit-weight">${formatLong(e.date)}</button>
          <span class="fx-row-val">${fmtKg(e.kg)} kg</span>
          <button type="button" class="fx-icon" data-action="del-weight" aria-label="Eintrag löschen">✕</button>
        </div>`).join("")
    : `<p class="fx-empty">Noch keine Einträge.</p>`;
}

function syncWeightFormHint() {
  const f = fitness.getState();
  const date = $("weightDate").value;
  const existing = f.weights[date];
  $("weightInput").placeholder = existing != null ? `${fmtKg(existing)} kg gespeichert` : "kg";
  $("weightSubmit").textContent = existing != null ? "Ändern" : "Speichern";
}

function bindWeightEvents() {
  $("weightDate").addEventListener("change", syncWeightFormHint);

  $("weightForm").addEventListener("submit", e => {
    e.preventDefault();
    const date = $("weightDate").value;
    const kg = parseNum($("weightInput").value);
    if (!isDayKey(date)) return flash($("weightDate"));
    if (!(kg > 20 && kg < 400)) return flash($("weightInput"));
    fitness.logWeight(date, kg);
    $("weightInput").value = "";
    $("weightInput").blur();
  });

  $("weightRange").addEventListener("click", e => {
    const b = e.target.closest("button[data-range]");
    if (!b) return;
    ui.weightRange = b.dataset.range;
    renderWeight();
  });

  $("weightList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const date = btn.closest(".fx-row").dataset.date;
    if (btn.dataset.action === "del-weight") {
      if (confirm(`Gewicht vom ${formatLong(date)} löschen?`)) fitness.deleteWeight(date);
    } else {
      $("weightDate").value = date;
      $("weightInput").value = String(fitness.getState().weights[date]);
      syncWeightFormHint();
      $("weightInput").focus();
    }
  });

  $("planForm").addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    const val = name => form.elements[name].value;
    const num = name => parseNum(val(name));
    const f = fitness.getState();
    const phases = f.plan.phases.map((ph, i) => ({
      ...ph,
      name: val(`ph${i}_name`).trim() || ph.name,
      months: Math.max(1, Math.round(num(`ph${i}_months`) || ph.months)),
      kcalMin: num(`ph${i}_kcalMin`) ?? ph.kcalMin,
      kcalMax: num(`ph${i}_kcalMax`) ?? ph.kcalMax,
      proteinMin: num(`ph${i}_proteinMin`) ?? ph.proteinMin,
      proteinMax: num(`ph${i}_proteinMax`) ?? ph.proteinMax,
      targetWeight: num(`ph${i}_targetWeight`) ?? ph.targetWeight,
      targetBf: val(`ph${i}_targetBf`).trim() || ph.targetBf,
    }));
    const startDate = val("startDate");
    if (!isDayKey(startDate)) return flash(form.elements.startDate);
    fitness.updatePlan({
      startDate,
      startWeight: num("startWeight") ?? f.plan.startWeight,
      heightCm: num("heightCm") ?? f.plan.heightCm,
      creatineG: num("creatineG") ?? f.plan.creatineG,
      phases,
    });
    $("planDetails").open = false;
  });
}

function renderPlanForm() {
  const p = fitness.getState().plan;
  const field = (name, label, value, type = "text", mode = "decimal") =>
    `<label>${label}<input name="${name}" type="${type}" ${type === "text" ? `inputmode="${mode}"` : ""} value="${esc(value)}"></label>`;
  $("planForm").innerHTML = `
    <div class="fx-form-grid">
      ${field("startDate", "Planstart", p.startDate, "date")}
      ${field("startWeight", "Startgewicht (kg)", p.startWeight)}
      ${field("heightCm", "Grösse (cm)", p.heightCm, "text", "numeric")}
      ${field("creatineG", "Kreatin (g/Tag)", p.creatineG)}
    </div>
    ${p.phases.map((ph, i) => `
      <fieldset class="fx-phase">
        <legend>Phase ${i + 1}</legend>
        <div class="fx-form-grid">
          ${field(`ph${i}_name`, "Name", ph.name, "text", "text")}
          ${field(`ph${i}_months`, "Dauer (Monate)", ph.months, "text", "numeric")}
          ${field(`ph${i}_kcalMin`, "kcal von", ph.kcalMin, "text", "numeric")}
          ${field(`ph${i}_kcalMax`, "kcal bis", ph.kcalMax, "text", "numeric")}
          ${field(`ph${i}_proteinMin`, "Protein von (g)", ph.proteinMin, "text", "numeric")}
          ${field(`ph${i}_proteinMax`, "Protein bis (g)", ph.proteinMax, "text", "numeric")}
          ${field(`ph${i}_targetWeight`, "Zielgewicht (kg)", ph.targetWeight)}
          ${field(`ph${i}_targetBf`, "Ziel-KFA (%)", ph.targetBf, "text", "text")}
        </div>
      </fieldset>`).join("")}
    <button type="submit" class="fx-primary">Plan speichern</button>`;
}

/* ============================================================
   TRAINING LOGGEN
   ============================================================ */
function renderWorkout() {
  $("workoutDate").value = ui.workoutDate;
  renderSessionTabs();
  renderSaveInfo();
  renderExerciseList();
  renderWeekCount();
  renderRecentWorkouts();
  renderManage();
}

function currentItems(f) {
  const tpl = findTemplate(f, ui.templateId);
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const items = tpl ? tpl.items.map(i => ({ ...i, inTemplate: true })) : [];
  // Geloggte Übungen, die (nicht mehr) in der Vorlage sind, trotzdem anzeigen
  if (w) Object.keys(w.sets).forEach(exId => {
    if (!items.some(i => i.exId === exId)) items.push({ exId, sets: w.sets[exId].length, inTemplate: false });
  });
  return items;
}

function renderSessionTabs() {
  const f = fitness.getState();
  const tabs = [...f.templates];
  if (!findTemplate(f, ui.templateId)) tabs.push({ id: ui.templateId, name: "Gelöschte Vorlage" });
  $("sessionTabs").innerHTML = tabs.map(t => {
    const done = workoutHasData(f.workouts[workoutKey(ui.workoutDate, t.id)]);
    return `<button type="button" class="session-tab ${t.id === ui.templateId ? "active" : ""} ${done ? "done" : ""}" data-tpl="${esc(t.id)}">${esc(t.name)}${done ? " ✓" : ""}</button>`;
  }).join("");
}

function renderSaveInfo() {
  const f = fitness.getState();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const n = w ? Object.keys(w.sets).filter(id => exerciseLogged(w, id)).length : 0;
  const isToday = ui.workoutDate === todayKey();
  $("workoutSaveInfo").innerHTML =
    `Speichert auf <b>${formatLong(ui.workoutDate)}</b>${isToday ? " (heute)" : ""} · ${esc(templateLabel(f, ui.templateId))}` +
    (n ? ` · ${n} Übung${n === 1 ? "" : "en"} geloggt` : "");
  $("workoutSaveInfo").classList.toggle("not-today", !isToday);
}

function renderWeekCount() {
  const f = fitness.getState();
  const monday = mondayOf(todayKey());
  const sunday = addDays(monday, 6);
  const count = Object.values(f.workouts).filter(w => w.date >= monday && w.date <= sunday && workoutHasData(w)).length;
  $("workoutWeekCount").textContent = count;
  $("workoutWeekTarget").textContent = f.weeklyTarget;
}

function slotKey(exId) { return `${ui.workoutDate}_${ui.templateId}_${exId}`; }

function exerciseCardHTML(f, item) {
  const key = workoutKey(ui.workoutDate, ui.templateId);
  const w = f.workouts[key];
  const sets = (w && w.sets[item.exId]) || [];
  const slots = Math.max(item.sets, sets.length, ui.extraSlots[slotKey(item.exId)] || 0);
  const prev = previousPerformance(f, item.exId, ui.workoutDate, key);
  const logged = validSets(sets).length;

  const rows = [];
  for (let i = 0; i < slots; i++) {
    const s = sets[i] || { kg: null, reps: null };
    const ph = prev ? (prev.sets[i] || prev.sets[prev.sets.length - 1]) : null;
    const hasData = s.kg != null || s.reps != null;
    const removable = hasData || i >= item.sets;
    rows.push(`
      <div class="ex-set" data-idx="${i}">
        <span class="ex-set-no">${i + 1}</span>
        <input type="text" inputmode="decimal" autocomplete="off" data-field="kg" value="${s.kg ?? ""}" placeholder="${ph && ph.kg != null ? ph.kg : "kg"}" aria-label="Satz ${i + 1} Gewicht in kg">
        <span class="ex-x">kg ×</span>
        <input type="text" inputmode="numeric" autocomplete="off" data-field="reps" value="${s.reps ?? ""}" placeholder="${ph ? ph.reps : "Wdh."}" aria-label="Satz ${i + 1} Wiederholungen">
        ${removable ? `<button type="button" class="fx-icon" data-action="remove-set" aria-label="Satz ${i + 1} entfernen">✕</button>` : `<span class="fx-icon-spacer"></span>`}
      </div>`);
  }

  return `
    <div class="ex-card ${logged ? "done" : ""}" data-exid="${esc(item.exId)}">
      <div class="ex-card-head">
        <span class="ex-name">${esc(exerciseName(f, item.exId))}</span>
        <span class="ex-count">${logged}/${item.sets}</span>
      </div>
      ${prev ? `<div class="ex-last">Letztes Mal ${formatShort(prev.date)}: ${prev.sets.map(s => `${s.kg ?? 0}×${s.reps}`).join(" · ")}</div>` : ""}
      ${item.inTemplate ? "" : `<div class="ex-last">Nicht (mehr) in dieser Vorlage</div>`}
      <div class="ex-sets">${rows.join("")}</div>
      <button type="button" class="ex-addset" data-action="add-set">+ Satz</button>
    </div>`;
}

function renderExerciseList() {
  const f = fitness.getState();
  const items = currentItems(f);
  $("exerciseList").innerHTML = items.length
    ? items.map(item => exerciseCardHTML(f, item)).join("")
    : `<p class="fx-empty">Diese Vorlage hat noch keine Übungen. Füg unten unter „Übungen & Vorlagen verwalten“ welche hinzu.</p>`;
}

/** Nach einer Eingabe nur Zähler/Status der Karte aktualisieren — Inputs bleiben stehen (kein Fokusverlust). */
function refreshExerciseCard(exId) {
  const card = $("exerciseList").querySelector(`.ex-card[data-exid="${CSS.escape(exId)}"]`);
  if (!card) return;
  const f = fitness.getState();
  const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
  const logged = w ? validSets(w.sets[exId]).length : 0;
  const item = currentItems(f).find(i => i.exId === exId);
  card.classList.toggle("done", logged > 0);
  card.querySelector(".ex-count").textContent = `${logged}/${item ? item.sets : logged}`;
}

function setWorkoutDate(date) {
  if (!isDayKey(date)) return;
  ui.workoutDate = date;
  renderWorkout();
}

function bindWorkoutEvents() {
  $("workoutDate").addEventListener("change", e => {
    if (isDayKey(e.target.value)) setWorkoutDate(e.target.value);
    else e.target.value = ui.workoutDate; // leeres/ungültiges Feld -> nichts verschieben
  });
  $("wDayPrev").addEventListener("click", () => setWorkoutDate(addDays(ui.workoutDate, -1)));
  $("wDayNext").addEventListener("click", () => setWorkoutDate(addDays(ui.workoutDate, 1)));
  $("wDayToday").addEventListener("click", () => setWorkoutDate(todayKey()));

  $("sessionTabs").addEventListener("click", e => {
    const b = e.target.closest(".session-tab");
    if (!b) return;
    ui.templateId = b.dataset.tpl;
    renderWorkout();
  });

  // Eingabe gespeichert bei "change" (Feld verlassen / Enter)
  $("exerciseList").addEventListener("change", e => {
    const input = e.target;
    if (!input.matches("input[data-field]")) return;
    const card = input.closest(".ex-card");
    const setIndex = +input.closest(".ex-set").dataset.idx;
    const field = input.dataset.field;
    const value = parseNum(input.value);
    const limit = field === "kg" ? 1000 : 200;
    if (value != null && (value < 0 || value > limit)) { flash(input); return; }
    input.classList.remove("invalid");
    if (field === "reps" && value != null) input.value = Math.round(value);
    fitness.logSet({ date: ui.workoutDate, templateId: ui.templateId, exerciseId: card.dataset.exid, setIndex, [field]: value });
  });

  $("exerciseList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".ex-card");
    const exId = card.dataset.exid;
    const f = fitness.getState();
    const item = currentItems(f).find(i => i.exId === exId);
    const w = f.workouts[workoutKey(ui.workoutDate, ui.templateId)];
    const stored = (w && w.sets[exId]) || [];
    const slots = card.querySelectorAll(".ex-set").length;

    if (btn.dataset.action === "add-set") {
      ui.extraSlots[slotKey(exId)] = slots + 1;
      renderExerciseList();
      const newCard = $("exerciseList").querySelector(`.ex-card[data-exid="${CSS.escape(exId)}"]`);
      const inputs = newCard.querySelectorAll('input[data-field="kg"]');
      inputs[inputs.length - 1].focus();
    } else if (btn.dataset.action === "remove-set") {
      const idx = +btn.closest(".ex-set").dataset.idx;
      ui.extraSlots[slotKey(exId)] = Math.max(item ? item.sets : 0, slots - 1);
      if (idx < stored.length) fitness.removeSet({ date: ui.workoutDate, templateId: ui.templateId, exerciseId: exId, setIndex: idx });
      else renderExerciseList();
    }
  });

  $("recentWorkoutList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("[data-key]");
    const key = row.dataset.key;
    const f = fitness.getState();
    const w = f.workouts[key];
    const action = btn.dataset.action;

    if (action === "open" && w) {
      ui.workoutDate = w.date;
      ui.templateId = w.templateId;
      renderWorkout();
      $("exerciseList").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "move-toggle") {
      ui.moveOpenKey = ui.moveOpenKey === key ? null : key;
      renderRecentWorkouts();
    } else if (action === "move-confirm" && w) {
      const toDate = row.querySelector('input[type="date"]').value;
      const toTemplateId = row.querySelector("select").value;
      if (!isDayKey(toDate)) return flash(row.querySelector('input[type="date"]'));
      let res = fitness.moveWorkout({ fromKey: key, toDate, toTemplateId });
      if (res.conflict) {
        if (!confirm(`Am ${formatLong(toDate)} gibt es schon „${templateLabel(f, toTemplateId)}“. Zusammenführen? (Bereits vorhandene Übungen am Zieltag bleiben erhalten.)`)) return;
        res = fitness.moveWorkout({ fromKey: key, toDate, toTemplateId, merge: true });
      }
      ui.moveOpenKey = null;
      ui.workoutDate = toDate;
      ui.templateId = toTemplateId;
      renderWorkout();
    } else if (action === "delete" && w) {
      if (confirm(`Training vom ${formatLong(w.date)} (${templateLabel(f, w.templateId)}) komplett löschen?`)) fitness.deleteWorkout(key);
    }
  });
}

function renderRecentWorkouts() {
  const f = fitness.getState();
  const list = Object.entries(f.workouts)
    .filter(([, w]) => workoutHasData(w))
    .sort((a, b) => b[1].date.localeCompare(a[1].date) || a[1].templateId.localeCompare(b[1].templateId))
    .slice(0, 12);

  $("recentWorkoutList").innerHTML = list.length ? list.map(([key, w]) => {
    const n = Object.keys(w.sets).filter(id => exerciseLogged(w, id)).length;
    const open = ui.moveOpenKey === key;
    return `
      <div class="fx-workout-row ${open ? "open" : ""}" data-key="${esc(key)}">
        <div class="fx-row">
          <button type="button" class="fx-row-main" data-action="open">${formatLong(w.date)} · ${esc(templateLabel(f, w.templateId))}</button>
          <span class="fx-row-val">${n} Üb.</span>
          <button type="button" class="fx-chip" data-action="move-toggle">Datum ändern</button>
          <button type="button" class="fx-icon" data-action="delete" aria-label="Training löschen">✕</button>
        </div>
        ${open ? `
        <div class="fx-move">
          <input type="date" value="${w.date}">
          <select>${f.templates.map(t => `<option value="${esc(t.id)}" ${t.id === w.templateId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
          <button type="button" class="fx-primary" data-action="move-confirm">Verschieben</button>
        </div>` : ""}
      </div>`;
  }).join("") : `<p class="fx-empty">Noch keine Trainings geloggt.</p>`;
}

/* ============================================================
   ÜBUNGEN & VORLAGEN VERWALTEN
   ============================================================ */
function renderManage() {
  const f = fitness.getState();
  if (!ui.manageTpl || !findTemplate(f, ui.manageTpl)) ui.manageTpl = findTemplate(f, ui.templateId) ? ui.templateId : f.templates[0].id;
  const tpl = findTemplate(f, ui.manageTpl);
  const notInTpl = f.exercises.filter(ex => !tpl.items.some(i => i.exId === ex.id));

  $("manageBox").innerHTML = `
    <div class="mg-row">
      <label class="mg-label">Vorlage
        <select id="mgTplSelect">${f.templates.map(t => `<option value="${esc(t.id)}" ${t.id === tpl.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
      </label>
      <label class="mg-label">Name
        <input id="mgTplName" type="text" value="${esc(tpl.name)}">
      </label>
    </div>
    <div class="mg-row mg-actions">
      <button type="button" class="fx-chip" data-mg="add-tpl">+ Neue Vorlage</button>
      <button type="button" class="fx-chip" data-mg="copy-tpl">Vorlage kopieren</button>
      <button type="button" class="fx-chip danger" data-mg="del-tpl" ${f.templates.length <= 1 ? "disabled" : ""}>Vorlage löschen</button>
      <label class="mg-inline">Ziel pro Woche <input id="mgWeekly" type="text" inputmode="numeric" value="${f.weeklyTarget}"></label>
    </div>

    <div class="mg-list">
      <div class="mg-list-head"><span>Reihenfolge</span><span>Übung (Name gilt überall)</span><span>Sätze</span><span></span></div>
      ${tpl.items.map((it, i) => `
        <div class="mg-item" data-idx="${i}" data-exid="${esc(it.exId)}">
          <span class="mg-move">
            <button type="button" class="fx-icon" data-mg="up" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">▲</button>
            <button type="button" class="fx-icon" data-mg="down" ${i === tpl.items.length - 1 ? "disabled" : ""} aria-label="Nach unten">▼</button>
          </span>
          <input type="text" class="mg-name" value="${esc(exerciseName(f, it.exId))}" aria-label="Übungsname">
          <input type="text" inputmode="numeric" class="mg-sets" value="${it.sets}" aria-label="Ziel-Sätze">
          <button type="button" class="fx-icon" data-mg="remove" aria-label="Aus Vorlage entfernen">✕</button>
        </div>`).join("") || `<p class="fx-empty">Noch keine Übungen in dieser Vorlage.</p>`}
    </div>

    <div class="mg-add">
      ${notInTpl.length ? `
      <div class="mg-row">
        <select id="mgExisting">${notInTpl.map(ex => `<option value="${esc(ex.id)}">${esc(ex.name)}</option>`).join("")}</select>
        <button type="button" class="fx-chip" data-mg="add-existing">Hinzufügen</button>
      </div>` : ""}
      <div class="mg-row">
        <input id="mgNewName" type="text" placeholder="Neue Übung, z.B. Beinpresse">
        <button type="button" class="fx-primary" data-mg="add-new">Anlegen</button>
      </div>
    </div>
    <p class="fx-hint">Entfernen löscht keinen Verlauf. Die Daten bleiben im Fortschritts-Chart, und du kannst die Übung jederzeit wieder hinzufügen.</p>`;
}

function bindManageEvents() {
  const box = $("manageBox");

  box.addEventListener("change", e => {
    const el = e.target;
    const item = el.closest(".mg-item");
    if (el.id === "mgTplSelect") { ui.manageTpl = el.value; renderManage(); return; }
    if (el.id === "mgTplName") { fitness.renameTemplate(ui.manageTpl, el.value); return; }
    if (el.id === "mgWeekly") { fitness.setWeeklyTarget(parseNum(el.value)); return; }
    if (item && el.classList.contains("mg-name")) { fitness.renameExercise(item.dataset.exid, el.value); return; }
    if (item && el.classList.contains("mg-sets")) { fitness.setTargetSets(ui.manageTpl, +item.dataset.idx, parseNum(el.value)); return; }
  });

  box.addEventListener("click", e => {
    const btn = e.target.closest("button[data-mg]");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.mg;
    const item = btn.closest(".mg-item");
    const idx = item ? +item.dataset.idx : -1;
    const f = fitness.getState();

    switch (action) {
      case "up": fitness.moveExercise(ui.manageTpl, idx, -1); break;
      case "down": fitness.moveExercise(ui.manageTpl, idx, 1); break;
      case "remove": fitness.removeExerciseFromTemplate(ui.manageTpl, idx); break;
      case "add-existing": fitness.addExerciseToTemplate(ui.manageTpl, $("mgExisting").value, 3); break;
      case "add-new": {
        const name = $("mgNewName").value.trim();
        if (!name) return flash($("mgNewName"));
        fitness.addExercise(name, ui.manageTpl, 3);
        break;
      }
      case "add-tpl":
      case "copy-tpl": {
        const name = prompt("Name der neuen Vorlage:", action === "copy-tpl" ? `${findTemplate(f, ui.manageTpl).name} (Kopie)` : `Training ${f.templates.length + 1}`);
        if (!name) return;
        ui.manageTpl = fitness.addTemplate(name, action === "copy-tpl" ? ui.manageTpl : null);
        break;
      }
      case "del-tpl": {
        const t = findTemplate(f, ui.manageTpl);
        if (!confirm(`Vorlage „${t.name}“ löschen? Bereits geloggte Trainings bleiben erhalten.`)) return;
        fitness.deleteTemplate(ui.manageTpl);
        ui.manageTpl = null;
        if (ui.templateId === t.id) ui.templateId = fitness.getState().templates[0].id;
        break;
      }
    }
  });
}

/* ============================================================
   FORTSCHRITT PRO ÜBUNG + PLATEAU-RADAR
   ============================================================ */
function exerciseOptions(f) {
  const order = [];
  f.templates.forEach(t => t.items.forEach(i => { if (!order.includes(i.exId)) order.push(i.exId); }));
  f.exercises.forEach(ex => { if (!order.includes(ex.id)) order.push(ex.id); });
  return order.map(id => ({ id, name: exerciseName(f, id), n: exerciseSeries(f, id).length }))
    .filter(o => o.n > 0 || f.templates.some(t => t.items.some(i => i.exId === o.id)));
}

function renderProgress() {
  const f = fitness.getState();
  const opts = exerciseOptions(f);
  if (!opts.length) return;
  if (!ui.exerciseId || !opts.some(o => o.id === ui.exerciseId)) ui.exerciseId = (opts.find(o => o.n > 0) || opts[0]).id;

  $("exerciseSelect").innerHTML = opts
    .map(o => `<option value="${esc(o.id)}" ${o.id === ui.exerciseId ? "selected" : ""}>${esc(o.name)}${o.n ? ` (${o.n})` : " – keine Daten"}</option>`).join("");

  $("metricToggle").innerHTML = Object.entries(METRICS)
    .map(([k, m]) => `<button type="button" data-metric="${k}" class="${k === ui.metric ? "active" : ""}">${m.label}</button>`).join("");
  rangeButtons("exRange", ui.exRange);
  $("metricHelp").textContent = METRICS[ui.metric].help;

  const series = exerciseSeries(f, ui.exerciseId);
  const { visible } = renderExerciseChart($("exChart"), {
    series, metric: ui.metric, range: ui.exRange, accent: getAccent(), templateName: id => templateLabel(f, id),
  });

  const status = plateauStatus(series);
  const m = METRICS[ui.metric];
  let prHTML = "--", changeHTML = "--", lastHTML = "--";
  if (series.length) {
    const pr = series.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
    prHTML = `${pr.e1rm.toFixed(1)} kg <small>e1RM · ${pr.bestSet.kg ?? 0}×${pr.bestSet.reps} am ${formatShort(pr.date)}</small>`;
    const last = series[series.length - 1];
    lastHTML = `${formatShort(last.date)} <small>${last.sets.map(s => `${s.kg ?? 0}×${s.reps}`).join(" · ")}</small>`;
  }
  if (visible.length >= 2) {
    const first = m.get(visible[0]), last = m.get(visible[visible.length - 1]);
    const pct = first ? ((last - first) / first) * 100 : 0;
    changeHTML = `<span class="${pct >= 0 ? "pos" : "neg"}">${fmtSigned(pct, 1)} %</span> <small>${m.label} im Zeitraum</small>`;
  }
  $("exStats").innerHTML = `
    <div class="fx-stat"><span class="stat-label">Bestwert</span><span class="fx-stat-val">${prHTML}</span></div>
    <div class="fx-stat"><span class="stat-label">Veränderung</span><span class="fx-stat-val">${changeHTML}</span></div>
    <div class="fx-stat"><span class="stat-label">Zuletzt</span><span class="fx-stat-val">${lastHTML}</span></div>
    <div class="fx-status status-${status.status}"><b>${status.label}</b> ${esc(status.detail)}</div>`;

  renderRadar(f, opts);
}

function renderRadar(f, opts) {
  const rank = { plateau: 0, decline: 1, progress: 2, insufficient: 3 };
  const rows = opts.filter(o => o.n > 0)
    .map(o => ({ ...o, st: plateauStatus(exerciseSeries(f, o.id)) }))
    .sort((a, b) => rank[a.st.status] - rank[b.st.status] || a.name.localeCompare(b.name));
  $("plateauRadar").innerHTML = rows.length ? rows.map(r => `
    <button type="button" class="fx-radar-row ${r.id === ui.exerciseId ? "active" : ""}" data-exid="${esc(r.id)}">
      <span class="fx-radar-name">${esc(r.name)}</span>
      <span class="fx-badge status-${r.st.status}">${r.st.label}</span>
      <span class="fx-radar-trend">${r.st.weeklyPct != null ? fmtSigned(r.st.weeklyPct, 1) + " %/W" : ""}</span>
    </button>`).join("") : `<p class="fx-empty">Sobald Übungen geloggt sind, siehst du hier, wo es stockt.</p>`;
}

function bindProgressEvents() {
  $("exerciseSelect").addEventListener("change", e => { ui.exerciseId = e.target.value; renderProgress(); });
  $("metricToggle").addEventListener("click", e => {
    const b = e.target.closest("button[data-metric]");
    if (!b) return;
    ui.metric = b.dataset.metric;
    renderProgress();
  });
  $("exRange").addEventListener("click", e => {
    const b = e.target.closest("button[data-range]");
    if (!b) return;
    ui.exRange = b.dataset.range;
    renderProgress();
  });
  $("plateauRadar").addEventListener("click", e => {
    const b = e.target.closest(".fx-radar-row");
    if (!b) return;
    ui.exerciseId = b.dataset.exid;
    renderProgress();
    $("exChart").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---------------- kleine Helfer ---------------- */
function flash(el) {
  if (!el) return;
  el.classList.add("invalid");
  el.focus();
  setTimeout(() => el.classList.remove("invalid"), 1600);
}

