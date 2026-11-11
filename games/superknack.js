// Superknack — get as close to 31 in one suit as you can; knock before they do.
// French deck, 32 cards (7–A). Ace = 11, face cards = 10, number cards at face value.
// Goal: highest score in one suit wins (or ties). After a knock everyone gets
// one more turn, then the player with the lowest hand loses a life.
// 31 in hand = instant showdown (Feuer / Blitz).

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
    { id: "s-lives", label: "Leben",        min: 3, max: 7, step: 2 },
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
  ],
  info: {
    anim: infoAnim,
    title: "Superknack",
    text: [
      "Ziel: 31 Punkte in einer Farbe (Ass = 11, Bildkarten = 10, Zahlen zählen). Klicke eine Handkarte an, dann eine Karte vom Ablagestapel oder Nachziehstapel, um zu tauschen.",
      "Klopfen = letzte Runde. Wer am wenigsten hat, verliert ein Leben. Bei 31 sofort: alle anderen verlieren ein Leben. N = neues Spiel.",
    ],
  },
});

// ---- constants ----
const SUITS = ["♠", "♥", "♦", "♣"];      // 0 spade 1 heart 2 diamond 3 club
const SUIT_COL = [[60,60,70],[200,32,40],[200,32,40],[60,60,70]];
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
let aiDelay = 0;          // frame countdown for AI animation
let aiAction = null;      // { type: "draw"|"discard", card } pending display
let roundEndTimer = 0;
let roundEndData = null;
let gameOverData = null;
let statusMsg = "";
let canvasMsg = "";
let canvasSubMsg = "";

// ---- animation state ----
let cardAnims = [];       // { x, y, tx, ty, card, faceUp, t, dur }
let deckShakeT = 0;
let discardPulse = 0;

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

// ---- game logic ----
function newGame() {
  clearParticles();
  resetHint();
  flashNote("");
  playerCount = 1 + AI_COUNT;
  lives = Array(playerCount).fill(LIVES);
  startRound();
}

function startRound() {
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
  aiAction = null;
  cardAnims = [];
  deckShakeT = 0;
  discardPulse = 0;
  roundEndTimer = 0;
  roundEndData = null;
  gameOverData = null;
  canvasMsg = ""; canvasSubMsg = "";
  // Check instant 31
  for (let i = 0; i < playerCount; i++) {
    if (handFireCheck(hands[i])) { phase = "roundEnd"; endRound("fire", i); return; }
  }
  phase = turn === 0 ? "pick" : "ai-thinking";
  if (turn !== 0) { aiDelay = 60; }
  updateStatus();
}

