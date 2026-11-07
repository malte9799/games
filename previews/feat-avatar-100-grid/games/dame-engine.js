// Dame — pure rules engine for three variants on the same board skin.
//
//   german         8×8   men capture forwards and backwards, flying kings,
//                        compulsory capture (free choice of sequence)
//   simple         8×8   men capture forwards only, kings move one square,
//                        compulsory capture
//   international 10×10  men capture forwards and backwards, flying kings,
//                        compulsory capture and the longest sequence must be played
//
// Board values are "w" (white man), "W" (white king/Dame), "b", "B" or null.
// Index 0 is the top-left square; white moves towards row 0, black towards row n-1.
// Positions are plain objects ({ variant, n, board, turn, half }) so the view and
// the network code can copy them cheaply.

export const VARIANTS = {
  german: {
    id: "german",
    label: "Deutsche Dame",
    short: "Deutsch",
    n: 8,
    menCaptureBack: true,
    flying: true,
    maxCapture: false,
  },
  simple: {
    id: "simple",
    label: "Checkers",
    short: "Einfach",
    n: 8,
    menCaptureBack: false,
    flying: false,
    maxCapture: false,
  },
  international: {
    id: "international",
    label: "Internationale Dame",
    short: "International",
    n: 10,
    menCaptureBack: true,
    flying: true,
    maxCapture: true,
  },
};

export const VARIANT_IDS = Object.keys(VARIANTS);

export function variantOf(id) {
  return VARIANTS[id] || VARIANTS.german;
}

const FILES = "abcdefghij";
const other = (c) => (c === "w" ? "b" : "w");
const rowOf = (i, n) => Math.floor(i / n);
const colOf = (i, n) => i % n;
const isWhitePiece = (ch) => !!ch && ch.toLowerCase() === "w";
const isKingPiece = (ch) => !!ch && ch === ch.toUpperCase();
const colorOf = (ch) => (ch && ch.toLowerCase() === "w" ? "w" : "b");

export { isWhitePiece as isWhite, isKingPiece as isKing, colorOf };

function squareName(i, n) {
  if (!Number.isInteger(i) || i < 0 || i >= n * n) return "?";
  return FILES[colOf(i, n)] + (n - rowOf(i, n));
}

export { squareName };

function finishMove(pos, from, to, path, captures) {
  const piece = pos.board[from];
  const promo = !isKingPiece(piece) &&
    ((pos.turn === "w" && rowOf(to, pos.n) === 0) ||
     (pos.turn === "b" && rowOf(to, pos.n) === pos.n - 1));
  return { from, to, path, captures, promo };
}

// ---- position setup / FEN ----

export function startPosition(variant = "german") {
  const cfg = variantOf(variant);
  const n = cfg.n;
  const board = new Array(n * n).fill(null);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r < n / 2 - 1) board[r * n + c] = "b";
      else if (r > n / 2) board[r * n + c] = "w";
    }
  }
  return { variant: cfg.id, n, board, turn: "w", half: 0 };
}

