/* ============================================================
   GAINFORGE — Fitness + Life-Dashboard (NEXUS-Look)
   ------------------------------------------------------------
   app.js verbindet nur: Login/Migration, Kacheln, Panels,
   Einstellungen, Terminal-Befehle, Boot.
   Daten: js/store.js (Firestore) · Fitness: js/fitness/*
   Projekte: js/projects.js · Planer: js/calendar.js
   Alle Aktionen laufen über benannte Befehle (fitness.*, projects.*,
   calendar.*) — dieselben kann später Cypher aufrufen.
   ============================================================ */

import { ensureFitness } from "./js/fitness/model.js";
import { bindFitness, fitness, onFitnessChange } from "./js/fitness/commands.js";
import { initFitnessUI, renderFitnessTiles, hudInfo, openTraining, openWeight, openProgress, openMuscles } from "./js/fitness/ui.js";
import { weightEntries, weeklyAverages, courseStatus, plateauStatus, exerciseSeries, fmtSigned } from "./js/fitness/analytics.js";
import { exerciseName, findTemplate } from "./js/fitness/model.js";
import { auth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "./js/firebase.js";
import * as store from "./js/store.js";
import { findLegacyDatasets, markClaimed, removeLegacyTokens } from "./js/legacy.js";
import { bindCore, onChanged } from "./js/core.js";
import { projects, defaultProjects, renderProjectTiles, openProject, refreshProjectSheet } from "./js/projects.js";
import { calendar, renderTodayTile, openCalendar, refreshCalendarSheet } from "./js/calendar.js";
import { openSheet, closeSheet, currentSheetId, refreshSheet } from "./js/ui/sheet.js";
import { runBoot, initReticle, toast, esc } from "./js/ui/fx.js";
import { registerCommand, runCommand, openTerminal, closeTerminal } from "./js/ui/terminal.js";
import { listActions, callAction, toolSchemas, bindActionUI } from "./js/actions.js";
import { cypher, initCypher } from "./js/cypher.js";
import { todayKey, addDays, mondayOf, isoWeek, formatShort, DOW_SHORT, weekday, isDayKey } from "./js/dates.js";

const VERSION = "3.5";
const $ = id => document.getElementById(id);

function defaultData() {
  return { xp: 0, projects: defaultProjects(), calendar: {} };
}

let currentUser = null;
let data = defaultData();

/* ---------------- Speichern ---------------- */
function saveData() {
  if (!currentUser || !store.isActive()) return;
  store.queueSave();
}

/* ---------------- XP ---------------- */
const levelForXP = xp => Math.floor(xp / 100) + 1;
function addXP(amount) {
  const prev = levelForXP(data.xp || 0);
  data.xp = Math.max(0, (data.xp || 0) + amount);
  saveData();
  renderXP();
  const now = levelForXP(data.xp);
  if (now > prev) toast(`LEVEL UP → ${now}`);
}
function renderXP() {
  $("level").textContent = levelForXP(data.xp || 0);
  $("xpBarFill").style.transform = `scaleX(${((data.xp || 0) % 100) / 100})`;
}
$("xpBtn").addEventListener("click", () => {
  const xp = data.xp || 0;
  toast(`Level ${levelForXP(xp)} · noch ${100 - (xp % 100)} XP bis Level ${levelForXP(xp) + 1}`);
});

/* ---------------- Akzentfarbe ---------------- */
const ACCENTS = { cyan: "#00f0ff", mint: "#3dffb4", magenta: "#ff2bd6", amber: "#ffb547", lime: "#a8ff1a", violet: "#9d7bff" };
const ACCENT_KEY = "gainforge_accent";
let accent = { hex: ACCENTS.cyan, rgb: "0,240,255" };
function applyAccent(name) {
  const hex = ACCENTS[name] || ACCENTS.cyan;
  const n = parseInt(hex.slice(1), 16);
  accent = { name: ACCENTS[name] ? name : "cyan", hex, rgb: `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}` };
  document.documentElement.style.setProperty("--c", hex);
  document.documentElement.style.setProperty("--c-rgb", accent.rgb);
  localStorage.setItem(ACCENT_KEY, accent.name);
}
applyAccent(localStorage.getItem(ACCENT_KEY) || localStorage.getItem("silvanos_accent") || "cyan");

/* ---------------- Rendern ---------------- */
function renderHud() {
  const t = todayKey();
  const h = hudInfo();
  $("hudLine").innerHTML = `${DOW_SHORT[weekday(t)]} ${formatShort(t)} · KW ${isoWeek(t)}${h.phase ? ` · <b>${esc(h.phase)}</b>` : ""}`;
}

function renderTiles() {
  renderFitnessTiles();
  renderTodayTile();
  renderProjectTiles();
  renderHud();
}

function renderAll() {
  const alreadyMigrated = !!(data.fitness && data.fitness.version === 3);
  ensureFitness(data);
  if (!alreadyMigrated) saveData(); // Migration einmalig persistieren
  renderXP();
  renderTiles();
  // offenes Panel mit neuen Daten nachzeichnen
  const sid = currentSheetId();
  if (sid && sid.startsWith("project:")) refreshProjectSheet();
  else if (sid === "calendar") refreshCalendarSheet();
  else if (sid === "settings") refreshSheet();
  else if (sid) refreshSheet();
}

/* Fitness-Änderungen: Kopfzeile (Phase, Trainings) aktuell halten */
onFitnessChange(() => renderHud());

/* Projekte/Planer melden Änderungen */
onChanged((scope, detail) => {
  renderTiles();
  if (detail.soft) return; // Umbenennen: Panel nicht neu zeichnen (Fokus bleibt)
  if (scope === "projects") refreshProjectSheet();
  if (scope === "calendar") refreshCalendarSheet();
});

/* ---------------- Kacheln -> Panels ---------------- */
$("tiles").addEventListener("click", e => {
  const tile = e.target.closest("[data-open]");
  if (!tile) return;
  const kind = tile.dataset.open;
  if (kind === "training") openTraining();
  else if (kind === "weight") openWeight({ focus: fitness.getState().weights[todayKey()] == null });
  else if (kind === "progress") openProgress();
  else if (kind === "muscles") openMuscles();
  else if (kind === "calendar") openCalendar();
  else if (kind === "project") openProject(tile.dataset.id);
  else if (kind === "project-new") {
    const name = prompt("Name des neuen Projekts:", "Neues Projekt");
    if (name) openProject(projects.add(name));
  }
});

/* ---------------- Einstellungen ---------------- */
function openSettings() {
  openSheet({
    id: "settings", cat: "System", title: "Einstellungen", sub: currentUser ? currentUser.email : "",
    render: body => {
      body.innerHTML = `
        <div class="psec">Konto</div>
        <div class="kv kv-2">
          <div><b>Login</b><span>${esc(currentUser ? currentUser.email : "–")}</span></div>
          <div><b>Cloud</b><span>${esc($("syncStatus").title || "–")}</span></div>
        </div>
        <div class="psec">Akzentfarbe</div>
        <div class="swatches">${Object.entries(ACCENTS).map(([k, v]) => `<button type="button" class="sw ${k === accent.name ? "on" : ""}" data-accent="${k}" style="--s:${v}" aria-label="${k}"><i></i></button>`).join("")}</div>
        <div class="psec">Daten</div>
        <div class="stack">
          <button type="button" class="btn" data-set="export">Backup exportieren (JSON)</button>
          <label class="btn ghost">Backup importieren<input type="file" accept="application/json" data-set="import" hidden></label>
        </div>
        <div class="psec">Sitzung</div>
        <button type="button" class="btn danger block" data-set="logout">Abmelden</button>
        <p class="hint" style="text-align:center;margin-top:18px">GAINFORGE v${VERSION} · Terminal: Knopf &gt;_ oben</p>`;
    },
    bind: body => {
      body.addEventListener("click", e => {
        const sw = e.target.closest("[data-accent]");
        if (sw) { applyAccent(sw.dataset.accent); refreshSheet(); renderTiles(); return; }
        const b = e.target.closest("[data-set]");
        if (!b) return;
        if (b.dataset.set === "export") exportData();
        if (b.dataset.set === "logout") logout();
      });
      body.addEventListener("change", e => { if (e.target.dataset.set === "import") importData(e.target); });
    },
  });
}
$("settingsBtn").addEventListener("click", openSettings);
$("termBtn").addEventListener("click", openTerminal);

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `gainforge-backup-${todayKey()}.json`; a.click();
  URL.revokeObjectURL(url);
}
function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!confirm("Backup importieren? Deine aktuellen Cloud-Daten werden dadurch ersetzt.")) return;
      data = { ...defaultData(), ...parsed };
      saveData();
      renderAll();
      toast("Backup importiert");
    } catch (err) { toast("Die Datei ist kein gültiges Backup.", "err"); }
  };
  reader.readAsText(file);
  input.value = "";
}

