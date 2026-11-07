// Superknack — get as close to 31 in one suit as you can; knock before they do.
// French deck, 32 cards (7–A). Ace = 11, face cards = 10, number cards at face value.
// Goal: highest score in one suit wins (or ties). After a knock everyone gets
// one more turn, then the player with the lowest hand loses a life.
// 31 in hand = instant showdown (Feuer / Blitz).
//
// Kartenbild: gemeinsames cards.js (PlayingCards) wie in allen Kartenspielen — global pro Browser wählbar.
// Animationen: Austeilen, Tausch-Flüge, Aufdecken am Rundenende, Puls beim Klopfen.
// Passen/Klopfen liegen als Knöpfe direkt auf dem Tisch.

initGame({
  title: "Superknack",
  tag: "klopf · tausch · überlebe",
  presets: [
    { label: "3 KI-Gegner (Standard)", values: [3, 3, 1] },
    { label: "1 KI-Gegner",            values: [1, 3, 1] },
    { label: "2 KI-Gegner",            values: [2, 3, 1] },
  ],
  sliders: [
    { id: "s-ai",    label: "KI-Gegner",   min: 1, max: 3, step: 1 },
    { id: "s-lives", label: "Leben",       min: 3, max: 7, step: 2 },
    { id: "s-diff",  label: "KI-Stärke",   min: 1, max: 3, step: 1, fmt: v => ["Einfach","Mittel","Schwer"][v-1] },
  ],
  onPreset: ([ai, lives, diff]) => { AI_COUNT = ai; LIVES = lives; AI_DIFF = diff; clamp(); saveState(); syncSliderUI(); newGame(); },
  onSlider: (id, v) => { if (id === "s-ai") AI_COUNT = v; else if (id === "s-lives") LIVES = v; else AI_DIFF = v; },
  onClamp: clamp,
  getSliderValues: () => ({ "s-ai": AI_COUNT, "s-lives": LIVES, "s-diff": AI_DIFF }),
  buttons: [
    { id: "btn-new",  label: "Neues Spiel", primary: true,  onClick: () => newGame() },
    { id: "btn-pass", label: "Passen",                      onClick: () => playerPass() },
    { id: "btn-knock",label: "Klopfen",                     onClick: () => playerKnock() },
    { id: "btn-deck", label: "Karten",                      onClick: () => PlayingCards.openMenu(document.getElementById("btn-deck")) },
  ],
  info: {
    anim: infoAnim,
    title: "Superknack",
    text: [
      "Ziel: 31 Punkte in einer Farbe (Ass = 11, Bildkarten = 10, Zahlen zählen). Klicke eine Handkarte und dann Ablage oder Stapel an, um zu tauschen – oder erst den Stapel und dann die Handkarte.",
      "Klopfen = letzte Runde. Wer am wenigsten hat, verliert ein Leben. Bei 31 sofort: alle anderen verlieren ein Leben. N = neues Spiel, P = passen, K = klopfen.",
    ],
  },
});

// ---- constants ----
const SUITS = ["♠", "♥", "♦", "♣"];      // 0 spade 1 heart 2 diamond 3 club
const RANKS = ["7","8","9","10","J","Q","K","A"];  // 7..A
const RANK_VAL = { "7":7,"8":8,"9":9,"10":10,"J":10,"Q":10,"K":10,"A":11 };
const ENC = (r, s) => s * 8 + r;           // 0..31
const RANK_OF = c => c % 8;
const SUIT_OF = c => Math.floor(c / 8);
const val = c => RANK_VAL[RANKS[RANK_OF(c)]];
const rankStr = c => RANKS[RANK_OF(c)];
const suitStr = c => SUITS[SUIT_OF(c)];
function handScore(cards) {
  const by = [0, 0, 0, 0];
  for (const c of cards) by[SUIT_OF(c)] += val(c);
  return Math.max(...by);
}
function handFireCheck(cards) { return handScore(cards) === 31; }

// ---- state ----
let AI_COUNT = 3, LIVES = 3, AI_DIFF = 1;
function clamp() { AI_COUNT = Math.max(1, Math.min(3, AI_COUNT)); }

// per-game state
let deck = [], discard = [];
let hands = [];           // hands[0] = human, hands[1..] = AI
let lives = [];           // lives per player
let playerCount = 0;
let turn = 0;             // whose turn (index)
let knocker = -1;         // who knocked (-1 = nobody)
let knockRound = false;   // in final round after knock
let turnsAfterKnock = 0;
let phase = "idle";       // "idle" | "pick" | "ai-thinking" | "roundEnd" | "gameOver"
let selectedCard = -1;    // index in hand[0] that player clicked first
let selectedPile = null;  // "deck" | "discard" picked before the hand card
let aiDelay = 0;          // frame countdown for AI animation
let roundEndTimer = 0;
let gameOverData = null;
let statusMsg = "";
let canvasMsg = "";
let canvasSubMsg = "";
let canvasSubMsg2 = "";

// ---- layout ----
const CANVAS_W = 480, CANVAS_H = 480;
const CARD_W = 58, CARD_H = 83, CARD_R = 8;
const OPP_W = 44, OPP_H = 63;
const HAND_GAP = 12;
const HAND_Y = CANVAS_H - CARD_H - 12;
const HAND_X0 = CANVAS_W / 2 - (3 * CARD_W + 2 * HAND_GAP) / 2;
const OPP_Y = 16;
const PILE_Y = 168;

