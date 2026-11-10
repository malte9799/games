// Schach für den Mehrspieler-Hub — zwei Spieler am Brett, alle anderen schauen zu.
//
// Der Host ist Schiedsrichter: Gäste schicken nur ihren Zug (UCI, z. B. "e2e4"),
// der Host prüft ihn gegen die legalen Züge und schickt die komplette Stellung
// zurück. So kann niemand am Brett vorbei ziehen, und nach einem Reload genügt
// der letzte "state", um die Partie wiederherzustellen. Revanche tauscht die
// Farben; wer zusieht, kann danach nachrücken, wenn ein Platz frei wird.

import { shell } from "../hub-kit.js";
import * as E from "../games/schach-engine.js";

const V = window.SchachView;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const COLOR = ["Weiß", "Schwarz"];
const SOUND = (() => {
  try { return JSON.parse(localStorage.getItem("schach_state") || "{}").sound !== false; } catch { return true; }
})();

// A state that came over the wire is rebuilt from scratch before it is used.
function clean(d, ids) {
  if (!d || typeof d !== "object") return null;
  let pos;
  try { pos = E.parseFen(typeof d.fen === "string" ? d.fen : E.START_FEN); } catch { return null; }
  if (!pos || !Array.isArray(pos.board)) return null;

  const seat = (x) => (x === null || ids.has(x) ? x : null);
  if (!Array.isArray(d.seats) || d.seats.length !== 2) return null;
  const seats = [seat(d.seats[0]), seat(d.seats[1])];
  const square = (v) => Number.isInteger(v) && v >= 0 && v < 64 ? v : null;
  const last = d.last && square(d.last.from) !== null && square(d.last.to) !== null
    ? { from: d.last.from, to: d.last.to } : null;
  const r = d.result && typeof d.result === "object" ? d.result : null;
  const reason = r && ["checkmate", "stalemate", "fifty", "repetition", "material", "resign", "leave"].includes(r.reason) ? r.reason : null;
  return {
    rev: Number.isInteger(d.rev) && d.rev >= 0 ? d.rev : 0,
    round: Number.isInteger(d.round) && d.round >= 1 ? d.round : 1,
    seats,
    fen: E.toFen(pos),
    sans: Array.isArray(d.sans) ? d.sans.filter((s) => typeof s === "string").slice(0, 600).map((s) => s.slice(0, 12)) : [],
    last,
    phase: d.phase === "over" ? "over" : "play",
    result: r && r.over !== false && (reason || r.winner === "w" || r.winner === "b")
      ? { over: true, winner: r.winner === "w" || r.winner === "b" ? r.winner : null, reason, by: seat(r.by) }
      : null,
    check: !!d.check,
    cap: !!d.cap,
    gone: Array.isArray(d.gone) ? d.gone.filter((x) => ids.has(x)) : [],
  };
}

