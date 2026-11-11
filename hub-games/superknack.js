// Superknack für den Multiplayer-Hub.
//
// 2–6 Spieler. Franzözisches Blatt, 32 Karten (7–A).
// Ass = 11, Bildkarten = 10, Zahlen zählen.
// Ziel: 31 Punkte in einer Farbe. Wer am wenigsten hat, verliert ein Leben.
// 31 in der Hand = sofort alle anderen verlieren ein Leben.
// Klopfen = letzte Runde, dann Showdown.
//
// Host besitzt Deck + Regeln und verteilt den State nach jedem Zug.
// Gäste schicken Intents ("draw", "discard", "pass", "knock").

import { shell } from "../hub-kit.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- constants ----
const SUITS = ["♠", "♥", "♦", "♣"];
const SUIT_COL = ["#3a3a46", "#c82028", "#c82028", "#3a3a46"];
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VAL = { "7": 7, "8": 8, "9": 9, "10": 10, J: 10, Q: 10, K: 10, A: 11 };
const ENC = (r, s) => s * 8 + r;
const RANK_OF = (c) => c % 8;
const SUIT_OF = (c) => Math.floor(c / 8);
const val = (c) => RANK_VAL[RANKS[RANK_OF(c)]];
const rankStr = (c) => RANKS[RANK_OF(c)];
const suitStr = (c) => SUITS[SUIT_OF(c)];
function handScore(cards) {
  const by = [0, 0, 0, 0];
  for (const c of cards) by[SUIT_OF(c)] += val(c);
  return Math.max(...by);
}

function buildDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 8; r++) d.push(ENC(r, s));
  return d;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CSS = `
.sk { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; padding: 8px 0; font-family: var(--font); }
.sk-table { position: relative; width: min(560px, 100%); aspect-ratio: 1.1; border-radius: 18px; overflow: visible;
  background: radial-gradient(ellipse 100% 90% at 50% 40%, #2d6e44 0%, #174a2c 60%, #0d3020 100%);
  box-shadow: 0 8px 32px rgba(0,0,0,.55), 0 0 0 6px #5a3016, 0 0 0 9px #3a1e0a; }
.sk-table canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 18px; }
.sk-status { font: 600 14px var(--font); color: var(--muted); min-height: 22px; text-align: center; }
.sk-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sk-actions button { padding: 8px 18px; border-radius: 8px; border: 1px solid var(--hairline);
  background: var(--panel); color: var(--ink); font: 600 13px var(--font); cursor: pointer; transition: background .15s; }
.sk-actions button:hover { background: var(--panelHi); }
.sk-actions button.primary { background: var(--lilac); color: #fff; border-color: transparent; }
.sk-actions button:disabled { opacity: .4; cursor: not-allowed; }
.sk-lives { display: flex; gap: 6px; align-items: center; font: 600 12px var(--font); color: var(--muted); }
.sk-bubble { width: 10px; height: 10px; border-radius: 50%; background: var(--rose); display: inline-block; }
.sk-bubble.empty { background: var(--line); }
.sk-info { font: 400 12px var(--font); color: var(--muted); text-align: center; max-width: 480px; }
`;