function updateStatus() {
  if (phase === "pick") {
    if (selectedCard >= 0) statusMsg = "Karte wählen: Stapel oder Ablage";
    else statusMsg = `Dein Zug · Wähle eine Handkarte`;
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
  selectedCard = idx;
  updateStatus();
}

function playerDrawFromDeck() {
  if (phase !== "pick" || turn !== 0 || selectedCard < 0) return;
  if (deck.length === 0) reshuffleDeck();
  if (deck.length === 0) return;
  const drawn = deckDraw();
  discard.push(hands[0][selectedCard]);
  hands[0][selectedCard] = drawn;
  discardPulse = 20;
  endPlayerTurn();
}

function playerDrawFromDiscard() {
  if (phase !== "pick" || turn !== 0 || selectedCard < 0 || discard.length === 0) return;
  const drawn = discard.pop();
  discard.push(hands[0][selectedCard]);
  hands[0][selectedCard] = drawn;
  discardPulse = 20;
  endPlayerTurn();
}

function playerPass() {
  if (phase !== "pick" || turn !== 0) return;
  selectedCard = -1;
  endPlayerTurn();
}

function playerKnock() {
  if (phase !== "pick" || turn !== 0 || knocker >= 0) return;
  knocker = 0;
  knockRound = true;
  turnsAfterKnock = 0;
  selectedCard = -1;
  flashNote("Du hast geklopft! Alle haben noch einen Zug.");
  endPlayerTurn();
}

function endPlayerTurn() {
  selectedCard = -1;
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

  // Difficulty: easy=random sometimes, medium=heuristic, hard=optimal
  const rnd = Math.random();
  let action;
  if (AI_DIFF === 1 && rnd < 0.35) {
    // random pass or draw from deck
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
    discard.push(hand[bestIdx]);
    hand[bestIdx] = drawn;
    discardPulse = 15;
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
        discard.push(hand[worstIdx]);
        hand[worstIdx] = drawn;
      } else {
        discard.push(drawn);  // put back
      }
      discardPulse = 15;
    }
  }

  // Check for 31
  if (handFireCheck(hand)) { phase = "roundEnd"; endRound("fire", turn); return; }

  // AI knock decision
  if (knocker < 0 && handScore(hand) >= (AI_DIFF === 1 ? 28 : AI_DIFF === 2 ? 26 : 24)) {
    knocker = turn;
    knockRound = true;
    turnsAfterKnock = 0;
  }

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

  // eliminate players with 0 lives
  const eliminated = [];
  for (let i = 0; i < playerCount; i++) {
    if (lives[i] <= 0) eliminated.push(i);
  }

  roundEndData = { scores, losers, reason, whoKnocked };

  // Check game over
  const alive = lives.filter(l => l > 0).length;
  if (alive <= 1) {
    gameOverData = { winner: lives.findIndex(l => l > 0) };
    phase = "gameOver";
    if (gameOverData.winner === 0) celebrate(2);
    updateStatus();
    setStatus(gameOverData.winner === 0 ? "Du gewinnst! 🎉" : "Spiel vorbei", gameOverData.winner === 0 ? "solved" : "dead");
  } else {
    // Remove eliminated players
    if (eliminated.length > 0) {
      eliminated.sort((a, b) => b - a); // remove from back
      for (const i of eliminated) {
        hands.splice(i, 1);
        lives.splice(i, 1);
      }
      playerCount = lives.length;
    }
    roundEndTimer = 160;
    updateStatus();
  }
  canvasMsg = reason === "fire" ? "🔥 Feuer – 31!" : "Runde vorbei";
  canvasSubMsg = `${scores.map((s, i) => (i === 0 ? "Du" : `KI ${i}`) + ": " + s).join("  ·  ")}`;
}

// ---- CANVAS layout helpers ----
const CANVAS_W = 480, CANVAS_H = 480;
const CARD_W = 56, CARD_H = 80;
const CARD_R = 7;

// positions: human hand at bottom, AI fans at top / sides
function handPos(playerIdx, cardIdx) {
  const count = playerCount;
  if (playerIdx === 0) {
    // human bottom
    const startX = CANVAS_W / 2 - CARD_W - 10;
    return { x: startX + cardIdx * (CARD_W + 10), y: CANVAS_H - CARD_H - 20 };
  }
  if (count <= 2) {
    // single AI at top
    const startX = CANVAS_W / 2 - CARD_W - 10;
    return { x: startX + cardIdx * (CARD_W + 10), y: 20 };
  }
  if (count <= 3) {
    if (playerIdx === 1) {
      const startX = CANVAS_W / 2 - CARD_W - 10;
      return { x: startX + cardIdx * (CARD_W + 10), y: 20 };
    }
    // playerIdx === 2: right side
    return { x: CANVAS_W - CARD_H - 20, y: CANVAS_H / 2 - CARD_W / 2 + (cardIdx - 1) * (CARD_W * 0.5 + 4) };
  }
  // 4 players: AI top, left, right
  if (playerIdx === 1) {
    const startX = CANVAS_W / 2 - CARD_W - 10;
    return { x: startX + cardIdx * (CARD_W + 10), y: 20 };
  }
  if (playerIdx === 2) {
    return { x: 20, y: CANVAS_H / 2 - CARD_W / 2 + (cardIdx - 1) * (CARD_W * 0.55 + 3) };
  }
  // playerIdx === 3: right
  return { x: CANVAS_W - CARD_H - 20, y: CANVAS_H / 2 - CARD_W / 2 + (cardIdx - 1) * (CARD_W * 0.55 + 3) };
}

function deckPos() { return { x: CANVAS_W / 2 - CARD_W - 8, y: CANVAS_H / 2 - CARD_H / 2 }; }
function discardPos() { return { x: CANVAS_W / 2 + 8, y: CANVAS_H / 2 - CARD_H / 2 }; }

// ---- drawing ----
function drawCard(x, y, card, faceUp, selected, dimmed, sideways) {
  if (sideways) {
    push();
    translate(x + CARD_H / 2, y + CARD_W / 2);
    rotate(HALF_PI);
    translate(-CARD_W / 2, -CARD_H / 2);
    drawCardRect(0, 0, card, faceUp, selected, dimmed);
    pop();
    return;
  }
  drawCardRect(x, y, card, faceUp, selected, dimmed);
}

