// Solitär (Klondike) — die klassische Patience, mit wählbaren Regeln:
//   · Ziehen: 1 oder 3 Karten vom Stapel
//   · Stapel-Durchgänge: unbegrenzt, 3 oder 1 (Vegas)
//   · leere Spalten: nur Könige oder jede Karte
//   · Einstieg: alle Karten offen
// Karten per Drag & Drop ziehen, oder erst anklicken und dann das Ziel anklicken.
// Doppelklick legt eine Karte auf das Fundament.

const SOL_PRESETS = [
  { label: "Klassisch · 1 Karte · unbegrenzt (Standard)", values: [1, 0, 1, 0] },
  { label: "3 Karten · unbegrenzt",                       values: [3, 0, 1, 0] },
  { label: "1 Karte · 3 Durchgänge",                      values: [1, 3, 1, 0] },
  { label: "3 Karten · 1 Durchgang (Vegas)",              values: [3, 1, 1, 0] },
  { label: "1 Karte · jede Karte in leere Spalte",        values: [1, 0, 0, 0] },
  { label: "Einstieg · alle Karten offen",                values: [1, 0, 1, 1] },
];

initGame({
  title: "Solitär",
  tag: "Klondike · Regeln wählbar",
  presets: SOL_PRESETS,
  buttons: [
    { id: "btn-new",  label: "Neues Spiel", primary: true, onClick: () => newGame() },
    { id: "btn-undo", label: "Zurück",                     onClick: () => undo() },
    { id: "btn-hint", label: "Tipp",                       onClick: () => showHint() },
  ],
  sliders: [],
  onPreset: (v) => { setRule(v); newGame(); },
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gespielt",
    text: [
      "Lege alle vier Farben auf die Fundamente, jeweils von Ass bis König. In den Spalten absteigend und abwechselnd farbig stapeln. Lücken füllen je nach Regel nur Könige oder jede Karte. Vom Stapel ziehst du 1 oder 3 Karten; wie oft der Stapel umgedreht werden darf, ist wählbar.",
      "Tasten: Leertaste Stapel ziehen · H Tipp · U zurück · N neues Spiel.",
    ],
  },
});

function setup() {
  const cnv = createCanvas(SOL_W, SOL_H);
  cnv.parent("canvas-wrap");
  newGame();
}

// ---- rules ----

let RULE = { draw: 1, passes: 0, kings: true, open: false };

function setRule(v) {
  RULE = { draw: v[0], passes: v[1], kings: !!v[2], open: !!v[3] };
  saveSettings("solitaire_state", { preset: v.join(",") });
}

// restore the last chosen preset (the shell is built synchronously by initGame)
(function restorePreset() {
  const d = loadSettings("solitaire_state");
  const hit = SOL_PRESETS.find((p) => p.values.join(",") === d.preset) || SOL_PRESETS[0];
  setRule(hit.values);
  const sel = document.getElementById("preset-select");
  if (sel) sel.value = hit.values.join(",");
})();

// ---- geometry (logical canvas) ----

const SOL_W = 620, SOL_H = 660, SOL_M = 16;
const COLW = (SOL_W - 2 * SOL_M) / 7;
const CW = 72, CH = 100;
const Y0 = SOL_M + CH + 36;   // top of the tableau
const FD = 14, FU = 26;       // vertical step of a face-down / face-up card
const SUIT = ["♠", "♥", "♦", "♣"];
const RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const isRed = (s) => s === 1 || s === 2;
const colX = (i) => SOL_M + i * COLW + (COLW - CW) / 2;   // i = 0..6
const inRect = (x, y, rx, ry, rw, rh) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
const colAt = (x) => { const c = Math.floor((x - SOL_M) / COLW); return c >= 0 && c < 7 ? c : -1; };

