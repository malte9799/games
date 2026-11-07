// MÖRSER — a turn-based artillery duel for 2–4 online players (plus a practice cannon).
//
// Twilight battlefield: silhouetted hills, glowing shells and wind that you have to read.
// Drag from your cannon to set direction and strength, watch the dotted arc, and let fly —
// the last cannon standing wins. Its own look (it ignores the design picker); only the slim
// top bar is re-skinned, like Blackjack and Kritzel-Revier.
//
// Online play rides the site's WebRTC room (window.Multiplayer, see README.md). The whole
// shot is deterministic: terrain comes from a shared seed and the simulation only uses +,−,×,÷
// on a fixed step, so when the active player broadcasts "fire" (their launch velocity)
// every client computes the exact same flight, crater and damage — no per-shot round trip.

initGame({
  title: "Mörser",
  tag: "Wind · Winkel · Weite",
  fullscreen: true,
  presets: [
    { label: "Zugzeit 45 s",  values: [45] },
    { label: "Zugzeit 30 s",  values: [30] },
    { label: "Ohne Zeitlimit", values: [0] },
  ],
  buttons: [
    { id: "btn-new",   label: "Nochmal",   primary: true, onClick: () => again() },
    { id: "btn-aid",   label: "Hilfe: an", onClick: () => toggleAid() },
    { id: "btn-sound", label: "Ton: an",   onClick: () => toggleSound() },
  ],
  sliders: [],
  onPreset: ([s]) => { turnSecs = s; saveState(); syncPresetLabel(); if (mode !== "idle") note("Zugzeit gilt ab der nächsten Runde."); },
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gespielt",
    text: [
      "Du steuerst eine Kanone in der Dämmerung. Zieh vom Rohr weg (oder tippe) in die Richtung, in die du schießen willst — je weiter du ziehst, desto stärker der Schuss. Loslassen feuert.",
      "Der Wind drückt das Geschoss seitlich, der Einschlag reißt einen Krater in den Hügel und verletzt alles in der Nähe — auch dich selbst. Wer zuerst keine Trefferpunkte mehr hat, scheidet aus.",
      "Tasten: ← → zielen · ↑ ↓ Stärke · Leertaste schießen · N neue Runde · H Zielhilfe · M Ton.",
      "Online: über „Mehrspieler“ einen Raum öffnen und per Code, Link oder QR einladen (2–4 Spieler); der Host startet. Ohne Raum duellierst du gegen eine Übungskanone.",
    ],
  },
});

// ---- own look: load a condensed display font and re-skin the slim top bar ----
(function skin() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
  const s = document.createElement("style");
  s.textContent = `
    #ui-overlay { background: linear-gradient(180deg, rgba(20,16,40,.96), rgba(30,20,52,.96)) !important;
      border-bottom: 1px solid rgba(255,150,110,.35) !important; backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important; box-shadow: 0 6px 24px rgba(0,0,0,.5) !important; }
    #ui-overlay h2 { color: #ffd9c0 !important; font-family: Oswald, "Arial Narrow", sans-serif !important;
      letter-spacing: .16em !important; text-transform: uppercase !important; }
    #ui-overlay .back-link, #ui-overlay #status-text, #ui-overlay .hint-note { color: #c9b8d8 !important;
      font-family: Oswald, "Arial Narrow", sans-serif !important; }
    #ui-overlay .row.tight > button:not(.theme-btn) { font-family: Oswald, "Arial Narrow", sans-serif;
      font-weight: 600; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; color: #ffe9d8;
      background: linear-gradient(180deg, rgba(90,64,120,.55), rgba(50,36,74,.75)); border: 1px solid rgba(255,160,120,.4);
      border-radius: 9px; }
    #ui-overlay .row.tight > button:not(.theme-btn):hover { border-color: rgba(255,190,140,.85); }
    #ui-overlay .row.tight > button.primary { background: linear-gradient(180deg, #ff8a5c, #e0512f); border-color: #ffb489; color: #250c06; }
    #ui-overlay .row.tight > button:active { transform: translateY(1px); }
    #ui-overlay .row.tight > button.active { box-shadow: 0 0 0 2px rgba(120,220,200,.8) inset; }
    #ui-overlay .preset-row select { font-family: Oswald, "Arial Narrow", sans-serif; letter-spacing: .06em;
      color: #ffe9d8 !important; background-color: rgba(40,28,62,.9) !important; border: 1px solid rgba(255,160,120,.4) !important; }
    #ui-overlay .preset-row::after { border-color: #ffbe8c !important; }
    #ui-overlay .info-btn { background: rgba(60,42,88,.7) !important; color: #ffe9d8 !important; border: 1px solid rgba(255,160,120,.4) !important; }
  `;
  document.head.appendChild(s);
})();

// ============================================================ constants

const MF = "Oswald, 'Arial Narrow', sans-serif";

const FW = 960, FH = 540;              // fixed logical field — identical on every client
const COLW = 3, COLS = 320;           // terrain resolution (COLS * COLW = FW)
const GROUND_MIN = FH * 0.42;

const DT = 1 / 60;                    // one simulation tick
const SUBSTEPS = 2;                  // physics sub-steps per rendered frame
const DTS = DT / SUBSTEPS;
const GRAV = 300;                    // units / s²
const MAXSPEED = 650;                // launch speed at full power
const WIND_MAX = 62;                 // wind acceleration units / s²
const BLAST_R = 42;                  // crater radius
const MAXDMG = 52;
const TANK_R = 15;
const TANK_H = 22;
const SAFE_DROP = 26;
const MAXDRAG = 330;                 // field units of drag that map to full power
const MUZZLE = 20;