// ---- animation state ----
let flights = [];          // { card, x0,y0,x1,y1, t0, dur, faceUp, w, h }
let hidden = new Set();    // cards currently in flight — not drawn at their destination
let deckShakeT = 0;
let discardPulse = 0;
let revealAt = 0;          // performance.now() when the hands are revealed
let knockAt = 0;           // performance.now() of the last knock
let lastPhase = "";

// ---- persistence ----
function saveState() { saveSettings("superknack_state", { AI_COUNT, LIVES, AI_DIFF }); }
function loadState() {
  const d = loadSettings("superknack_state");
  if (typeof d.AI_COUNT === "number") AI_COUNT = d.AI_COUNT;
  if (typeof d.LIVES === "number") LIVES = d.LIVES;
  if (typeof d.AI_DIFF === "number") AI_DIFF = d.AI_DIFF;
}

loadState(); clamp(); syncSliderUI();

// ---- deck helpers ----
function buildDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 8; r++) d.push(ENC(r, s));
  return d;
}
function deckDraw() { return deck.pop(); }

// ---- card rendering: the shared cards.js deck (design picker in the toolbar) ----
const PC_RANK = [7, 8, 9, 10, 11, 12, 13, 1];
function drawFace(x, y, w, h, card) {
  PlayingCards.face(drawingContext, x, y, w, h, PC_RANK[RANK_OF(card)], SUIT_OF(card));
}
function drawBack(x, y, w, h) {
  PlayingCards.back(drawingContext, x, y, w, h);
}

// one card incl. shadow, selection glow and dimming; sx < 1 flips it around its vertical centre
function drawCardAt(x, y, w, h, card, faceUp, o = {}) {
  const { selected = false, dimmed = false, sx = 1, lift = 0 } = o;
  const r = w * 0.09;
  push();
  noStroke();
  const cx = x + w / 2, cy = y + h / 2;
  fill(0, 0, 0, 26 + lift * 34);
  rect(x + 1, y + 3 + lift * 4, w, h, r);
  if (selected) {
    const pulse = 0.5 + 0.5 * sin(millis() / 260);
    fill(...PAL.lilac, 42 + pulse * 34);
    rect(x - 5, y - 7, w + 10, h + 12, r + 5);
  }
  if (sx !== 1) {
    translate(cx, cy);
    scale(max(0.02, sx), 1);
    translate(-cx, -cy);
  }
  if (faceUp) drawFace(x, y, w, h, card);
  else drawBack(x, y, w, h);
  if (dimmed) {
    noStroke(); fill(...PAL.board, 120);
    rect(x, y, w, h, r);
  }
  pop();
}

function cardSize(pidx) { return pidx === 0 ? { w: CARD_W, h: CARD_H } : { w: OPP_W, h: OPP_H }; }

// ---- animation helpers ----
function now() { return performance.now(); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function fly(card, from, to, dur = 260, delay = 0, faceUp = true, size = null, flip = false) {
  const s = size || { w: CARD_W, h: CARD_H };
  flights.push({ card, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t0: now() + delay, dur, faceUp, w: s.w, h: s.h, flip });
  hidden.add(card);
}
function clearFlights() { flights = []; hidden.clear(); }

function drawFlights() {
  const t0 = now();
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const t = (t0 - f.t0) / f.dur;
    if (t < 0) continue;
    if (t >= 1) { flights.splice(i, 1); hidden.delete(f.card); continue; }
    const e = easeOut(t);
    const lift = 1 - Math.abs(e * 2 - 1);
    let faceUp = f.faceUp, sx = 1;
    if (f.flip) {
      faceUp = e >= 0.5;
      sx = max(0.05, Math.abs(Math.cos(Math.PI * e)));
    }
    drawCardAt(
      f.x0 + (f.x1 - f.x0) * e,
      f.y0 + (f.y1 - f.y0) * e - lift * 6,
      f.w, f.h, f.card, faceUp, { lift, sx }
    );
  }
}

function dealAnimation() {
  const src = deckPos();
  const step = 42;
  for (let p = 0; p < playerCount; p++) {
    const sz = cardSize(p);
    for (let ci = 0; ci < 3; ci++) {
      const pos = handPos(p, ci);
      fly(hands[p][ci], src, pos, 320, 90 + (p * 3 + ci) * step, p === 0, sz);
    }
  }
}

// ---- game logic ----
function newGame() {
  clearParticles();
  resetHint();
  flashNote("");
  clearFlights();
  playerCount = 1 + AI_COUNT;
  lives = Array(playerCount).fill(LIVES);
  startRound();
}

function startRound() {
  // players who lost their last life drop out between rounds, so the showdown stays visible
  if (lives.some((l) => l <= 0)) {
    const keep = [];
    for (let i = 0; i < playerCount; i++) if (lives[i] > 0) keep.push(i);
    hands = keep.map((i) => hands[i]);
    lives = keep.map((i) => lives[i]);
    playerCount = lives.length;
  }
  deck = buildDeck();
  shuffleArray(deck);
  discard = [];
  hands = Array(playerCount).fill(null).map(() => [deckDraw(), deckDraw(), deckDraw()]);
  discard.push(deckDraw());
  knocker = -1;
  knockRound = false;
  turnsAfterKnock = 0;
  turn = 0;
  selectedCard = -1;
  selectedPile = null;
  clearFlights();
  deckShakeT = 0;
  discardPulse = 0;
  roundEndTimer = 0;
  gameOverData = null;
  canvasMsg = ""; canvasSubMsg = ""; canvasSubMsg2 = "";
  revealAt = 0;
  // Check instant 31
  for (let i = 0; i < playerCount; i++) {
    if (handFireCheck(hands[i])) { phase = "roundEnd"; endRound("fire", i); return; }
  }
  phase = turn === 0 ? "pick" : "ai-thinking";
  if (turn !== 0) { aiDelay = 60; }
  dealAnimation();
  updateStatus();
}

