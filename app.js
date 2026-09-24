/* ============================================================
   SILVAN.OS — persönliches Life-Dashboard
   Daten liegen lokal im Browser (localStorage), optional
   gespiegelt in eine private GitHub Gist (Cloud Sync).
   ============================================================ */

import { ensureFitness } from "./js/fitness/model.js";
import { bindFitness, fitness } from "./js/fitness/commands.js";
import { initFitnessUI, renderFitness } from "./js/fitness/ui.js";

const GIST_FILENAME = "silvanos-data.json";
const GIST_DESCRIPTION = "SILVAN.OS data (do not rename the file inside)";

/* multi-account: each account's data/token/gist live under its own key,
   so several people can share one browser (or the same account can be
   connected on several devices via its own GitHub token). */
const ACCOUNTS_KEY = "silvanos_accounts_v1";
const CURRENT_ACCOUNT_KEY = "silvanos_current_account";
const LEGACY_STORAGE_KEY = "silvanos_data_v2";
const LEGACY_SYNC_TOKEN_KEY = "silvanos_sync_token";
const LEGACY_SYNC_GIST_KEY = "silvanos_sync_gistid";

function accountDataKey(id) { return `silvanos_data_v2::${id}`; }
function accountTokenKey(id) { return `silvanos_sync_token::${id}`; }
function accountGistKey(id) { return `silvanos_sync_gistid::${id}`; }

function mkSub(names) {
  return names.map((n, i) => ({ id: "s" + i + "_" + Math.random().toString(36).slice(2, 6), text: n, done: false }));
}
function mkTask(name, subtaskNames) {
  return {
    id: "t_" + Math.random().toString(36).slice(2, 9),
    name,
    done: false,
    expanded: false,
    subtasks: subtaskNames ? mkSub(subtaskNames) : [],
  };
}

function defaultProjects() {
  return [
    {
      id: "p_lehre",
      title: "LEHRE",
      goal: null,
      tasks: [
        mkTask("M106 · SQL/Datenbanken", ["MySQL Grundlagen", "Normalisierung", "DML/DDL/DCL", "Prüfung"]),
        mkTask("M129 · Netzwerk", ["OSI-Modell", "TCP/IP", "Protokolltabellen", "Prüfung"]),
        mkTask("M169 · Docker/Monitoring", ["Docker Compose Stack", "Prometheus/Grafana", "Security Bands H/I", "Prüfung"]),
        mkTask("M188", ["Theorie", "Praxis", "Dokumentation", "Prüfung"]),
        mkTask("M231 · Datenschutz", ["Cookies-Aufgabe", "Grundlagen Datenschutz", "Dokumentation", "Prüfung"]),
        mkTask("M346 · IaC (Terraform/Ansible)", ["Terraform Setup", "Ansible Roles", "Multi-VM Deployment", "Prüfung"]),
      ],
    },
    {
      id: "p_moto",
      title: "MOTO-FONDS",
      goal: { target: 3000, current: 0, unit: "CHF" },
      tasks: [
        mkTask("Brixton BX 125 / Crossfire", []),
        mkTask("CFMoto 125/300", []),
      ],
    },
    {
      id: "p_roblox",
      title: "STEAL & ESCAPE",
      goal: null,
      tasks: [
        { ...mkTask("M1 · PlayerDataService", []), done: true },
        { ...mkTask("M2 · LootService & InventoryService", []), done: true },
        { ...mkTask("M3 · EconomyService", []), done: true },
        { ...mkTask("M4 · ExtractionService & CombatService", []), done: true },
        mkTask("M5 · Minimal HUD mit echten Server-Daten", []),
      ],
    },
  ];
}

function defaultData() {
  return {
    xp: 0,
    // Fitness-Daten liegen unter data.fitness und werden von js/fitness/model.js
    // (ensureFitness) beim ersten Zugriff angelegt bzw. aus dem Altformat migriert.
    projects: defaultProjects(),
    calendar: {}, // { "YYYY-MM-DD": [{id, text, done}] }
  };
}

let currentAccountId = null;
let data = defaultData();
let weekOffset = 0;
let selectedDate = todayStr();

function loadData() {
  if (!currentAccountId) return defaultData();
  try {
    const raw = localStorage.getItem(accountDataKey(currentAccountId));
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return { ...defaultData(), ...parsed };
  } catch (e) {
    console.error("Load error", e);
    return defaultData();
  }
}

function saveData() {
  if (!currentAccountId) return;
  try {
    localStorage.setItem(accountDataKey(currentAccountId), JSON.stringify(data));
  } catch (e) {
    console.error("Save error", e);
  }
  scheduleSync();
}

