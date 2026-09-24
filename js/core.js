/* ============================================================
   core.js — gemeinsamer Kontext für alle Module
   app.js setzt getData/save/addXP; Module melden Änderungen
   über changed(scope), app.js zeichnet dann die Kacheln neu.
   ============================================================ */
export const ctx = {
  getData: () => ({}),
  save: () => {},
  addXP: () => {},
};
const listeners = new Set();
export function bindCore(c) { Object.assign(ctx, c); }
export function onChanged(fn) { listeners.add(fn); }
export function changed(scope, detail = {}) { listeners.forEach(fn => fn(scope, detail)); }
export const uid = prefix => prefix + "_" + Math.random().toString(36).slice(2, 9);
