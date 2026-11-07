// Dame — shared board renderer and controller for all three variants.
//
// A classic script (window.DameView) like schach-view.js: the solo page uses it
// in p5 global mode, the hub imports it through the global, and manifest.js uses
// it for the card preview. The board frame, squares, coordinates, overlays and
// sounds deliberately match the chess board so the collection stays consistent.
//
//   DameView.drawBoard(p, { x, y, size, flipped, pos, selected, current, legal, last, anim })
//   new DameView.Board(p, engine, { x, y, size, flipped, canMove, onMove, play })
//   DameView.showResult(container, {...})
//   DameView.resultInfo(result) -> { title, sub }

(function () {
  const FILES = "abcdefghij";
  const rgb = (c, a = 255) => `rgba(${c[0]},${c[1]},${c[2]},${a / 255})`;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const colorOf = (ch) => (ch && ch.toLowerCase() === "w" ? "w" : "b");
  const isKing = (ch) => !!ch && ch === ch.toUpperCase();
  const isWhite = (ch) => !!ch && ch.toLowerCase() === "w";

  function rowCol(index, flipped, n) {
    let row = Math.floor(index / n);
    let col = index % n;
    if (flipped) { row = n - 1 - row; col = n - 1 - col; }
    return { row, col };
  }

  function indexAt(row, col, flipped, n) {
    return flipped ? (n - 1 - row) * n + (n - 1 - col) : row * n + col;
  }

  function squareRect(x, y, size, index, flipped, n) {
    const { row, col } = rowCol(index, flipped, n);
    const cell = size / n;
    return { x: x + col * cell, y: y + row * cell, cell };
  }

  function drawPiece(p, ch, cx, cy, size) {
    if (!ch) return;
    const ctx = p.drawingContext;
    const white = isWhite(ch);
    const fill = white ? PAL.onDark : PAL.onLight;
    const stroke = white ? PAL.onLight : PAL.onDark;
    const r = size * 0.38;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = "rgba(0,0,0,0.34)";
    ctx.shadowBlur = Math.max(3, size * 0.07);
    ctx.shadowOffsetY = Math.max(1, size * 0.03);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = rgb(fill);
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.lineWidth = Math.max(1.4, size * 0.045);
    ctx.strokeStyle = rgb(stroke);
    ctx.stroke();

    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, size * 0.022);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (isKing(ch)) {
      const w = r * 0.78;
      const h = r * 0.62;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.lineTo(-w / 6, -h / 10);
      ctx.lineTo(0, -h / 1.45);
      ctx.lineTo(w / 6, -h / 10);
      ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      ctx.fillStyle = rgb(stroke);
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.018);
      ctx.strokeStyle = rgb(fill);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoard(p, o) {
    const { x, y, size, pos, flipped = false, selected = null, current = null, legal = [], last = null, anim = null } = o;
    const n = pos.n;
    const cell = size / n;

    p.noStroke();
    p.fill(...PAL.line);
    p.rect(x - 2, y - 2, size + 4, size + 4, 6);

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        p.noStroke();
        p.fill(...((row + col) % 2 === 0 ? PAL.panel : PAL.well));
        p.rect(x + col * cell, y + row * cell, cell + 0.4, cell + 0.4, 0);
      }
    }

    if (last) {
      const path = Array.isArray(last) ? last : last.path || [];
      p.noStroke();
      p.fill(...PAL.sun, 55);
      for (const sq of path) {
        const r = squareRect(x, y, size, sq, flipped, n);
        p.rect(r.x, r.y, r.cell, r.cell, 0);
      }
      if (last.captures) {
        p.fill(...PAL.rose, 26);
        for (const sq of last.captures) {
          const r = squareRect(x, y, size, sq, flipped, n);
          p.rect(r.x, r.y, r.cell, r.cell, 0);
        }
      }
    }

    if (selected !== null && selected !== undefined) {
      const r = squareRect(x, y, size, selected, flipped, n);
      p.noStroke();
      p.fill(...PAL.lilac, 85);
      p.rect(r.x, r.y, r.cell, r.cell, 0);
    }
    if (current !== null && current !== undefined) {
      const r = squareRect(x, y, size, current, flipped, n);
      p.noStroke();
      p.fill(...PAL.lilac, 130);
      p.rect(r.x, r.y, r.cell, r.cell, 0);
    }

    for (const t of legal) {
      const r = squareRect(x, y, size, t.to, flipped, n);
      const cx = r.x + r.cell / 2;
      const cy = r.y + r.cell / 2;
      if (t.capture) {
        p.noFill();
        p.stroke(...PAL.rose, 215);
        p.strokeWeight(Math.max(2, cell * 0.07));
        p.circle(cx, cy, r.cell * 0.84);
        p.noStroke();
      } else {
        p.noStroke();
        p.fill(...PAL.lilac, 205);
        p.circle(cx, cy, r.cell * 0.2);
      }
    }

    const hide = new Set();
    if (anim && anim.path && anim.path.length > 1) hide.add(anim.path[anim.path.length - 1]);

    for (let i = 0; i < n * n; i++) {
      if (hide.has(i)) continue;
      const ch = pos.board[i];
      if (!ch) continue;
      const r = squareRect(x, y, size, i, flipped, n);
      drawPiece(p, ch, r.x + r.cell / 2, r.y + r.cell / 2, r.cell * 0.98);
    }

    if (anim && anim.path && anim.path.length > 1) {
      const t = anim.t !== undefined ? anim.t : Math.min(1, (now() - anim.start) / anim.dur);
      const total = anim.path.length - 1;
      const k = Math.max(0, Math.min(total, t * total));
      const seg = Math.min(total - 1, Math.floor(k));
      const f = ease(k - seg);
      const a = squareRect(x, y, size, anim.path[seg], flipped, n);
      const b = squareRect(x, y, size, anim.path[seg + 1], flipped, n);
      const cx = a.x + a.cell / 2 + (b.x - a.x) * f;
      const cy = a.y + a.cell / 2 + (b.y - a.y) * f;
      drawPiece(p, anim.piece, cx, cy, a.cell * 0.98);
    }
  }

  function drawCoords(p, { x, y, size, flipped = false, n = 8 }) {
    const cell = size / n;
    p.noStroke();
    p.fill(...PAL.dim);
    p.textSize(Math.max(8, cell * 0.16));
    p.textAlign(p.RIGHT, p.BOTTOM);
    for (let col = 0; col < n; col++) {
      const name = FILES[flipped ? n - 1 - col : col];
      p.text(name, x + col * cell + cell - 4, y + size - 4);
    }
    p.textAlign(p.LEFT, p.TOP);
    for (let row = 0; row < n; row++) {
      const name = String(flipped ? row + 1 : n - row);
      p.text(name, x + 4, y + row * cell + 4);
    }
  }

  // ---- board controller ----

  class Board {
    constructor(p, engine, opts = {}) {
      this.p = p;
      this.engine = engine;
      this.x = opts.x ?? 0;
      this.y = opts.y ?? 0;
      this.size = opts.size ?? 480;
      this.flipped = !!opts.flipped;
      this.interactive = opts.interactive !== false;
      this.canMove = opts.canMove || (() => true);
      this.onMove = opts.onMove || null;
      this.play = opts.play || playSound;
      this.pos = null;
      this.last = null;
      this.selected = null;
      this.partial = null;
      this.candidates = [];
      this.anim = null;
      this.down = null;
      this.dragging = false;
      this.pointer = { x: 0, y: 0 };
      this.busy = false;
    }

    setPosition(pos, { last = undefined, animate = null } = {}) {
      this.pos = pos;
      if (last !== undefined) this.last = last;
      this.selected = null;
      this.partial = null;
      this.candidates = [];
      this.dragging = false;
      if (animate && animate.path && animate.path.length > 1) {
        const segments = animate.path.length - 1;
        this.anim = {
          path: animate.path.slice(),
          captures: (animate.captures || []).slice(),
          piece: pos.board[animate.path[animate.path.length - 1]],
          start: now(),
          dur: Math.max(140, Math.min(700, segments * 130)),
        };
      } else {
        this.anim = null;
      }
    }

    setFlip(flipped) {
      this.flipped = !!flipped;
    }

    setCanMove(fn) {
      this.canMove = fn;
    }

    setInteractive(on) {
      this.interactive = !!on;
      if (!on) this.clear();
    }

    squareAt(px, py) {
      if (!this.pos) return -1;
      const n = this.pos.n;
      const cell = this.size / n;
      if (px < this.x || py < this.y || px >= this.x + this.size || py >= this.y + this.size) return -1;
      const col = Math.floor((px - this.x) / cell);
      const row = Math.floor((py - this.y) / cell);
      return indexAt(row, col, this.flipped, n);
    }

    centerOf(index) {
      const r = squareRect(this.x, this.y, this.size, index, this.flipped, this.pos.n);
      return { x: r.x + r.cell / 2, y: r.y + r.cell / 2 };
    }

    clear() {
      this.selected = null;
      this.partial = null;
      this.candidates = [];
    }

    select(sq) {
      if (!this.pos || !this.canMove()) return;
      const moves = this.engine.legalMoves(this.pos).filter((m) => m.from === sq);
      if (!moves.length) { this.clear(); return; }
      this.selected = sq;
      this.partial = null;
      this.candidates = moves;
      this.play("select");
    }

    targets() {
      if (this.selected === null || !this.pos) return [];
      const base = this.partial ? this.partial.path : [this.selected];
      const moves = this.partial ? this.partial.candidates : this.candidates;
      const step = base.length;
      const out = [];
      const seen = new Set();
      for (const m of moves) {
        const to = m.path[step];
        if (to === undefined || seen.has(to)) continue;
        seen.add(to);
        out.push({ to, capture: m.captures.length > 0 });
      }
      return out;
    }

    tap(sq) {
      if (!this.pos || !this.canMove()) { this.clear(); return; }
      if (this.partial) {
        if (this.targets().some((t) => t.to === sq)) { this.advance(sq); return; }
        if (sq === this.partial.path[this.partial.path.length - 1] || sq === this.selected) {
          this.clear();
          return;
        }
        const ch = this.pos.board[sq];
        this.clear();
        if (ch && colorOf(ch) === this.pos.turn) this.select(sq);
        return;
      }
      if (this.selected !== null && this.targets().some((t) => t.to === sq)) {
        this.advance(sq);
        return;
      }
      if (sq === this.selected) { this.clear(); return; }
      const ch = this.pos.board[sq];
      if (ch && colorOf(ch) === this.pos.turn) this.select(sq);
      else this.clear();
    }

    advance(sq) {
      const base = this.partial ? this.partial.path : [this.selected];
      const moves = this.partial ? this.partial.candidates : this.candidates;
      const step = base.length;
      const next = moves.filter((m) => m.path[step] === sq);
      if (!next.length) return;
      const path = base.concat(sq);
      if (next.every((m) => m.path.length === path.length)) {
        this.commit(next[0]);
        return;
      }
      this.partial = {
        path,
        candidates: next,
        captures: next[0].captures.slice(0, path.length - 1),
      };
      this.play("select");
    }

    commit(move) {
      this.selected = null;
      this.partial = null;
      this.candidates = [];
      if (this.onMove) this.onMove(move);
    }

    press(px, py) {
      if (!this.interactive || this.busy || !this.pos) return;
      this.pointer = { x: px, y: py };
      const sq = this.squareAt(px, py);
      this.down = { sq, x: px, y: py };
      this.dragging = false;
      if (sq < 0) { this.clear(); return; }
      this.tap(sq);
    }

    drag(px, py) {
      if (!this.down) return;
      this.pointer = { x: px, y: py };
      const dx = px - this.down.x;
      const dy = py - this.down.y;
      if (dx * dx + dy * dy > 36) this.dragging = true;
    }

    release(px, py) {
      if (!this.down) return;
      this.pointer = { x: px, y: py };
      if (this.dragging && this.interactive && !this.busy) {
        const sq = this.squareAt(px, py);
        if (sq >= 0 && this.targets().some((t) => t.to === sq)) this.advance(sq);
      }
      this.dragging = false;
      this.down = null;
    }

    draw() {
      if (!this.pos) return;
      if (this.anim && this.anim.t === undefined && now() - this.anim.start > this.anim.dur + 40) this.anim = null;

      let display = this.pos.board;
      let current = null;
      if (this.partial) {
        display = this.pos.board.slice();
        const piece = display[this.selected];
        display[this.selected] = null;
        for (const c of this.partial.captures) display[c] = null;
        const at = this.partial.path[this.partial.path.length - 1];
        display[at] = piece;
        current = at;
      }

      drawBoard(this.p, {
        x: this.x,
        y: this.y,
        size: this.size,
        flipped: this.flipped,
        pos: { ...this.pos, board: display },
        selected: this.selected,
        current,
        legal: this.targets(),
        last: this.last,
        anim: this.anim,
      });
      drawCoords(this.p, { x: this.x, y: this.y, size: this.size, flipped: this.flipped, n: this.pos.n });
    }
  }

  // ---- shared DOM helpers (reuse the chess overlay / move-list styling) ----

  function skin() {
    return window.SchachView || null;
  }

  function injectStyle() {
    skin()?.injectStyle?.();
  }

  function renderMoves(el, moves) {
    skin()?.renderMoves?.(el, moves);
  }

  function showResult(container, opts) {
    return skin()?.showResult?.(container, opts) || null;
  }

  function playSound(kind) {
    skin()?.playSound?.(kind);
  }

  function resultInfo(result) {
    if (!result || !result.over) return { title: "", sub: "" };
    const winner = result.winner === "w" ? "Weiß" : result.winner === "b" ? "Schwarz" : null;
    switch (result.reason) {
      case "capturedall":
        return { title: "Sieg!", sub: winner ? `${winner} gewinnt – alle Steine geschlagen.` : "" };
      case "blocked":
        return { title: "Sieg!", sub: winner ? `${winner} gewinnt – keine Züge mehr möglich.` : "" };
      case "fifty":
        return { title: "Remis", sub: "25 Züge ohne Schlag oder einfachen Steinzug." };
      case "repetition":
        return { title: "Remis", sub: "Dreifache Stellungswiederholung." };
      case "resign":
        return { title: "Aufgegeben", sub: winner ? `${winner} gewinnt.` : "" };
      case "leave":
        return { title: "Partie beendet", sub: result.winner ? `${winner} gewinnt – der Gegner hat den Raum verlassen.` : "Der Gegner hat den Raum verlassen." };
      default:
        return { title: "Partie beendet", sub: "" };
    }
  }

  window.DameView = {
    drawPiece,
    drawBoard,
    drawCoords,
    squareRect,
    indexAt,
    rowCol,
    Board,
    injectStyle,
    renderMoves,
    showResult,
    playSound,
    resultInfo,
    rgb,
  };
})();