/* ---------------- XP SYSTEM ---------------- */
function addXP(amount) {
  const prevLevel = levelForXP(data.xp);
  data.xp = Math.max(0, data.xp + amount);
  const newLevel = levelForXP(data.xp);
  saveData();
  renderXP();
  if (newLevel > prevLevel) showLevelUp(newLevel);
}
function levelForXP(xp) { return Math.floor(xp / 100) + 1; }
function renderXP() {
  const level = levelForXP(data.xp);
  const xpIntoLevel = data.xp % 100;
  document.getElementById("level").textContent = level;
  document.getElementById("xpCurrent").textContent = xpIntoLevel;
  document.getElementById("xpNext").textContent = 100;
  document.getElementById("xpBarFill").style.width = xpIntoLevel + "%";
}
function showLevelUp(level) {
  const toast = document.getElementById("levelUpToast");
  document.getElementById("levelUpNum").textContent = level;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2400);
}

/* ---------------- HELPERS ---------------- */
// Local calendar date as YYYY-MM-DD. toISOString() converts to UTC first,
// which silently rolls the date back (e.g. shortly after local midnight in
// any UTC+ timezone) — always format from local getFullYear/Month/Date.
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() { return isoDate(new Date()); }
// Parse a stored "YYYY-MM-DD" as a local calendar date, not UTC midnight —
// bare ISO date strings parse as UTC per spec, which can land on the wrong
// side of midnight once converted to local time (e.g. UTC- timezones).
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return d;
}

/* ================= GENERIC PROJECTS (editable holders) ================= */
function renderProjects() {
  const container = document.getElementById("projectsContainer");
  container.innerHTML = "";

  data.projects.forEach((project, idx) => {
    const num = String(idx + 2).padStart(2, "0");
    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter(t => t.done).length;
    const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const panel = document.createElement("section");
    panel.className = "panel project-panel";
    panel.dataset.projectId = project.id;

    panel.innerHTML = `
      <div class="project-title-row">
        <span class="panel-sub" style="flex-shrink:0;">${num} ·</span>
        <input class="project-title" data-projid="${project.id}" value="${escapeAttr(project.title)}">
        <button class="project-del" data-projid="${project.id}" title="Projekt löschen">✕</button>
      </div>
      <span class="project-pct">${pct}% abgeschlossen</span>

      ${project.goal ? goalBlockHTML(project) : `<button class="add-goal-btn" data-projid="${project.id}">+ Sparziel/Zahlenziel hinzufügen</button>`}

      <div class="task-list" data-projid="${project.id}">
        ${project.tasks.map(t => taskHTML(project.id, t)).join("")}
      </div>

      <form class="add-task-form" data-projid="${project.id}">
        <input type="text" placeholder="Neue Aufgabe..." data-projid="${project.id}">
        <button type="submit">+</button>
      </form>
    `;
    container.appendChild(panel);
  });

  // renumber the calendar panel to continue after projects
  const calNum = String(data.projects.length + 2).padStart(2, "0");
  document.getElementById("calendarNumber").textContent = calNum + " · TAGESPLANER";
}

function goalBlockHTML(project) {
  const pct = project.goal.target ? Math.min(100, Math.round((project.goal.current / project.goal.target) * 100)) : 0;
  return `
    <div class="goal-block" data-projid="${project.id}">
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
      <div class="goal-numbers">
        <span>
          <input type="number" class="goal-current" data-projid="${project.id}" value="${project.goal.current}">
          / <input type="number" class="goal-target" data-projid="${project.id}" value="${project.goal.target}">
          <input type="text" class="goal-unit" data-projid="${project.id}" value="${escapeAttr(project.goal.unit)}" style="width:40px;">
        </span>
        <span>${pct}%</span>
      </div>
      <button class="goal-remove" data-projid="${project.id}">Ziel entfernen</button>
    </div>
  `;
}