function updateStatus() {
  if (phase === "pick") {
    if (selectedPile === "deck") statusMsg = "Stapel gewählt – jetzt eine Handkarte anklicken";
    else if (selectedPile === "discard") statusMsg = "Ablage gewählt – jetzt eine Handkarte anklicken";
    else if (selectedCard >= 0) statusMsg = "Karte wählen: Stapel oder Ablage";
    else statusMsg = "Dein Zug · Wähle eine Handkarte";
  } else if (phase === "ai-thinking") {
    statusMsg = `KI ${turn} denkt…`;
  } else if (phase === "roundEnd") {
    statusMsg = "Rundenende";
  } else if (phase === "gameOver") {
    statusMsg = "Spiel vorbei!";
  } else {
    statusMsg = "";
  }
  setStatus(statusMsg, phase === "gameOver" ? "solved" : null);
}

// ---- player actions ----
function playerSelectCard(idx) {
  if (phase !== "pick" || turn !== 0) return;
  if (selectedPile) {
    const pile = selectedPile;
    selectedPile = null;
    selectedCard = idx;
    if (pile === "deck") playerDrawFromDeck(); else playerDrawFromDiscard();
    return;
  }
  selectedCard = idx;
  updateStatus();
}

// click on the deck or the discard pile first: that pile becomes the source, then pick a hand card
function playerSelectPile(pile) {
  if (phase !== "pick" || turn !== 0) return;
  if (selectedCard >= 0) {
    selectedPile = null;
    if (pile === "deck") playerDrawFromDeck(); else playerDrawFromDiscard();
    return;
  }
  selectedPile = selectedPile === pile ? null : pile;
  updateStatus();
}

function playerDrawFromDeck() {
  if (phase !== "pick" || turn !== 0 || selectedCard < 0) return;
  if (deck.length === 0) reshuffleDeck();
  if (deck.length === 0) return;
  const idx = selectedCard;
  selectedPile = null;
  const drawn = deckDraw();
  const thrown = hands[0][idx];
  hands[0][idx] = drawn;
  discard.push(thrown);
  discardPulse = 20;
  animateSwap(0, idx, drawn, thrown, "deck");
  endPlayerTurn();
}

function playerDrawFromDiscard() {
  if (phase !== "pick" || turn !== 0 || selectedCard < 0 || discard.length === 0) return;
  const idx = selectedCard;
  selectedPile = null;
  const drawn = discard.pop();
  const thrown = hands[0][idx];
  discard.push(thrown);
  hands[0][idx] = drawn;
  discardPulse = 20;
  animateSwap(0, idx, drawn, thrown, "discard");
  endPlayerTurn();
}

function playerPass() {
  if (phase !== "pick" || turn !== 0) return;
  selectedCard = -1;
  selectedPile = null;
  endPlayerTurn();
}

function playerKnock() {
  if (phase !== "pick" || turn !== 0 || knocker >= 0) return;
  knocker = 0;
  knockRound = true;
  turnsAfterKnock = 0;
  selectedCard = -1;
  selectedPile = null;
  knockAt = now();
  flashNote("Du hast geklopft! Alle haben noch einen Zug.");
  endPlayerTurn();
}

function endPlayerTurn() {
  selectedCard = -1;
  selectedPile = null;
  if (knockRound) {
    turnsAfterKnock++;
    if (turnsAfterKnock >= playerCount) { phase = "roundEnd"; endRound("knock", knocker); return; }
  }
  turn = (turn + 1) % playerCount;
  if (turn === 0) {
    phase = "pick";
    updateStatus();
  } else {
    phase = "ai-thinking";
    aiDelay = AI_DIFF === 1 ? 70 : AI_DIFF === 2 ? 50 : 30;
    updateStatus();
  }
}

function animateSwap(pidx, idx, drawn, thrown, fromPile) {
  const target = handPos(pidx, idx);
  const src = fromPile === "deck" ? deckPos() : discardPos();
  const sz = cardSize(pidx);
  const human = pidx === 0;
  // the drawn card flips as it lands when it changes sides (deck → hand, discard → hidden hand)
  const drawnFlip = fromPile === "deck" ? human : !human;
  fly(drawn, { x: src.x, y: src.y }, { x: target.x, y: target.y }, 300, 0, human, sz, drawnFlip);
  // the card that leaves the hand flies to the discard pile (AI: face down → face up)
  fly(thrown, { x: target.x, y: target.y }, { x: discardPos().x, y: discardPos().y }, 320, 0, true, sz, !human);
}

