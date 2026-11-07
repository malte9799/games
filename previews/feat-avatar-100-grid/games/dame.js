// Dame — gegen die KI (drei Stufen), zu zweit am selben Gerät oder online.
// Drei Varianten: Deutsche Dame (8×8), Checkers (8×8) und Internationale Dame
// (10×10). Regeln und KI kommen aus dame-engine.js, das Brett aus dame-view.js.

const VARIANTS = {
  german: "Deutsche Dame",
  simple: "Checkers",
  international: "International",
};

const SAVED = loadSettings("dame_state");
let variant = VARIANTS[SAVED.variant] ? SAVED.variant : "german";
let mode = SAVED.mode === "local" ? "local" : "ai";
let level = [1, 2, 3].includes(SAVED.level) ? SAVED.level : 2;
let humanColor = SAVED.side === "b" ? "b" : "w";
let soundOn = SAVED.sound !== false;

initGame({
  title: "Dame",
  tag: "Drei Varianten · Schlagzwang · Dame",
  presets: [
    { label: "KI · Mittel · Weiß", values: [0, 2, 0] },
    { label: "KI · Locker · Weiß", values: [0, 1, 0] },
    { label: "KI · Stark · Weiß", values: [0, 3, 0] },
    { label: "KI · Mittel · Schwarz", values: [0, 2, 1] },
    { label: "Lokal · 2 Spieler", values: [1, 2, 0] },
  ],
  buttons: [
    { id: "btn-new", label: "Neue Partie", primary: true, onClick: () => startNew() },
    { id: "btn-flip", label: "Brett drehen", onClick: () => toggleFlip() },
    { id: "btn-sound", label: "Sound an", onClick: () => toggleSound() },
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
      "Ziel ist es, alle gegnerischen Steine zu schlagen oder den Gegner so zu blockieren, dass er keinen Zug mehr hat. Es herrscht Schlagzwang: Wenn ein Schlag möglich ist, muss geschlagen werden. Mehrfache Sprünge klickst du Feld für Feld – die möglichen nächsten Landefelder sind markiert.",
      "Deutsche Dame (8×8): Einfache Steine ziehen vorwärts, schlagen aber vorwärts und rückwärts. Die Dame zieht und schlägt beliebig weit diagonal. Checkers (8×8): Einfache Steine schlagen nur vorwärts, die Dame zieht und schlägt nur ein Feld. Internationale Dame (10×10): wie Deutsche Dame, aber mit fliegender Dame und der Pflicht, die längste Schlagfolge zu spielen.",
      "Oben wählst du Variante, Stufe und Seite. „Lokal“ ist Zwei-Spieler-Betrieb am selben Gerät; das Brett dreht sich automatisch zum Spieler, der am Zug ist. Tasten: N neue Partie · F Brett drehen · Esc Auswahl aufheben.",
    ],
  },
});

let E = null;
let board = null;
let started = false;
let gameToken = 0;
let pos = null;
let moves = [];
let keys = [];
let lastMove = null;
let result = null;
let thinking = false;
let flipped = humanColor === "b";
let moveBody = null;
let resultEl = null;

const engineReady = import("./dame-engine.js")
  .then((m) => {
    E = m;
    if (started) initBoard();
  })
  .catch((err) => {
    console.error(err);
    setStatus("Engine konnte nicht geladen werden", "dead");
  });

function saveState() {
  saveSettings("dame_state", { variant, mode, level, side: humanColor, sound: soundOn });
}

function syncPreset() {
  const sel = document.getElementById("preset-select");
  if (!sel) return;
  const key = [mode === "local" ? 1 : 0, level, humanColor === "b" ? 1 : 0].join(",");
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === key) { sel.selectedIndex = i; return; }
  }
}

function buildVariantSelect() {
  if (document.getElementById("variant-select")) return;
  const presetRow = document.querySelector(".stage-side .preset-row");
  if (!presetRow) return;
  const row = document.createElement("div");
  row.className = "preset-row";
  row.innerHTML = `<select id="variant-select" aria-label="Dame-Variante">
    <option value="german">Deutsche Dame · 8×8</option>
    <option value="simple">Checkers · 8×8</option>
    <option value="international">International · 10×10</option>
  </select>`;
  presetRow.parentNode.insertBefore(row, presetRow);
  const sel = row.querySelector("#variant-select");
  sel.value = variant;
  sel.addEventListener("change", () => {
    variant = VARIANTS[sel.value] ? sel.value : "german";
    saveState();
    startNew();
  });
}

function setup() {
  const cnv = createCanvas(480, 480);
  cnv.parent("canvas-wrap");
  frameRate(60);
  DameView.injectStyle();
  buildVariantSelect();
  buildMoveList();
  syncPreset();
  updateSoundButton();
  started = true;
  if (E) initBoard();
  else setStatus("Lade Partie …", null);
}