function taskHTML(projId, task) {
  return `
    <div class="task ${task.done ? "done" : ""}" data-taskid="${task.id}">
      <div class="task-row">
        <input type="checkbox" data-projid="${projId}" data-taskid="${task.id}" data-action="toggle-task" ${task.done ? "checked" : ""}>
        <input class="task-name" data-projid="${projId}" data-taskid="${task.id}" data-action="rename-task" value="${escapeAttr(task.name)}">
        <button class="task-expand" data-projid="${projId}" data-taskid="${task.id}" data-action="expand-task">${task.expanded ? "▾" : "▸"} ${task.subtasks.length}</button>
        <button class="task-del" data-projid="${projId}" data-taskid="${task.id}" data-action="del-task">✕</button>
      </div>
      <div class="subtasks ${task.expanded ? "" : "hidden"}">
        ${task.subtasks.map(s => `
          <div class="subtask-row ${s.done ? "done" : ""}">
            <input type="checkbox" data-projid="${projId}" data-taskid="${task.id}" data-subid="${s.id}" data-action="toggle-subtask" ${s.done ? "checked" : ""}>
            <input class="subtask-name" data-projid="${projId}" data-taskid="${task.id}" data-subid="${s.id}" data-action="rename-subtask" value="${escapeAttr(s.text)}">
            <button class="subtask-del" data-projid="${projId}" data-taskid="${task.id}" data-subid="${s.id}" data-action="del-subtask">✕</button>
          </div>
        `).join("")}
        <form class="add-subtask-form" data-projid="${projId}" data-taskid="${task.id}">
          <input type="text" placeholder="Teilschritt...">
          <button type="submit">+</button>
        </form>
      </div>
    </div>
  `;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function findProject(id) { return data.projects.find(p => p.id === id); }
function findTask(proj, taskId) { return proj.tasks.find(t => t.id === taskId); }

/* delegated events for the whole dynamic project area */
document.getElementById("projectsContainer").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const projId = btn.dataset.projid;
  const proj = findProject(projId);

  if (btn.classList.contains("project-del")) {
    if (confirm(`Projekt "${proj.title}" wirklich löschen?`)) {
      data.projects = data.projects.filter(p => p.id !== projId);
      saveData(); renderProjects();
    }
    return;
  }
  if (btn.classList.contains("add-goal-btn")) {
    proj.goal = { target: 100, current: 0, unit: "CHF" };
    saveData(); renderProjects();
    return;
  }
  if (btn.classList.contains("goal-remove")) {
    proj.goal = null;
    saveData(); renderProjects();
    return;
  }
  if (btn.dataset.action === "expand-task") {
    const task = findTask(proj, btn.dataset.taskid);
    task.expanded = !task.expanded;
    saveData(); renderProjects();
    return;
  }
  if (btn.dataset.action === "del-task") {
    proj.tasks = proj.tasks.filter(t => t.id !== btn.dataset.taskid);
    saveData(); renderProjects();
    return;
  }
  if (btn.dataset.action === "del-subtask") {
    const task = findTask(proj, btn.dataset.taskid);
    task.subtasks = task.subtasks.filter(s => s.id !== btn.dataset.subid);
    saveData(); renderProjects();
    return;
  }
});

document.getElementById("projectsContainer").addEventListener("change", e => {
  const el = e.target;
  const projId = el.dataset.projid;
  if (!projId) return;
  const proj = findProject(projId);

  if (el.dataset.action === "toggle-task") {
    const task = findTask(proj, el.dataset.taskid);
    const changed = task.done !== el.checked;
    task.done = el.checked;
    saveData();
    if (changed) addXP(el.checked ? 10 : -10);
    renderProjects();
    return;
  }
  if (el.dataset.action === "toggle-subtask") {
    const task = findTask(proj, el.dataset.taskid);
    const sub = task.subtasks.find(s => s.id === el.dataset.subid);
    const changed = sub.done !== el.checked;
    sub.done = el.checked;
    saveData();
    if (changed) addXP(el.checked ? 5 : -5);
    renderProjects();
    return;
  }
  if (el.classList.contains("goal-current") || el.classList.contains("goal-target")) {
    const wasReached = proj.goal.current >= proj.goal.target;
    proj.goal.current = parseFloat(document.querySelector(`.goal-current[data-projid="${projId}"]`).value) || 0;
    proj.goal.target = parseFloat(document.querySelector(`.goal-target[data-projid="${projId}"]`).value) || 0;
    const nowReached = proj.goal.current >= proj.goal.target && proj.goal.target > 0;
    saveData();
    if (nowReached && !wasReached) addXP(50);
    renderProjects();
    return;
  }
  if (el.classList.contains("goal-unit")) {
    proj.goal.unit = el.value;
    saveData();
    return;
  }
});

/* commit text edits (title / task name / subtask name) on blur, not on every keystroke */
document.getElementById("projectsContainer").addEventListener("focusout", e => {
  const el = e.target;
  const projId = el.dataset.projid;
  if (!projId) return;
  const proj = findProject(projId);

  if (el.classList.contains("project-title")) {
    proj.title = el.value.trim() || proj.title;
    saveData(); renderProjects();
  } else if (el.dataset.action === "rename-task") {
    const task = findTask(proj, el.dataset.taskid);
    task.name = el.value.trim() || task.name;
    saveData();
  } else if (el.dataset.action === "rename-subtask") {
    const task = findTask(proj, el.dataset.taskid);
    const sub = task.subtasks.find(s => s.id === el.dataset.subid);
    sub.text = el.value.trim() || sub.text;
    saveData();
  }
});

document.getElementById("projectsContainer").addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target;
  const projId = form.dataset.projid;
  const proj = findProject(projId);

  if (form.classList.contains("add-task-form")) {
    const input = form.querySelector("input");
    const name = input.value.trim();
    if (!name) return;
    proj.tasks.push(mkTask(name, []));
    saveData(); renderProjects();
  } else if (form.classList.contains("add-subtask-form")) {
    const taskId = form.dataset.taskid;
    const task = findTask(proj, taskId);
    const input = form.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    task.subtasks.push({ id: "s_" + Math.random().toString(36).slice(2, 8), text, done: false });
    task.expanded = true;
    saveData(); renderProjects();
  }
});

