// Pistenjagd — Fahrphysik (fester Schritt) und Bot-Fahrer. Kein DOM, kein Three.js.
//
// Ein Fahrer gleitet über das Höhenfeld der Piste: die Hangneigung zieht ihn bergab, die Kanten halten ihn in
// Blickrichtung (seitliches Rutschen wird stark gedämpft), Luftwiderstand begrenzt das Tempo, Hocke senkt ihn.
// Blickrichtung: yaw = 0 zeigt bergab (+z), vorwärts = (sin yaw, cos yaw); nach rechts lenken verkleinert yaw.
// In der Luft dreht Lenken den Fahrer (spin). Landet er in Fahrtrichtung (Vielfache von 180°), gibt es Turbo –
// je mehr Drehung, desto länger; schief gelandet heißt Sturz.

import { ground, centerX, halfW, obstaclesNear, dirAt, NET } from "./course.js";

export const DT = 1 / 60;
export const G = 9.81;
export const KMH = 3.6;
export const CRASH_T = 1.5;
const SPIN_RATE = 7.2;          // rad/s in der Luft
const LAND_OK = 0.62;           // erlaubte Abweichung beim Landen (rad)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function newRider(c, x, z) {
  const y = ground(c, x, z);
  return { x, z, y, vx: 0, vz: 0, vy: 0, yaw: 0, steer: 0, tuck: 0, brake: 0, air: false, airT: 0, spin: 0, spinV: 0, crashT: 0, inv: 0, turboT: 0, pushT: 0, starT: 0, lastG: y, bumpT: 0, carve: 0, events: [], tumble: 0 };
}

export const speedOf = (k) => Math.hypot(k.vx, k.vz);