// the game's own palette (twilight silhouettes)
const C = {
  skyTop: [10, 9, 26], skyMid: [41, 26, 62], skyHorizon: [188, 92, 82], skyLow: [58, 28, 52],
  sun: [255, 186, 120], sunCore: [255, 236, 205],
  mtnFar: [46, 36, 70], mtnMid: [32, 25, 52], mtnNear: [21, 16, 37],
  land: [15, 12, 27], landDeep: [8, 7, 15], landEdge: [150, 150, 200],
  ink: [245, 238, 255], muted: [178, 168, 200],
  shell: [255, 246, 214], boom: [255, 240, 190], boomMid: [255, 150, 64], boomOut: [206, 58, 40],
  smoke: [70, 58, 80],
};
const TEAM = [
  { main: [255, 92, 84],  hi: [255, 178, 158], name: "Rot"    },
  { main: [86, 214, 196], hi: [182, 255, 244], name: "Türkis" },
  { main: [255, 198, 74], hi: [255, 238, 172], name: "Gold"   },
  { main: [186, 140, 255], hi: [228, 208, 255], name: "Violett" },
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ============================================================ state

let mode = "idle";                   // "idle" | "practice" | "mp"
let phase = "lobby";                 // "lobby" | "aim" | "fly" | "boom" | "over"
let seed = 1;
let turnSecs = 45;
let aidOn = true;
let soundOn = true;

let tanks = [];                      // { idx, id, name, you, ai, color, x, y, hp, alive, barrel }
let order = [];                      // tank ids in turn order
let turnPtr = 0;                     // index into tanks (order == tanks order)
let turnId = 0;                      // shot counter, used for wind + staleness
let windAcc = 0;
let heights = null;                  // Int32Array(COLS)

let aim = { ang: -Math.PI / 4, pow: 0.66 };
let dragging = false, dragPt = null;
let shell = null;                    // { x, y, vx, vy, age, skip, trail:[], col }
let boomTimer = 0, pendingOver = false, shake = 0;
let turnStartMs = 0, cdShownLast = -1;
let popups = [];                     // floating damage numbers
let shells = [];                     // small cosmetic sparks
let aiThink = 0;

let L = null;
let skyGrad = null, skyH = -1;
let ridgeFar = null, ridgeMid = null, ridgeNear = null;
let lobbyAt = 0;
let noteMsg = "", noteAt = 0;
let overRow = 0;

// ============================================================ persistence

function saveState() { saveSettings("moerser_state", { turnSecs, aid: aidOn, sound: soundOn }); }
function loadState() {
  const d = loadSettings("moerser_state");
  if ([0, 30, 45].includes(d.turnSecs)) turnSecs = d.turnSecs;
  if (typeof d.aid === "boolean") aidOn = d.aid;
  if (typeof d.sound === "boolean") soundOn = d.sound;
}

function note(msg) { flashNote(msg); noteMsg = msg || ""; noteAt = frameCount || 0; }

// ============================================================ random & terrain

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genTerrain(s) {
  const rng = mulberry32(s | 0);
  const base = new Float64Array(COLS);
  const octave = (points, amp, off) => {
    const ctrl = new Float64Array(points + 1);
    for (let i = 0; i <= points; i++) ctrl[i] = rng();
    for (let x = 0; x < COLS; x++) {
      const fx = (x / (COLS - 1)) * points;
      const j = Math.min(points - 1, Math.floor(fx));
      const t = fx - j;
      const sm = t * t * (3 - 2 * t);
      base[x] += amp * (ctrl[j] * (1 - sm) + ctrl[j + 1] * sm);
    }
  };
  octave(5, FH * 0.30, 0);
  octave(13, FH * 0.10, 1);
  octave(29, FH * 0.035, 2);
  const h = new Int32Array(COLS);
  for (let x = 0; x < COLS; x++) {
    const v = FH * 0.30 + base[x];          // base[x] already carries the offset
    h[x] = Math.max(GROUND_MIN, Math.min(FH - 10, Math.round(v)));
  }
  // soften one step so the surface never has razor spikes
  for (let k = 0; k < 2; k++)
    for (let x = 1; x < COLS - 1; x++)
      h[x] = Math.round((h[x - 1] + h[x] * 2 + h[x + 1]) / 4);
  return h;
}

function heightAt(x) {
  let c = Math.floor(x / COLW);
  if (c < 0) c = 0; else if (c >= COLS) c = COLS - 1;
  return heights[c];
}

function windAt(s, turn) {
  let h = (Math.imul(s | 0, 0x27d4eb2d) ^ Math.imul(turn | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  const r = ((h >>> 8) & 0xffff) / 65535;   // 0..1
  return Math.round((r * 2 - 1) * WIND_MAX * 10) / 10;
}

// ============================================================ match setup

function buildTanks(list) {
  tanks = [];
  const n = Math.max(1, list.length);
  const rng = mulberry32((seed ^ 0x9e3779b9) | 0);
  for (let i = 0; i < n; i++) {
    const p = list[i];
    const slotX = FW * ((i + 0.5) / n);
    const jit = (rng() - 0.5) * FW * 0.05;
    let x = Math.max(FW * 0.06, Math.min(FW * 0.94, slotX + jit));
    const tk = {
      idx: i, id: p.id, name: p.name || ("Spieler " + (i + 1)),
      you: !!p.you, ai: !!p.ai, color: TEAM[i % TEAM.length],
      x, y: 0, hp: 100, alive: true, barrel: -Math.PI / 4,
    };
    tk.y = heightAt(x);
    tanks.push(tk);
  }
  order = tanks.map((t) => t.id);
}

function beginMatch(newSeed, secs, list) {
  seed = newSeed | 0;
  if ([0, 30, 45].includes(secs)) turnSecs = secs;
  buildTanks(list);
  heights = genTerrain(seed);
  for (const tk of tanks) tk.y = heightAt(tk.x);
  turnId = 0; turnPtr = 0;
  windAcc = windAt(seed, turnId);
  shell = null; popups = []; shells = []; shake = 0; pendingOver = false; boomTimer = 0;
  overRow = 0; aiThink = 0;
  clearParticles();
  setTurnAim();
  phase = "aim";
  turnStartMs = millis();
  saveSnap();
}

function setTurnAim() {
  const tk = currentTank();
  if (!tk) return;
  // default to aiming at the enemies
  const toRight = tk.x < FW / 2;
  aim.ang = toRight ? -Math.PI / 4 : -Math.PI * 3 / 4;
  aim.pow = 0.66;
  tk.barrel = aim.ang;
  cdShownLast = -1;
}

function currentTank() { return tanks[turnPtr] || null; }
function aliveCount() { return tanks.reduce((n, t) => n + (t.alive ? 1 : 0), 0); }

function nextAliveIndex(from) {
  for (let k = 1; k <= tanks.length; k++) {
    const i = (from + k) % tanks.length;
    if (tanks[i].alive) return i;
  }
  return from;
}

function advanceTurn() {
  if (aliveCount() <= 1) { endMatch(); return; }
  turnId++;
  turnPtr = nextAliveIndex(turnPtr);
  windAcc = windAt(seed, turnId);
  setTurnAim();
  phase = "aim";
  turnStartMs = millis();
  aiThink = tanks[turnPtr].ai ? (1.1 + Math.random() * 0.8) : 0;
  saveSnap();
}

function endMatch() {
  phase = "over";
  overRow = 0;
  const w = tanks.filter((t) => t.alive);
  if (w.length) celebrate(3);
  saveSnap();
}

// ============================================================ physics

// The shell leaves from a fixed point so the physics never depends on trig
// (tk.barrel is cosmetic only — atan2/cos/sin are not bit-identical across engines).
function muzzleOf(tk) {
  return { x: tk.x, y: tk.y - TANK_H - 4 };
}

function tankHit(p) {
  for (const tk of tanks) {
    if (!tk.alive || tk.idx === p.skip) continue;
    const dx = p.x - tk.x, dy = p.y - (tk.y - TANK_H * 0.5);
    if (dx * dx + dy * dy < TANK_R * TANK_R) return tk;
  }
  return null;
}

// one physics sub-step; returns true when the shot has come to rest
function stepProj(p) {
  p.vx += windAcc * DTS;
  p.vy += GRAV * DTS;
  p.x += p.vx * DTS;
  p.y += p.vy * DTS;
  p.age += DTS;
  if (p.x <= 0 || p.x >= FW || p.y > FH + 40 || p.age > 9) { p.hit = true; return true; }
  const th = tankHit(p);
  if (th) { p.hit = true; p.tank = th; return true; }
  if (p.y >= heightAt(p.x)) { p.hit = true; return true; }
  return false;
}

// side-effect-free trace, used for the aim preview and by the AI
function traceShot(vx, vy, skipIdx) {
  const tk = tanks[skipIdx];
  const m = muzzleOf(tk);
  const p = { x: m.x, y: m.y, vx, vy, age: 0, skip: skipIdx };
  let guard = 0;
  while (!stepProj(p) && guard++ < 2000) {}
  return p;
}

function launch(vx, vy) {
  const tk = currentTank();
  if (!tk) return;
  tk.barrel = Math.atan2(vy, vx);
  const m = muzzleOf(tk);
  shell = { x: m.x, y: m.y, vx, vy, age: 0, skip: tk.idx, trail: [], col: tk.color.main };
  phase = "fly";
  sfxFire();
}

function fireAim() {
  if (phase !== "aim") return;
  const tk = currentTank();
  if (!tk || !tk.you) { note("Du bist nicht am Zug."); return; }
  const vx = Math.cos(aim.ang) * aim.pow * MAXSPEED;
  const vy = Math.sin(aim.ang) * aim.pow * MAXSPEED;
  launch(vx, vy);
  netOut("fire", { tc: turnId, vx, vy });
}

// ---- impact ----
function carve(ex, ey, r) {
  ex = Math.round(ex); ey = Math.round(ey);
  const c0 = Math.max(0, Math.floor((ex - r) / COLW));
  const c1 = Math.min(COLS - 1, Math.ceil((ex + r) / COLW));
  const r2 = r * r;
  for (let c = c0; c <= c1; c++) {
    const dx = c * COLW - ex;
    if (dx * dx > r2) continue;
    // deepest cut in this column, found with integer arithmetic only (deterministic)
    let dy = r;
    while (dx * dx + dy * dy > r2) dy--;
    const bottom = ey + dy + 1;
    if (bottom > heights[c]) heights[c] = Math.min(FH, bottom);
  }
}

function applyBlast(ex, ey) {
  carve(ex, ey, BLAST_R);
  const r2 = BLAST_R * BLAST_R;
  for (const tk of tanks) {
    if (!tk.alive) continue;
    const dx = tk.x - ex, dy = (tk.y - TANK_H * 0.5) - ey;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) {
      const dmg = Math.round(MAXDMG * (1 - d2 / r2));
      if (dmg > 0) hurt(tk, dmg);
    }
  }
  // settle: hills removed from under a tank make it fall
  for (const tk of tanks) {
    if (!tk.alive) continue;
    const surf = heightAt(tk.x);
    const drop = surf - tk.y;
    if (drop > SAFE_DROP) {
      const dmg = Math.round((drop - SAFE_DROP) * 0.5);
      tk.y = surf;
      if (dmg > 0) hurt(tk, dmg);
    } else if (drop > 0) tk.y = surf;
  }
}

function hurt(tk, dmg) {
  if (!tk.alive) return;
  tk.hp = Math.max(0, tk.hp - dmg);
  popups.push({ x: tk.x, y: tk.y - 46, txt: "-" + dmg, col: tk.color.hi, t: 0, vy: -24 });
  if (tk.hp <= 0) killTank(tk);
}

function killTank(tk) {
  tk.alive = false;
  for (let k = 0; k < 26; k++)
    addParticle({ x: sxy(tk.x, tk.y - 10).x, y: sxy(tk.x, tk.y - 10).y, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5, life: 90, size: 3 + Math.random() * 4, col: tk.color.main, decay: 3 });
  sfxDeath();
}

function resolveImpact(hx, hy) {
  applyBlast(hx, hy);
  shake = Math.max(shake, 12);
  // visuals: fire + smoke + debris
  const scr = sxy(hx, hy);
  spawnBurst(scr.x, scr.y, { count: 26, speed: [1.4, 6.5], life: [70, 200], size: [3, 9], col: C.boomMid, decay: 3.4 });
  spawnBurst(scr.x, scr.y, { count: 16, speed: [0.6, 3.4], life: [120, 260], size: [6, 14], col: C.smoke, decay: 1.6 });
  spawnBurst(scr.x, scr.y, { count: 14, speed: [2, 7], life: [50, 130], size: [2, 5], col: C.boom, decay: 5 });
  sfxBoom();
  shells.push({ x: hx, y: hy, r: 4, life: 1 });
  boomTimer = 0.55;
  pendingOver = aliveCount() <= 1;
  phase = "boom";
  saveSnap();
}

function finishImpact() {
  if (pendingOver) { endMatch(); return; }
  advanceTurn();
}

function maybeEndAfterLeave() {
  if (phase === "over" || phase === "lobby") return;
  if (aliveCount() <= 1) { endMatch(); }
}

// ============================================================ multiplayer

let MP = window.Multiplayer;

if (MP) {
  MP.configure({
    game: "moerser",
    min: 2, max: 4,
    startOptions: () => ({ seed: (Math.random() * 1e9) | 0, secs: turnSecs }),
  });
  const row = document.querySelector("#ui-overlay .row.tight");
  if (row) MP.mountButton(row);
  MP.on("start", (ev) => onStart(ev));
  MP.on("end", () => {
    mode = MP.state && MP.players.length ? "mp" : "idle";
    phase = "lobby";
    lobbyAt = millis();
    note("Zurück in der Lobby.");
  });
  MP.on("leave", (p) => onPeerLeave(p.id));
  MP.on("host", (h) => { if (h.you) note("Du bist jetzt der Host."); });
  MP.on("close", (c) => {
    if (mode !== "mp") return;
    mode = "practice";
    startPractice();
    note(c && c.reason === "left" ? "Raum verlassen — Übung gegen die Kanone." : "Verbindung getrennt — Übung gegen die Kanone.");
  });
  MP.openFromUrl();
}
wireNet();

function netOut(type, d) {
  if (!MP || !MP.connected) return;
  if (MP.isHost) MP.send(type, d);
  else MP.send(type, d, MP.state && MP.state.hostId);
}
function relayFromHost(from, type, d) {
  if (!MP || !MP.isHost) return;
  for (const t of tanks) {
    if (t.you || t.id === from) continue;
    MP.send("r" + type, { id: from, d }, t.id);
  }
}

function wireNet() {
  if (!MP) return;
  MP.onMessage("fire", (m) => { onNetFire(m.data); relayFromHost(m.from, "fire", m.data); });
  MP.onMessage("rfire", (m) => { if (!MP.isHost && m.data) onNetFire(m.data.d); });
  MP.onMessage("rematch", (m) => { if (m.data) onRematch(m.data); });
  MP.onMessage("rrematch", (m) => { if (!MP.isHost && m.data) onRematch(m.data.d); });
  MP.onMessage("sync", (m) => { if (MP.isHost) { const st = snapshot(); if (st) netOut("state", st); } });
  MP.onMessage("state", (m) => { if (!MP.isHost && m.data) restore(m.data); });
  MP.onMessage("rstate", (m) => { if (!MP.isHost && m.data && m.data.d) restore(m.data.d); });
}

function onStart(ev) {
  const opts = ev.options || {};
  const list = (ev.players && ev.players.length ? ev.players : (MP ? MP.players : []));
  mode = "mp";
  const players = list.map((p, i) => ({ id: p.id, name: p.name || ("Spieler " + (i + 1)), you: !!p.you }));
  beginMatch(Number(opts.seed) || ((Math.random() * 1e9) | 0), opts.secs, players);
  if (ev.resumed) {
    if (MP.isHost) { const st = snapshot(); if (st) netOut("state", st); }
    else netOut("sync", {});
  }
}

function onNetFire(d) {
  if (mode !== "mp" || !d) return;
  if (Number(d.tc) !== turnId) return;             // stale or duplicated shot
  if (phase === "fly" || phase === "boom") return;
  const tk = currentTank();
  if (!tk) return;
  tk.barrel = Math.atan2(d.vy, d.vx);
  launch(Number(d.vx) || 0, Number(d.vy) || 0);
}

function onRematch(d) {
  if (!d) return;
  const list = tanks.map((t) => ({ id: t.id, name: t.name, you: t.you, ai: t.ai }));
  if (!list.length) return;
  beginMatch(Number(d.seed) | 0, d.secs, list);
}

function onPeerLeave(id) {
  const tk = tanks.find((t) => t.id === id);
  if (!tk || !tk.alive) return;
  tk.alive = false;
  note(tk.name + " hat den Kampf verlassen.");
  if (phase === "aim" && currentTank() && currentTank().id === id) advanceTurn();
  else maybeEndAfterLeave();
}

// ============================================================ snapshot (reload)

function snapKey() { return "moerser_g_" + (MP && MP.state ? MP.state.code : "solo"); }

function saveSnap() {
  if (phase === "lobby" || !heights || !tanks.length) return;
  try {
    sessionStorage.setItem(snapKey(), JSON.stringify({
      seed, mode, turnId, turnPtr, windAcc,
      heights: Array.from(heights),
      hp: tanks.map((t) => t.hp), alive: tanks.map((t) => t.alive),
      y: tanks.map((t) => Math.round(t.y)),
      phase,
    }));
  } catch {}
}

function snapshot() {
  if (!heights || !tanks.length) return null;
  return {
    seed, turnId, turnPtr, windAcc, phase: phase === "over" ? "over" : "aim",
    heights: Array.from(heights),
    hp: tanks.map((t) => t.hp), alive: tanks.map((t) => t.alive),
    y: tanks.map((t) => Math.round(t.y)),
  };
}

function restore(d) {
  if (!d || !heights || !tanks.length) return;
  if (d.heights && d.heights.length === COLS) heights = Int32Array.from(d.heights);
  if (Array.isArray(d.hp)) tanks.forEach((t, i) => { if (typeof d.hp[i] === "number") t.hp = d.hp[i]; });
  if (Array.isArray(d.alive)) tanks.forEach((t, i) => { if (typeof d.alive[i] === "boolean") t.alive = d.alive[i]; });
  if (Array.isArray(d.y)) tanks.forEach((t, i) => { if (typeof d.y[i] === "number" && t.alive) t.y = d.y[i]; });
  if (typeof d.turnId === "number") turnId = d.turnId;
  if (typeof d.turnPtr === "number") turnPtr = Math.max(0, Math.min(tanks.length - 1, d.turnPtr));
  if (typeof d.windAcc === "number") windAcc = d.windAcc;
  shell = null;
  if (aliveCount() <= 1 || d.phase === "over") endMatch();
  else {
    setTurnAim(); phase = "aim"; turnStartMs = millis();
    aiThink = tanks[turnPtr].ai ? (1.1 + Math.random() * 0.8) : 0;
  }
  note("Partie wiederhergestellt.");
}

function tryLocalRestore() {
  try {
    const d = JSON.parse(sessionStorage.getItem(snapKey()) || "null");
    if (d && d.seed === seed && d.heights && d.heights.length === COLS) restore(d);
  } catch {}
}

// ============================================================ practice

function startPractice() {
  mode = "practice";
  const list = [{ id: "you", name: "Du", you: true }, { id: "cpu", name: "Übungskanone" }];
  beginMatch((Math.random() * 1e9) | 0, turnSecs, list);
  note("Übungsduell — über „Mehrspieler“ mit Freunden spielen.");
}

// ============================================================ actions

function again() {
  if (mode === "mp" && MP && MP.connected) {
    if (phase !== "over") { note("Die Runde läuft noch."); return; }
    if (!MP.isHost) { note("Nur der Host startet die nächste Runde."); return; }
    const d = { seed: (Math.random() * 1e9) | 0, secs: turnSecs };
    netOut("rematch", d);
    onRematch(d);
    return;
  }
  startPractice();
}

function toggleAid() {
  aidOn = !aidOn;
  saveState();
  const b = document.getElementById("btn-aid");
  if (b) b.textContent = "Hilfe: " + (aidOn ? "an" : "aus");
  setButtonActive("btn-aid", aidOn);
}

function toggleSound() {
  soundOn = !soundOn;
  saveState();
  const b = document.getElementById("btn-sound");
  if (b) b.textContent = "Ton: " + (soundOn ? "an" : "aus");
  if (soundOn) sfxTick();
}

function syncPresetLabel() {
  const sel = document.getElementById("preset-select");
  const i = [45, 30, 0].indexOf(turnSecs);
  if (sel && i >= 0) sel.selectedIndex = i;
}

// ============================================================ AI

function aiFire() {
  const me = currentTank();
  if (!me || !me.ai) return;
  const foe = tanks.find((t) => t.alive && t.idx !== me.idx);
  const dir = me.x < FW / 2 ? 1 : -1;   // shoot toward the middle / the opponent
  let best = null;
  for (let a = 16; a <= 86; a += 4) {
    const rad = a * Math.PI / 180;
    for (let p = 32; p <= 100; p += 7) {
      const vx = dir * Math.cos(rad) * (p / 100) * MAXSPEED;
      const vy = -Math.sin(rad) * (p / 100) * MAXSPEED;
      const r = traceShot(vx, vy, me.idx);
      const d = foe ? Math.hypot(r.x - foe.x, r.y - (foe.y - TANK_H * 0.5)) : 0;
      if (!best || d < best.d) best = { d, vx, vy };
    }
  }
  if (!best) { if (myTurn()) fireAim(); return; }
  const err = 46;                       // a friendly cannon: never brutal
  const vx = best.vx + (Math.random() - 0.5) * err;
  const vy = best.vy + (Math.random() - 0.5) * err;
  me.barrel = Math.atan2(vy, vx);
  launch(vx, vy);
}

// ============================================================ audio

let AC = null;
function audio() {
  if (!soundOn) return null;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; } }
  if (AC && AC.state === "suspended") AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, slideTo) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), a.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.12, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