document.getElementById("addProjectBtn").addEventListener("click", () => {
  const title = prompt("Name des neuen Projekts/Tabs:", "Neues Projekt");
  if (!title) return;
  data.projects.push({
    id: "p_" + Math.random().toString(36).slice(2, 9),
    title: title.toUpperCase(),
    goal: null,
    tasks: [],
  });
  saveData();
  renderProjects();
});

/* ================= DAILY CALENDAR ================= */
const DOW_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DOW_FULL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function renderCalendar() {
  const monday = mondayOf(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);

  const weekDaysEl = document.getElementById("weekDays");
  weekDaysEl.innerHTML = "";
  const today = todayStr();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const first = days[0], last = days[6];
  document.getElementById("calendarWeekLabel").textContent =
    `${first.getDate()}. ${MONTH_NAMES[first.getMonth()].slice(0,3)} – ${last.getDate()}. ${MONTH_NAMES[last.getMonth()].slice(0,3)}`;

  days.forEach((d, i) => {
    const iso = isoDate(d);
    const hasTasks = (data.calendar[iso] || []).length > 0;
    const chip = document.createElement("div");
    chip.className = "day-chip" + (iso === today ? " today" : "") + (iso === selectedDate ? " selected" : "");
    chip.dataset.date = iso;
    chip.innerHTML = `
      <span class="dow">${DOW_LABELS[i]}</span>
      <span class="dom">${d.getDate()}</span>
      <span class="dot ${hasTasks ? "" : "hidden"}"></span>
    `;
    weekDaysEl.appendChild(chip);
  });

  renderDayTasks();
}

function renderDayTasks() {
  const d = parseLocalDate(selectedDate);
  const dow = (d.getDay() + 6) % 7;
  document.getElementById("calendarDayLabel").textContent =
    `${DOW_FULL[dow]}, ${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}${selectedDate === todayStr() ? " · heute" : ""}`;

  const list = document.getElementById("dayTaskList");
  list.innerHTML = "";
  const tasks = data.calendar[selectedDate] || [];

  if (!tasks.length) {
    list.innerHTML = `<div class="day-task-empty">Keine Aufgaben für diesen Tag.</div>`;
    return;
  }

  tasks.forEach(t => {
    const row = document.createElement("div");
    row.className = "day-task" + (t.done ? " done" : "");
    row.innerHTML = `
      <input type="checkbox" data-taskid="${t.id}" ${t.done ? "checked" : ""}>
      <span>${escapeAttr(t.text)}</span>
      <button data-del="${t.id}">✕</button>
    `;
    list.appendChild(row);
  });
}

document.getElementById("weekPrevBtn").addEventListener("click", () => { weekOffset--; renderCalendar(); });
document.getElementById("weekNextBtn").addEventListener("click", () => { weekOffset++; renderCalendar(); });

document.getElementById("weekDays").addEventListener("click", e => {
  const chip = e.target.closest(".day-chip");
  if (!chip) return;
  selectedDate = chip.dataset.date;
  renderCalendar();
});

document.getElementById("dayTaskForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("dayTaskInput");
  const text = input.value.trim();
  if (!text) return;
  if (!data.calendar[selectedDate]) data.calendar[selectedDate] = [];
  data.calendar[selectedDate].push({ id: "d_" + Math.random().toString(36).slice(2, 8), text, done: false });
  saveData();
  input.value = "";
  renderCalendar();
});

document.getElementById("dayTaskList").addEventListener("change", e => {
  if (e.target.matches("input[type=checkbox]")) {
    const id = e.target.dataset.taskid;
    const task = (data.calendar[selectedDate] || []).find(t => t.id === id);
    if (!task) return;
    const changed = task.done !== e.target.checked;
    task.done = e.target.checked;
    saveData();
    if (changed) addXP(task.done ? 10 : -10);
    renderCalendar();
  }
});

document.getElementById("dayTaskList").addEventListener("click", e => {
  const btn = e.target.closest("button[data-del]");
  if (!btn) return;
  const id = btn.dataset.del;
  data.calendar[selectedDate] = (data.calendar[selectedDate] || []).filter(t => t.id !== id);
  saveData();
  renderCalendar();
});

/* ---------------- RENDER ALL ---------------- */
function renderAll() {
  const alreadyMigrated = !!(data.fitness && data.fitness.version === 3);
  ensureFitness(data);
  if (!alreadyMigrated) saveData(); // Migration einmalig persistieren
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  renderXP();
  renderFitness();
  renderProjects();
  renderCalendar();
}

/* ---------------- EXPORT / IMPORT ---------------- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `silvanos-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      data = { ...defaultData(), ...parsed };
      saveData();
      renderAll();
    } catch (err) {
      alert("Import fehlgeschlagen: ungültige Datei.");
    }
  };
  reader.readAsText(file);
});

/* ================= CLOUD SYNC (private GitHub Gist) ================= */
let syncTimer = null;
let syncInFlight = false;

