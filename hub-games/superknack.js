// Superknack für den Multiplayer-Hub.
//
// 2–6 Spieler. Französisches Blatt, 32 Karten (7–A).
// Ass = 11, Bildkarten = 10, Zahlen zählen.
// Ziel: 31 Punkte in einer Farbe. Wer am wenigsten hat, verliert ein Leben.
// 31 in der Hand = sofort alle anderen verlieren ein Leben.
// Klopfen = letzte Runde, dann Showdown.
//
// Kartenbild: gemeinsames cards.js (PlayingCards) — dieselben Blätter wie in den anderen Kartenspielen.
// Animationen: Austeilen, Tausch-Flüge vom Stapel, Aufdecken am Rundenende, Puls beim Klopfen.
// Passen/Klopfen liegen als Knöpfe auf dem Tisch, nicht nur in einer Button-Zeile.
//
// Host besitzt Deck + Regeln und verteilt den State nach jedem Zug.
// Gäste schicken Intents ("draw", "pass", "knock").

import { shell } from "../hub-kit.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- constants ----
const SUITS = ["♠", "♥", "♦", "♣"];
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

// ---- deck design button ----
let deckListenerInstalled = false;
function refreshDeckButton() {
  const b = document.getElementById("sk-deck");
  if (b && window.PlayingCards) b.textContent = "Karten: " + PlayingCards.current().name;
}

const CSS = `
.sk { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; padding: 8px 0; font-family: var(--font); }
.sk-table { position: relative; width: min(620px, 100%); aspect-ratio: 1.1; border-radius: 20px;
  background: radial-gradient(ellipse 100% 90% at 50% 38%, #2e7a4b 0%, #1a5533 58%, #0c3522 100%);
  box-shadow: 0 10px 34px rgba(0,0,0,.55), 0 0 0 6px #5a3016, 0 0 0 9px #341a08, inset 0 0 60px rgba(0,0,0,.35); }
.sk-table::after { content: ""; position: absolute; inset: 14px; border-radius: 50% / 46%; pointer-events: none;
  border: 1px solid rgba(255,220,150,.16); box-shadow: inset 0 0 30px rgba(0,0,0,.28); }
.sk-table canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 20px; }
.sk-bar { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; width: min(620px, 100%); }
.sk-status { font: 600 14px var(--font); color: var(--muted); min-height: 20px; text-align: center; }
.sk-deck { flex: none; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--panel);
  color: var(--ink); font: 600 12px var(--font); cursor: pointer; }
.sk-deck:hover { background: var(--panelHi); }
.sk-info { font: 400 12px var(--font); color: var(--muted); text-align: center; max-width: 520px; }
@media (max-width: 520px) { .sk-table { aspect-ratio: 1; } }
`;

