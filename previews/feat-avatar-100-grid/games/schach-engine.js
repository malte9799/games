// Schach-Engine — pure rules, no DOM and no p5.
// Shared by the solo page (games/schach.js) and the hub game (hub-games/schach.js).
//
// Board indices follow FEN order: 0 = a8, 7 = h8, 8 = a7 … 63 = h1.
// Pieces are FEN characters: uppercase = white, lowercase = black.
//
// Public API:
//   START_FEN, parseFen, toFen, clonePosition, positionKey
//   legalMoves, inCheck, makeMove, moveToSan, gameStatus, insufficientMaterial
//   chooseMove (levels 1–3), moveToUci, uciToMove, squareName

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";
const WHITE = "w";
const BLACK = "b";
const PROMO = ["q", "r", "b", "n"];
const TIMEOUT = { timeout: true };

const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// ---- board helpers ----

export const other = (color) => (color === WHITE ? BLACK : WHITE);
const isWhitePiece = (ch) => !!ch && ch === ch.toUpperCase();
const colorOf = (ch) => (isWhitePiece(ch) ? WHITE : BLACK);
const typeOf = (ch) => (ch ? ch.toLowerCase() : "");
const rankOf = (sq) => sq >> 3;
const fileOf = (sq) => sq & 7;
const squareAt = (rank, file) => rank * 8 + file;

export function squareName(sq) {
  return FILES[fileOf(sq)] + (8 - rankOf(sq));
}

function squareIndex(name) {
  if (typeof name !== "string" || name.length < 2) return -1;
  const file = FILES.indexOf(name[0]);
  const rank = 8 - Number(name[1]);
  if (file < 0 || rank < 0 || rank > 7) return -1;
  return squareAt(rank, file);
}

// ---- FEN ----

export function parseFen(fen = START_FEN) {
  const parts = String(fen).trim().split(/\s+/);
  const board = new Array(64).fill(null);
  let i = 0;
  for (const ch of parts[0] || "") {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") i += Number(ch);
    else if (i < 64) board[i++] = ch;
  }
  const rights = parts[2] || "-";
  const epName = parts[3] || "-";
  return {
    board,
    turn: parts[1] === BLACK ? BLACK : WHITE,
    castling: {
      K: rights.includes("K"),
      Q: rights.includes("Q"),
      k: rights.includes("k"),
      q: rights.includes("q"),
    },
    ep: epName === "-" ? null : squareIndex(epName),
    halfmove: Math.max(0, Number(parts[4]) || 0),
    fullmove: Math.max(1, Number(parts[5]) || 1),
  };
}

export function toFen(pos) {
  let placement = "";
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const ch = pos.board[squareAt(rank, file)];
      if (ch) {
        if (empty) { placement += empty; empty = 0; }
        placement += ch;
      } else empty++;
    }
    if (empty) placement += empty;
    if (rank < 7) placement += "/";
  }
  const rights = ["K", "Q", "k", "q"].filter((k) => pos.castling[k]).join("") || "-";
  return [
    placement,
    pos.turn,
    rights,
    pos.ep === null || pos.ep === undefined ? "-" : squareName(pos.ep),
    pos.halfmove,
    pos.fullmove,
  ].join(" ");
}

// Board + side + rights + ep: ignores the move counters, so positions that only
// differ in halfmove/fullmove compare equal for repetition.
export function positionKey(pos) {
  return toFen(pos).split(" ").slice(0, 4).join(" ");
}

