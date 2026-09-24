/* ============================================================
   store.js — Firestore-Speicherschicht
   ------------------------------------------------------------
   Die App arbeitet weiter mit EINEM Objekt "data" im Speicher.
   Diese Schicht bildet es auf einzelne Firestore-Dokumente ab
   und schreibt bei jedem Speichern nur die Dokumente, die sich
   wirklich geändert haben (Diff gegen den letzten Stand).

   ── FIRESTORE-LAYOUT (auch für Cypher) ───────────────────────
   users/{uid}                              Profil + kleine Daten
     { schema, email, xp, projects[], fitness{version, exercises[],
       templates[], plan{}, weeklyTarget}, _created, _updated }
   users/{uid}/workouts/{YYYY-MM-DD_<tplId>}
     { date, templateId, sets{ <exId>: [{kg, reps}] }, updatedAt }
   users/{uid}/weights/{YYYY-MM-DD}         { date, kg }
   users/{uid}/calendar/{YYYY-MM-DD}        { date, tasks[{id,text,done}] }

   Felder mit "_" am Anfang sind Server-Metadaten und gehören
   nicht zu den App-Daten.
   ============================================================ */

import { db, doc, collection, getDoc, getDocs, onSnapshot, writeBatch, serverTimestamp } from "./firebase.js";

export const SCHEMA = 1;
const SUBS = ["workouts", "weights", "calendar"];
const SAVE_DELAY_MS = 600;
const BATCH_LIMIT = 400;

/* ---------------- data <-> Dokumente ---------------- */

const clone = obj => JSON.parse(JSON.stringify(obj ?? null));
const stripMeta = obj => {
  if (!obj) return obj;
  const out = {};
  Object.keys(obj).forEach(k => { if (!k.startsWith("_")) out[k] = obj[k]; });
  return out;
};
const stableJSON = obj => JSON.stringify(sortKeys(obj));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}

/** data -> { root, workouts:{id:obj}, weights:{…}, calendar:{…} } */
export function splitData(data) {
  const f = data.fitness;
  const parts = {
    root: clone({
      schema: SCHEMA,
      xp: data.xp || 0,
      projects: data.projects || [],
      fitness: f ? {
        version: f.version, exercises: f.exercises, templates: f.templates,
        plan: f.plan, weeklyTarget: f.weeklyTarget, migratedAt: f.migratedAt || null,
      } : null,
    }),
    workouts: {}, weights: {}, calendar: {},
  };
  if (f) {
    Object.entries(f.workouts || {}).forEach(([k, w]) => { parts.workouts[k] = clone(w); });
    Object.entries(f.weights || {}).forEach(([d, kg]) => { parts.weights[d] = { date: d, kg }; });
  }
  Object.entries(data.calendar || {}).forEach(([d, tasks]) => {
    if (Array.isArray(tasks) && tasks.length) parts.calendar[d] = clone({ date: d, tasks });
  });
  return parts;
}

/** Dokumente -> data */
export function joinData(parts) {
  const r = parts.root || {};
  const data = { xp: r.xp || 0, projects: r.projects || [], calendar: {} };
  Object.entries(parts.calendar || {}).forEach(([d, c]) => { data.calendar[d] = c.tasks || []; });
  if (r.fitness) {
    data.fitness = { ...r.fitness, workouts: {}, weights: {} };
    Object.entries(parts.workouts || {}).forEach(([k, w]) => { data.fitness.workouts[k] = w; });
    Object.entries(parts.weights || {}).forEach(([d, w]) => { data.fitness.weights[d] = w.kg; });
  }
  return data;
}

/** Ein einzelnes Remote-Dokument in data übernehmen (für Live-Updates). */
function applyDoc(data, kind, id, obj) {
  if (kind === "root") {
    data.xp = obj.xp || 0;
    data.projects = obj.projects || [];
    if (obj.fitness) {
      const f = data.fitness || (data.fitness = { workouts: {}, weights: {} });
      Object.assign(f, obj.fitness);
    }
    return;
  }
  if (kind === "calendar") {
    if (obj) data.calendar[id] = obj.tasks || []; else delete data.calendar[id];
    return;
  }
  const f = data.fitness || (data.fitness = { workouts: {}, weights: {} });
  if (kind === "workouts") { if (obj) f.workouts[id] = obj; else delete f.workouts[id]; }
  if (kind === "weights") { if (obj) f.weights[id] = obj.kg; else delete f.weights[id]; }
}

/* ---------------- Sitzung ---------------- */

let s = null; // { uid, email, baseline: Map(path->json), timer, unsubs, getData, onRemoteChange, onStatus, pending }

const pathOf = (uid, kind, id) => (kind === "root" ? `users/${uid}` : `users/${uid}/${kind}/${id}`);
const refOf = (uid, kind, id) => (kind === "root" ? doc(db, "users", uid) : doc(db, "users", uid, kind, id));

function flattenParts(uid, parts) {
  const map = new Map();
  map.set(pathOf(uid, "root"), { kind: "root", id: null, obj: parts.root });
  SUBS.forEach(kind => Object.entries(parts[kind]).forEach(([id, obj]) => map.set(pathOf(uid, kind, id), { kind, id, obj })));
  return map;
}

function status(state, msg) { if (s && s.onStatus) s.onStatus(state, msg); }

export const isActive = () => !!s;

/**
 * Lädt alle Daten eines Nutzers. { exists:false }, wenn es noch kein
 * Nutzer-Dokument gibt (erstes Login -> Migration anbieten).
 */