/* ================= LOGIN & SITZUNG (Firebase) ================= */
let authMode = "login";
const AUTH_ERRORS = {
  "auth/invalid-credential": "E-Mail oder Passwort falsch.",
  "auth/wrong-password": "E-Mail oder Passwort falsch.",
  "auth/user-not-found": "E-Mail oder Passwort falsch.",
  "auth/invalid-email": "Das ist keine gültige E-Mail-Form, z.B. name@gainforge.app.",
  "auth/missing-password": "Bitte ein Passwort eingeben.",
  "auth/weak-password": "Das Passwort braucht mindestens 6 Zeichen.",
  "auth/email-already-in-use": "Für diese E-Mail gibt es schon ein Konto. Melde dich an.",
  "auth/too-many-requests": "Zu viele Versuche. Warte kurz und versuch es nochmals.",
  "auth/network-request-failed": "Keine Internetverbindung. Das erste Login braucht Netz.",
  "permission-denied": "Firestore blockiert den Zugriff. Sicherheitsregeln prüfen.",
  "unavailable": "Offline und noch keine Daten auf diesem Gerät. Bitte einmal mit Internet öffnen.",
};
const errorText = e => AUTH_ERRORS[e && e.code] || (e && e.message) || "Unbekannter Fehler.";
function showMsg(id, msg) { $(id).textContent = msg || ""; $(id).hidden = !msg; }
function showScreen(which) {
  $("authScreen").hidden = which !== "auth";
  $("migrateScreen").hidden = which !== "migrate";
  $("app").hidden = which !== "app";
}
function setAuthMode(mode) {
  authMode = mode;
  $("authSubmit").textContent = mode === "login" ? "Anmelden" : "Konto erstellen";
  $("authModeToggle").textContent = mode === "login" ? "Noch kein Konto? Konto erstellen" : "Schon ein Konto? Anmelden";
  $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  showMsg("authError", "");
}
function showAuthScreen() { setAuthMode(authMode); showMsg("authBusy", ""); showScreen("auth"); }