export function toFen(pos) {
  const rows = [];
  for (let r = 0; r < pos.n; r++) {
    let row = "";
    let empty = 0;
    for (let c = 0; c < pos.n; c++) {
      const ch = pos.board[r * pos.n + c];
      if (!ch) { empty++; continue; }
      if (empty) { row += String(empty); empty = 0; }
      row += ch;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return `${pos.variant}|${rows.join("/")} ${pos.turn} ${pos.half || 0}`;
}

export function startFen(variant = "german") {
  return toFen(startPosition(variant));
}

export const START_FEN = startFen("german");

export function parseFen(fen) {
  let text = String(fen || "").trim();
  let variant = "german";
  const bar = text.indexOf("|");
  if (bar >= 0) {
    const id = text.slice(0, bar);
    if (VARIANTS[id]) { variant = id; text = text.slice(bar + 1); }
  }
  const cfg = variantOf(variant);
  const n = cfg.n;
  const [boardPart = "", turnPart = "w", halfPart = "0"] = text.split(/\s+/);
  const rows = boardPart.split("/");
  if (rows.length !== n) throw new Error("invalid dame board");
  const board = new Array(n * n).fill(null);
  for (let r = 0; r < n; r++) {
    let c = 0;
    for (const token of rows[r].match(/\d+|[wWbB]/g) || []) {
      if (/^\d+$/.test(token)) {
        c += Number(token);
      } else {
        if (c >= n) throw new Error("invalid dame row");
        board[r * n + c] = token;
        c++;
      }
    }
    if (c !== n) throw new Error("invalid dame row");
  }
  return {
    variant,
    n,
    board,
    turn: turnPart === "b" ? "b" : "w",
    half: Math.max(0, Number(halfPart) || 0),
  };
}

export function positionKey(pos) {
  return `${pos.variant}|${pos.turn}|${pos.board.map((ch) => ch || ".").join("")}`;
}

// ---- move generation ----

// Every landing square for one jump from `sq`; captured squares are tracked by the
// caller (the DFS removes them temporarily so a piece can't be taken twice).
function jumpOptions(pos, board, sq, piece, cfg) {
  const n = pos.n;
  const king = isKingPiece(piece);
  const color = colorOf(piece);
  const forward = color === "w" ? -1 : 1;
  const dirs = king || cfg.menCaptureBack
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : [[forward, -1], [forward, 1]];
  const flying = king && cfg.flying;
  const out = [];
  const r0 = rowOf(sq, n);
  const c0 = colOf(sq, n);

  for (const [dr, dc] of dirs) {
    if (flying) {
      let r = r0 + dr, c = c0 + dc;
      while (r >= 0 && r < n && c >= 0 && c < n) {
        const ch = board[r * n + c];
        if (!ch) { r += dr; c += dc; continue; }
        if (colorOf(ch) === color) break;
        // first piece is an enemy: every empty square behind it is a landing option
        let lr = r + dr, lc = c + dc;
        while (lr >= 0 && lr < n && lc >= 0 && lc < n && !board[lr * n + lc]) {
          out.push({ captured: r * n + c, to: lr * n + lc });
          lr += dr; lc += dc;
        }
        break;
      }
    } else {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      const ch = board[r * n + c];
      if (!ch || colorOf(ch) === color) continue;
      const lr = r + dr, lc = c + dc;
      if (lr < 0 || lr >= n || lc < 0 || lc >= n) continue;
      if (board[lr * n + lc]) continue;
      out.push({ captured: r * n + c, to: lr * n + lc });
    }
  }
  return out;
}

function captureSequencesFrom(pos, from, cfg) {
  const piece = pos.board[from];
  if (!piece) return [];
  const work = pos.board.slice();
  work[from] = null;
  const out = [];
  const seen = new Set();
  const path = [from];
  const captures = [];

  const walk = (sq) => {
    const options = jumpOptions(pos, work, sq, piece, cfg);
    if (!options.length) {
      if (captures.length) {
        const key = path.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          out.push(finishMove(pos, from, sq, path.slice(), captures.slice()));
        }
      }
      return;
    }
    for (const o of options) {
      const saved = work[o.captured];
      work[o.captured] = null;
      work[o.to] = piece;
      path.push(o.to);
      captures.push(o.captured);
      walk(o.to);
      captures.pop();
      path.pop();
      work[o.to] = null;
      work[o.captured] = saved;
    }
  };

  walk(from);
  return out;
}

function quietMoves(pos, cfg) {
  const n = pos.n;
  const out = [];
  for (let i = 0; i < n * n; i++) {
    const ch = pos.board[i];
    if (!ch || colorOf(ch) !== pos.turn) continue;
    const king = isKingPiece(ch);
    const forward = pos.turn === "w" ? -1 : 1;
    const dirs = king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[forward, -1], [forward, 1]];
    const r0 = rowOf(i, n), c0 = colOf(i, n);
    for (const [dr, dc] of dirs) {
      if (king && cfg.flying) {
        let r = r0 + dr, c = c0 + dc;
        while (r >= 0 && r < n && c >= 0 && c < n && !pos.board[r * n + c]) {
          const to = r * n + c;
          out.push(finishMove(pos, i, to, [i, to], []));
          r += dr; c += dc;
        }
      } else {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= n || c < 0 || c >= n || pos.board[r * n + c]) continue;
        const to = r * n + c;
        out.push(finishMove(pos, i, to, [i, to], []));
      }
    }
  }
  return out;
}

export function legalMoves(pos) {
  const cfg = variantOf(pos.variant);
  const all = [];
  for (let i = 0; i < pos.n * pos.n; i++) {
    const ch = pos.board[i];
    if (!ch || colorOf(ch) !== pos.turn) continue;
    const caps = captureSequencesFrom(pos, i, cfg);
    if (caps.length) all.push(...caps);
  }
  if (all.length) {
    if (!cfg.maxCapture) return all;
    let max = 0;
    for (const m of all) if (m.captures.length > max) max = m.captures.length;
    return all.filter((m) => m.captures.length === max);
  }
  return quietMoves(pos, cfg);
}

export function movesFrom(pos, from) {
  return legalMoves(pos).filter((m) => m.from === from);
}

export function makeMove(pos, move) {
  const board = pos.board.slice();
  const piece = board[move.from];
  board[move.from] = null;
  for (const c of move.captures) board[c] = null;
  const king = isKingPiece(piece);
  const promo = !king &&
    ((pos.turn === "w" && rowOf(move.to, pos.n) === 0) ||
     (pos.turn === "b" && rowOf(move.to, pos.n) === pos.n - 1));
  board[move.to] = promo ? (pos.turn === "w" ? "W" : "B") : piece;
  return {
    ...pos,
    board,
    turn: other(pos.turn),
    half: move.captures.length || !king ? 0 : (pos.half || 0) + 1,
  };
}

export { makeMove as applyMove };