// ---- state ----
// card: { r: 1..13, s: 0..3 (♠♥♦♣), up }
// tab: 7 arrays (bottom → top); fnd: 4 piles, index = suit; stock/waste: arrays
// safe defaults: p5 may call draw() before setup() has dealt a game
let tab = [[], [], [], [], [], [], []], fnd = [[], [], [], []], stock = [], waste = [];
let passNo = 1, moves = 0, undoStack = [], won = false;
let selected = null;   // src of a clicked card
let drag = null;       // { src, cards, sx, sy, moved, ox, oy }
let lastClick = null;  // { src, t } for double-click detection
let hintMove = null, hintUntil = 0;
let lastStatus = "";

function newGame() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s, up: false });
  shuffleArray(deck);
  tab = [];
  let k = 0;
  for (let c = 0; c < 7; c++) {
    tab.push([]);
    for (let i = 0; i <= c; i++) {
      const card = deck[k++];
      card.up = i === c || RULE.open;
      tab[c].push(card);
    }
  }
  stock = deck.slice(k);
  waste = [];
  fnd = [[], [], [], []];
  passNo = 1; moves = 0; undoStack = []; won = false;
  selected = null; drag = null; lastClick = null; hintMove = null; hintUntil = 0;
  clearParticles();
  resetHint();
  flashNote("");
}

function snapshot() { return JSON.stringify({ tab, fnd, stock, waste, passNo, moves }); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); }
function undo() {
  if (!undoStack.length) { flashNote("nichts zum Zurücknehmen"); return; }
  const s = JSON.parse(undoStack.pop());
  tab = s.tab; fnd = s.fnd; stock = s.stock; waste = s.waste; passNo = s.passNo; moves = s.moves;
  won = false; selected = null; hintMove = null;
  flashNote("");
}

// ---- stock ----

function canRecycle() { return waste.length > 0 && (RULE.passes === 0 || passNo < RULE.passes); }
function canDraw() { return stock.length > 0 || canRecycle(); }

function clickStock() {
  if (won) return;
  selected = null; hintMove = null;
  if (stock.length) {
    pushUndo();
    for (let i = 0; i < RULE.draw && stock.length; i++) {
      const c = stock.pop();
      c.up = true;
      waste.push(c);
    }
  } else if (canRecycle()) {
    pushUndo();
    while (waste.length) { const c = waste.pop(); c.up = false; stock.push(c); }
    passNo++;
  } else {
    flashNote(RULE.passes ? "keine Durchgänge mehr · zurück oder neues Spiel" : "Stapel ist leer");
  }
}

// ---- moves ----

function getCards(src) {
  if (!src) return [];
  if (src.t === "waste") return waste.length ? [waste[waste.length - 1]] : [];
  if (src.t === "fnd") { const f = fnd[src.s]; return f.length ? [f[f.length - 1]] : []; }
  return tab[src.c].slice(src.i);
}

function canTab(cards, c) {
  const col = tab[c], first = cards[0];
  if (!col.length) return RULE.kings ? first.r === 13 : true;
  const top = col[col.length - 1];
  return top.r === first.r + 1 && isRed(top.s) !== isRed(first.s);
}

function canFnd(cards, s) {
  if (cards.length !== 1) return false;
  const card = cards[0], f = fnd[s];
  if (card.s !== s) return false;
  return f.length ? f[f.length - 1].r + 1 === card.r : card.r === 1;
}

function legal(src, dest) {
  const cards = getCards(src);
  if (!cards.length) return false;
  if (dest.t === "fnd") return canFnd(cards, dest.s);
  if (src.t === "tab" && src.c === dest.c) return false;
  return canTab(cards, dest.c);
}

// removes the cards from their source and returns them; turns the new top card face-up
function takeCards(src) {
  if (src.t === "waste") return [waste.pop()];
  if (src.t === "fnd") return [fnd[src.s].pop()];
  const col = tab[src.c];
  const taken = col.splice(src.i);
  if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
  return taken;
}

function tryMove(src, dest) {
  if (!legal(src, dest)) return false;
  pushUndo();
  const cards = takeCards(src);
  if (dest.t === "fnd") fnd[dest.s].push(cards[0]);
  else tab[dest.c].push(...cards);
  moves++;
  selected = null; hintMove = null;
  if (fnd.every((f) => f.length === 13)) { won = true; celebrate(3); }
  return true;
}

