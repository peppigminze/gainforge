/* ============================================================
   dates.js — robuste Kalendertag-Logik
   ------------------------------------------------------------
   Regel: Gespeichert wird ein Tag IMMER nur als String
   "YYYY-MM-DD" (= "DayKey"). Gerechnet wird mit ganzzahligen
   UTC-Tagesnummern. Dadurch können Zeitzonen, Sommerzeit oder
   new Date("2026-09-24") (= UTC-Mitternacht!) einen Eintrag nie
   auf einen anderen Tag verschieben.
   ============================================================ */

const MS_PER_DAY = 86400000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DOW_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const DOW_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const pad = n => String(n).padStart(2, "0");

/** Heutiger Kalendertag in LOKALER Zeit (das Datum, das du auf dem Handy siehst). */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Prüft, ob ein String ein echter Kalendertag ist (z.B. kein 2026-02-31). */
export function isDayKey(s) {
  if (typeof s !== "string") return false;
  const m = KEY_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Wandelt beliebige Altformate in einen DayKey um (für Migration). */
export function toDayKey(value) {
  if (value instanceof Date && !isNaN(value)) return todayKey(value);
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return isDayKey(head) ? head : null;
}

/** DayKey -> fortlaufende Tagesnummer (Tage seit 1970-01-01, UTC). */
export function dayNum(key) {
  const m = KEY_RE.exec(key);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY);
}

/** Tagesnummer -> DayKey. */
export function keyFromDayNum(n) {
  const d = new Date(n * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const addDays = (key, n) => keyFromDayNum(dayNum(key) + n);
export const diffDays = (fromKey, toKey) => dayNum(toKey) - dayNum(fromKey);

/** Wochentag, Montag = 0 … Sonntag = 6. */
export function weekday(key) {
  return (new Date(dayNum(key) * MS_PER_DAY).getUTCDay() + 6) % 7;
}
export const mondayOf = key => addDays(key, -weekday(key));

/** Monate addieren, Tag wird ans Monatsende geklemmt (31.01. + 1 Monat = 28./29.02.). */
export function addMonths(key, months) {
  const m = KEY_RE.exec(key);
  const y = +m[1], mo = +m[2] - 1 + months, d = +m[3];
  const target = new Date(Date.UTC(y, mo, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return keyFromDayNum(Math.round(target.getTime() / MS_PER_DAY));
}

/** ISO-Kalenderwoche. */
export function isoWeek(key) {
  const thursday = addDays(key, 3 - weekday(key));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(yearStart, thursday) / 7) + 1;
}

export function formatShort(key) {           // 24.09.
  return `${key.slice(8, 10)}.${key.slice(5, 7)}.`;
}
export function formatDate(key) {            // 24.09.2026
  return `${formatShort(key)}${key.slice(0, 4)}`;
}
export function formatLong(key) {            // Do, 24.09.2026
  return `${DOW_SHORT[weekday(key)]}, ${formatDate(key)}`;
}
export const formatDayNum = n => formatShort(keyFromDayNum(n));