// ---- AI ----
function aiTakeTurn() {
  const hand = hands[turn];
  const topDiscard = discard.length > 0 ? discard[discard.length - 1] : -1;

  // Score with/without discard swap
  const scoreNow = handScore(hand);
  let bestGain = 0, bestIdx = -1;
  if (topDiscard >= 0) {
    for (let i = 0; i < 3; i++) {
      const test = [...hand]; test[i] = topDiscard;
      const gain = handScore(test) - scoreNow;
      if (gain > bestGain) { bestGain = gain; bestIdx = i; }
    }
  }

  // Klopfen ist ein ganzer Zug: die KI entscheidet vorher, damit sie nicht
  // gleichzeitig tauscht und klopft (gleiche Regel wie für den Menschen).
  const knockThreshold = AI_DIFF === 1 ? 28 : AI_DIFF === 2 ? 26 : 24;
  if (knocker < 0 && scoreNow >= knockThreshold) {
    knocker = turn;
    knockRound = true;
    turnsAfterKnock = 0;
    knockAt = now();
    flashNote(`KI ${turn} klopft!`);
    endPlayerTurn();
    return;
  }

  // Difficulty: easy=random sometimes, medium=heuristic, hard=optimal
  const rnd = Math.random();
  let action;
  if (AI_DIFF === 1 && rnd < 0.35) {
    action = rnd < 0.15 ? "pass" : "deck";
  } else if (bestGain > 0 && (AI_DIFF >= 2 || rnd > 0.3)) {
    action = "discard";
  } else if (scoreNow >= 25 && AI_DIFF >= 2) {
    action = "pass";
  } else {
    action = "deck";
  }

  if (action === "pass") {
    // just pass
  } else if (action === "discard" && bestIdx >= 0) {
    const drawn = discard.pop();
    const thrown = hand[bestIdx];
    discard.push(thrown);
    hand[bestIdx] = drawn;
    discardPulse = 15;
    animateSwap(turn, bestIdx, drawn, thrown, "discard");
  } else {
    // draw from deck
    if (deck.length === 0) reshuffleDeck();
    if (deck.length > 0) {
      const drawn = deckDraw();
      // find worst card in hand (lowest contribution to best suit)
      const suitSums = [0, 0, 0, 0];
      for (const c of hand) suitSums[SUIT_OF(c)] += val(c);
      const bestSuit = suitSums.indexOf(Math.max(...suitSums));
      let worstIdx = 0, worstVal = Infinity;
      for (let i = 0; i < 3; i++) {
        const contrib = SUIT_OF(hand[i]) === bestSuit ? val(hand[i]) : val(hand[i]) * 0.3;
        if (contrib < worstVal) { worstVal = contrib; worstIdx = i; }
      }
      const testHand = [...hand]; testHand[worstIdx] = drawn;
      if (handScore(testHand) > handScore(hand)) {
        const thrown = hand[worstIdx];
        discard.push(thrown);
        hand[worstIdx] = drawn;
        animateSwap(turn, worstIdx, drawn, thrown, "deck");
      } else {
        // put the drawn card back face up — it flips over on the way to the discard pile
        discard.push(drawn);
        discardPulse = 15;
        fly(drawn, deckPos(), discardPos(), 320, 0, true, cardSize(turn), true);
      }
    }
  }

  // Check for 31
  if (handFireCheck(hand)) { phase = "roundEnd"; endRound("fire", turn); return; }

  endPlayerTurn();
}

function reshuffleDeck() {
  if (discard.length <= 1) return;
  const top = discard.pop();
  deck = [...discard];
  discard = [top];
  shuffleArray(deck);
  deckShakeT = 20;
  flashNote("Stapel neu gemischt.");
}

// ---- round end ----
function endRound(reason, whoKnocked) {
  phase = "roundEnd";
  revealAt = now();
  const scores = hands.map(h => handScore(h));
  const minScore = Math.min(...scores);
  const losers = [];

  if (reason === "fire") {
    // everyone except the one with 31 loses a life
    for (let i = 0; i < playerCount; i++) {
      if (i !== whoKnocked) losers.push(i);
    }
  } else {
    // knock: whoever has the lowest score loses a life
    // if knocker has lowest score they lose 2 lives (penalty)
    for (let i = 0; i < playerCount; i++) {
      if (scores[i] === minScore) losers.push(i);
    }
  }

  for (const l of losers) {
    const penalty = reason !== "fire" && l === whoKnocked ? 2 : 1;
    lives[l] = Math.max(0, lives[l] - penalty);
  }

  // Check game over
  const alive = lives.filter((l) => l > 0).length;
  if (alive <= 1) {
    gameOverData = { winner: lives.findIndex((l) => l > 0) };
    phase = "gameOver";
    if (gameOverData.winner === 0) celebrate(2);
    updateStatus();
    setStatus(gameOverData.winner === 0 ? "Du gewinnst! 🎉" : "Spiel vorbei", gameOverData.winner === 0 ? "solved" : "dead");
  } else {
    roundEndTimer = 170;
    updateStatus();
  }
  canvasMsg = reason === "fire" ? "🔥 Feuer – 31!" : "🤜 Klopfen – Showdown";
  const winnerIdx = reason === "fire" ? whoKnocked : scores.reduce((a, s, i) => (s > scores[a] ? i : a), 0);
  const winnerName = winnerIdx === 0 ? "Du" : `KI ${winnerIdx}`;
  const loserNames = losers.map((i) => (i === 0 ? "Du" : `KI ${i}`)).join(", ");
  canvasSubMsg = `Gewinner: ${winnerName} (${scores[winnerIdx]} Pkt.)`;
  canvasSubMsg2 = `Verlierer: ${loserNames} (${Math.min(...scores)} Pkt.)`;
}

// ---- CANVAS layout ----
// seats: the human at the bottom, the AI around the rest of the table
function opponentSeat(i, n) {
  const a = (n === 1 ? 270 : n === 2 ? 200 + i * 140 : 180 + i * 90) * Math.PI / 180;
  return { x: CANVAS_W / 2 + 180 * Math.cos(a), y: CANVAS_H / 2 - 4 + 180 * Math.sin(a) };
}