function noiseBurst(dur, vol, cut) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cut || 900;
  const g = a.createGain(); g.gain.setValueAtTime(vol || 0.3, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination); src.start();
}
function sfxFire() { tone(180, 0.16, "sawtooth", 0.16, 70); noiseBurst(0.12, 0.18, 1400); }
function sfxBoom() { noiseBurst(0.5, 0.4, 700); tone(90, 0.4, "sine", 0.22, 40); }
function sfxDeath() { noiseBurst(0.6, 0.35, 500); tone(70, 0.6, "triangle", 0.2, 30); }
function sfxTick() { tone(680, 0.05, "square", 0.1); }
function sfxTurn() { tone(520, 0.09, "triangle", 0.12); tone(780, 0.1, "triangle", 0.09); }

// ============================================================ layout

function stageSize() { return [Math.max(320, windowWidth), Math.max(240, windowHeight)]; }

function layout() {
  const ui = document.getElementById("ui-overlay");
  const uiH = ui ? ui.offsetHeight : 58;
  const availH = Math.max(140, height - uiH - 4);
  const s = Math.min(width / FW, availH / FH);
  L = { s, w: FW * s, h: FH * s, ox: (width - FW * s) / 2, oy: uiH + 2 + (availH - FH * s) / 2 };
}
function sxy(x, y) { return { x: L.ox + x * L.s, y: L.oy + y * L.s }; }
function fxy(sx, sy) { return { x: (sx - L.ox) / L.s, y: (sy - L.oy) / L.s }; }

