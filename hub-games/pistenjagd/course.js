// Pistenjagd — die Pisten: vier feste Abfahrten + Zufallspiste aus einem Seed. Nur Daten und Mathe, kein DOM.
//
// Koordinaten: z zeigt bergab (z = 0 Start, z = L Ziel), y ist die Höhe, x quer. Die Piste ist eine Mittellinie
// cx(z) mit halber Breite hw(z). Alles auf der Piste steht in (z, d) mit d = x − cx(z): Hindernisse, Schanzen und
// Netze bleiben so auch in Kurven sauber auf der Piste. Alle Clients erzeugen aus demselben Seed dieselbe Piste.

export const PRE = 40;              // Startplateau hinter dem Starttor
export const POST = 170;            // Auslauf hinter dem Ziel
export const NET = 3;               // Fangnetz steht so weit hinter dem Pistenrand

export const SLOPES = [
  { id: "sonnenhang", name: "Sonnenhang", blurb: "Breit und gemütlich – zum Einfahren", seed: 1101, len: 1550, width: 38, curve: 0.55, steep: 0.2, trees: 0.45, rocks: 0.2, snowmen: 0.5, ramps: 7, kick: 1.7 },
  { id: "tannen", name: "Tannenschneise", blurb: "Schmal und kurvig durch den Wald", seed: 2024, len: 1450, width: 26, curve: 1.0, steep: 0.22, trees: 1.1, rocks: 0.3, snowmen: 0.2, ramps: 6, kick: 1.8 },
  { id: "schanzen", name: "Schanzenpark", blurb: "Eine Schanze nach der anderen", seed: 777, len: 1700, width: 34, curve: 0.5, steep: 0.21, trees: 0.35, rocks: 0.25, snowmen: 0.35, ramps: 15, kick: 2.3 },
  { id: "rinne", name: "Teufelsrinne", blurb: "Steil, eng, voller Felsen", seed: 6660, len: 1550, width: 28, curve: 1.3, steep: 0.29, trees: 0.55, rocks: 0.85, snowmen: 0.15, ramps: 7, kick: 2.0 },
];

export function randomSpec(seed) {
  const r = rng(seed ^ 0x5eed);
  return {
    id: "zufall", name: "Zufallspiste", blurb: "Jedes Mal anders", seed,
    len: 1350 + Math.floor(r() * 350), width: 26 + r() * 12, curve: 0.5 + r() * 0.9, steep: 0.19 + r() * 0.07,
    trees: 0.3 + r() * 0.6, rocks: 0.2 + r() * 0.5, snowmen: 0.1 + r() * 0.3, ramps: 5 + Math.floor(r() * 7), kick: 1.7 + r() * 0.6,
  };
}

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Hindernisse: Radius für die Kollision
export const OBST = { tree: 1.0, rock: 1.25, snowman: 0.8 };

export function buildCourse(spec) {
  const r = rng(spec.seed);
  const L = spec.len, n = L + PRE + POST + 1;           // 1 m Raster
  const CX = new Float32Array(n), Y = new Float32Array(n), HW = new Float32Array(n), ST = new Float32Array(n);

  const waves = [0, 1, 2].map((i) => ({ a: (10 + r() * 14) * spec.curve / (1 + i * 0.6), l: (300 - i * 85) * (0.8 + r() * 0.4), p: r() * 6.283 }));
  const wW = { l: 160 + r() * 90, p: r() * 6.283 }, wS = { l: 190 + r() * 80, p: r() * 6.283 }, wS2 = { l: 70 + r() * 30, p: r() * 6.283 };
  for (let i = 0; i < n; i++) {
    const z = i - PRE;
    const fade = smooth(z / 90) * smooth((L - z) / 110);
    let cx = 0;
    for (const w of waves) cx += w.a * Math.sin((z / w.l) * 6.283 + w.p);
    CX[i] = cx * fade;
    const hw = spec.width / 2 * (1 + 0.16 * Math.sin((z / wW.l) * 6.283 + wW.p));
    HW[i] = z < 30 ? Math.max(hw, 16) : z > L - 30 ? Math.max(hw, 18) : hw;
    // Gefälle: am Start sanft anschieben, im Auslauf leicht bergauf, damit alle zum Stehen kommen
    let st = spec.steep * (1 + 0.42 * Math.sin((z / wS.l) * 6.283 + wS.p) + 0.16 * Math.sin((z / wS2.l) * 6.283 + wS2.p));
    st = Math.max(0.07, st);
    if (z < 0) st = 0.045;
    else if (z < 40) st *= 0.35 + 0.65 * smooth(z / 40);
    if (z > L + 25) st = -0.05 * smooth((z - L - 25) / 40);
    ST[i] = st;
    Y[i] = i ? Y[i - 1] - (ST[i - 1] + st) / 2 : 0;
  }

  const c = { spec, L, n, CX, Y, HW, ST, seed: spec.seed, ramps: [], boxes: [], obstacles: [], buckets: new Map() };

  // Schanzen: gleichmäßig verteilt, etwas versetzt
  const RN = spec.ramps;
  for (let k = 0; k < RN; k++) {
    const z = Math.round(170 + (k + 0.3 + r() * 0.4) * (L - 330) / RN);
    const hw = halfW(c, z);
    c.ramps.push({ z, lat: (r() * 2 - 1) * hw * 0.35, w: 7.5, len: 9, h: spec.kick * (0.9 + r() * 0.25) });
  }

  // Geschenk-Boxen: Reihen quer über die Piste, nicht direkt vor einer Schanze oder in ihrer Landezone
  const nearRamp = (z) => c.ramps.some((p) => z > p.z - 25 && z < p.z + 80);
  for (let z = 130; z < L - 120; z += 190 + r() * 40) {
    let zz = z;
    for (let k = 0; k < 12 && nearRamp(zz); k++) zz += 10;
    if (nearRamp(zz)) continue;
    const hw = halfW(c, zz);
    for (const f of [-0.6, -0.2, 0.2, 0.6]) c.boxes.push({ id: c.boxes.length, z: zz, lat: f * hw });
  }
  for (const b of c.boxes) b.x = centerX(c, b.z) + b.lat;

  // Hindernisse: immer bleibt eine Lücke von mindestens 6 m offen, Schanzen und Landezonen bleiben frei
  const dens = spec.trees + spec.rocks + spec.snowmen;
  const near = [];
  for (let z = 70; z < L - 45; z += (7 + r() * 11) / Math.max(0.35, dens * 0.7)) {
    const hw = halfW(c, z);
    let x = r() * (spec.trees + spec.rocks + spec.snowmen);
    const kind = (x -= spec.trees) < 0 ? "tree" : (x -= spec.rocks) < 0 ? "rock" : "snowman";
    const rad = OBST[kind];
    const lat = (r() * 2 - 1) * (hw - rad - 0.6);
    if (c.ramps.some((p) => z > p.z - 22 && z < p.z + 75 && Math.abs(lat - p.lat) < p.w / 2 + 5)) continue;
    if (c.boxes.some((b) => Math.abs(b.z - z) < 12)) continue;
    const band = near.filter((o) => Math.abs(o.z - z) < 9);
    if (!gapOk([...band, { lat, r: rad }], hw)) continue;
    const o = { kind, z, lat, r: rad, rot: r() * 6.283, s: 0.85 + r() * 0.35 };
    near.push(o); if (near.length > 12) near.shift();
    c.obstacles.push(o);
  }
  for (const o of c.obstacles) {
    o.x = centerX(c, o.z) + o.lat;
    const b = Math.floor(o.z / 10);
    if (!c.buckets.has(b)) c.buckets.set(b, []);
    c.buckets.get(b).push(o);
  }
  return c;
}

