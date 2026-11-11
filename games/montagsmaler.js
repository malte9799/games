// Montagsmaler — Zeichnen & Raten (Skribbl-Klassiker).
//
// Solo: Zeichenblock zum freien Üben mit Stift, Fülleimer, Radierer, Palette und Zufallswörtern.
// Mehrspieler: Über den Hub oder den „Mehrspieler“-Button einen Raum öffnen und live gegeneinander spielen!

let currentWord = "";
let currentCategory = "standard";
let tool = "brush";
let color = "#1a1a1a";
let brushSize = 7;
let canvasEl = null;
let cctx = null;
let actions = [];
let isDrawing = false;
let currentStroke = null;

const CANVAS_W = 600;
const CANVAS_H = 450;
const BG_COLOR = "#ffffff";

const PALETTE = [
  "#1a1a1a", "#555555", "#9e9e9e", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047",
  "#00acc1", "#1e88e5", "#8e24aa", "#d81b60",
  "#6d4c41", "#ffb74d", "#cddc39", "#00897b"
];
const SIZES = [3, 7, 14, 28];

const SAMPLE_WORDS = [
  "Sonne", "Haus", "Baum", "Auto", "Katze", "Hund", "Gitarre", "Pikachu",
  "Super Mario", "Pizza", "Rakete", "Schiff", "Elefant", "Krone", "Schneemann",
  "Roboter", "Pirat", "Lichtschwert", "Minecraft", "Regenbogen", "Eis"
];

function pickWord() {
  currentWord = SAMPLE_WORDS[Math.floor(Math.random() * SAMPLE_WORDS.length)];
  const wEl = document.getElementById("mm-solo-word");
  if (wEl) wEl.textContent = currentWord;
  setStatus(`Zeichne: „${currentWord}“`, null);
}

function resetSoloCanvas() {
  if (!cctx) return;
  cctx.fillStyle = BG_COLOR;
  cctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  actions = [];
}

function floodFill(startX, startY, fillColorHex) {
  if (!cctx) return;
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  const w = cctx.canvas.width;
  const h = cctx.canvas.height;
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

  const imgData = cctx.getImageData(0, 0, w, h);
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

  if (Math.abs(tr - fr) < 6 && Math.abs(tg - fg) < 6 && Math.abs(tb - fb) < 6 && Math.abs(ta - fa) < 6) return;

  // Höhere Toleranz gegen Anti-Aliasing-Abweichungen
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

  // Rand-Dilatation: schließt weiße Anti-Aliasing-Säume an Strichenden
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

  cctx.putImageData(imgData, 0, 0);
}

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
  if (!cctx || !act) return;
  if (act.type === "clear") {
    resetSoloCanvas();
  } else if (act.type === "fill") {
    floodFill(act.x, act.y, act.color);
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

function replayAll() {
  if (!cctx) return;
  cctx.fillStyle = BG_COLOR;
  cctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const a of actions) renderAction(a);
}

function saveDrawingPNG() {
  if (!canvasEl) return;
  const link = document.createElement("a");
  link.download = `montagsmaler-${currentWord || "zeichnung"}.png`;
  link.href = canvasEl.toDataURL("image/png");
  link.click();
  flashNote("Bild gespeichert!");
}

function infoAnim(p, w, h, frame) {
  p.background(...PAL.board);
  const cx = w / 2, cy = h / 2;
  p.fill(255); p.noStroke();
  p.rect(cx - 140, cy - 80, 280, 160, 10);

  // Animierte gezeichnete Sonne
  const t = (frame % 120) / 120;
  p.stroke(255, 179, 0); p.strokeWeight(4);
  const rays = Math.floor(t * 12);
  for (let i = 0; i < rays; i++) {
    const a = (i / 12) * p.TWO_PI;
    p.line(cx + Math.cos(a) * 35, cy + Math.sin(a) * 35, cx + Math.cos(a) * 48, cy + Math.sin(a) * 48);
  }
  p.noStroke(); p.fill(255, 214, 0);
  p.circle(cx, cy, 54);

  // Stift der im Kreis kreist
  const pa = t * p.TWO_PI;
  const px = cx + Math.cos(pa) * 48, py = cy + Math.sin(pa) * 48;
  p.push(); p.translate(px, py); p.rotate(pa + 0.8);
  p.fill(245, 124, 0); p.rect(0, -4, 30, 8, 2);
  p.fill(255, 204, 128); p.triangle(0, -4, 0, 4, -8, 0);
  p.pop();
}

initGame({
  title: "Montagsmaler",
  tag: "Zeichnen, Raten & Punkte jagen",
  presets: [
    { label: "Freies Zeichnen", values: ["standard"] },
  ],
  buttons: [
    { id: "btn-word", label: "Neues Wort", primary: true, onClick: () => pickWord() },
    { id: "btn-undo", label: "Rückgängig", onClick: () => { actions.pop(); replayAll(); } },
    { id: "btn-clear", label: "Löschen", onClick: () => resetSoloCanvas() },
    { id: "btn-save", label: "Bild speichern", onClick: () => saveDrawingPNG() },
  ],
  sliders: [],
  onPreset: ([cat]) => {
    currentCategory = cat;
    pickWord();
  },
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "Montagsmaler",
    text: [
      "In Montagsmaler wählst du einen Begriff und zeichnest ihn, während die anderen Spieler live im Chat raten.",
      "Werkzeuge: Stift, verschiedene Strichstärken, Farbpalette, Fülleimer (Flood Fill), Radierer und Rückgängig.",
      "Online-Mehrspieler: Nutze den „Mehrspieler“-Button oben rechts, um mit 2–8 Freunden in einem gemeinsamen Raum gegeneinander anzutreten!",
    ],
  },
});

