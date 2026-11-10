// Schach — gegen die KI (drei Stufen) oder zu zweit am selben Gerät.
// Komplette Regeln (Rochade, en passant, Umwandlung, Remis-Regeln) kommen aus
// schach-engine.js; das Brett zeichnet schach-view.js.

const SAVED = loadSettings("schach_state");
let mode = SAVED.mode === "local" ? "local" : "ai";
let level = [1, 2, 3].includes(SAVED.level) ? SAVED.level : 2;
let humanColor = SAVED.side === "b" ? "b" : "w";
let soundOn = SAVED.sound !== false;

initGame({
  title: "Schach",
  tag: "Matt · Rochade · en passant",
  presets: [
    { label: "KI · Mittel · Weiß",  values: [0, 2, 0] },
    { label: "KI · Locker · Weiß",  values: [0, 1, 0] },
    { label: "KI · Stark · Weiß",   values: [0, 3, 0] },
    { label: "KI · Mittel · Schwarz", values: [0, 2, 1] },
    { label: "Lokal · 2 Spieler",   values: [1, 2, 0] },
  ],
  buttons: [
    { id: "btn-new",   label: "Neue Partie",   primary: true, onClick: () => startNew() },
    { id: "btn-flip",  label: "Brett drehen",  onClick: () => toggleFlip() },
    { id: "btn-sound", label: "Sound an",      onClick: () => toggleSound() },
  ],
  sliders: [],
  onPreset: ([m, l, s]) => {
    mode = m === 1 ? "local" : "ai";
    level = [1, 2, 3].includes(l) ? l : 2;
    humanColor = s === 1 ? "b" : "w";
    saveState();
    syncPreset();
    startNew();
  },
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gespielt",
    text: [
      "Tippe oder klicke eine eigene Figur an und dann das Zielfeld – oder ziehe sie mit der Maus. Punkte zeigen legale Züge, ein Ring bedeutet Schlagen. Der letzte Zug und ein Schach sind farbig markiert. Rochade, en passant und Umwandlung funktionieren wie im Turnier.",
      "Gegen die KI wählst du oben Stufe und Seite. „Lokal“ ist Zwei-Spieler-Betrieb am selben Gerät; das Brett dreht sich automatisch zum Spieler, der am Zug ist. Tasten: N neue Partie · F Brett drehen · Esc Auswahl aufheben.",
    ],
  },
});

let E = null;                    // engine module, loaded asynchronously
let board = null;
let started = false;
let gameToken = 0;
let pos = null;
let sans = [];
let keys = [];
let lastMove = null;
let result = null;
let thinking = false;
let flipped = humanColor === "b";
let moveBody = null;
let resultEl = null;

const engineReady = import("./schach-engine.js")
  .then((m) => {
    E = m;
    if (started) initBoard();
  })
  .catch((err) => {
    console.error(err);
    setStatus("Engine konnte nicht geladen werden", "dead");
  });

function saveState() {
  saveSettings("schach_state", { mode, level, side: humanColor, sound: soundOn });
}

function syncPreset() {
  const sel = document.getElementById("preset-select");
  if (!sel) return;
  const key = [mode === "local" ? 1 : 0, level, humanColor === "b" ? 1 : 0].join(",");
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === key) { sel.selectedIndex = i; return; }
  }
}

function setup() {
  const cnv = createCanvas(480, 480);
  cnv.parent("canvas-wrap");
  frameRate(60);
  SchachView.injectStyle();
  buildMoveList();
  syncPreset();
  updateSoundButton();
  started = true;
  if (E) initBoard();
  else setStatus("Lade Partie …", null);
}

function initBoard() {
  if (board) return;
  board = new SchachView.Board(window, E, {
    x: 20, y: 20, size: 440,
    flipped,
    canMove: canHumanMove,
    onMove: onBoardMove,
    play: (kind) => { if (soundOn) SchachView.playSound(kind); },
    choosePromotion: (color) => SchachView.showPromotion(document.getElementById("canvas-wrap"), color),
  });
  updateFlipButton();
  startNew();
}

