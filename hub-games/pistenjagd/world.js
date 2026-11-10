// Pistenjagd — die 3D-Welt (Three.js r128 aus vendor/three.min.js, global THREE), alles low poly:
// Schneehang als Höhenfeld, Fangnetze, Tannenwald, Hindernisse, Schanzen, Start- und Zieltor, Berge, Schneefall,
// Pulverschnee und die Fahrer (Ski oder Snowboard).
// Akzentfarben (Netze, Tore, Schanzenkante, Fahrer, Himmel) kommen aus der Design-Palette PAL; der Schnee bleibt hell.

import { PRE, POST, NET, centerX, halfW, terrain, rampAt, rng } from "./course.js";

let threeP = null;
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (threeP) return threeP;
  threeP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/three.min.js", document.baseURI).href;
    s.onload = () => res(window.THREE);
    s.onerror = () => { threeP = null; rej(new Error("three.min.js konnte nicht geladen werden")); };
    document.head.appendChild(s);
  });
  return threeP;
}

// ---------- Farben ----------

const RIDER_KEYS = ["rose", "sky", "sun", "mint", "lilac", "peach"];
const RIDER_FALLBACK = [0xe8383d, 0x2f7df6, 0xffc21a, 0x2fc26b, 0xa35cf0, 0xff7a1a];
const rgbHex = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
const mixHex = (a, b, t) => {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t, g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t, bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
export function palette() {
  const P = typeof PAL !== "undefined" ? PAL : null;
  const h = (k, d) => (P && Array.isArray(P[k]) ? rgbHex(P[k]) : d);
  const bg = h("bg", 0x161a2e);
  return {
    sky: mixHex(bg, 0xa8c8ee, 0.6), skyTop: mixHex(bg, 0x6f9fdc, 0.45),
    accent: h("rose", 0xe8383d), accent2: h("sky", 0x2f7df6), sun: h("sun", 0xffc21a), lilac: h("lilac", 0x9b7bff),
    riders: RIDER_KEYS.map((k, i) => h(k, RIDER_FALLBACK[i])),
  };
}
export const cssHex = (n) => "#" + n.toString(16).padStart(6, "0");

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SNOW = 0xf4f8fe, SNOW2 = 0xe9f0fa, OFF = 0xe1eaf6, OFF2 = 0xd6e2f1;

// ---------- Helfer ----------

function mtx(T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
}
function merged(T, parts) {
  const pos = [], col = [], c = new T.Color();
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (p.m) g.applyMatrix4(p.m);
    const a = g.attributes.position.array;
    c.setHex(p.c);
    for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); col.push(c.r, c.g, c.b); }
    g.dispose(); p.g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  out.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
function canvasTex(T, w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c); t.anisotropy = 4;
  t.redraw = () => { draw(c.getContext("2d"), w, h); t.needsUpdate = true; };
  return t;
}

// ---------- Gelände ----------

const OUTER = [0.8, 2, NET, NET + 1.5, 6, 10, 15, 22, 31, 43, 58, 78, 105, 140, 185, 240, 310, 400, 520, 680];
function buildTerrain(T, c, scene) {
  const inner = []; for (let i = -6; i <= 6; i++) inner.push(i / 6);
  const cols = [];                                        // [u (Bruchteil von hw) | null, extra Meter außen]
  for (let i = OUTER.length - 1; i >= 0; i--) cols.push([-1, OUTER[i]]);
  for (const u of inner) cols.push([u, 0]);
  for (const o of OUTER) cols.push([1, o]);
  const z0 = -PRE - 260, z1 = c.L + POST + 700, step = 3, rows = Math.ceil((z1 - z0) / step) + 1, nc = cols.length;
  const pos = new Float32Array(rows * nc * 3), col = new Float32Array(rows * nc * 3), idx = [];
  const C = new T.Color(), R = rng(c.seed ^ 0x77);
  const cA = new T.Color(SNOW), cB = new T.Color(SNOW2), cO = new T.Color(OFF), cO2 = new T.Color(OFF2);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step, cx = centerX(c, z), hw = halfW(c, z);
    for (let k = 0; k < nc; k++) {
      const [u, o] = cols[k], d = u * hw + Math.sign(u) * o, x = cx + d;
      let y = terrain(c, x, z);
      if (o > NET + 1) y += Math.sin(x * 0.11 + z * 0.07) * 0.6 * Math.min(1, (o - NET) / 10) + (R() - 0.5) * 0.5 + (o > 150 ? Math.sin(x * 0.013 + z * 0.009) * Math.min(25, (o - 150) * 0.1) : 0);
      const i = (r * nc + k) * 3;
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      if (o === 0) C.copy(Math.floor(r / 1) % 2 ? cA : cB);           // präparierte Piste mit Rillen
      else if (o <= NET) C.copy(cB).lerp(cO, o / NET);
      else C.copy(cO).lerp(cO2, Math.min(1, (o - NET) / 50));
      col[i] = C.r; col[i + 1] = C.g; col[i + 2] = C.b;
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < nc - 1; k++) {
    const a = r * nc + k, b = a + 1, d = a + nc, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3));
  g.setAttribute("color", new T.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
  scene.add(m);
}

