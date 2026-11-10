// Schach — shared board renderer, input and small UI helpers.
//
// A plain classic script on purpose: the home previews (manifest.js) need it
// synchronously, the solo game uses it in p5 global mode, and the hub game
// imports it through window.SchachView. Everything is drawn from PAL, so the
// designs keep working; the DOM bits use the theme CSS variables.
//
//   SchachView.drawPiece(p, piece, cx, cy, size)
//   SchachView.drawBoard(p, { x, y, size, flipped, pos, selected, legal, last, check, anim })
//   new SchachView.Board(p, engine, { x, y, size, flipped, canMove, onMove, choosePromotion })
//   SchachView.showPromotion(container, color) -> Promise<"q"|"r"|"b"|"n"|null>
//   SchachView.showResult(container, { title, sub, actionLabel, onAction, onClose })
//   SchachView.playSound("move" | "capture" | "check" | "end" | "select")
//   SchachView.resultInfo(result) -> { title, sub }
//   SchachView.renderMoves(el, sans)

(function () {
  const FILES = "abcdefgh";
  const PIECES = {
    p: [
      "M50 17 C43 17 39 23 39 29 C39 33 41 36 44 38 C37 42 34 51 33 64 L67 64 C66 51 63 42 56 38 C59 36 61 33 61 29 C61 23 57 17 50 17 Z",
      "M31 64 L69 64 Q73 64 73 69 L73 76 Q73 80 69 80 L31 80 Q27 80 27 76 L27 69 Q27 64 31 64 Z",
    ],
    r: [
      "M30 20 L39 20 L39 28 L45 28 L45 20 L55 20 L55 28 L61 28 L61 20 L70 20 L70 38 L65 44 L65 64 L35 64 L35 44 L30 38 Z",
      "M29 64 L71 64 Q75 64 75 69 L75 76 Q75 80 71 80 L29 80 Q25 80 25 76 L25 69 Q25 64 29 64 Z",
    ],
    n: [
      "M66 64 C66 54 66 48 63 43 C61 39 57 36 56 32 L53 23 L49 30 C44 29 39 31 36 36 C34 39 34 42 36 43 C39 44 42 43 45 42 C43 46 40 49 36 51 L33 64 Z",
      "M32 64 L68 64 Q72 64 72 69 L72 76 Q72 80 68 80 L32 80 Q28 80 28 76 L28 69 Q28 64 32 64 Z",
    ],
    b: [
      "M50 20 C41 29 37 37 37 46 C37 54 42 59 50 59 C58 59 63 54 63 46 C63 37 59 29 50 20 Z",
      "M50 11 A5 5 0 1 0 50 21 A5 5 0 1 0 50 11 Z",
      "M36 59 L64 59 L66 64 L34 64 Z",
      "M30 64 L70 64 Q74 64 74 69 L74 76 Q74 80 70 80 L30 80 Q26 80 26 76 L26 69 Q26 64 30 64 Z",
    ],
    q: [
      "M26 38 L22 20 L34 34 L38 18 L46 34 L50 16 L54 34 L62 18 L66 34 L78 20 L74 38 Z",
      "M50 10 A4 4 0 1 0 50 18 A4 4 0 1 0 50 10 Z",
      "M22 14 A4 4 0 1 0 22 22 A4 4 0 1 0 22 14 Z",
      "M38 12 A4 4 0 1 0 38 20 A4 4 0 1 0 38 12 Z",
      "M62 12 A4 4 0 1 0 62 20 A4 4 0 1 0 62 12 Z",
      "M78 14 A4 4 0 1 0 78 22 A4 4 0 1 0 78 14 Z",
      "M32 38 L68 38 L72 62 L28 62 Z",
      "M26 66 L74 66 Q78 66 78 70 L78 77 Q78 81 74 81 L26 81 Q22 81 22 77 L22 70 Q22 66 26 66 Z",
    ],
    k: [
      "M46 10 L54 10 L54 17 L61 17 L61 25 L54 25 L54 32 L46 32 L46 25 L39 25 L39 17 L46 17 Z",
      "M30 40 L34 33 L40 41 L50 30 L60 41 L66 33 L70 40 L68 62 L32 62 Z",
      "M28 62 L72 62 Q76 62 76 67 L76 77 Q76 81 72 81 L28 81 Q24 81 24 77 L24 67 Q24 62 28 62 Z",
    ],
  };

  const pathCache = new Map();
  const path = (d) => {
    let p = pathCache.get(d);
    if (!p) { p = new Path2D(d); pathCache.set(d, p); }
    return p;
  };

  const rgb = (c, a = 255) => `rgba(${c[0]},${c[1]},${c[2]},${a / 255})`;
  const isWhite = (ch) => ch === ch.toUpperCase();
  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function indexAt(row, col, flipped) {
    return flipped ? 63 - (row * 8 + col) : row * 8 + col;
  }

  function rowCol(index, flipped) {
    const row = flipped ? 7 - Math.floor(index / 8) : Math.floor(index / 8);
    const col = flipped ? 7 - (index % 8) : index % 8;
    return { row, col };
  }

  function drawPiece(p, ch, cx, cy, size, opts = {}) {
    if (!ch) return;
    const ctx = p.drawingContext;
    const white = isWhite(ch);
    const fill = white ? PAL.onDark : PAL.onLight;
    const stroke = white ? PAL.onLight : PAL.onDark;
    const scale = size / 100;
    const kind = ch.toLowerCase();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-50, -50);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = opts.lineWidth || 4;
    ctx.fillStyle = rgb(fill);
    ctx.strokeStyle = rgb(stroke);
    if (opts.shadow !== false) {
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
    }
    for (const d of PIECES[kind]) {
      const shape = path(d);
      ctx.fill(shape);
      ctx.stroke(shape);
      ctx.shadowColor = "transparent";
    }
    // little details in the outline colour
    ctx.shadowColor = "transparent";
    ctx.fillStyle = rgb(stroke);
    ctx.strokeStyle = rgb(stroke);
    if (kind === "n") {
      ctx.beginPath();
      ctx.arc(45, 36, 2.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "b") {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(50, 30);
      ctx.lineTo(54, 42);
      ctx.stroke();
    }
    ctx.restore();
  }

  function squareRect(x, y, size, index, flipped) {
    const { row, col } = rowCol(index, flipped);
    const cell = size / 8;
    return { x: x + col * cell, y: y + row * cell, cell };
  }

  function drawBoard(p, o) {
    const { x, y, size, flipped = false, pos, selected = null, legal = [], last = null, check = null, anim = null, drag = null } = o;
    const cell = size / 8;

    p.noStroke();
    p.fill(...PAL.line);
    p.rect(x - 2, y - 2, size + 4, size + 4, 6);

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        p.noStroke();
        p.fill(...((row + col) % 2 === 0 ? PAL.panel : PAL.well));
        p.rect(x + col * cell, y + row * cell, cell + 0.4, cell + 0.4, 0);
      }
    }

    if (last) {
      p.noStroke();
      p.fill(...PAL.sun, 60);
      for (const sq of [last.from, last.to]) {
        const r = squareRect(x, y, size, sq, flipped);
        p.rect(r.x, r.y, r.cell, r.cell, 0);
      }
    }

    if (check !== null && check !== undefined) {
      const r = squareRect(x, y, size, check, flipped);
      p.noStroke();
      p.fill(...PAL.rose, 75);
      p.rect(r.x, r.y, r.cell, r.cell, 0);
      for (let k = 3; k >= 1; k--) {
        p.fill(...PAL.rose, 9);
        p.circle(r.x + r.cell / 2, r.y + r.cell / 2, r.cell * (0.8 + k * 0.3));
      }
    }

    if (selected !== null) {
      const r = squareRect(x, y, size, selected, flipped);
      p.noStroke();
      p.fill(...PAL.lilac, 90);
      p.rect(r.x, r.y, r.cell, r.cell, 0);
    }

    for (const m of legal) {
      const r = squareRect(x, y, size, m.to, flipped);
      const cx = r.x + r.cell / 2, cy = r.y + r.cell / 2;
      if (pos.board[m.to]) {
        p.noFill();
        p.stroke(...PAL.rose, 210);
        p.strokeWeight(Math.max(2, cell * 0.07));
        p.circle(cx, cy, r.cell * 0.84);
        p.noStroke();
      } else {
        p.noStroke();
        p.fill(...PAL.lilac, 205);
        p.circle(cx, cy, r.cell * 0.22);
      }
    }

    const hide = new Set();
    if (anim) hide.add(anim.to);
    if (drag) hide.add(drag.from);

    for (let i = 0; i < 64; i++) {
      if (hide.has(i)) continue;
      const ch = pos.board[i];
      if (!ch) continue;
      const r = squareRect(x, y, size, i, flipped);
      drawPiece(p, ch, r.x + r.cell / 2, r.y + r.cell / 2, cell * 0.98);
    }

    if (anim) {
      const t = Math.min(1, (now() - anim.start) / anim.dur);
      const a = squareRect(x, y, size, anim.from, flipped);
      const b = squareRect(x, y, size, anim.to, flipped);
      const k = ease(t);
      const cx = a.x + a.cell / 2 + (b.x - a.x) * k;
      const cy = a.y + a.cell / 2 + (b.y - a.y) * k;
      drawPiece(p, anim.piece, cx, cy, cell * (0.98 + Math.sin(t * Math.PI) * 0.08));
    }

    if (drag) {
      drawPiece(p, pos.board[drag.from], drag.x, drag.y, cell * 1.04);
    }
  }

  function drawCoords(p, { x, y, size, flipped = false }) {
    const cell = size / 8;
    p.noStroke();
    p.fill(...PAL.dim);
    p.textSize(cell * 0.17);
    p.textAlign(p.RIGHT, p.BOTTOM);
    for (let col = 0; col < 8; col++) {
      const name = flipped ? FILES[7 - col] : FILES[col];
      p.text(name, x + col * cell + cell - 4, y + size - 4);
    }
    p.textAlign(p.LEFT, p.TOP);
    for (let row = 0; row < 8; row++) {
      const name = flipped ? String(row + 1) : String(8 - row);
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
      this.choosePromotion = opts.choosePromotion || null;
      this.onMove = opts.onMove || null;
      this.play = opts.play || playSound;
      this.pos = engine.parseFen(engine.START_FEN);
      this.last = null;
      this.check = null;
      this.selected = null;
      this.legal = [];
      this.anim = null;
      this.down = null;
      this.dragging = false;
      this.pointer = { x: 0, y: 0 };
      this.busy = false;
    }

    setPosition(pos, { last = undefined, animate = null } = {}) {
      this.pos = pos;
      if (last !== undefined) this.last = last;
      this.check = this.engine.inCheck(pos) ? this.engine.kingSquare(pos, pos.turn) : null;
      this.selected = null;
      this.legal = [];
      this.dragging = false;
      if (animate) {
        this.anim = {
          from: animate.from,
          to: animate.to,
          piece: pos.board[animate.to],
          start: now(),
          dur: 180,
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
      if (!on) { this.selected = null; this.legal = []; }
    }

    squareAt(px, py) {
      const cell = this.size / 8;
      if (px < this.x || py < this.y || px >= this.x + this.size || py >= this.y + this.size) return -1;
      const col = Math.floor((px - this.x) / cell);
      const row = Math.floor((py - this.y) / cell);
      return indexAt(row, col, this.flipped);
    }

    centerOf(index) {
      const r = squareRect(this.x, this.y, this.size, index, this.flipped);
      return { x: r.x + r.cell / 2, y: r.y + r.cell / 2 };
    }

    trySelect(sq) {
      const ch = this.pos.board[sq];
      if (!ch || (isWhite(ch) ? "w" : "b") !== this.pos.turn || !this.canMove()) {
        this.selected = null;
        this.legal = [];
        return;
      }
      this.selected = sq;
      this.legal = this.engine.legalMoves(this.pos).filter((m) => m.from === sq);
      this.play("select");
    }

    press(px, py) {
      if (!this.interactive || this.busy) return;
      this.pointer = { x: px, y: py };
      const sq = this.squareAt(px, py);
      this.down = { sq, x: px, y: py };
      this.dragging = false;
      if (sq < 0) {
        this.selected = null;
        this.legal = [];
        return;
      }
      if (this.selected !== null) {
        const targets = this.legal.filter((m) => m.to === sq);
        if (targets.length) { this.commit(targets); return; }
      }
      const ch = this.pos.board[sq];
      if (ch && (isWhite(ch) ? "w" : "b") === this.pos.turn) this.trySelect(sq);
      else { this.selected = null; this.legal = []; }
    }

    drag(px, py) {
      if (!this.down || this.selected === null) return;
      this.pointer = { x: px, y: py };
      const dx = px - this.down.x, dy = py - this.down.y;
      if (dx * dx + dy * dy > 36) this.dragging = true;
    }

    release(px, py) {
      if (!this.down) return;
      this.pointer = { x: px, y: py };
      if (this.dragging && this.interactive && !this.busy) {
        const sq = this.squareAt(px, py);
        const targets = sq >= 0 ? this.legal.filter((m) => m.to === sq) : [];
        if (targets.length) this.commit(targets);
        else if (sq !== this.selected) { this.selected = null; this.legal = []; }
      }
      this.dragging = false;
      this.down = null;
    }

    commit(targets) {
      if (!this.onMove) return;
      if (targets.length > 1 && targets[0].promo) {
        this.busy = true;
        const color = this.pos.turn;
        Promise.resolve(this.choosePromotion ? this.choosePromotion(color) : "q").then((promo) => {
          this.busy = false;
          if (!promo) { this.selected = null; this.legal = []; return; }
          const move = targets.find((m) => m.promo === promo);
          if (move) this.emit(move);
          else { this.selected = null; this.legal = []; }
        });
        return;
      }
      this.emit(targets[0]);
    }

    emit(move) {
      this.selected = null;
      this.legal = [];
      this.onMove(move);
    }

    draw() {
      if (this.anim && now() - this.anim.start > this.anim.dur + 40) this.anim = null;
      drawBoard(this.p, {
        x: this.x, y: this.y, size: this.size,
        flipped: this.flipped,
        pos: this.pos,
        selected: this.selected,
        legal: this.legal,
        last: this.last,
        check: this.check,
        anim: this.anim,
        drag: this.dragging && this.selected !== null
          ? { from: this.selected, x: this.pointer.x, y: this.pointer.y }
          : null,
      });
      drawCoords(this.p, { x: this.x, y: this.y, size: this.size, flipped: this.flipped });
    }
  }

  // ---- DOM helpers (theme variables, no hard-coded colours) ----

  function injectStyle() {
    if (document.getElementById("schach-style")) return;
    const st = document.createElement("style");
    st.id = "schach-style";
    st.textContent = `
.schach-moves { margin-top: 14px; border: 1px solid var(--hairline); background: var(--panel); border-radius: var(--r-sm); overflow: hidden; }
.schach-moves-head { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--hairline); }
.schach-moves-body { max-height: 168px; overflow-y: auto; padding: 4px 6px; font-variant-numeric: tabular-nums; }
.schach-moves-row { display: grid; grid-template-columns: 30px 1fr 1fr; gap: 4px; padding: 2px 4px; font-size: 13px; }
.schach-moves-row:nth-child(odd) { background: color-mix(in srgb, var(--panel-2) 55%, transparent); border-radius: 4px; }
.schach-moves-row .nr { color: var(--dim); }
.schach-moves-row .san.on { color: var(--accent); font-weight: 700; }
.schach-moves-empty { padding: 8px 4px; color: var(--muted); font-size: 13px; }
.schach-overlay { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; padding: 14px; background: color-mix(in srgb, var(--board) 74%, transparent); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); border-radius: inherit; }
.schach-box { position: relative; width: min(320px, 100%); padding: 18px 16px 14px; text-align: center; background: var(--panel); border: var(--border-w) solid var(--hairline); border-radius: var(--r-md); box-shadow: var(--wrap-shadow); line-height: 1.35; }
.schach-box h3 { margin: 0 0 4px; font-family: var(--font-display); font-size: 19px; line-height: 1.2; color: var(--ink); }
.schach-box p { margin: 0 0 12px; color: var(--muted); font-size: 13px; line-height: 1.35; }
.schach-box .row button { line-height: 1.2; }
.schach-box .row { justify-content: center; margin: 0; }
.schach-box .row button { flex: 0 1 auto; min-width: 96px; }
.schach-box-x { position: absolute; top: 6px; right: 8px; flex: none; width: 26px; min-width: 0; height: 26px; padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--muted); font-size: 16px; line-height: 1; }
.schach-box-x:hover { background: transparent; color: var(--ink); }
.schach-promo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.schach-promo-grid button { display: flex; align-items: center; gap: 8px; justify-content: center; line-height: 1.3; }
.schach-promo-glyph { font-size: 20px; line-height: 1; }
.schach-hub { display: grid; grid-template-columns: minmax(0, 540px) minmax(230px, 1fr); gap: 26px; align-items: start; }
.schach-boardwrap { position: relative; width: 100%; max-width: 540px; border-radius: var(--r-md); overflow: hidden; }
.schach-boardwrap canvas { display: block; width: 100% !important; height: auto !important; }
.schach-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.schach-status { padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-sm); background: var(--panel); font-size: 14px; }
.schach-status b { color: var(--ink); }
.schach-status .dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; background: var(--dim); vertical-align: 1px; }
.schach-status.live .dot { background: var(--mint); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mint) 18%, transparent); }
.schach-status.over .dot { background: var(--rose); }
.schach-player { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r-sm); font-size: 13px; color: var(--muted); }
.schach-player.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--ink); }
.schach-player.gone span:not(.tag-me) { text-decoration: line-through; opacity: .6; }
.schach-player .dot { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 1px solid var(--hairline); }
.schach-player .dot.w { background: var(--ink); }
.schach-player .dot.b { background: var(--muted); }
.schach-player .piece { width: 18px; text-align: center; font-size: 16px; }
.schach-player .tag-me { margin-left: auto; font-size: 11px; color: var(--accent); }
.schach-spectators { font-size: 12px; color: var(--muted); }
.schach-side .row { margin: 0; }
.schach-note { font-size: 12px; color: var(--muted); }
@media (max-width: 860px) {
  .schach-hub { grid-template-columns: 1fr; gap: 16px; }
  .schach-moves-body { max-height: 132px; }
}
`;
    document.head.appendChild(st);
  }

  function renderMoves(el, sans) {
    if (!el) return;
    const rows = [];
    for (let i = 0; i < sans.length; i += 2) {
      const n = i / 2 + 1;
      const w = sans[i] || "";
      const b = sans[i + 1] || "";
      rows.push(`<div class="schach-moves-row"><span class="nr">${n}.</span><span class="san${i === sans.length - 1 ? " on" : ""}">${w}</span><span class="san${i + 1 === sans.length - 1 ? " on" : ""}">${b}</span></div>`);
    }
    el.innerHTML = rows.length ? rows.join("") : `<div class="schach-moves-empty">Noch keine Züge</div>`;
    el.scrollTop = el.scrollHeight;
  }

  function showPromotion(container, color) {
    injectStyle();
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "schach-overlay";
      el.innerHTML = `<div class="schach-box" role="dialog" aria-modal="true" aria-label="Umwandlung">
        <h3>Umwandlung</h3><p>Wähle die neue Figur.</p>
        <div class="schach-promo-grid">
          ${[["q", "Dame", "♕"], ["r", "Turm", "♖"], ["b", "Läufer", "♗"], ["n", "Springer", "♘"]]
            .map(([v, label, glyph]) => `<button type="button" data-promo="${v}"><span class="schach-promo-glyph" aria-hidden="true">${glyph}</span>${label}</button>`)
            .join("")}
        </div>
      </div>`;
      const done = (value) => {
        el.remove();
        document.removeEventListener("keydown", onKey);
        resolve(value);
      };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-promo]");
        if (b) done(b.dataset.promo);
      });
      document.addEventListener("keydown", onKey);
      container.appendChild(el);
    });
  }

  function showResult(container, { title, sub, actionLabel, onAction, onClose }) {
    injectStyle();
    container.querySelectorAll(".schach-overlay").forEach((n) => n.remove());
    const el = document.createElement("div");
    el.className = "schach-overlay";
    el.innerHTML = `<div class="schach-box" role="dialog" aria-modal="true" aria-label="${title}">
      ${onClose ? `<button type="button" class="schach-box-x" aria-label="Schließen">✕</button>` : ""}
      <h3>${title}</h3>
      ${sub ? `<p>${sub}</p>` : "<p></p>"}
      ${actionLabel ? `<div class="row"><button type="button" class="primary" data-result-action>${actionLabel}</button></div>` : ""}
    </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-result-action]") && onAction) onAction();
      else if (e.target.closest(".schach-box-x") && onClose) { el.remove(); onClose(); }
    });
    container.appendChild(el);
    return el;
  }

  let audio = null;
  function playSound(kind) {
    try {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t = audio.currentTime;
      const notes = {
        select: [[520, 0.025, 0.012]],
        move: [[260, 0.05, 0.03], [190, 0.06, 0.018]],
        capture: [[180, 0.05, 0.04], [120, 0.12, 0.035]],
        check: [[720, 0.07, 0.032], [980, 0.12, 0.026]],
        end: [[523, 0.12, 0.035], [659, 0.12, 0.03], [784, 0.22, 0.03]],
      }[kind] || [];
      for (const [freq, dur, gain] of notes) {
        const osc = audio.createOscillator();
        const g = audio.createGain();
        osc.type = kind === "capture" ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(audio.destination);
        osc.start(t);
        osc.stop(t + dur + 0.01);
      }
    } catch {}
  }

  function resultInfo(result) {
    if (!result || !result.over) return { title: "", sub: "" };
    const winner = result.winner === "w" ? "Weiß" : result.winner === "b" ? "Schwarz" : null;
    switch (result.reason) {
      case "checkmate": return { title: "Matt!", sub: `${winner} gewinnt.` };
      case "stalemate": return { title: "Patt", sub: "Keine legalen Züge – Remis." };
      case "fifty": return { title: "Remis", sub: "50 Züge ohne Bauernzug oder Schlag." };
      case "repetition": return { title: "Remis", sub: "Dreifache Stellungswiederholung." };
      case "material": return { title: "Remis", sub: "Unzureichendes Material." };
      case "leave": return { title: "Partie beendet", sub: result.winner ? `${winner} gewinnt – der Gegner hat den Raum verlassen.` : "Der Gegner hat den Raum verlassen." };
      case "resign": return { title: "Aufgegeben", sub: winner ? `${winner} gewinnt.` : "" };
      default: return { title: "Partie beendet", sub: "" };
    }
  }

  window.SchachView = {
    PIECES,
    drawPiece,
    drawBoard,
    drawCoords,
    squareRect,
    indexAt,
    rowCol,
    Board,
    injectStyle,
    renderMoves,
    showPromotion,
    showResult,
    playSound,
    resultInfo,
    rgb,
  };
})();
