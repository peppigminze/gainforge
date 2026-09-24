/* ============================================================
   ui/fx.js — Boot-Sequenz, Reticle, Toast, kleine SVG-Grafiken
   ============================================================ */

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Boot-Sequenz mit Tipp-Effekt ----------
   lines: [[text, status]], ready: Promise (z.B. Login geprüft).
   Kurz gehalten (~1 s), damit der Start nicht bremst. */
export async function runBoot(lines, ready) {
  const box = document.getElementById("bootLines");
  const prog = document.getElementById("bootProg");
  const fast = reduced() || sessionStorage.getItem("silvanos_booted");
  const total = lines.length;
  for (let i = 0; i < total; i++) {
    const [text, status] = lines[i];
    const ln = document.createElement("div");
    ln.className = "ln";
    box.appendChild(ln);
    if (fast) ln.innerHTML = `${text} <b>${status}</b>`;
    else {
      for (let c = 1; c <= text.length; c += 2) { ln.textContent = text.slice(0, c); await sleep(9); }
      ln.innerHTML = `${text} <b>${status}</b>`;
    }
    prog.style.width = `${Math.round(((i + 1) / (total + 1)) * 100)}%`;
    if (!fast) await sleep(60);
  }
  await ready;
  prog.style.width = "100%";
  sessionStorage.setItem("silvanos_booted", "1");
  await sleep(fast ? 80 : 220);
  document.getElementById("boot").classList.add("done");
}

/* ---------- Reticle beim Antippen ---------- */
export function initReticle() {
  if (reduced()) return;
  document.addEventListener("pointerdown", e => {
    const t = e.target.closest(".tile, .btn, .ex-head, .seg button, .ib, .day");
    if (!t) return;
    const r = document.createElement("div");
    r.className = "ret";
    r.innerHTML = "<i></i><i></i><i></i><i></i>";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, { passive: true });
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "on " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 2400);
}

export function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

/* ---------- Mini-Grafiken ---------- */
export function sparkline(values, { w = 120, h = 34 } = {}) {
  if (values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [((i / (values.length - 1)) * (w - 4)) + 2, h - 3 - ((v - lo) / span) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return `<svg class="t-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--c)" stroke-width="1.6" vector-effect="non-scaling-stroke" opacity=".85"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="var(--c)"/></svg>`;
}

export function ring(pct, size = 46) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.min(1, Math.max(0, pct / 100)));
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--c)" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="filter:drop-shadow(0 0 4px var(--c))"/>
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Orbitron" font-size="10" font-weight="700">${Math.round(pct)}%</text></svg>`;
}

export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