export default {
  min: 2,
  max: 6,

  mount(ctx) {
    // inject CSS
    if (!document.getElementById("sk-css")) {
      const s = document.createElement("style");
      s.id = "sk-css";
      s.textContent = CSS;
      document.head.appendChild(s);
      ctx.addCleanup(() => s.remove());
    }

    const kit = shell(ctx, { title: "Superknack" });
    const body = kit.body;

    body.innerHTML = `
      <div class="sk">
        <div class="sk-table"><canvas id="sk-canvas"></canvas></div>
        <div class="sk-status" id="sk-status">Warte auf Start…</div>
        <div class="sk-actions" id="sk-actions">
          <button id="sk-pass" disabled>Passen</button>
          <button id="sk-knock" disabled>Klopfen</button>
        </div>
        <div class="sk-info" id="sk-info">Klicke eine Handkarte an, dann Stapel oder Ablage zum Tauschen.</div>
      </div>`;

    const canvas = body.querySelector("#sk-canvas");
    const statusEl = body.querySelector("#sk-status");
    const passBtn = body.querySelector("#sk-pass");
    const knockBtn = body.querySelector("#sk-knock");
    const actionsEl = body.querySelector("#sk-actions");

    // ---- game state (mirrored from host) ----
    let state = null;   // { phase, turn, knocker, lives, scores(roundEnd), hands, deckCount, discardTop, players }
    let myHand = [];    // my private hand (from host's private message)
    let selectedCard = -1;
    let myId = ctx.me.id;

    // p5 canvas
    let p5inst = null;

    // ---- rendering helpers ----
    const CW = 54, CH = 76, CR = 7;
    function cardFace(p, cx, cy, card, selected, dimmed, rot) {
      p.push(); p.translate(cx, cy); if (rot) p.rotate(rot);
      p.noStroke();
      p.fill(0, 0, 0, 36); p.rect(-CW / 2 + 2, -CH / 2 + 4, CW, CH, CR);
      if (selected) { p.fill(120, 100, 220, 70); p.rect(-CW / 2 - 4, -CH / 2 - 8, CW + 8, CH + 8, CR + 4); }
      p.fill(dimmed ? 200 : 252, dimmed ? 198 : 249, dimmed ? 198 : 246);
      p.stroke(190, 186, 176); p.strokeWeight(1);
      p.rect(-CW / 2, -CH / 2, CW, CH, CR); p.noStroke();
      const suit = SUIT_OF(card), red = suit === 1 || suit === 2;
      const col = red ? [200, 32, 40] : [42, 42, 52];
      p.fill(...col, dimmed ? 160 : 255);
      p.textStyle(p.BOLD); p.textAlign(p.LEFT, p.TOP);
      p.textSize(rankStr(card) === "10" ? 10 : 12);
      p.text(rankStr(card), -CW / 2 + 5, -CH / 2 + 4);
      p.textSize(10); p.text(suitStr(card), -CW / 2 + 5, -CH / 2 + 17);
      p.textAlign(p.CENTER, p.CENTER); p.textSize(26);
      p.fill(...col, dimmed ? 130 : 220); p.text(suitStr(card), 0, CH * 0.07);
      p.pop();
    }

    function cardBack(p, cx, cy, rot) {
      p.push(); p.translate(cx, cy); if (rot) p.rotate(rot);
      p.noStroke();
      p.fill(0, 0, 0, 36); p.rect(-CW / 2 + 2, -CH / 2 + 4, CW, CH, CR);
      p.fill(60, 55, 120); p.stroke(90, 85, 160); p.strokeWeight(1);
      p.rect(-CW / 2, -CH / 2, CW, CH, CR); p.noStroke();
      p.fill(80, 75, 150, 150);
      for (let k = 1; k < 4; k++) p.rect(-CW / 2 + k * 3.5, -CH / 2 + k * 3.5, CW - k * 7, CH - k * 7, CR - 1);
      p.pop();
    }

    function drawScene(p) {
      if (!state) {
        p.background(23, 70, 44);
        p.fill(255, 255, 255, 60); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(16);
        p.text("Warte auf Spielstart…", p.width / 2, p.height / 2);
        return;
      }
      p.background(23, 70, 44);
      const W = p.width, H = p.height;

      const players = ctx.players;
      const myIdx = players.findIndex((pl) => pl.id === myId);
      // arrange: I am always at bottom; others distributed clockwise from left
      const otherIdxs = players.map((_, i) => i).filter((i) => i !== myIdx);

      // positions for opponent chips (top of table)
      const opp = otherIdxs.length;
      const oppPositions = [];
      for (let i = 0; i < opp; i++) {
        const x = W * (0.2 + (i + 0.5) / opp * 0.6);
        oppPositions.push({ x, y: 24 });
      }

      // draw opponent backs & names
      p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
      for (let oi = 0; oi < opp; oi++) {
        const pidx = otherIdxs[oi];
        const pl = players[pidx];
        const { x, y } = oppPositions[oi];
        const isTurn = state.turnId === pl.id;
        const lv = state.lives ? state.lives[pl.id] ?? 3 : 3;
        const maxLives = state.maxLives ?? 3;

        // 3 card backs in mini fan
        cardBack(p, x - 20, y + CH / 2, -0.08);
        cardBack(p, x, y + CH / 2 - 2, 0);
        cardBack(p, x + 20, y + CH / 2, 0.08);

        // show revealed hand if round ended
        if ((state.phase === "roundEnd" || state.phase === "gameOver") && state.revealedHands) {
          const rhand = state.revealedHands[pl.id];
          if (rhand) {
            for (let ci = 0; ci < rhand.length; ci++) {
              cardFace(p, x + (ci - 1) * (CW * 0.7), y + CH / 2, rhand[ci], false, false, 0);
            }
          }
        }

        // name chip
        const chipCol = isTurn ? [130, 100, 230] : [60, 100, 70];
        p.fill(...chipCol); p.rect(x - 36, y + CH + 10, 72, 20, 10);
        p.fill(255); p.textSize(11); p.text(esc(pl.name).substring(0, 8), x, y + CH + 20);

        // life bubbles
        for (let k = 0; k < maxLives; k++) {
          p.fill(k < lv ? 220 : 50, k < lv ? 50 : 50, k < lv ? 60 : 50);
          p.circle(x - (maxLives - 1) * 7 + k * 14, y + CH + 36, 10);
        }
        if (state.knockerId === pl.id) {
          p.fill(220, 80, 60); p.textSize(10); p.text("🤜 klopft", x, y + CH + 48);
        }
      }

      // Centre: deck + discard
      const dx = W / 2 - CW - 10, disx = W / 2 + 10, cy2 = H / 2;

      // deck
      p.fill(60, 55, 120); p.stroke(90, 85, 160); p.strokeWeight(1);
      p.rect(dx, cy2 - CH / 2, CW, CH, CR);
      p.noStroke(); p.fill(255, 255, 255, 80); p.textSize(10); p.textAlign(p.CENTER, p.CENTER);
      p.text(state.deckCount ?? "?", dx + CW / 2, cy2);
      p.fill(255, 255, 255, 50); p.textSize(8); p.text("Stapel", dx + CW / 2, cy2 + CH / 2 + 10);

      // discard
      if (state.discardTop != null) {
        cardFace(p, disx + CW / 2, cy2, state.discardTop, false, false, 0.02);
      } else {
        p.stroke(255, 255, 255, 60); p.strokeWeight(1); p.noFill();
        p.rect(disx, cy2 - CH / 2, CW, CH, CR);
      }
      p.fill(255, 255, 255, 50); p.noStroke(); p.textSize(8); p.textAlign(p.CENTER, p.CENTER);
      p.text("Ablage", disx + CW / 2, cy2 + CH / 2 + 10);

      // My hand (bottom)
      const hbottom = H - CH / 2 - 20;
      const myLv = state.lives ? state.lives[myId] ?? 3 : 3;
      const maxLives = state.maxLives ?? 3;
      const isMyTurn = state.turnId === myId && state.phase === "pick";

      for (let ci = 0; ci < 3; ci++) {
        const hx = W / 2 - CW - 10 + ci * (CW + 10);
        const card = myHand[ci];
        if (card == null) {
          p.fill(60, 100, 70); p.rect(hx, hbottom - CH / 2, CW, CH, CR);
          continue;
        }
        cardFace(p, hx + CW / 2, hbottom, card, selectedCard === ci, selectedCard >= 0 && selectedCard !== ci, ci === 0 ? -0.03 : ci === 2 ? 0.03 : 0);
        // highlight on hover
        if (isMyTurn && selectedCard < 0) {
          if (p.mouseX > hx && p.mouseX < hx + CW && p.mouseY > hbottom - CH / 2 && p.mouseY < hbottom + CH / 2) {
            p.noFill(); p.stroke(130, 100, 230); p.strokeWeight(2);
            p.rect(hx - 2, hbottom - CH / 2 - 2, CW + 4, CH + 4, CR + 2);
          }
        }
      }

      // My name + lives
      p.noStroke(); p.fill(130, 100, 230); p.rect(W / 2 - 30, hbottom - CH / 2 - 32, 60, 20, 10);
      p.fill(255); p.textStyle(p.BOLD); p.textSize(11); p.textAlign(p.CENTER, p.CENTER);
      p.text("Du", W / 2, hbottom - CH / 2 - 22);
      for (let k = 0; k < maxLives; k++) {
        p.fill(k < myLv ? 220 : 50, k < myLv ? 50 : 50, k < myLv ? 60 : 50);
        p.circle(W / 2 - (maxLives - 1) * 7 + k * 14, hbottom - CH / 2 - 44, 10);
      }

      // show score if round ended
      if ((state.phase === "roundEnd" || state.phase === "gameOver") && state.scores) {
        const sc = state.scores[myId];
        if (sc != null) {
          p.fill(255, 255, 255, 180); p.textSize(11); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.NORMAL);
          p.text(sc + " Pkt.", W / 2, hbottom + CH / 2 + 14);
        }
      }

      // instructions overlay
      if (isMyTurn) {
        p.fill(0, 0, 0, 100); p.noStroke(); p.rect(W / 2 - 160, cy2 + CH / 2 + 24, 320, 24, 8);
        p.fill(255, 255, 200); p.textSize(10); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.NORMAL);
        const msg = selectedCard >= 0 ? "Jetzt Stapel oder Ablage anklicken" : "Handkarte anklicken zum Auswählen";
        p.text(msg, W / 2, cy2 + CH / 2 + 36);
      }

      // end-of-round overlay
      if (state.phase === "roundEnd" || state.phase === "gameOver") {
        const ow = 300, oh = 70;
        const ox = W / 2 - ow / 2, oy2 = H / 2 - oh / 2;
        p.noStroke(); p.fill(0, 0, 0, 160); p.rect(ox + 2, oy2 + 4, ow, oh, 14);
        p.fill(240, 234, 210); p.rect(ox, oy2, ow, oh, 14);
        p.fill(42, 42, 52); p.textStyle(p.BOLD); p.textSize(18); p.textAlign(p.CENTER, p.CENTER);
        p.text(state.phase === "gameOver" ? (state.winnerId === myId ? "🎉 Du gewinnst!" : "Spiel vorbei!") : "Runde beendet", W / 2, oy2 + 24);
        if (state.roundReason) {
          p.textStyle(p.NORMAL); p.textSize(11); p.fill(100, 80, 60);
          const reason = state.roundReason === "fire" ? "🔥 Feuer – 31!" : "🤜 Klopfen – Showdown";
          p.text(reason, W / 2, oy2 + 50);
        }
      }
    }

    // ---- p5 setup ----
    const P5 = window.p5;
    if (P5) {
      p5inst = new P5((p) => {
        p.setup = () => {
          const cnv = p.createCanvas(canvas.clientWidth || 400, canvas.clientHeight || 440);
          cnv.parent(canvas.parentElement);
          canvas.remove();
          p.textFont("var(--font)");
        };
        p.draw = () => {
          drawScene(p);
        };
        p.mousePressed = () => {
          if (!state || state.phase !== "pick" || state.turnId !== myId) return;
          const W = p.width, H = p.height, hbottom = H - CH / 2 - 20;
          // hand cards
          for (let ci = 0; ci < 3; ci++) {
            const hx = W / 2 - CW - 10 + ci * (CW + 10);
            if (p.mouseX > hx && p.mouseX < hx + CW && p.mouseY > hbottom - CH / 2 && p.mouseY < hbottom + CH / 2) {
              selectedCard = ci;
              updateButtons();
              return false;
            }
          }
          // deck
          const dx = W / 2 - CW - 10, disx = W / 2 + 10, cy2 = H / 2;
          if (selectedCard >= 0 && p.mouseX > dx && p.mouseX < dx + CW && p.mouseY > cy2 - CH / 2 && p.mouseY < cy2 + CH / 2) {
            ctx.send("draw", { from: "deck", discard: selectedCard });
            selectedCard = -1;
            updateButtons();
            return false;
          }
          if (selectedCard >= 0 && p.mouseX > disx && p.mouseX < disx + CW && p.mouseY > cy2 - CH / 2 && p.mouseY < cy2 + CH / 2) {
            ctx.send("draw", { from: "discard", discard: selectedCard });
            selectedCard = -1;
            updateButtons();
            return false;
          }
          return false;
        };
        p.windowResized = () => {
          const el = p.canvas.parentElement;
          if (el) p.resizeCanvas(el.clientWidth, el.clientHeight);
        };
      });
    }

    // ---- button handlers ----
    function updateButtons() {
      const isMyTurn = state && state.phase === "pick" && state.turnId === myId;
      const canKnock = isMyTurn && !state.knockerId;
      passBtn.disabled = !isMyTurn;
      knockBtn.disabled = !canKnock;
    }

    passBtn.addEventListener("click", () => {
      if (state?.phase === "pick" && state.turnId === myId) {
        ctx.send("pass", {});
        selectedCard = -1;
        updateButtons();
      }
    });
    knockBtn.addEventListener("click", () => {
      if (state?.phase === "pick" && state.turnId === myId && !state.knockerId) {
        ctx.send("knock", {});
        selectedCard = -1;
        updateButtons();
      }
    });

    // ---- state sync ----
    function applyState(newState) {
      state = newState;
      selectedCard = -1;
      updateButtons();
      updateStatusLine();
    }

    function updateStatusLine() {
      if (!state) { statusEl.textContent = "Warte auf Start…"; return; }
      const turnPlayer = ctx.players.find((p) => p.id === state.turnId);
      if (state.phase === "pick") {
        statusEl.textContent = state.turnId === myId ? "Du bist dran!" : `${esc(turnPlayer?.name ?? "?")} ist dran…`;
      } else if (state.phase === "roundEnd") {
        const loserNames = (state.losers ?? []).map((id) => {
          const pl = ctx.players.find((p) => p.id === id);
          return id === myId ? "Du" : esc(pl?.name ?? "?");
        });
        statusEl.textContent = "Runde: " + (loserNames.length ? loserNames.join(", ") + " verliert ein Leben" : "Unentschieden");
      } else if (state.phase === "gameOver") {
        const winner = ctx.players.find((p) => p.id === state.winnerId);
        statusEl.textContent = state.winnerId === myId ? "🎉 Du hast gewonnen!" : `${esc(winner?.name ?? "?")} hat gewonnen!`;
      }
    }

    // ---- messages ----
    ctx.onMessage("state", ({ data }) => applyState(data));
    ctx.onMessage("hand", ({ data }) => { myHand = data.cards ?? []; });

    // ---- host logic ----
    let hostState = null;

    function hostBroadcast() {
      // Build public state (no private hands)
      const pub = {
        phase: hostState.phase,
        turnId: ctx.players[hostState.turn]?.id ?? null,
        knockerId: hostState.knocker >= 0 ? ctx.players[hostState.knocker]?.id ?? null : null,
        deckCount: hostState.deck.length,
        discardTop: hostState.discard.length > 0 ? hostState.discard[hostState.discard.length - 1] : null,
        lives: {},
        maxLives: hostState.maxLives,
        scores: null,
        losers: null,
        revealedHands: null,
        roundReason: null,
        winnerId: null,
      };
      for (let i = 0; i < ctx.players.length; i++) {
        pub.lives[ctx.players[i].id] = hostState.lives[i];
      }
      if (hostState.phase === "roundEnd" || hostState.phase === "gameOver") {
        pub.scores = {};
        pub.revealedHands = {};
        pub.losers = (hostState.losers ?? []).map((i) => ctx.players[i]?.id);
        pub.roundReason = hostState.roundReason;
        for (let i = 0; i < ctx.players.length; i++) {
          pub.scores[ctx.players[i].id] = handScore(hostState.hands[i]);
          pub.revealedHands[ctx.players[i].id] = hostState.hands[i];
        }
        pub.winnerId = hostState.phase === "gameOver" ? ctx.players[hostState.winner]?.id : null;
      }
      ctx.send("state", pub);

      // Send private hands
      for (let i = 0; i < ctx.players.length; i++) {
        const pid = ctx.players[i].id;
        ctx.send("hand", { cards: hostState.hands[i] }, pid);
        if (pid === myId) myHand = hostState.hands[i];
      }

      applyState(pub);
    }

    function hostNewRound() {
      const deck = shuffle(buildDeck());
      const players = ctx.players;
      const pcount = players.length;
      const hands = [];
      const discard = [];
      for (let i = 0; i < pcount; i++) hands.push([deck.pop(), deck.pop(), deck.pop()]);
      discard.push(deck.pop());

      hostState = {
        phase: "pick",
        turn: 0,
        knocker: -1,
        knockRound: false,
        turnsAfterKnock: 0,
        deck,
        discard,
        hands,
        lives: hostState?.lives ?? Array(pcount).fill(hostState?.maxLives ?? 3),
        maxLives: hostState?.maxLives ?? 3,
        pcount,
        losers: null,
        roundReason: null,
        winner: -1,
      };

      // Check instant 31
      for (let i = 0; i < pcount; i++) {
        if (handScore(hands[i]) === 31) { hostEndRound("fire", i); return; }
      }
      hostBroadcast();
      scheduleAiIfNeeded();
    }

    function hostHandleAction(pidx, action, data) {
      if (hostState.phase !== "pick") return;
      if (hostState.turn !== pidx) return;

      const hand = hostState.hands[pidx];

      if (action === "draw") {
        const { from, discard: discardIdx } = data;
        if (discardIdx < 0 || discardIdx > 2) return;
        if (from === "deck") {
          if (hostState.deck.length === 0) hostReshuffleDeck();
          if (hostState.deck.length === 0) return;
          const drawn = hostState.deck.pop();
          hostState.discard.push(hand[discardIdx]);
          hand[discardIdx] = drawn;
        } else if (from === "discard") {
          if (hostState.discard.length === 0) return;
          const drawn = hostState.discard.pop();
          hostState.discard.push(hand[discardIdx]);
          hand[discardIdx] = drawn;
        }
        // Check 31
        if (handScore(hand) === 31) { hostEndRound("fire", pidx); return; }
      } else if (action === "knock") {
        if (hostState.knocker >= 0) return;
        hostState.knocker = pidx;
        hostState.knockRound = true;
        hostState.turnsAfterKnock = 0;
      }
      // pass = do nothing (just advance turn)

      hostAdvanceTurn();
    }

    function hostAdvanceTurn() {
      if (hostState.knockRound) {
        hostState.turnsAfterKnock++;
        if (hostState.turnsAfterKnock >= hostState.pcount) {
          hostEndRound("knock", hostState.knocker);
          return;
        }
      }
      hostState.turn = (hostState.turn + 1) % hostState.pcount;
      hostBroadcast();
      scheduleAiIfNeeded();
    }

    function hostReshuffleDeck() {
      if (hostState.discard.length <= 1) return;
      const top = hostState.discard.pop();
      hostState.deck = shuffle([...hostState.discard]);
      hostState.discard = [top];
    }

    function hostEndRound(reason, whoKnocked) {
      const scores = hostState.hands.map(handScore);
      const minScore = Math.min(...scores);
      const losers = [];
      if (reason === "fire") {
        for (let i = 0; i < hostState.pcount; i++) if (i !== whoKnocked) losers.push(i);
      } else {
        for (let i = 0; i < hostState.pcount; i++) if (scores[i] === minScore) losers.push(i);
      }
      for (const l of losers) {
        const penalty = reason !== "fire" && l === whoKnocked ? 2 : 1;
        hostState.lives[l] = Math.max(0, hostState.lives[l] - penalty);
      }
      hostState.losers = losers;
      hostState.roundReason = reason;

      const alive = hostState.lives.filter((l) => l > 0).length;
      if (alive <= 1) {
        hostState.winner = hostState.lives.findIndex((l) => l > 0);
        hostState.phase = "gameOver";
        hostBroadcast();
        // End game after delay
        setTimeout(() => ctx.end(), 6000);
      } else {
        hostState.phase = "roundEnd";
        hostBroadcast();
        setTimeout(() => {
          // remove eliminated
          const toRemove = [];
          for (let i = 0; i < hostState.lives.length; i++) if (hostState.lives[i] <= 0) toRemove.push(i);
          toRemove.sort((a, b) => b - a);
          for (const i of toRemove) {
            hostState.hands.splice(i, 1);
            hostState.lives.splice(i, 1);
          }
          hostState.pcount = hostState.lives.length;
          hostNewRound();
        }, 4000);
      }
    }

    let aiTimer = null;
    function scheduleAiIfNeeded() {
      if (!ctx.isHost) return;
      const turnPlayer = ctx.players[hostState.turn];
      if (!turnPlayer || turnPlayer.id === myId) return;
      // It's an AI/absent turn — but in real multiplayer everyone is human
      // For hub multiplayer: if a player has left, skip them automatically
    }

    // Handle incoming intents from other players (host only)
    if (ctx.isHost) {
      ctx.onMessage("draw", ({ data, from }) => {
        const pidx = ctx.players.findIndex((p) => p.id === from);
        if (pidx >= 0) hostHandleAction(pidx, "draw", data);
      });
      ctx.onMessage("pass", ({ data, from }) => {
        const pidx = ctx.players.findIndex((p) => p.id === from);
        if (pidx >= 0) hostHandleAction(pidx, "pass", {});
      });
      ctx.onMessage("knock", ({ data, from }) => {
        const pidx = ctx.players.findIndex((p) => p.id === from);
        if (pidx >= 0) hostHandleAction(pidx, "knock", {});
      });
    }

    // On my own draw/pass/knock (if I am not host): just send, host handles
    // If I am host, treat myself directly
    const origPassBtn = passBtn;
    if (ctx.isHost) {
      passBtn.addEventListener("click", () => {}, { once: false }); // already handled above
    }

    // Handle player leaving mid-game (host skips them)
    ctx.onEvent("leave", (player) => {
      if (!ctx.isHost || !hostState || hostState.phase !== "pick") return;
      const pidx = ctx.players.findIndex((p) => p.id === player.id);
      if (pidx === hostState.turn) hostAdvanceTurn();
    });

    return {
      go() {
        if (ctx.isHost) {
          hostState = { maxLives: 3, lives: Array(ctx.players.length).fill(3) };
          hostNewRound();
        }
      },
      destroy() {
        if (p5inst) { p5inst.remove(); p5inst = null; }
        if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      },
    };
  },
};
