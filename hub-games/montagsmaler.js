// Montagsmaler (Skribbl-Prinzip) für den Mehrspieler-Hub.
//
// Ein Spieler zeichnet einen Begriff, alle anderen raten live im Chat.
// Der Zeichner wählt aus 3 Begriffen. Rater erhalten Punkte nach Restzeit (max. 500 Pkt).
// Der Zeichner erhält anteilig Punkte für jeden richtigen Rater.
//
// Features:
// - Host wählt Rundenanzahl oder Punkte-Ziel, Rundenzeit (45–120s), Sprache (DE/EN) und Kategorien.
// - Zeichen-Tools: Stift (verschiedene Stärken), Farbpalette, Fülleimer (Flood Fill), Radierer, Undo, Clear.
// - Couch-Party-Modus: Wort verdecken mit Augen-Icon (nur bei Hover / Berührung sichtbar).
// - "Nah dran"-Hinweis bei Tippfehlern (nur für den Ratenden gelb sichtbar).
// - Responsive Canvas für Desktop & Mobilgeräte (Touch-Support).

import { shell } from "../hub-kit.js";
import {
  WORDS,
  CATEGORY_LABELS,
  getRandomWordOptions,
  normalizeWord,
  isNearGuess,
} from "./montagsmaler-words.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const CANVAS_W = 800;
const CANVAS_H = 600;
const BG_COLOR = "#ffffff";

const PALETTE = [
  "#1a1a1a", "#555555", "#9e9e9e", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047",
  "#00acc1", "#1e88e5", "#8e24aa", "#d81b60",
  "#6d4c41", "#ffb74d", "#cddc39", "#00897b"
];

const SIZES = [3, 7, 14, 28];