$("authModeToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;
  showMsg("authError", "");
  showMsg("authBusy", authMode === "login" ? "Melde an…" : "Erstelle Konto…");
  $("authSubmit").disabled = true;
  try {
    if (authMode === "login") await signInWithEmailAndPassword(auth, email, password);
    else await createUserWithEmailAndPassword(auth, email, password);
    $("authPassword").value = "";
  } catch (err) {
    showMsg("authBusy", "");
    showMsg("authError", errorText(err));
  } finally { $("authSubmit").disabled = false; }
});

/* Sync-Anzeige */
const SYNC_LABELS = {
  pending: "Änderung wird gespeichert", saving: "Wird hochgeladen", saved: "Alles gespeichert",
  offline: "Offline gespeichert, wird automatisch hochgeladen", error: "Speichern fehlgeschlagen",
};
function setSyncStatus(state, msg) {
  const el = $("syncStatus");
  el.dataset.state = state;
  el.title = (SYNC_LABELS[state] || "") + (msg ? `: ${msg}` : "");
  if (state === "error") toast(el.title, "err");
}
$("syncStatus").addEventListener("click", () => toast($("syncStatus").title));

/* Live-Änderungen von anderen Geräten: nicht mitten im Tippen neu zeichnen */
let renderDeferred = false;
const isTyping = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.closest("#term"); };
function onRemoteChange() { if (isTyping()) { renderDeferred = true; return; } renderAll(); }
document.addEventListener("focusout", () => setTimeout(() => { if (renderDeferred && !isTyping()) { renderDeferred = false; renderAll(); } }, 60));

async function enterUser(user) {
  currentUser = user;
  showMsg("authError", "");
  showMsg("authBusy", "Lade Daten…");
  try {
    const res = await store.openSession(user.uid, user.email, { getData: () => data, onRemoteChange, onStatus: setSyncStatus });
    if (!res.exists) { showMigrateScreen(); return; }
    data = { ...defaultData(), ...res.data };
    startApp();
  } catch (err) {
    console.error(err);
    showScreen("auth");
    showMsg("authBusy", "");
    showMsg("authError", errorText(err));
  }
}
function startApp() {
  showScreen("app");
  renderAll();
  store.startLive();
}