// ============================================================ input

function pointerOnCanvas(e) { return e && e.target && e.target.tagName === "CANVAS"; }

function myTurn() {
  const tk = currentTank();
  return phase === "aim" && tk && tk.you && mode !== "idle";
}

function beginDrag(sx, sy) {
  if (!myTurn()) return;
  dragging = true;
  const p = fxy(sx, sy);
  setAimFromPoint(p.x, p.y);
}

function setAimFromPoint(px, py) {
  const tk = currentTank();
  if (!tk) return;
  const dx = px - tk.x, dy = py - tk.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  aim.ang = Math.atan2(dy, dx);
  aim.pow = Math.max(0.08, Math.min(1, dist / MAXDRAG));
  tk.barrel = aim.ang;
}

function mousePressed(e) {
  if (!pointerOnCanvas(e) || !L) return;
  audio();
  beginDrag(mouseX, mouseY);
  return false;
}
function mouseDragged() {
  if (!dragging || !L) return;
  const p = fxy(mouseX, mouseY);
  setAimFromPoint(p.x, p.y);
  return false;
}
function mouseReleased() {
  if (!dragging) return;
  dragging = false;
  fireAim();
}

function touchPt(e) {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  return t ? { x: t.clientX, y: t.clientY } : null;
}
function touchStarted(e) {
  if (!pointerOnCanvas(e) || !L) return;
  audio();
  const t = touchPt(e); if (t) beginDrag(t.x, t.y);
  return false;
}
function touchMoved(e) {
  if (!dragging || !L) return;
  const t = touchPt(e); if (t) { const p = fxy(t.x, t.y); setAimFromPoint(p.x, p.y); }
  return false;
}
function touchEnded() {
  if (!dragging) return;
  dragging = false;
  fireAim();
}