function initBoard() {
  if (board) return;
  board = new DameView.Board(window, E, {
    x: 20, y: 20, size: 440,
    flipped,
    canMove: canHumanMove,
    onMove: onBoardMove,
    play: (kind) => { if (soundOn) DameView.playSound(kind); },
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
  pos = E.startPosition(variant);
  moves = [];
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
  const text = E.moveToText(pos, move);
  const capture = move.captures.length > 0;
  const next = E.makeMove(pos, move);

  moves.push(text);
  pos = next;
  keys.push(E.positionKey(pos));
  lastMove = { path: move.path.slice(), captures: move.captures.slice() };
  const status = E.gameStatus(pos, keys);
  result = status.over ? status : null;

  if (mode === "local") flipped = pos.turn === "b";
  board.setFlip(flipped);
  board.setPosition(pos, {
    last: lastMove,
    animate: { path: move.path, captures: move.captures, piece: next.board[move.to] },
  });

  for (const c of move.captures) {
    const p = board.centerOf(c);
    spawnBurst(p.x, p.y, {
      count: 9, speed: [1.1, 3.2], life: [65, 140], size: [1.2, 2.7],
      col: PAL.rose, drag: 0.94, decay: 7,
    });
  }

  renderMoveList();
  updateStatus();
  updateFlipButton();

  if (result) {
    DameView.playSound("end");
    showResultOverlay();
  } else if (move.promo) {
    if (soundOn) DameView.playSound("check");
  } else if (soundOn) {
    DameView.playSound(capture ? "capture" : "move");
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
    const info = DameView.resultInfo(result);
    let state = null;
    if (mode === "ai" && result.winner) state = result.winner === humanColor ? "solved" : "dead";
    setStatus(info.title + (info.sub ? " · " + info.sub : ""), state);
    return;
  }
  if (mode === "ai") {
    setStatus(thinking || pos.turn !== humanColor ? "KI denkt …" : "Du bist am Zug", null);
  } else {
    setStatus((pos.turn === "w" ? "Weiß" : "Schwarz") + " am Zug", null);
  }
}

function showResultOverlay() {
  removeResult();
  const info = DameView.resultInfo(result);
  resultEl = DameView.showResult(document.getElementById("canvas-wrap"), {
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
  if (document.getElementById("dame-moves")) return;
  const side = document.querySelector(".stage-side");
  if (!side) return;
  const wrap = document.createElement("div");
  wrap.className = "schach-moves";
  wrap.id = "dame-moves";
  wrap.innerHTML = `<div class="schach-moves-head"><span>Züge</span><span id="dame-move-count"></span></div><div class="schach-moves-body" id="dame-moves-body"></div>`;
  side.appendChild(wrap);
  moveBody = wrap.querySelector("#dame-moves-body");
}

function renderMoveList() {
  DameView.renderMoves(moveBody, moves);
  const c = document.getElementById("dame-move-count");
  if (c) {
    const n = Math.ceil(moves.length / 2);
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
  if (soundOn) DameView.playSound("select");
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
    if (board) board.clear();
    return false;
  }
}

// ---- info modal animation: a double capture on the German board ----

function infoAnim(p, w, h, frame) {
  p.background(...PAL.board);
  const size = 224;
  const n = 8;
  const x = (w - size) / 2;
  const y = (h - size) / 2;
  const at = (r, c) => r * 8 + c;

  const base = new Array(64).fill(null);
  base[at(0, 1)] = "B";
  base[at(2, 1)] = "b";
  base[at(2, 3)] = "b";
  base[at(2, 5)] = "b";
  base[at(2, 7)] = "b";
  base[at(3, 0)] = "b";
  base[at(3, 2)] = "b";
  base[at(3, 6)] = "b";
  base[at(4, 3)] = "b";
  base[at(4, 5)] = "b";
  base[at(5, 0)] = "w";
  base[at(5, 2)] = "w";
  base[at(5, 4)] = "w";
  base[at(5, 6)] = "w";
  base[at(6, 1)] = "w";
  base[at(6, 3)] = "w";
  base[at(6, 5)] = "w";
  base[at(7, 0)] = "w";
  base[at(7, 2)] = "w";
  base[at(7, 4)] = "w";
  base[at(7, 6)] = "w";

  const final = base.slice();
  final[at(4, 3)] = null;
  final[at(4, 5)] = null;
  final[at(5, 2)] = null;
  final[at(5, 6)] = "w";
  const pos = { variant: "german", n, board: final, turn: "b", half: 0 };

  const cycle = 210;
  const t = frame % cycle;
  const path = [at(5, 2), at(3, 4), at(5, 6)];
  const captures = [at(4, 3), at(4, 5)];

  if (t < 24) {
    DameView.drawBoard(p, {
      x, y, size, pos: { ...pos, board: base }, flipped: false,
      selected: at(5, 2),
      legal: [{ to: at(3, 4), capture: true }],
      last: null,
    });
  } else {
    const k = Math.min(1, (t - 24) / 120);
    DameView.drawBoard(p, {
      x, y, size, pos, flipped: false,
      last: { path, captures },
      anim: { path, piece: "w", t: k },
    });
  }

  p.noStroke();
  p.fill(...PAL.muted);
  p.textAlign(p.CENTER, p.TOP);
  p.textSize(11);
  p.text("c3xe5xg3", w / 2, y + size + 6);
}
