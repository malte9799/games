// Battleship (Schiffe versenken) — 2D, polished, solo + hub-ready.
// Factory: window.createBattleship({ root?, net? }). Standalone auto-mounts.

window.createBattleship = (env = {}) => {
  const NET = env.net || null;
  const HUB = !!NET;

  let destroyed = false, raf = 0, rootStyleEl = null, onKey = null;
  const observers = [];

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some((s) => s.src === src)) return res();
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src));
      document.head.appendChild(s);
    });
  }
  function celebrate(tier) {
    const fire = () => window.confetti && window.confetti({ particleCount: 45 + (tier || 1) * 50, spread: 85, startVelocity: 42, origin: { y: 0.65 }, zIndex: 200, disableForReducedMotion: true, colors: ["#6cb6ff", "#74e2b2", "#ffd66e", "#ff6e8c"] });
    if (window.confetti) fire(); else loadScript("https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js").then(fire).catch(() => {});
  }

  // ===== rules / model =====
  const N = 10;
  const LETTERS = "ABCDEFGHIJ";
  const FLEET = [
    { id: "carrier", name: "Träger", len: 5 },
    { id: "battleship", name: "Schlachtschiff", len: 4 },
    { id: "cruiser", name: "Kreuzer", len: 3 },
    { id: "submarine", name: "U-Boot", len: 3 },
    { id: "destroyer", name: "Zerstörer", len: 2 },
  ];
  const mk = (v = 0) => Array.from({ length: N }, () => Array(N).fill(v));
  const inB = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
  function cellsOf(ship) { const a = []; for (let i = 0; i < ship.len; i++) a.push(ship.h ? [ship.x + i, ship.y] : [ship.x, ship.y + i]); return a; }
  function canPlace(board, x, y, len, h, ignore = 0) {
    for (let i = 0; i < len; i++) {
      const cx = h ? x + i : x, cy = h ? y : y + i;
      if (!inB(cx, cy)) return false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx, ny = cy + dy;
        if (inB(nx, ny) && board[nx][ny] && board[nx][ny] !== ignore) return false;
      }
    }
    return true;
  }
  function stamp(board, ship, val) { for (const [x, y] of cellsOf(ship)) if (inB(x, y)) board[x][y] = val; }
  function randomFleet() {
    const board = mk(0), ships = [];
    FLEET.forEach((f, i) => {
      let ok = false, s = null;
      for (let t = 0; t < 800 && !ok; t++) {
        const h = Math.random() < 0.5;
        const x = Math.floor(Math.random() * (h ? N - f.len + 1 : N));
        const y = Math.floor(Math.random() * (h ? N : N - f.len + 1));
        if (canPlace(board, x, y, f.len, h, 0)) { s = { ...f, x, y, h, hits: 0, sunk: false, uid: i + 1 }; ok = true; }
      }
      if (!s) { s = { ...f, x: 0, y: i, h: true, hits: 0, sunk: false, uid: i + 1 }; }
      stamp(board, s, s.uid); ships.push(s);
    });
    return { board, ships };
  }
  function freshPlayer(name) { const r = randomFleet(); return { name, board: r.board, ships: r.ships, shots: mk(0), shotCount: 0, hits: 0 }; }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  let G = null;
  function myIndex() {
    if (!HUB || !NET) return 0;
    const me = NET.me && NET.me.id;
    const idx = (NET.players || []).findIndex((p) => p.id === me);
    return idx >= 0 ? idx : 0;
  }
  function opp(i = myIndex()) { return i === 0 ? 1 : 0; }
  function isMyTurn() { return G && !G.winner && G.turn === myIndex(); }

  function newGame(keep = false) {
    const n1 = HUB ? ((NET.players || [])[0]?.name || "Spieler 1") : "Du";
    const n2 = HUB ? ((NET.players || [])[1]?.name || "Spieler 2") : "Computer";
    G = {
      phase: "placing", // placing -> playing -> over
      turn: 0, winner: null,
      players: [freshPlayer(n1), freshPlayer(n2)],
      placingIdx: 0, // index in FLEET for local placement
      placeH: true,
      log: ["Platziere deine Flotte. Klicke zum Setzen, R zum Drehen, Zufall für Auto."],
      fx: [], // transient visual effects
    };
    // solo: opponent fleet already random; player starts in placing
    // hub: for simplicity, both auto-place and host can start; mark placed if ships exist
    if (!HUB) {
      // keep player's board but let them place? start with random then allow replace by placing? easier: random placed, let them "Neu platzieren"/randomize or enter placing
      G.players[0] = { ...freshPlayer(n1), placed: false, board: mk(0), ships: [] };
      G.phase = "placing"; G.placingIdx = 0;
    } else {
      // auto-place both for now (simple network-safe start)
      G.players.forEach((p) => p.placed = true);
      G.phase = "playing";
      G.log = ["Spiel startet. Feuer frei!"];
      if (NET?.isHost && !keep) broadcast();
    }
    syncUI();
  }

  function allPlaced(p) { return p.ships.length === FLEET.length && FLEET.every((f) => p.ships.some((s) => s.id === f.id)); }

  function placeCurrent(x, y) {
    if (!G || G.phase !== "placing") return;
    const me = myIndex(); if (HUB && me !== 0 && me !== 1) {}
    const p = G.players[!HUB ? 0 : me];
    const f = FLEET[G.placingIdx]; if (!f) return;
    // remove existing same id
    const old = p.ships.find((s) => s.id === f.id);
    if (old) { stamp(p.board, old, 0); p.ships = p.ships.filter((s) => s !== old); }
    if (!canPlace(p.board, x, y, f.len, G.placeH, 0)) { pushLog("Hier passt das Schiff nicht."); syncUI(); return; }
    const ship = { ...f, x, y, h: G.placeH, hits: 0, sunk: false, uid: p.ships.length + 1 + FLEET.indexOf(f) };
    stamp(p.board, ship, ship.uid); p.ships.push(ship);
    // advance to next unplaced
    let next = -1;
    for (let i = 0; i < FLEET.length; i++) if (!p.ships.some((s) => s.id === FLEET[i].id)) { next = i; break; }
    G.placingIdx = next === -1 ? FLEET.length : next;
    if (allPlaced(p)) {
      p.placed = true;
      if (!HUB) {
        G.phase = "playing"; G.turn = 0; pushLog("Flotte bereit. Du beginnst — wähle ein Ziel rechts.");
      } else {
        pushLog("Flotte bereit. Warte auf Start/Sync.");
        if (NET?.isHost) { G.phase = "playing"; broadcast(); }
        else broadcastReq();
      }
    } else {
      pushLog(`${ship.name} platziert. Als Nächstes: ${FLEET[G.placingIdx].name} (${FLEET[G.placingIdx].len}).`);
    }
    syncUI();
  }

  function randomizePlacement() {
    if (!G || G.phase !== "placing") return;
    const me = !HUB ? 0 : myIndex();
    const r = randomFleet();
    G.players[me].board = r.board; G.players[me].ships = r.ships; G.players[me].placed = true;
    G.placingIdx = FLEET.length;
    if (!HUB) { G.phase = "playing"; G.turn = 0; pushLog("Zufällige Flotte gesetzt. Du beginnst!"); }
    else { pushLog("Zufällige Flotte gesetzt."); if (NET?.isHost) { G.phase = "playing"; broadcast(); } else broadcastReq(); }
    syncUI();
  }

  function pushLog(msg) { G.log.unshift(msg); if (G.log.length > 10) G.log.pop(); }

  function receiveShot(x, y, shooterIdx, authoritative) {
    if (!G || G.winner || G.phase !== "playing") return false;
    if (G.turn !== shooterIdx) return false;
    const targetIdx = opp(shooterIdx);
    const shooter = G.players[shooterIdx], target = G.players[targetIdx];
    if (shooter.shots[x][y]) return false;
    if (HUB && !authoritative) {
      if (NET?.isHost) { /* host will process below */ } else { NET?.send("bs", { t: "shot", x, y, by: shooterIdx }); return true; }
    }
    const uid = target.board[x][y];
    const hit = !!uid;
    shooter.shots[x][y] = hit ? 2 : 1;
    shooter.shotCount++;
    let sunk = null;
    if (hit) {
      shooter.hits++;
      const ship = target.ships.find((s) => s.uid === uid);
      if (ship) { ship.hits++; if (ship.hits >= ship.len) { ship.sunk = true; sunk = ship; } }
      addFx(x, y, "hit", targetIdx);
    } else addFx(x, y, "miss", targetIdx);
    const coord = LETTERS[x] + (y + 1);
    pushLog(`${shooter.name}: ${coord} — ${hit ? (sunk ? `Versenkt: ${sunk.name}!` : "Treffer!") : "Wasser."}`);
    if (target.ships.every((s) => s.sunk)) {
      G.winner = shooterIdx; G.phase = "over"; pushLog(`${shooter.name} gewinnt!`);
      if (shooterIdx === myIndex()) celebrate(2);
    } else {
      G.turn = targetIdx;
      if (!HUB && G.turn === 1) setTimeout(aiTurn, 650);
    }
    syncUI();
    if (HUB && NET?.isHost) broadcast();
    return true;
  }

  function aiTurn() {
    if (destroyed || !G || G.winner || G.turn !== 1) return;
    const shots = G.players[1].shots, board = G.players[0].board;
    const cands = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (shots[x][y]) continue;
      let sc = (x + y) % 2 === 0 ? 1 : 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x+dx, ny = y+dy;
        if (inB(nx,ny) && shots[nx][ny]===2) sc += 8;
      }
      sc += Math.random() * 0.6;
      cands.push({x,y,sc});
    }
    cands.sort((a,b)=>b.sc-a.sc);
    if (cands[0]) receiveShot(cands[0].x, cands[0].y, 1, true);
  }

  function addFx(x, y, kind, boardOwnerIdx) { G.fx.push({ x, y, kind, owner: boardOwnerIdx, t: performance.now() }); }

  // ===== net =====
  function broadcast() { try { NET?.send("bs", { t: "state", state: clone(G) }); } catch {} }
  function broadcastReq() { try { NET?.send("bs", { t: "req" }); } catch {} }
  function onNet(msg) {
    if (!msg || destroyed || !G) return;
    if (msg.t === "state" && msg.state) { G = msg.state; syncUI(); }
    else if (msg.t === "shot" && typeof msg.x === "number" && NET?.isHost) receiveShot(msg.x, msg.y, typeof msg.by === "number" ? msg.by : G.turn, true);
    else if (msg.t === "req" && NET?.isHost) broadcast();
    else if (msg.t === "reset" && NET?.isHost) { newGame(); }
  }

  // ===== DOM/UI =====
  let root, wrap, ownCv, tgtCv, ownCtx, tgtCtx, statusEl, logEl, fleetEl, actionEl, overlayEl;
  const CSS = `
#bs2{position:fixed;inset:0;background:linear-gradient(180deg,#0f2433,#0b1822 60%,#13222c);color:#eaf4ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;overflow:auto}
.bs2-wrap{max-width:1180px;margin:0 auto;padding:14px 14px 24px}
.bs2-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
.bs2-title{font-size:20px;font-weight:800;letter-spacing:.02em}
.bs2-sub{opacity:.8;font-size:13px}
.bs2-pill{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);padding:8px 12px;border-radius:999px;font-size:13px}
.bs2-boards{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
@media (max-width:900px){.bs2-boards{grid-template-columns:1fr}}
.bs2-panel{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.22)}
.bs2-panel h3{margin:0 0 8px;font-size:14px;display:flex;justify-content:space-between;gap:8px;color:#d8ecff}
.bs2-panel h3 span{opacity:.7;font-weight:500}
.bs2-cv{width:100%;max-width:520px;aspect-ratio:1/1;display:block;border-radius:12px;background:#123247;touch-action:manipulation}
.bs2-side{display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px}
.bs2-actions{display:flex;flex-wrap:wrap;gap:8px}
.bs2-btn{appearance:none;border:1px solid rgba(255,255,255,.16);background:#1d455d;color:#eaf4ff;padding:9px 12px;border-radius:10px;font:600 13px inherit;cursor:pointer}
.bs2-btn:hover{background:#255875}.bs2-btn.primary{background:#2b78a8;border-color:#4fa4d8}
.bs2-log,.bs2-fleet{font-size:13px;line-height:1.4;color:#d8ebf8}
.bs2-fleet .sunk{text-decoration:line-through;opacity:.55}
.bs2-log div{margin:2px 0;opacity:.95}
.bs2-over{margin-top:10px;padding:12px;border-radius:12px;background:rgba(116,226,178,.12);border:1px solid rgba(116,226,178,.28);font-weight:700}
`;
  function mount() {
    rootStyleEl = document.createElement("style"); rootStyleEl.textContent = CSS; document.head.appendChild(rootStyleEl);
    root = document.createElement("div"); root.id = "bs2";
    root.innerHTML = `
      <div class="bs2-wrap">
        <div class="bs2-top">
          <div><div class="bs2-title">Battleship</div><div class="bs2-sub" id="bs2-sub">Schiffe versenken</div></div>
          <div class="bs2-pill" id="bs2-status"></div>
        </div>
        <div class="bs2-boards">
          <div class="bs2-panel"><h3>Deine Flotte <span id="bs2-own-label"></span></h3><canvas class="bs2-cv" id="bs2-own" width="520" height="520"></canvas></div>
          <div class="bs2-panel"><h3>Gegnerisches Meer <span id="bs2-tgt-label"></span></h3><canvas class="bs2-cv" id="bs2-tgt" width="520" height="520"></canvas></div>
        </div>
        <div class="bs2-side">
          <div class="bs2-panel"><div class="bs2-actions" id="bs2-actions"></div><div id="bs2-over"></div></div>
          <div class="bs2-boards">
            <div class="bs2-panel"><h3>Flottenstatus</h3><div class="bs2-fleet" id="bs2-fleet"></div></div>
            <div class="bs2-panel"><h3>Verlauf</h3><div class="bs2-log" id="bs2-log"></div></div>
          </div>
        </div>
      </div>`;
    (env.root || document.getElementById("canvas-wrap") || document.body).appendChild(root);
    ownCv = root.querySelector("#bs2-own"); tgtCv = root.querySelector("#bs2-tgt");
    ownCtx = ownCv.getContext("2d"); tgtCtx = tgtCv.getContext("2d");
    statusEl = root.querySelector("#bs2-status"); logEl = root.querySelector("#bs2-log");
    fleetEl = root.querySelector("#bs2-fleet"); actionEl = root.querySelector("#bs2-actions");
    overlayEl = root.querySelector("#bs2-over");
    tgtCv.addEventListener("click", (e) => onBoardClick(e, "target"));
    ownCv.addEventListener("click", (e) => onBoardClick(e, "own"));
    tgtCv.addEventListener("mousemove", (e) => onHover(e, "target"));
    ownCv.addEventListener("mousemove", (e) => onHover(e, "own"));
    tgtCv.addEventListener("mouseleave", () => { hover = null; });
    ownCv.addEventListener("mouseleave", () => { hover = null; });
    onKey = (e) => {
      if (destroyed || !G) return;
      if (e.key === "r" || e.key === "R") { if (G.phase === "placing") { G.placeH = !G.placeH; pushLog(G.placeH ? "Ausrichtung: waagerecht" : "Ausrichtung: senkrecht"); syncUI(); } }
      if (e.key === "n" || e.key === "N") doReset();
    };
    window.addEventListener("keydown", onKey);
  }

  let hover = null;
  function cellFromEvent(cv, e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N);
    const y = Math.floor(((e.clientY - r.top) / r.height) * N);
    return inB(x, y) ? { x, y } : null;
  }
  function onHover(e, which) { hover = { which, ...cellFromEvent(which==="own"?ownCv:tgtCv, e) }; }
  function onBoardClick(e, which) {
    if (!G) return;
    const c = cellFromEvent(which === "own" ? ownCv : tgtCv, e); if (!c) return;
    if (G.phase === "placing" && which === "own" && !HUB) placeCurrent(c.x, c.y);
    else if (G.phase === "playing" && which === "target") {
      if (!isMyTurn()) { pushLog(HUB ? "Warte auf deinen Zug." : "Der Computer ist dran."); syncUI(); return; }
      receiveShot(c.x, c.y, myIndex(), !HUB ? true : !!NET?.isHost);
    }
  }

  function doReset() {
    if (HUB) { if (NET?.isHost) newGame(); else NET?.send("bs", { t: "reset" }); }
    else newGame();
  }

  function renderActions() {
    if (!actionEl || !G) return;
    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "bs2-btn"+(cls?" "+cls:""); b.textContent = label; b.onclick = fn; return b; };
    actionEl.innerHTML = "";
    if (!HUB && G.phase === "placing") {
      actionEl.append(btn(G.placeH ? "Drehen (R): waagerecht" : "Drehen (R): senkrecht", "", () => { G.placeH=!G.placeH; syncUI(); }));
      actionEl.append(btn("Zufällig platzieren", "primary", randomizePlacement));
      actionEl.append(btn("Neu anfangen", "", doReset));
    } else {
      actionEl.append(btn("Neues Spiel", "primary", doReset));
    }
  }

  function syncUI() {
    if (!G || !root) return;
    const me = myIndex(), opi = opp(me);
    root.querySelector("#bs2-own-label").textContent = G.players[me]?.name ? `(${G.players[me].name})` : "";
    root.querySelector("#bs2-tgt-label").textContent = G.players[opi]?.name ? `(${G.players[opi].name})` : "";
    if (G.phase === "placing") statusEl.textContent = `Platzieren: ${FLEET[G.placingIdx]?.name || "fertig"} (${FLEET[G.placingIdx]?.len || ""}) · ${G.placeH ? "waagerecht" : "senkrecht"}`;
    else if (G.winner != null) statusEl.textContent = `${G.players[G.winner].name} gewinnt!`;
    else statusEl.textContent = isMyTurn() ? "Dein Zug — schieße auf das rechte Feld." : `Zug: ${G.players[G.turn]?.name || "?"}`;
    overlayEl.innerHTML = G.winner != null ? `<div class="bs2-over">${G.players[G.winner].name} hat die gegnerische Flotte versenkt.</div>` : "";
    // fleet status (opponent sunk count visible; own ships)
    const own = G.players[me], enemy = G.players[opi];
    fleetEl.innerHTML = `<div><b>Gegner versenkt:</b> ${enemy.ships.filter(s=>s.sunk).length}/${enemy.ships.length}</div>` +
      `<div style="margin-top:6px"><b>Deine Schiffe:</b></div>` +
      own.ships.map(s => `<div class="${s.sunk?'sunk':''}">${s.name} (${s.len})${s.sunk?' — versenkt':''}</div>`).join("");
    logEl.innerHTML = G.log.map(l => `<div>${esc(l)}</div>`).join("");
    renderActions();
  }
  function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // ===== canvas rendering =====
  function draw() {
    if (destroyed || !G || !ownCtx) return;
    const me = myIndex(), opi = opp(me);
    drawBoard(ownCtx, ownCv, G.players[me], G.players[opi], "own", me, opi);
    drawBoard(tgtCtx, tgtCv, G.players[opi], G.players[me], "target", opi, me);
    raf = requestAnimationFrame(draw);
  }

  function drawBoard(ctx, cv, owner, viewer, mode, ownerIdx, viewerIdx) {
    const w = cv.width, h = cv.height;
    const pad = 28, grid = Math.min(w,h) - pad*1.2, cs = grid / N, ox = pad + 6, oy = pad + 6;
    ctx.clearRect(0,0,w,h);
    // bg
    const bg = ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,"#15455f"); bg.addColorStop(1,"#0d2f43");
    roundRect(ctx, 0,0,w,h,12); ctx.fillStyle = bg; ctx.fill();
    // labels
    ctx.fillStyle = "rgba(220,242,255,.75)"; ctx.font = "600 12px system-ui,sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    for(let i=0;i<N;i++){ ctx.fillText(LETTERS[i], ox + i*cs + cs/2, oy - 10); ctx.fillText(String(i+1), ox - 12, oy + i*cs + cs/2); }
    // grid
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const px = ox + x*cs, py = oy + y*cs;
      ctx.fillStyle = (x+y)%2===0 ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.02)";
      ctx.fillRect(px,py,cs,cs);
      ctx.strokeStyle = "rgba(170,225,255,.16)"; ctx.strokeRect(px+0.5,py+0.5,cs-1,cs-1);
    }
    // ships on own board (and sunk on target)
    const showShips = (mode === "own");
    if (showShips) {
      for (const s of owner.ships) {
        for (const [x,y] of cellsOf(s)) {
          const px = ox + x*cs, py = oy + y*cs;
          ctx.fillStyle = s.sunk ? "rgba(120,90,90,.75)" : "rgba(120,170,200,.55)";
          roundRect(ctx, px+3, py+3, cs-6, cs-6, 5); ctx.fill();
          ctx.strokeStyle = s.sunk ? "rgba(255,140,140,.35)" : "rgba(210,240,255,.25)"; ctx.stroke();
        }
      }
    } else {
      for (const s of owner.ships) if (s.sunk) for (const [x,y] of cellsOf(s)) {
        const px = ox + x*cs, py = oy + y*cs;
        ctx.fillStyle = "rgba(140,95,95,.45)"; roundRect(ctx, px+3, py+3, cs-6, cs-6, 5); ctx.fill();
      }
    }
    // shots: on own board show enemy shots at owner (viewer.shots? no: enemy is viewer's opponent -> owner's received). Need shots fired at owner.
    // shots fired at `owner` are stored in `viewerIdx == opp(ownerIdx)`? We pass (owner, viewer) as (board owner, the one who shot at it?) easier: compute.
    // owner receives shots from opponent(ownerIdx). So marks on owner's board = G.players[opp(ownerIdx)].shots? Wait: shooter stores shots in shooter.shots. Yes.
    const shooterAtOwner = G.players[opp(ownerIdx)];
    const marks = shooterAtOwner ? shooterAtOwner.shots : mk(0);
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const v = marks[x][y]; if (!v) continue;
      const cx = ox + x*cs + cs/2, cy = oy + y*cs + cs/2;
      if (v===2) { // hit
        ctx.strokeStyle = "#ff7a5c"; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(cx-cs*0.22, cy-cs*0.22); ctx.lineTo(cx+cs*0.22, cy+cs*0.22);
        ctx.moveTo(cx+cs*0.22, cy-cs*0.22); ctx.lineTo(cx-cs*0.22, cy+cs*0.22); ctx.stroke();
        ctx.fillStyle = "rgba(255,90,60,.18)"; ctx.beginPath(); ctx.arc(cx,cy,cs*0.28,0,Math.PI*2); ctx.fill();
      } else { // miss
        ctx.fillStyle = "rgba(235,248,255,.85)"; ctx.beginPath(); ctx.arc(cx,cy,Math.max(2.5,cs*0.09),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = "rgba(235,248,255,.25)"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,cs*0.22,0,Math.PI*2); ctx.stroke();
      }
    }
    // placement/hover preview
    if (hover && hover.which === mode && hover.x != null) {
      if (mode === "own" && G.phase === "placing" && !HUB) {
        const f = FLEET[G.placingIdx];
        if (f) {
          const ok = canPlace(G.players[myIndex()].board, hover.x, hover.y, f.len, G.placeH, 0);
          ctx.fillStyle = ok ? "rgba(116,226,178,.28)" : "rgba(255,110,140,.22)";
          for(let i=0;i<f.len;i++){ const x=G.placeH?hover.x+i:hover.x, y=G.placeH?hover.y:hover.y+i; if(inB(x,y)){ roundRect(ctx, ox+x*cs+3, oy+y*cs+3, cs-6, cs-6, 5); ctx.fill(); } }
        }
      } else if (mode === "target" && G.phase === "playing" && isMyTurn()) {
        const me = myIndex(); if (!G.players[me].shots[hover.x][hover.y]) {
          ctx.fillStyle = "rgba(255,224,138,.22)"; roundRect(ctx, ox+hover.x*cs+2, oy+hover.y*cs+2, cs-4, cs-4, 6); ctx.fill();
        }
      }
    }
    // recent fx pulse
    const now = performance.now();
    G.fx = G.fx.filter(f => now - f.t < 900);
    for (const f of G.fx) {
      if (f.owner !== ownerIdx) continue;
      const age = (now - f.t)/900, cx = ox + f.x*cs + cs/2, cy = oy + f.y*cs + cs/2;
      ctx.strokeStyle = f.kind==="hit" ? `rgba(255,120,80,${1-age})` : `rgba(180,230,255,${1-age})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx,cy, cs*0.2 + age*cs*0.55, 0, Math.PI*2); ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  function start() {
    mount(); newGame(true); syncUI(); raf = requestAnimationFrame(draw);
    if (HUB && NET) {
      NET.onMessage("bs", ({ data }) => onNet(data));
      NET.onEvent("join", () => { if (NET?.isHost) broadcast(); });
      NET.onEvent("leave", syncUI);
    }
  }
  function destroy() {
    destroyed = true; cancelAnimationFrame(raf);
    if (onKey) window.removeEventListener("keydown", onKey);
    try{rootStyleEl?.remove()}catch{} try{root?.remove()}catch{}
  }

  start();
  return { destroy, reset: doReset, getState: () => clone(G) };
};

if (!window.__BATTLESHIP_HUB__) window.createBattleship();
