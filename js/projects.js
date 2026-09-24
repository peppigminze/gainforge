/* ============================================================
   projects.js — frei editierbare Projekte
   ------------------------------------------------------------
   data.projects = [{ id, title, goal: {current, target, unit, rewarded}|null,
                      tasks: [{ id, name, done, subtasks: [{ id, text, done }] }] }]
   Logik:
   - Aufgabe mit Teilschritten ist erledigt, sobald ALLE Teilschritte
     erledigt sind (automatisch). Abhaken der Aufgabe hakt alle ab.
   - Fortschritt zählt Teilschritte anteilig mit.
   - Sparziel erreicht: +50 XP genau einmal (rewarded).
   ============================================================ */
import { ctx, changed, uid } from "./core.js";
import { openSheet, refreshSheet, currentSheetId, closeSheet } from "./ui/sheet.js";
import { ring, esc, toast } from "./ui/fx.js";

const XP_TASK = 10, XP_SUB = 5, XP_GOAL = 50;

function mkTask(name, subs = [], done = false) {
  return { id: uid("t"), name, done, subtasks: subs.map(text => ({ id: uid("s"), text, done: false })) };
}
/** Neue Nutzer bekommen nur ein neutrales Beispiel, das die Bedienung zeigt. */
export function defaultProjects() {
  return [
    { id: uid("p"), title: "BEISPIEL-PROJEKT", goal: null, tasks: [
      mkTask("Abhaken: auf das Kästchen links tippen"),
      mkTask("Teilschritte: Knopf rechts öffnet sie", ["Erster Teilschritt", "Zweiter Teilschritt"]),
      mkTask("Umbenennen: direkt auf den Text tippen"),
      mkTask("Löschen oder Sparziel: unten „Projekt bearbeiten“"),
    ] },
  ];
}

/* ---------------- Auswertung ---------------- */
const list = () => { const d = ctx.getData(); if (!Array.isArray(d.projects)) d.projects = []; return d.projects; };
const find = id => list().find(p => p.id === id);
const findTask = (p, tid) => p.tasks.find(t => t.id === tid);
export function taskProgress(t) {
  if (t.done) return 1;
  const subs = t.subtasks || [];
  return subs.length ? subs.filter(s => s.done).length / subs.length : 0;
}
export function projectProgress(p) {
  return p.tasks.length ? (p.tasks.reduce((s, t) => s + taskProgress(t), 0) / p.tasks.length) * 100 : 0;
}
const fmtNum = n => Number(n || 0).toLocaleString("de-CH");

/* ---------------- Befehle (öffentliche API) ---------------- */
function commit(scope = "projects", xp = 0, detail = {}) {
  ctx.save();
  if (xp) ctx.addXP(xp);
  changed(scope, detail);
}

export const projects = {
  list: () => list(),
  add(title) {
    const p = { id: uid("p"), title: String(title || "Neues Projekt").trim().toUpperCase(), goal: null, tasks: [] };
    list().push(p); commit(); return p.id;
  },
  rename(id, title) { const p = find(id); const t = String(title || "").trim(); if (p && t) { p.title = t; commit("projects", 0, { soft: true }); } },
  remove(id) { const d = ctx.getData(); d.projects = list().filter(p => p.id !== id); commit(); },

  addTask(id, name) { const p = find(id); const n = String(name || "").trim(); if (!p || !n) return; p.tasks.push(mkTask(n)); commit(); },
  renameTask(id, tid, name) { const t = findTask(find(id), tid); const n = String(name || "").trim(); if (t && n) { t.name = n; commit("projects", 0, { soft: true }); } },
  removeTask(id, tid) { const p = find(id); const t = findTask(p, tid); if (!t) return; p.tasks = p.tasks.filter(x => x !== t); commit("projects", t.done ? -XP_TASK : 0); },
  /** Aufgabe abhaken: hakt alle Teilschritte mit ab (bzw. wieder auf). */
  toggleTask(id, tid) {
    const t = findTask(find(id), tid); if (!t) return;
    const done = !t.done;
    let xp = done ? XP_TASK : -XP_TASK;
    (t.subtasks || []).forEach(s => { if (s.done !== done) { s.done = done; xp += done ? XP_SUB : -XP_SUB; } });
    t.done = done;
    commit("projects", xp);
  },
  addSub(id, tid, text) { const t = findTask(find(id), tid); const x = String(text || "").trim(); if (!t || !x) return;
    t.subtasks = t.subtasks || []; t.subtasks.push({ id: uid("s"), text: x, done: false });
    const xp = t.done ? -XP_TASK : 0; t.done = false; commit("projects", xp); },
  renameSub(id, tid, sid, text) { const t = findTask(find(id), tid); const s = t && t.subtasks.find(z => z.id === sid); const x = String(text || "").trim(); if (s && x) { s.text = x; commit("projects", 0, { soft: true }); } },
  removeSub(id, tid, sid) { const t = findTask(find(id), tid); if (!t) return; const s = t.subtasks.find(z => z.id === sid);
    t.subtasks = t.subtasks.filter(z => z.id !== sid); let xp = s && s.done ? -XP_SUB : 0; xp += syncTaskDone(t); commit("projects", xp); },
  /** Teilschritt abhaken; sind alle erledigt, wird die Aufgabe automatisch erledigt. */
  toggleSub(id, tid, sid) { const t = findTask(find(id), tid); const s = t && t.subtasks.find(z => z.id === sid); if (!s) return;
    s.done = !s.done; let xp = s.done ? XP_SUB : -XP_SUB; xp += syncTaskDone(t); commit("projects", xp); },

  setGoal(id, goal) {
    const p = find(id); if (!p) return;
    if (goal === null) { p.goal = null; commit(); return; }
    p.goal = { ...(p.goal || { rewarded: false, unit: "CHF", current: 0, target: 100 }), ...goal };
    let xp = 0;
    if (p.goal.target > 0 && p.goal.current >= p.goal.target && !p.goal.rewarded) { p.goal.rewarded = true; xp = XP_GOAL; toast(`Ziel erreicht: ${p.title} · +${XP_GOAL} XP`); }
    commit("projects", xp);
  },
};