export function clonePosition(pos) {
  return {
    board: pos.board.slice(),
    turn: pos.turn,
    castling: { ...pos.castling },
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

// ---- attack detection ----

export function isSquareAttacked(pos, sq, byColor) {
  const b = pos.board;
  const rank = rankOf(sq);
  const file = fileOf(sq);

  // pawns
  if (byColor === WHITE) {
    if (file > 0 && rank < 7 && b[sq + 7] === "P") return true;
    if (file < 7 && rank < 7 && b[sq + 9] === "P") return true;
  } else {
    if (file > 0 && rank > 0 && b[sq - 9] === "p") return true;
    if (file < 7 && rank > 0 && b[sq - 7] === "p") return true;
  }

  // knights
  const knight = byColor === WHITE ? "N" : "n";
  for (const [dr, df] of KNIGHT_STEPS) {
    const r = rank + dr, f = file + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8 && b[squareAt(r, f)] === knight) return true;
  }

  // king
  const king = byColor === WHITE ? "K" : "k";
  for (const [dr, df] of KING_STEPS) {
    const r = rank + dr, f = file + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8 && b[squareAt(r, f)] === king) return true;
  }

  // sliding pieces
  const rook = byColor === WHITE ? "R" : "r";
  const bishop = byColor === WHITE ? "B" : "b";
  const queen = byColor === WHITE ? "Q" : "q";
  for (const [dr, df] of ROOK_DIRS) {
    let r = rank + dr, f = file + df;
    while (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const ch = b[squareAt(r, f)];
      if (ch) {
        if (ch === rook || ch === queen) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  for (const [dr, df] of BISHOP_DIRS) {
    let r = rank + dr, f = file + df;
    while (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const ch = b[squareAt(r, f)];
      if (ch) {
        if (ch === bishop || ch === queen) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  return false;
}

export function kingSquare(pos, color) {
  const king = color === WHITE ? "K" : "k";
  for (let i = 0; i < 64; i++) if (pos.board[i] === king) return i;
  return -1;
}

export function inCheck(pos, color = pos.turn) {
  const k = kingSquare(pos, color);
  return k >= 0 && isSquareAttacked(pos, k, other(color));
}

// ---- move generation ----

function pushPromotions(moves, from, to, captured) {
  for (const promo of PROMO) moves.push({ from, to, promo, captured: captured || null });
}

function pseudoMoves(pos) {
  const moves = [];
  const b = pos.board;
  const turn = pos.turn;
  const white = turn === WHITE;

  for (let from = 0; from < 64; from++) {
    const piece = b[from];
    if (!piece || colorOf(piece) !== turn) continue;
    const type = typeOf(piece);
    const rank = rankOf(from);
    const file = fileOf(from);

    if (type === "p") {
      const dir = white ? -1 : 1;
      const promoRank = white ? 0 : 7;
      const startRank = white ? 6 : 1;
      const oneRank = rank + dir;
      if (oneRank >= 0 && oneRank < 8) {
        const one = squareAt(oneRank, file);
        if (!b[one]) {
          if (oneRank === promoRank) pushPromotions(moves, from, one, null);
          else {
            moves.push({ from, to: one });
            if (rank === startRank) {
              const two = squareAt(rank + dir * 2, file);
              if (!b[two]) moves.push({ from, to: two, double: true });
            }
          }
        }
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          const to = squareAt(oneRank, f);
          const target = b[to];
          if (target && colorOf(target) !== turn) {
            if (oneRank === promoRank) pushPromotions(moves, from, to, target);
            else moves.push({ from, to, captured: target });
          } else if (!target && pos.ep === to) {
            moves.push({ from, to, ep: true, captured: white ? "p" : "P" });
          }
        }
      }
      continue;
    }

    if (type === "n" || type === "k") {
      const steps = type === "n" ? KNIGHT_STEPS : KING_STEPS;
      for (const [dr, df] of steps) {
        const r = rank + dr, f = file + df;
        if (r < 0 || r > 7 || f < 0 || f > 7) continue;
        const to = squareAt(r, f);
        const target = b[to];
        if (!target) moves.push({ from, to });
        else if (colorOf(target) !== turn) moves.push({ from, to, captured: target });
      }
      continue;
    }

    const dirs = type === "r" ? ROOK_DIRS : type === "b" ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
    for (const [dr, df] of dirs) {
      let r = rank + dr, f = file + df;
      while (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const to = squareAt(r, f);
        const target = b[to];
        if (!target) moves.push({ from, to });
        else {
          if (colorOf(target) !== turn) moves.push({ from, to, captured: target });
          break;
        }
        r += dr; f += df;
      }
    }
  }

  // castling — rights, empty path, and no attack on king or transit squares
  const enemy = other(turn);
  if (white) {
    if (pos.castling.K && b[61] === null && b[62] === null && b[63] === "R" &&
        b[60] === "K" && !isSquareAttacked(pos, 60, enemy) &&
        !isSquareAttacked(pos, 61, enemy) && !isSquareAttacked(pos, 62, enemy)) {
      moves.push({ from: 60, to: 62, castle: "K" });
    }
    if (pos.castling.Q && b[59] === null && b[58] === null && b[57] === null && b[56] === "R" &&
        b[60] === "K" && !isSquareAttacked(pos, 60, enemy) &&
        !isSquareAttacked(pos, 59, enemy) && !isSquareAttacked(pos, 58, enemy)) {
      moves.push({ from: 60, to: 58, castle: "Q" });
    }
  } else {
    if (pos.castling.k && b[5] === null && b[6] === null && b[7] === "r" &&
        b[4] === "k" && !isSquareAttacked(pos, 4, enemy) &&
        !isSquareAttacked(pos, 5, enemy) && !isSquareAttacked(pos, 6, enemy)) {
      moves.push({ from: 4, to: 6, castle: "K" });
    }
    if (pos.castling.q && b[3] === null && b[2] === null && b[1] === null && b[0] === "r" &&
        b[4] === "k" && !isSquareAttacked(pos, 4, enemy) &&
        !isSquareAttacked(pos, 3, enemy) && !isSquareAttacked(pos, 2, enemy)) {
      moves.push({ from: 4, to: 2, castle: "Q" });
    }
  }

  return moves;
}

// Applies a move without validating it. Returns a fresh position.
export function makeMove(pos, move) {
  const b = pos.board.slice();
  const piece = b[move.from];
  const color = colorOf(piece);
  const type = typeOf(piece);

  b[move.from] = null;
  if (move.ep) b[move.to + (color === WHITE ? 8 : -8)] = null;
  b[move.to] = move.promo
    ? (color === WHITE ? move.promo.toUpperCase() : move.promo)
    : piece;

  if (move.castle) {
    if (color === WHITE) {
      if (move.castle === "K") { b[63] = null; b[61] = "R"; }
      else { b[56] = null; b[59] = "R"; }
    } else {
      if (move.castle === "K") { b[7] = null; b[5] = "r"; }
      else { b[0] = null; b[3] = "r"; }
    }
  }

  const castling = { ...pos.castling };
  if (type === "k") {
    if (color === WHITE) { castling.K = false; castling.Q = false; }
    else { castling.k = false; castling.q = false; }
  }
  // a rook leaving or being captured on a corner kills that right
  for (const sq of [move.from, move.to]) {
    if (sq === 63) castling.K = false;
    else if (sq === 56) castling.Q = false;
    else if (sq === 7) castling.k = false;
    else if (sq === 0) castling.q = false;
  }

  let ep = null;
  if (type === "p" && Math.abs(move.to - move.from) === 16) {
    ep = (move.from + move.to) / 2;
  }

  const halfmove = type === "p" || move.captured ? 0 : pos.halfmove + 1;
  return {
    board: b,
    turn: other(color),
    castling,
    ep,
    halfmove,
    fullmove: pos.fullmove + (color === BLACK ? 1 : 0),
  };
}

export function legalMoves(pos) {
  const moves = pseudoMoves(pos);
  const me = pos.turn;
  const enemy = other(me);
  const out = [];
  for (const move of moves) {
    const next = makeMove(pos, move);
    const k = kingSquare(next, me);
    if (k < 0 || !isSquareAttacked(next, k, enemy)) out.push(move);
  }
  return out;
}

// ---- notation ----

export function moveToUci(move) {
  return squareName(move.from) + squareName(move.to) + (move.promo || "");
}

export function uciToMove(pos, uci) {
  if (typeof uci !== "string") return null;
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promo = uci.length > 4 ? uci[4] : null;
  return legalMoves(pos).find((m) =>
    m.from === from && m.to === to && (m.promo || null) === (promo || null)
  ) || null;
}

export function moveToSan(pos, move) {
  const piece = pos.board[move.from];
  const type = typeOf(piece);
  let san;

  if (move.castle) {
    san = move.castle === "K" ? "O-O" : "O-O-O";
  } else {
    san = "";
    if (type !== "p") {
      san += type.toUpperCase();
      const rivals = legalMoves(pos).filter((m) =>
        m.to === move.to && m.from !== move.from && typeOf(pos.board[m.from]) === type
      );
      if (rivals.length) {
        const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
        const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
        if (!sameFile) san += FILES[fileOf(move.from)];
        else if (!sameRank) san += String(8 - rankOf(move.from));
        else san += squareName(move.from);
      }
    } else if (move.captured) {
      san += FILES[fileOf(move.from)];
    }
    if (move.captured) san += "x";
    san += squareName(move.to);
    if (move.promo) san += "=" + move.promo.toUpperCase();
  }

  const next = makeMove(pos, move);
  if (inCheck(next)) san += legalMoves(next).length ? "+" : "#";
  return san;
}

// ---- results ----

export function insufficientMaterial(pos) {
  const pieces = [];
  for (let i = 0; i < 64; i++) {
    const ch = pos.board[i];
    if (!ch) continue;
    const t = typeOf(ch);
    if (t === "k") continue;
    pieces.push({ t, color: colorOf(ch), light: (rankOf(i) + fileOf(i)) % 2 === 0 });
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1) return pieces[0].t === "b" || pieces[0].t === "n";
  if (pieces.every((p) => p.t === "b")) {
    return pieces.every((p) => p.light === pieces[0].light);
  }
  return false;
}

export function gameStatus(pos, keys) {
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    if (inCheck(pos)) return { over: true, winner: other(pos.turn), reason: "checkmate" };
    return { over: true, winner: null, reason: "stalemate" };
  }
  if (pos.halfmove >= 100) return { over: true, winner: null, reason: "fifty" };
  if (insufficientMaterial(pos)) return { over: true, winner: null, reason: "material" };
  if (keys && keys.length) {
    const key = positionKey(pos);
    let n = 0;
    for (const k of keys) if (k === key) n++;
    if (n >= 3) return { over: true, winner: null, reason: "repetition" };
  }
  return { over: false, winner: null, reason: null };
}

// ---- evaluation ----

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Tables are written from White's point of view in our board order (a8 first).
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

function evaluate(pos) {
  const b = pos.board;
  let score = 0;
  let heavy = 0;
  let minor = 0;
  for (let i = 0; i < 64; i++) {
    const ch = b[i];
    if (!ch) continue;
    const type = typeOf(ch);
    if (type === "q" || type === "r") heavy += VALUE[type];
    if (type === "b" || type === "n") minor += VALUE[type];
  }
  const endgame = heavy === 0 || heavy + minor <= 1300;

  for (let i = 0; i < 64; i++) {
    const ch = b[i];
    if (!ch) continue;
    const type = typeOf(ch);
    const white = isWhitePiece(ch);
    const table = type === "k" ? (endgame ? KING_END : PST.k) : PST[type];
    const pst = table[white ? i : 63 - i];
    const v = VALUE[type] + pst;
    score += white ? v : -v;
  }
  return score;
}

// ---- search ----

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const LEVELS = {
  1: { depth: 2, time: 220, noise: 90, blunder: 0.18 },
  2: { depth: 3, time: 650, noise: 30, blunder: 0.04 },
  3: { depth: 4, time: 1200, noise: 0, blunder: 0 },
};

let nodes = 0;

function orderMoves(pos, moves) {
  for (const m of moves) {
    let s = 0;
    if (m.captured) s += 10 * (VALUE[typeOf(m.captured)] || 0) - (VALUE[typeOf(pos.board[m.from])] || 0);
    if (m.promo) s += 800;
    if (m.castle) s += 40;
    m._order = s;
  }
  moves.sort((a, b) => b._order - a._order);
  return moves;
}

function evalForTurn(pos) {
  const e = evaluate(pos);
  return pos.turn === WHITE ? e : -e;
}

function quiesce(pos, alpha, beta, qdepth, deadline, ply) {
  nodes++;
  if ((nodes & 2047) === 0 && now() > deadline) throw TIMEOUT;

  const checked = inCheck(pos);
  const stand = evalForTurn(pos);
  if (!checked) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }
  if (qdepth >= 4) return checked ? stand : alpha;

  let moves = legalMoves(pos);
  if (!moves.length) return checked ? -100000 + ply : 0;
  if (!checked) moves = moves.filter((m) => m.captured || m.promo);
  orderMoves(pos, moves);

  for (const m of moves) {
    const next = makeMove(pos, m);
    const score = -quiesce(next, -beta, -alpha, qdepth + 1, deadline, ply + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function search(pos, depth, alpha, beta, ply, deadline) {
  nodes++;
  if ((nodes & 2047) === 0 && now() > deadline) throw TIMEOUT;

  const moves = legalMoves(pos);
  if (!moves.length) return inCheck(pos) ? -100000 + ply : 0;
  if (depth <= 0) return quiesce(pos, alpha, beta, 0, deadline, ply);

  orderMoves(pos, moves);
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
  const moves = orderMoves(pos, legalMoves(pos));
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

// level: 1 easy, 2 medium, 3 strong. Always returns a legal move (or null).
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