function drawCardRect(x, y, card, faceUp, selected, dimmed) {
  noStroke();
  // shadow
  fill(0, 0, 0, 36);
  rect(x + 2, y + 4, CARD_W, CARD_H, CARD_R);
  // selection glow
  if (selected) {
    fill(...PAL.lilac, 70);
    rect(x - 4, y - 8, CARD_W + 8, CARD_H + 8, CARD_R + 4);
  }
  // body
  if (faceUp) {
    fill(dimmed ? 200 : 252, dimmed ? 198 : 249, dimmed ? 198 : 246);
  } else {
    fill(...PAL.lilac.map(v => v * 0.55 + 20));
  }
  stroke(dimmed ? 160 : 190, dimmed ? 158 : 186, dimmed ? 160 : 176);
  strokeWeight(1);
  rect(x, y, CARD_W, CARD_H, CARD_R);
  noStroke();

  if (!faceUp) {
    // back pattern
    const bx = x + 4, by = y + 4, bw = CARD_W - 8, bh = CARD_H - 8;
    fill(...PAL.lilac.map(v => v * 0.7 + 10), 180);
    rect(bx, by, bw, bh, CARD_R - 2);
    stroke(...PAL.lilac.map(v => v * 0.9), 120);
    strokeWeight(1);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      rect(bx + t * 6, by + t * 6, bw - t * 12, bh - t * 12, CARD_R - 2);
    }
    noStroke();
    return;
  }

  // face
  const r = rankStr(card), s = suitStr(card);
  const col = SUIT_COL[SUIT_OF(card)];
  const red = SUIT_OF(card) === 1 || SUIT_OF(card) === 2;
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  textSize(r === "10" ? 11 : 13);
  fill(...col, dimmed ? 160 : 255);
  text(r, x + 5, y + 4);
  textSize(11);
  text(s, x + 5, y + 18);
  textAlign(RIGHT, BOTTOM);
  textSize(r === "10" ? 11 : 13);
  push(); translate(x + CARD_W - 5, y + CARD_H - 4); rotate(PI);
  textAlign(LEFT, TOP);
  text(r, 0, 0);
  textSize(11);
  text(s, 0, 14);
  pop();
  // centre suit
  textAlign(CENTER, CENTER);
  textSize(28);
  fill(...col, dimmed ? 130 : 220);
  text(s, x + CARD_W / 2, y + CARD_H / 2 + 2);
}

function drawDeck(x, y) {
  const shake = deckShakeT > 0 ? sin(deckShakeT * 0.8) * 3 : 0;
  const empty = deck.length === 0;
  noStroke();
  if (empty) {
    stroke(...PAL.line); strokeWeight(1.5); noFill();
    rect(x + shake, y, CARD_W, CARD_H, CARD_R);
    noStroke(); fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(11);
    text("Leer", x + CARD_W / 2 + shake, y + CARD_H / 2);
    return;
  }
  // stack visual
  for (let k = Math.min(3, deck.length - 1); k >= 0; k--) {
    fill(...PAL.lilac.map(v => v * 0.55 + 20));
    stroke(...PAL.line); strokeWeight(1);
    rect(x + shake + k * 1.2, y - k * 1.2, CARD_W, CARD_H, CARD_R);
  }
  noStroke();
  fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(10);
  text(deck.length, x + CARD_W / 2 + shake, y + CARD_H / 2);
  if (deckShakeT > 0) deckShakeT--;
}

function drawDiscardPile(x, y) {
  if (discard.length === 0) {
    noStroke(); stroke(...PAL.line); strokeWeight(1.5); noFill();
    rect(x, y, CARD_W, CARD_H, CARD_R);
    noStroke(); fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(11);
    text("Ablage", x + CARD_W / 2, y + CARD_H / 2);
    return;
  }
  // slight offset for depth
  if (discard.length > 1) {
    noStroke(); fill(...PAL.line);
    rect(x + 2, y + 2, CARD_W, CARD_H, CARD_R);
  }
  const top = discard[discard.length - 1];
  const glow = discardPulse > 0;
  if (glow) {
    noStroke(); fill(...PAL.mint, 40);
    rect(x - 4, y - 4, CARD_W + 8, CARD_H + 8, CARD_R + 4);
    if (discardPulse > 0) discardPulse--;
  }
  drawCardRect(x, y, top, true, false, false);
}

