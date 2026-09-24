/* ============================================================
   ui/sheet.js — Detail-Panel (Handy: Bottom-Sheet, Desktop: rechts)
   ------------------------------------------------------------
   openSheet({ id, cat, title, sub, full, actions, back, bind, render })
     bind(body)   einmal pro Öffnen: Event-Listener (Delegation)
     render(body) Inhalt zeichnen; refreshSheet() ruft es erneut auf
   Zurück-Geste (Android/iOS) schliesst das Panel statt die App.
   ============================================================ */

const $ = id => document.getElementById(id);
let current = null;
let historyPushed = false;

export const currentSheetId = () => (current ? current.id : null);
export const sheetBody = () => $("sheetBody");

export function openSheet(cfg) {
  const sheet = $("sheet");
  const wasOpen = !!current;
  current = cfg;

  // frischer Body = alte Listener weg
  const old = $("sheetBody");
  const body = old.cloneNode(false);
  old.replaceWith(body);

  setHeader(cfg);
  $("sheetBack").hidden = !cfg.back;
  const act = $("sheetActions");
  act.innerHTML = "";
  (cfg.actions || []).forEach(a => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn small"; b.textContent = a.label;
    b.addEventListener("click", a.onClick);
    act.appendChild(b);
  });

  sheet.classList.toggle("full", !!cfg.full);
  if (cfg.bind) cfg.bind(body);
  if (cfg.render) cfg.render(body);
  body.scrollTop = 0;

  sheet.hidden = false;
  $("scrim").hidden = false;
  document.body.classList.add("lock");
  sheet.classList.remove("anim");
  void sheet.offsetWidth; // Animation neu starten
  sheet.classList.add("anim");
  requestAnimationFrame(() => { sheet.classList.add("open"); $("scrim").classList.add("on"); });

  if (!wasOpen && !historyPushed) { history.pushState({ sheet: true }, ""); historyPushed = true; }
}

export function setHeader({ cat, title, sub }) {
  if (cat !== undefined) $("sheetCat").textContent = cat;
  if (title !== undefined) $("sheetTitle").textContent = title;
  if (sub !== undefined) $("sheetSub").textContent = sub;
}

export function refreshSheet() {
  if (!current || !current.render) return;
  const body = $("sheetBody");
  const top = body.scrollTop;
  current.render(body);
  body.scrollTop = top;
}

export function closeSheet(fromPop = false) {
  if (!current) return;
  const cfg = current;
  current = null;
  const sheet = $("sheet");
  sheet.classList.remove("open");
  sheet.style.transform = "";
  $("scrim").classList.remove("on");
  document.body.classList.remove("lock");
  setTimeout(() => { if (!current) { sheet.hidden = true; $("scrim").hidden = true; } }, 450);
  if (cfg.onClose) cfg.onClose();
  if (historyPushed) { historyPushed = false; if (!fromPop) history.back(); }
}

/* ---------- Schliessen: X, Scrim, Escape, Zurück-Geste, Wischen ---------- */
$("sheetClose").addEventListener("click", () => closeSheet());
$("scrim").addEventListener("click", () => closeSheet());
$("sheetBack").addEventListener("click", () => { if (current && current.back) current.back(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && current) closeSheet(); });
window.addEventListener("popstate", () => { if (current) { historyPushed = false; closeSheet(true); } });

(function swipeToClose() {
  const sheet = $("sheet");
  const handle = sheet.querySelector(".phead");
  let y0 = null, dy = 0;
  const start = e => {
    if (window.matchMedia("(min-width:760px)").matches) return;
    if (e.target.closest("button")) return;
    y0 = e.touches[0].clientY; dy = 0; sheet.classList.add("dragging");
  };
  const move = e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 === null) return;
    sheet.classList.remove("dragging");
    y0 = null;
    if (dy > 90) closeSheet(); else sheet.style.transform = "";
  };
  [handle, sheet.querySelector(".grab")].forEach(el => {
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
  });
})();