// Schanzen: Kicker aus Schnee mit farbiger Kante und zwei Fähnchen
function buildRamps(T, c, scene, mats) {
  const parts = [], lips = [];
  for (const p of c.ramps) {
    const nu = 10, nl = 6, pos = [], idx = [], col = [];
    const w2 = p.w / 2 + 0.8;
    for (let i = 0; i <= nu; i++) {
      const z = p.z + (p.len * i) / nu, cx = centerX(c, z);
      for (let j = 0; j <= nl; j++) {
        const lat = p.lat - w2 + (2 * w2 * j) / nl, x = cx + lat;
        pos.push(x, terrain(c, x, z) + rampAt(c, x, Math.min(z, p.z + p.len - 0.001)) + 0.03, z);
        const t = i / nu; col.push(0.93 - t * 0.06, 0.96 - t * 0.05, 1);
      }
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nl; j++) { const a = i * (nl + 1) + j, b = a + 1, d = a + nl + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    // Vorderkante: senkrecht vom Kicker hinunter
    const base = pos.length / 3, zl = p.z + p.len - 0.001, cxl = centerX(c, zl);
    for (let j = 0; j <= nl; j++) {
      const lat = p.lat - w2 + (2 * w2 * j) / nl, x = cxl + lat;
      pos.push(x, terrain(c, x, zl) + rampAt(c, x, zl) + 0.03, zl, x, terrain(c, x, zl) - 0.05, zl);
      col.push(0.82, 0.88, 0.96, 0.82, 0.88, 0.96);
    }
    for (let j = 0; j < nl; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
    // Kante und Fähnchen
    const yl = terrain(c, cxl + p.lat, zl) + p.h;
    lips.push(mtx(T, cxl + p.lat, yl + 0.04, zl - 0.12, 0, Math.atan((centerX(c, zl + 1) - centerX(c, zl - 1)) / 2), 0, 1, 1, 1));
    for (const s of [-1, 1]) {
      const fx = cxl + p.lat + s * (p.w / 2 + 1.4), fy = terrain(c, fx, p.z + p.len * 0.6);
      mats.flags.push({ x: fx, y: fy, z: p.z + p.len * 0.6 });
    }
  }
  const snowMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const g of parts) scene.add(new T.Mesh(g, snowMat));
  if (lips.length) {
    const lip = new T.InstancedMesh(new T.BoxGeometry(c.ramps[0].w + 1.4, 0.14, 0.3), mats.sun, lips.length);
    lips.forEach((m, i) => lip.setMatrixAt(i, m));
    scene.add(lip);
  }
}

// Fangnetze links und rechts, mit Pfosten
function buildNets(T, c, scene, mats) {
  const posts = [];
  for (const side of [-1, 1]) {
    const pos = [], idx = [];
    const z0 = -PRE + 4, z1 = c.L + POST - 20;
    let n = 0;
    for (let z = z0; z <= z1; z += 4) {
      const x = centerX(c, z) + side * (halfW(c, z) + NET), y = terrain(c, x, z);
      pos.push(x, y + 0.1, z, x, y + 1.35, z);
      if (n) { const a = (n - 1) * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      n++;
      if (Math.round(z) % 12 === 0) posts.push(mtx(T, x, y + 0.75, z));
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new T.Mesh(g, mats.net));
  }
  const pm = new T.InstancedMesh(new T.BoxGeometry(0.12, 1.5, 0.12), new T.MeshLambertMaterial({ color: 0x3a3f4f }), posts.length);
  posts.forEach((m, i) => pm.setMatrixAt(i, m));
  scene.add(pm);
}

function farTreeGeom(T) {
  return merged(T, [
    { g: new T.CylinderGeometry(0.25, 0.3, 1.2, 4), c: 0x5b3b26, m: mtx(T, 0, 0.6, 0) },
    { g: new T.ConeGeometry(1.8, 3.4, 5), c: 0x22664a, m: mtx(T, 0, 2.6, 0) },
    { g: new T.ConeGeometry(1.15, 2.6, 5), c: 0x2a7652, m: mtx(T, 0, 4.2, 0) },
    { g: new T.ConeGeometry(0.55, 0.7, 5), c: 0xf2f6fc, m: mtx(T, 0, 5.2, 0) },
  ]);
}

function treeGeom(T, big) {
  const cone = (r, h) => new T.ConeGeometry(r, h, big ? 7 : 6);
  return merged(T, [
    { g: new T.CylinderGeometry(0.22, 0.3, 1.4, 5), c: 0x5b3b26, m: mtx(T, 0, 0.7, 0) },
    { g: cone(1.9, 2.6), c: 0x1f5e3c, m: mtx(T, 0, 2.2, 0) },
    { g: cone(1.45, 2.2), c: 0x26704a, m: mtx(T, 0, 3.4, 0) },
    { g: cone(0.95, 1.8), c: 0x2c7d52, m: mtx(T, 0, 4.5, 0) },
    { g: cone(0.62, 0.7), c: 0xf2f6fc, m: mtx(T, 0, 5.15, 0) },
    { g: cone(1.5, 0.5), c: 0xf2f6fc, m: mtx(T, 0, 3.15, 0) },
  ]);
}
function rockGeom(T) {
  return merged(T, [
    { g: new T.DodecahedronGeometry(1.25, 0), c: 0x6d7282, m: mtx(T, 0, 0.45, 0, 0.3, 0.2, 0, 1.15, 0.75, 1) },
    { g: new T.DodecahedronGeometry(0.75, 0), c: 0x7b8091, m: mtx(T, 0.7, 0.3, 0.5, 0.5, 0, 0.3) },
    { g: new T.DodecahedronGeometry(0.95, 0), c: 0xf2f6fc, m: mtx(T, -0.1, 0.95, 0, 0, 0.5, 0, 1.1, 0.35, 0.9) },
  ]);
}
function snowmanGeom(T) {
  return merged(T, [
    { g: new T.IcosahedronGeometry(0.8, 1), c: 0xf7faff, m: mtx(T, 0, 0.7, 0) },
    { g: new T.IcosahedronGeometry(0.58, 1), c: 0xf7faff, m: mtx(T, 0, 1.7, 0) },
    { g: new T.IcosahedronGeometry(0.4, 1), c: 0xf7faff, m: mtx(T, 0, 2.45, 0) },
    { g: new T.ConeGeometry(0.08, 0.45, 5), c: 0xff7a1a, m: mtx(T, 0, 2.45, -0.55, -Math.PI / 2, 0, 0) },
    { g: new T.BoxGeometry(0.08, 0.08, 0.05), c: 0x1a1a22, m: mtx(T, -0.14, 2.58, -0.36) },
    { g: new T.BoxGeometry(0.08, 0.08, 0.05), c: 0x1a1a22, m: mtx(T, 0.14, 2.58, -0.36) },
    { g: new T.CylinderGeometry(0.3, 0.3, 0.42, 8), c: 0x22252e, m: mtx(T, 0, 2.95, 0) },
    { g: new T.CylinderGeometry(0.46, 0.46, 0.05, 8), c: 0x22252e, m: mtx(T, 0, 2.76, 0) },
    { g: new T.TorusGeometry(0.42, 0.09, 4, 10), c: 0xd8343c, m: mtx(T, 0, 2.12, 0, Math.PI / 2, 0, 0) },
    { g: new T.CylinderGeometry(0.03, 0.03, 1.2, 4), c: 0x5b3b26, m: mtx(T, 0.75, 1.85, 0, 0, 0, -1.0) },
    { g: new T.CylinderGeometry(0.03, 0.03, 1.2, 4), c: 0x5b3b26, m: mtx(T, -0.75, 1.85, 0, 0, 0, 1.0) },
  ]);
}

function instances(T, scene, geo, mat, list) {
  if (!list.length) return;
  const im = new T.InstancedMesh(geo, mat, list.length), d = new T.Object3D();
  list.forEach((p, i) => { d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry || 0, 0); d.scale.setScalar(p.s || 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.instanceMatrix.needsUpdate = true;
  scene.add(im);
}

function buildProps(T, c, scene, low) {
  const vc = new T.MeshLambertMaterial({ vertexColors: true });
  const R = rng(c.seed ^ 0xabcdef);
  // Hindernisse auf der Piste
  const by = { tree: [], rock: [], snowman: [] };
  for (const o of c.obstacles) by[o.kind].push({ x: o.x, y: terrain(c, o.x, o.z) - 0.1, z: o.z, ry: o.rot, s: o.kind === "tree" ? 0.75 * o.s : o.s });
  instances(T, scene, treeGeom(T, true), vc, by.tree);
  instances(T, scene, rockGeom(T), vc, by.rock);
  instances(T, scene, snowmanGeom(T), vc, by.snowman.map((p) => ({ ...p, ry: (p.ry - 3) * 0.2 })));
  // Wald neben der Piste
  const forest = [], dens = 0.7 + c.spec.trees * 0.6, stepZ = (low ? 7 : 4.6) / dens;
  for (let z = -PRE - 60; z < c.L + POST + 520; z += stepZ) {
    for (const side of [-1, 1]) {
      const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const off = NET + 2.5 + Math.pow(R(), 1.6) * 75;
        const zz = z + R() * stepZ, x = centerX(c, zz) + side * (halfW(c, zz) + off);
        forest.push({ x, y: terrain(c, x, zz) - 0.2, z: zz, ry: R() * 6.28, s: 0.8 + R() * 0.9 });
      }
    }
  }
  instances(T, scene, treeGeom(T, false), vc, forest);

  // Baumgruppen im ganzen Tal bis zu den Bergen und hinter dem Ziel (einfacheres Modell, die stehen weit weg)
  const far = [], end = c.L + POST;
  const grove = (gx, gz, n, rad) => {
    for (let k = 0; k < n; k++) {
      const a = R() * 6.283, r = Math.sqrt(R()) * rad, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r;
      far.push({ x, y: terrain(c, x, clamp(z, -PRE, end)) - 0.3, z, ry: R() * 6.28, s: 0.9 + R() * 1.1 });
    }
  };
  for (let z = -260; z < end + 760; z += low ? 46 : 30) {
    for (const side of [-1, 1]) {
      const off = 85 + R() * 560, zc = clamp(z, -PRE, end);
      grove(centerX(c, zc) + side * (halfW(c, zc) + off), z + R() * 20, (low ? 4 : 7) + Math.floor(R() * 6), 14 + R() * 18);
    }
  }
  // hinter dem Auslauf: der Blick vom Ziel geht geradeaus ins Tal, dort fehlte bisher alles
  for (let z = end + 40; z < end + 760; z += low ? 40 : 26) {
    for (let k = 0; k < (low ? 2 : 4); k++) {
      const x = centerX(c, end) + (R() * 2 - 1) * 520;
      if (Math.abs(x - centerX(c, end)) < 30 && z < end + 160) continue;   // Auslauf bleibt frei
      grove(x, z, 5 + Math.floor(R() * 6), 12 + R() * 14);
    }
  }
  instances(T, scene, farTreeGeom(T), vc, far);

  // verschneite Vorberge im Tal (mit Nebel, damit sie in die Ferne übergehen)
  const hillMat = new T.MeshLambertMaterial({ color: 0xe9f0fa });
  const R4 = rng(c.seed ^ 0x4111);
  const foothill = (x, z, h, w) => {
    const m = new T.Mesh(new T.ConeGeometry(w, h, 7), hillMat);
    m.position.set(x, terrain(c, x, clamp(z, -PRE, end)) + h / 2 - 6, z); m.rotation.y = R4() * 3; m.scale.z = 0.7 + R4() * 0.6;
    scene.add(m);
    grove(x + (R4() - 0.5) * w * 0.6, z + (R4() - 0.5) * w * 0.4, 6, w * 0.35);
  };
  for (let z = -200; z < end + 700; z += 170 + R4() * 80) for (const side of [-1, 1]) {
    const zc = clamp(z, -PRE, end);
    foothill(centerX(c, zc) + side * (halfW(c, zc) + 260 + R4() * 340), z, 35 + R4() * 60, 90 + R4() * 90);
  }
  for (let i = -3; i <= 3; i++) foothill(centerX(c, end) + i * 170 + (R4() - 0.5) * 60, end + 520 + R4() * 220, 40 + R4() * 60, 100 + R4() * 80);
  instances(T, scene, farTreeGeom(T), vc, far.splice(0));

  // ferne Berge links, rechts und hinter dem Ziel (ohne Nebel)
  const farMat = new T.MeshLambertMaterial({ color: 0x8d9fbd, fog: false });
  const capMat = new T.MeshLambertMaterial({ color: 0xf6f9ff, fog: false });
  const R3 = rng(c.seed ^ 0x5151);
  const mount = (x, z, base) => {
    const h = 160 + R3() * 220, w = 140 + R3() * 140, seg = 5 + Math.floor(R3() * 3);
    const m = new T.Mesh(new T.ConeGeometry(w, h, seg), farMat); m.position.set(x, base + h / 2 - 20, z); m.rotation.y = R3() * 3; scene.add(m);
    const cap = new T.Mesh(new T.ConeGeometry(w * 0.36, h * 0.34, seg), capMat); cap.position.set(x, base + h - h * 0.17 - 20, z); cap.rotation.y = m.rotation.y; scene.add(cap);
  };
  // Bergkette am Rand des Tals (Fuß etwas unter dem Talhang) und hinter dem Ziel
  const hill = (x, z) => terrain(c, x, clamp(z, -PRE, c.L + POST)) - 15;
  for (let z = -300; z < c.L + 1100; z += 210) for (const s of [-1, 1]) { const x = centerX(c, clamp(z, 0, c.L)) + s * (720 + R3() * 260); mount(x, z, hill(x, z)); }
  for (let i = -4; i <= 4; i++) { const x = i * 240 + R3() * 80, z = c.L + 950 + R3() * 250; mount(x, z, hill(x, z)); }
}

// Start- und Zieltor
function buildGates(T, c, scene, mats) {
  const banners = [];
  const gate = (z, label) => {
    const cx = centerX(c, z), hw = halfW(c, z) + 1, y = terrain(c, cx, z);
    const g = new T.Group(); g.position.set(cx, y, z);
    for (const s of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.7, 7, 0.7), mats.accent);
      post.position.set(s * hw, 3.5 + (terrain(c, cx + s * hw, z) - y), 0); g.add(post);
    }
    const tex = canvasTex(T, 1024, 128, (x, w, h) => {
      const p = palette();
      x.fillStyle = cssHex(p.accent); x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(255,255,255,.18)"; for (let i = 0; i < w; i += 64) x.fillRect(i, 0, 32, h);
      x.fillStyle = "#fff"; x.font = "900 italic 86px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, w / 2, h / 2 + 4);
    });
    banners.push(tex);
    const b = new T.Mesh(new T.BoxGeometry(hw * 2 + 0.7, 1.8, 0.35), new T.MeshBasicMaterial({ map: tex }));
    b.position.set(0, 7, 0); g.add(b);
    scene.add(g);
  };
  gate(0, "START");
  gate(c.L, "ZIEL");
  // Ziellinie (Schachbrett) auf dem Schnee
  const cols = 24, pos = [], col = [], idx = [];
  let v = 0;
  for (let r = 0; r < 2; r++) for (let k = 0; k < cols; k++) {
    const z0 = c.L - 0.9 + r * 0.9, z1 = z0 + 0.9;
    const hw0 = halfW(c, c.L), dl0 = -hw0 + (2 * hw0 * k) / cols, dl1 = dl0 + (2 * hw0) / cols;
    const black = (r + k) % 2 === 0;
    for (const [z, dl] of [[z0, dl0], [z0, dl1], [z1, dl0], [z1, dl1]]) { const x = centerX(c, z) + dl; pos.push(x, terrain(c, x, z) + 0.04, z); col.push(black ? 0.1 : 1, black ? 0.1 : 1, black ? 0.12 : 1); }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); v += 4;
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  return banners;
}

// Fähnchen an den Schanzen
function buildFlags(T, scene, mats) {
  if (!mats.flags.length) return;
  const pole = new T.InstancedMesh(new T.CylinderGeometry(0.05, 0.05, 2.2, 4), new T.MeshLambertMaterial({ color: 0x3a3f4f }), mats.flags.length);
  const flag = new T.InstancedMesh(new T.BoxGeometry(0.05, 0.5, 0.8), mats.sun, mats.flags.length);
  const d = new T.Object3D();
  mats.flags.forEach((f, i) => {
    d.position.set(f.x, f.y + 1.1, f.z); d.updateMatrix(); pole.setMatrixAt(i, d.matrix);
    d.position.set(f.x, f.y + 1.95, f.z + 0.4); d.updateMatrix(); flag.setMatrixAt(i, d.matrix);
  });
  scene.add(pole, flag);
}

// ---------- Fahrer ----------

function labelSprite(T, name, color) {
  const tex = canvasTex(T, 256, 64, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.font = "800 30px system-ui, sans-serif"; const tw = Math.min(w - 8, x.measureText(name).width + 28);
    x.fillStyle = "rgba(10,14,30,.7)"; x.beginPath(); x.roundRect ? x.roundRect((w - tw) / 2, 8, tw, 46, 23) : x.rect((w - tw) / 2, 8, tw, 46); x.fill();
    x.fillStyle = cssHex(color.value); x.beginPath(); x.arc((w - tw) / 2 + 18, 31, 7, 0, 7); x.fill();
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(name, w / 2 + 8, 32, tw - 34);
  });
  const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.6, 0.65, 1); sp.position.y = 2.6; sp.renderOrder = 5;
  sp.userData.tex = tex;
  return sp;
}

