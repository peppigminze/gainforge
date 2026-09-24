/* ============================================================
   cypher.js — Andockstelle für den Assistenten "Cypher"
   ------------------------------------------------------------
   Die Blase unten rechts ist reserviert und inaktiv, bis sich
   Cypher verbindet:
     GAINFORGE.cypher.attach(async (text, api) => "Antwort", { name: "Cypher" })
   api = { actions: listActions(), tools: toolSchemas(), call(name, args) }
   Der Handler bekommt den Text aus dem Chat und darf über api.call()
   jede Aktion aus js/actions.js ausführen. Details: docs/CYPHER.md
   ============================================================ */
import { openSheet, refreshSheet, currentSheetId, setHeader } from "./ui/sheet.js";
import { listActions, toolSchemas, callAction } from "./actions.js";
import { esc, toast } from "./ui/fx.js";

let handler = null;
let busy = false;
const log = [];
const api = { get actions() { return listActions(); }, get tools() { return toolSchemas(); }, call: callAction };

function setState() {
  const el = document.getElementById("cypherSlot");
  el.dataset.state = busy ? "busy" : handler ? "online" : "offline";
  el.setAttribute("aria-label", handler ? "Cypher öffnen" : "Cypher (noch nicht verbunden)");
}

export const cypher = {
  /** Cypher verbinden. handler(text, api) -> string | Promise<string> */
  attach(fn, opts = {}) {
    if (typeof fn !== "function") throw new Error("attach(handler) erwartet eine Funktion");
    handler = fn;
    cypher.name = opts.name || "Cypher";
    setState();
    if (currentSheetId() === "cypher") openCypher();
    return true;
  },
  detach() { handler = null; setState(); if (currentSheetId() === "cypher") openCypher(); },
  isOnline: () => !!handler,
  api,
  name: "Cypher",
};

export function initCypher() {
  setState();
  document.getElementById("cypherSlot").addEventListener("click", openCypher);
}

function openCypher() {
  openSheet({
    id: "cypher", cat: "Assistent", title: cypher.name,
    sub: handler ? "verbunden" : "noch nicht verbunden",
    bind: bindCypher, render: renderCypher,
  });
  if (handler) setTimeout(() => { const i = document.querySelector("#sheetBody [data-cy-in]"); if (i) i.focus(); }, 450);
}

function renderCypher(body) {
  const acts = listActions();
  if (!handler) {
    const reads = acts.filter(a => a.kind === "read").length;
    body.innerHTML = `
      <div class="callout"><b>Platz reserviert</b>Hier wird Cypher andocken: per Sprache oder Text Gewicht loggen, Sätze eintragen, Aufgaben planen und Fragen zum Fortschritt stellen.</div>
      <div class="psec">Bereit für Cypher</div>
      <div class="kv">
        <div><b>Aktionen</b><span class="hl">${acts.length}</span><em>${reads} lesen · ${acts.length - reads} schreiben</em></div>
        <div><b>Format</b><span>Tools</span><em>Claude-API</em></div>
        <div><b>Status</b><span style="color:var(--warn)">offline</span><em>kein Handler</em></div>
      </div>
      <div class="psec">Verfügbare Aktionen</div>
      <div class="act-list">${acts.map(a => `<code>${esc(a.name)}</code>${a.destructive ? " ⚠" : ""} ${esc(a.description)}`).join("<br>")}</div>
      <p class="hint">Testen ohne Cypher: im Terminal <code>call fitness_status</code>. Doku: docs/CYPHER.md im Repo.</p>`;
    return;
  }
  body.innerHTML = `
    <div class="chat">${log.map(m => `<div class="${m.from === "u" ? "msg-u" : "msg-c"} ${m.err ? "err" : ""}">${esc(m.text)}</div>`).join("") || `<div class="empty">Frag ${esc(cypher.name)} etwas, z.B. „Wie läuft der Bulk?“</div>`}
    ${busy ? `<div class="msg-c">…</div>` : ""}</div>
    <form class="add-row" data-cy-form style="padding:14px 0 0">
      <input class="field" data-cy-in placeholder="Nachricht an ${esc(cypher.name)}" enterkeyhint="send" autocomplete="off">
      <button class="btn small primary" type="submit" ${busy ? "disabled" : ""}>Senden</button>
    </form>`;
  body.scrollTop = body.scrollHeight;
}

function bindCypher(body) {
  body.addEventListener("submit", async e => {
    e.preventDefault();
    const input = body.querySelector("[data-cy-in]");
    const text = input.value.trim();
    if (!text || !handler || busy) return;
    log.push({ from: "u", text });
    busy = true; setState(); refreshSheet();
    try {
      const reply = await handler(text, api);
      log.push({ from: "c", text: String(reply ?? "") });
    } catch (err) {
      log.push({ from: "c", text: err.message || String(err), err: true });
    } finally {
      busy = false; setState();
      if (currentSheetId() === "cypher") { refreshSheet(); const i = document.querySelector("#sheetBody [data-cy-in]"); if (i) i.focus(); }
      else toast(`${cypher.name} hat geantwortet`);
    }
  });
}