function keyPressed() {
  if (document.activeElement && /^(SELECT|INPUT)$/.test(document.activeElement.tagName)) return;
  audio();
  const k = (key || "").toLowerCase();
  if (k === "m") { toggleSound(); return false; }
  if (k === "h") { toggleAid(); return false; }
  if (k === "n" || ((keyCode === ENTER || keyCode === 32) && phase === "over")) { again(); return false; }
  if (phase === "aim" && myTurn()) {
    const step = 0.035;
    if (keyCode === LEFT_ARROW) { aim.ang += step; currentTank().barrel = aim.ang; return false; }
    if (keyCode === RIGHT_ARROW) { aim.ang -= step; currentTank().barrel = aim.ang; return false; }
    if (keyCode === UP_ARROW) { aim.pow = Math.min(1, aim.pow + 0.04); return false; }
    if (keyCode === DOWN_ARROW) { aim.pow = Math.max(0.08, aim.pow - 0.04); return false; }
    if (keyCode === 32 || keyCode === ENTER) { fireAim(); return false; }
  }
  if ([32, ENTER, LEFT_ARROW, RIGHT_ARROW, UP_ARROW, DOWN_ARROW].includes(keyCode)) return false;
}

// ============================================================ p5 lifecycle

function setup() {
  const [w, h] = stageSize();
  const cnv = createCanvas(w, h);
  cnv.parent("canvas-wrap");
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  cnv.elt.style.touchAction = "none";
  const wrap = document.getElementById("canvas-wrap");
  if (wrap) {
    wrap.style.touchAction = "none";
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  loadState();
  if (!heights) heights = genTerrain(seed);
  const sB = document.getElementById("btn-sound"); if (sB) sB.textContent = "Ton: " + (soundOn ? "an" : "aus");
  const aB = document.getElementById("btn-aid"); if (aB) { aB.textContent = "Hilfe: " + (aidOn ? "an" : "aus"); setButtonActive("btn-aid", aidOn); }
  ridgeFar = genRidge(101, 60, FH * 0.44, 90);
  ridgeMid = genRidge(202, 72, FH * 0.5, 70);
  ridgeNear = genRidge(303, 90, FH * 0.56, 52);
  layout();
  syncPresetLabel();
  if (mode === "idle") {
    if (MP && MP.connected) { phase = "lobby"; lobbyAt = millis(); }
    else startPractice();
  }
}

function windowResized() {
  const [w, h] = stageSize();
  resizeCanvas(w, h);
  skyH = -1;
}

function genRidge(s, n, baseY, amp) {
  const rng = mulberry32(s);
  const K = 6;
  const ctrl = [];
  for (let i = 0; i <= K; i++) ctrl.push(baseY - rng() * amp);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const fx = (i / (n - 1)) * K, j = Math.min(K - 1, Math.floor(fx)), t = fx - j, sm = t * t * (3 - 2 * t);
    pts.push(ctrl[j] * (1 - sm) + ctrl[j + 1] * sm);
  }
  return pts;
}

function draw() {
  const dt = Math.min(0.05, (deltaTime || 16.7) / 1000);
  layout();

  // ---- simulation ----
  updateSim(dt);

  // ---- render ----
  push();
  if (shake > 0.3) translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawSky();
  drawRidges();
  // letterbox below the field reads as distant ground
  noStroke();
  const below = L.oy + L.h;
  if (below < height - 0.5) { fill(...C.landDeep); rect(0, below, width, height - below + 1); }
  if (L.ox > 0.5) { fill(...C.landDeep); rect(0, L.oy, L.ox + 1, L.h); rect(L.ox + L.w - 1, L.oy, width, L.h); }
  push();
  translate(L.ox, L.oy); scale(L.s);
  drawTerrain();
  drawTanksAndShots();
  drawAimUI();
  drawHud();
  drawPopups();
  if (phase === "lobby") drawLobby();
  if (phase === "over") drawResult();
  drawCanvasNote();
  pop();
  drawParticles();
  pop();

  shake *= 0.86;

  // ---- status line ----
  updateStatus();
}