function gapOk(list, hw) {
  const iv = list.map((o) => [o.lat - o.r - 0.9, o.lat + o.r + 0.9]).sort((a, b) => a[0] - b[0]);
  let edge = -hw, best = 0;
  for (const [a, b] of iv) { best = Math.max(best, a - edge); edge = Math.max(edge, b); }
  best = Math.max(best, hw - edge);
  return best >= 6;
}

const sample = (arr, c, z) => {
  const f = clamp(z + PRE, 0, c.n - 1.001), i = Math.floor(f), t = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
};
export const centerX = (c, z) => sample(c.CX, c, z);
export const halfW = (c, z) => sample(c.HW, c, z);
export const baseY = (c, z) => sample(c.Y, c, z);
export const slopeAt = (c, z) => sample(c.ST, c, z);
// Richtung der Piste (Winkel zur Falllinie)
export const dirAt = (c, z) => Math.atan((centerX(c, z + 1.5) - centerX(c, z - 1.5)) / 3);

// Querprofil: die Piste ist eine flache Mulde, dahinter steigt der Hang an
function bank(d, hw) {
  const a = Math.abs(d);
  if (a < hw) return 0.0016 * a * a;
  const o = a - hw, base = 0.0016 * hw * hw;
  // kurze Böschung am Rand, dahinter ein flacher Talhang, der bis zum Horizont reicht
  if (o < 8) return base + o * 0.45;
  return base + 3.6 + 40 * (1 - Math.exp(-(o - 8) / 200));
}

export function rampAt(c, x, z) {
  for (const p of c.ramps) {
    const u = z - p.z;
    if (u < 0 || u > p.len) continue;
    const dd = Math.abs(x - centerX(c, z) - p.lat);
    const side = clamp((p.w / 2 + 0.8 - dd) / 0.8, 0, 1);
    if (side <= 0) continue;
    return p.h * Math.pow(u / p.len, 1.6) * side;
  }
  return 0;
}

export function ground(c, x, z) {
  return baseY(c, z) + bank(x - centerX(c, z), halfW(c, z)) + rampAt(c, x, z);
}

// Nur das Gelände ohne Schanzen (für das Geländemodell)
export function terrain(c, x, z) {
  return baseY(c, z) + bank(x - centerX(c, z), halfW(c, z));
}

export function obstaclesNear(c, z) {
  const b = Math.floor(z / 10), out = [];
  for (let k = b - 1; k <= b + 1; k++) { const l = c.buckets.get(k); if (l) out.push(...l); }
  return out;
}

// Startplätze nebeneinander, leicht versetzt
export function startSlot(c, i, total) {
  const cols = Math.min(total, 6), gap = 3.4;
  const lat = (i - (cols - 1) / 2) * gap;
  const z = -4 - (i % 2) * 1.2;
  return { x: centerX(c, z) + lat, z };
}

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
