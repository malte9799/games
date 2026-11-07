// Battleship (Schiffe versenken) — 2-player naval combat on a 3D wooden table.
// Factory: window.createBattleship({ root?, net? }) for the hub; standalone mounts via initGame.
// Two 10x10 felt boards, ship models, shot markers, splash/hit/explosion animations, turn-based play.

window.createBattleship = (env = {}) => {
  const NET = env.net || null;
  const HUB = !!NET;

  let destroyed = false, raf = 0, rootStyleEl = null, onKeyDown = null;
  const observers = [];

  const loadSettings = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch { return {}; } };
  const saveSettings = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); } catch {} };
  function celebrate(tier) {
    const fire = () => window.confetti && window.confetti({ particleCount: 40 + (tier || 1) * 50, spread: 80, startVelocity: 45, origin: { y: 0.6 }, zIndex: 200, disableForReducedMotion: true, colors: ["#74e2b2", "#6cb6ff", "#ffd66e", "#ff6e8c", "#b098ff"] });
    if (window.confetti) fire(); else loadScript("https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js").then(fire).catch(() => {});
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some((s) => s.src === src)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed " + src));
      document.head.appendChild(s);
    });
  }

  // ============================================================ data & rules
  const SAVE_KEY = "battleship_state";
  const N = 10;
  const LETTERS = "ABCDEFGHIJ";
  const FLEET = [
    { id: "carrier", name: "Flugzeugträger", len: 5 },
    { id: "battleship", name: "Schlachtschiff", len: 4 },
    { id: "cruiser", name: "Kreuzer", len: 3 },
    { id: "submarine", name: "U-Boot", len: 3 },
    { id: "destroyer", name: "Zerstörer", len: 2 },
  ];

  function mkBoard() { return Array.from({ length: N }, () => Array(N).fill(0)); } // 0 empty, 1 ship
  function mkShots() { return Array.from({ length: N }, () => Array(N).fill(0)); } // 0 none, 1 miss, 2 hit

  function shipCells(ship) {
    const out = [];
    for (let i = 0; i < ship.len; i++) out.push(ship.h ? [ship.x + i, ship.y] : [ship.x, ship.y + i]);
    return out;
  }
  function inBounds(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
  function canPlace(board, x, y, len, h, ignore) {
    for (let i = 0; i < len; i++) {
      const cx = h ? x + i : x, cy = h ? y : y + i;
      if (!inBounds(cx, cy)) return false;
      if (board[cx][cy] && board[cx][cy] !== ignore) return false;
      // no touching (including diagonals) for cleaner placement
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx, ny = cy + dy;
        if (inBounds(nx, ny) && board[nx][ny] && board[nx][ny] !== ignore) return false;
      }
    }
    return true;
  }
  function placeFleetRandom() {
    const board = mkBoard();
    const ships = FLEET.map((f, idx) => {
      let placed = false, x = 0, y = 0, h = true, tries = 0;
      while (!placed && tries++ < 500) {
        h = Math.random() < 0.5;
        x = Math.floor(Math.random() * (h ? N - f.len + 1 : N));
        y = Math.floor(Math.random() * (h ? N : N - f.len + 1));
        if (canPlace(board, x, y, f.len, h, 0)) placed = true;
      }
      const ship = { ...f, x, y, h, hits: 0, sunk: false, uid: idx + 1 };
      for (let i = 0; i < f.len; i++) {
        const cx = h ? x + i : x, cy = h ? y : y + i;
        if (inBounds(cx, cy)) board[cx][cy] = ship.uid;
      }
      return ship;
    });
    return { board, ships };
  }

  function freshState() {
    const p1 = placeFleetRandom();
    const p2 = placeFleetRandom();
    return {
      phase: "playing", // setup could be added later
      turn: 0, // 0 = local/player1 perspective in solo/hub host view
      players: [
        { name: HUB ? (NET.players[0]?.name || "Spieler 1") : "Du", ...p1, shots: mkShots(), shotCount: 0, hits: 0 },
        { name: HUB ? (NET.players[1]?.name || "Spieler 2") : "Computer", ...p2, shots: mkShots(), shotCount: 0, hits: 0 },
      ],
      winner: null,
      log: [],
    };
  }

  let G = freshState();

  // In hub mode, player index is determined by NET.me relative to players list
  function myIndex() {
    if (!HUB) return 0;
    const me = NET.me?.id;
    const idx = (NET.players || []).findIndex((p) => p.id === me);
    return idx >= 0 ? idx : 0;
  }
  function isMyTurn() { return !G.winner && G.turn === myIndex(); }
  function opponentIndex(i = myIndex()) { return i === 0 ? 1 : 0; }

  // ============================================================ 3D: utilities & textures
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const lerpC = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

  const NLAT = (() => { const a = new Float32Array(512 * 512); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; })();
  function vnoise(x, y, fx, fy, ox = 0, oy = 0) {
    const X = x * fx, Y = y * fy, x0 = Math.floor(X), y0 = Math.floor(Y);
    const tx = X - x0, ty = Y - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const xa = ((x0 % fx) + ox) & 511, xb = (((x0 + 1) % fx) + ox) & 511, ya = ((y0 % fy) + oy) & 511, yb = (((y0 + 1) % fy) + oy) & 511;
    const a = NLAT[ya * 512 + xa], b = NLAT[ya * 512 + xb], c = NLAT[yb * 512 + xa], d = NLAT[yb * 512 + xb];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

  function woodTexture({ size = 1024, dark, light, planks = 1, streaks = 48, calm = 1, seed = 0 }) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d"), img = g.createImageData(size, size), data = img.data;
    const tone = Array.from({ length: planks }, (_, i) => (Math.sin(i * 7.3 + seed) * 0.08));
    const off = Array.from({ length: planks }, (_, i) => Math.floor((i + 1) * 37 + seed * 53) & 511);
    const lines = Math.max(8, Math.floor(streaks * 0.55));
    for (let y = 0; y < size; y++) {
      const v = y / size, pl = Math.min(planks - 1, Math.floor(v * planks)), pv = v * planks - pl;
      const edge = Math.min(pv, 1 - pv) * size / planks, seam = 1 - (1 - smooth(0, 3.2, edge)) * 0.72;
      const o = off[pl];
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const vv = ((v + (vnoise(u, v, 3, 5, o, o) - 0.5) * 0.03 * calm) + 1) % 1;
        const streak = vnoise(u, vv, 2, streaks, o, o + 7) * 0.5 + vnoise(u, vv, 5, streaks * 2, o + 3, o + 11) * 0.3 + vnoise(u, vv, 13, streaks * 5, o + 5, o + 19) * 0.2;
        const ring = smooth(0.58, 0.84, vnoise(u, vv, 2, lines, o + 13, o + 29));
        const pore = vnoise(u, v, 128, 512, o, o + 41);
        const k = clamp(0.5 + (streak - 0.5) * 1.2 - ring * 0.3 + (pore - 0.5) * 0.14 + tone[pl], 0, 1);
        const i = (y * size + x) * 4;
        data[i] = (dark[0] + (light[0] - dark[0]) * k) * seam;
        data[i + 1] = (dark[1] + (light[1] - dark[1]) * k) * seam;
        data[i + 2] = (dark[2] + (light[2] - dark[2]) * k) * seam;
        data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function feltTexture() {
    const size = 1024;
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
    const cm = mk(), cb = mk();
    const gm = cm.getContext("2d"), gb = cb.getContext("2d");
    const im = gm.createImageData(size, size), ib = gb.createImageData(size, size);
    const dm = im.data, db = ib.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const cloud = vnoise(u, v, 5, 5, 10, 10) * 0.6 + vnoise(u, v, 14, 14, 20, 20) * 0.4;
      const fiber = vnoise(u, v, 96, 320, 30, 30);
      const k = 0.55 + (cloud - 0.5) * 0.18 + (fiber - 0.5) * 0.12;
      const i = (y * size + x) * 4;
      const col = lerpC([18, 62, 90], [42, 112, 148], k); // naval blue felt
      dm[i] = col[0]; dm[i+1] = col[1]; dm[i+2] = col[2]; dm[i+3] = 255;
      const b = Math.round(128 + (fiber - 0.5) * 40 + (cloud - 0.5) * 20);
      db[i] = db[i+1] = db[i+2] = b; db[i+3] = 255;
    }
    gm.putImageData(im, 0, 0); gb.putImageData(ib, 0, 0);
    const map = new THREE.CanvasTexture(cm), bump = new THREE.CanvasTexture(cb);
    map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    map.anisotropy = bump.anisotropy = 8;
    if (THREE.sRGBEncoding) map.encoding = THREE.sRGBEncoding;
    return { map, bump };
  }

  function gridTexture() {
    const s = 512, c = document.createElement("canvas"); c.width = c.height = s;
    const g = c.getContext("2d");
    g.clearRect(0,0,s,s);
    g.strokeStyle = "rgba(170,220,255,0.22)";
    g.lineWidth = 2;
    for (let i = 0; i <= N; i++) {
      const p = (i / N) * s;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, s); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(s, p); g.stroke();
    }
    // subtle dots at intersections
    g.fillStyle = "rgba(210,240,255,0.18)";
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) { g.beginPath(); g.arc((x/N)*s, (y/N)*s, 2.2, 0, Math.PI*2); g.fill(); }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function labelTexture(text, color = "#dff4ff") {
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.clearRect(0,0,c.width,c.height);
    g.font = '700 56px "Trebuchet MS", "Segoe UI", sans-serif';
    g.fillStyle = color;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 8;
    g.fillText(text, c.width/2, c.height/2 + 2);
    const tex = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // ============================================================ 3D: scene setup
  let renderer, scene, camera, raycaster, mouseNdc;
  let root, glEl, dcEl, ccEl, hudEl, promptEl, turnEl, logEl, overEl;
  let hoverCell = null;
  const boards3D = []; // { group, cellsPlane, markersGroup, shipsGroup, frame, originX, originZ, size, label }
  const animations = []; // { t, dur, update, done }
  const particles = []; // { mesh, vel, life, maxLife }
  let boardSep = 5.2;
  const boardSize = 7.2; // world units per board (square)
  const cellSize = boardSize / N;
  const TABLE_Y = -0.5;
  const WATER_Y = 0.01;

  function init3D() {
    const T = THREE;
    glEl = root.querySelector("#bs-gl");
    renderer = new T.WebGLRenderer({ canvas: glEl, antialias: true, powerPreference: "high-performance", alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;
    if (T.ACESFilmicToneMapping) renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    if (T.PCFSoftShadowMap) renderer.shadowMap.type = T.PCFSoftShadowMap;

    scene = new T.Scene();
    scene.background = new T.Color(0x23160f);
    camera = new T.PerspectiveCamera(32, 1, 0.5, 300);
    raycaster = new T.Raycaster();
    mouseNdc = new T.Vector2();

    scene.add(new T.HemisphereLight(0xfff1de, 0x3a2a1c, 0.55));
    const key = new T.DirectionalLight(0xfff2d8, 1.9);
    key.position.set(-10, 18, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -20; key.shadow.camera.right = 20; key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
    key.shadow.camera.near = 2; key.shadow.camera.far = 60;
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const fill = new T.PointLight(0xffcb86, 0.5, 90); fill.position.set(12, 9, -8); scene.add(fill);
    const rim = new T.PointLight(0x9bd7ff, 0.25, 70); rim.position.set(0, 6, -14); scene.add(rim);

    // table
    const tableTex = woodTexture({ size: 1024, dark: [40, 23, 13], light: [128, 82, 48], planks: 5, streaks: 54, seed: 11 });
    tableTex.repeat.set(6, 4);
    const table = new T.Mesh(new T.PlaneGeometry(140, 90), new T.MeshStandardMaterial({ map: tableTex, roughness: 0.74, envMapIntensity: 0.25 }));
    table.rotation.x = -Math.PI / 2; table.position.y = TABLE_Y; table.receiveShadow = true;
    scene.add(table);

    buildBoard3D(0, -boardSep / 2 - boardSize / 2, 0, "DEIN FELD");
    buildBoard3D(1,  boardSep / 2 + boardSize / 2, 0, "GEGNER");

    glEl.addEventListener("pointermove", onPointerMove);
    glEl.addEventListener("pointerleave", () => setHover(null));
    glEl.addEventListener("click", onClickBoard);
    glEl.addEventListener("touchstart", (e) => { if (e.touches[0]) onPointerMove(e.touches[0]); }, { passive: true });
  }

  function buildBoard3D(index, cx, cz, label) {
    const T = THREE;
    const group = new T.Group();
    group.position.set(cx, 0, cz);
    scene.add(group);

    const rimW = 0.45, rimH = 0.42;
    const rimTex = woodTexture({ size: 512, dark: [56, 20, 8], light: [154, 74, 34], planks: 1, streaks: 38, seed: 20 + index });
    const rimMat = new T.MeshStandardMaterial({ map: rimTex, roughness: 0.42, metalness: 0.03 });

    const outerW = boardSize + rimW * 2, outerD = boardSize + rimW * 2;
    const frame = new T.Mesh(new T.BoxGeometry(outerW, rimH, outerD), rimMat);
    frame.position.y = TABLE_Y + rimH / 2;
    frame.castShadow = true; frame.receiveShadow = true;
    group.add(frame);

    const felt = feltTexture();
    const floor = new T.Mesh(new T.PlaneGeometry(boardSize, boardSize), new T.MeshStandardMaterial({ map: felt.map, bumpMap: felt.bump, bumpScale: 0.25, roughness: 1, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = WATER_Y; floor.receiveShadow = true;
    group.add(floor);

    const grid = new T.Mesh(new T.PlaneGeometry(boardSize, boardSize), new T.MeshBasicMaterial({ map: gridTexture(), transparent: true, depthWrite: false }));
    grid.rotation.x = -Math.PI / 2; grid.position.y = WATER_Y + 0.003;
    group.add(grid);

    const hover = new T.Mesh(new T.PlaneGeometry(cellSize * 0.92, cellSize * 0.92), new T.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.0, depthWrite: false }));
    hover.rotation.x = -Math.PI / 2; hover.position.y = WATER_Y + 0.01;
    group.add(hover);

    const markers = new T.Group(); markers.position.y = WATER_Y + 0.02; group.add(markers);
    const shipsG = new T.Group(); shipsG.position.y = WATER_Y + 0.02; group.add(shipsG);
    const fxG = new T.Group(); fxG.position.y = 0; group.add(fxG);

    const lab = new T.Mesh(new T.PlaneGeometry(2.8, 0.45), new T.MeshBasicMaterial({ map: labelTexture(label), transparent: true, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(0, WATER_Y + 0.004, -boardSize / 2 - 0.45);
    group.add(lab);

    const b = { index, group, cx, cz, hover, markers, shipsG, fxG, cells: {} };
    boards3D[index] = b;
    return b;
  }

  function cellWorld(boardIndex, x, y) {
    const b = boards3D[boardIndex];
    if (!b) return new THREE.Vector3();
    const ox = -boardSize / 2 + cellSize / 2;
    const oz = -boardSize / 2 + cellSize / 2;
    return new THREE.Vector3(b.cx + ox + x * cellSize, WATER_Y, b.cz + oz + y * cellSize);
  }

  function makeShipMesh(ship) {
    const T = THREE;
    const lenW = ship.len * cellSize * 0.88;
    const beam = cellSize * 0.52;
    const hullH = 0.22;
    const color = ship.sunk ? 0x555b63 : (ship.hits > 0 ? 0x7b6b5e : 0x8ea3b3);
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.18 });
    const geo = new T.BoxGeometry(lenW, hullH, beam);
    // taper bow by scaling vertices
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      if (px > lenW * 0.25) { const t = (px - lenW * 0.25) / (lenW * 0.25); pos.setZ(i, pz * (1 - t * 0.45)); pos.setY(i, pos.getY(i) * (1 - t * 0.15)); }
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.y = hullH / 2 + 0.01;

    const cabin = new T.Mesh(new T.BoxGeometry(lenW * 0.22, hullH * 0.55, beam * 0.55), new T.MeshStandardMaterial({ color: 0xb7c4cf, roughness: 0.45, metalness: 0.12 }));
    cabin.position.set(-lenW * 0.08, hullH * 0.65, 0); cabin.castShadow = true;
    mesh.add(cabin);

    const g = new T.Group();
    g.add(mesh);
    g.rotation.y = ship.h ? 0 : Math.PI / 2;
    return g;
  }

  function syncShips3D() {
    for (const b of boards3D) {
      if (!b) continue;
      b.shipsG.clear();
    }
    const me = myIndex();
    // show own ships on own board; show opponent ships only when sunk (classic behavior)
    for (let pi = 0; pi < G.players.length; pi++) {
      const pl = G.players[pi];
      const boardIdx = (pi === me) ? 0 : 1; // left = mine, right = opponent from my perspective
      const b = boards3D[boardIdx];
      if (!b) continue;
      for (const ship of pl.ships) {
        if (pi !== me && !ship.sunk) continue;
        const g = makeShipMesh(ship);
        // position at ship center
        const cx = ship.h ? ship.x + (ship.len - 1) / 2 : ship.x;
        const cy = ship.h ? ship.y : ship.y + (ship.len - 1) / 2;
        const wp = cellWorld(boardIdx, Math.round(ship.h ? ship.x : ship.x), Math.round(ship.h ? ship.y : ship.y));
        // compute true center
        const center = cellWorld(boardIdx, 0, 0);
        const ox = -boardSize / 2 + cellSize / 2;
        const oz = -boardSize / 2 + cellSize / 2;
        g.position.x = ox + cx * cellSize;
        g.position.z = oz + cy * cellSize;
        g.position.y = WATER_Y + 0.01;
        g.userData.shipUid = ship.uid;
        b.shipsG.add(g);
      }
    }
  }

  function syncMarkers3D() {
    for (const b of boards3D) { if (b) b.markers.clear(); }
    const me = myIndex();
    const opp = opponentIndex(me);
    // markers on opponent board = my shots; markers on my board = opponent shots
    const pairs = [[1, G.players[me].shots], [0, G.players[opp].shots]];
    for (const [boardIdx, shots] of pairs) {
      const b = boards3D[boardIdx]; if (!b) continue;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = shots[x][y];
        if (!v) continue;
        const wp = cellLocal(x, y);
        if (v === 1) { // miss
          const m = new THREE.Mesh(new THREE.SphereGeometry(cellSize * 0.12, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf4f0d8, emissive: 0x222018, roughness: 0.7 }));
          m.position.set(wp.x, 0.12, wp.z); m.castShadow = true; b.markers.add(m);
          const ring = new THREE.Mesh(new THREE.RingGeometry(cellSize * 0.16, cellSize * 0.22, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.set(wp.x, 0.004, wp.z); b.markers.add(ring);
        } else if (v === 2) { // hit
          const m = new THREE.Mesh(new THREE.ConeGeometry(cellSize * 0.14, cellSize * 0.28, 12), new THREE.MeshStandardMaterial({ color: 0xff7048, emissive: 0x551000, roughness: 0.45 }));
          m.position.set(wp.x, 0.16, wp.z); m.castShadow = true; b.markers.add(m);
          const glow = new THREE.Mesh(new THREE.CircleGeometry(cellSize * 0.22, 20), new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.22, depthWrite: false }));
          glow.rotation.x = -Math.PI / 2; glow.position.set(wp.x, 0.005, wp.z); b.markers.add(glow);
        }
      }
    }
  }
  function cellLocal(x, y) {
    const ox = -boardSize / 2 + cellSize / 2;
    const oz = -boardSize / 2 + cellSize / 2;
    return { x: ox + x * cellSize, z: oz + y * cellSize };
  }

  function syncAll3D() { syncShips3D(); syncMarkers3D(); }

  // ============================================================ 3D: interaction
  function setHover(cell) {
    hoverCell = cell;
    for (const b of boards3D) {
      if (!b) continue;
      if (cell && b.index === cell.board) {
        const p = cellLocal(cell.x, cell.y);
        b.hover.position.x = p.x; b.hover.position.z = p.z;
        b.hover.material.opacity = 0.38;
      } else b.hover.material.opacity = 0.0;
    }
  }

  function pickCell(ev) {
    if (!renderer || !camera) return null;
    const rect = glEl.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height)) * 2 + 1;
    mouseNdc.set(x, y);
    raycaster.setFromCamera(mouseNdc, camera);
    // intersect opponent board plane (board index 1 from my view)
    const b = boards3D[1]; if (!b) return null;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const lx = hit.x - b.cx + boardSize / 2;
    const lz = hit.z - b.cz + boardSize / 2;
    if (lx < 0 || lz < 0 || lx >= boardSize || lz >= boardSize) return null;
    const cx = Math.floor(lx / cellSize), cy = Math.floor(lz / cellSize);
    if (!inBounds(cx, cy)) return null;
    return { board: 1, x: cx, y: cy };
  }

  function onPointerMove(ev) {
    if (destroyed || G.winner || !isMyTurn()) { setHover(null); return; }
    const cell = pickCell(ev);
    if (cell) {
      const me = myIndex();
      if (G.players[me].shots[cell.x][cell.y]) { setHover(null); glEl.style.cursor = "not-allowed"; return; }
      glEl.style.cursor = "crosshair";
      setHover(cell);
    } else { glEl.style.cursor = ""; setHover(null); }
  }

  function onClickBoard(ev) {
    if (destroyed) return;
    const cell = pickCell(ev);
    if (!cell) return;
    if (!isMyTurn()) { note("Nicht dein Zug."); return; }
    fireAt(cell.x, cell.y, myIndex(), true);
  }

  // ============================================================ 3D: animations & effects
  function addAnim(dur, update, done) { animations.push({ t: 0, dur, update, done }); }

  function spawnParticles(origin, count, color, spread = 1, up = 1.6) {
    const T = THREE;
    for (let i = 0; i < count; i++) {
      const m = new T.Mesh(new T.SphereGeometry(0.04 + Math.random() * 0.05, 8, 6), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      m.position.copy(origin);
      scene.add(m);
      particles.push({
        mesh: m,
        vel: new T.Vector3((Math.random() - 0.5) * spread, Math.random() * up + 0.3, (Math.random() - 0.5) * spread),
        life: 0.6 + Math.random() * 0.6, maxLife: 1.2,
      });
    }
  }

  function shotAnimation(boardIdx, x, y, hit, onDone) {
    const target = new THREE.Vector3();
    const lp = cellLocal(x, y);
    const b = boards3D[boardIdx];
    target.set(b.cx + lp.x, WATER_Y + 0.05, b.cz + lp.z);
    const start = target.clone().add(new THREE.Vector3((Math.random()-0.5)*2, 5.5, (Math.random()-0.5)*3.5));
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshStandardMaterial({ color: hit ? 0xffc14a : 0xe8f4ff, emissive: hit ? 0x552200 : 0x223344, roughness: 0.4 }));
    proj.position.copy(start); proj.castShadow = true;
    scene.add(proj);
    addAnim(0.55, (k) => {
      const e = easeIO(k);
      proj.position.lerpVectors(start, target, e);
      proj.position.y += Math.sin(k * Math.PI) * 0.9;
    }, () => {
      scene.remove(proj);
      if (hit) {
        spawnParticles(target, 26, 0xff6a3a, 2.2, 2.4);
        spawnParticles(target, 10, 0xffd36e, 1.4, 1.6);
      } else {
        spawnParticles(target.clone().setY(WATER_Y + 0.02), 18, 0x9fd8ff, 1.8, 1.1);
        spawnParticles(target, 8, 0xffffff, 1.0, 0.8);
      }
      // ripple ring
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.06, 28), new THREE.MeshBasicMaterial({ color: hit ? 0xff8855 : 0xbfeaff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(target).setY(WATER_Y + 0.006);
      scene.add(ring);
      addAnim(0.7, (k) => { const s = 1 + k * 5; ring.scale.set(s,s,s); ring.material.opacity = 0.8 * (1-k); }, () => scene.remove(ring));
      if (onDone) onDone();
    });
  }

  function sinkAnimation(boardIdx, ship) {
    const b = boards3D[boardIdx]; if (!b) return;
    const target = b.shipsG.children.find((c) => c.userData.shipUid === ship.uid);
    if (!target) { syncShips3D(); return; }
    spawnParticles(target.position.clone().add(new THREE.Vector3(b.cx, 0.2, b.cz)), 30, 0x8899aa, 2.5, 1.8);
    addAnim(1.2, (k) => {
      const e = easeIO(k);
      target.position.y = WATER_Y + 0.01 - e * 0.35;
      target.rotation.z = (ship.h ? 0.001 : 0) + e * 0.18;
      target.rotation.x = e * 0.22;
      target.traverse((o) => { if (o.material && o.material.transparent !== undefined && o !== target) {} if (o.material && o.material.opacity !== undefined) { o.material.transparent = true; o.material.opacity = 1 - e * 0.35; } });
    }, () => syncShips3D());
  }

  // ============================================================ game logic
  function note(msg) { if (promptEl) { promptEl.textContent = msg; clearTimeout(note.t); note.t = setTimeout(updateHUD, 2800); } }
  function logMsg(msg) { G.log.unshift(msg); if (G.log.length > 8) G.log.pop(); renderLog(); }

  function fireAt(x, y, shooterIdx, localAction) {
    if (G.winner) return;
    if (G.turn !== shooterIdx) return;
    const targetIdx = opponentIndex(shooterIdx);
    const shooter = G.players[shooterIdx];
    const target = G.players[targetIdx];
    if (shooter.shots[x][y]) return;
    if (localAction && HUB) {
      if (NET && NET.isHost) {
        // host applies and broadcasts
      } else {
        mpSend({ t: "shot", x, y, by: shooterIdx });
        return;
      }
    }

    const shipUid = target.board[x][y];
    const hit = !!shipUid;
    shooter.shots[x][y] = hit ? 2 : 1;
    shooter.shotCount++;
    let sunkShip = null;
    if (hit) {
      shooter.hits++;
      const ship = target.ships.find((s) => s.uid === shipUid);
      if (ship && !ship.sunk) {
        ship.hits++;
        if (ship.hits >= ship.len) { ship.sunk = true; sunkShip = ship; }
      }
    }
    const coord = `${LETTERS[x]}${y + 1}`;
    logMsg(`${shooter.name}: ${coord} — ${hit ? (sunkShip ? `Treffer, versenkt! (${sunkShip.name})` : "Treffer!") : "Wasser."}`);

    const viewBoardIdx = (targetIdx === myIndex()) ? 0 : 1;
    shotAnimation(viewBoardIdx, x, y, hit, () => {
      syncAll3D();
      if (sunkShip) sinkAnimation(viewBoardIdx, sunkShip);
    });

    // win?
    if (target.ships.every((s) => s.sunk)) {
      G.winner = shooterIdx;
      G.phase = "over";
      celebrate(2);
      showOver();
    } else {
      G.turn = targetIdx;
      // simple AI for solo mode
      if (!HUB && G.turn === 1 && !G.winner) setTimeout(aiTurn, 700);
    }
    syncAll3D(); updateHUD();
    if (HUB && NET && NET.isHost) mpSend({ t: "state", state: serializeState() });
  }

  function aiTurn() {
    if (destroyed || G.winner || G.turn !== 1) return;
    const shots = G.players[1].shots;
    // hunt/target heuristic
    const candidates = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (shots[x][y]) continue;
      let score = 0;
      const adj = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx,dy] of adj) { const nx=x+dx, ny=y+dy; if (inBounds(nx,ny) && shots[nx][ny]===2) score += 5; }
      if ((x+y)%2===0) score += 1;
      candidates.push({x,y,score: score + Math.random()*0.5});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const pick = candidates[0];
    if (pick) fireAt(pick.x, pick.y, 1, false);
  }

  function resetGame(keepNet = false) {
    G = freshState();
    if (HUB) {
      G.players[0].name = NET.players[0]?.name || "Spieler 1";
      G.players[1].name = NET.players[1]?.name || "Spieler 2";
    }
    hideOver();
    syncAll3D();
    updateHUD();
    renderLog();
    if (HUB && NET.isHost && !keepNet) mpSend({ t: "state", state: serializeState() });
  }

  function serializeState() {
    return JSON.parse(JSON.stringify(G));
  }
  function applyState(st) {
    if (!st) return;
    G = st;
    syncAll3D(); updateHUD(); renderLog();
    if (G.winner != null) showOver(); else hideOver();
  }

  // ============================================================ networking (hub)
  function mpSend(msg) { try { if (NET) NET.send("bs", msg); } catch (e) { console.error(e); } }
  function onNet(msg) {
    if (!msg || destroyed) return;
    if (msg.t === "state" && msg.state) applyState(msg.state);
    else if (msg.t === "shot" && typeof msg.x === "number") {
      // host validates/applies and rebroadcasts; clients can apply host state
      if (NET.isHost) fireAt(msg.x, msg.y, typeof msg.by === "number" ? msg.by : G.turn, false);
    } else if (msg.t === "reset" && NET.isHost) { resetGame(); }
  }
  function mpReset() { if (NET?.isHost) { resetGame(); } else { mpSend({ t: "reset" }); } }

  // ============================================================ UI / DOM
  const CSS = `
#bs-root{position:fixed;inset:0;background:#1f140d;color:#f4ecd8;font-family:"Trebuchet MS","Segoe UI",sans-serif;overflow:hidden}
#bs-root canvas#bs-gl{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
#bs-hud{position:absolute;inset:0;pointer-events:none}
.bs-top{position:absolute;left:14px;right:14px;top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;pointer-events:none}
.bs-pill{pointer-events:auto;background:rgba(35,21,12,.72);border:1px solid rgba(255,220,160,.18);backdrop-filter:blur(6px);color:#f8e9c6;padding:8px 12px;border-radius:999px;font-size:14px;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.bs-title{font-weight:700;letter-spacing:.02em}
.bs-turn b{color:#ffe08a}
.bs-prompt{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:min(92vw,720px);text-align:center}
.bs-actions{position:absolute;right:14px;bottom:14px;display:flex;gap:8px;pointer-events:auto}
.bs-btn{appearance:none;border:1px solid rgba(255,220,160,.22);background:rgba(72,42,20,.8);color:#f8e9c6;padding:9px 13px;border-radius:10px;cursor:pointer;font:600 13px inherit}
.bs-btn:hover{background:rgba(92,54,26,.92)}
.bs-log{position:absolute;left:14px;bottom:14px;width:min(320px,34vw);max-height:34vh;overflow:auto;pointer-events:auto}
.bs-log .bs-pill{display:block;border-radius:14px;padding:10px 12px}
.bs-log h4{margin:0 0 6px;font-size:12px;color:#dcc28a;text-transform:uppercase;letter-spacing:.06em}
.bs-log div{font-size:12px;line-height:1.35;color:#efe3c7;opacity:.95;margin:2px 0}
.bs-over{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(18,10,6,.48);pointer-events:auto}
.bs-over.show{display:flex}
.bs-card{background:linear-gradient(#fbf6ea,#efe1bf);color:#2c1d10;border-radius:16px;padding:22px 24px;min-width:min(92vw,360px);box-shadow:0 18px 50px rgba(0,0,0,.45);text-align:center;border:2px solid rgba(120,70,30,.25)}
.bs-card h3{margin:0 0 6px;font-size:28px}
.bs-card p{margin:0 0 14px;color:#5a4128}
.bs-card .bs-btn{background:#6f4320;color:#fff3d8}
@media (max-width: 800px){.bs-log{display:none}.bs-top{font-size:13px}.bs-pill{padding:7px 10px}}
`;

  function buildDOM() {
    rootStyleEl = document.createElement("style");
    rootStyleEl.textContent = CSS;
    document.head.appendChild(rootStyleEl);
    root = document.createElement("div");
    root.id = "bs-root";
    root.innerHTML = `
      <canvas id="bs-gl"></canvas>
      <div id="bs-hud">
        <div class="bs-top">
          <div class="bs-pill bs-title">Schiffe versenken</div>
          <div class="bs-pill bs-turn" id="bs-turn"></div>
          <div class="bs-pill" id="bs-score"></div>
        </div>
        <div class="bs-pill bs-prompt" id="bs-prompt"></div>
        <div class="bs-log"><div class="bs-pill"><h4>Verlauf</h4><div id="bs-log"></div></div></div>
        <div class="bs-actions">
          <button class="bs-btn" id="bs-reset">Neues Spiel</button>
        </div>
        <div class="bs-over" id="bs-over"><div class="bs-card"><h3 id="bs-over-title"></h3><p id="bs-over-sub"></p><button class="bs-btn" id="bs-again">Nochmal</button></div></div>
      </div>`;
    (env.root || document.getElementById("canvas-wrap") || document.body).appendChild(root);
    glEl = root.querySelector("#bs-gl");
    hudEl = root.querySelector("#bs-hud");
    promptEl = root.querySelector("#bs-prompt");
    turnEl = root.querySelector("#bs-turn");
    logEl = root.querySelector("#bs-log");
    overEl = root.querySelector("#bs-over");
    root.querySelector("#bs-reset").addEventListener("click", () => HUB ? mpReset() : resetGame());
    root.querySelector("#bs-again").addEventListener("click", () => HUB ? mpReset() : resetGame());
    const ro = new ResizeObserver(layout); ro.observe(root); observers.push(ro);
    window.addEventListener("resize", layout);
  }

  function renderLog() {
    if (!logEl) return;
    logEl.innerHTML = G.log.map((l) => `<div>${esc(l)}</div>`).join("") || `<div style="opacity:.6">Klicke auf das rechte Feld, um zu schießen.</div>`;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

  function updateHUD() {
    if (!turnEl) return;
    const me = myIndex();
    const opp = opponentIndex(me);
    if (G.winner != null) {
      turnEl.innerHTML = `<b>${esc(G.players[G.winner].name)} gewinnt!</b>`;
      promptEl.textContent = "Spiel beendet.";
    } else {
      const mine = isMyTurn();
      turnEl.innerHTML = mine ? `<b>Dein Zug</b>` : `Zug: <b>${esc(G.players[G.turn].name)}</b>`;
      promptEl.textContent = mine ? "Wähle ein Feld auf dem gegnerischen Brett (rechts)." : (HUB ? "Warte auf den Gegner…" : "Der Computer zielt…");
    }
    const p = G.players[me], o = G.players[opp];
    const sunkO = o.ships.filter(s=>s.sunk).length, sunkM = p.ships.filter(s=>s.sunk).length;
    root.querySelector("#bs-score").textContent = `Treffer ${p.hits} · Versenkt ${sunkO}/${o.ships.length} · Eigene Verluste ${sunkM}/${p.ships.length}`;
  }

  function showOver() {
    if (!overEl) return;
    const me = myIndex();
    const win = G.winner === me;
    root.querySelector("#bs-over-title").textContent = win ? "Sieg!" : "Niederlage";
    root.querySelector("#bs-over-sub").textContent = `${G.players[G.winner].name} hat alle Schiffe versenkt.`;
    overEl.classList.add("show");
  }
  function hideOver() { if (overEl) overEl.classList.remove("show"); }

  // ============================================================ layout & loop
  function layout() {
    if (!renderer || !camera || !root) return;
    const w = Math.max(1, root.clientWidth || window.innerWidth);
    const h = Math.max(1, root.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera(w, h);
  }

  function fitCamera(w, h) {
    // Frame both boards from above-front
    const aspect = w / h;
    const spanX = boardSize * 2 + boardSep + 3.5;
    const spanZ = boardSize + 4.5;
    const target = new THREE.Vector3(0, 0, 0.3);
    const dist = Math.max(spanX / (2 * Math.tan((camera.fov * Math.PI / 180) / 2) * aspect), spanZ / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))) * 1.18;
    camera.position.set(0, dist * 0.95, dist * 0.78);
    camera.lookAt(target);
  }

  let lastT = 0;
  function loop(ts) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, lastT ? (ts - lastT) / 1000 : 0.016);
    lastT = ts;
    // animations
    for (let i = animations.length - 1; i >= 0; i--) {
      const a = animations[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      try { a.update(k); } catch {}
      if (k >= 1) { animations.splice(i, 1); try { a.done && a.done(); } catch {} }
    }
    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vel.y -= 3.2 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.opacity = Math.max(0, p.life / (p.maxLife || 1));
      if (p.life <= 0 || p.mesh.position.y < TABLE_Y + 0.02) {
        scene.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
    // gentle hover pulse
    for (const b of boards3D) if (b && b.hover.material.opacity > 0.01) b.hover.material.opacity = 0.28 + Math.sin(ts * 0.006) * 0.1;
    renderer.render(scene, camera);
  }

  // ============================================================ input & lifecycle
  function bindInput() {
    onKeyDown = (e) => {
      if (destroyed) return;
      if (e.key === "n" || e.key === "N") { HUB ? mpReset() : resetGame(); }
      if (e.key === "Escape") setHover(null);
    };
    window.addEventListener("keydown", onKeyDown);
  }

  function start() {
    buildDOM();
    bindInput();
    resetGame(true);
    updateHUD();
    renderLog();
    // load three.js then init
    (async () => {
      try {
        if (!window.THREE) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js");
        if (destroyed) return;
        init3D();
        syncAll3D();
        layout();
        raf = requestAnimationFrame(loop);
      } catch (e) {
        console.error(e);
        if (promptEl) promptEl.textContent = "3D konnte nicht geladen werden (Three.js).";
      }
    })();
    if (HUB) {
      NET.onMessage("bs", ({ data }) => onNet(data));
      NET.onEvent("join", () => { if (NET.isHost) mpSend({ t: "state", state: serializeState() }); });
      NET.onEvent("leave", () => updateHUD());
    }
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf);
    if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", layout);
    try { observers.forEach((o) => o.disconnect()); } catch {}
    try { if (renderer) renderer.dispose(); } catch {}
    try { rootStyleEl?.remove(); } catch {}
    try { root?.remove(); } catch {}
  }

  start();
  return { destroy, reset: () => (HUB ? mpReset() : resetGame()), getState: () => serializeState() };
};

// Standalone shell integration (fullscreen, own UI/3D like kniffel)
if (!HUB && typeof initGame === "function") {
  initGame({
    title: "Battleship",
    tag: "2-player naval combat",
    fullscreen: true,
    presets: [{ label: "Standard", values: [0] }],
    buttons: [],
    sliders: [],
    onPreset: () => {},
    onSlider: () => {},
    onClamp: () => {},
    getSliderValues: () => ({}),
    info: {
      title: "So wird gespielt",
      text: [
        "Links liegt dein Feld, rechts das gegnerische. Klicke im Zug auf ein Feld rechts, um dorthin zu schießen.",
        "Treffer werden rot markiert, Wasser gelb/weiß. Ein Schiff gilt als versenkt, wenn alle seine Felder getroffen wurden.",
        "Wer zuerst alle gegnerischen Schiffe versenkt, gewinnt. Taste <b>N</b> startet ein neues Spiel.",
      ],
    },
  });
}

if (!window.__BATTLESHIP_HUB__) window.createBattleship();