function updateSim(dt) {
  // turn timer
  if (phase === "aim" && mode !== "idle") {
    if (turnSecs > 0) {
      const left = turnSecs - (millis() - turnStartMs) / 1000;
      const n = Math.ceil(left);
      if (n !== cdShownLast && n <= 5 && n > 0) { cdShownLast = n; sfxTick(); }
      if (left <= 0 && myTurn()) { note("Zeit um — es wird geschossen."); fireAim(); }
    }
    if (aiThink > 0) { aiThink -= dt; if (aiThink <= 0) aiFire(); }
  }

  // projectile
  if (phase === "fly" && shell) {
    for (let s = 0; s < SUBSTEPS && phase === "fly"; s++) {
      const hit = stepProj(shell);
      if (shell.age >= 0) shell.trail.push(shell.x, shell.y);
      if (shell.trail.length > 90) shell.trail.splice(0, shell.trail.length - 90);
      if (hit) {
        const hx = Math.round(Math.max(2, Math.min(FW - 2, shell.x)));
        const hy = Math.round(Math.max(2, Math.min(FH, shell.y)));
        resolveImpact(hx, hy);
        shell = null;
      }
    }
  }

  // boom pause
  if (phase === "boom") {
    boomTimer -= dt;
    if (boomTimer <= 0) finishImpact();
  }

  // cosmetic shells
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i]; s.life -= dt * 1.6; s.r += 260 * dt; if (s.life <= 0) shells.splice(i, 1);
  }

  // popups
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i]; p.t += dt; p.y += p.vy * dt; p.vy += 40 * dt;
    if (p.t > 1.1) popups.splice(i, 1);
  }

  // ambient sparks drift
  if (frameCount % 10 === 0 && phase !== "lobby") {
    addParticle({ x: Math.random() * width, y: Math.random() * height * 0.5, vx: windAcc * 0.04, vy: 6 + Math.random() * 10, life: 120, size: 1.4 + Math.random() * 1.6, col: [255, 200, 160], decay: 3 });
  }

}

function updateStatus() {
  if (mode === "idle") { setStatus("Bereit", null); return; }
  if (phase === "lobby") { setStatus("In der Lobby", null); return; }
  if (phase === "over") {
    const w = tanks.filter((t) => t.alive)[0];
    setStatus(w ? (w.you ? "Sieg!" : w.name + " gewinnt") : "Unentschieden", w && w.you ? "solved" : "dead");
    return;
  }
  const tk = currentTank();
  if (!tk) { setStatus("", null); return; }
  const who = tk.you ? "Du bist am Zug" : tk.name + " ist am Zug";
  if (phase === "fly" || phase === "boom") setStatus(who, null);
  else setStatus(who + (turnSecs > 0 ? " · " + Math.max(0, Math.ceil(turnSecs - (millis() - turnStartMs) / 1000)) + " s" : ""), tk.you ? "solved" : null);
}

// ============================================================ rendering

function skyGradient() {
  const ctx = drawingContext;
  if (!skyGrad || skyH !== height) {
    skyH = height;
    skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0.0, rgb(C.skyTop));
    skyGrad.addColorStop(0.45, rgb(C.skyMid));
    skyGrad.addColorStop(0.72, rgb(C.skyLow));
    skyGrad.addColorStop(1.0, rgb(C.skyTop));
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);
}
function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }
function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

function drawSky() {
  skyGradient();
  const sx = L.ox + FW * 0.68 * L.s, sy = L.oy + FH * 0.40 * L.s;
  noStroke();
  // sun glow
  for (let k = 9; k >= 1; k--) {
    fill(C.sun[0], C.sun[1], C.sun[2], 5);
    ellipse(sx, sy, 120 * L.s * (0.6 + k * 0.28), 120 * L.s * (0.6 + k * 0.28));
  }
  fill(C.sunCore[0], C.sunCore[1], C.sunCore[2], 235);
  ellipse(sx, sy, 96 * L.s, 96 * L.s);
  fill(C.sun[0], C.sun[1], C.sun[2], 150);
  ellipse(sx, sy, 128 * L.s, 128 * L.s);
  // stars
  const rs = mulberry32(7);
  for (let i = 0; i < 70; i++) {
    const x = rs() * FW, y = rs() * FH * 0.42;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(frameCount * 0.03 + i));
    fill(255, 240, 220, 90 * tw);
    const p = sxy(x, y); circle(p.x, p.y, 1.4 * L.s);
  }
}

function drawRidge(pts, baseY, col, alpha) {
  noStroke();
  fill(col[0], col[1], col[2], alpha);
  push(); translate(L.ox, L.oy); scale(L.s);
  beginShape();
  vertex(0, FH + 60);
  for (let i = 0; i < pts.length; i++) vertex(i * COLW, pts[i]);
  vertex(FW, FH + 60);
  endShape(CLOSE);
  pop();
}

function drawRidges() {
  drawRidge(ridgeFar, 0, C.mtnFar, 235);
  drawRidge(ridgeMid, 0, C.mtnMid, 245);
  drawRidge(ridgeNear, 0, C.mtnNear, 255);
}

function drawTerrain() {
  noStroke();
  fill(...C.land);
  beginShape();
  vertex(0, FH + 60);
  for (let c = 0; c < COLS; c++) vertex(c * COLW, heights[c]);
  vertex(COLS * COLW, FH + 60);
  endShape(CLOSE);
  // faint depth band under the surface
  fill(...C.landDeep);
  beginShape();
  for (let c = 0; c < COLS; c++) vertex(c * COLW, heights[c] + 26);
  vertex(COLS * COLW, FH + 60);
  vertex(0, FH + 60);
  endShape(CLOSE);
  // rim light along the crest
  noFill();
  stroke(C.landEdge[0], C.landEdge[1], C.landEdge[2], 130);
  strokeWeight(2);
  beginShape();
  for (let c = 0; c < COLS; c++) vertex(c * COLW, heights[c]);
  endShape();
  noStroke();
}

function drawTanksAndShots() {
  for (const tk of tanks) drawTank(tk);
  // trail + shell
  if (shell && shell.trail.length >= 4) {
    noFill();
    for (let i = 2; i < shell.trail.length; i += 2) {
      const a = (i / shell.trail.length) * 200;
      stroke(shell.col[0], shell.col[1], shell.col[2], a);
      strokeWeight(2.5 * (i / shell.trail.length) + 0.5);
      line(shell.trail[i - 2], shell.trail[i - 1], shell.trail[i], shell.trail[i + 1]);
    }
    noStroke();
  }
  if (shell) {
    fill(C.shell[0], C.shell[1], C.shell[2], 60);
    circle(shell.x, shell.y, 26);
    fill(C.shell[0], C.shell[1], C.shell[2]);
    circle(shell.x, shell.y, 9);
    fill(255); circle(shell.x, shell.y, 4);
  }
  // expanding blast rings
  for (const s of shells) {
    noFill();
    stroke(C.boom[0], C.boom[1], C.boom[2], 180 * s.life);
    strokeWeight(3); circle(s.x, s.y, s.r * 2);
    noStroke();
  }
}