export function makeRider(T, color, gear, name, opts = {}) {
  const root = new T.Group(), spin = new T.Group(), body = new T.Group(), stance = new T.Group();
  root.add(spin); spin.add(body); body.add(stance);
  const jacket = new T.MeshLambertMaterial({ color });
  const helmet = new T.MeshLambertMaterial({ color });
  const dark = new T.MeshLambertMaterial({ color: 0x23262f });
  const pants = new T.MeshLambertMaterial({ color: 0x2e3445 });
  const skin = new T.MeshLambertMaterial({ color: 0xf1c59a });
  const goggle = new T.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x553300 });
  const gearMat = new T.MeshLambertMaterial({ color: 0xffffff });
  const add = (g, m, x, y, z, rx = 0, ry = 0, rz = 0, par = stance) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); par.add(o); return o; };
  const board = gear === "board";
  // Sportgerät
  if (board) {
    add(new T.BoxGeometry(0.34, 0.06, 1.62), gearMat, 0, 0.05, 0, 0, 0, 0, body);
    add(new T.BoxGeometry(0.36, 0.03, 0.4), jacket, 0, 0.09, 0.55, 0, 0, 0, body);
    add(new T.BoxGeometry(0.36, 0.03, 0.4), jacket, 0, 0.09, -0.55, 0, 0, 0, body);
    stance.rotation.y = Math.PI / 2 * 0.85;            // seitlich auf dem Brett
  } else {
    for (const s of [-1, 1]) {
      add(new T.BoxGeometry(0.11, 0.05, 1.75), gearMat, s * 0.17, 0.04, 0.12, 0, 0, 0, body);
      add(new T.BoxGeometry(0.11, 0.04, 0.22), gearMat, s * 0.17, 0.08, 1.0, -0.4, 0, 0, body);
    }
  }
  // Beine, Körper, Kopf
  const legs = [];
  for (const s of [-1, 1]) {
    // Hüfte oben, Fuß unten: in der Hocke wird das Bein kürzer, der Fuß bleibt auf Brett bzw. Ski
    const leg = new T.Group(); leg.position.set(s * (board ? 0.24 : 0.17), 0.95, 0); stance.add(leg);
    if (board) leg.rotation.z = s * 0.2;               // breiter Stand: Füße auf den Bindungen
    add(new T.BoxGeometry(0.17, 0.9, 0.2), pants, 0, -0.45, 0, 0, 0, 0, leg);
    add(new T.BoxGeometry(0.2, 0.22, 0.32), dark, 0, -0.85, 0.04, 0, 0, 0, leg);
    legs.push(leg);
  }
  const torso = new T.Group(); torso.position.y = 0.95; stance.add(torso);
  add(new T.BoxGeometry(0.52, 0.66, 0.32), jacket, 0, 0.33, 0, 0, 0, 0, torso);
  add(new T.BoxGeometry(0.54, 0.08, 0.34), dark, 0, 0.02, 0, 0, 0, 0, torso);
  add(new T.IcosahedronGeometry(0.2, 1), skin, 0, 0.86, 0, 0, 0, 0, torso);
  add(new T.SphereGeometry(0.225, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet, 0, 0.9, 0, 0, 0, 0, torso);
  add(new T.BoxGeometry(0.34, 0.1, 0.1), goggle, 0, 0.88, 0.17, 0, 0, 0, torso);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new T.Group(); arm.position.set(s * 0.33, 0.6, 0); torso.add(arm);
    add(new T.BoxGeometry(0.14, 0.55, 0.15), jacket, 0, -0.26, 0, 0, 0, 0, arm);
    add(new T.BoxGeometry(0.14, 0.13, 0.15), dark, 0, -0.56, 0, 0, 0, 0, arm);
    if (!board) add(new T.CylinderGeometry(0.02, 0.02, 1.1, 4), dark, 0, -0.7, -0.35, -0.65, 0, 0, arm);
    arms.push(arm);
  }
  // Schatten
  const shadow = new T.Mesh(new T.CircleGeometry(0.55, 14), new T.MeshBasicMaterial({ color: 0x24324a, transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; root.add(shadow);
  const colorRef = { value: color };
  let label = null;
  if (!opts.local && name) { label = labelSprite(T, name, colorRef); root.add(label); }
  const mats = [jacket, helmet, dark, pants, skin, goggle, gearMat];
  let starOn = false;

  return {
    root,
    // s: { x, y, z, yaw, spin, steer, tuck, crash (0..1), tumble, inv, t, gy (Bodenhöhe), air }
    set(s) {
      root.position.set(s.x, s.y, s.z);
      root.rotation.y = s.yaw;
      spin.rotation.y = s.spin || 0;
      // in die Kurve legen: nur über die Kante (Längsachse der Fahrt), nie vor/zurück
      const lean = s.air ? 0 : (s.steer || 0) * (board ? 0.22 : 0.26);
      const tuck = s.tuck || 0, hip = 0.95 - tuck * 0.24;
      body.rotation.z = lean;
      body.rotation.x = 0;
      torso.rotation.x = board ? 0.15 + tuck * 0.35 : 0.25 + tuck * 0.6;
      torso.position.y = hip;
      for (const [i, l] of legs.entries()) {
        l.position.y = hip; l.scale.y = hip / 0.95;
        l.rotation.x = board ? 0 : (s.air ? (i ? 0.2 : -0.1) : 0);
      }
      arms.forEach((a, i) => { a.rotation.x = board ? -0.2 : -0.3 - tuck * 0.9; a.rotation.z = (i ? -1 : 1) * (board ? 0.7 + Math.sin(s.t * 3 + i) * 0.05 : 0.25 + tuck * 0.1); });
      if (s.crash > 0) {
        // Purzelbaum, dann liegen bleiben und aufstehen
        const k = s.tumble || 0, roll = Math.min(1, k / 0.8);
        body.rotation.x = roll * Math.PI * 2 * 1.05 + (k > 0.8 ? 1.25 * Math.min(1, (1.3 - k) / 0.5) : 0);
        body.rotation.z = Math.sin(k * 9) * 0.3 * (1 - roll);
      }
      if (s.star) { const h = (s.t * 1.5) % 1; jacket.emissive.setHSL(h, 1, 0.35); helmet.emissive.setHSL((h + 0.5) % 1, 1, 0.35); body.scale.setScalar(1.25); }
      else if (starOn) { jacket.emissive.setHex(0); helmet.emissive.setHex(0); body.scale.setScalar(1); }
      starOn = !!s.star;
      root.visible = !(s.inv > 0 && Math.floor(s.t * 14) % 2 === 0);
      shadow.position.y = (s.gy ?? s.y) - s.y + 0.06;
      const hgt = s.y - (s.gy ?? s.y);
      shadow.scale.setScalar(Math.max(0.35, 1 - hgt * 0.08));
      shadow.material.opacity = Math.max(0.08, 0.26 - hgt * 0.02);
      if (label) label.position.y = 2.6 + (s.air ? 0.3 : 0);
    },
    setColor(hex) { jacket.color.setHex(hex); helmet.color.setHex(hex); colorRef.value = hex; if (label) label.userData.tex.redraw(); },
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mats.forEach((m) => m.dispose()); shadow.material.dispose(); if (label) { label.material.map.dispose(); label.material.dispose(); } },
  };
}

// ---------- Partikel (Pulverschnee, Turbo-Funken) ----------

function makeParticles(T, scene, cap) {
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), vel = new Float32Array(cap * 3), life = new Float32Array(cap), max = new Float32Array(cap), base = new Float32Array(cap * 3), grav = new Float32Array(cap);
  pos.fill(-9999);
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3));
  g.setAttribute("color", new T.BufferAttribute(col, 3));
  const tex = canvasTex(T, 32, 32, (c) => {
    const gr = c.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.55, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
  });
  const pts = new T.Points(g, new T.PointsMaterial({ size: 0.45, map: tex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, alphaTest: 0.02 }));
  pts.frustumCulled = false;
  scene.add(pts);
  let n = 0;
  const c = new T.Color();
  return {
    emit(x, y, z, vx, vy, vz, l, hex, gr = -9) {
      const i = n; n = (n + 1) % cap;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = max[i] = l; grav[i] = gr;
      c.setHex(hex); base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
    },
    update(dt) {
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] += grav[i] * dt;
        const dr = 1 - 1.6 * dt; vel[i * 3] *= dr; vel[i * 3 + 2] *= dr;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const f = 0.92 + 0.08 * (life[i] / max[i]);       // nicht abdunkeln: graue Flecken auf weißem Schnee
        col[i * 3] = base[i * 3] * f; col[i * 3 + 1] = base[i * 3 + 1] * f; col[i * 3 + 2] = base[i * 3 + 2] * f;
      }
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    },
  };
}