function syncTaskDone(t) {
  const subs = t.subtasks || [];
  if (!subs.length) return 0;
  const all = subs.every(s => s.done);
  if (all && !t.done) { t.done = true; return XP_TASK; }
  if (!all && t.done) { t.done = false; return -XP_TASK; }
  return 0;
}

/* ---------------- Kacheln ---------------- */
export function renderProjectTiles() {
  const el = document.getElementById("projectTiles");
  el.innerHTML = list().map(p => {
    const pct = projectProgress(p);
    const open = p.tasks.filter(t => !t.done);
    const foot = p.goal
      ? `${fmtNum(p.goal.current)} / ${fmtNum(p.goal.target)} ${esc(p.goal.unit)}`
      : `${p.tasks.length - open.length}/${p.tasks.length} erledigt`;
    const pctShown = p.goal ? (p.goal.target ? (p.goal.current / p.goal.target) * 100 : 0) : pct;
    return `<button type="button" class="tile tile-proj" data-open="project" data-id="${esc(p.id)}">
      <span class="t-cat">${p.goal ? "Sparziel" : "Projekt"}</span>
      <span class="t-title">${esc(p.title)}</span>
      <span class="t-foot"><span>${foot}</span></span>
      <span style="position:absolute;right:10px;top:4px">${ring(pctShown, 42)}</span>
    </button>`;
  }).join("") + `<button type="button" class="tile tile-add" data-open="project-new">+ Projekt</button>`;
}

/* ---------------- Detail-Panel ---------------- */
const expanded = new Set();

export function openProject(id) {
  const p = find(id); if (!p) return;
  openSheet({
    id: "project:" + id, cat: p.goal ? "Sparziel" : "Projekt", title: p.title, sub: subline(p),
    bind: body => bindProject(body, id),
    render: body => renderProject(body, id),
  });
}
export function isProjectSheet() { const s = currentSheetId(); return s && s.startsWith("project:"); }
export function refreshProjectSheet() {
  const s = currentSheetId(); if (!s || !s.startsWith("project:")) return;
  const p = find(s.slice(8)); if (!p) { closeSheet(); return; }
  document.getElementById("sheetTitle").textContent = p.title;
  document.getElementById("sheetSub").textContent = subline(p);
  refreshSheet();
}
function subline(p) {
  const done = p.tasks.filter(t => t.done).length;
  return `${Math.round(projectProgress(p))}% · ${done} von ${p.tasks.length} Aufgaben`;
}

function renderProject(body, id) {
  const p = find(id); if (!p) return;
  const g = p.goal;
  const gp = g && g.target ? Math.min(100, (g.current / g.target) * 100) : 0;
  body.innerHTML = `
    ${g ? `
    <div class="psec">Ziel</div>
    <div class="goal">
      <div class="bar"><i style="width:${gp}%"></i></div>
      <div class="goal-row">
        <input class="field" data-goal="current" inputmode="decimal" value="${g.current}" aria-label="Aktueller Stand">
        <span style="text-align:center;color:var(--mute)">/</span>
        <input class="field" data-goal="target" inputmode="decimal" value="${g.target}" aria-label="Ziel">
        <input class="field" data-goal="unit" value="${esc(g.unit)}" aria-label="Einheit">
      </div>
      <p class="hint">${Math.round(gp)}% erreicht${g.rewarded ? " · Bonus erhalten" : ` · +${XP_GOAL} XP beim Erreichen`}</p>
    </div>` : ""}

    <div class="psec">Aufgaben</div>
    <div class="rows">
      ${p.tasks.map(t => taskHTML(t)).join("") || `<div class="empty">Noch keine Aufgaben.</div>`}
      <form class="add-row" data-form="task">
        <input class="field" placeholder="Neue Aufgabe" enterkeyhint="done">
        <button class="btn small" type="submit">+</button>
      </form>
    </div>

    <details class="acc">
      <summary>Projekt bearbeiten</summary>
      <div class="acc-body stack">
        <label class="lbl-field">Name<input class="field" data-proj="title" value="${esc(p.title)}"></label>
        ${g ? `<button type="button" class="btn ghost" data-act="goal-off">Zahlenziel entfernen</button>`
            : `<button type="button" class="btn ghost" data-act="goal-on">+ Spar-/Zahlenziel</button>`}
        <button type="button" class="btn danger" data-act="del-proj">Projekt löschen</button>
      </div>
    </details>`;
}