function drawTank(tk) {
  const act = phase !== "over" && currentTank() === tk && phase !== "lobby";
  if (!tk.alive) {
    // wreck
    fill(20, 16, 30);
    ellipse(tk.x, tk.y - 3, 40, 14);
    fill(40, 30, 40);
    ellipse(tk.x, tk.y - 6, 22, 12);
    // smoke
    if (frameCount % 8 === 0) {
      const p = sxy(tk.x, tk.y - 18);
      addParticle({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 0.6, vy: -0.5, life: 90, size: 6 + Math.random() * 6, col: C.smoke, decay: 1.4 });
    }
    return;
  }
  const col = tk.color;
  // team glow when it is this tank's turn
  if (act) {
    noStroke();
    fill(col.main[0], col.main[1], col.main[2], 40);
    ellipse(tk.x, tk.y - TANK_H * 0.5, 76, 46);
  }
  // barrel
  push(); translate(tk.x, tk.y - TANK_H * 0.7); rotate(tk.barrel);
  fill(24, 20, 36); rect(0, -4, MUZZLE + 12, 8, 4);
  fill(col.main[0], col.main[1], col.main[2], 180); rect(0, -2, MUZZLE + 8, 3, 2);
  pop();
  // body
  noStroke();
  fill(18, 15, 28);
  rect(tk.x - 20, tk.y - TANK_H, 40, TANK_H, 8, 8, 3, 3);
  fill(col.main[0], col.main[1], col.main[2]);
  rect(tk.x - 20, tk.y - TANK_H + 2, 40, 5, 4, 4, 0, 0);
  // treads
  fill(12, 10, 20);
  rect(tk.x - 22, tk.y - 6, 44, 8, 4);
  fill(col.hi[0], col.hi[1], col.hi[2], 200);
  for (let i = -18; i <= 18; i += 6) circle(tk.x + i, tk.y - 2, 3);
  // turret dome + little flag for "you"
  fill(24, 20, 36); ellipse(tk.x, tk.y - TANK_H, 22, 12);
  fill(col.main[0], col.main[1], col.main[2]); circle(tk.x, tk.y - TANK_H, 7);

  // label + hp bar
  const bw = 46, bx = tk.x - bw / 2, by = tk.y - TANK_H - 20;
  noStroke(); fill(0, 0, 0, 150);
  rect(bx - 1, by - 1, bw + 2, 7, 3);
  fill(col.main[0], col.main[1], col.main[2]);
  rect(bx, by, bw * (tk.hp / 100), 5, 3);
  fill(...C.ink); textFont(MF); textSize(11); textStyle(BOLD); textAlign(CENTER, BOTTOM);
  text(String(tk.name).toUpperCase() + (tk.you ? " ◂" : ""), tk.x, by - 4);
  textAlign(CENTER, CENTER);
}

function drawAimUI() {
  if (phase !== "aim" || !myTurn()) return;
  const tk = currentTank();
  const vx = Math.cos(aim.ang) * aim.pow * MAXSPEED;
  const vy = Math.sin(aim.ang) * aim.pow * MAXSPEED;

  // the cannon's aim line
  stroke(tk.color.hi[0], tk.color.hi[1], tk.color.hi[2], 220);
  strokeWeight(3); strokeCap(ROUND);
  line(tk.x, tk.y - TANK_H * 0.7, tk.x + Math.cos(aim.ang) * (MUZZLE + 26), tk.y - TANK_H * 0.7 + Math.sin(aim.ang) * (MUZZLE + 26));
  noStroke();

  // trajectory preview
  if (aidOn) {
    const tkp = currentTank();
    const m = muzzleOf(tkp);
    const p = { x: m.x, y: m.y, vx, vy, age: 0, skip: tkp.idx };
    let guard = 0, i = 0;
    while (!stepProj(p) && guard++ < 900) {
      if (i % 6 === 0) {
        const a = Math.max(0, 190 - i * 0.5);
        fill(tk.color.hi[0], tk.color.hi[1], tk.color.hi[2], a);
        circle(p.x, p.y, 3.2);
      }
      i++;
    }
    // impact marker
    noFill();
    stroke(tk.color.hi[0], tk.color.hi[1], tk.color.hi[2], 150);
    strokeWeight(2);
    circle(p.x, p.y, BLAST_R * 2 * 0.7);
    noStroke();
  }

  // power meter near the tank
  const pw = 70, px = tk.x - pw / 2, py = tk.y + 14;
  fill(0, 0, 0, 150); rect(px - 1, py - 1, pw + 2, 7, 3);
  fill(tk.color.main[0], tk.color.main[1], tk.color.main[2]); rect(px, py, pw * aim.pow, 5, 3);
  fill(...C.muted); textSize(10); textStyle(NORMAL); textAlign(CENTER, TOP);
  text(Math.round(aim.pow * 100) + "%", tk.x, py + 8);
}

function drawHud() {
  textFont(MF);
  const n = tanks.length;
  const pw = Math.min(196, Math.max(120, (FW - 320) / Math.max(1, n)));
  const total = pw * n + 8 * (n - 1);
  let x = (FW - total) / 2;
  for (const tk of tanks) {
    const act = phase !== "over" && currentTank() === tk && phase !== "lobby";
    push();
    noStroke();
    fill(8, 7, 16, act ? 215 : 150);
    rect(x, 12, pw, 40, 9);
    stroke(tk.alive ? tk.color.main[0] : 70, tk.alive ? tk.color.main[1] : 70, tk.alive ? tk.color.main[2] : 80, act ? 255 : 140);
    strokeWeight(act ? 2.4 : 1.4);
    noFill(); rect(x, 12, pw, 40, 9);
    noStroke();
    // hp bar
    fill(0, 0, 0, 160); rect(x + 10, 40, pw - 20, 7, 3);
    if (tk.alive) { fill(tk.color.main[0], tk.color.main[1], tk.color.main[2]); rect(x + 10, 40, (pw - 20) * (tk.hp / 100), 7, 3); }
    fill(255); textSize(13); textStyle(BOLD); textAlign(LEFT, TOP);
    text(String(tk.name).toUpperCase() + (tk.you ? " ·DU" : ""), x + 11, 18);
    if (!tk.alive) { fill(...C.muted); textSize(10); textAlign(RIGHT, BOTTOM); text("K.O.", x + pw - 11, 38); }
    pop();
    x += pw + 8;
  }

  // wind gauge (left)
  drawWind(16, 70);
  // timer (right)
  if (phase === "aim" && turnSecs > 0) {
    const left = Math.max(0, Math.ceil(turnSecs - (millis() - turnStartMs) / 1000));
    const low = left <= 5;
    textAlign(RIGHT, TOP);
    textSize(30); textStyle(BOLD);
    fill(low ? [255, 90, 84] : C.ink);
    text(left + "s", FW - 18, 62);
    textSize(10); textStyle(NORMAL); fill(...C.muted);
    text("ZEIT", FW - 18, 96);
  }
}

function drawWind(x, y) {
  textAlign(LEFT, TOP);
  fill(...C.muted); textSize(10); textStyle(NORMAL);
  text("WIND", x, y);
  const cx = x + 90, cy = y + 30, half = 74;
  stroke(255, 255, 255, 40); strokeWeight(1.5);
  line(cx - half, cy, cx + half, cy);
  for (let i = -3; i <= 3; i++) {
    const gx = cx + (i / 3) * half;
    line(gx, cy - 4, gx, cy + 4);
  }
  const f = windAcc / WIND_MAX;              // -1..1
  strokeWeight(5); strokeCap(ROUND);
  stroke(150, 200, 255, 220);
  line(cx, cy, cx + f * half, cy);
  noStroke();
  fill(180, 220, 255);
  triangle(cx + f * half, cy, cx + f * half - Math.sign(f || 1) * 9, cy - 6, cx + f * half - Math.sign(f || 1) * 9, cy + 6);
  fill(...C.ink); textSize(12); textStyle(BOLD); textAlign(LEFT, TOP);
  text(windAcc.toFixed(0), x, y + 44);
}

function drawPopups() {
  textAlign(CENTER, CENTER); textFont(MF); textStyle(BOLD);
  for (const p of popups) {
    const a = Math.max(0, 255 * (1 - p.t / 1.1));
    fill(p.col[0], p.col[1], p.col[2], a);
    textSize(20 + (1 - p.t) * 6);
    text(p.txt, p.x, p.y);
  }
}