export function step(k, inp, dt, c, others) {
  const g0 = ground(c, k.x, k.z);
  if (k.crashT > 0) {
    // Sturz: rutscht aus, dreht sich wieder Richtung Tal, dann geht es weiter
    k.crashT -= dt; k.tumble += dt;
    const f = Math.exp(-2.6 * dt); k.vx *= f; k.vz *= f;
    k.yaw += angDiff(dirAt(c, k.z), k.yaw) * Math.min(1, dt * 3);
    k.spin = 0; k.spinV = 0; k.steer = 0; k.tuck = 0;
    if (k.crashT <= 0) {
      k.crashT = 0; k.inv = 1.3; k.tumble = 0;
      const v = Math.max(5, speedOf(k));
      k.vx = Math.sin(k.yaw) * v; k.vz = Math.cos(k.yaw) * v;
      k.events.push("up");
    }
  } else if (!k.air) {
    groundStep(k, inp, dt, c);
  } else {
    // Luft: Lenken dreht, Bahn bleibt
    // kleine Hüpfer über Kuppen drehen nicht, erst ein echter Sprung
    const tgt = k.airT > 0.18 ? -inp.steer * SPIN_RATE : 0;
    k.spinV += (tgt - k.spinV) * Math.min(1, dt * 9);
    k.spin += k.spinV * dt;
    k.airT += dt;
    k.steer += (0 - k.steer) * Math.min(1, dt * 6);
    k.tuck += ((inp.tuck ? 1 : 0) - k.tuck) * Math.min(1, dt * 6);
    const sp = speedOf(k), dr = 1 - 0.0009 * sp * dt;
    k.vx *= dr; k.vz *= dr;
  }
  if (k.turboT > 0) k.turboT = Math.max(0, k.turboT - dt);
  if (k.starT > 0) k.starT = Math.max(0, k.starT - dt);
  if (k.inv > 0) k.inv = Math.max(0, k.inv - dt);
  if (k.bumpT > 0) k.bumpT -= dt;

  k.x += k.vx * dt; k.z += k.vz * dt;

  // Fangnetz
  const cx = centerX(c, k.z), lim = halfW(c, k.z) + NET - 0.6, d = k.x - cx;
  if (Math.abs(d) > lim) {
    const s = Math.sign(d);
    k.x = cx + s * lim;
    if (k.vx * s > 0) { k.vx *= -0.25; k.vz *= 0.86; if (k.bumpT <= 0) { k.events.push("net"); k.bumpT = 0.4; } }
    if (!k.air && k.crashT <= 0) k.yaw += angDiff(dirAt(c, k.z), k.yaw) * 0.12;
  }

  // Höhe: Schwerkraft gegen den Boden; ein Boden, der schneller wegfällt als man fällt, heißt Abheben
  const g = ground(c, k.x, k.z);
  k.vy -= G * dt;
  k.y += k.vy * dt;
  if (k.y <= g) {
    if (k.air) land(k);
    k.y = g;
    k.vy = clamp((g - g0) / dt, -40, 40);
    k.air = false;
  } else if (k.y - g > 0.35 && !k.air && k.crashT <= 0) {
    k.air = true; k.airT = 0; k.spin = 0; k.spinV = 0;
    k.events.push("air");
  }
  k.lastG = g;

  // Hindernisse
  if (k.crashT <= 0 && k.inv <= 0 && k.y - g < 1.4) {
    for (const o of obstaclesNear(c, k.z)) {
      const dx = k.x - o.x, dz = k.z - o.z, rr = o.r + 0.45;
      if (dx * dx + dz * dz < rr * rr) {
        if (k.starT > 0) { if (!o.hitT || o.hitT < k.z - 20) { o.hitT = k.z; k.events.push("smash"); } continue; }
        crash(k, o.kind); break;
      }
    }
  }

  // Rempeln: jeder schiebt nur sich selbst weg (die anderen rechnen ihre eigenen Fahrer)
  if (others && k.crashT <= 0) {
    for (const o of others) {
      const dx = k.x - o.x, dz = k.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 > 1.45 * 1.45 || d2 < 1e-4 || Math.abs(k.y - o.y) > 1.6) continue;
      if (o.star && k.starT <= 0 && k.inv <= 0) { crash(k, "yeti"); break; }
      const dd = Math.sqrt(d2), nx = dx / dd, nz = dz / dd, push = (1.45 - dd);
      k.x += nx * push * 0.6; k.z += nz * push * 0.6;
      const rel = (k.vx - (o.vx || 0)) * nx + (k.vz - (o.vz || 0)) * nz;
      if (rel < 0) { k.vx -= nx * rel * 1.1; k.vz -= nz * rel * 1.1; }
      k.vx += nx * 2.2; k.vz += nz * 0.4;
      if (k.bumpT <= 0) { k.events.push("bump"); k.bumpT = 0.35; }
    }
  }
}