// Setup DOM UI
function setupUI() {
  const wrap = document.getElementById("canvas-wrap");
  if (!wrap) return;
  wrap.innerHTML = "";

  const container = document.createElement("div");
  container.className = "mm-solo-container";
  container.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;max-width:640px;margin:0 auto;";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;width:100%;padding:8px 14px;border-radius:12px;background:var(--card-bg);border:var(--border-w) solid var(--hairline);box-sizing:border-box;";
  header.innerHTML = `
    <span style="font-size:13px;color:var(--muted);">Zeichen-Vorschlag:</span>
    <b id="mm-solo-word" style="font-size:18px;color:var(--accent);letter-spacing:.05em;text-transform:uppercase;">...</b>
  `;
  container.appendChild(header);

  // Canvas Holder & Brush Cursor
  const holder = document.createElement("div");
  holder.className = "mm-canvas-holder";
  holder.style.cssText = "position:relative;width:100%;aspect-ratio:4/3;background:#ffffff;border-radius:12px;border:2px solid var(--panel-edge);box-shadow:var(--wrap-shadow);touch-action:none;cursor:crosshair;overflow:hidden;";

  canvasEl = document.createElement("canvas");
  canvasEl.width = CANVAS_W;
  canvasEl.height = CANVAS_H;
  canvasEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair;";
  cctx = canvasEl.getContext("2d", { willReadFrequently: true });
  resetSoloCanvas();

  const cursorEl = document.createElement("div");
  cursorEl.className = "mm-brush-cursor";
  cursorEl.hidden = true;

  holder.appendChild(canvasEl);
  holder.appendChild(cursorEl);
  container.appendChild(holder);

  // Toolbar
  const tb = document.createElement("div");
  tb.className = "mm-toolbar";
  tb.style.cssText = "width:100%;box-sizing:border-box;";
  tb.innerHTML = `
    <div class="mm-tool-group">
      <button type="button" class="mm-tool-btn on" data-tool="brush" title="Stift">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      </button>
      <button type="button" class="mm-tool-btn" data-tool="fill" title="Fülleimer">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></svg>
      </button>
      <button type="button" class="mm-tool-btn" data-tool="eraser" title="Radiergummi">
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
  `;
  container.appendChild(tb);

  wrap.appendChild(container);

  const updatePreviewDot = () => {
    const dot = tb.querySelector(".mm-size-preview-dot");
    if (dot) {
      dot.style.width = brushSize + "px";
      dot.style.height = brushSize + "px";
    }
  };

  // Events Toolbar
  tb.querySelectorAll(".mm-tool-btn").forEach((b) => {
    b.addEventListener("click", () => {
      tb.querySelectorAll(".mm-tool-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      tool = b.dataset.tool;
    });
  });

  tb.querySelectorAll(".mm-size-btn").forEach((b) => {
    b.addEventListener("click", () => {
      tb.querySelectorAll(".mm-size-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      brushSize = parseInt(b.dataset.size, 10);
      updatePreviewDot();
    });
  });

  tb.querySelectorAll(".mm-color-swatch").forEach((b) => {
    b.addEventListener("click", () => {
      tb.querySelectorAll(".mm-color-swatch").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      color = b.dataset.color;
      if (tool === "eraser") {
        tool = "brush";
        tb.querySelector('[data-tool="brush"]')?.classList.add("on");
        tb.querySelector('[data-tool="eraser"]')?.classList.remove("on");
      }
    });
  });

  // Pointer Events Canvas & Brush Cursor
  const getCoords = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return [Math.round(x), Math.round(y)];
  };

  const updateCursor = (e) => {
    if (tool === "fill") {
      cursorEl.hidden = true;
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const scale = rect.width / CANVAS_W;
    const pxSize = Math.max(6, brushSize * scale);
    cursorEl.hidden = false;
    cursorEl.style.width = pxSize + "px";
    cursorEl.style.height = pxSize + "px";
    cursorEl.style.left = (e.clientX - rect.left) + "px";
    cursorEl.style.top = (e.clientY - rect.top) + "px";
  };

  canvasEl.addEventListener("pointerenter", updateCursor);
  canvasEl.addEventListener("pointerleave", () => {
    cursorEl.hidden = true;
  });

  canvasEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    const [x, y] = getCoords(e);
    updateCursor(e);
    if (tool === "fill") {
      const act = { type: "fill", color, x, y };
      actions.push(act);
      renderAction(act);
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

  canvasEl.addEventListener("pointermove", (e) => {
    updateCursor(e);
    if (!isDrawing || !currentStroke) return;
    e.preventDefault();
    const [x, y] = getCoords(e);
    currentStroke.points.push([x, y]);
    const r = Math.max(1, Math.round(brushSize / 2));
    const c = tool === "eraser" ? BG_COLOR : color;
    const pts = currentStroke.points;
    const len = pts.length;
    if (len >= 2) {
      drawCrispCapsule(cctx, pts[len - 2][0], pts[len - 2][1], pts[len - 1][0], pts[len - 1][1], r, c);
    }
  });

  const stopDrawing = () => {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    actions.push(currentStroke);
    currentStroke = null;
  };
  canvasEl.addEventListener("pointerup", stopDrawing);
  canvasEl.addEventListener("pointercancel", stopDrawing);

  pickWord();
}

function setup() {
  noCanvas();
  setupUI();
  if (window.Multiplayer) {
    const bar = document.querySelector(".row.tight") || document.querySelector(".row");
    if (bar) window.Multiplayer.mountButton(bar, { label: "Mehrspieler" });
  }
}