export default {
  min: 2, max: 6,

  mount(ctx) {
    const kit = shell(ctx, { title: "Schach" }), root = kit.body;
    V.injectStyle();

    root.innerHTML = `<div class="schach-hub">
      <div class="schach-boardwrap"><div class="schach-canvas"></div></div>
      <aside class="schach-side">
        <div class="schach-status"><span class="dot"></span><span class="txt">Warte auf den Host …</span></div>
        <div class="schach-players"></div>
        <div class="schach-moves"><div class="schach-moves-head"><span>Züge</span><span class="cnt"></span></div><div class="schach-moves-body"></div></div>
        <div class="row"><button type="button" data-act="flip">Brett drehen</button><button type="button" data-act="resign" hidden>Aufgeben</button><button type="button" data-act="result" hidden>Ergebnis</button></div>
        <p class="schach-note"></p>
      </aside>
    </div>`;

    const $ = (s) => root.querySelector(s);
    const wrap = $(".schach-boardwrap"), canvasHost = $(".schach-canvas");
    const statusEl = $(".schach-status"), statusTxt = $(".schach-status .txt");
    const playersEl = $(".schach-players"), movesBody = $(".schach-moves-body"), movesCnt = $(".schach-moves .cnt");
    const noteEl = $(".schach-note"), resultBtn = $("[data-act=result]"), resignBtn = $("[data-act=resign]");
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    const seen = new Set(ctx.players.map((p) => p.id));
    const me = () => ctx.me.id;
    const nm = (id) => esc(names.get(id) || "?") + (id === me() ? " (du)" : "");

    let st = null;                       // authoritative snapshot (host) / last received snapshot (guest)
    let cur = null;                      // parsed position that belongs to st
    let keys = [];                       // repetition history (host only; rebuilt after a reload)
    let board = null, pf = null;
    let animateNext = null;
    let flipPref = null;
    let lastSeatKey = "";
    let boardRev = -1;
    let seenSans = null, seenPhase = null;
    let resultKey = "";
    let restoreTimer = 0;
    let resignTimer = 0;

    const mySeat = () => (st ? st.seats.indexOf(me()) : -1);
    const seatId = (color) => st && st.seats[color === "w" ? 0 : 1];
    const isMyTurn = () => !!cur && st && st.phase === "play" && mySeat() === (cur.turn === "w" ? 0 : 1);

    function canMove() {
      return !!cur && !!st && st.phase === "play" && mySeat() >= 0 && mySeat() === (cur.turn === "w" ? 0 : 1);
    }

    function orient() {
      if (flipPref !== null) return flipPref;
      return mySeat() === 1;
    }

    // ---- state changes (host) ----

    function makeState() {
      const ids = ctx.players.map((p) => p.id);
      const host = ids.includes(ctx.hostId) ? ctx.hostId : ids[0];
      const other = ids.find((id) => id !== host) || null;
      return {
        rev: (st ? st.rev : 0) + 1,
        round: 1,
        seats: [host, other],
        fen: E.START_FEN,
        sans: [],
        last: null,
        phase: "play",
        result: null,
        check: false,
        cap: false,
        gone: [],
      };
    }

    function adopt(next) {
      const before = st;
      const grew = !!before && next.sans.length > before.sans.length;
      st = next;
      cur = E.parseFen(st.fen);
      keys = [E.positionKey(cur)];
      animateNext = grew && st.last ? st.last : null;
      if (before && next.round !== before.round) seenSans = null;
      render();
    }

    function fillSeats() {
      if (!st) return;
      const taken = st.seats.filter(Boolean);
      const pool = ctx.players.map((p) => p.id).filter((id) => !st.gone.includes(id) && !taken.includes(id));
      for (let k = 0; k < 2; k++) {
        if (!st.seats[k] && pool.length) { st.seats[k] = pool.shift(); taken.push(st.seats[k]); }
      }
    }

    function push() {
      if (!st || !ctx.isHost) return;
      if (cur) {
        st.fen = E.toFen(cur);
        st.check = E.inCheck(cur);
      }
      ctx.send("state", st);
      render();
    }

    function moveOnHost(uci, from) {
      if (!ctx.isHost || !st || !cur || st.phase !== "play") return;
      if (seatId(cur.turn) !== from) return;
      const move = E.uciToMove(cur, String(uci || ""));
      if (!move) return;
      const san = E.moveToSan(cur, move);
      const cap = !!move.captured;
      const next = E.makeMove(cur, move);
      keys.push(E.positionKey(next));
      st.sans.push(san);
      st.last = { from: move.from, to: move.to };
      st.cap = cap;
      cur = next;
      const status = E.gameStatus(cur, keys);
      if (status.over) { st.phase = "over"; st.result = { over: true, winner: status.winner, reason: status.reason, by: null }; }
      st.rev++;
      animateNext = st.last;
      push();
    }

    function newRound() {
      if (!ctx.isHost || !st || st.phase !== "over") return;
      fillSeats();
      if (!st.seats[0] || !st.seats[1]) { render(); return; }
      st.seats = [st.seats[1], st.seats[0]];
      st.round++;
      st.fen = E.START_FEN;
      st.sans = [];
      st.last = null;
      st.phase = "play";
      st.result = null;
      st.check = false;
      st.cap = false;
      st.rev++;
      cur = E.parseFen(st.fen);
      keys = [E.positionKey(cur)];
      animateNext = null;
      flipPref = null;
      push();
    }

    function resign(id) {
      if (!ctx.isHost || !st || !cur || st.phase !== "play") return;
      const k = st.seats.indexOf(id);
      if (k < 0) return;
      st.phase = "over";
      st.result = { over: true, winner: k === 0 ? "b" : "w", reason: "resign", by: id };
      st.rev++;
      push();
    }

    // ---- rendering ----

    function resultTitle(r) {
      if (!r) return "Partie beendet";
      return V.resultInfo(r).title || "Partie beendet";
    }

    function overText(r) {
      if (!r) return "Partie beendet";
      const winner = r.winner ? nm(seatId(r.winner)) : "";
      if (r.reason === "checkmate") return `${winner} gewinnt.`;
      if (r.reason === "resign") return `${nm(r.by)} gibt auf – ${winner} gewinnt.`;
      if (r.reason === "leave") return r.winner ? `${nm(r.by)} hat den Raum verlassen – ${winner} gewinnt.` : "Partie beendet.";
      return V.resultInfo(r).sub || "";
    }

    function renderPlayers() {
      if (!st) { playersEl.innerHTML = ""; return; }
      playersEl.innerHTML = [0, 1].map((k) => {
        const id = st.seats[k];
        const color = k === 0 ? "w" : "b";
        const active = st.phase === "play" && cur && cur.turn === color;
        const gone = id && st.gone.includes(id);
        return `<div class="schach-player${active ? " active" : ""}${gone ? " gone" : ""}">
          <i class="dot ${color}"></i>
          <span>${id ? nm(id) : "frei"}</span>
          <span class="tag-me">${COLOR[k]}</span>
        </div>`;
      }).join("");
    }

    function render() {
      // names of players who already left stay available for the result text
      for (const p of ctx.players) { names.set(p.id, p.name); seen.add(p.id); }
      if (st && st.result && st.result.by && names.has(st.result.by) === false) names.set(st.result.by, "?");

      if (!st || !cur) {
        statusTxt.textContent = ctx.isHost ? "Partie wird vorbereitet …" : "Warte auf den Host …";
        statusEl.classList.remove("live", "over");
        playersEl.innerHTML = "";
        V.renderMoves(movesBody, []);
        movesCnt.textContent = "";
        noteEl.textContent = "";
        resultBtn.hidden = true;
        resignBtn.hidden = true;
        resetResign();
        if (board) board.setInteractive(false);
        return;
      }

      const seatKey = st.seats.join("|");
      if (seatKey !== lastSeatKey) { lastSeatKey = seatKey; flipPref = null; }

      const seat = mySeat();
      const other = seat === 0 ? 1 : 0;
      const myTurn = isMyTurn();
      const check = st.phase === "play" && st.check ? " · Schach!" : "";

      if (st.phase === "over") {
        statusTxt.textContent = resultTitle(st.result) + (overText(st.result) ? " · " + overText(st.result) : "");
        statusEl.classList.remove("live");
        statusEl.classList.add("over");
      } else if (seat < 0) {
        statusTxt.textContent = `${nm(seatId(cur.turn))} (${COLOR[cur.turn === "w" ? 0 : 1]}) ist am Zug` + check;
        statusEl.classList.remove("live", "over");
      } else if (myTurn) {
        statusTxt.textContent = "Du bist am Zug" + check;
        statusEl.classList.remove("over");
        statusEl.classList.add("live");
      } else {
        statusTxt.textContent = `${nm(seatId(cur.turn))} ist am Zug` + check;
        statusEl.classList.remove("live", "over");
      }

      renderPlayers();
      V.renderMoves(movesBody, st.sans);
      const n = Math.ceil(st.sans.length / 2);
      movesCnt.textContent = n ? (n === 1 ? "1 Zug" : n + " Züge") : "";

      // sound and the result overlay are driven by what actually changed
      const grew = seenSans !== null && st.sans.length > seenSans;
      if (SOUND && grew) {
        if (st.phase === "over") V.playSound("end");
        else if (st.check) V.playSound("check");
        else V.playSound(st.cap ? "capture" : "move");
      } else if (SOUND && seenPhase === "play" && st.phase === "over" && !grew) {
        V.playSound("end");
      }
      seenSans = st.sans.length;
      seenPhase = st.phase;

      const rKey = st.phase === "over" && st.result ? `${st.round}|${st.result.reason}|${st.result.winner}|${st.result.by}` : "";
      if (!rKey) {
        wrap.querySelectorAll(".schach-overlay").forEach((el) => el.remove());
        resultKey = "";
      } else if (rKey !== resultKey) {
        resultKey = rKey;
        openResult();
      }
      resultBtn.hidden = !rKey || !!wrap.querySelector(".schach-overlay");
      resignBtn.hidden = st.phase !== "play" || seat < 0;
      if (resignBtn.hidden) resetResign();

      // notes + buttons
      if (st.phase === "play" && seat < 0) noteEl.textContent = "Du schaust zu.";
      else if (st.phase === "play" && !st.seats[other]) noteEl.textContent = "Warte auf einen Gegner …";
      else if (st.phase === "over" && !ctx.isHost && seat >= 0) noteEl.textContent = "Der Host kann eine Revanche starten – oder du fragst danach.";
      else if (st.phase === "over" && !ctx.isHost && seat < 0) noteEl.textContent = "Warte auf die Revanche …";
      else noteEl.textContent = "";

      if (!board) return;
      board.setCanMove(canMove);
      board.setInteractive(st.phase === "play" && seat >= 0 && myTurn);
      board.setFlip(orient());
      if (boardRev !== st.rev) {
        boardRev = st.rev;
        board.setPosition(cur, { last: st.last, animate: animateNext });
        animateNext = null;
      }
    }

    function openResult() {
      if (!st || !st.result) return;
      const seat = mySeat();
      const actionLabel = ctx.isHost ? "Nochmal" : seat >= 0 ? "Revanche" : "";
      V.showResult(wrap, {
        title: resultTitle(st.result),
        sub: overText(st.result),
        actionLabel,
        onAction: () => {
          wrap.querySelectorAll(".schach-overlay").forEach((el) => el.remove());
          if (!ctx.isHost && seat >= 0 && st && st.phase === "over") {
            ctx.send("again", null, ctx.hostId);
            noteEl.textContent = "Revanche angefragt – warte auf den Host …";
          } else if (ctx.isHost) newRound();
        },
        onClose: () => {
          resultBtn.hidden = false;
          resultBtn.textContent = "Ergebnis";
        },
      });
      resultBtn.hidden = true;
      resultBtn.textContent = "Ergebnis";
    }

    // ---- board (p5 instance; drawn from PAL so every design works) ----

    if (typeof window.p5 === "function") {
      pf = new window.p5((p) => {
        p.setup = () => {
          const c = p.createCanvas(480, 480);
          c.parent(canvasHost);
          p.frameRate(60);
          board = new V.Board(p, E, {
            x: 20, y: 20, size: 440,
            canMove,
            onMove: (move) => {
              if (!st) return;
              const uci = E.moveToUci(move);
              if (ctx.isHost) moveOnHost(uci, me());
              else ctx.send("move", uci, ctx.hostId);
            },
            play: (kind) => { if (SOUND) V.playSound(kind); },
            choosePromotion: (color) => V.showPromotion(wrap, color),
          });
          bindPointer(c.elt);
          render();
        };
        p.draw = () => {
          p.background(...PAL.board);
          if (board) board.draw();
        };
      }, canvasHost);
    }

    function bindPointer(canvas) {
      let active = null;
      const at = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * 480 / Math.max(1, r.width), y: (e.clientY - r.top) * 480 / Math.max(1, r.height) };
      };
      canvas.style.touchAction = "none";
      canvas.addEventListener("pointerdown", (e) => {
        if (!board || active !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
        active = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        const q = at(e);
        board.press(q.x, q.y);
        e.preventDefault();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!board || e.pointerId !== active) return;
        const q = at(e);
        board.drag(q.x, q.y);
        e.preventDefault();
      });
      const end = (e) => {
        if (!board || e.pointerId !== active) return;
        active = null;
        const q = at(e);
        board.release(q.x, q.y);
      };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    function resetResign() {
      clearTimeout(resignTimer);
      resignBtn.dataset.confirm = "";
      resignBtn.textContent = "Aufgeben";
    }

    // ---- input ----

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "flip") {
        flipPref = !orient();
        if (board) board.setFlip(orient());
      } else if (b.dataset.act === "resign") {
        if (b.dataset.confirm === "1") {
          resetResign();
          if (ctx.isHost) resign(me());
          else ctx.send("resign", null, ctx.hostId);
        } else {
          b.dataset.confirm = "1";
          b.textContent = "Wirklich aufgeben?";
          clearTimeout(resignTimer);
          resignTimer = setTimeout(resetResign, 3200);
        }
      } else if (b.dataset.act === "result") {
        if (st && st.result) { resultKey = ""; openResult(); resultBtn.hidden = true; }
      }
    });

    // ---- network ----

    ctx.onMessage("move", ({ data, from }) => { if (ctx.isHost) moveOnHost(data, from); });
    ctx.onMessage("again", ({ from }) => {
      if (!ctx.isHost || !st || st.phase !== "over") return;
      if (!st.seats.includes(from)) return;
      newRound();
    });
    ctx.onMessage("resign", ({ from }) => { if (ctx.isHost) resign(from); });
    ctx.onMessage("sync", () => { if (ctx.isHost && st) push(); });
    ctx.onMessage("restore", () => { if (!ctx.isHost && st) ctx.send("state", st, ctx.hostId); });
    ctx.onMessage("state", ({ data, from }) => {
      if (from === ctx.hostId) {
        const n = clean(data, seen);
        if (n && (!st || n.rev >= st.rev)) adopt(n);
        return;
      }
      // host reloaded: until it has a state, it may take the snapshot of a player who stayed
      if (ctx.isHost && !st) {
        const n = clean(data, seen);
        if (n) { adopt(n); push(); }
      }
    });

    // leave events are applied by everybody the same way, so a host change cannot lose the result
    ctx.onEvent("leave", ({ id }) => {
      if (!st || !seen.has(id)) return;
      const k = st.seats.indexOf(id);
      if (!st.gone.includes(id)) st.gone.push(id);
      if (k >= 0) {
        st.seats[k] = null;
        if (st.phase === "play" && cur) {
          st.phase = "over";
          st.result = { over: true, winner: k === 0 ? "b" : "w", reason: "leave", by: id };
          st.check = false;
          st.rev++;
        }
      }
      if (ctx.isHost) { fillSeats(); push(); } else render();
    });
    ctx.onEvent("join", () => {
      for (const p of ctx.players) { names.set(p.id, p.name); seen.add(p.id); }
      if (ctx.isHost) { fillSeats(); push(); } else render();
    });
    ctx.onEvent("host", ({ you }) => {
      if (you) { fillSeats(); push(); }
    });

    // ---- start ----

    function go() {
      if (ctx.isHost) {
        if (st) { push(); return; }
        ctx.send("restore");                               // after a reload the seat that stayed has the snapshot
        restoreTimer = setTimeout(() => {
          if (st) return;
          st = makeState();
          cur = E.parseFen(st.fen);
          keys = [E.positionKey(cur)];
          boardRev = -1;
          push();
        }, 700);
      } else {
        render();
        ctx.send("sync", null, ctx.hostId);
      }
    }

    return {
      go,
      destroy() {
        clearTimeout(restoreTimer);
        clearTimeout(resignTimer);
        if (pf) { try { pf.remove(); } catch {} }
      },
    };
  },
};