function autoFoundation(src) {
  if (!src || src.t === "fnd") return false;
  const cards = getCards(src);
  if (cards.length !== 1) return false;
  return tryMove(src, { t: "fnd", s: cards[0].s });
}

// a legal move that is worth suggesting, or null
function findHint() {
  const srcs = [];
  if (waste.length) srcs.push({ t: "waste" });
  fnd.forEach((f, s) => { if (f.length) srcs.push({ t: "fnd", s }); });
  tab.forEach((col, c) => col.forEach((card, i) => { if (card.up) srcs.push({ t: "tab", c, i }); }));
  for (const src of srcs) {
    const cards = getCards(src);
    if (cards.length === 1) {
      const f = { t: "fnd", s: cards[0].s };
      if (legal(src, f)) return { from: src, to: f };
    }
    for (let c = 0; c < 7; c++) {
      const d = { t: "tab", c };
      if (src.t === "tab" && src.i === 0 && !tab[c].length) continue;   // pointless shuffle of a whole column
      if (legal(src, d)) return { from: src, to: d };
    }
  }
  return null;
}

function showHint() {
  if (won) return;
  const h = findHint();
  if (h) { selected = null; hintMove = h; hintUntil = millis() + 2500; flashNote(""); }
  else if (canDraw()) flashNote("kein Zug sichtbar · vom Stapel ziehen");
  else flashNote("keine Züge mehr · zurück oder neues Spiel");
}

// ---- hit testing ----

function colTop(c, i) {
  let y = Y0;
  for (let j = 0; j < i; j++) y += tab[c][j].up ? FU : FD;
  return y;
}

function hitAt(x, y) {
  if (inRect(x, y, colX(0), SOL_M, CW, CH)) return { t: "stock" };
  if (inRect(x, y, colX(1), SOL_M, CW + 14, CH)) return waste.length ? { t: "waste" } : null;
  for (let s = 0; s < 4; s++) if (inRect(x, y, colX(3 + s), SOL_M, CW, CH)) return { t: "fnd", s };
  const c = colAt(x);
  if (c < 0 || y < Y0) return null;
  const col = tab[c];
  if (!col.length) return { t: "empty", c };
  let top = Y0;
  for (let i = 0; i < col.length; i++) {
    const last = i === col.length - 1;
    const ext = last ? CH : (col[i].up ? FU : FD);
    if (y >= top && y < top + ext) return col[i].up ? { t: "tab", c, i } : { t: "down" };
    top += ext;
  }
  return null;
}

function srcFromHit(h) {
  if (!h) return null;
  if (h.t === "waste") return { t: "waste" };
  if (h.t === "fnd") return fnd[h.s].length ? { t: "fnd", s: h.s } : null;
  if (h.t === "tab") return { t: "tab", c: h.c, i: h.i };
  return null;
}

// where a dragged/clicked destination is: a foundation slot or a tableau column (anywhere in the column)
function destAt(x, y) {
  for (let s = 0; s < 4; s++) if (inRect(x, y, colX(3 + s) - 6, SOL_M - 6, CW + 12, CH + 12)) return { t: "fnd", s };
  const c = colAt(x);
  if (c >= 0 && y >= Y0 - 20) return { t: "tab", c };
  return null;
}

function srcPos(src) {
  if (src.t === "waste") return { x: colX(1), y: SOL_M };
  if (src.t === "fnd") return { x: colX(3 + src.s), y: SOL_M };
  return { x: colX(src.c), y: colTop(src.c, src.i) };
}

function sameSrc(a, b) { return a.t === b.t && a.c === b.c && a.i === b.i && a.s === b.s; }

// ---- mouse / keyboard ----

function mousePressed() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  if (won) return;
  const h = hitAt(mouseX, mouseY);
  if (h && h.t === "stock") { clickStock(); return false; }
  const src = srcFromHit(h);
  drag = { src, cards: src ? getCards(src) : [], sx: mouseX, sy: mouseY, moved: false, ox: 0, oy: 0 };
  if (src) {
    const p = srcPos(src);
    drag.ox = mouseX - p.x;
    drag.oy = mouseY - p.y;
  }
  return false;
}

