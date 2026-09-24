/* ============================================================
   ui/terminal.js — Terminal-Overlay + Befehlsregister
   ------------------------------------------------------------
   registerCommand("name", { aliases, usage, help, run(args, io) })
   runCommand("gewicht 78.6") führt einen Befehl aus — dieselbe
   Schnittstelle kann später Cypher nutzen (Text -> Aktion).
   ============================================================ */

const commands = new Map();
const aliases = new Map();
const $ = id => document.getElementById(id);
const hist = [];
let histIdx = -1;

export function registerCommand(name, spec) {
  commands.set(name, { name, ...spec });
  (spec.aliases || []).forEach(a => aliases.set(a, name));
}
export const listCommands = () => [...commands.values()];

function print(text, cls = "") {
  const out = $("tOut");
  String(text).split("\n").forEach(line => {
    const d = document.createElement("div");
    d.className = "tl " + cls;
    d.textContent = line;
    out.appendChild(d);
  });
  out.scrollTop = out.scrollHeight;
}
const io = { print, ok: t => print(t, "ok"), err: t => print(t, "err"), dim: t => print(t, "dim"), acc: t => print(t, "acc"), clear: () => { $("tOut").innerHTML = ""; }, close: () => closeTerminal() };

export async function runCommand(line) {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  const key = parts[0].toLowerCase();
  const cmd = commands.get(key) || commands.get(aliases.get(key));
  if (!cmd) { io.err(`Unbekannter Befehl: ${key} — "help" zeigt alle Befehle.`); return; }
  try { await cmd.run(parts.slice(1), io); }
  catch (e) { io.err(e.message || String(e)); }
}

export function openTerminal() {
  const t = $("term");
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("open"));
  if (!$("tOut").childElementCount) { io.acc("SILVAN.OS TERMINAL"); io.dim('Tipp "help" für alle Befehle.'); }
  setTimeout(() => $("tIn").focus(), 60);
}
export function closeTerminal() {
  const t = $("term");
  t.classList.remove("open");
  $("tIn").blur();
  setTimeout(() => { if (!t.classList.contains("open")) t.hidden = true; }, 400);
}

$("termClose").addEventListener("click", closeTerminal);
$("tForm").addEventListener("submit", async e => {
  e.preventDefault();
  const line = $("tIn").value;
  $("tIn").value = "";
  if (!line.trim()) return;
  hist.unshift(line); histIdx = -1;
  print("> " + line, "echo");
  await runCommand(line);
});
$("tIn").addEventListener("keydown", e => {
  if (e.key === "ArrowUp" && hist.length) { histIdx = Math.min(hist.length - 1, histIdx + 1); $("tIn").value = hist[histIdx]; e.preventDefault(); }
  if (e.key === "ArrowDown") { histIdx = Math.max(-1, histIdx - 1); $("tIn").value = histIdx >= 0 ? hist[histIdx] : ""; e.preventDefault(); }
  if (e.key === "Escape") closeTerminal();
});

registerCommand("help", {
  aliases: ["?", "hilfe"], help: "alle Befehle anzeigen",
  run: (_, io) => listCommands().forEach(c => io.print(`${(c.usage || c.name).padEnd(24)} ${c.help || ""}`)),
});
registerCommand("clear", { aliases: ["cls"], help: "Ausgabe leeren", run: (_, io) => io.clear() });
registerCommand("exit", { aliases: ["q"], help: "Terminal schliessen", run: (_, io) => io.close() });