function getSyncToken() { return currentAccountId ? localStorage.getItem(accountTokenKey(currentAccountId)) : null; }
function getGistId() { return currentAccountId ? localStorage.getItem(accountGistKey(currentAccountId)) : null; }
function setGistId(id) { if (currentAccountId) localStorage.setItem(accountGistKey(currentAccountId), id); }

function scheduleSync() {
  if (!getSyncToken()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToGist(), 1500);
}

function setSyncStatus(text, mode) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("connected", "error");
  if (mode) el.classList.add(mode);
}

async function githubRequest(url, options = {}, tokenOverride) {
  const token = tokenOverride || getSyncToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function findExistingGist(token) {
  let page = 1;
  while (page <= 5) {
    const gists = await githubRequest(`https://api.github.com/gists?per_page=100&page=${page}`, {}, token);
    if (!gists.length) break;
    const match = gists.find(g => g.files && g.files[GIST_FILENAME]);
    if (match) return match.id;
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

async function createGist(token, initialData) {
  const gist = await githubRequest("https://api.github.com/gists", {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content: JSON.stringify(initialData !== undefined ? initialData : data, null, 2) } },
    }),
  }, token);
  return gist.id;
}

async function pullFromGist(gistId, token) {
  const gist = await githubRequest(`https://api.github.com/gists/${gistId}`, {}, token);
  const file = gist.files && gist.files[GIST_FILENAME];
  if (!file || !file.content) return null;
  return JSON.parse(file.content);
}

async function pushToGist() {
  const token = getSyncToken();
  if (!token || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus("synce...", null);
  try {
    let gistId = getGistId();
    if (!gistId) {
      gistId = await findExistingGist(token);
      if (!gistId) gistId = await createGist(token);
      setGistId(gistId);
    }
    await githubRequest(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } } }),
    }, token);
    setSyncStatus("verbunden · zuletzt " + new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }), "connected");
  } catch (e) {
    console.error("Sync push error", e);
    setSyncStatus("Fehler beim Sync — Token prüfen", "error");
  } finally {
    syncInFlight = false;
  }
}

async function initialSyncPull() {
  const token = getSyncToken();
  if (!token) { setSyncStatus("nicht verbunden", null); return; }
  setSyncStatus("verbinde...", null);
  try {
    let gistId = getGistId();
    if (!gistId) {
      gistId = await findExistingGist(token);
      if (gistId) setGistId(gistId);
    }
    if (gistId) {
      const remote = await pullFromGist(gistId, token);
      if (remote) data = { ...defaultData(), ...remote };
    } else {
      const newId = await createGist(token);
      setGistId(newId);
    }
    setSyncStatus("verbunden · zuletzt " + new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }), "connected");
  } catch (e) {
    console.error("Sync pull error", e);
    setSyncStatus("Fehler beim Verbinden — Token prüfen", "error");
  }
}

function connectSync(token) {
  if (!currentAccountId) return Promise.resolve();
  localStorage.setItem(accountTokenKey(currentAccountId), token.trim());
  localStorage.removeItem(accountGistKey(currentAccountId));
  return initialSyncPull().then(renderAll);
}

function disconnectSync() {
  if (!currentAccountId) return;
  localStorage.removeItem(accountTokenKey(currentAccountId));
  localStorage.removeItem(accountGistKey(currentAccountId));
  setSyncStatus("nicht verbunden", null);
  document.getElementById("syncSetup").classList.add("hidden");
  document.getElementById("syncDisconnectBtn").classList.add("hidden");
}

document.getElementById("syncToggleBtn").addEventListener("click", () => {
  document.getElementById("syncSetup").classList.toggle("hidden");
});
document.getElementById("syncForm").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("syncTokenInput");
  const token = input.value.trim();
  if (!token) return;
  await connectSync(token);
  input.value = "";
  document.getElementById("syncSetup").classList.add("hidden");
  document.getElementById("syncDisconnectBtn").classList.remove("hidden");
});
document.getElementById("syncDisconnectBtn").addEventListener("click", () => disconnectSync());

/* ================= ACCOUNTS (multi-user login) =================
   No backend: password only gates the login screen on this device.
   Real cross-device continuity comes from each account's own GitHub
   token pointing at its own private gist (same as Cloud Sync above).
   ================================================================= */

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("loadAccounts error", e);
    return [];
  }
}
function saveAccounts(list) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}
function findAccountByEmail(email) {
  return loadAccounts().find(a => a.email.toLowerCase() === email.toLowerCase());
}
function getCurrentAccountId() { return localStorage.getItem(CURRENT_ACCOUNT_KEY); }
function setCurrentAccountId(id) {
  currentAccountId = id;
  if (id) localStorage.setItem(CURRENT_ACCOUNT_KEY, id);
  else localStorage.removeItem(CURRENT_ACCOUNT_KEY);
}
function legacyDataExists() {
  return !!(localStorage.getItem(LEGACY_STORAGE_KEY) || localStorage.getItem(LEGACY_SYNC_TOKEN_KEY));
}