export default {
  min: 2,
  max: 6,

  mount(ctx) {
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
        <div class="sk-bar">
          <span class="sk-status" id="sk-status">Warte auf Start…</span>
          <button type="button" class="sk-deck" id="sk-deck"></button>
        </div>
        <div class="sk-info">Klicke eine Handkarte und dann Stapel oder Ablage zum Tauschen – oder umgekehrt. Passen und Klopfen liegen unten auf dem Tisch.</div>
      </div>`;

    const canvas = body.querySelector("#sk-canvas");
    const statusEl = body.querySelector("#sk-status");
    const deckBtn = body.querySelector("#sk-deck");
    deckBtn.addEventListener("click", () => PlayingCards.openMenu(deckBtn));
    if (!deckListenerInstalled) { PlayingCards.onChange(refreshDeckButton); deckListenerInstalled = true; }
    refreshDeckButton();
    ctx.addCleanup(() => { const b = document.getElementById("sk-deck"); if (b) b.textContent = ""; });

    // ---- game state (mirrored from host) ----
    let state = null;
    let myHand = [];
    let selectedCard = -1;
    let selectedPile = null;   // "deck" | "discard" picked before the hand card
    const myId = ctx.me.id;

    // ---- logical canvas (480 × 480, scaled into the table) ----
    const LW = 480, LH = 480;
    const CARD_W = 58, CARD_H = 83, CARD_R = 8;
    const OPP_W = 40, OPP_H = 57;
    const HAND_GAP = 12;
    const HAND_Y = LH - CARD_H - 12;
    const HAND_X0 = LW / 2 - (3 * CARD_W + 2 * HAND_GAP) / 2;
    const PILE_Y = 168;

    // ---- p5 instance aliases ----
    // The hub runs every game in p5 instance mode, so the bare p5 globals only exist
    // on the instance. bindP5() hands them to the drawing helpers below.
    let background, fill, noFill, noStroke, stroke, strokeWeight, rect, circle, ellipse,
      text, textAlign, textStyle, textSize, textWidth, push, pop, translate, scale,
      sin, cos, millis, max, min, drawingContext,
      BOLD, NORMAL, CENTER, LEFT, RIGHT;
    function bindP5(p) {
      background = p.background.bind(p);
      fill = p.fill.bind(p);
      noFill = p.noFill.bind(p);
      noStroke = p.noStroke.bind(p);
      stroke = p.stroke.bind(p);
      strokeWeight = p.strokeWeight.bind(p);
      rect = p.rect.bind(p);
      circle = p.circle.bind(p);
      ellipse = p.ellipse.bind(p);
      text = p.text.bind(p);
      textAlign = p.textAlign.bind(p);
      textStyle = p.textStyle.bind(p);
      textSize = p.textSize.bind(p);
      textWidth = p.textWidth.bind(p);
      push = p.push.bind(p);
      pop = p.pop.bind(p);
      translate = p.translate.bind(p);
      scale = p.scale.bind(p);
      sin = Math.sin;
      cos = Math.cos;
      millis = () => p.millis();
      max = Math.max;
      min = Math.min;
      drawingContext = p.drawingContext;
      BOLD = p.BOLD; NORMAL = p.NORMAL; CENTER = p.CENTER; LEFT = p.LEFT; RIGHT = p.RIGHT;
    }

    // ---- animation state ----
    let flights = [];
    let hidden = new Set();
    let deckShakeT = 0;
    let discardPulse = 0;
    let discardFlipAt = 0;     // the new top card flips over when the discard changes
    let revealAt = 0;
    let knockAt = 0;
    let prevPhase = "";
    let prevDiscard = null;
    let prevKnocker = null;
    let lastAnimSeq = -1;
    let dealRound = -1;

    // ---- shared deck (cards.js) ----
    const PC_RANK = [7, 8, 9, 10, 11, 12, 13, 1];
    function drawFace(card, x, y, w, h) {
      window.PlayingCards.face(drawingContext, x, y, w, h, PC_RANK[RANK_OF(card)], SUIT_OF(card));
    }
    function drawBack(x, y, w, h) {
      window.PlayingCards.back(drawingContext, x, y, w, h);
    }

    function drawCardAt(x, y, w, h, card, faceUp, o = {}) {
      const { selected = false, dimmed = false, sx = 1, lift = 0 } = o;
      const r = w * 0.09;
      push();
      noStroke();
      const cx = x + w / 2, cy = y + h / 2;
      fill(0, 0, 0, 34 + lift * 34);
      rect(x + 1, y + 3 + lift * 4, w, h, r);
      if (selected) {
        const pulse = 0.5 + 0.5 * sin(millis() / 260);
        fill(130, 100, 230, 60 + pulse * 50);
        rect(x - 5, y - 7, w + 10, h + 12, r + 5);
      }
      if (sx !== 1) {
        translate(cx, cy); scale(max(0.02, sx), 1); translate(-cx, -cy);
      }
      if (faceUp && card != null) drawFace(card, x, y, w, h);
      else drawBack(x, y, w, h);
      if (dimmed) { noStroke(); fill(12, 40, 26, 120); rect(x, y, w, h, r); }
      pop();
    }

    function handPos(ci) { return { x: HAND_X0 + ci * (CARD_W + HAND_GAP), y: HAND_Y }; }
    function deckPos() { return { x: LW / 2 - CARD_W - 12, y: PILE_Y }; }
    function discardPos() { return { x: LW / 2 + 12, y: PILE_Y }; }

    // seats sit on a ring around the table; the human keeps the bottom
    function seatPos(i, n) {
      const a = (n === 1 ? 270 : 150 + i * (240 / (n - 1))) * Math.PI / 180;
      return {
        x: LW / 2 + 180 * Math.cos(a),
        y: 232 + 188 * Math.sin(a) - OPP_H / 2,
        a,
      };
    }

    // ---- animation ----
    const now = () => performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    function fly(card, from, to, dur = 280, delay = 0, faceUp = true, size = null) {
      const s = size || { w: CARD_W, h: CARD_H };
      flights.push({ card, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t0: now() + delay, dur, faceUp, w: s.w, h: s.h });
      if (card != null) hidden.add(card);
    }
    function clearFlights() { flights = []; hidden.clear(); }

    function drawFlights() {
      const t0 = now();
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        const t = (t0 - f.t0) / f.dur;
        if (t < 0) continue;
        if (t >= 1) { flights.splice(i, 1); if (f.card != null) hidden.delete(f.card); continue; }
        const e = easeOut(t);
        const lift = 1 - Math.abs(e * 2 - 1);
        drawCardAt(f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e - lift * 6,
          f.w, f.h, f.card, f.faceUp, { lift });
      }
    }

    function maybeDeal() {
      if (!state || state.round === dealRound) return;
      dealRound = state.round;
      const src = deckPos();
      const others = otherPlayers();
      for (let i = 0; i < others.length; i++) {
        const sp = seatPos(i, others.length);
        for (let ci = 0; ci < 3; ci++) {
          fly(null, src, { x: sp.x + (ci - 1) * 14 - OPP_W / 2, y: sp.y }, 330, 60 + (i * 3 + ci) * 38, false, { w: OPP_W, h: OPP_H });
        }
      }
    }

    function maybeAnimateAction() {
      if (!state || !state.last || state.last.seq === lastAnimSeq) return;
      const { type, by, from, slot, seq } = state.last;
      if (type !== "draw") { lastAnimSeq = seq; return; }
      const src = from === "discard" ? discardPos() : deckPos();
      if (by === myId) {
        const card = myHand[slot];
        if (card == null) return;                    // hand message not here yet — retry then
        fly(card, src, handPos(slot), 290, 0, true);
      } else {
        const pi = ctx.players.findIndex((p) => p.id === by);
        if (pi < 0) { lastAnimSeq = seq; return; }
        const others = otherPlayers();
        const oi = others.indexOf(pi);
        if (oi < 0) { lastAnimSeq = seq; return; }
        const sp = seatPos(oi, others.length);
        fly(null, src, { x: sp.x - OPP_W / 2, y: sp.y }, 320, 0, false, { w: OPP_W, h: OPP_H });
      }
      lastAnimSeq = seq;
    }

    // ---- players ----
    function otherPlayers() {
      const n = ctx.players.length;
      const mi = ctx.players.findIndex((p) => p.id === myId);
      if (mi < 0) return ctx.players.map((_, i) => i);
      return Array.from({ length: n - 1 }, (_, k) => (mi + 1 + k) % n);
    }

    // ---- avatars ----
    const avatarCache = new Map();
    function avatarImage(file) {
      if (!file) return null;
      let e = avatarCache.get(file);
      if (!e) {
        e = { img: new Image(), ok: false };
        e.img.onload = () => { e.ok = true; };
        e.img.onerror = () => { e.ok = false; };
        e.img.src = "/avatar/" + file;
        avatarCache.set(file, e);
      }
      return e.ok ? e.img : null;
    }
    function drawAvatar(pl, x, y, r) {
      push();
      const img = avatarImage(pl.avatar);
      if (img) {
        drawingContext.save();
        drawingContext.beginPath(); drawingContext.arc(x, y, r, 0, Math.PI * 2); drawingContext.clip();
        drawingContext.drawImage(img, x - r, y - r, r * 2, r * 2);
        drawingContext.restore();
      } else {
        noStroke(); fill(hexRgb(pl.color) || [106, 95, 138]);
        circle(x, y, r * 2);
        fill(255); textAlign(CENTER, CENTER); textStyle(BOLD); textSize(r * 0.95);
        text((pl.name || "?").trim().charAt(0).toUpperCase(), x, y + 0.5);
      }
      noFill(); stroke(255, 255, 255, 110); strokeWeight(1);
      circle(x, y, r * 2);
      pop();
    }
    function hexRgb(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // ---- drawing ----
    function drawTable() {
      background(23, 70, 44);
      const pulse = 0.5 + 0.5 * sin(millis() / 900);
      noStroke();
      for (let i = 0; i < 4; i++) {
        fill(255, 255, 255, 8 + i * 3);
        ellipse(LW / 2, LH / 2 - 16, 420 - i * 50, 320 - i * 40);
      }
      fill(255, 236, 190, 15);
      textAlign(CENTER, CENTER); textStyle(BOLD); textSize(86);
      text("31", LW / 2, LH / 2 - 8);
    }

    function chip(x, y, w, h, on, alpha = 255) {
      noStroke();
      fill(0, 0, 0, 70);
      rect(x + 1, y + 3, w, h, h / 2);
      fill(on ? 118 : 44, on ? 92 : 96, on ? 214 : 66, alpha);
      rect(x, y, w, h, h / 2);
    }

    function drawSeat(pi, oi, n) {
      const pl = ctx.players[pi];
      if (!pl) return;
      const sp = seatPos(oi, n);
      const isTurn = state.turnId === pl.id;
      const lv = state.lives ? state.lives[pl.id] ?? state.maxLives : state.maxLives;
      const max = state.maxLives ?? 3;
      const revealed = (state.phase === "roundEnd" || state.phase === "gameOver") && state.revealedHands;
      const hand = revealed ? state.revealedHands[pl.id] : null;
      const pulse = 0.5 + 0.5 * sin(millis() / 300);
      const t = now();

      // turn glow around seat
      if (isTurn) {
        noFill(); stroke(130, 100, 230, 90 + pulse * 120); strokeWeight(2.5);
        rect(sp.x - 44, sp.y - 8, 88, OPP_H + 40, 14);
        noStroke();
      }

      for (let ci = 0; ci < 3; ci++) {
        const x = sp.x + (ci - 1) * 14 - OPP_W / 2;
        let faceUp = false, sx = 1;
        if (revealed && hand) {
          const k = Math.max(0, Math.min(1, (t - revealAt - ci * 110) / 260));
          sx = easeOut(k); faceUp = k > 0.5;
        }
        if (hidden.has(hand && hand[ci])) continue;
        drawCardAt(x, sp.y, OPP_W, OPP_H, hand ? hand[ci] : null, faceUp, { sx });
      }

      // plate
      textStyle(BOLD); textSize(10);
      const label = pl.name || "?";
      const tw = Math.max(58, textWidth(label) + 34);
      const py = sp.y + OPP_H + 8;
      chip(sp.x - tw / 2, py, tw, 22, isTurn);
      drawAvatar(pl, sp.x - tw / 2 + 13, py + 11, 8);
      fill(isTurn ? 255 : 235, isTurn ? 255 : 240, 255);
      textAlign(LEFT, CENTER);
      text(label, sp.x - tw / 2 + 25, py + 11);

      // lives
      const r = 3.4, gap = 9;
      const total = max * gap - gap + r * 2;
      const lx = sp.x - total / 2 + r;
      for (let k = 0; k < max; k++) {
        noStroke();
        if (k < lv) { fill(255, 96, 112); circle(lx + k * gap, py + 30, r * 2); }
        else { fill(255, 255, 255, 45); circle(lx + k * gap, py + 30, r * 2); }
      }

      // knock + score
      if (state.knockerId === pl.id) {
        fill(255, 250, 235); noStroke();
        textStyle(BOLD); textSize(9);
        const bw = 62;
        rect(sp.x - bw / 2, sp.y - 20, bw, 15, 7);
        fill(196, 46, 40);
        textAlign(CENTER, CENTER);
        text("🤜 KLOPFT", sp.x, sp.y - 12.5);
      }
      if ((state.phase === "roundEnd" || state.phase === "gameOver") && state.scores) {
        const sc = state.scores[pl.id];
        if (sc != null) {
          noStroke(); fill(255, 236, 180, 210);
          textStyle(BOLD); textSize(10); textAlign(CENTER, CENTER);
          text(sc + " Pkt.", sp.x, py + 44);
        }
      }
    }

    function pileGlow(x, y, active, canPick, hover) {
      const pulse = 0.5 + 0.5 * sin(millis() / 300);
      if (active) {
        noStroke(); fill(130, 100, 230, 70 + pulse * 70);
        rect(x - 6, y - 6, CARD_W + 12, CARD_H + 12, CARD_R + 5);
      } else if (canPick && hover) {
        noStroke(); fill(116, 226, 178, 45);
        rect(x - 6, y - 6, CARD_W + 12, CARD_H + 12, CARD_R + 5);
      }
    }
    function pileTag(x, y, txt, active) {
      textAlign(CENTER, CENTER); textSize(9); textStyle(active ? BOLD : NORMAL);
      const w = textWidth(txt) + 16;
      noStroke();
      if (active) { fill(130, 100, 230); rect(x - w / 2, y - 7, w, 15, 7.5); }
      fill(active ? 255 : 255, active ? 255 : 255, 255, active ? 255 : 120);
      text(txt, x, y);
    }

    function drawDeck() {
      const d = deckPos();
      const canPick = state.phase === "pick" && state.turnId === myId && selectedCard < 0;
      const hover = mouseX_logical >= d.x && mouseX_logical <= d.x + CARD_W && mouseY_logical >= d.y && mouseY_logical <= d.y + CARD_H;
      pileGlow(d.x, d.y, selectedPile === "deck", canPick, hover);
      const shake = deckShakeT > 0 ? sin(deckShakeT * 0.8) * 3 : 0;
      if (deckShakeT > 0) deckShakeT--;
      for (let k = 2; k >= 0; k--) {
        push(); translate(shake + k * 2.5, -k * 2.5);
        drawCardAt(d.x, d.y, CARD_W, CARD_H, null, false);
        pop();
      }
      noStroke(); fill(255, 255, 255, 220);
      textAlign(CENTER, CENTER); textStyle(BOLD); textSize(10);
      text(state.deckCount ?? "?", d.x + CARD_W / 2 + shake, d.y + CARD_H / 2);
      pileTag(d.x + CARD_W / 2, d.y + CARD_H + 8, "Stapel", selectedPile === "deck");
    }

    function drawDiscard() {
      const d = discardPos();
      const canPick = state.phase === "pick" && state.turnId === myId && selectedCard < 0;
      const hover = mouseX_logical >= d.x && mouseX_logical <= d.x + CARD_W && mouseY_logical >= d.y && mouseY_logical <= d.y + CARD_H;
      pileGlow(d.x, d.y, selectedPile === "discard", canPick, hover);
      if (state.discardTop == null) {
        noFill(); stroke(255, 255, 255, 90); strokeWeight(1.5);
        rect(d.x, d.y, CARD_W, CARD_H, CARD_R);
        noStroke();
      } else {
        noStroke(); fill(0, 0, 0, 70);
        rect(d.x + 3, d.y + 3, CARD_W, CARD_H, CARD_R);
        if (discardPulse > 0) {
          const p = discardPulse / 20;
          noStroke(); fill(116, 226, 178, 30 + p * 50);
          rect(d.x - 5, d.y - 5, CARD_W + 10, CARD_H + 10, CARD_R + 4);
          discardPulse--;
        }
        // a newly revealed top card flips over
        let sx = 1;
        if (discardFlipAt) {
          const k = Math.max(0, Math.min(1, (now() - discardFlipAt) / 280));
          if (k >= 1) discardFlipAt = 0;
          else sx = max(0.05, Math.abs(Math.cos(Math.PI * easeOut(k))));
        }
        if (!hidden.has(state.discardTop)) drawCardAt(d.x, d.y, CARD_W, CARD_H, state.discardTop, true, { sx });
      }
      pileTag(d.x + CARD_W / 2, d.y + CARD_H + 8, "Ablage", selectedPile === "discard");
    }

    function drawMySide() {
      const isMyTurn = state.phase === "pick" && state.turnId === myId;
      const lv = state.lives ? state.lives[myId] ?? state.maxLives : state.maxLives;
      const max = state.maxLives ?? 3;
      const me = ctx.players.find((p) => p.id === myId);

      // hand
      for (let ci = 0; ci < 3; ci++) {
        const p = handPos(ci);
        const card = myHand[ci];
        if (card != null && hidden.has(card)) continue;
        const sel = selectedCard === ci;
        const armed = isMyTurn && !!selectedPile;
        const hover = isMyTurn && mouseX_logical >= p.x && mouseX_logical <= p.x + CARD_W && mouseY_logical >= p.y && mouseY_logical <= p.y + CARD_H;
        const lift = sel ? 10 : hover ? 5 : 0;
        if (armed) {
          const pulse = 0.5 + 0.5 * sin(millis() / 280 + ci * 0.7);
          noStroke(); fill(116, 226, 178, 30 + pulse * 50);
          rect(p.x - 4, p.y - lift - 5, CARD_W + 8, CARD_H + 10, CARD_R + 4);
        }
        drawCardAt(p.x, p.y - lift, CARD_W, CARD_H, card, true, {
          selected: sel,
          dimmed: selectedCard >= 0 && selectedCard !== ci,
        });
      }

      // plate with avatar + lives + knock
      const pulse = 0.5 + 0.5 * sin(millis() / 300);
      const plateW = 96, px = LW / 2 - plateW / 2, py = HAND_Y - 32;
      if (isMyTurn) {
        noFill(); stroke(130, 100, 230, 100 + pulse * 120); strokeWeight(2);
        rect(px - 5, py - 5, plateW + 10, 42, 14);
        noStroke();
      }
      chip(px, py, plateW, 22, isMyTurn);
      if (me) drawAvatar(me, px + 14, py + 11, 8);
      fill(isMyTurn ? 255 : 235);
      textAlign(LEFT, CENTER); textStyle(BOLD); textSize(10);
      text("Du", px + 27, py + 11);
      const r = 3.4, gap = 9, total = max * gap - gap + r * 2;
      for (let k = 0; k < max; k++) {
        noStroke();
        if (k < lv) { fill(255, 96, 112); circle(LW / 2 - total / 2 + r + k * gap, py + 30, r * 2); }
        else { fill(255, 255, 255, 45); circle(LW / 2 - total / 2 + r + k * gap, py + 30, r * 2); }
      }
      if (state.knockerId === myId) {
        noStroke(); fill(255, 250, 235);
        textStyle(BOLD); textSize(9); textAlign(CENTER, CENTER);
        rect(LW / 2 - 31, py - 20, 62, 15, 7);
        fill(196, 46, 40);
        text("🤜 KLOPFT", LW / 2, py - 12.5);
      }
    }

    function actionRects() {
      const w = 96, h = 31, gap = 12, y = 296;
      const canKnock = !state.knockerId;
      return {
        pass: { x: LW / 2 - w - gap / 2, y, w, h },
        knock: { x: LW / 2 + gap / 2, y, w, h, disabled: !canKnock },
      };
    }

    function pill(r, label, accent, hover, disabled) {
      push();
      noStroke();
      fill(0, 0, 0, 70);
      rect(r.x + 1, r.y + 3, r.w, r.h, r.h / 2);
      fill(accent ? 130 : 44, accent ? 100 : 96, accent ? 230 : 66, disabled ? 90 : hover ? 255 : 235);
      rect(r.x, r.y, r.w, r.h, r.h / 2);
      if (accent && !disabled && hover) {
        noFill(); stroke(180, 160, 255, 220); strokeWeight(1.5);
        rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, r.h / 2 + 2);
      }
      noStroke();
      fill(accent ? 255 : 235, 255, 255, disabled ? 120 : 255);
      textAlign(CENTER, CENTER); textStyle(BOLD); textSize(12);
      text(label, r.x + r.w / 2, r.y + r.h / 2);
      pop();
    }

    function drawTurnBar() {
      const myTurn = state.phase === "pick" && state.turnId === myId;
      if (myTurn) {
        const r = actionRects();
        const hoverPass = inRect(r.pass), hoverKnock = !r.knock.disabled && inRect(r.knock);
        pill(r.pass, "Passen", false, hoverPass, false);
        pill(r.knock, "Klopfen", true, hoverKnock, r.knock.disabled);
        fill(230, 255, 240, 150); textAlign(CENTER, CENTER); textSize(9); textStyle(NORMAL);
        text("Tasten: P / K", LW / 2, r.pass.y + r.pass.h + 12);
        return;
      }
      let msg = "", col = [255, 255, 255];
      if (state.phase === "ai-thinking" || state.phase === "pick") {
        const tp = ctx.players.find((p) => p.id === state.turnId);
        msg = `${tp ? tp.name : "?"} ist dran${".".repeat(1 + Math.floor(millis() / 350) % 3)}`;
        col = [200, 190, 255];
      } else if (state.phase === "roundEnd") {
        const losers = (state.losers ?? []).map((id) => id === myId ? "Du" : (ctx.players.find((p) => p.id === id)?.name ?? "?"));
        msg = losers.length ? `${losers.join(", ")} verliert ein Leben` : "Unentschieden";
        col = [255, 190, 190];
      } else if (state.phase === "gameOver") {
        const winner = ctx.players.find((p) => p.id === state.winnerId);
        msg = state.winnerId === myId ? "🎉 Du gewinnst!" : `${winner?.name ?? "?"} gewinnt!`;
        col = [255, 235, 160];
      }
      if (!msg) return;
      noStroke(); fill(0, 0, 0, 110);
      textStyle(BOLD); textSize(12);
      const w = textWidth(msg) + 34;
      rect(LW / 2 - w / 2, 296, w, 31, 15.5);
      fill(...col);
      textAlign(CENTER, CENTER);
      text(msg, LW / 2, 312);
    }

    function drawKnockWave() {
      if (!knockAt) return;
      const t = (now() - knockAt) / 900;
      if (t > 1) { knockAt = 0; return; }
      noFill(); stroke(255, 110, 140, 210 * (1 - t)); strokeWeight(3 - t * 2);
      circle(LW / 2, PILE_Y + CARD_H / 2, 40 + t * 260);
      noStroke(); fill(255, 110, 140, 235 * (1 - t));
      textAlign(CENTER, CENTER); textStyle(BOLD); textSize(18);
      text("KLOPF!", LW / 2, 120 - t * 16);
    }

    function drawOverlay() {
      if (!state || (state.phase !== "roundEnd" && state.phase !== "gameOver")) return;
      const ow = 320, oh = 110;
      const ox = LW / 2 - ow / 2, oy = LH / 2 - oh / 2;
      noStroke(); fill(0, 0, 0, 150); rect(ox + 2, oy + 5, ow, oh, 16);
      fill(246, 240, 219); rect(ox, oy, ow, oh, 16);
      fill(38, 42, 52); textAlign(CENTER, CENTER); textStyle(BOLD); textSize(18);
      text(state.phase === "gameOver" ? (state.winnerId === myId ? "🎉 Du gewinnst!" : "Spiel vorbei!") : "Runde beendet", LW / 2, oy + 22);
      if (state.roundReason) {
        fill(120, 96, 62); textStyle(NORMAL); textSize(12);
        text(state.roundReason === "fire" ? "🔥 Feuer – 31!" : "🤜 Klopfen – Showdown", LW / 2, oy + 46);
      }
      // winner & loser
      if (state.scores) {
        const ids = Object.keys(state.scores);
        let w = ids[0];
        for (const id of ids) if (state.scores[id] > state.scores[w]) w = id;
        const wName = w === myId ? "Du" : (ctx.players.find((p) => p.id === w)?.name ?? "?");
        fill(60, 140, 80); textStyle(BOLD); textSize(12);
        text(`Gewinner: ${wName} (${state.scores[w]})`, LW / 2, oy + 68);
        const loserNames = (state.losers ?? []).map((id) => (id === myId ? "Du" : (ctx.players.find((p) => p.id === id)?.name ?? "?")));
        fill(180, 60, 60); textStyle(NORMAL); textSize(12);
        text(`Verlierer: ${loserNames.join(", ")}`, LW / 2, oy + 90);
      }
    }

    function drawScene(p) {
      drawTable();
      if (!state) {
        noStroke(); fill(255, 255, 255, 170);
        textAlign(CENTER, CENTER); textStyle(BOLD); textSize(16);
        text("Warte auf Spielstart…", LW / 2, LH / 2);
        return;
      }
      const others = otherPlayers();
      for (let i = 0; i < others.length; i++) drawSeat(others[i], i, others.length);
      drawDeck();
      drawDiscard();
      drawMySide();
      drawTurnBar();
      drawFlights();
      drawKnockWave();
      drawOverlay();
    }

    // ---- p5 ----
    let p5inst = null;
    let mouseX_logical = -1, mouseY_logical = -1;
    function toLogical(p) {
      // p.mouseX/mouseY are CSS pixels relative to the canvas; map them into the 480×480
      // logical table. Derived from the element itself so it also works before the first draw.
      const el = (p.canvas && p.canvas.elt) || (p._curElement && p._curElement.elt);
      const r = el ? el.getBoundingClientRect() : { width: LW, height: LH };
      const s = Math.min((r.width || LW) / LW, (r.height || LH) / LH) || 1;
      const ox = ((r.width || LW) - LW * s) / 2, oy = ((r.height || LH) - LH * s) / 2;
      return { x: (p.mouseX - ox) / s, y: (p.mouseY - oy) / s };
    }

    const P5 = window.p5;
    if (P5) {
      p5inst = new P5((p) => {
        p.setup = () => {
          const parent = canvas.parentElement;
          const cnv = p.createCanvas(parent.clientWidth || 480, parent.clientHeight || 436);
          cnv.parent(parent);
          canvas.remove();
          p.textFont("system-ui, sans-serif");
          bindP5(p);
        };
        p.draw = () => {
          bindP5(p);
          const s = Math.min(p.width / LW, p.height / LH);
          const ox = (p.width - LW * s) / 2, oy = (p.height - LH * s) / 2;
          p._skScale = s; p._skOffX = ox; p._skOffY = oy;
          const m = toLogical(p);
          mouseX_logical = m.x; mouseY_logical = m.y;
          p.push(); p.translate(ox, oy); p.scale(s);
          drawScene(p);
          p.pop();
        };
        p.mousePressed = () => {
          if (!state) return false;
          const m = toLogical(p);
          if (m.x < 0 || m.y < 0 || m.x > LW || m.y > LH) return false;
          if (state.phase !== "pick" || state.turnId !== myId) return false;
          const r = actionRects();
          if (inRectLogical(r.pass, m)) { sendAction("pass", {}); return false; }
          if (!r.knock.disabled && inRectLogical(r.knock, m)) { sendAction("knock", {}); return false; }
          // hand cards: pick one, or — after a pile was armed — perform the swap
          for (let ci = 0; ci < 3; ci++) {
            const h = handPos(ci);
            if (m.x >= h.x && m.x <= h.x + CARD_W && m.y >= h.y && m.y <= h.y + CARD_H) {
              if (selectedPile) {
                const from = selectedPile;
                selectedPile = null;
                sendAction("draw", { from, discard: ci });
              } else {
                selectedCard = ci;
              }
              return false;
            }
          }
          // piles: click one first, then a hand card — or after a hand card
          const d = deckPos(), di = discardPos();
          if (m.x >= d.x && m.x <= d.x + CARD_W && m.y >= d.y && m.y <= d.y + CARD_H) {
            if (selectedCard >= 0) sendAction("draw", { from: "deck", discard: selectedCard });
            else { selectedPile = selectedPile === "deck" ? null : "deck"; selectedCard = -1; }
            return false;
          }
          if (m.x >= di.x && m.x <= di.x + CARD_W && m.y >= di.y && m.y <= di.y + CARD_H) {
            if (selectedCard >= 0) sendAction("draw", { from: "discard", discard: selectedCard });
            else { selectedPile = selectedPile === "discard" ? null : "discard"; selectedCard = -1; }
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

    function inRectLogical(r, m) { return m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h; }
    function inRect(r) { return inRectLogical(r, { x: mouseX_logical, y: mouseY_logical }); }

    // ---- actions ----
    function sendAction(type, data) {
      if (!state || state.phase !== "pick" || state.turnId !== myId) return;
      if (ctx.isHost) {
        const pidx = ctx.players.findIndex((p) => p.id === myId);
        if (pidx >= 0) hostHandleAction(pidx, type, data);
      } else {
        ctx.send(type, data);
      }
      selectedCard = -1;
      selectedPile = null;
    }

    function onKey(e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "p") sendAction("pass", {});
      else if (k === "k") sendAction("knock", {});
    }
    window.addEventListener("keydown", onKey);
    ctx.addCleanup(() => window.removeEventListener("keydown", onKey));

    // ---- state sync ----
    function applyState(newState) {
      const old = state;
      state = newState;
      if (!old || newState.round !== old.round) {
        selectedCard = -1;
        selectedPile = null;
        clearFlights();
        maybeDeal();
      } else if (newState.turnId !== old.turnId) {
        selectedCard = -1;
        selectedPile = null;
      }
      if (newState.discardTop !== prevDiscard) {
        prevDiscard = newState.discardTop;
        discardPulse = 20;
        discardFlipAt = now();
      }
      if (newState.knockerId && newState.knockerId !== prevKnocker) {
        knockAt = now();
      }
      prevKnocker = newState.knockerId;
      if (newState.phase !== prevPhase) {
        if (newState.phase === "roundEnd" || newState.phase === "gameOver") revealAt = now();
        prevPhase = newState.phase;
      }
      maybeAnimateAction();
      updateStatusLine();
    }

    function updateStatusLine() {
      if (!state) { statusEl.textContent = "Warte auf Start…"; return; }
      const tp = ctx.players.find((p) => p.id === state.turnId);
      if (state.phase === "pick") {
        statusEl.textContent = state.turnId === myId ? "Du bist dran!" : `${tp?.name ?? "?"} ist dran …`;
      } else if (state.phase === "roundEnd") {
        const losers = (state.losers ?? []).map((id) => id === myId ? "Du" : (ctx.players.find((p) => p.id === id)?.name ?? "?"));
        statusEl.textContent = "Runde: " + (losers.length ? losers.join(", ") + " verliert ein Leben" : "Unentschieden");
      } else if (state.phase === "gameOver") {
        const winner = ctx.players.find((p) => p.id === state.winnerId);
        statusEl.textContent = state.winnerId === myId ? "🎉 Du hast gewonnen!" : `${winner?.name ?? "?"} hat gewonnen!`;
      }
    }

    // ---- messages ----
    ctx.onMessage("state", ({ data }) => applyState(data));
    ctx.onMessage("hand", ({ data }) => {
      myHand = data.cards ?? [];
      maybeAnimateAction();
    });

    // ---- host logic ----
    let hostState = null;

    function hostBroadcast() {
      const pub = {
        round: hostState.round,
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
        last: hostState.last || null,
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
        round: (hostState?.round ?? 0) + 1,
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
        last: null,
        seq: hostState?.seq ?? 0,
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
      hostState.seq = (hostState.seq ?? 0) + 1;

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
        hostState.last = { by: ctx.players[pidx]?.id ?? null, type: "draw", from, slot: discardIdx, seq: hostState.seq };
        // Check 31
        if (handScore(hand) === 31) { hostEndRound("fire", pidx); return; }
      } else if (action === "knock") {
        if (hostState.knocker >= 0) return;
        hostState.knocker = pidx;
        hostState.knockRound = true;
        hostState.turnsAfterKnock = 0;
        hostState.last = { by: ctx.players[pidx]?.id ?? null, type: "knock", seq: hostState.seq };
      } else {
        hostState.last = { by: ctx.players[pidx]?.id ?? null, type: "pass", seq: hostState.seq };
      }

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
      deckShakeT = 20;
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
        setTimeout(() => ctx.end(), 6000);
      } else {
        hostState.phase = "roundEnd";
        hostBroadcast();
        setTimeout(() => {
          const toRemove = [];
          for (let i = 0; i < hostState.lives.length; i++) if (hostState.lives[i] <= 0) toRemove.push(i);
          toRemove.sort((a, b) => b - a);
          for (const i of toRemove) {
            hostState.hands.splice(i, 1);
            hostState.lives.splice(i, 1);
          }
          hostState.pcount = hostState.lives.length;
          hostNewRound();
        }, 4200);
      }
    }

    function scheduleAiIfNeeded() { /* every player is human; empty seats are handled on leave */ }

    // incoming intents (host only)
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

    // a player leaving mid-turn: skip them
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
        clearFlights();
      },
    };
  },
};