function groundStep(k, inp, dt, c) {
  const sp = speedOf(k);
  k.steer += (inp.steer - k.steer) * Math.min(1, dt * 4.5);       // weich einlenken, auch mit Tasten
  k.tuck += ((inp.tuck && !inp.brake ? 1 : 0) - k.tuck) * Math.min(1, dt * 5);
  k.brake += ((inp.brake ? 1 : 0) - k.brake) * Math.min(1, dt * 8);
  const rate = (1.35 - 0.5 * clamp(sp / 34, 0, 1)) * (1 - 0.4 * k.tuck) * (1 + 0.3 * k.brake);
  k.yaw -= k.steer * rate * dt;
  // höchstens schräg zum Hang, nie quer oder bergauf
  k.yaw = clamp(k.yaw, -1.2, 1.2);

  // Hangabtrieb aus dem Gefälle des Bodens
  const e = 0.35;
  const gx = (ground(c, k.x + e, k.z) - ground(c, k.x - e, k.z)) / (2 * e);
  const gz = (ground(c, k.x, k.z + e) - ground(c, k.x, k.z - e)) / (2 * e);
  const n2 = 1 / (1 + gx * gx + gz * gz);
  k.vx -= G * gx * n2 * dt; k.vz -= G * gz * n2 * dt;

  // Kanten: Geschwindigkeit in Längs- und Querteil, quer wird stark gedämpft
  const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw), rx = Math.cos(k.yaw), rz = -Math.sin(k.yaw);
  let along = k.vx * fx + k.vz * fz, lat = k.vx * rx + k.vz * rz;
  const grip = 7.5 - 4 * k.brake;
  const latKeep = Math.exp(-grip * dt);
  const lost = Math.abs(lat) * (1 - latKeep);
  k.carve = lost / dt;                                // fürs Pulverspray
  if (along > 0) {
    // die Kanten lenken die Querfahrt in Fahrtrichtung um (Betrag bleibt, abzüglich etwas Rutschverlust)
    const sp2 = along * along + lat * lat;
    lat *= latKeep;
    along = Math.sqrt(Math.max(0, sp2 - lat * lat)) - lost * 0.15;
  } else lat *= latKeep;
  // Bremse (Pflug / Querstellen), Reibung, Luftwiderstand, Turbo
  along -= Math.sign(along) * Math.min(Math.abs(along), (0.34 + 7.5 * k.brake) * dt);
  // aufrecht bremst der Fahrtwind spürbar, in der Hocke ist man deutlich windschnittiger
  const drag = (0.002 - 0.00118 * k.tuck) * (k.turboT > 0 || k.starT > 0 ? 0.55 : 1);
  along -= drag * along * Math.abs(along) * dt;
  lat -= drag * lat * Math.abs(lat) * dt;
  if (k.turboT > 0) along += 7 * dt;
  if (k.starT > 0) along += 3 * dt;
  if (k.pushT > 0) { k.pushT -= dt; if (along < 13) along += 5.5 * dt; }   // Anschub mit den Stöcken nach dem Start
  if (inp.push && along < 9) along += 3 * dt;                                // W/↑: anschieben, nur wenn man langsam ist
  along = Math.max(along, -2);
  k.vx = fx * along + rx * lat; k.vz = fz * along + rz * lat;
}

function land(k) {
  const half = Math.round(k.spin / Math.PI), rem = k.spin - half * Math.PI;
  const turns = Math.abs(half);
  if (k.airT > 0.45 && Math.abs(rem) > LAND_OK) { k.spin = 0; k.spinV = 0; crash(k, "land"); return; }
  if (turns >= 1) {
    k.turboT = Math.max(k.turboT, 0.55 + 0.6 * turns);
    k.events.push("trick:" + turns * 180);
  } else if (k.airT > 0.55) {
    k.turboT = Math.max(k.turboT, 0.35);
    k.events.push("land");
  } else k.events.push("touch");
  k.spin = 0; k.spinV = 0; k.airT = 0;
}

export function crash(k, why, dur = CRASH_T) {
  if (k.crashT > 0) return;
  k.crashT = dur; k.tumble = 0;
  k.vx *= 0.32; k.vz *= 0.32; k.turboT = 0; k.spin = 0; k.spinV = 0;
  k.events.push("crash:" + why);
}

// Treffer durch ein Item: Eisplatte = Ausrutscher, Schneeball = Sturz. Gibt false zurück, wenn es nicht wirkt.
export function hit(k, kind) {
  if (k.starT > 0 || k.inv > 0 || k.crashT > 0) return false;
  crash(k, kind, kind === "ice" ? 0.95 : 1.25);
  return true;
}

// Turbo (Kakao)
export function boost(k, secs) { k.turboT = Math.max(k.turboT, secs); k.events.push("boost"); }

// Zurück auf die Piste (Taste R): Mitte der Piste, kurz stehen
export function reset(k, c) {
  const z = Math.max(0, k.z - 6), x = centerX(c, z);
  Object.assign(k, { x, z, y: ground(c, x, z), vx: 0, vz: 0, vy: 0, air: false, spin: 0, spinV: 0, crashT: 0, inv: 1.5, turboT: 0, yaw: dirAt(c, z), steer: 0 });
  k.lastG = k.y;
}

// ---------- Bots ----------
// Ein Bot fährt eine Linie zu einem Ziel ein Stück voraus, weicht Hindernissen aus, nimmt manchmal eine Schanze
// mit und dreht dort je nach Können 0–720°.
export function newBotBrain(seed, skill) {
  let a = seed >>> 0 || 7;
  const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  return { r, skill, lane: (r() * 2 - 1) * 0.45, laneT: 0, spinGoal: 0, rampGoal: null, wobble: r() * 6.283 };
}