function mouseDragged() {
  if (drag && !drag.moved && dist(mouseX, mouseY, drag.sx, drag.sy) > 6) drag.moved = true;
  if (drag && drag.moved) return false;
}

function mouseReleased() {
  const d = drag;
  drag = null;
  if (!d || won) return;
  if (d.moved) {
    if (d.src) { const dest = destAt(mouseX, mouseY); if (dest) tryMove(d.src, dest); }
    return;
  }
  // a click
  const now = millis();
  const prev = lastClick;
  lastClick = null;
  if (d.src && prev && sameSrc(prev.src, d.src) && now - prev.t < 400) {
    if (autoFoundation(d.src)) return;
  }
  if (selected) {
    const dest = destAt(mouseX, mouseY);
    if (dest && tryMove(selected, dest)) return;
    if (d.src && sameSrc(selected, d.src)) { selected = null; return; }
  }
  if (d.src) { selected = d.src; lastClick = { src: d.src, t: now }; }
  else selected = null;
}

function keyPressed() {
  if (key === "n" || key === "N") { newGame(); return false; }
  if (key === "u" || key === "U") { undo(); return false; }
  if (key === " ") { clickStock(); return false; }
  if (key === "h" || key === "H") { showHint(); return false; }
}

// ---- status ----

function refreshStatus() {
  let text, state = null;
  if (won) {
    text = "gelöst in " + moves + (moves === 1 ? " Zug" : " Zügen");
    state = "solved";
  } else {
    text = "Züge " + moves + " · Durchgang " + passNo + (RULE.passes ? "/" + RULE.passes : "");
    if (!canDraw() && !findHint()) { text = "keine Züge mehr"; state = "dead"; }
  }
  const key = text + "|" + state;
  if (key !== lastStatus) { lastStatus = key; setStatus(text, state); }
}

// ---- drawing ----

// g is the p5 instance or `window` (global mode); both expose the same drawing calls
function solCard(g, x, y, c, hl) {
  g.noStroke();
  g.fill(0, 0, 0, 60);
  g.rect(x + 2, y + 3, CW, CH, 8);
  if (!c.up) {
    g.fill(...PAL.lilac);
    g.rect(x, y, CW, CH, 8);
    g.noFill(); g.stroke(255, 255, 255, 110); g.strokeWeight(2);
    g.rect(x + 7, y + 7, CW - 14, CH - 14, 5);
    g.noStroke();
    return;
  }
  g.fill(252, 250, 244);
  if (hl) { g.stroke(...hl); g.strokeWeight(3); } else { g.stroke(190, 186, 176); g.strokeWeight(1); }
  g.rect(x, y, CW, CH, 8);
  g.noStroke();
  g.fill(...(isRed(c.s) ? [206, 44, 68] : [30, 30, 44]));
  g.textAlign("left", "top");
  g.textStyle("bold"); g.textSize(17);
  g.text(RANK[c.r], x + 7, y + 6);
  g.textStyle("normal"); g.textSize(15);
  g.text(SUIT[c.s], x + 8, y + 26);
  g.textAlign("center", "center"); g.textSize(36);
  g.text(SUIT[c.s], x + CW / 2, y + CH / 2 + 4);
}

function solSlot(g, x, y, glyph) {
  g.noFill(); g.stroke(...PAL.lineHi); g.strokeWeight(1.5);
  g.rect(x, y, CW, CH, 8);
  if (glyph) {
    g.noStroke(); g.fill(...PAL.lineHi);
    g.textAlign("center", "center"); g.textSize(34);
    g.text(glyph, x + CW / 2, y + CH / 2);
  }
}