function randomSaltB64() {
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...arr));
}
async function derivePasswordHash(password, saltB64) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
async function createAccountRecord(email, password) {
  const id = "acc_" + Math.random().toString(36).slice(2, 10);
  const salt = randomSaltB64();
  const hash = await derivePasswordHash(password, salt);
  const accounts = loadAccounts();
  accounts.push({ id, email, salt, hash });
  saveAccounts(accounts);
  return id;
}
async function verifyPassword(account, password) {
  const hash = await derivePasswordHash(password, account.salt);
  return hash === account.hash;
}

async function migrateLegacyData(email, password) {
  const id = await createAccountRecord(email, password);
  const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyData) localStorage.setItem(accountDataKey(id), legacyData);
  const legacyToken = localStorage.getItem(LEGACY_SYNC_TOKEN_KEY);
  if (legacyToken) localStorage.setItem(accountTokenKey(id), legacyToken);
  const legacyGist = localStorage.getItem(LEGACY_SYNC_GIST_KEY);
  if (legacyGist) localStorage.setItem(accountGistKey(id), legacyGist);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(LEGACY_SYNC_TOKEN_KEY);
  localStorage.removeItem(LEGACY_SYNC_GIST_KEY);
  await enterAccount(id);
}

async function connectNewAccount(email, password, token) {
  if (findAccountByEmail(email)) {
    throw new Error("Diese E-Mail ist auf diesem Gerät schon verbunden — bitte anmelden statt neu verbinden.");
  }
  let gistId = await findExistingGist(token);
  let remoteData;
  if (gistId) {
    remoteData = await pullFromGist(gistId, token);
  } else {
    remoteData = defaultData();
    gistId = await createGist(token, remoteData);
  }
  const id = await createAccountRecord(email, password);
  localStorage.setItem(accountTokenKey(id), token);
  localStorage.setItem(accountGistKey(id), gistId);
  localStorage.setItem(accountDataKey(id), JSON.stringify({ ...defaultData(), ...remoteData }));
  await enterAccount(id);
}

async function enterAccount(id) {
  setCurrentAccountId(id);
  data = loadData();
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  const account = loadAccounts().find(a => a.id === id);
  document.getElementById("currentUserLabel").textContent = account ? account.email.split("@")[0].toUpperCase() : "SILVAN";
  if (getSyncToken()) {
    document.getElementById("syncDisconnectBtn").classList.remove("hidden");
    await initialSyncPull();
  } else {
    document.getElementById("syncDisconnectBtn").classList.add("hidden");
    setSyncStatus("nicht verbunden", null);
  }
  renderAll();
}

function logout() {
  setCurrentAccountId(null);
  data = defaultData();
  document.getElementById("app").classList.add("hidden");
  showAuthScreen();
}

let authPendingAccount = null;

function renderAuthAccountList() {
  const listEl = document.getElementById("authAccountList");
  listEl.innerHTML = "";
  loadAccounts().forEach(acc => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "auth-account-btn";
    btn.textContent = acc.email;
    btn.addEventListener("click", () => showAuthPasswordStep(acc));
    listEl.appendChild(btn);
  });
}

function showAuthPasswordStep(account) {
  authPendingAccount = account;
  setAuthError(null);
  document.getElementById("authPasswordEmail").textContent = account.email;
  document.getElementById("authPasswordForm").classList.remove("hidden");
  document.getElementById("authAccountList").classList.add("hidden");
  document.getElementById("authConnectToggleBtn").classList.add("hidden");
  document.getElementById("authConnectForm").classList.add("hidden");
  document.getElementById("authPasswordInput").focus();
}
function hideAuthPasswordStep() {
  authPendingAccount = null;
  document.getElementById("authPasswordInput").value = "";
  document.getElementById("authPasswordForm").classList.add("hidden");
  document.getElementById("authAccountList").classList.remove("hidden");
  document.getElementById("authConnectToggleBtn").classList.remove("hidden");
}

function setAuthError(msg) {
  const el = document.getElementById("authError");
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = msg;
  el.classList.remove("hidden");
}
function setAuthBusy(msg) {
  const el = document.getElementById("authBusy");
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = msg;
  el.classList.remove("hidden");
}

function showAuthScreen() {
  setAuthError(null);
  setAuthBusy(null);
  hideAuthPasswordStep();
  document.getElementById("authConnectForm").classList.add("hidden");
  renderAuthAccountList();
  const migrate = legacyDataExists() && loadAccounts().length === 0;
  document.getElementById("authMigrateForm").classList.toggle("hidden", !migrate);
  document.getElementById("authMain").classList.toggle("hidden", migrate);
  document.getElementById("authScreen").classList.remove("hidden");
}