function handPos(pidx, cardIdx) {
  if (pidx === 0) {
    return { x: HAND_X0 + cardIdx * (CARD_W + HAND_GAP), y: HAND_Y };
  }
  const n = playerCount - 1;
  const seat = opponentSeat(pidx - 1, n);
  const step = 15;                         // overlapping fan — keeps side seats inside the table
  const totalW = OPP_W + 2 * step;
  return { x: seat.x - totalW / 2 + cardIdx * step, y: seat.y - OPP_H / 2 };
}

function deckPos() { return { x: CANVAS_W / 2 - CARD_W - 12, y: PILE_Y }; }
function discardPos() { return { x: CANVAS_W / 2 + 12, y: PILE_Y }; }

// ---- drawing ----
function drawTable() {
  background(...PAL.board);
  const pulse = 0.5 + 0.5 * sin(millis() / 900);
  noStroke();
  // felt
  fill(...PAL.well);
  rect(8, 6, CANVAS_W - 16, CANVAS_H - 12, 18);
  // soft centre light
  for (let i = 0; i < 4; i++) {
    fill(...PAL.panel, 16 + i * 5);
    ellipse(CANVAS_W / 2, CANVAS_H / 2 - 20, 380 - i * 44, 280 - i * 34);
  }
  noFill(); stroke(...PAL.line, 170); strokeWeight(1.5);
  rect(14, 12, CANVAS_W - 28, CANVAS_H - 24, 14);
  noStroke();
  // "31" watermark
  fill(...PAL.muted, 22);
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(96);
  text("31", CANVAS_W / 2, CANVAS_H / 2 - 12);
}

function drawDeck(x, y) {
  const shake = deckShakeT > 0 ? sin(deckShakeT * 0.8) * 3 : 0;
  if (deckShakeT > 0) deckShakeT--;
  const w = CARD_W, h = CARD_H;
  if (deck.length === 0) {
    noStroke(); stroke(...PAL.line, 200); strokeWeight(1.5); noFill();
    rect(x + shake, y, w, h, CARD_R);
    noStroke(); fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(11);
    text("Leer", x + w / 2 + shake, y + h / 2);
    return;
  }
  for (let k = Math.min(2, deck.length - 1); k >= 0; k--) {
    push();
    translate(shake + k * 2.5, -k * 2.5);
    noStroke(); fill(0, 0, 0, 30); rect(x + 2, y + 3, w, h, CARD_R);
    drawBack(x, y, w, h);
    pop();
  }
  // number on top
  noStroke(); fill(...PAL.ink, 210);
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(10);
  text(deck.length, x + w / 2 + shake, y + h / 2);
}

function drawDiscardPile(x, y) {
  if (discard.length === 0) {
    noFill(); stroke(...PAL.line, 200); strokeWeight(1.5);
    rect(x, y, CARD_W, CARD_H, CARD_R);
    noStroke(); fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(11);
    text("Ablage", x + CARD_W / 2, y + CARD_H / 2);
    return;
  }
  const top = discard[discard.length - 1];
  if (discard.length > 1) {
    noStroke(); fill(...PAL.line, 200);
    rect(x + 3, y + 3, CARD_W, CARD_H, CARD_R);
  }
  const glow = discardPulse > 0;
  if (glow) {
    const p = discardPulse / 20;
    noStroke(); fill(...PAL.mint, 30 + p * 40);
    rect(x - 5, y - 5, CARD_W + 10, CARD_H + 10, CARD_R + 4);
    discardPulse--;
  }
  if (!hidden.has(top)) drawCardAt(x, y, CARD_W, CARD_H, top, true);
}

function drawCenter() {
  const dp = deckPos(), disp = discardPos();
  const myTurn = phase === "pick" && turn === 0;
  const canPick = myTurn && selectedCard < 0;

  // a selected pile glows so the next click (a hand card) is obvious
  const pileGlow = (x, y, active, hover) => {
    const pulse = 0.5 + 0.5 * sin(millis() / 300);
    if (active) {
      noStroke(); fill(...PAL.lilac, 60 + pulse * 60);
      rect(x - 6, y - 6, CARD_W + 12, CARD_H + 12, CARD_R + 5);
    } else if (hover && canPick) {
      noStroke(); fill(...PAL.mint, 40);
      rect(x - 6, y - 6, CARD_W + 12, CARD_H + 12, CARD_R + 5);
    }
  };
  const hoverAt = (x, y) => mouseX >= x && mouseX <= x + CARD_W && mouseY >= y && mouseY <= y + CARD_H;
  pileGlow(dp.x, dp.y, selectedPile === "deck", hoverAt(dp.x, dp.y));
  pileGlow(disp.x, disp.y, selectedPile === "discard", hoverAt(disp.x, disp.y));

  drawDeck(dp.x, dp.y);
  drawDiscardPile(disp.x, disp.y);

  const tag = (x, txt, active) => {
    const w = textWidth(txt) + 16;
    noStroke();
    if (active) {
      fill(...PAL.lilac);
      rect(x - w / 2, dp.y + CARD_H + 2, w, 15, 7.5);
    }
    fill(active ? 255 : PAL.muted);
    textAlign(CENTER, CENTER); textSize(9); textStyle(active ? BOLD : NORMAL);
    text(txt, x, dp.y + CARD_H + 9.5);
  };
  tag(dp.x + CARD_W / 2, "Stapel", selectedPile === "deck");
  tag(disp.x + CARD_W / 2, "Ablage", selectedPile === "discard");
}