export async function openSession(uid, email, { getData, onRemoteChange, onStatus }) {
  closeSessionSync();
  s = { uid, email, baseline: new Map(), timer: null, unsubs: [], getData, onRemoteChange, onStatus, pending: 0, live: false };

  const rootSnap = await getDoc(refOf(uid, "root"));
  if (!rootSnap.exists()) return { exists: false };

  const parts = { root: stripMeta(rootSnap.data()), workouts: {}, weights: {}, calendar: {} };
  await Promise.all(SUBS.map(async kind => {
    const qs = await getDocs(collection(db, "users", uid, kind));
    qs.forEach(d => { parts[kind][d.id] = stripMeta(d.data()); });
  }));
  flattenParts(uid, parts).forEach((v, path) => s.baseline.set(path, stableJSON(v.obj)));
  status(rootSnap.metadata.fromCache ? "offline" : "saved");
  return { exists: true, data: joinData(parts) };
}

/** Erstes Login: alle Daten als neues Konto anlegen. */
export async function createUserData(data) {
  if (!s) throw new Error("Keine Sitzung");
  const parts = splitData(data);
  const entries = [...flattenParts(s.uid, parts).entries()];
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    entries.slice(i, i + BATCH_LIMIT).forEach(([path, { kind, id, obj }]) => {
      const payload = kind === "root"
        ? { ...obj, email: s.email, _created: serverTimestamp(), _updated: serverTimestamp() }
        : obj;
      batch.set(refOf(s.uid, kind, id), payload);
      s.baseline.set(path, stableJSON(obj));
    });
    await batch.commit();
  }
  status("saved");
}

/** Live-Updates von anderen Geräten empfangen. */
export function startLive() {
  if (!s || s.live) return;
  s.live = true;
  const uid = s.uid;

  const handle = (kind, id, obj) => {
    const path = pathOf(uid, kind, id);
    const json = obj ? stableJSON(obj) : null;
    if (json === (s.baseline.get(path) ?? null)) return false;
    if (json === null) s.baseline.delete(path); else s.baseline.set(path, json);
    applyDoc(s.getData(), kind, id, obj);
    return true;
  };

  s.unsubs.push(onSnapshot(refOf(uid, "root"), { includeMetadataChanges: false }, snap => {
    if (!s || snap.metadata.hasPendingWrites || !snap.exists()) return;
    if (handle("root", null, stripMeta(snap.data()))) s.onRemoteChange();
  }, err => status("error", err.message)));

  SUBS.forEach(kind => {
    s.unsubs.push(onSnapshot(collection(db, "users", uid, kind), qs => {
      if (!s) return;
      let changed = false;
      qs.docChanges().forEach(ch => {
        if (ch.doc.metadata.hasPendingWrites) return;
        const obj = ch.type === "removed" ? null : stripMeta(ch.doc.data());
        if (handle(kind, ch.doc.id, obj)) changed = true;
      });
      if (changed) s.onRemoteChange();
    }, err => status("error", err.message)));
  });
}

/** Speichern anstossen (gebündelt). */
export function queueSave() {
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => { flush(); }, SAVE_DELAY_MS);
  status("pending");
}

/** Geänderte Dokumente sofort schreiben. */
export async function flush() {
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = null;
  const current = flattenParts(s.uid, splitData(s.getData()));
  const ops = [];
  current.forEach((v, path) => {
    const json = stableJSON(v.obj);
    if (s.baseline.get(path) !== json) { ops.push({ type: "set", path, ...v }); s.baseline.set(path, json); }
  });
  [...s.baseline.keys()].forEach(path => {
    if (!current.has(path)) {
      const parts = path.split("/");
      ops.push({ type: "delete", path, kind: parts[2], id: parts[3] });
      s.baseline.delete(path);
    }
  });
  if (!ops.length) { if (!s.pending) status(navigator.onLine ? "saved" : "offline"); return; }

  status(navigator.onLine ? "saving" : "offline");
  const uid = s.uid;
  const commits = [];
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_LIMIT).forEach(op => {
      const ref = refOf(uid, op.kind, op.id);
      if (op.type === "delete") batch.delete(ref);
      else if (op.kind === "root") batch.update(ref, { ...op.obj, _updated: serverTimestamp() });
      else batch.set(ref, op.obj);
    });
    commits.push(batch.commit());
  }
  // Mit Offline-Cache ist lokal sofort gespeichert; das Promise endet erst bei Server-Bestätigung.
  s.pending++;
  const session = s;
  try {
    await Promise.all(commits);
    if (s === session) { s.pending--; if (!s.pending && !s.timer) status("saved"); }
  } catch (e) {
    console.error("Speichern fehlgeschlagen", e);
    if (s === session) {
      s.pending--;
      // Stand neu vergleichen lassen, damit nichts verloren geht
      ops.forEach(op => s.baseline.delete(op.path));
      status("error", e.code === "permission-denied" ? "Keine Berechtigung (Firestore-Regeln prüfen)" : e.message);
    }
  }
}

function closeSessionSync() {
  if (!s) return;
  clearTimeout(s.timer);
  s.unsubs.forEach(u => { try { u(); } catch (e) { /* egal */ } });
  s = null;
}

/** Beim Abmelden: Offenes noch schreiben, Listener beenden. */
export async function closeSession() {
  if (!s) return;
  const pendingFlush = s.timer ? flush() : null;
  closeSessionSync();
  if (pendingFlush) { try { await pendingFlush; } catch (e) { /* Offline-Cache übernimmt */ } }
}

// Beim Wegwischen der App sofort speichern
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && s && s.timer) flush();
});
window.addEventListener("online", () => { if (s) status(s.pending ? "saving" : "saved"); });
window.addEventListener("offline", () => { if (s) status("offline"); });
