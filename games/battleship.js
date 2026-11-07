// Battleship (Schiffe versenken) — 2D, solo + hub-ready.
// Placement via drag & drop; clean play view. Factory: window.createBattleship({ root?, net? })

window.createBattleship = (env = {}) => {
  const NET = env.net || null;
  const HUB = !!NET;

  let destroyed = false, raf = 0, rootStyleEl = null, onKey = null;

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
  function cellsOf(s) { const a = []; for (let i = 0; i < s.len; i++) a.push(s.h ? [s.x + i, s.y] : [s.x, s.y + i]); return a; }
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
      let s = null;
      for (let t = 0; t < 900 && !s; t++) {
        const h = Math.random() < 0.5;
        const x = Math.floor(Math.random() * (h ? N - f.len + 1 : N));
        const y = Math.floor(Math.random() * (h ? N : N - f.len + 1));
        if (canPlace(board, x, y, f.len, h, 0)) s = { ...f, x, y, h, hits: 0, sunk: false, uid: i + 1 };
      }
      if (!s) s = { ...f, x: 0, y: Math.min(i, N - 1), h: true, hits: 0, sunk: false, uid: i + 1 };
      stamp(board, s, s.uid); ships.push(s);
    });
    return { board, ships };
  }
  function freshPlayer(name) { const r = randomFleet(); return { name, board: r.board, ships: r.ships, shots: mk(0), placed: true }; }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let G = null;
  function myIndex() {
    if (!HUB || !NET) return 0;
    const me = NET.me && NET.me.id;
    const idx = (NET.players || []).findIndex((p) => p.id === me);
    return idx >= 0 ? idx : 0;
  }
  function opp(i = myIndex()) { return i === 0 ? 1 : 0; }
  function isMyTurn() { return G && G.phase === "playing" && !G.winner && G.turn === myIndex(); }

  function newGame(keepNet = false) {
    const n1 = HUB ? ((NET.players || [])[0]?.name || "Spieler 1") : "Du";
    const n2 = HUB ? ((NET.players || [])[1]?.name || "Spieler 2") : "Computer";
    G = {
      phase: HUB ? "playing" : "placing",
      turn: 0, winner: null,
      players: HUB ? [freshPlayer(n1), freshPlayer(n2)] : [
        { name: n1, board: mk(0), ships: [], shots: mk(0), placed: false },
        freshPlayer(n2),
      ],
      orientH: true,
      drag: null, // { shipId, len, name, h, fromBoard }
      hover: null,
      fx: [],
      msg: HUB ? "Spiel startet." : "Ziehe deine Schiffe aufs Feld. R = drehen.",
    };
    if (HUB && NET?.isHost && !keepNet) broadcast();
    render();
  }

  function broadcast() { try { NET?.send("bs", { t: "state", state: clone(G) }); } catch {} }
  function onNet(msg) {
    if (!msg || destroyed || !G) return;
    if (msg.t === "state" && msg.state) { G = msg.state; render(); }
    else if (msg.t === "shot" && NET?.isHost && typeof msg.x === "number") {
      receiveShot(msg.x, msg.y, typeof msg.by === "number" ? msg.by : G.turn, true);
    } else if (msg.t === "reset" && NET?.isHost) newGame();
  }

  function allPlaced(p) { return FLEET.every((f) => p.ships.some((s) => s.id === f.id)); }

  function liftShip(p, shipId) {
    const s = p.ships.find((x) => x.id === shipId);
    if (!s) return null;
    stamp(p.board, s, 0);
    p.ships = p.ships.filter((x) => x !== s);
    p.placed = false;
    return s;
  }

  function dropShip(x, y) {
    if (!G || G.phase !== "placing" || !G.drag) return;
    const me = myIndex();
    const p = G.players[me];
    const { shipId, len, name, h } = G.drag;
    if (canPlace(p.board, x, y, len, h, 0)) {
      const uid = (p.ships.reduce((m, s) => Math.max(m, s.uid), 0) || 0) + 1;
      const ship = { id: shipId, name, len, x, y, h, hits: 0, sunk: false, uid };
      stamp(p.board, ship, ship.uid);
      p.ships.push(ship);
      G.msg = `${name} platziert.`;
      if (allPlaced(p)) { p.placed = true; G.msg = "Alle Schiffe platziert. Bereit zum Start!"; }
    } else {
      G.msg = "Da passt das Schiff nicht (Abstand/ Rand).";
      // if it came from board and failed, it was already lifted — return to dock state by not re-adding (user can drag again)
    }
    G.drag = null;
    render();
  }

  function startPlaying() {
    if (!G || G.phase !== "placing") return;
    const me = myIndex(); const p = G.players[me];
    if (!allPlaced(p)) { G.msg = "Platziere erst alle Schiffe."; render(); return; }
    G.phase = "playing"; G.turn = 0; G.msg = "Feuer frei!";
    render();
  }

  function addFx(x, y, kind, owner) { G.fx.push({ x, y, kind, owner, t: performance.now() }); }

  function receiveShot(x, y, shooterIdx, authoritative) {
    if (!G || G.winner || G.phase !== "playing") return false;
    if (G.turn !== shooterIdx) return false;
    if (HUB && !authoritative) {
      if (NET?.isHost) { /* fallthrough */ } else { NET?.send("bs", { t: "shot", x, y, by: shooterIdx }); return true; }
    }
    const targetIdx = opp(shooterIdx);
    const shooter = G.players[shooterIdx], target = G.players[targetIdx];
    if (shooter.shots[x][y]) return false;
    const uid = target.board[x][y];
    const hit = !!uid;
    shooter.shots[x][y] = hit ? 2 : 1;
    if (hit) {
      const ship = target.ships.find((s) => s.uid === uid);
      if (ship) { ship.hits++; if (ship.hits >= ship.len) ship.sunk = true; }
      addFx(x, y, "hit", targetIdx);
    } else addFx(x, y, "miss", targetIdx);
    G.msg = `${LETTERS[x]}${y + 1}: ${hit ? "Treffer!" : "Wasser."}`;
    if (target.ships.every((s) => s.sunk)) {
      G.winner = shooterIdx; G.phase = "over"; G.msg = `${shooter.name} gewinnt!`;
      if (shooterIdx === myIndex()) celebrate(2);
    } else {
      G.turn = targetIdx;
      if (!HUB && G.turn === 1) setTimeout(aiTurn, 650);
    }
    render();
    if (HUB && NET?.isHost) broadcast();
    return true;
  }

  function aiTurn() {
    if (destroyed || !G || G.winner || G.turn !== 1) return;
    const shots = G.players[1].shots;
    const cands = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (shots[x][y]) continue;
      let sc = (x + y) % 2 === 0 ? 1 : 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx, ny=y+dy; if (inB(nx,ny) && shots[nx][ny]===2) sc += 8;
      }
      sc += Math.random()*0.6; cands.push({x,y,sc});
    }
    cands.sort((a,b)=>b.sc-a.sc);
    if (cands[0]) receiveShot(cands[0].x, cands[0].y, 1, true);
  }

  // ===== UI =====
  let root, ownCv, tgtCv, ownCtx, tgtCtx, statusEl, msgEl, dockEl, actionsEl;
  const CSS = `
#bs2{box-sizing:border-box;width:100%;min-height:100%;background:linear-gradient(180deg,#102735,#0b1822 65%,#12212b);color:#eaf4ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:14px}
#bs2 *,#bs2 *::before,#bs2 *::after{box-sizing:border-box}
.bs2-wrap{max-width:1100px;margin:0 auto}
.bs2-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.bs2-title{font-size:22px;font-weight:800}
.bs2-status{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);padding:8px 12px;border-radius:999px;font-size:13px}
.bs2-msg{margin:0 0 12px;opacity:.92;font-size:14px}
.bs2-place{display:grid;grid-template-columns:minmax(260px,520px) 1fr;gap:14px;align-items:start}
@media(max-width:860px){.bs2-place{grid-template-columns:1fr}}
.bs2-play{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:860px){.bs2-play{grid-template-columns:1fr}}
.bs2-panel{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px}
.bs2-panel h3{margin:0 0 8px;font-size:14px;color:#d8ecff}
.bs2-cv{width:100%;max-width:520px;aspect-ratio:1/1;display:block;border-radius:12px;background:#123247;touch-action:none}
.bs2-dock{display:flex;flex-wrap:wrap;gap:8px;min-height:54px;padding:8px;background:rgba(0,0,0,.15);border-radius:12px;margin-bottom:10px}
.bs2-ship{user-select:none;touch-action:none;cursor:grab;display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:#1e5576;border:1px solid rgba(255,255,255,.18);color:#f4fbff;font:600 13px inherit;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.bs2-ship:active{cursor:grabbing}
.bs2-ship .cells{display:inline-flex;gap:2px}
.bs2-ship .c{width:12px;height:12px;border-radius:3px;background:#8fd0f5;border:1px solid rgba(255,255,255,.25)}
.bs2-actions{display:flex;flex-wrap:wrap;gap:8px}
.bs2-btn{appearance:none;cursor:pointer;padding:10px 14px;border-radius:10px;border:1px solid #1a4f70;background:#1b567a;color:#ffffff;font:700 13px/1.2 inherit;box-shadow:0 2px 0 rgba(0,0,0,.15)}
.bs2-btn:hover{background:#236890}
.bs2-btn:focus{outline:2px solid #8fd0f5;outline-offset:2px}
.bs2-btn.primary{background:#2280b3;border-color:#2a94cc;color:#ffffff}
.bs2-btn.primary:hover{background:#2892cb}
.bs2-hint{font-size:12px;opacity:.72;margin-top:8px}
.bs2-over{margin-top:10px;padding:12px;border-radius:12px;background:rgba(116,226,178,.14);border:1px solid rgba(116,226,178,.3);font-weight:700;color:#dff7ec}
`;

  function mount() {
    rootStyleEl = document.createElement("style"); rootStyleEl.textContent = CSS; document.head.appendChild(rootStyleEl);
    root = document.createElement("div"); root.id = "bs2";
    root.innerHTML = `
      <div class="bs2-wrap">
        <div class="bs2-head"><div class="bs2-title">Battleship</div><div class="bs2-status" id="bs2-status"></div></div>
        <p class="bs2-msg" id="bs2-msg"></p>
        <div id="bs2-main"></div>
      </div>`;
    (env.root || document.getElementById("canvas-wrap") || document.body).appendChild(root);
    statusEl = root.querySelector("#bs2-status");
    msgEl = root.querySelector("#bs2-msg");
    onKey = (e) => {
      if (destroyed || !G) return;
      if ((e.key === "r" || e.key === "R") && G.phase === "placing") {
        G.orientH = !G.orientH;
        if (G.drag) G.drag.h = G.orientH;
        G.msg = G.orientH ? "Ausrichtung: waagerecht" : "Ausrichtung: senkrecht";
        render();
      }
    };
    window.addEventListener("keydown", onKey);
  }

  function render() {
    if (!root || !G) return;
    statusEl.textContent = G.phase === "placing" ? "Schiffe platzieren" : G.phase === "over" ? "Spiel beendet" : (isMyTurn() ? "Dein Zug" : `Zug: ${G.players[G.turn]?.name || "?"}`);
    msgEl.textContent = G.msg || "";
    const main = root.querySelector("#bs2-main");
    if (G.phase === "placing") renderPlacing(main); else renderPlay(main);
  }

  function renderPlacing(main) {
    const me = myIndex(), p = G.players[me];
    const placedIds = new Set(p.ships.map(s => s.id));
    main.innerHTML = `
      <div class="bs2-place">
        <div class="bs2-panel"><h3>Dein Feld</h3><canvas class="bs2-cv" id="bs2-own" width="520" height="520"></canvas></div>
        <div class="bs2-panel">
          <h3>Schiffe (ziehen & ablegen)</h3>
          <div class="bs2-dock" id="bs2-dock"></div>
          <div class="bs2-actions" id="bs2-actions"></div>
          <div class="bs2-hint">Schiff aus dem Dock oder vom Feld ziehen, auf dem Raster ablegen. <b>R</b> dreht. Zum Verschieben ein platziertes Schiff einfach wieder greifen.</div>
        </div>
      </div>`;
    ownCv = main.querySelector("#bs2-own"); ownCtx = ownCv.getContext("2d");
    dockEl = main.querySelector("#bs2-dock"); actionsEl = main.querySelector("#bs2-actions");

    // dock ships
    dockEl.innerHTML = "";
    FLEET.forEach(f => {
      if (placedIds.has(f.id)) return;
      const el = document.createElement("div"); el.className = "bs2-ship"; el.setAttribute("role","button"); el.tabIndex = 0;
      el.innerHTML = `<span>${f.name}</span><span class="cells">${Array.from({length:f.len}).map(()=>'<span class="c"></span>').join("")}</span>`;
      const start = (ev) => { ev.preventDefault(); G.drag = { shipId: f.id, len: f.len, name: f.name, h: G.orientH, fromBoard: false }; G.msg = `${f.name} gewählt (${G.orientH?"waagerecht":"senkrecht"}).`; render(); armDrag(el, ev); };
      el.addEventListener("pointerdown", start);
      dockEl.appendChild(el);
    });
    if (!dockEl.children.length) dockEl.innerHTML = `<span style="opacity:.7;font-size:13px">Alle Schiffe platziert.</span>`;

    // actions
    actionsEl.innerHTML = "";
    actionsEl.append(btn(G.orientH ? "Drehen (R): waagerecht" : "Drehen (R): senkrecht", "", () => { G.orientH=!G.orientH; if(G.drag) G.drag.h=G.orientH; render(); }));
    actionsEl.append(btn("Zufällig", "", () => { const r = randomFleet(); p.board=r.board; p.ships=r.ships; p.placed=true; G.drag=null; G.msg="Zufällig platziert."; render(); }));
    actionsEl.append(btn("Alle entfernen", "", () => { p.board=mk(0); p.ships=[]; p.placed=false; G.drag=null; G.msg="Feld geleert."; render(); }));
    if (!HUB) actionsEl.append(btn("Spiel starten", "primary", startPlaying));

    bindOwnCanvas(true);
    draw();
  }

  function renderPlay(main) {
    const me = myIndex(), opi = opp(me);
    main.innerHTML = `
      <div class="bs2-play">
        <div class="bs2-panel"><h3>Deine Flotte (${G.players[me].name})</h3><canvas class="bs2-cv" id="bs2-own" width="520" height="520"></canvas></div>
        <div class="bs2-panel"><h3>Gegnerisches Meer (${G.players[opi].name})</h3><canvas class="bs2-cv" id="bs2-tgt" width="520" height="520"></canvas></div>
      </div>
      <div class="bs2-actions" style="margin-top:12px" id="bs2-actions"></div>
      ${G.winner!=null ? `<div class="bs2-over">${G.players[G.winner].name} hat gewonnen.</div>` : ``}`;
    ownCv = main.querySelector("#bs2-own"); tgtCv = main.querySelector("#bs2-tgt");
    ownCtx = ownCv.getContext("2d"); tgtCtx = tgtCv.getContext("2d");
    actionsEl = main.querySelector("#bs2-actions");
    actionsEl.append(btn("Neues Spiel", "primary", () => HUB ? (NET?.isHost ? newGame() : NET?.send("bs",{t:"reset"})) : newGame()));
    bindOwnCanvas(false); bindTargetCanvas();
    draw();
  }

  function btn(label, cls, fn) { const b = document.createElement("button"); b.type="button"; b.className="bs2-btn"+(cls?" "+cls:""); b.textContent=label; b.onclick=fn; return b; }

  function cellFromEvent(cv, e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N);
    const y = Math.floor(((e.clientY - r.top) / r.height) * N);
    return inB(x,y) ? {x,y} : null;
  }

  function armDrag(el, startEv) {
    // keep drag active across pointer capture; actual drop handled on canvas/global
    try { el.setPointerCapture(startEv.pointerId); } catch {}
  }

  function bindOwnCanvas(placing) {
    if (!ownCv) return;
    const move = (e) => { const c = cellFromEvent(ownCv,e); G.hover = c ? {which:"own", ...c} : null; if (placing) e.preventDefault(); };
    const leave = () => { if (G.hover?.which==="own") G.hover=null; };
    const down = (e) => {
      if (!placing) return;
      const c = cellFromEvent(ownCv,e); if (!c) return;
      const me = myIndex(), p = G.players[me];
      const uid = p.board[c.x][c.y];
      if (uid) {
        const ship = p.ships.find(s=>s.uid===uid);
        if (ship) {
          liftShip(p, ship.id);
          G.drag = { shipId: ship.id, len: ship.len, name: ship.name, h: ship.h, fromBoard: true };
          G.orientH = ship.h;
          G.msg = `${ship.name} aufgenommen.`;
          ownCv.setPointerCapture(e.pointerId);
          render();
        }
      } else if (G.drag) {
        // tap-to-place fallback
        dropShip(c.x, c.y);
      }
    };
    const up = (e) => {
      if (!placing || !G.drag) return;
      const c = cellFromEvent(ownCv,e);
      if (c) dropShip(c.x, c.y); else { G.drag = null; render(); }
    };
    ownCv.onpointermove = move; ownCv.onpointerleave = leave; ownCv.onpointerdown = down; ownCv.onpointerup = up;
  }

  function bindTargetCanvas() {
    if (!tgtCv) return;
    tgtCv.onpointermove = (e) => { const c = cellFromEvent(tgtCv,e); G.hover = c ? {which:"target",...c} : null; };
    tgtCv.onpointerleave = () => { if (G.hover?.which==="target") G.hover=null; };
    tgtCv.onpointerdown = (e) => {
      if (!G || G.phase !== "playing") return;
      const c = cellFromEvent(tgtCv,e); if (!c) return;
      if (!isMyTurn()) { G.msg = HUB ? "Warte auf deinen Zug." : "Gegner ist dran."; render(); return; }
      receiveShot(c.x, c.y, myIndex(), !HUB ? true : !!NET?.isHost);
    };
  }

  // ===== drawing =====
  function draw() {
    if (destroyed) return;
    if (G && ownCtx) {
      const me = myIndex(), opi = opp(me);
      drawBoard(ownCtx, ownCv, me, opi, "own");
      if (tgtCtx && tgtCv) drawBoard(tgtCtx, tgtCv, opi, me, "target");
    }
    raf = requestAnimationFrame(draw);
  }
  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function drawBoard(ctx, cv, ownerIdx, shooterIdx, mode) {
    if (!ctx || !cv || !G) return;
    const W=cv.width,H=cv.height, pad=28, grid=Math.min(W,H)-pad*1.15, cs=grid/N, ox=pad+6, oy=pad+6;
    ctx.clearRect(0,0,W,H);
    const bg=ctx.createLinearGradient(0,0,0,H); bg.addColorStop(0,"#15455f"); bg.addColorStop(1,"#0d2f43");
    roundRect(ctx,0,0,W,H,12); ctx.fillStyle=bg; ctx.fill();
    ctx.fillStyle="rgba(220,242,255,.72)"; ctx.font="600 12px system-ui,sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    for(let i=0;i<N;i++){ ctx.fillText(LETTERS[i], ox+i*cs+cs/2, oy-10); ctx.fillText(String(i+1), ox-12, oy+i*cs+cs/2); }
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const px=ox+x*cs, py=oy+y*cs;
      ctx.fillStyle=(x+y)%2===0?"rgba(255,255,255,.045)":"rgba(255,255,255,.02)";
      ctx.fillRect(px,py,cs,cs); ctx.strokeStyle="rgba(170,225,255,.16)"; ctx.strokeRect(px+.5,py+.5,cs-1,cs-1);
    }
    const owner = G.players[ownerIdx];
    // ships: show own always on own board; show sunk on target
    if (mode==="own") {
      for (const s of owner.ships) for (const [x,y] of cellsOf(s)) {
        const px=ox+x*cs, py=oy+y*cs;
        ctx.fillStyle=s.sunk?"rgba(120,85,85,.72)":"rgba(120,175,205,.58)";
        roundRect(ctx,px+3,py+3,cs-6,cs-6,5); ctx.fill();
      }
    } else {
      for (const s of owner.ships) if (s.sunk) for (const [x,y] of cellsOf(s)) {
        ctx.fillStyle="rgba(140,95,95,.42)"; roundRect(ctx,px+3,py+3,cs-6,cs-6,5); ctx.fill();
      }
    }
    // marks from shooter
    const marks = G.players[shooterIdx].shots;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const v=marks[x][y]; if(!v) continue;
      const cx=ox+x*cs+cs/2, cy=oy+y*cs+cs/2;
      if(v===2){ ctx.strokeStyle="#ff7a5c"; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(cx-cs*.22,cy-cs*.22); ctx.lineTo(cx+cs*.22,cy+cs*.22); ctx.moveTo(cx+cs*.22,cy-cs*.22); ctx.lineTo(cx-cs*.22,cy+cs*.22); ctx.stroke();
        ctx.fillStyle="rgba(255,90,60,.16)"; ctx.beginPath(); ctx.arc(cx,cy,cs*.28,0,Math.PI*2); ctx.fill(); }
      else { ctx.fillStyle="rgba(235,248,255,.88)"; ctx.beginPath(); ctx.arc(cx,cy,Math.max(2.5,cs*.09),0,Math.PI*2); ctx.fill(); }
    }
    // drag ghost on own board
    if (mode==="own" && G.phase==="placing" && G.drag && G.hover?.which==="own") {
      const {len,h} = G.drag, ok = canPlace(G.players[myIndex()].board, G.hover.x, G.hover.y, len, h, 0);
      ctx.fillStyle = ok ? "rgba(116,226,178,.30)" : "rgba(255,110,140,.24)";
      for(let i=0;i<len;i++){ const x=h?G.hover.x+i:G.hover.x, y=h?G.hover.y:G.hover.y+i; if(inB(x,y)){ roundRect(ctx,ox+x*cs+3,oy+y*cs+3,cs-6,cs-6,5); ctx.fill(); } }
    }
    // target hover
    if (mode==="target" && G.phase==="playing" && isMyTurn() && G.hover?.which==="target") {
      const me=myIndex(); if(!G.players[me].shots[G.hover.x][G.hover.y]) { ctx.fillStyle="rgba(255,224,138,.22)"; roundRect(ctx,ox+G.hover.x*cs+2,oy+G.hover.y*cs+2,cs-4,cs-4,6); ctx.fill(); }
    }
    // fx
    const now=performance.now(); G.fx = (G.fx||[]).filter(f=>now-f.t<900);
    for(const f of G.fx){ if(f.owner!==ownerIdx) continue; const age=(now-f.t)/900, cx=ox+f.x*cs+cs/2, cy=oy+f.y*cs+cs/2; ctx.strokeStyle=f.kind==="hit"?`rgba(255,120,80,${1-age})`:`rgba(180,230,255,${1-age})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(cx,cy,cs*.2+age*cs*.55,0,Math.PI*2); ctx.stroke(); }
    ctx.lineWidth=1;
  }

  function start() {
    mount(); newGame(true); draw();
    if (HUB && NET) {
      NET.onMessage("bs", ({ data }) => onNet(data));
      NET.onEvent("join", () => { if (NET?.isHost) broadcast(); });
      NET.onEvent("leave", render);
    }
  }
  function destroy() {
    destroyed = true; cancelAnimationFrame(raf);
    if (onKey) window.removeEventListener("keydown", onKey);
    try{rootStyleEl?.remove()}catch{} try{root?.remove()}catch{}
  }
  start();
  return { destroy, reset: () => (HUB ? (NET?.isHost ? newGame() : NET?.send("bs",{t:"reset"})) : newGame()), getState: () => clone(G) };
};

if (!window.__BATTLESHIP_HUB__) window.createBattleship();