function playerAnchor(pidx) {
  if (pidx === 0) {
    return { chipX: CANVAS_W / 2, chipY: HAND_Y - 26, below: false };
  }
  const seat = opponentSeat(pidx - 1, playerCount - 1);
  return { chipX: seat.x, chipY: seat.y + OPP_H / 2 + 17, below: true };
}

function drawPlate(pidx, isTurn) {
  const name = pidx === 0 ? "Du" : `KI ${pidx}`;
  const lv = lives[pidx] ?? 0;
  const maxLives = LIVES;
  const isKnocker = knocker === pidx;
  const { chipX, chipY } = playerAnchor(pidx);
  const pulse = 0.5 + 0.5 * sin(millis() / 300);

  // name chip
  const label = (isKnocker ? "🤜 " : "") + name;
  textStyle(BOLD); textSize(pidx === 0 ? 13 : 11);
  const tw = max(pidx === 0 ? 64 : 54, textWidth(label) + 20);
  noStroke();
  if (isTurn) {
    fill(...PAL.lilac, 110 + pulse * 80);
    rect(chipX - tw / 2 - 3, chipY - 14, tw + 6, 28, 14);
  }
  fill(...(isTurn ? PAL.lilac : PAL.panel));
  rect(chipX - tw / 2, chipY - 11, tw, 22, 11);
  fill(isTurn ? 255 : PAL.ink);
  textAlign(CENTER, CENTER);
  text(label, chipX, chipY - 1);

  // lives as small hearts under/above the chip
  const r = 4.2, gap = 11;
  const total = maxLives * gap - gap + r * 2;
  const startX = chipX - total / 2 + r;
  const ly = pidx === 0 ? chipY + 17 : chipY + 15;
  for (let k = 0; k < maxLives; k++) {
    const hx = startX + k * gap;
    noStroke();
    if (k < lv) {
      fill(...PAL.rose);
      circle(hx, ly, r * 2);
      fill(255, 255, 255, 70);
      circle(hx - 1, ly - 1, r * 0.9);
    } else {
      fill(...PAL.line);
      circle(hx, ly, r * 2);
    }
  }

  // score + status at round end
  if ((phase === "roundEnd" || phase === "gameOver") && hands[pidx]) {
    const sc = handScore(hands[pidx]);
    const lost = roundEndTimer > 0 && lives[pidx] <= 0;
    fill(...PAL.muted); textSize(10); textStyle(BOLD);
    text(`${sc} Pkt.`, chipX, ly + 14);
  }
  if (isTurn && phase !== "roundEnd" && phase !== "gameOver") {
    const bob = sin(millis() / 240) * 2;
    fill(...PAL.lilac);
    textSize(12);
    const ay = pidx === 0 ? chipY - 26 + bob : chipY + 26 + bob;
    text(pidx === 0 ? "▲" : "▼", chipX, ay);
  }
}

function drawPlayerArea(pidx) {
  const isHuman = pidx === 0;
  const hand = hands[pidx];
  if (!hand) return;
  const isTurn = turn === pidx && (phase === "pick" || phase === "ai-thinking");
  const sz = cardSize(pidx);
  const revealed = phase === "roundEnd" || phase === "gameOver";
  const t = now();

  for (let ci = 0; ci < hand.length; ci++) {
    const p = handPos(pidx, ci);
    if (hidden.has(hand[ci])) continue;
    let faceUp = isHuman || revealed;
    let sx = 1;
    if (!isHuman && revealed && revealAt) {
      const k = Math.max(0, Math.min(1, (t - revealAt - ci * 110) / 260));
      sx = easeOut(k);
      faceUp = k > 0.5;
    }
    const isSelected = isHuman && selectedCard === ci;
    const armed = isHuman && isTurn && phase === "pick" && !!selectedPile;
    const hover = isHuman && isTurn && phase === "pick" &&
      mouseX >= p.x && mouseX <= p.x + sz.w && mouseY >= p.y && mouseY <= p.y + sz.h;
    const lift = isSelected ? 10 : hover ? 5 : 0;
    if (armed) {
      const pulse = 0.5 + 0.5 * sin(millis() / 280 + ci * 0.7);
      noStroke(); fill(...PAL.mint, 30 + pulse * 45);
      rect(p.x - 4, p.y - lift - 5, sz.w + 8, sz.h + 10, CARD_R + 4);
    }
    drawCardAt(p.x, p.y - lift, sz.w, sz.h, hand[ci], faceUp, {
      selected: isSelected,
      dimmed: isHuman && selectedCard >= 0 && selectedCard !== ci,
      sx,
    });
  }

  drawPlate(pidx, isTurn);

  // turn glow around the whole seat
  if (isTurn && phase !== "roundEnd" && phase !== "gameOver") {
    const pulse = 0.5 + 0.5 * sin(millis() / 300);
    const x0 = handPos(pidx, 0).x - 7;
    const y0 = handPos(pidx, 0).y - 7;
    const x1 = handPos(pidx, 2).x + sz.w + 7;
    const y1 = y0 + sz.h + 14;
    noFill(); stroke(...PAL.lilac, 60 + pulse * 90); strokeWeight(2.5);
    rect(x0, y0, x1 - x0, y1 - y0, 12);
    noStroke();
  }
}

// ---- on-table controls ----
function actionRects() {
  const w = 92, h = 30, gap = 12;
  const y = 296;
  const canKnock = knocker < 0;
  return {
    pass: { x: CANVAS_W / 2 - w - gap / 2, y, w, h },
    knock: { x: CANVAS_W / 2 + gap / 2, y, w, h, disabled: !canKnock },
  };
}

