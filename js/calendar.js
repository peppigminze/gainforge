/* ============================================================
   calendar.js — Tagesplaner
   data.calendar = { "YYYY-MM-DD": [{ id, text, done }] }
   Offene Aufgaben vergangener Tage (14 Tage zurück) werden als
   "von früher" angezeigt und lassen sich nach heute holen.
   ============================================================ */
import { ctx, changed, uid } from "./core.js";
import { openSheet, refreshSheet, currentSheetId, setHeader } from "./ui/sheet.js";
import { esc, ICONS } from "./ui/fx.js";
import { todayKey, addDays, mondayOf, isoWeek, weekday, DOW_SHORT, DOW_LONG, formatShort, formatDate, isDayKey } from "./dates.js";

const XP_TASK = 10;
const LOOKBACK_DAYS = 14;
const cal = () => { const d = ctx.getData(); if (!d.calendar || typeof d.calendar !== "object") d.calendar = {}; return d.calendar; };
const day = date => cal()[date] || [];

function commit(xp = 0, detail = {}) { ctx.save(); if (xp) ctx.addXP(xp); changed("calendar", detail); }
function clean(date) { if (cal()[date] && !cal()[date].length) delete cal()[date]; }

/** Offene Aufgaben der letzten 14 Tage vor heute. */
export function overdue(today = todayKey()) {
  const out = [];
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = addDays(today, -i);
    day(d).forEach(t => { if (!t.done) out.push({ date: d, task: t }); });
  }
  return out;
}

/* ---------------- Befehle ---------------- */
export const calendar = {
  tasks: date => day(date),
  addTask(date, text) {
    const x = String(text || "").trim(); if (!x || !isDayKey(date)) return;
    (cal()[date] = cal()[date] || []).push({ id: uid("d"), text: x, done: false }); commit();
  },
  toggleTask(date, id) { const t = day(date).find(z => z.id === id); if (!t) return; t.done = !t.done; commit(t.done ? XP_TASK : -XP_TASK); },
  renameTask(date, id, text) { const t = day(date).find(z => z.id === id); const x = String(text || "").trim(); if (t && x) { t.text = x; commit(0, { soft: true }); } },
  removeTask(date, id) { const t = day(date).find(z => z.id === id); if (!t) return; cal()[date] = day(date).filter(z => z !== t); clean(date); commit(t.done ? -XP_TASK : 0); },
  moveTask(date, id, toDate) {
    const t = day(date).find(z => z.id === id); if (!t || !isDayKey(toDate) || toDate === date) return;
    cal()[date] = day(date).filter(z => z !== t); clean(date);
    (cal()[toDate] = cal()[toDate] || []).push(t); commit();
  },
  /** Alle offenen Aufgaben der letzten 14 Tage nach heute holen. */
  carryOver(today = todayKey()) {
    const items = overdue(today);
    items.forEach(({ date, task }) => {
      cal()[date] = day(date).filter(z => z !== task); clean(date);
      (cal()[today] = cal()[today] || []).push(task);
    });
    if (items.length) commit();
    return items.length;
  },
};

/* ---------------- Kachel ---------------- */
export function renderTodayTile() {
  const today = todayKey();
  const tasks = day(today);
  const open = tasks.filter(t => !t.done);
  const late = overdue(today);
  const shown = [...open, ...tasks.filter(t => t.done)].slice(0, 3);
  document.getElementById("tileToday").innerHTML = `
    ${ICONS.calendar}
    <span class="t-cat"><span class="dot"></span>Heute · ${DOW_SHORT[weekday(today)]} ${formatShort(today)}</span>
    ${shown.length
      ? `<ul class="t-list">${shown.map(t => `<li class="${t.done ? "done" : ""}">${esc(t.text)}</li>`).join("")}</ul>`
      : `<span class="t-sub">Nichts geplant. Tippen, um Aufgaben einzutragen.</span>`}
    <span class="t-foot">
      <span>${open.length} offen · ${tasks.length - open.length} erledigt</span>
      ${late.length ? `<span class="t-state st-warn" style="margin-left:auto">${late.length} von früher</span>` : ""}
    </span>`;
}

/* ---------------- Detail-Panel ---------------- */
let sel = todayKey();