function floodFill(ctx, startX, startY, fillColorHex) {
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const targetIdx = (startY * w + startX) * 4;
  const tr = data[targetIdx], tg = data[targetIdx + 1], tb = data[targetIdx + 2], ta = data[targetIdx + 3];

  let fr = 0, fg = 0, fb = 0;
  if (fillColorHex.startsWith("#")) {
    fr = parseInt(fillColorHex.slice(1, 3), 16);
    fg = parseInt(fillColorHex.slice(3, 5), 16);
    fb = parseInt(fillColorHex.slice(5, 7), 16);
  }
  const fa = 255;

  if (Math.abs(tr - fr) < 6 && Math.abs(tg - fg) < 6 && Math.abs(tb - fb) < 6 && Math.abs(ta - fa) < 6) {
    return;
  }

  // Erhöhte Toleranz für weiche Übergänge
  const tol = 55;
  const match = (idx) => {
    return (
      Math.abs(data[idx] - tr) <= tol &&
      Math.abs(data[idx + 1] - tg) <= tol &&
      Math.abs(data[idx + 2] - tb) <= tol
    );
  };

  const total = w * h;
  const filled = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qHead = 0, qTail = 0;

  const startPos = startY * w + startX;
  filled[startPos] = 1;
  queue[qTail++] = startPos;

  while (qHead < qTail) {
    const pos = queue[qHead++];
    const cx = pos % w;
    const cy = Math.floor(pos / w);

    if (cx > 0) {
      const npos = pos - 1;
      if (!filled[npos] && match(npos * 4)) {
        filled[npos] = 1;
        queue[qTail++] = npos;
      }
    }
    if (cx < w - 1) {
      const npos = pos + 1;
      if (!filled[npos] && match(npos * 4)) {
        filled[npos] = 1;
        queue[qTail++] = npos;
      }
    }
    if (cy > 0) {
      const npos = pos - w;
      if (!filled[npos] && match(npos * 4)) {
        filled[npos] = 1;
        queue[qTail++] = npos;
      }
    }
    if (cy < h - 1) {
      const npos = pos + w;
      if (!filled[npos] && match(npos * 4)) {
        filled[npos] = 1;
        queue[qTail++] = npos;
      }
    }
  }

  // Rand-Dilatation: schließt weiße Säume an Linienrändern
  const dilate = new Uint8Array(total);
  for (let i = 0; i < qTail; i++) {
    const pos = queue[i];
    const cx = pos % w;
    const cy = Math.floor(pos / w);

    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= w) continue;
        const npos = ny * w + nx;
        if (!filled[npos] && !dilate[npos]) {
          const nidx = npos * 4;
          const diff = Math.abs(data[nidx] - tr) + Math.abs(data[nidx + 1] - tg) + Math.abs(data[nidx + 2] - tb);
          if (diff < 200) {
            dilate[npos] = 1;
          }
        }
      }
    }
  }

  for (let pos = 0; pos < total; pos++) {
    if (filled[pos] || dilate[pos]) {
      const idx = pos * 4;
      data[idx] = fr;
      data[idx + 1] = fg;
      data[idx + 2] = fb;
      data[idx + 3] = fa;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export default {
  min: 2,
  max: 8,

  mount(ctx) {
    const kit = shell(ctx, { title: "Montagsmaler" });
    const root = kit.body;
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };
    const every = (fn, ms) => {
      const t = setInterval(fn, ms);
      timers.add(t);
      return t;
    };

    const me = () => ctx.me.id;
    const isMe = (id) => id === me();

    // ---- Zustand ----
    let config = {
      targetType: "rounds", // "rounds" | "points"
      targetVal: 3,         // 3 Runden oder 1000 Punkte
      duration: 80,         // Sekunden pro Zeichner
      lang: "de",           // "de" | "en"
      categories: ["standard", "games", "filme", "tiere", "kinder"],
      customWordsStr: "",
    };

    let st = {
      phase: "setup", // "setup" | "pick" | "drawing" | "round_end" | "game_over"
      scores: {},     // id -> punkte
      turnIdx: 0,
      roundNum: 1,
      currentDrawer: null,
      secretWord: "",
      wordChoices: [],
      maskWord: false,
      timeLeft: 80,
      guessedIds: [], // wer in dieser Runde schon richtig geraten hat
      chat: [],       // { id, name, text, kind: "guess"|"correct"|"near"|"system" }
      actions: [],    // zeichen-aktionen für replay / sync
    };

    // Client-seitige Werkzeuge
    let tool = "brush"; // "brush" | "eraser" | "fill"
    let color = PALETTE[0];
    let brushSize = SIZES[1];
    let isDrawing = false;
    let currentStroke = null;
    let hideWord = false; // Couch-Modus

    // DOM Struktur
    root.innerHTML = `<div class="mm-wrap"></div>`;
    const mmWrap = root.querySelector(".mm-wrap");

    // Canvas Element erzeugen
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const cctx = canvas.getContext("2d", { willReadFrequently: true });

    function resetCanvas() {
      cctx.fillStyle = BG_COLOR;
      cctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    resetCanvas();

    function stampCircle(ctx, cx, cy, r, c) {
      cx = Math.round(cx);
      cy = Math.round(cy);
      r = Math.max(1, Math.round(r));
      const r2 = r * r;
      ctx.fillStyle = c;
      for (let dy = -r; dy <= r; dy++) {
        const maxDx = Math.floor(Math.sqrt(r2 - dy * dy));
        ctx.fillRect(cx - maxDx, cy + dy, maxDx * 2 + 1, 1);
      }
    }

    function drawCrispCapsule(ctx, x0, y0, x1, y1, r, c) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.4)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        stampCircle(ctx, x0 + dx * t, y0 + dy * t, r, c);
      }
    }

    function renderAction(act) {
      if (!act) return;
      if (act.type === "clear") {
        resetCanvas();
      } else if (act.type === "fill") {
        floodFill(cctx, act.x, act.y, act.color);
      } else if (act.type === "stroke" && act.points && act.points.length > 0) {
        const c = act.tool === "eraser" ? BG_COLOR : act.color;
        const r = Math.max(1, Math.round(act.size / 2));
        const pts = act.points;
        if (pts.length === 1) {
          stampCircle(cctx, pts[0][0], pts[0][1], r, c);
        } else {
          for (let i = 1; i < pts.length; i++) {
            drawCrispCapsule(cctx, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, c);
          }
        }
      }
    }

    function replayAllActions() {
      resetCanvas();
      for (const act of st.actions) {
        renderAction(act);
      }
    }

    // Pointer-Events fürs Zeichnen
    function getCanvasCoords(e) {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
      const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
      return [Math.round(x), Math.round(y)];
    }

    function updateBrushCursor(e) {
      const cursorEl = mmWrap.querySelector(".mm-brush-cursor");
      if (!cursorEl) return;
      if (tool === "fill" || st.phase !== "drawing" || st.currentDrawer !== me()) {
        cursorEl.hidden = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / CANVAS_W;
      const pxSize = Math.max(6, brushSize * scale);
      cursorEl.hidden = false;
      cursorEl.style.width = pxSize + "px";
      cursorEl.style.height = pxSize + "px";
      cursorEl.style.left = (e.clientX - rect.left) + "px";
      cursorEl.style.top = (e.clientY - rect.top) + "px";
    }

    canvas.addEventListener("pointerenter", updateBrushCursor);
    canvas.addEventListener("pointerleave", () => {
      const cursorEl = mmWrap.querySelector(".mm-brush-cursor");
      if (cursorEl) cursorEl.hidden = true;
    });

    canvas.addEventListener("pointerdown", (e) => {
      if (st.phase !== "drawing" || st.currentDrawer !== me()) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      updateBrushCursor(e);
      const [x, y] = getCanvasCoords(e);

      if (tool === "fill") {
        const act = { type: "fill", color, x, y };
        st.actions.push(act);
        renderAction(act);
        ctx.send("draw", act);
        return;
      }

      isDrawing = true;
      currentStroke = {
        type: "stroke",
        tool,
        color,
        size: brushSize,
        points: [[x, y]],
      };
      renderAction(currentStroke);
    });

    canvas.addEventListener("pointermove", (e) => {
      updateBrushCursor(e);
      if (!isDrawing || !currentStroke) return;
      e.preventDefault();
      const [x, y] = getCanvasCoords(e);
      currentStroke.points.push([x, y]);

      const r = Math.max(1, Math.round(brushSize / 2));
      const c = tool === "eraser" ? BG_COLOR : color;
      const pts = currentStroke.points;
      const len = pts.length;
      if (len >= 2) {
        drawCrispCapsule(cctx, pts[len - 2][0], pts[len - 2][1], pts[len - 1][0], pts[len - 1][1], r, c);
      }

      // Bei längeren Strichen in Häppchen synchronisieren
      if (currentStroke.points.length % 5 === 0) {
        ctx.send("draw_stream", {
          tool,
          color,
          size: brushSize,
          points: currentStroke.points.slice(-6),
        });
      }
    });

    const finishStroke = () => {
      if (!isDrawing || !currentStroke) return;
      isDrawing = false;
      st.actions.push(currentStroke);
      ctx.send("draw", currentStroke);
      currentStroke = null;
    };

    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);

    // Initialisiere Scores
    for (const p of ctx.players) {
      if (st.scores[p.id] == null) st.scores[p.id] = 0;
    }

    // ---- Render-Funktionen ----
    function render() {
      if (st.phase === "setup") {
        renderSetup();
      } else {
        renderGameUI();
      }
    }

    function renderSetup() {
      const isHost = !!ctx.isHost;
      const cats = config.categories;
      const labels = CATEGORY_LABELS[config.lang] || CATEGORY_LABELS.de;

      mmWrap.innerHTML = `
        <div class="mm-setup-card">
          <h2 class="mm-setup-title">🎨 Montagsmaler</h2>
          <p class="mm-setup-desc">Wähle Begriffe, zeichne sie und rate live im Chat mit deinen Freunden!</p>
          
          <div class="mm-setup-grid">
            <div class="mm-field">
              <label class="mm-label">Spielziel</label>
              <div class="mm-seg" data-setting="targetType">
                <button type="button" class="mm-seg-btn ${config.targetType === "rounds" ? "on" : ""}" data-val="rounds" ${!isHost ? "disabled" : ""}>Runden</button>
                <button type="button" class="mm-seg-btn ${config.targetType === "points" ? "on" : ""}" data-val="points" ${!isHost ? "disabled" : ""}>Punkte</button>
              </div>
            </div>

            <div class="mm-field">
              <label class="mm-label">${config.targetType === "rounds" ? "Runden pro Spieler" : "Punkte-Ziel"}</label>
              <div class="mm-seg" data-setting="targetVal">
                ${
                  config.targetType === "rounds"
                    ? [1, 2, 3, 5].map((v) => `<button type="button" class="mm-seg-btn ${config.targetVal === v ? "on" : ""}" data-val="${v}" ${!isHost ? "disabled" : ""}>${v}</button>`).join("")
                    : [500, 1000, 1500, 2000].map((v) => `<button type="button" class="mm-seg-btn ${config.targetVal === v ? "on" : ""}" data-val="${v}" ${!isHost ? "disabled" : ""}>${v}</button>`).join("")
                }
              </div>
            </div>

            <div class="mm-field">
              <label class="mm-label">Rundenzeit</label>
              <div class="mm-seg" data-setting="duration">
                ${[45, 60, 80, 100, 120].map((s) => `<button type="button" class="mm-seg-btn ${config.duration === s ? "on" : ""}" data-val="${s}" ${!isHost ? "disabled" : ""}>${s}s</button>`).join("")}
              </div>
            </div>

            <div class="mm-field">
              <label class="mm-label">Sprache</label>
              <div class="mm-seg" data-setting="lang">
                <button type="button" class="mm-seg-btn ${config.lang === "de" ? "on" : ""}" data-val="de" ${!isHost ? "disabled" : ""}>Deutsch</button>
                <button type="button" class="mm-seg-btn ${config.lang === "en" ? "on" : ""}" data-val="en" ${!isHost ? "disabled" : ""}>English</button>
              </div>
            </div>

            <div class="mm-field mm-field-full">
              <label class="mm-label">Begriff-Kategorien</label>
              <div class="mm-chips">
                ${Object.keys(labels).map((k) => `
                  <button type="button" class="mm-chip ${cats.includes(k) ? "on" : ""}" data-cat="${k}" ${!isHost ? "disabled" : ""}>
                    ${esc(labels[k])}
                  </button>
                `).join("")}
              </div>
            </div>

            <div class="mm-field mm-field-full">
              <label class="mm-label">Eigene Begriffe (optional, mit Komma getrennt)</label>
              <textarea class="mm-textarea" placeholder="z. B. Grillparty, Rasenmäher, Kaffeepause" ${!isHost ? "disabled" : ""}>${esc(config.customWordsStr)}</textarea>
            </div>
          </div>

          <div class="mm-setup-foot">
            ${
              isHost
                ? `<button type="button" class="primary mm-start-btn">Spiel starten</button>`
                : `<div class="mm-wait-msg">Warte auf Spielstart durch den Host (<b>${esc(ctx.players.find((p) => p.host)?.name || "Host")}</b>)...</div>`
            }
          </div>
        </div>
      `;

      if (isHost) {
        // Event-Handler für Einstellungen
        mmWrap.querySelectorAll(".mm-seg-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const p = btn.closest(".mm-seg");
            const setting = p.dataset.setting;
            let val = btn.dataset.val;
            if (setting === "targetVal" || setting === "duration") val = parseInt(val, 10);
            if (setting === "targetType") {
              config.targetType = val;
              config.targetVal = val === "rounds" ? 3 : 1000;
            } else {
              config[setting] = val;
            }
            broadcastConfig();
            renderSetup();
          });
        });

        mmWrap.querySelectorAll(".mm-chip").forEach((chip) => {
          chip.addEventListener("click", () => {
            const cat = chip.dataset.cat;
            if (config.categories.includes(cat)) {
              if (config.categories.length > 1) {
                config.categories = config.categories.filter((c) => c !== cat);
              }
            } else {
              config.categories.push(cat);
            }
            broadcastConfig();
            renderSetup();
          });
        });

        const ta = mmWrap.querySelector(".mm-textarea");
        if (ta) {
          ta.addEventListener("input", () => {
            config.customWordsStr = ta.value;
            broadcastConfig();
          });
        }

        const startBtn = mmWrap.querySelector(".mm-start-btn");
        if (startBtn) {
          startBtn.addEventListener("click", () => {
            hostStartGame();
          });
        }
      }
    }

    function broadcastConfig() {
      ctx.send("config_update", config);
    }

    function renderGameUI() {
      const activePlayer = ctx.players[st.turnIdx] || ctx.players[0];
      const isDrawer = st.currentDrawer === me();
      const hasGuessed = st.guessedIds.includes(me());

      // Maskierter Text für Rater
      let hintText = "";
      if (isDrawer || st.phase === "round_end" || st.phase === "game_over") {
        hintText = st.secretWord || "???";
      } else if (hasGuessed) {
        hintText = st.secretWord || "???";
      } else if (st.secretWord) {
        hintText = st.secretWord
          .split("")
          .map((ch) => (ch === " " ? "  " : "_ "))
          .join("")
          .trim();
      }

      mmWrap.innerHTML = `
        <div class="mm-game-grid">
          <!-- Linke Spalte: Spieler-Rangliste & Punkte -->
          <div class="mm-panel mm-players-panel">
            <div class="mm-panel-head">
              <span class="mm-round-badge">Runde ${st.roundNum}</span>
              <span class="mm-turn-info">${esc(activePlayer?.name || "")} zeichnet</span>
            </div>
            <div class="mm-player-list">
              ${ctx.players
                .map((p) => {
                  const pts = st.scores[p.id] || 0;
                  const isCurDrawer = p.id === st.currentDrawer;
                  const isDone = st.guessedIds.includes(p.id);
                  return `
                    <div class="mm-player-row ${isCurDrawer ? "drawer" : ""} ${isDone ? "guessed" : ""}">
                      <div class="mm-p-rank">${isCurDrawer ? "✏️" : isDone ? "✓" : ""}</div>
                      <div class="mm-p-info">
                        <span class="mm-p-name">${esc(p.name)} ${p.id === me() ? '<small class="mm-you">(Du)</small>' : ""}</span>
                        <span class="mm-p-score">${pts} Pkt</span>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>

          <!-- Mittlere Spalte: Statuszeile, Canvas, Werkzeuge -->
          <div class="mm-main-area">
            <div class="mm-top-bar">
              <div class="mm-timer ${st.timeLeft <= 10 ? "urgent" : ""}">
                ⏱️ <span>${st.timeLeft}s</span>
              </div>
              <div class="mm-word-display ${isDrawer && hideWord ? "masked" : ""}">
                <span class="mm-word-txt">${esc(hintText)}</span>
                ${
                  isDrawer
                    ? `<button type="button" class="mm-eye-btn ${hideWord ? "active" : ""}" title="${hideWord ? "Wort aufdecken" : "Couch-Modus: Wort verdecken (nur bei Hover sichtbar)"}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                       </button>`
                    : ""
                }
              </div>
              ${isDrawer && hideWord ? '<div class="mm-hover-hint">Hover / Touch zum Anzeigen</div>' : ""}
            </div>

            <!-- Canvas Container -->
            <div class="mm-canvas-holder">
              <!-- canvas element wird hier reingehängt -->
              ${
                st.phase === "pick"
                  ? `
                <div class="mm-overlay">
                  ${
                    isDrawer
                      ? `
                    <div class="mm-dialog">
                      <h3>Wähle einen Begriff:</h3>
                      <div class="mm-word-choices">
                        ${st.wordChoices
                          .map((w) => `<button type="button" class="primary mm-choice-btn" data-word="${esc(w)}">${esc(w)}</button>`)
                          .join("")}
                      </div>
                    </div>`
                      : `
                    <div class="mm-dialog">
                      <p><b>${esc(activePlayer?.name || "Spieler")}</b> wählt ein Wort...</p>
                    </div>`
                  }
                </div>`
                  : ""
              }
              ${
                st.phase === "round_end"
                  ? `
                <div class="mm-overlay">
                  <div class="mm-dialog">
                    <h3>Runde beendet!</h3>
                    <p class="mm-reveal-txt">Das Wort war: <b>${esc(st.secretWord)}</b></p>
                    <p class="mm-next-info">Nächste Runde startet gleich...</p>
                  </div>
                </div>`
                  : ""
              }
              ${
                st.phase === "game_over"
                  ? `
                <div class="mm-overlay">
                  <div class="mm-dialog mm-gameover-dialog">
                    <h2>🏆 Spielende!</h2>
                    <div class="mm-podium">
                      ${ctx.players
                        .slice()
                        .sort((a, b) => (st.scores[b.id] || 0) - (st.scores[a.id] || 0))
                        .map((p, i) => `
                          <div class="mm-podium-row rank-${i + 1}">
                            <span class="mm-podium-place">#${i + 1}</span>
                            <span class="mm-podium-name">${esc(p.name)}</span>
                            <span class="mm-podium-score">${st.scores[p.id] || 0} Pkt</span>
                          </div>
                        `)
                        .join("")}
                    </div>
                    ${
                      ctx.isHost
                        ? `<button type="button" class="primary mm-again-btn">Nochmal spielen</button>`
                        : `<p class="mm-wait-msg">Warte auf den Host...</p>`
                    }
                  </div>
                </div>`
                  : ""
              }
            </div>

            <!-- Werkzeugleiste (nur für Zeichner) -->
            ${
              isDrawer && st.phase === "drawing"
                ? `
              <div class="mm-toolbar">
                <div class="mm-tool-group">
                  <button type="button" class="mm-tool-btn ${tool === "brush" ? "on" : ""}" data-tool="brush" title="Stift">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  </button>
                  <button type="button" class="mm-tool-btn ${tool === "fill" ? "on" : ""}" data-tool="fill" title="Fülleimer">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></svg>
                  </button>
                  <button type="button" class="mm-tool-btn ${tool === "eraser" ? "on" : ""}" data-tool="eraser" title="Radiergummi">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
                  </button>
                </div>

                <div class="mm-sizes">
                  ${SIZES.map((sz) => `
                    <button type="button" class="mm-size-btn ${brushSize === sz ? "on" : ""}" data-size="${sz}" title="Größe ${sz}px">
                      <span class="mm-size-dot" style="width:${Math.max(4, sz)}px;height:${Math.max(4, sz)}px;"></span>
                    </button>
                  `).join("")}
                  <div class="mm-size-preview-wrap" title="Aktuelle Pinselgröße">
                    <div class="mm-size-preview-dot" style="width:${brushSize}px;height:${brushSize}px;"></div>
                  </div>
                </div>

                <div class="mm-palette">
                  ${PALETTE.map((c) => `
                    <button type="button" class="mm-color-swatch ${color === c ? "on" : ""}" data-color="${c}" style="background-color:${c};"></button>
                  `).join("")}
                </div>

                <div class="mm-actions">
                  <button type="button" class="mm-action-btn mm-undo" title="Rückgängig">↩️</button>
                  <button type="button" class="mm-action-btn mm-clear" title="Alles löschen">🗑️</button>
                </div>
              </div>`
                : ""
            }
          </div>

          <!-- Rechte Spalte: Live-Chat & Raten -->
          <div class="mm-panel mm-chat-panel">
            <div class="mm-panel-head">
              <span>Chat &amp; Ratetipps</span>
            </div>
            <div class="mm-chat-box">
              <div class="mm-messages">
                ${st.chat
                  .map((msg) => {
                    if (msg.kind === "correct") {
                      return `<div class="mm-msg mm-msg-correct">🎉 <b>${esc(msg.name)}</b> hat das Wort erraten!</div>`;
                    }
                    if (msg.kind === "near") {
                      return `<div class="mm-msg mm-msg-near">⚠️ Du bist ganz nah dran!</div>`;
                    }
                    if (msg.kind === "system") {
                      return `<div class="mm-msg mm-msg-system">${esc(msg.text)}</div>`;
                    }
                    return `<div class="mm-msg"><span class="mm-msg-author">${esc(msg.name)}:</span> <span class="mm-msg-body">${esc(msg.text)}</span></div>`;
                  })
                  .join("")}
              </div>
            </div>
            <form class="mm-chat-form">
              <input type="text" class="mm-chat-in" placeholder="${isDrawer ? "Du zeichnest gerade..." : hasGuessed ? "Du hast das Wort schon erraten!" : "Tippe deine Vermutung..."}" ${isDrawer || hasGuessed || st.phase !== "drawing" ? "disabled" : ""} />
              <button type="submit" class="primary mm-chat-send" ${isDrawer || hasGuessed || st.phase !== "drawing" ? "disabled" : ""}>Senden</button>
            </form>
          </div>
        </div>
      `;

      // Canvas anhängen
      const holder = mmWrap.querySelector(".mm-canvas-holder");
      if (holder) {
        holder.insertBefore(canvas, holder.firstChild);
        let cursorEl = holder.querySelector(".mm-brush-cursor");
        if (!cursorEl) {
          cursorEl = document.createElement("div");
          cursorEl.className = "mm-brush-cursor";
          cursorEl.hidden = true;
          holder.appendChild(cursorEl);
        }
      }

      // Chat nach unten scrollen
      const msgBox = mmWrap.querySelector(".mm-chat-box");
      if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;

      // Event Listeners für Buttons
      const eyeBtn = mmWrap.querySelector(".mm-eye-btn");
      if (eyeBtn) {
        eyeBtn.addEventListener("click", () => {
          hideWord = !hideWord;
          renderGameUI();
        });
      }

      // Begriffsauswahl
      mmWrap.querySelectorAll(".mm-choice-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const w = btn.dataset.word;
          if (ctx.isHost) {
            hostWordChosen(w);
          } else {
            ctx.send("word_chosen", { word: w });
          }
        });
      });

      // Nochmal spielen
      const againBtn = mmWrap.querySelector(".mm-again-btn");
      if (againBtn) {
        againBtn.addEventListener("click", () => {
          hostStartGame();
        });
      }

      // Toolbar Buttons
      mmWrap.querySelectorAll(".mm-tool-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          tool = btn.dataset.tool;
          renderGameUI();
        });
      });

      mmWrap.querySelectorAll(".mm-size-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          brushSize = parseInt(btn.dataset.size, 10);
          renderGameUI();
        });
      });

      mmWrap.querySelectorAll(".mm-color-swatch").forEach((btn) => {
        btn.addEventListener("click", () => {
          color = btn.dataset.color;
          if (tool === "eraser") tool = "brush";
          renderGameUI();
        });
      });

      const undoBtn = mmWrap.querySelector(".mm-undo");
      if (undoBtn) {
        undoBtn.addEventListener("click", () => {
          if (st.actions.length > 0) {
            st.actions.pop();
            replayAllActions();
            ctx.send("undo", {});
          }
        });
      }

      const clearBtn = mmWrap.querySelector(".mm-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          const act = { type: "clear" };
          st.actions.push(act);
          renderAction(act);
          ctx.send("draw", act);
        });
      }

      // Chat Formular
      const chatForm = mmWrap.querySelector(".mm-chat-form");
      const chatInput = mmWrap.querySelector(".mm-chat-in");
      if (chatForm && chatInput) {
        chatForm.addEventListener("submit", (e) => {
          e.preventDefault();
          const val = chatInput.value.trim();
          if (!val) return;
          chatInput.value = "";
          handleGuessSubmit(val);
        });
      }
    }

    function handleGuessSubmit(text) {
      if (st.phase !== "drawing" || st.currentDrawer === me() || st.guessedIds.includes(me())) return;

      if (ctx.isHost) {
        hostProcessGuess(me(), text);
      } else {
        ctx.send("guess", { text });
      }
    }

    // ==========================================
    // HOST SPIELLOGIK
    // ==========================================
    let roundTimer = null;

    function hostStartGame() {
      if (!ctx.isHost) return;
      st.phase = "pick";
      st.turnIdx = 0;
      st.roundNum = 1;
      st.scores = {};
      for (const p of ctx.players) st.scores[p.id] = 0;
      st.chat = [{ kind: "system", text: "🎮 Das Spiel beginnt! Viel Spaß!" }];

      broadcastFullState();
      hostStartTurn();
    }

    function hostStartTurn() {
      if (roundTimer) clearInterval(roundTimer);
      st.phase = "pick";
      st.actions = [];
      st.guessedIds = [];
      st.secretWord = "";
      resetCanvas();

      const activePlayer = ctx.players[st.turnIdx];
      st.currentDrawer = activePlayer.id;

      const customArr = config.customWordsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);

      st.wordChoices = getRandomWordOptions(
        config.lang,
        config.categories,
        customArr,
        3
      );

      st.chat.push({
        kind: "system",
        text: `✏️ ${activePlayer.name} ist an der Reihe und wählt einen Begriff...`,
      });

      broadcastFullState();

      // Timeout falls der Zeichner nicht wählt: nach 15s erstes Wort nehmen
      later(() => {
        if (st.phase === "pick" && !st.secretWord) {
          hostWordChosen(st.wordChoices[0]);
        }
      }, 15000);
    }

    function hostWordChosen(word) {
      if (!ctx.isHost || st.phase !== "pick") return;
      st.secretWord = word;
      st.phase = "drawing";
      st.timeLeft = config.duration;
      st.actions = [];
      resetCanvas();

      broadcastFullState();

      // Timer starten
      if (roundTimer) clearInterval(roundTimer);
      roundTimer = every(() => {
        st.timeLeft--;
        if (st.timeLeft <= 0) {
          clearInterval(roundTimer);
          hostEndRound("time");
        } else {
          ctx.send("timer_tick", { timeLeft: st.timeLeft });
        }
      }, 1000);
    }

    function hostProcessGuess(playerId, text) {
      if (st.phase !== "drawing" || playerId === st.currentDrawer || st.guessedIds.includes(playerId)) return;

      const player = ctx.players.find((p) => p.id === playerId);
      const pName = player ? player.name : "Spieler";

      const normG = normalizeWord(text);
      const normW = normalizeWord(st.secretWord);

      if (normG && normW && normG === normW) {
        // Richtig geraten!
        st.guessedIds.push(playerId);

        // Punkte für Rater: je schneller desto mehr (100 - 500 Pkt)
        const earned = Math.round(100 + 400 * (st.timeLeft / config.duration));
        st.scores[playerId] = (st.scores[playerId] || 0) + earned;

        // Punkte für Zeichner: 250 / (Anzahl anderer Spieler) pro Rater
        const otherCount = Math.max(1, ctx.players.length - 1);
        const drawerEarned = Math.round(250 / otherCount);
        st.scores[st.currentDrawer] = (st.scores[st.currentDrawer] || 0) + drawerEarned;

        st.chat.push({
          kind: "correct",
          id: playerId,
          name: pName,
        });

        // Bestätigung an alle
        ctx.send("guess_correct", {
          playerId,
          name: pName,
          scores: st.scores,
          secretWord: st.secretWord,
        });

        // Haben alle anderen Spieler erraten?
        const guessers = ctx.players.filter((p) => p.id !== st.currentDrawer);
        if (st.guessedIds.length >= guessers.length) {
          clearInterval(roundTimer);
          hostEndRound("all_guessed");
        }
      } else {
        // Falsch geraten -> in Chat schreiben
        st.chat.push({
          kind: "guess",
          id: playerId,
          name: pName,
          text,
        });
        ctx.send("chat_msg", {
          kind: "guess",
          id: playerId,
          name: pName,
          text,
        });

        // "Nah dran"-Prüfung
        if (isNearGuess(text, st.secretWord)) {
          ctx.send("near_guess", {}, playerId);
        }
      }
    }

    function hostEndRound(reason) {
      if (!ctx.isHost) return;
      if (roundTimer) clearInterval(roundTimer);
      st.phase = "round_end";

      st.chat.push({
        kind: "system",
        text: `🏁 Runde vorbei! Das gesuchte Wort war: "${st.secretWord}".`,
      });

      broadcastFullState();

      // Nächste Runde vorbereiten
      later(() => {
        hostAdvanceTurn();
      }, 5000);
    }

    function hostAdvanceTurn() {
      if (!ctx.isHost) return;

      // Prüfen, ob Spielziel erreicht
      let gameOver = false;
      if (config.targetType === "points") {
        for (const p of ctx.players) {
          if ((st.scores[p.id] || 0) >= config.targetVal) {
            gameOver = true;
            break;
          }
        }
      }

      st.turnIdx++;
      if (st.turnIdx >= ctx.players.length) {
        st.turnIdx = 0;
        st.roundNum++;
        if (config.targetType === "rounds" && st.roundNum > config.targetVal) {
          gameOver = true;
        }
      }

      if (gameOver) {
        st.phase = "game_over";
        broadcastFullState();
        if (window.confetti) {
          try {
            window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          } catch {}
        }
      } else {
        hostStartTurn();
      }
    }

    function broadcastFullState() {
      ctx.send("state_sync", {
        config,
        phase: st.phase,
        scores: st.scores,
        turnIdx: st.turnIdx,
        roundNum: st.roundNum,
        currentDrawer: st.currentDrawer,
        wordChoices: st.wordChoices,
        secretWord: st.secretWord,
        timeLeft: st.timeLeft,
        guessedIds: st.guessedIds,
        chat: st.chat,
        actions: st.actions,
      });
      render();
    }

    // ==========================================
    // MULTIPLAYER EVENTS & NACHRICHTEN
    // ==========================================
    ctx.onMessage("config_update", ({ data }) => {
      config = data;
      render();
    });

    ctx.onMessage("state_sync", ({ data }) => {
      config = data.config;
      st.phase = data.phase;
      st.scores = data.scores;
      st.turnIdx = data.turnIdx;
      st.roundNum = data.roundNum;
      st.currentDrawer = data.currentDrawer;
      st.wordChoices = data.wordChoices;
      st.secretWord = data.secretWord;
      st.timeLeft = data.timeLeft;
      st.guessedIds = data.guessedIds;
      st.chat = data.chat;
      st.actions = data.actions;
      replayAllActions();
      render();
    });

    ctx.onMessage("timer_tick", ({ data }) => {
      st.timeLeft = data.timeLeft;
      const tEl = mmWrap.querySelector(".mm-timer span");
      if (tEl) tEl.textContent = `${st.timeLeft}s`;
      const tBox = mmWrap.querySelector(".mm-timer");
      if (tBox) tBox.classList.toggle("urgent", st.timeLeft <= 10);
    });

    ctx.onMessage("word_chosen", ({ data, from }) => {
      if (ctx.isHost && from === st.currentDrawer) {
        hostWordChosen(data.word);
      }
    });

    ctx.onMessage("draw", ({ data }) => {
      st.actions.push(data);
      renderAction(data);
    });

    ctx.onMessage("draw_stream", ({ data }) => {
      const c = data.tool === "eraser" ? BG_COLOR : data.color;
      const r = Math.max(1, Math.round(data.size / 2));
      const pts = data.points;
      if (pts && pts.length >= 2) {
        for (let i = 1; i < pts.length; i++) {
          drawCrispCapsule(cctx, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r, c);
        }
      }
    });

    ctx.onMessage("undo", () => {
      if (st.actions.length > 0) {
        st.actions.pop();
        replayAllActions();
      }
    });

    ctx.onMessage("guess", ({ data, from }) => {
      if (ctx.isHost) {
        hostProcessGuess(from, data.text);
      }
    });

    ctx.onMessage("chat_msg", ({ data }) => {
      st.chat.push(data);
      renderGameUI();
    });

    ctx.onMessage("guess_correct", ({ data }) => {
      st.guessedIds.push(data.playerId);
      st.scores = data.scores;
      if (data.playerId === me()) {
        st.secretWord = data.secretWord;
      }
      st.chat.push({
        kind: "correct",
        name: data.name,
      });
      renderGameUI();
    });

    ctx.onMessage("near_guess", () => {
      st.chat.push({ kind: "near" });
      renderGameUI();
    });

    ctx.onEvent("join", (p) => {
      if (st.scores[p.id] == null) st.scores[p.id] = 0;
      if (ctx.isHost) {
        broadcastFullState();
      }
      render();
    });

    ctx.onEvent("leave", (p) => {
      if (ctx.isHost) {
        if (st.currentDrawer === p.id) {
          hostEndRound("drawer_left");
        }
        broadcastFullState();
      }
      render();
    });

    ctx.onEvent("host", () => {
      // Neuer Host übernimmt
      kit.refresh();
      render();
    });

    render();

    return {
      go() {
        render();
      },
      destroy() {
        for (const t of timers) {
          clearTimeout(t);
          clearInterval(t);
        }
        timers.clear();
      },
    };
  },
};