function pill(r, label, accent, hover, disabled) {
  push();
  const col = accent ? PAL.lilac : PAL.panel;
  noStroke();
  fill(...PAL.board, 90);
  rect(r.x + 1, r.y + 3, r.w, r.h, r.h / 2);
  fill(...col, disabled ? 90 : hover ? 255 : 235);
  rect(r.x, r.y - (hover && !disabled ? 1 : 0), r.w, r.h, r.h / 2);
  if (accent && !disabled) {
    noFill(); stroke(...PAL.lilac, hover ? 230 : 120); strokeWeight(1.5);
    rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, r.h / 2 + 2);
  }
  noStroke();
  fill(accent ? 255 : PAL.ink, disabled ? 120 : 255);
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(12);
  text(label, r.x + r.w / 2, r.y + r.h / 2 - 0.5);
  pop();
}

function drawControls() {
  const myTurn = phase === "pick" && turn === 0;
  if (myTurn) {
    const r = actionRects();
    const hovPass = mouseX >= r.pass.x && mouseX <= r.pass.x + r.pass.w && mouseY >= r.pass.y && mouseY <= r.pass.y + r.pass.h;
    const hovKnock = !r.knock.disabled && mouseX >= r.knock.x && mouseX <= r.knock.x + r.knock.w && mouseY >= r.knock.y && mouseY <= r.knock.y + r.knock.h;
    pill(r.pass, "Passen", false, hovPass, false);
    pill(r.knock, "Klopfen", true, hovKnock, r.knock.disabled);
    if (selectedPile) {
      fill(...PAL.mint); textAlign(CENTER, CENTER); textSize(10); textStyle(BOLD);
      text("Jetzt eine Handkarte anklicken", CANVAS_W / 2, r.pass.y + r.pass.h + 15);
    } else {
      fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(9); textStyle(NORMAL);
      text("Tasten: P / K", CANVAS_W / 2, r.pass.y + r.pass.h + 12);
    }
  } else {
    // whose turn is it?
    let msg = "";
    let accent = PAL.muted;
    if (phase === "ai-thinking") {
      const dots = ".".repeat(1 + Math.floor(millis() / 350) % 3);
      msg = `KI ${turn} ist dran${dots}`;
      accent = PAL.lilac;
    } else if (phase === "pick" && selectedCard >= 0) {
      msg = "Stapel oder Ablage anklicken";
      accent = PAL.mint;
    } else if (phase === "pick") {
      msg = "Handkarte auswählen";
      accent = PAL.mint;
    }
    if (msg) {
      textStyle(BOLD); textSize(12);
      const w = textWidth(msg) + 30;
      noStroke(); fill(...PAL.panel, 220);
      rect(CANVAS_W / 2 - w / 2, 296, w, 30, 15);
      fill(...accent); textAlign(CENTER, CENTER);
      text(msg, CANVAS_W / 2, 311);
    }
  }
}

function drawKnockWave() {
  if (!knockAt) return;
  const t = (now() - knockAt) / 900;
  if (t > 1) { knockAt = 0; return; }
  const cx = CANVAS_W / 2, cy = PILE_Y + CARD_H / 2;
  noFill(); stroke(...PAL.rose, 200 * (1 - t)); strokeWeight(3 - t * 2);
  circle(cx, cy, 40 + t * 260);
  noStroke();
  fill(...PAL.rose, 230 * (1 - t));
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(18);
  text("KLOPF!", cx, cy - 70 - t * 20);
}

function drawOverlay() {
  if (!canvasMsg) return;
  const ow = 340, oh = 110;
  const ox = CANVAS_W / 2 - ow / 2, oy = CANVAS_H / 2 - oh / 2 - 10;
  noStroke(); fill(0, 0, 0, 120); rect(ox + 2, oy + 5, ow, oh, 16);
  fill(...PAL.panel); rect(ox, oy, ow, oh, 16);
  fill(...PAL.ink); textAlign(CENTER, CENTER); textStyle(BOLD); textSize(20);
  text(canvasMsg, CANVAS_W / 2, oy + 26);
  textStyle(BOLD); textSize(12); fill(...PAL.mint);
  text(canvasSubMsg, CANVAS_W / 2, oy + 56);
  textStyle(NORMAL); textSize(12); fill(...PAL.rose);
  text(canvasSubMsg2, CANVAS_W / 2, oy + 80);
}

// ---- p5 lifecycle ----
function setup() {
  const cnv = createCanvas(CANVAS_W, CANVAS_H);
  cnv.parent("canvas-wrap");
  cnv.canvas.addEventListener("contextmenu", e => e.preventDefault());
  newGame();
}