// Schneefall in einer Kiste um die Kamera
function makeSnowfall(T, scene, n) {
  const W = 90, H = 40, pos = new Float32Array(n * 3), sp = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * W; pos[i * 3 + 1] = Math.random() * H; pos[i * 3 + 2] = (Math.random() - 0.5) * W; sp[i] = 1.2 + Math.random() * 1.6; }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3));
  const tex = canvasTex(T, 16, 16, (c) => { const gr = c.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 16, 16); });
  const pts = new T.Points(g, new T.PointsMaterial({ size: 0.28, map: tex, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }));
  pts.frustumCulled = false; scene.add(pts);
  const wrap = (v, lo, span) => lo + ((((v - lo) % span) + span) % span);
  return {
    update(dt, cam, t) {
      for (let i = 0; i < n; i++) {
        pos[i * 3 + 1] -= sp[i] * dt;
        pos[i * 3] += Math.sin(t * 0.8 + i) * 0.4 * dt;
        pos[i * 3] = wrap(pos[i * 3], cam.x - W / 2, W);
        pos[i * 3 + 1] = wrap(pos[i * 3 + 1], cam.y - H * 0.55, H);
        pos[i * 3 + 2] = wrap(pos[i * 3 + 2], cam.z - W / 2, W);
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- Items: Geschenke, Eisplatten, Schneebälle ----------

function makeGift(T, mats) {
  const g = new T.Group();
  const box = new T.Mesh(new T.BoxGeometry(1.25, 1.25, 1.25), mats.gift); g.add(box);
  const r1 = new T.Mesh(new T.BoxGeometry(1.3, 1.3, 0.28), mats.ribbon), r2 = new T.Mesh(new T.BoxGeometry(0.28, 1.3, 1.3), mats.ribbon);
  g.add(r1, r2);
  for (const s of [-1, 1]) { const bow = new T.Mesh(new T.TorusGeometry(0.22, 0.08, 4, 8), mats.ribbon); bow.position.set(s * 0.2, 0.75, 0); bow.rotation.set(0, Math.PI / 2, s * 0.5); g.add(bow); }
  return g;
}
function makeIce(T) {
  const m = new T.Mesh(new T.CircleGeometry(1.35, 9), new T.MeshLambertMaterial({ color: 0x9fd8ff, emissive: 0x1d4b6e, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.rotation.x = -Math.PI / 2;
  const g = new T.Group(); g.add(m);
  const shine = new T.Mesh(new T.CircleGeometry(0.4, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  shine.rotation.x = -Math.PI / 2; shine.position.set(0.45, 0.01, -0.3); g.add(shine);
  return g;
}
function makeSnowball(T) {
  const g = new T.Group();
  g.add(new T.Mesh(new T.IcosahedronGeometry(0.55, 1), new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x223344 })));
  g.userData.spin = true;
  return g;
}

// ---------- Welt ----------

export function createWorld(T, host, c) {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const pal = palette();
  const dpr = window.devicePixelRatio || 1;
  // full resolution by default (capped at 2); Perf.adaptive lowers it only while the frame rate actually suffers
  const maxRatio = window.Perf ? Perf.pixelRatio(2) : Math.min(dpr, 2);
  const renderer = new T.WebGLRenderer({ antialias: !coarse && dpr < 2, powerPreference: "default" });
  renderer.setPixelRatio(maxRatio);
  const adapt = window.Perf ? Perf.adaptive(renderer, { max: maxRatio, min: 0.75 }) : null;
  renderer.domElement.className = "pj-canvas";
  host.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const skyTex = canvasTex(T, 4, 256, (x, w, h) => { const p = palette(), gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, cssHex(p.skyTop)); gr.addColorStop(0.6, cssHex(p.sky)); gr.addColorStop(1, cssHex(mixHex(p.sky, 0xffffff, 0.5))); x.fillStyle = gr; x.fillRect(0, 0, w, h); });
  scene.background = skyTex;
  scene.fog = new T.Fog(pal.sky, 140, 900);
  scene.add(new T.HemisphereLight(0xeaf2ff, 0x8a9cb8, 0.58));
  const sun = new T.DirectionalLight(0xfff4e0, 0.95); sun.position.set(-120, 90, -40); scene.add(sun);

  const camera = new T.PerspectiveCamera(64, 1, 0.3, 3000);
  const mats = {
    accent: new T.MeshLambertMaterial({ color: pal.accent }),
    sun: new T.MeshLambertMaterial({ color: pal.sun }),
    net: new T.MeshLambertMaterial({ color: pal.accent, transparent: true, opacity: 0.72, side: T.DoubleSide }),
    gift: new T.MeshLambertMaterial({ color: pal.accent2, emissive: 0x111122 }),
    ribbon: new T.MeshLambertMaterial({ color: pal.sun, emissive: 0x221a00 }),
    flags: [],
  };

  buildTerrain(T, c, scene);
  buildRamps(T, c, scene, mats);
  buildNets(T, c, scene, mats);
  buildFlags(T, scene, mats);
  buildProps(T, c, scene, coarse);
  const banners = buildGates(T, c, scene, mats);

  const boxes = c.boxes.map((b) => {
    const m = makeGift(T, mats), y = terrain(c, b.x, b.z) + 1.1;
    m.position.set(b.x, y, b.z); scene.add(m);
    return { id: b.id, mesh: m, x: b.x, z: b.z, y, active: true, back: 0, pop: 1 };
  });
  const dyn = new Map();            // Eisplatten / Schneebälle: id → { mesh, kind }

  const particles = makeParticles(T, scene, coarse ? 600 : 1100);
  const snow = makeSnowfall(T, scene, coarse ? 600 : 1300);

  const size = () => {
    const w = host.clientWidth || 640, h = host.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();

  return {
    T, scene, camera, renderer, particles, size, coarse, boxes, dyn,
    takeBox(id, secs = 5) { const b = boxes.find((x) => x.id === id); if (b && b.active) { b.active = false; b.back = secs; } return b; },
    resetBoxes() { for (const b of boxes) { b.active = true; b.pop = 1; b.back = 0; } },
    addItem(id, kind, x, y, z) {
      this.removeItem(id);
      const mesh = kind === "ice" ? makeIce(T) : makeSnowball(T);
      mesh.position.set(x, y, z); scene.add(mesh);
      const o = { id, kind, mesh }; dyn.set(id, o); return o;
    },
    removeItem(id) { const o = dyn.get(id); if (o) { scene.remove(o.mesh); o.mesh.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }); dyn.delete(id); } },
    clearItems() { for (const id of [...dyn.keys()]) this.removeItem(id); },
    makeRider: (color, gear, name, o) => { const m = makeRider(T, color, gear, name, o); scene.add(m.root); return m; },
    recolor() {
      const p = palette();
      mats.accent.color.setHex(p.accent); mats.net.color.setHex(p.accent); mats.sun.color.setHex(p.sun); mats.gift.color.setHex(p.accent2); mats.ribbon.color.setHex(p.sun);
      scene.fog.color.setHex(p.sky); skyTex.redraw();
      banners.forEach((b) => b.redraw());
      return p;
    },
    update(dt, t) {
      for (const b of boxes) {
        if (b.active) { b.mesh.visible = true; b.pop = Math.min(1, b.pop + dt * 3); }
        else { b.mesh.visible = b.pop > 0.01; b.pop = Math.max(0, b.pop - dt * 6); if (b.back > 0) { b.back -= dt; if (b.back <= 0) { b.active = true; b.pop = 0; } } }
        b.mesh.rotation.y = t * 1.4 + b.id; b.mesh.position.y = b.y + Math.sin(t * 2.2 + b.id * 0.7) * 0.2;
        b.mesh.scale.setScalar(Math.max(0.001, b.pop));
      }
      for (const o of dyn.values()) if (o.mesh.userData.spin) o.mesh.rotation.x += dt * 9;
      particles.update(dt); snow.update(dt, camera.position, t);
    },
    render(fps) { if (adapt) adapt(performance.now(), fps || 60); renderer.render(scene, camera); },
    dispose() {
      renderer.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); } } });
      skyTex.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      try { renderer.forceContextLoss(); } catch {}
    },
  };
}