export function gameStatus(pos, keys = []) {
  const hasWhite = pos.board.some((ch) => ch && colorOf(ch) === "w");
  const hasBlack = pos.board.some((ch) => ch && colorOf(ch) === "b");
  if (!hasWhite) return { over: true, winner: "b", reason: "capturedall" };
  if (!hasBlack) return { over: true, winner: "w", reason: "capturedall" };
  if (!legalMoves(pos).length) {
    return { over: true, winner: other(pos.turn), reason: "blocked" };
  }
  if (keys.length) {
    const current = keys[keys.length - 1];
    let count = 0;
    for (const k of keys) if (k === current) count++;
    if (count >= 3) return { over: true, winner: null, reason: "repetition" };
  }
  if ((pos.half || 0) >= 50) return { over: true, winner: null, reason: "fifty" };
  return { over: false, winner: null, reason: null };
}

// ---- text / wire helpers ----

export function moveToId(move) {
  return move.path.map((i) => `${i}`).join(">");
}

export function idToMove(pos, id) {
  const wanted = String(id || "");
  return legalMoves(pos).find((m) => moveToId(m) === wanted) || null;
}

export function moveToText(pos, move) {
  const sep = move.captures.length ? "x" : "-";
  const text = move.path.map((i) => squareName(i, pos.n)).join(sep);
  return text + (move.promo ? "D" : "");
}

export function moveToUci(move) {
  return moveToId(move);
}

export function uciToMove(pos, id) {
  return idToMove(pos, id);
}

// ---- AI ----

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const TIMEOUT = { timeout: true };
const MATE = 1e6;

const LEVELS = {
  1: { depth: 2, time: 220, noise: 120, blunder: 0.18 },
  2: { depth: 4, time: 700, noise: 45, blunder: 0.04 },
  3: { depth: 6, time: 1400, noise: 0, blunder: 0 },
};

let nodes = 0;

function evaluate(pos) {
  const n = pos.n;
  let score = 0;
  for (let i = 0; i < n * n; i++) {
    const ch = pos.board[i];
    if (!ch) continue;
    const white = isWhitePiece(ch);
    const king = isKingPiece(ch);
    const r = rowOf(i, n);
    const c = colOf(i, n);
    let v = king ? 300 : 100;
    if (!king) {
      const advanced = white ? n - 1 - r : r;
      v += advanced * 3;
      if ((white && r === n - 1) || (!white && r === 0)) v += 6;
    } else {
      const centre = Math.abs(c - (n - 1) / 2);
      v += Math.round((n / 2 - centre) * 2);
    }
    score += white ? v : -v;
  }
  return score;
}

function order(moves) {
  for (const m of moves) {
    m._order = m.captures.length * 1000 + (m.promo ? 120 : 0) + m.path.length;
  }
  moves.sort((a, b) => b._order - a._order);
  return moves;
}

function quiesce(pos, alpha, beta, qdepth, deadline, ply) {
  nodes++;
  if ((nodes & 1023) === 0 && now() > deadline) throw TIMEOUT;
  const moves = legalMoves(pos);
  if (!moves.length) return -MATE + ply;
  if (!moves[0].captures.length) return pos.turn === "w" ? evaluate(pos) : -evaluate(pos);
  if (qdepth <= 0) return pos.turn === "w" ? evaluate(pos) : -evaluate(pos);

  order(moves);
  let best = -Infinity;
  for (const m of moves) {
    const next = makeMove(pos, m);
    const score = -quiesce(next, -beta, -alpha, qdepth - 1, deadline, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function search(pos, depth, alpha, beta, ply, deadline) {
  nodes++;
  if ((nodes & 1023) === 0 && now() > deadline) throw TIMEOUT;
  const moves = legalMoves(pos);
  if (!moves.length) return -MATE + ply;
  if (depth <= 0) return quiesce(pos, alpha, beta, 4, deadline, ply);

  order(moves);
  let best = -Infinity;
  for (const m of moves) {
    const next = makeMove(pos, m);
    const score = -search(next, depth - 1, -beta, -alpha, ply + 1, deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function rootSearch(pos, depth, deadline) {
  const moves = order(legalMoves(pos));
  const out = [];
  let alpha = -Infinity;
  for (const m of moves) {
    const next = makeMove(pos, m);
    const score = -search(next, depth - 1, -Infinity, -alpha, 1, deadline);
    out.push({ move: m, score });
    if (score > alpha) alpha = score;
  }
  return out;
}

export function chooseMove(pos, level = 2) {
  const moves = legalMoves(pos);
  if (!moves.length) return null;
  const cfg = LEVELS[Math.max(1, Math.min(3, Number(level) || 2))] || LEVELS[2];
  if (Math.random() < cfg.blunder) return moves[Math.floor(Math.random() * moves.length)];

  const deadline = now() + cfg.time;
  nodes = 0;
  let scored = moves.map((move) => ({ move, score: 0 }));
  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      scored = rootSearch(pos, depth, deadline);
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  let pick = best.move;
  if (cfg.noise > 0) {
    const pool = scored.filter((s) => s.score >= best.score - cfg.noise);
    pick = pool[Math.floor(Math.random() * pool.length)].move;
  }
  return pick;
}