function drawCanvasNote() {
  if (!noteMsg) return;
  const age = (frameCount - noteAt) / 60;
  if (age > 3.2) { noteMsg = ""; return; }
  const a = Math.min(200, 200 * (1 - Math.max(0, age - 2.4) / 0.8));
  textFont(MF); textStyle(BOLD); textSize(15); textAlign(CENTER, BOTTOM);
  const w = textWidth(noteMsg) + 26;
  noStroke(); fill(8, 7, 16, a * 0.8);
  rect(FW / 2 - w / 2, FH - 42, w, 30, 8);
  fill(255, 236, 214, a);
  text(noteMsg, FW / 2, FH - 22);
}

function drawLobby() {
  noStroke(); fill(8, 7, 16, 205); rect(0, 0, FW, FH);
  textAlign(CENTER, CENTER); textFont(MF);
  fill(...C.sun); textStyle(BOLD); textSize(13); text("MÖRSER", FW / 2, 150);
  const amHost = !!(MP && MP.isHost);
  fill(...C.ink); textSize(34); text(amHost ? "Warte auf Spieler …" : "Warte auf den Host …", FW / 2, 194);
  fill(...C.muted); textSize(14); textStyle(NORMAL);
  const room = MP && MP.state ? MP.state.code : "";
  text("Raum " + room + " · " + (MP ? MP.players.length : 0) + " Spieler", FW / 2, 232);
  fill(...C.muted); textSize(13);
  text(amHost ? "Über „Mehrspieler“ oben einladen und starten." : "Der Host startet die Runde. Über „Mehrspieler“ oben kannst du den Raum verlassen.", FW / 2, 264);
  // idle pulse
  const r = 40 + Math.sin(frameCount * 0.05) * 6;
  noFill(); stroke(C.sun[0], C.sun[1], C.sun[2], 150); strokeWeight(2);
  circle(FW / 2, 340, r);
  noStroke();
}

function drawResult() {
  noStroke(); fill(6, 5, 14, 215); rect(0, 0, FW, FH);
  const w = tanks.filter((t) => t.alive)[0];
  textAlign(CENTER, CENTER); textFont(MF);
  if (w) {
    fill(w.color.main[0], w.color.main[1], w.color.main[2]);
    textStyle(BOLD); textSize(46);
    text(w.you ? "SIEG!" : String(w.name).toUpperCase() + " GEWINNT", FW / 2, 150);
    for (let k = 4; k >= 1; k--) {
      noFill(); stroke(w.color.main[0], w.color.main[1], w.color.main[2], 30);
      strokeWeight(3); circle(FW / 2, 150, 150 + k * 26);
    }
    noStroke();
  } else {
    fill(...C.ink); textStyle(BOLD); textSize(44); text("UNENTSCHIEDEN", FW / 2, 150);
  }
  // ranking
  const rows = [...tanks].sort((a, b) => (b.alive - a.alive) || (b.hp - a.hp));
  let y = 226;
  for (const t of rows) {
    const bw = 420, bx = (FW - bw) / 2;
    noStroke(); fill(255, 255, 255, 12); rect(bx, y - 16, bw, 32, 8);
    fill(t.alive ? t.color.main[0] : 90, t.alive ? t.color.main[1] : 90, t.alive ? t.color.main[2] : 100);
    rect(bx + 8, y - 10, 220 * (t.hp / 100), 20, 5);
    fill(...C.ink); textSize(15); textStyle(BOLD); textAlign(LEFT, CENTER);
    text(String(t.name).toUpperCase() + (t.you ? " (DU)" : ""), bx + 10, y);
    textAlign(RIGHT, CENTER);
    text(t.alive ? t.hp + " HP" : "K.O.", bx + bw - 12, y);
    y += 42;
  }
  fill(...C.muted); textSize(13); textStyle(NORMAL); textAlign(CENTER, CENTER);
  if (mode === "mp" && MP && MP.connected) {
    text(MP.isHost ? "Nochmal (N) startet eine neue Runde · „Zurück zur Lobby“ beendet sie." : "Der Host startet die nächste Runde (N ist gehostet).", FW / 2, FH - 40);
  } else {
    text("Nochmal (N) für ein neues Duell.", FW / 2, FH - 40);
  }
}

// ============================================================ info modal animation

function infoAnim(p, w, h, frame) {
  const LOOP = 300, t = frame % LOOP;
  const FW2 = 440, FH2 = 200, ox = 0, oy = 60;
  // sky
  for (let i = 0; i < FH2; i += 2) {
    const f = i / FH2;
    const r = 12 + f * 150, g = 10 + f * 60, b = 28 + f * 50;
    p.stroke(r, g, b); p.line(0, oy + i, w, oy + i + 0.5);
  }
  p.noStroke();
  // sun
  p.fill(255, 190, 130, 40); p.circle(w * 0.66, oy + FH2 * 0.4, 90);
  p.fill(255, 236, 205); p.circle(w * 0.66, oy + FH2 * 0.4, 40);
  // hill
  const surf = (x) => oy + FH2 * 0.62 - Math.sin(x * 0.02) * 14 - Math.sin(x * 0.05 + 1) * 6;
  p.fill(16, 13, 28);
  p.beginShape(); p.vertex(0, h); p.vertex(0, surf(0));
  for (let x = 0; x <= w; x += 8) p.vertex(x, surf(x));
  p.vertex(w, h); p.endShape(p.CLOSE);
  // cannon
  const tx = 60, ty = surf(tx);
  p.fill(20, 16, 30); p.rect(tx - 16, ty - 18, 32, 18, 6);
  p.fill(255, 92, 84); p.rect(tx - 16, ty - 16, 32, 4, 2);
  const ph = (t % LOOP) / LOOP;
  const ang = -0.7 + Math.sin(ph * Math.PI * 2) * 0.15;
  p.stroke(255, 92, 84); p.strokeWeight(6); p.line(tx, ty - 14, tx + Math.cos(ang) * 26, ty - 14 + Math.sin(ang) * 26);
  p.noStroke();
  // shell arc
  if (t > 60) {
    const s = Math.min(1, (t - 60) / 120);
    const x = tx + 26 + s * (w * 0.42);
    const y = ty - 14 - Math.sin(s * Math.PI) * 120;
    p.fill(255, 246, 214); p.circle(x, y, 8);
    p.fill(255, 246, 214, 90); p.circle(x, y, 18);
  }
  // explosion
  if (t > 180) {
    const e = (t - 180) / 60;
    const ex = tx + 26 + w * 0.42, ey = surf(ex);
    for (let k = 3; k >= 1; k--) { p.fill(255, 150, 64, 40); p.circle(ex, ey, k * 26 * (1 + e)); }
    p.fill(255, 240, 190); p.circle(ex, ey, 20 * (1 - e * 0.5));
    p.fill(255, 92, 84); p.textSize(30); p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
    p.text("BUMM!", w / 2, oy + 34);
  }
  // caption
  p.noStroke(); p.fill(245, 238, 255); p.textStyle(p.BOLD); p.textSize(20); p.textAlign(p.CENTER, p.CENTER);
  p.text("Winkel, Weite, Wind", w / 2, 30);
}