export function openCalendar(date = todayKey()) {
  sel = date;
  openSheet({ id: "calendar", cat: "Planer", title: title(), sub: sub(), bind: bindCalendar, render: renderCalendar });
}
export function refreshCalendarSheet() {
  if (currentSheetId() !== "calendar") return;
  setHeader({ title: title(), sub: sub() });
  refreshSheet();
}
const title = () => `${DOW_LONG[weekday(sel)]}, ${formatShort(sel)}`;
const sub = () => `KW ${isoWeek(sel)}${sel === todayKey() ? " · heute" : ""}`;

function renderCalendar(body) {
  const today = todayKey();
  const monday = mondayOf(sel);
  const tasks = day(sel);
  const late = sel === today ? overdue(today) : [];
  body.innerHTML = `
    <div class="week">
      <button type="button" class="ico" data-act="prev-week" aria-label="Vorherige Woche">‹</button>
      ${Array.from({ length: 7 }, (_, i) => {
        const d = addDays(monday, i);
        const t = day(d);
        const has = t.length > 0;
        const isLate = d < today && t.some(x => !x.done);
        return `<button type="button" class="day ${d === today ? "today" : ""} ${d === sel ? "sel" : ""} ${has ? "has" : ""} ${isLate ? "late" : ""}" data-date="${d}">
          <span class="dw">${DOW_SHORT[i]}</span><span class="dn">${+d.slice(8)}</span><span class="dd"></span></button>`;
      }).join("")}
      <button type="button" class="ico" data-act="next-week" aria-label="Nächste Woche">›</button>
    </div>
    ${sel !== today ? `<button type="button" class="link" data-act="today">Zu heute springen</button>` : ""}
    ${late.length ? `<div class="carry"><span>${late.length} offene Aufgabe${late.length === 1 ? "" : "n"} von früheren Tagen</span><button type="button" class="btn small" data-act="carry">Nach heute holen</button></div>` : ""}
    <div class="psec">Aufgaben</div>
    <div class="rows">
      ${tasks.map(t => `<div class="task ${t.done ? "done" : ""}" data-id="${esc(t.id)}"><div class="task-row">
        <button type="button" class="chk ${t.done ? "on" : ""}" data-act="toggle" aria-label="Erledigt"><i></i></button>
        <input class="name-in" data-edit="1" value="${esc(t.text)}" aria-label="Aufgabe">
        ${sel < today && !t.done ? `<button type="button" class="sub-count" data-act="to-today">→ heute</button>` : ""}
        <button type="button" class="ico del" data-act="del" aria-label="Löschen">✕</button>
      </div></div>`).join("") || `<div class="empty">Keine Aufgaben für ${sel === today ? "heute" : formatDate(sel)}.</div>`}
      <form class="add-row" data-form="add">
        <input class="field" placeholder="Neue Aufgabe" enterkeyhint="done">
        <button class="btn small" type="submit">+</button>
      </form>
    </div>`;
}

function bindCalendar(body) {
  body.addEventListener("click", e => {
    const d = e.target.closest(".day");
    if (d) { sel = d.dataset.date; refreshCalendarSheet(); return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest("[data-id]") && b.closest("[data-id]").dataset.id;
    switch (b.dataset.act) {
      case "prev-week": sel = addDays(sel, -7); refreshCalendarSheet(); break;
      case "next-week": sel = addDays(sel, 7); refreshCalendarSheet(); break;
      case "today": sel = todayKey(); refreshCalendarSheet(); break;
      case "carry": calendar.carryOver(); break;
      case "toggle": calendar.toggleTask(sel, id); break;
      case "to-today": calendar.moveTask(sel, id, todayKey()); break;
      case "del": calendar.removeTask(sel, id); break;
    }
  });
  body.addEventListener("change", e => {
    if (e.target.dataset.edit) calendar.renameTask(sel, e.target.closest("[data-id]").dataset.id, e.target.value);
  });
  body.addEventListener("submit", e => {
    e.preventDefault();
    calendar.addTask(sel, e.target.querySelector("input").value);
    const next = body.querySelector('[data-form="add"] input'); if (next) next.focus();
  });
}