/* Erstes Login: alte Daten übernehmen */
let legacyCandidates = [];
function showMigrateScreen() {
  legacyCandidates = findLegacyDatasets();
  showMsg("migrateError", ""); showMsg("migrateBusy", "");
  $("migrateIntro").textContent = legacyCandidates.length
    ? "Dein Konto ist neu. Auf diesem Gerät liegen noch Daten aus der alten Version. Welche sollen übernommen werden?"
    : "Dein Konto ist neu. Auf diesem Gerät wurden keine alten Daten gefunden. Du kannst ein Backup importieren oder leer starten.";
  $("migrateList").innerHTML = legacyCandidates.map((c, i) => {
    const s = c.summary;
    return `<button type="button" class="migrate-btn" data-idx="${i}"><b>${esc(c.label)}</b>
      <span>${s.workouts} Trainings · ${s.weights} Gewichte · ${s.projects} Projekte · ${s.calendarDays} Kalendertage · ${s.xp} XP</span></button>`;
  }).join("");
  showScreen("migrate");
}
async function finishMigration(sourceData, legacyKey) {
  showMsg("migrateError", ""); showMsg("migrateBusy", "Speichere in dein Konto…");
  $("migrateScreen").querySelectorAll("button, input").forEach(el => { el.disabled = true; });
  try {
    const fresh = { ...defaultData(), ...(sourceData || {}) };
    ensureFitness(fresh);
    await store.createUserData(fresh);
    if (legacyKey) markClaimed(legacyKey);
    removeLegacyTokens();
    data = fresh;
    startApp();
  } catch (err) {
    console.error(err);
    showMsg("migrateBusy", ""); showMsg("migrateError", errorText(err));
  } finally {
    $("migrateScreen").querySelectorAll("button, input").forEach(el => { el.disabled = false; });
  }
}
$("migrateList").addEventListener("click", e => {
  const btn = e.target.closest(".migrate-btn"); if (!btn) return;
  const c = legacyCandidates[+btn.dataset.idx];
  finishMigration(c.data, c.key);
});
$("migrateSkip").addEventListener("click", () => {
  if (legacyCandidates.length && !confirm("Wirklich leer starten? Die alten Daten bleiben auf dem Gerät, werden aber nicht übernommen.")) return;
  finishMigration(null, null);
});
$("migrateFile").addEventListener("change", e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { finishMigration(JSON.parse(reader.result), null); }
    catch (err) { showMsg("migrateError", "Die Datei ist kein gültiges Backup."); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

async function logout() {
  if (!confirm("Abmelden?")) return;
  closeSheet();
  closeTerminal();
  await store.closeSession();
  await signOut(auth);
}

/* ================= TERMINAL-BEFEHLE ================= */
function parseDateArg(arg) {
  if (!arg || arg === "heute") return todayKey();
  if (arg === "gestern") return addDays(todayKey(), -1);
  if (isDayKey(arg)) return arg;
  const m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(arg);
  if (m) { const d = `${todayKey().slice(0, 4)}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (isDayKey(d)) return d; }
  throw new Error(`Datum nicht erkannt: ${arg} (heute, gestern, 24.09. oder 2026-09-24)`);
}
registerCommand("gewicht", {
  aliases: ["w", "weight"], usage: "gewicht <kg> [datum]", help: "Morgengewicht loggen",
  run: ([kg, d], io) => {
    const v = parseFloat(String(kg || "").replace(",", "."));
    if (!(v > 20 && v < 400)) throw new Error("Beispiel: gewicht 78.6  ·  gewicht 78.6 gestern");
    const date = parseDateArg(d);
    fitness.logWeight(date, v);
    io.ok(`✓ ${v.toFixed(1)} kg am ${formatShort(date)} gespeichert`);
  },
});
registerCommand("status", {
  aliases: ["s"], help: "Wochenschnitt, Kurs, Training",
  run: (_, io) => {
    const f = fitness.getState();
    const weeks = weeklyAverages(weightEntries(f));
    const cur = weeks.find(w => w.monday === mondayOf(todayKey()));
    const c = courseStatus(f);
    const h = hudInfo();
    io.acc(`PHASE     ${h.phase || "–"}`);
    io.print(`Ø KW      ${cur ? cur.avg.toFixed(1) + " kg (" + cur.n + " Messungen)" : "–"}`);
    io.print(`KURS      ${c.title}${c.rate != null ? " · " + fmtSigned(c.rate, 2) + " kg/W" : ""}`);
    io.print(`TRAINING  ${h.week} diese Woche`);
    io.print(`LEVEL     ${levelForXP(data.xp || 0)} (${data.xp || 0} XP)`);
  },
});
registerCommand("training", {
  aliases: ["t", "train"], usage: "training [nr|name]", help: "Training öffnen",
  run: ([arg], io) => {
    const f = fitness.getState();
    let tpl = null;
    if (arg) tpl = f.templates[+arg - 1] || f.templates.find(t => t.name.toLowerCase().includes(arg.toLowerCase()));
    if (arg && !tpl) throw new Error(`Keine Vorlage "${arg}". Vorhanden: ${f.templates.map((t, i) => `${i + 1}=${t.name}`).join(", ")}`);
    io.close();
    openTraining(tpl ? { templateId: tpl.id } : {});
  },
});
registerCommand("plateau", {
  aliases: ["p"], help: "Plateau-Radar anzeigen",
  run: (_, io) => {
    const f = fitness.getState();
    const ids = [...new Set(Object.values(f.workouts).flatMap(w => Object.keys(w.sets)))];
    if (!ids.length) { io.dim("Noch keine Trainingsdaten."); return; }
    ids.map(id => ({ n: exerciseName(f, id), s: plateauStatus(exerciseSeries(f, id)) }))
      .sort((a, b) => a.s.status.localeCompare(b.s.status))
      .forEach(r => io.print(`${r.s.label.padEnd(14)} ${r.n}`, r.s.status === "plateau" || r.s.status === "decline" ? "err" : r.s.status === "progress" ? "ok" : "dim"));
  },
});
registerCommand("todo", {
  usage: "todo <text>", help: "Aufgabe für heute",
  run: (args, io) => { const t = args.join(" "); if (!t) throw new Error("Beispiel: todo M129 Cheatsheet"); calendar.addTask(todayKey(), t); io.ok(`✓ Für heute eingetragen: ${t}`); },
});
registerCommand("xp", { help: "Level anzeigen", run: (_, io) => io.print(`Level ${levelForXP(data.xp || 0)} · ${data.xp || 0} XP · noch ${100 - ((data.xp || 0) % 100)} bis zum nächsten`) });
registerCommand("theme", {
  usage: "theme <farbe>", help: Object.keys(ACCENTS).join(" | "),
  run: ([n], io) => { if (!ACCENTS[n]) throw new Error("Farben: " + Object.keys(ACCENTS).join(", ")); applyAccent(n); renderTiles(); io.ok(`✓ Akzent: ${n}`); },
});
registerCommand("sync", { help: "Cloud-Status", run: (_, io) => io.print($("syncStatus").title || "–") });
registerCommand("actions", {
  help: "alle Aktionen für Cypher",
  run: (_, io) => listActions().forEach(a => io.print(`${a.kind === "read" ? "R" : "W"}${a.destructive ? "!" : " "} ${a.name}`, a.kind === "read" ? "dim" : "")),
});
registerCommand("call", {
  usage: "call <aktion> [json]", help: 'Aktion ausführen, z.B. call fitness_log_weight {"kg":78.6}',
  run: async ([name, ...rest], io) => {
    if (!name) throw new Error("Beispiel: call fitness_status");
    let args = {};
    if (rest.length) { try { args = JSON.parse(rest.join(" ")); } catch { throw new Error("Parameter müssen JSON sein, z.B. {\"kg\":78.6}"); } }
    const r = await callAction(name, args);
    if (!r.ok) { io.err(r.error); return; }
    io.ok(typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2));
  },
});
registerCommand("logout", { help: "abmelden", run: (_, io) => { io.close(); logout(); } });

/* ---------------- Module anbinden ---------------- */
bindCore({ getData: () => data, save: saveData, addXP });
bindFitness({ getData: () => data, save: saveData, addXP });
initFitnessUI({ getAccent: () => accent });
initReticle();
initCypher();
bindActionUI({
  open: (view, extra = {}) => {
    closeTerminal();
    if (view === "training") openTraining();
    else if (view === "weight") openWeight();
    else if (view === "progress") openProgress();
    else if (view === "muscles") openMuscles();
    else if (view === "calendar") openCalendar();
    else if (view === "settings") openSettings();
    else if (view === "project") openProject(extra.id);
    else if (view === "home") closeSheet();
  },
});
// Konsole / Cypher: GAINFORGE.fitness.logWeight("2026-09-24", 78.6) · GAINFORGE.run("status")
// window.SILVAN bleibt als alter Name erhalten, damit nichts bricht.
window.GAINFORGE = window.SILVAN = Object.assign(window.GAINFORGE || {}, {
  fitness, projects, calendar, run: runCommand, cypher,
  actions: { list: listActions, call: callAction, tools: toolSchemas },
});

/* ---------------- PWA ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.error("SW registration failed", err));
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; window.location.reload(); } });
  });
}

/* ---------------- BOOT ---------------- */
function boot() {
  window.__gainforgeBooted = true;
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  runBoot([
    ["> forge core", "ok"],
    ["> firebase uplink", "ok"],
    ["> fitness core", "ok"],
    ["> session", "…"],
  ], ready);
  let first = true;
  onAuthStateChanged(auth, async user => {
    if (user) await enterUser(user);
    else {
      currentUser = null;
      closeSheet();
      await store.closeSession();
      data = defaultData();
      showAuthScreen();
    }
    if (first) { first = false; resolveReady(); }
  });
}
boot();