function taskHTML(t) {
  const subs = t.subtasks || [];
  const open = expanded.has(t.id);
  const doneSubs = subs.filter(s => s.done).length;
  const part = !t.done && doneSubs > 0;
  return `<div class="task ${t.done ? "done" : ""}" data-tid="${esc(t.id)}">
    <div class="task-row">
      <button type="button" class="chk ${t.done ? "on" : part ? "part" : ""}" style="--p:${subs.length ? (doneSubs / subs.length) * 100 : 0}%" data-act="toggle" aria-label="Erledigt"><i></i></button>
      <input class="name-in" data-edit="task" value="${esc(t.name)}" aria-label="Aufgabe">
      <button type="button" class="sub-count" data-act="expand">${subs.length ? `${doneSubs}/${subs.length}` : "+"} ${open ? "▴" : "▾"}</button>
      <button type="button" class="ico del" data-act="del" aria-label="Aufgabe löschen">✕</button>
    </div>
    ${open ? `<div class="subs">
      ${subs.map(s => `<div class="sub ${s.done ? "done" : ""}" data-sid="${esc(s.id)}">
        <button type="button" class="chk ${s.done ? "on" : ""}" data-act="toggle-sub" aria-label="Teilschritt erledigt"><i></i></button>
        <input class="name-in" data-edit="sub" value="${esc(s.text)}" aria-label="Teilschritt">
        <button type="button" class="ico del" data-act="del-sub" aria-label="Teilschritt löschen">✕</button>
      </div>`).join("")}
      <form class="add-row" data-form="sub" style="padding:6px 0 0"><input class="field" placeholder="Teilschritt" enterkeyhint="done"><button class="btn small" type="submit">+</button></form>
    </div>` : ""}
  </div>`;
}

function bindProject(body, id) {
  body.addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const task = b.closest("[data-tid]"); const tid = task && task.dataset.tid;
    const sub = b.closest("[data-sid]"); const sid = sub && sub.dataset.sid;
    const p = find(id);
    switch (b.dataset.act) {
      case "toggle": projects.toggleTask(id, tid); break;
      case "expand": expanded.has(tid) ? expanded.delete(tid) : expanded.add(tid); refreshSheet(); break;
      case "del": if (confirm("Aufgabe löschen?")) projects.removeTask(id, tid); break;
      case "toggle-sub": projects.toggleSub(id, tid, sid); break;
      case "del-sub": projects.removeSub(id, tid, sid); break;
      case "goal-on": projects.setGoal(id, { current: 0, target: 1000, unit: "CHF", rewarded: false }); break;
      case "goal-off": projects.setGoal(id, null); break;
      case "del-proj": if (confirm(`Projekt „${p.title}“ wirklich löschen?`)) { projects.remove(id); closeSheet(); } break;
    }
  });
  body.addEventListener("change", e => {
    const el = e.target;
    const task = el.closest("[data-tid]"); const tid = task && task.dataset.tid;
    const sub = el.closest("[data-sid]");
    if (el.dataset.edit === "task") projects.renameTask(id, tid, el.value);
    else if (el.dataset.edit === "sub") projects.renameSub(id, tid, sub.dataset.sid, el.value);
    else if (el.dataset.proj === "title") projects.rename(id, el.value);
    else if (el.dataset.goal) {
      const v = el.dataset.goal === "unit" ? el.value.trim() : (parseFloat(String(el.value).replace(",", ".")) || 0);
      projects.setGoal(id, { [el.dataset.goal]: v });
    }
  });
  body.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target; const input = form.querySelector("input");
    if (form.dataset.form === "task") {
      projects.addTask(id, input.value);
      const next = body.querySelector('[data-form="task"] input'); if (next) next.focus();
    } else {
      const tid = form.closest("[data-tid]").dataset.tid;
      projects.addSub(id, tid, input.value);
      const next = body.querySelector(`[data-tid="${CSS.escape(tid)}"] [data-form="sub"] input`); if (next) next.focus();
    }
  });
}