function drawPlayerArea(pidx) {
  const isHuman = pidx === 0;
  const hand = hands[pidx];
  if (!hand) return;
  const isTurn = turn === pidx && (phase === "pick" || phase === "ai-thinking");
  const isSideways = pidx === 2 || pidx === 3;

  for (let ci = 0; ci < hand.length; ci++) {
    const p = handPos(pidx, ci);
    const isSelected = isHuman && selectedCard === ci;
    const faceUp = isHuman || phase === "roundEnd" || phase === "gameOver";
    const dimmed = isHuman && selectedCard >= 0 && selectedCard !== ci;
    drawCard(p.x, p.y, hand[ci], faceUp, isSelected, dimmed, isSideways);
  }

  // name + score chip
  const pLabel = pidx === 0 ? "Du" : `KI ${pidx}`;
  const score = handScore(hand);
  const lv = lives[pidx] ?? 0;
  let chipX, chipY;
  if (pidx === 0) { chipX = CANVAS_W / 2; chipY = CANVAS_H - CARD_H - 46; }
  else if (pidx === 1) { chipX = CANVAS_W / 2; chipY = CARD_H + 36; }
  else if (pidx === 2) { chipX = CARD_H + 46; chipY = CANVAS_H / 2; }
  else { chipX = CANVAS_W - CARD_H - 46; chipY = CANVAS_H / 2; }

  // life bubbles
  const isKnocker = knocker === pidx;
  const bubbleR = 7, bubbleGap = 17;
  const totalW = lv * bubbleGap - 2;
  for (let k = 0; k < LIVES; k++) {
    const bx = chipX - totalW / 2 + k * bubbleGap;
    const by = chipY + 16;
    noStroke();
    if (k < lv) {
      fill(...PAL.rose); circle(bx, by, bubbleR * 2);
      fill(255, 255, 255, 60); circle(bx - 1, by - 1, bubbleR * 0.8);
    } else {
      fill(...PAL.line); circle(bx, by, bubbleR * 2);
    }
  }
  // name chip
  const chipBg = isTurn ? [...PAL.lilac, 200] : [...PAL.panel, 220];
  const chipTxt = isKnocker ? `🤜 ${pLabel}` : pLabel;
  noStroke();
  fill(...chipBg);
  const tw = max(70, textWidth(chipTxt) + 24);
  rect(chipX - tw / 2, chipY - 11, tw, 22, 11);
  if (isTurn) fill(255); else fill(...PAL.ink);
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(12);
  text(chipTxt, chipX, chipY - 0.5);
  if (phase === "roundEnd" || phase === "gameOver") {
    fill(...PAL.sky); textSize(10);
    text(score + " Pkt.", chipX, chipY + 34);
  }
}

function drawCenter() {
  const dp = deckPos(), disp = discardPos();
  drawDeck(dp.x, dp.y);
  drawDiscardPile(disp.x, disp.y);

  // labels
  fill(...PAL.muted); textAlign(CENTER, TOP); textSize(9); textStyle(NORMAL);
  text("Stapel", dp.x + CARD_W / 2, dp.y + CARD_H + 4);
  text("Ablage", disp.x + CARD_W / 2, disp.y + CARD_H + 4);

  // instruction hint for human
  if (phase === "pick" && turn === 0) {
    if (selectedCard < 0) {
      fill(...PAL.muted); textAlign(CENTER, CENTER); textSize(10);
      text("Handkarte wählen →", CANVAS_W / 2, CANVAS_H / 2 + CARD_H / 2 + 18);
    } else {
      fill(...PAL.mint); textAlign(CENTER, CENTER); textSize(10);
      text("← Stapel oder Ablage anklicken →", CANVAS_W / 2, CANVAS_H / 2 + CARD_H / 2 + 18);
    }
  }
}

function drawOverlay() {
  if (!canvasMsg) return;
  const ow = 320, oh = 80;
  const ox = CANVAS_W / 2 - ow / 2, oy = CANVAS_H / 2 - oh / 2;
  noStroke(); fill(0, 0, 0, 160); rect(ox + 2, oy + 4, ow, oh, 14);
  fill(...PAL.panel); rect(ox, oy, ow, oh, 14);
  fill(...PAL.ink); textAlign(CENTER, CENTER); textStyle(BOLD); textSize(20);
  text(canvasMsg, CANVAS_W / 2, oy + 26);
  textStyle(NORMAL); textSize(10); fill(...PAL.muted);
  text(canvasSubMsg, CANVAS_W / 2, oy + 52);
}