function canHumanMove() {
  if (!E || !pos || result || thinking) return false;
  if (mode === "local") return true;
  return pos.turn === humanColor;
}

function startNew() {
  if (!E || !board) return;
  gameToken++;
  pos = E.parseFen(E.START_FEN);
  sans = [];
  keys = [E.positionKey(pos)];
  lastMove = null;
  result = null;
  thinking = false;
  removeResult();
  flipped = mode === "local" ? false : humanColor === "b";
  board.setCanMove(canHumanMove);
  board.setFlip(flipped);
  board.setPosition(pos, { last: null });
  updateFlipButton();
  renderMoveList();
  updateStatus();
  maybeAiMove();
}

function onBoardMove(move) {
  if (!E || !pos || result) return;
  if (mode === "ai" && pos.turn !== humanColor) return;
  applyMove(move);
}

function applyMove(move) {
  const mover = pos.turn;
  const san = E.moveToSan(pos, move);
  const capture = !!move.captured;
  const next = E.makeMove(pos, move);

  sans.push(san);
  pos = next;
  keys.push(E.positionKey(pos));
  lastMove = { from: move.from, to: move.to };
  const status = E.gameStatus(pos, keys);
  result = status.over ? status : null;

  if (mode === "local") flipped = pos.turn === "b";
  board.setFlip(flipped);
  board.setPosition(pos, { last: lastMove, animate: { from: move.from, to: move.to } });

  if (capture) {
    const c = board.centerOf(move.to);
    spawnBurst(c.x, c.y, {
      count: 12, speed: [1.2, 3.4], life: [70, 150], size: [1.2, 2.8],
      col: PAL.rose, drag: 0.94, decay: 7,
    });
  }

  renderMoveList();
  updateStatus();
  updateFlipButton();

  if (result) {
    SchachView.playSound("end");
    showResultOverlay();
  } else if (E.inCheck(pos)) {
    if (soundOn) SchachView.playSound("check");
  } else if (soundOn) {
    SchachView.playSound(capture ? "capture" : "move");
  }

  maybeAiMove(mover);
}

function maybeAiMove() {
  if (mode !== "ai" || !pos || result || pos.turn === humanColor) return;
  const token = ++gameToken;
  thinking = true;
  updateStatus();
  setTimeout(() => {
    if (token !== gameToken || !pos || result) return;
    const move = E.chooseMove(pos, level);
    thinking = false;
    if (!move) return;
    applyMove(move);
  }, 240);
}

function updateStatus() {
  if (!E || !pos) return;
  if (result) {
    const info = SchachView.resultInfo(result);
    let state = null;
    if (mode === "ai" && result.winner) state = result.winner === humanColor ? "solved" : "dead";
    setStatus(info.title + (info.sub ? " · " + info.sub : ""), state);
    return;
  }
  const check = E.inCheck(pos) ? " · Schach!" : "";
  if (mode === "ai") {
    setStatus(thinking || pos.turn !== humanColor ? "KI denkt …" : "Du bist am Zug" + check, null);
  } else {
    setStatus((pos.turn === "w" ? "Weiß" : "Schwarz") + " am Zug" + check, null);
  }
}

function showResultOverlay() {
  removeResult();
  const info = SchachView.resultInfo(result);
  resultEl = SchachView.showResult(document.getElementById("canvas-wrap"), {
    title: info.title,
    sub: info.sub,
    actionLabel: "Neue Partie",
    onAction: startNew,
    onClose: () => { resultEl = null; },
  });
}

function removeResult() {
  if (resultEl) { resultEl.remove(); resultEl = null; }
}