export function botInput(k, b, c, t) {
  if (k.air) {
    // Drehung bis zum Ziel, dann gerade landen
    if (b.spinGoal === null) b.spinGoal = 0;
    const err = b.spinGoal - k.spin;
    const steer = Math.abs(err) > 0.25 ? -Math.sign(err) : -clamp(err * 2.5, -0.6, 0.6);
    return { steer: clamp(steer, -1, 1), tuck: true, brake: false };
  }
  b.spinGoal = null;
  const sp = Math.max(6, speedOf(k));
  b.laneT -= 1 / 60;
  if (b.laneT <= 0) { b.lane = clamp(b.lane + (b.r() * 2 - 1) * 0.35, -0.6, 0.6); b.laneT = 2 + b.r() * 3; }
  const look = 9 + sp * (0.6 + 0.35 * b.skill);
  const zt = k.z + look;
  const hw = halfW(c, zt);
  let pref = b.lane * hw;
  // Schanze voraus? Geschickte Bots fahren öfter drauf
  const ramp = c.ramps.find((p) => p.z > k.z + 4 && p.z < k.z + 70);
  if (ramp) {
    if (b.rampGoal !== ramp) { b.rampGoal = ramp; b.take = b.r() < 0.35 + b.skill * 0.55; b.spinPlan = b.r() < b.skill ? (b.r() < b.skill * 0.6 ? 4 : 2) : b.r() < 0.5 ? 1 : 0; }
    if (b.take) pref = ramp.lat;
  }
  // Ausweichen: mögliche Linien quer über die Piste bewerten (Hindernisse auf der Linie, Umweg, Hin-und-Her)
  const obs = [];
  for (let z = k.z; z < k.z + look + 22; z += 10) for (const o of obstaclesNear(c, z)) if (o.z > k.z + 2 && o.z < k.z + look + 14 && !obs.includes(o)) obs.push(o);
  let lat = pref;
  if (obs.length) {
    const cxT = centerX(c, zt);
    let best = Infinity;
    for (let cand = -hw + 1.5; cand <= hw - 1.5; cand += 1.25) {
      const tx = cxT + cand;
      let cost = Math.abs(cand - pref) * 0.25 + Math.abs(cand - (b.prev ?? pref)) * 0.2 + 3 * Math.max(0, Math.abs(Math.atan2(tx - k.x, look)) - 0.55);
      for (const o of obs) {
        const u = (o.z - k.z) / look;
        const px = u < 1 ? k.x + (tx - k.x) * u : centerX(c, o.z) + cand;
        const off = Math.abs(px - o.x), need = o.r + 1.3 + 0.5 * (1 - b.skill);
        if (off < need) cost += 60 * (1.6 - Math.min(1, u) * 0.6);
        else if (off < need + 1.5) cost += 3 * (need + 1.5 - off);
      }
      if (cost < best) { best = cost; lat = cand; }
    }
  }
  b.prev = lat;
  const tx = centerX(c, zt) + clamp(lat, -hw + 1.5, hw - 1.5);
  const want = Math.atan2(tx - k.x, zt - k.z) + Math.sin(t * 0.7 + b.wobble) * 0.04 * (1 - b.skill);
  const err = angDiff(want, k.yaw);
  const steer = clamp(-err * (2.6 + b.skill), -1, 1);
  const tuck = Math.abs(err) < 0.12 + b.skill * 0.06 && sp < 44;
  return { steer, tuck, brake: false };
}

// Beim Abheben legt der Bot fest, wie weit er dreht: geplante halbe Umdrehungen, begrenzt durch die erwartete Flugzeit
export function botTakeoff(k, b) {
  const airEst = Math.max(0, k.vy) * 2 / G + 0.35;
  const maxHalf = Math.floor((airEst - 0.3) * SPIN_RATE * 0.8 / Math.PI);
  const half = Math.max(0, Math.min(b.spinPlan || 0, maxHalf));
  b.spinGoal = half * Math.PI * (b.r() < 0.5 ? -1 : 1);
}