function draw() {
  background(...PAL.board);
  const selCards = selected ? getCards(selected) : [];
  const hintCards = hintMove && millis() < hintUntil ? getCards(hintMove.from) : [];
  const dragging = drag && drag.moved && drag.src ? drag.cards : [];
  const hlFor = (card) => {
    if (hintCards.includes(card)) return PAL.mint;
    if (selCards.includes(card)) return PAL.sun;
    return null;
  };
  const shown = (card) => !dragging.includes(card);

  // stock
  if (stock.length) solCard(window, colX(0), SOL_M, stock[stock.length - 1], null);
  else solSlot(window, colX(0), SOL_M, canRecycle() ? "↻" : "×");

  // waste (fanned out with draw 3)
  if (waste.length) {
    const n = RULE.draw === 3 ? Math.min(3, waste.length) : 1;
    for (let j = 0; j < n; j++) {
      const card = waste[waste.length - n + j];
      if (shown(card)) solCard(window, colX(1) + j * 7, SOL_M, card, hlFor(card));
    }
  } else solSlot(window, colX(1), SOL_M, "");

  // foundations, one pile per suit
  for (let s = 0; s < 4; s++) {
    const f = fnd[s];
    if (f.length) { const card = f[f.length - 1]; if (shown(card)) solCard(window, colX(3 + s), SOL_M, card, hlFor(card)); }
    else solSlot(window, colX(3 + s), SOL_M, SUIT[s]);
  }

  // tableau
  for (let c = 0; c < 7; c++) {
    const col = tab[c], x = colX(c);
    if (!col.length) { solSlot(window, x, Y0, ""); continue; }
    let y = Y0;
    for (const card of col) {
      if (shown(card)) solCard(window, x, y, card, hlFor(card));
      y += card.up ? FU : FD;
    }
  }

  // hint destination
  if (hintCards.length && hintMove) {
    const to = hintMove.to;
    if (to.t === "fnd") { noFill(); stroke(...PAL.mint); strokeWeight(3); rect(colX(3 + to.s), SOL_M, CW, CH, 8); }
    else { noFill(); stroke(...PAL.mint); strokeWeight(3); rect(colX(to.c), Y0, CW, CH, 8); }
  }

  // card(s) being dragged follow the pointer
  if (dragging.length) {
    const bx = mouseX - drag.ox, by = mouseY - drag.oy;
    dragging.forEach((card, k) => solCard(window, bx, by + k * FU, card, PAL.sun));
  }

  if (won) drawBoardOverlay(SOL_M, SOL_M, SOL_W - 2 * SOL_M, SOL_H - 2 * SOL_M, "Gelöst!", moves + (moves === 1 ? " Zug" : " Züge"), PAL.mint);
  drawParticles();
  refreshStatus();
}

// ---- how-to-play animation (440×280, looping) ----
// one card: stock → waste → foundation, then the loop starts again

function infoAnim(p, w, h, frame) {
  p.background(...PAL.board);
  const cw = 58, ch = 84, y = h / 2 - ch / 2 + 6;
  const xS = 70, xW = 180, xF = 320;
  const slot = (x) => { p.noFill(); p.stroke(...PAL.lineHi); p.strokeWeight(1.5); p.rect(x, y, cw, ch, 7); };
  slot(xS); slot(xW); slot(xF);
  const t = frame % 150;
  const prog = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  let cx = xS, lift = 0;
  if (t >= 10 && t < 40) { const u = prog(10, 40); cx = xS + (xW - xS) * ease(u); lift = 10 * Math.sin(u * Math.PI); }
  else if (t >= 40 && t < 60) cx = xW;
  else if (t >= 60) { const u = prog(60, 95); cx = xW + (xF - xW) * ease(u); lift = 10 * Math.sin(u * Math.PI); }
  const up = t >= 10;
  // the card itself: ace of hearts
  p.noStroke(); p.fill(0, 0, 0, 60); p.rect(cx + 2, y - lift + 3, cw, ch, 7);
  if (!up) {
    p.fill(...PAL.lilac); p.rect(cx, y, cw, ch, 7);
  } else {
    p.fill(252, 250, 244); p.stroke(190, 186, 176); p.strokeWeight(1); p.rect(cx, y - lift, cw, ch, 7);
    p.noStroke(); p.fill(206, 44, 68);
    p.textAlign("center", "center"); p.textSize(30);
    p.text("A", cx + cw / 2, y - lift + ch / 2 - 8);
    p.textSize(20); p.text("♥", cx + cw / 2, y - lift + ch / 2 + 20);
  }
}