document.getElementById("authMigrateForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("migrateEmailInput").value.trim();
  const password = document.getElementById("migratePasswordInput").value;
  if (!email || !password) return;
  setAuthError(null);
  setAuthBusy("Konto wird angelegt…");
  try {
    await migrateLegacyData(email, password);
  } catch (e) {
    console.error("Migration error", e);
    setAuthError("Fehler beim Anlegen des Kontos.");
  } finally {
    setAuthBusy(null);
  }
});

document.getElementById("authPasswordForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!authPendingAccount) return;
  const password = document.getElementById("authPasswordInput").value;
  const ok = await verifyPassword(authPendingAccount, password);
  if (!ok) { setAuthError("Falsches Passwort."); return; }
  const id = authPendingAccount.id;
  hideAuthPasswordStep();
  setAuthBusy("Anmelden…");
  try {
    await enterAccount(id);
  } finally {
    setAuthBusy(null);
  }
});
document.getElementById("authPasswordBackBtn").addEventListener("click", () => hideAuthPasswordStep());

document.getElementById("authConnectToggleBtn").addEventListener("click", () => {
  document.getElementById("authConnectForm").classList.toggle("hidden");
});
document.getElementById("authConnectForm").addEventListener("submit", async e => {
  e.preventDefault();
  const emailInput = document.getElementById("authEmailInput");
  const passwordInput = document.getElementById("authNewPasswordInput");
  const tokenInput = document.getElementById("authTokenInput");
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const token = tokenInput.value.trim();
  if (!email || !password || !token) return;
  setAuthError(null);
  setAuthBusy("Verbinde mit GitHub…");
  try {
    await connectNewAccount(email, password, token);
    emailInput.value = "";
    passwordInput.value = "";
    tokenInput.value = "";
  } catch (err) {
    console.error("Connect account error", err);
    setAuthError(err.message || "Verbindung fehlgeschlagen — Token prüfen.");
  } finally {
    setAuthBusy(null);
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => logout());

/* ================= COLOR THEME (presets + custom combos) =================
   Only 4 colors are user-facing (background, panel, accent, text) — the rest
   of the palette (borders, muted text, the dimmed accent, chart/scanline
   colors) is derived from them so every combo stays internally consistent.
   Stored locally per browser (not synced) since it's a display preference,
   not app data. ================================================================= */
const THEME_KEY = "silvanos_theme_v1";
const THEME_PRESETS = {
  mint:   { bg: "#0A0E14", panel: "#12181F", accent: "#4CE0B3", text: "#E6EDF3" },
  amber:  { bg: "#120E09", panel: "#1E160D", accent: "#E0A64C", text: "#F3ECE0" },
  violet: { bg: "#0B0A14", panel: "#171224", accent: "#9B6CE0", text: "#ECE6F3" },
  rose:   { bg: "#140A0E", panel: "#221217", accent: "#E0537F", text: "#F3E6EA" },
  blue:   { bg: "#080E14", panel: "#0F1A24", accent: "#4CA6E0", text: "#E6EEF3" },
};
const THEME_PRESET_LABELS = { mint: "Mint", amber: "Amber", violet: "Violett", rose: "Rosé", blue: "Blau" };

let accentHex = THEME_PRESETS.mint.accent;
let accentRgbTriplet = "76,224,179";
let scanlineCanvas, scanlineCtx; // set by initScanlines() during boot(); drawScanlines() no-ops until then

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb({ h, s, l }) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, h + 1 / 3) * 255, g: hue2rgb(p, q, h) * 255, b: hue2rgb(p, q, h - 1 / 3) * 255 };
}
function adjustLightness(hex, deltaPercent) {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l = Math.max(0, Math.min(100, hsl.l + deltaPercent));
  return rgbToHex(hslToRgb(hsl));
}
function mixHex(hexA, hexB, weightA) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r * weightA + b.r * (1 - weightA),
    g: a.g * weightA + b.g * (1 - weightA),
    b: a.b * weightA + b.b * (1 - weightA),
  });
}

function deriveTheme({ bg, panel, accent, text }) {
  const { r, g, b } = hexToRgb(accent);
  return {
    bg, panel, text, accent,
    panelBorder: adjustLightness(panel, 10),
    accentDim: adjustLightness(accent, -20),
    textMuted: mixHex(text, bg, 0.55),
    accentRgb: `${r},${g},${b}`,
  };
}