function buildMoveList() {
  if (document.getElementById("schach-moves")) return;
  const side = document.querySelector(".stage-side");
  if (!side) return;
  const wrap = document.createElement("div");
  wrap.className = "schach-moves";
  wrap.id = "schach-moves";
  wrap.innerHTML = `<div class="schach-moves-head"><span>Züge</span><span id="schach-move-count"></span></div><div class="schach-moves-body" id="schach-moves-body"></div>`;
  side.appendChild(wrap);
  moveBody = wrap.querySelector("#schach-moves-body");
}

function renderMoveList() {
  SchachView.renderMoves(moveBody, sans);
  const c = document.getElementById("schach-move-count");
  if (c) {
    const n = Math.ceil(sans.length / 2);
    c.textContent = n ? (n === 1 ? "1 Zug" : n + " Züge") : "";
  }
}

function updateSoundButton() {
  const b = document.getElementById("btn-sound");
  if (!b) return;
  b.textContent = soundOn ? "Sound: an" : "Sound: aus";
  setButtonActive("btn-sound", soundOn);
}

function toggleSound() {
  soundOn = !soundOn;
  saveState();
  updateSoundButton();
  if (soundOn) SchachView.playSound("select");
}

function updateFlipButton() {
  const b = document.getElementById("btn-flip");
  if (!b) return;
  b.style.display = mode === "local" ? "none" : "";
}

function toggleFlip() {
  flipped = !flipped;
  if (board) board.setFlip(flipped);
}

function draw() {
  background(...PAL.board);
  if (!board) {
    noStroke();
    fill(...PAL.muted);
    textAlign(CENTER, CENTER);
    textSize(14);
    text("Lade Partie …", width / 2, height / 2);
    return;
  }
  board.draw();
  drawParticles();
}

// ---- input ----

function insideCanvas() {
  return mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height;
}

function mousePressed() {
  if (!board || !insideCanvas()) return;
  board.press(mouseX, mouseY);
  return false;
}

function mouseDragged() {
  if (board && insideCanvas()) board.drag(mouseX, mouseY);
}

function mouseReleased() {
  if (board) board.release(mouseX, mouseY);
}

function keyPressed() {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (key === "n" || key === "N") { startNew(); return false; }
  if (key === "f" || key === "F") { if (mode !== "local") toggleFlip(); return false; }
  if (key === "Escape") {
    if (board) { board.selected = null; board.legal = []; board.dragging = false; }
    return false;
  }
}

// ---- info modal animation: a knight develops with a short pulse ----

function infoAnim(p, w, h, frame) {
  p.background(...PAL.board);
  const size = 224;
  const x = (w - size) / 2;
  const y = (h - size) / 2;
  if (!E) {
    p.noStroke();
    p.fill(...PAL.muted);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(13);
    p.text("Nf3", w / 2, h / 2);
    return;
  }

  const cycle = 160;
  const t = frame % cycle;
  const moveT = Math.max(0, Math.min(1, (t - 36) / 26));
  const base = E.parseFen("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1");
  const after = E.parseFen("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");

  let shown = after;
  if (moveT < 1) {
    shown = { ...after, board: after.board.slice() };
    shown.board[41] = null;                    // f3 — the travelling knight
  }
  const last = t < 96 ? { from: 62, to: 41 } : null;
  SchachView.drawBoard(p, {
    x, y, size,
    pos: shown,
    flipped: false,
    selected: t < 36 ? 62 : null,
    last,
    check: null,
  });

  if (moveT < 1) {
    const a = SchachView.squareRect(x, y, size, 62, false);
    const b = SchachView.squareRect(x, y, size, 41, false);
    const k = moveT < 0.5 ? 2 * moveT * moveT : -1 + (4 - 2 * moveT) * moveT;
    const cx = a.x + a.cell / 2 + (b.x - a.x) * k;
    const cy = a.y + a.cell / 2 + (b.y - a.y) * k;
    SchachView.drawPiece(p, "N", cx, cy, a.cell);
  }

  p.noStroke();
  p.fill(...PAL.muted);
  p.textAlign(p.CENTER, p.TOP);
  p.textSize(11);
  p.text("Nf3", w / 2, y + size + 6);
}