// ---- p5 lifecycle ----
function setup() {
  const cnv = createCanvas(CANVAS_W, CANVAS_H);
  cnv.parent("canvas-wrap");
  cnv.canvas.addEventListener("contextmenu", e => e.preventDefault());
  newGame();
}

function draw() {
  background(...PAL.board);

  // AI turn timer
  if (phase === "ai-thinking") {
    aiDelay--;
    if (aiDelay <= 0) { aiTakeTurn(); }
  }

  // round end auto-advance
  if (phase === "roundEnd" && gameOverData === null) {
    roundEndTimer--;
    if (roundEndTimer <= 0) {
      canvasMsg = ""; canvasSubMsg = "";
      startRound();
      return;
    }
  }

  drawCenter();
  for (let i = 0; i < playerCount; i++) drawPlayerArea(i);
  drawOverlay();
  drawParticles();
  updateStatus();
}

function mousePressed() {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  if (phase !== "pick" || turn !== 0) return;

  // Check deck click
  const dp = deckPos();
  if (mouseX >= dp.x && mouseX <= dp.x + CARD_W && mouseY >= dp.y && mouseY <= dp.y + CARD_H) {
    if (selectedCard >= 0) { playerDrawFromDeck(); return false; }
    return false;
  }
  // Check discard click
  const disp = discardPos();
  if (mouseX >= disp.x && mouseX <= disp.x + CARD_W && mouseY >= disp.y && mouseY <= disp.y + CARD_H) {
    if (selectedCard >= 0) { playerDrawFromDiscard(); return false; }
    return false;
  }
  // Check hand cards
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
  const LOOP = 180;
  const t = frame % LOOP;
  p.background(...PAL.board);
  p.noStroke();

  const cw = 44, ch = 62, cr = 6;
  // draw 3 hand cards
  const hand = [ENC(7, 1), ENC(6, 1), ENC(4, 2)]; // A♥, K♥, 9♦
  const hx = [w / 2 - cw - 10, w / 2, w / 2 + cw + 10];
  const hy = h - ch - 18;

  for (let i = 0; i < 3; i++) {
    const card = hand[i];
    p.fill(252, 249, 246);
    p.stroke(190, 186, 176); p.strokeWeight(1);
    p.rect(hx[i] - cw / 2, hy, cw, ch, cr);
    p.noStroke();
    const suit = SUIT_OF(card);
    const red = suit === 1 || suit === 2;
    p.fill(red ? 200 : 50, red ? 32 : 50, red ? 40 : 60);
    p.textAlign(p.LEFT, p.TOP); p.textStyle(p.BOLD); p.textSize(10);
    p.text(rankStr(card), hx[i] - cw / 2 + 4, hy + 3);
    p.textSize(9); p.text(suitStr(card), hx[i] - cw / 2 + 4, hy + 13);
    p.textAlign(p.CENTER, p.CENTER); p.textSize(22);
    p.text(suitStr(card), hx[i], hy + ch / 2 + 4);
  }

  // draw score label
  p.fill(...PAL.mint); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(13);
  p.text("A♥ + K♥ = 21 Punkte (♥)", w / 2, hy - 20);

  // animated knock pulse
  const pulse = t > 90 ? sin((t - 90) / 180 * PI * 4) : 0;
  if (t > 90) {
    p.fill(...PAL.rose, 60 + pulse * 50);
    p.circle(w / 2, h / 2 - 30, 50 + pulse * 10);
    p.fill(...PAL.rose); p.textSize(18); p.text("🤜 Klopfen!", w / 2, h / 2 - 30);
  }

  // deck & discard
  const dx = w / 2 - 30, dy = 20;
  p.fill(...PAL.lilac.map(v => v * 0.6));
  p.stroke(...PAL.line); p.strokeWeight(1);
  p.rect(dx, dy, cw, ch, cr);
  p.noStroke(); p.fill(...PAL.muted); p.textSize(9); p.textAlign(p.CENTER, p.CENTER);
  p.text("Stapel", dx + cw / 2, dy + ch / 2);
  // discard
  p.fill(252, 249, 246); p.stroke(190, 186, 176); p.strokeWeight(1);
  p.rect(dx + cw + 8, dy, cw, ch, cr);
  p.noStroke(); p.fill(200, 32, 40); p.textSize(16); p.textAlign(p.CENTER, p.CENTER);
  p.text("Q♥", dx + cw + 8 + cw / 2, dy + ch / 2 + 2);
}