function applyTheme(theme) {
  const t = deriveTheme(theme);
  const root = document.documentElement.style;
  root.setProperty("--bg", t.bg);
  root.setProperty("--panel", t.panel);
  root.setProperty("--panel-border", t.panelBorder);
  root.setProperty("--mint", t.accent);
  root.setProperty("--mint-dim", t.accentDim);
  root.setProperty("--text", t.text);
  root.setProperty("--text-muted", t.textMuted);
  root.setProperty("--mint-rgb", t.accentRgb);
  accentHex = t.accent;
  accentRgbTriplet = t.accentRgb;
  drawScanlines();
  if (currentAccountId) renderFitness();
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw ? JSON.parse(raw) : THEME_PRESETS.mint;
  } catch (e) {
    return THEME_PRESETS.mint;
  }
}

function populateThemeCustomInputs(theme) {
  document.getElementById("themeBg").value = theme.bg;
  document.getElementById("themePanelColor").value = theme.panel;
  document.getElementById("themeAccent").value = theme.accent;
  document.getElementById("themeText").value = theme.text;
}

function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  populateThemeCustomInputs(theme);
  renderThemePresetActive(theme);
}

function renderThemePresets() {
  const container = document.getElementById("themePresets");
  container.innerHTML = "";
  Object.entries(THEME_PRESETS).forEach(([key, theme]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-preset-btn";
    btn.dataset.preset = key;
    btn.innerHTML = `
      <span class="theme-preset-swatch">
        <span style="background:${theme.bg}"></span>
        <span style="background:${theme.panel}"></span>
        <span style="background:${theme.accent}"></span>
      </span>
      <span class="theme-preset-name">${THEME_PRESET_LABELS[key] || key}</span>
    `;
    container.appendChild(btn);
  });
}

function renderThemePresetActive(theme) {
  document.querySelectorAll(".theme-preset-btn").forEach(btn => {
    const preset = THEME_PRESETS[btn.dataset.preset];
    const match = preset && preset.bg === theme.bg && preset.panel === theme.panel &&
      preset.accent === theme.accent && preset.text === theme.text;
    btn.classList.toggle("active", !!match);
  });
}

document.getElementById("themeToggleBtn").addEventListener("click", () => {
  document.getElementById("themePanel").classList.toggle("hidden");
});
document.getElementById("themePresets").addEventListener("click", e => {
  const btn = e.target.closest(".theme-preset-btn");
  if (!btn) return;
  setTheme(THEME_PRESETS[btn.dataset.preset]);
});
document.getElementById("themeResetBtn").addEventListener("click", () => setTheme(THEME_PRESETS.mint));
["themeBg", "themePanelColor", "themeAccent", "themeText"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    setTheme({
      bg: document.getElementById("themeBg").value,
      panel: document.getElementById("themePanelColor").value,
      accent: document.getElementById("themeAccent").value,
      text: document.getElementById("themeText").value,
    });
  });
});

renderThemePresets();
const initialTheme = loadTheme();
applyTheme(initialTheme);
populateThemeCustomInputs(initialTheme);
renderThemePresetActive(initialTheme);

/* ---------------- SCANLINE BACKGROUND ---------------- */
function drawScanlines() {
  if (!scanlineCtx) return;
  const canvas = scanlineCanvas, ctx = scanlineCtx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = `rgba(${accentRgbTriplet},0.025)`;
  ctx.lineWidth = 1;
  for (let y = 0; y < canvas.height; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.strokeStyle = `rgba(${accentRgbTriplet},0.015)`;
  for (let x = 0; x < canvas.width; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
}
function initScanlines() {
  scanlineCanvas = document.getElementById("scanlines");
  scanlineCtx = scanlineCanvas.getContext("2d");
  function resize() { scanlineCanvas.width = window.innerWidth; scanlineCanvas.height = window.innerHeight; drawScanlines(); }
  window.addEventListener("resize", resize);
  resize();
}

/* ---------------- PWA: service worker registration ---------------- */
// A new service worker takes over an already-open tab via skipWaiting() +
// clients.claim() (see service-worker.js), but that only swaps which worker
// answers future network requests — the page itself keeps running the old
// HTML/CSS/JS already in memory until it's reloaded. Auto-reload once when
// that handover happens so a deploy is visible without the user having to
// know to refresh (previously needed two manual reloads on some devices).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.error("SW registration failed", err));

    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  });
}

/* ---------------- FITNESS-MODUL ANBINDEN ---------------- */
bindFitness({
  getData: () => data,
  save: () => saveData(),
  addXP: n => addXP(n),
});
initFitnessUI({ getAccent: () => ({ hex: accentHex, rgb: accentRgbTriplet }) });
// Für Konsole/Tests und später Cypher: window.SILVAN.fitness.logWeight("2026-09-24", 78.6)
window.SILVAN = Object.assign(window.SILVAN || {}, { fitness });

/* ---------------- BOOT ---------------- */
async function boot() {
  initScanlines();
  setTimeout(async () => {
    document.getElementById("boot").classList.add("hidden");
    const savedId = getCurrentAccountId();
    const account = savedId && loadAccounts().find(a => a.id === savedId);
    if (account) {
      await enterAccount(account.id);
    } else {
      showAuthScreen();
    }
  }, 600);
}

boot();
