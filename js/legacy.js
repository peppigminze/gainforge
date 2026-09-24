/* ============================================================
   legacy.js — alte lokale Daten (vor Firebase) finden
   ------------------------------------------------------------
   Die alte Version speicherte pro lokalem Konto unter
   "silvanos_data_v2::<id>" (bzw. ganz alt "silvanos_data_v2").
   Beim ersten Firebase-Login werden diese Datensätze zur Übernahme
   angeboten. Ein übernommener Datensatz wird als "claimed"
   markiert, damit er nicht versehentlich noch in ein zweites
   Konto (z.B. einer anderen Person am selben Gerät) wandert.
   Die Rohdaten bleiben als Backup im localStorage liegen.
   ============================================================ */

const DATA_PREFIX = "silvanos_data_v2";
const ACCOUNTS_KEY = "silvanos_accounts_v1";
const CLAIMED_KEY = "silvanos_legacy_claimed";

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}

export function summarize(d) {
  const f = d.fitness;
  const workouts = f && f.workouts ? Object.keys(f.workouts).length : (Array.isArray(d.workoutLog) ? d.workoutLog.length : 0);
  const weights = f && f.weights ? Object.keys(f.weights).length : (Array.isArray(d.weightLog) ? d.weightLog.length : 0);
  const projects = Array.isArray(d.projects) ? d.projects.length : 0;
  const calendarDays = d.calendar ? Object.values(d.calendar).filter(t => Array.isArray(t) && t.length).length : 0;
  return { workouts, weights, projects, calendarDays, xp: d.xp || 0 };
}

/** Alle noch nicht übernommenen alten Datensätze auf diesem Gerät. */
export function findLegacyDatasets() {
  const claimed = new Set(readJSON(CLAIMED_KEY, []));
  const accounts = readJSON(ACCOUNTS_KEY, []);
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DATA_PREFIX) || claimed.has(key)) continue;
    const d = readJSON(key, null);
    if (!d || typeof d !== "object") continue;
    const sum = summarize(d);
    if (!sum.workouts && !sum.weights && !sum.calendarDays && !sum.xp) continue;
    const accId = key.includes("::") ? key.split("::")[1] : null;
    const acc = accId && accounts.find(a => a.id === accId);
    out.push({ key, label: acc ? acc.email : "Alte Version (ohne Konto)", data: d, summary: sum });
  }
  return out.sort((a, b) => (b.summary.workouts + b.summary.weights) - (a.summary.workouts + a.summary.weights));
}

export function markClaimed(key) {
  const list = readJSON(CLAIMED_KEY, []);
  if (!list.includes(key)) list.push(key);
  localStorage.setItem(CLAIMED_KEY, JSON.stringify(list));
}

/** Alte GitHub-Tokens (Gist-Sync) vom Gerät entfernen — werden nicht mehr gebraucht. */
export function removeLegacyTokens() {
  const remove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("silvanos_sync_token") || key.startsWith("silvanos_sync_gistid"))) remove.push(key);
  }
  remove.forEach(k => localStorage.removeItem(k));
  localStorage.removeItem("silvanos_current_account");
  return remove.length;
}