function draw() {
  if (phase !== lastPhase) {
    if (phase === "roundEnd" || phase === "gameOver") revealAt = revealAt || now();
    lastPhase = phase;
  }

  // AI turn timer
  if (phase === "ai-thinking") {
    aiDelay--;
    if (aiDelay <= 0) { aiTakeTurn(); }
  }

  // round end auto-advance
  if (phase === "roundEnd" && gameOverData === null) {
    roundEndTimer--;
    if (roundEndTimer <= 0) {
      canvasMsg = ""; canvasSubMsg = ""; canvasSubMsg2 = "";
      startRound();
      return;
    }
  }

  drawTable();
  drawCenter();
  for (let i = 0; i < playerCount; i++) drawPlayerArea(i);
  drawControls();
  drawFlights();
  drawKnockWave();
  drawOverlay();
  drawParticles();
  updateStatus();

  // pointer cursor over clickable things
  let pointer = false;
  if (phase === "pick" && turn === 0) {
    if (selectedPile) {
      // a pile is armed: the hand cards are the targets
      for (let ci = 0; ci < 3; ci++) {
        const p = handPos(0, ci);
        if (mouseX >= p.x && mouseX <= p.x + CARD_W && mouseY >= p.y && mouseY <= p.y + CARD_H) pointer = true;
      }
    } else {
      const dp = deckPos(), disp = discardPos();
      if (
        (mouseX >= dp.x && mouseX <= dp.x + CARD_W && mouseY >= dp.y && mouseY <= dp.y + CARD_H) ||
        (mouseX >= disp.x && mouseX <= disp.x + CARD_W && mouseY >= disp.y && mouseY <= disp.y + CARD_H)
      ) pointer = true;
      for (let ci = 0; ci < 3; ci++) {
        const p = handPos(0, ci);
        if (mouseX >= p.x && mouseX <= p.x + CARD_W && mouseY >= p.y && mouseY <= p.y + CARD_H) pointer = true;
      }
    }
    const r = actionRects();
    if (inRect(r.pass)) pointer = true;
    if (!r.knock.disabled && inRect(r.knock)) pointer = true;
  }
  const cnv = document.querySelector("#canvas-wrap canvas");
  if (cnv) cnv.style.cursor = pointer ? "pointer" : "default";
}

function inRect(r) {
  return mouseX >= r.x && mouseX <= r.x + r.w && mouseY >= r.y && mouseY <= r.y + r.h;
}

function mousePressed() {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  if (phase !== "pick" || turn !== 0) return;

  // on-table controls
  const r = actionRects();
  if (inRect(r.pass)) { playerPass(); return false; }
  if (!r.knock.disabled && inRect(r.knock)) { playerKnock(); return false; }

  // deck / discard — either first (then a hand card) or after a hand card
  const dp = deckPos(), disp = discardPos();
  if (mouseX >= dp.x && mouseX <= dp.x + CARD_W && mouseY >= dp.y && mouseY <= dp.y + CARD_H) {
    playerSelectPile("deck");
    return false;
  }
  if (mouseX >= disp.x && mouseX <= disp.x + CARD_W && mouseY >= disp.y && mouseY <= disp.y + CARD_H) {
    playerSelectPile("discard");
    return false;
  }
  // hand cards
  for (let ci = 0; ci < 3; ci++) {
    const p = handPos(0, ci);
    if (mouseX >= p.x && mouseX <= p.x + CARD_W && mouseY >= p.y && mouseY <= p.y + CARD_H) {
      playerSelectCard(ci);
      return false;
    }
  }
  return false;
}

function keyPressed() {
  if (key === "n" || key === "N") { newGame(); return false; }
  if (key === "p" || key === "P") { playerPass(); return false; }
  if (key === "k" || key === "K") { playerKnock(); return false; }
  if (key === "1") { playerSelectCard(0); return false; }
  if (key === "2") { playerSelectCard(1); return false; }
  if (key === "3") { playerSelectCard(2); return false; }
}

// ---- info modal animation ----
function infoAnim(p, w, h, frame) {
  const LOOP = 200;
  const t = frame % LOOP;
  p.background(...PAL.board);
  p.noStroke();

  const cw = 46, ch = 66, cr = 6;
  const hand = [ENC(7, 1), ENC(6, 1), ENC(4, 2)]; // A♥, K♥, 9♦
  const hx = [w / 2 - cw - 10, w / 2, w / 2 + cw + 10];
  const hy = h - ch - 26;

  const PC = [7, 8, 9, 10, 11, 12, 13, 1];
  for (let i = 0; i < 3; i++) {
    const card = hand[i];
    const sel = i === 0 && t % LOOP > 70;
    if (sel) {
      p.fill(...PAL.lilac, 70);
      p.rect(hx[i] - cw / 2 - 4, hy - 9, cw + 8, ch + 10, cr + 3);
    }
    p.fill(0, 0, 0, 34); p.rect(hx[i] - cw / 2 + 1, hy + 3, cw, ch, cr);
    PlayingCards.face(p.drawingContext, hx[i] - cw / 2, hy, cw, ch, PC[card % 8], Math.floor(card / 8));
  }

  p.fill(...PAL.mint); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(13);
  p.text("A♥ + K♥ = 21 Punkte (♥)", w / 2, hy - 22);

  // animated knock pulse
  const pulse = t > 100 ? Math.sin((t - 100) / 16) : 0;
  if (t > 100) {
    p.noStroke();
    p.fill(...PAL.rose, 40 + Math.abs(pulse) * 50);
    p.circle(w / 2, h / 2 - 34, 64 + Math.abs(pulse) * 14);
    p.fill(...PAL.rose); p.textSize(17); p.textStyle(p.BOLD);
    p.text("🤜 Klopfen!", w / 2, h / 2 - 34);
  } else {
    p.fill(...PAL.muted); p.textSize(11); p.textStyle(p.NORMAL);
    p.text("Handkarte wählen → tauschen", w / 2, h / 2 - 34);
  }

  // deck & discard
  const dx = w / 2 - cw - 12, dy = 24;
  PlayingCards.back(p.drawingContext, dx, dy, cw, ch);
  PlayingCards.face(p.drawingContext, dx + cw + 24, dy, cw, ch, 12, 1); // Q♥
  p.fill(...PAL.muted); p.textSize(9); p.textAlign(p.CENTER, p.CENTER);
  p.text("Stapel", dx + cw / 2, dy + ch + 10);
  p.text("Ablage", dx + cw + 24 + cw / 2, dy + ch + 10);
}
