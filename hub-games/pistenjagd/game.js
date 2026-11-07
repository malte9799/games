// Pistenjagd — Spiel-Engine für Solo (Zeitfahren) und Mehrspieler (Rennen bergab, Bots füllen auf).
//
//   createPiste({ root, net, players, me, solo, topInset, onFull }) → { go(), destroy(), menu() }
//
// Mehrspieler: Jeder Client rechnet seinen eigenen Fahrer und schickt ~20× pro Sekunde seine Lage ("k"); die anderen
// werden weich nachgeführt. Rempeln rechnet jeder nur für sich selbst. Der Host wählt die Piste ("sel"), startet
// ("begin"), rechnet die Bots und schickt deren Lage gesammelt ("b"). Seine Ski-/Board-Wahl schickt jeder selbst
// ("gear"), die Zielzeit auch ("fin", für Bots vom Host mit id). Übernimmt ein anderer den Host, rechnet er die Bots weiter.
// Items wie beim Kart: Geschenke ("box") geben Kakao (Turbo), Eisplatten ("ice"), Schneebälle ("sb") oder Yeti-Kraft.
// Ob ein Treffer zählt, entscheidet der Getroffene (für Bots der Host) und meldet ihn ("hit").
// Ohne `net` (Solo-Seite) fährt man allein gegen die Bestzeit.

import { SLOPES, randomSpec, buildCourse, ground, centerX, startSlot } from "./course.js";
import { loadThree, createWorld, palette, cssHex } from "./world.js";
import { newRider, step, reset, speedOf, newBotBrain, botInput, botTakeoff, hit, boost, DT, KMH } from "./physics.js";
import { CSS, TEMPLATE, GEAR_ICON, GEAR_ART, HERO_ART, ICONS, ITEM_NAME, levelOf, esc, fmtTime, slopeSvg } from "./ui.js";

const COUNTDOWN = 3.4;
const SEND_EVERY = 3;
const FINISH_GRACE = 25;
const MAX_RIDERS = 6;
const BOT_NAMES = ["Frieda", "Sepp", "Vroni", "Toni", "Resi", "Hansi"];
const ROLL_TIME = 1.2;           // Auslosung im Geschenk
const BOX_RESPAWN = 5;
const SNOWBALL_V = 58;           // m/s, schneller als jeder Fahrer
const YETI_T = 6;
const CRASH_MSG = { land: "Schief gelandet!", tree: "Baum!", rock: "Felsen!", snowman: "Schneemann!", ice: "Ausgerutscht!", snowball: "Schneeball-Treffer!", yeti: "Vom Yeti umgerannt!" };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export function slopeSpec(sel) {
  if (sel.slope < SLOPES.length) return SLOPES[sel.slope];
  return randomSpec((sel.rseed >>> 0) || 777);
}
const bestKey = (spec) => "pistenjagd_best_" + (spec.id === "zufall" ? "zufall" + spec.seed : spec.id);

export async function createPiste(env) {
  const T = await loadThree();
  const net = env.net || null;
  const solo = !net || !!env.solo;
  const players = (env.players && env.players.length ? env.players : [{ id: "me", name: "Du" }]).slice(0, MAX_RIDERS);
  const meId = env.me ? env.me.id : players[0].id;
  const myIdx = Math.max(0, players.findIndex((p) => p.id === meId));
  const isHost = () => (net ? !!net.isHost : true);
  let pal = palette();
  const colorOf = (i) => pal.riders[i % pal.riders.length];

  // Shadow DOM: die Design-Themes der Seite stylen sonst jeden <button> mit
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style"); st.textContent = CSS + ":host{display:block}"; sr.appendChild(st);
  const el = document.createElement("div");
  el.className = "pj"; el.innerHTML = TEMPLATE; sr.appendChild(el);
  env.root.appendChild(host);
  el.style.setProperty("--pj-top", (env.topInset || 0) + "px");
  const paintVars = () => { el.style.setProperty("--acc", cssHex(pal.sun)); el.style.setProperty("--acc2", cssHex(pal.lilac)); };
  paintVars();
  const $ = (s) => el.querySelector(s);
  const view = $(".pj-view"), hud = $(".pj-hud"), menuEl = $(".pj-menu"), resEl = $(".pj-result"), center = $(".pj-center"), touchEl = $(".pj-touch");
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (isTouch) { el.classList.add("touch"); touchEl.hidden = false; }
  const offs = [];
  const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); offs.push(() => target.removeEventListener(ev, fn, opt)); };

  // ---------- Zustand ----------
  let sel = { slope: clamp(store.get("pistenjagd_slope", 0) | 0, 0, SLOPES.length), rseed: (Math.random() * 1e9) >>> 0, bots: store.get("pistenjagd_bots", true) !== false };
  if (!solo) sel.slope = 0;
  let spec = slopeSpec(sel), course = null, world = null;
  let phase = "menu";                       // menu | countdown | race | done
  let raceT = 0, cd = 0, rid = "", time = 0, last = 0, acc = 0, raf = 0, destroyed = false, sendN = 0, msgTimer = 0;
  let me = null, meModel = null, myGear = store.get("pistenjagd_gear", "ski") === "board" ? "board" : "ski";
  const gears = new Map([[meId, myGear]]);
  let rem = new Map();                      // andere Fahrer (Menschen und – beim Nicht-Host – Bots)
  let bots = [];                            // nur beim Host: { id, name, idx, k, brain, model, fin }
  let botCount = 0;
  let finished = false, finT = 0, firstFinAt = 0, resultShown = false, resultsAt = 0, recordNew = false, prevBest = 0;
  let camDir = 0, camFov = 64, shake = 0;
  const stats = { tricks: 0, best: 0, crashes: 0, top: 0 };
  const myInv = { item: null, count: 0, rolling: 0 };
  let items = new Map(), itemSeq = 0, ices = [], itemPress = false;
  const results = new Map();

  // ---------- Welt ----------
  function loadWorld() {
    spec = slopeSpec(sel);
    const key = spec.id + ":" + spec.seed;
    if (world && world.key === key) return;
    if (world) { disposeModels(); world.dispose(); world = null; }
    course = buildCourse(spec);
    world = createWorld(T, view, course);
    world.key = key;
    buildRiders();
  }
  function disposeModels() {
    if (meModel) { world.scene.remove(meModel.root); meModel.dispose(); meModel = null; }
    for (const r of rem.values()) if (r.model) { world.scene.remove(r.model.root); r.model.dispose(); r.model = null; }
    for (const b of bots) if (b.model) { world.scene.remove(b.model.root); b.model.dispose(); b.model = null; }
  }
  function riderList() {
    // Menschen zuerst (in Raum-Reihenfolge), dann Bots
    const list = players.map((p, i) => ({ id: p.id, name: p.name || "Spieler", idx: i, bot: false }));
    for (let i = 0; i < botCount; i++) list.push({ id: "bot" + i, name: BOT_NAMES[i % BOT_NAMES.length], idx: players.length + i, bot: true });
    return list;
  }
  const botGear = (i) => ((course.seed + i * 7) % 3 === 0 ? "board" : "ski");
  function buildRiders() {
    disposeModels();
    const list = riderList(), total = list.length;
    const oldRem = rem;
    rem = new Map(); bots = [];
    for (const p of list) {
      const s = startSlot(course, p.idx, total);
      if (p.id === meId) {
        me = newRider(course, s.x, s.z);
        meModel = world.makeRider(colorOf(p.idx), myGear, p.name, { local: true });
        continue;
      }
      const gear = p.bot ? botGear(p.idx) : gears.get(p.id) || "ski";
      if (p.bot && isHost()) {
        const k = newRider(course, s.x, s.z);
        bots.push({ id: p.id, name: p.name, idx: p.idx, k, brain: newBotBrain(course.seed + p.idx * 977, 0.25 + ((p.idx * 37) % 10) / 13), gear, model: world.makeRider(colorOf(p.idx), gear, p.name + " (Bot)"), fin: Infinity, inv: { item: null, count: 0, rolling: 0 }, useT: 0 });
      } else {
        const o = oldRem.get(p.id);
        const r = mkRemote(p, s, gear);
        if (o && o.left) r.left = true;
        r.model = world.makeRider(colorOf(p.idx), gear, p.bot ? p.name + " (Bot)" : p.name);
        if (r.left) r.model.root.visible = false;
        rem.set(p.id, r);
      }
    }
    camDir = 0;
  }
  const mkRemote = (p, s, gear) => {
    const y = ground(course, s.x, s.z);
    return { id: p.id, idx: p.idx, name: p.name, bot: p.bot, gear, x: s.x, z: s.z, y, yaw: 0, vx: 0, vz: 0, tx: s.x, tz: s.z, ty: y, tyaw: 0, tvx: 0, tvz: 0, tAt: 0, spin: 0, tspin: 0, steer: 0, flags: 0, tumble: 0, finT: Infinity, left: false, seen: false, model: null };
  };
  function setRemoteGear(r, gear) {
    if (r.gear === gear || !world) return;
    r.gear = gear;
    if (r.model) { world.scene.remove(r.model.root); r.model.dispose(); }
    r.model = world.makeRider(colorOf(r.idx), gear, r.bot ? r.name + " (Bot)" : r.name);
  }
  function setMyGear(g) {
    myGear = g; gears.set(meId, g); store.set("pistenjagd_gear", g);
    if (world && meModel) { world.scene.remove(meModel.root); meModel.dispose(); meModel = world.makeRider(colorOf(myIdx), g, "", { local: true }); }
    net && net.send("gear", { g });
  }

  // ---------- Eingabe ----------
  const keys = new Set();
  const tch = { steer: 0, tuck: false, brake: false };
  const KEYMAP = { ArrowUp: "push", KeyW: "push", Space: "tuck", ArrowDown: "brake", KeyS: "brake", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
  on(window, "keydown", (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!el.isConnected) return;
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); if (phase !== "menu") e.preventDefault(); }
    else if (e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyX") { if (phase === "race") { itemPress = true; e.preventDefault(); } }
    else if (e.code === "KeyR") { if (phase === "race" && !finished) doReset(); }
    else if (e.code === "KeyF") toggleFull();
    else if ((e.code === "Enter" || e.code === "KeyN") && isHost()) { if (phase === "menu" || phase === "done") { e.preventDefault(); startRace(); } }
  });
  on(window, "keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
  on(window, "blur", () => keys.clear());

  const pad = $(".pj-pad"), knob = pad.querySelector(".knob"), ring = pad.querySelector(".ring");
  let padId = null, padX = 0;
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault(); padId = e.pointerId; padX = e.clientX; pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect();
    ring.style.left = knob.style.left = e.clientX - r.left + "px"; ring.style.top = knob.style.top = e.clientY - r.top + "px"; pad.classList.add("on");
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId !== padId) return;
    const dx = e.clientX - padX, v = clamp(dx / 55, -1, 1);
    tch.steer = Math.abs(v) < 0.08 ? 0 : v;
    knob.style.left = parseFloat(ring.style.left) + clamp(dx, -55, 55) + "px";
  });
  const padEnd = (e) => { if (e.pointerId !== padId) return; padId = null; tch.steer = 0; pad.classList.remove("on"); };
  pad.addEventListener("pointerup", padEnd); pad.addEventListener("pointercancel", padEnd);
  el.querySelectorAll(".pj-b").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("on"); if (k === "item") itemPress = true; else tch[k] = true; });
    const up = () => { b.classList.remove("on"); if (k !== "item") tch[k] = false; };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  });
  on(el, "contextmenu", (e) => e.preventDefault());

  function readInput() {
    const steer = clamp((keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0) + tch.steer, -1, 1);
    const brake = keys.has("brake") || tch.brake;
    return { steer, tuck: (keys.has("tuck") || tch.tuck) && !brake, brake, push: keys.has("push") && !brake };
  }

  // ---------- Meldungen, Vollbild ----------
  const msgEl = $(".pj-msg");
  function say(text, cls = "", ms = 1400, small = "") {
    msgEl.innerHTML = esc(text) + (small ? `<small>${esc(small)}</small>` : ""); msgEl.className = "pj-msg on " + cls;
    clearTimeout(msgTimer); if (ms) msgTimer = setTimeout(() => msgEl.classList.remove("on"), ms);
  }
  function setFull(v) {
    el.classList.toggle("pj-full", v);
    host.style.cssText = v ? "position:fixed;inset:0;z-index:99999;" : "position:absolute;inset:0;";
    el.style.setProperty("--pj-top", (v ? 0 : env.topInset || 0) + "px");
    if (env.onFull) env.onFull(v);
    try { if (v && el.requestFullscreen && !isTouch) el.requestFullscreen().catch(() => {}); else if (!v && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
    setTimeout(() => world && world.size(), 60);
  }
  const toggleFull = () => setFull(!el.classList.contains("pj-full"));
  on(document, "fullscreenchange", () => { if (!document.fullscreenElement && el.classList.contains("pj-full") && !isTouch) { el.classList.remove("pj-full"); host.style.cssText = "position:absolute;inset:0;"; el.style.setProperty("--pj-top", (env.topInset || 0) + "px"); if (env.onFull) env.onFull(false); world && world.size(); } });
  el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    if (a === "full") toggleFull(); else if (a === "reset" && phase === "race" && !finished) doReset();
  }));
  const ro = new ResizeObserver(() => world && world.size());
  ro.observe(el);

  // Design gewechselt: Akzentfarben, Himmel, Fahrer neu einfärben
  on(window, "themechange", () => {
    if (!world) return;
    pal = world.recolor(); paintVars();
    if (meModel) meModel.setColor(colorOf(myIdx));
    for (const r of rem.values()) r.model && r.model.setColor(colorOf(r.idx));
    for (const b of bots) b.model && b.model.setColor(colorOf(b.idx));
    if (phase === "menu") renderMenu(); else if (phase === "done") renderResults();
  });

  // ---------- Menü ----------
  const courseCache = new Map();
  const courseOf = (sp) => { const k = sp.id + sp.seed; let c = courseCache.get(k); if (!c) { c = buildCourse(sp); courseCache.set(k, c); } return c; };
  function renderMenu() {
    if (phase !== "menu") return;
    const can = isHost();
    const specs = [...SLOPES, randomSpec(sel.rseed)];
    const cards = specs.map((sp, i) => {
      const bt = store.get(bestKey(sp), 0), c = courseOf(sp), [lv, lvName] = levelOf(sp);
      return `<button class="pj-sl${sel.slope === i ? " sel" : ""}" data-s="${i}" ${can ? "" : "disabled"}><span class="lvl ${lv}"><i></i>${lvName}</span>${slopeSvg(c)}<b>${esc(sp.name)}</b><small>${esc(sp.blurb)}</small>
        <span class="meta"><span>${Math.round(sp.len / 10) * 10} m</span><span>${c.ramps.length} Schanzen</span></span>${bt ? `<span class="rec">★ ${fmtTime(bt)}</span>` : ""}</button>`;
    }).join("");
    const GEAR_TXT = { ski: ["Ski", "Mit Stöcken, schnelle enge Schwünge"], board: ["Snowboard", "Seitlich auf dem Brett, lässig carven"] };
    const gearBtns = ["ski", "board"].map((g) => `<button data-g="${g}" class="${myGear === g ? "sel" : ""}">${GEAR_ART[g]}<span><b>${GEAR_TXT[g][0]}</b><small>${GEAR_TXT[g][1]}</small></span></button>`).join("");
    const nBots = sel.bots ? Math.max(0, MAX_RIDERS - players.length) : 0;
    const rows = players.map((p, i) => `<span><i style="background:${cssHex(colorOf(i))}"></i>${esc(p.name || "Spieler")}${i === myIdx ? " (du)" : ""}${GEAR_ICON[gears.get(p.id) || "ski"]}</span>`).join("")
      + (nBots ? `<span style="opacity:.7">+ ${nBots} Bot${nBots > 1 ? "s" : ""}</span>` : "");
    const flakes = [8, 22, 41, 63, 78, 91].map((x, i) => `<span class="flake" style="left:${x}%;animation-delay:${-i * 1.3}s;animation-duration:${6 + (i % 3) * 1.5}s">❄</span>`).join("");
    menuEl.innerHTML = `<div class="pj-card menu">
      <div class="pj-hero">${flakes}${HERO_ART}
        <span class="badge">${solo ? "Zeitfahren" : players.length + (nBots ? " + " + nBots + " Bots" : "") + " Fahrer"}</span>
        <h2><em>Pisten</em><span>jagd</span></h2>
        <p class="sub">${solo ? "Allein den Berg hinunter gegen die Bestzeit – Geschenke geben Kakao-Turbo und Yeti-Kraft." : "Rennen bergab mit Items – Geschenke geben Kakao, Eisplatten, Schneebälle und Yeti-Kraft."}</p>
      </div>
      <div class="pj-body">
        <div class="pj-step"><i>1</i>Dein Sportgerät</div><div class="pj-gear">${gearBtns}</div>
        <div class="pj-step"><i>2</i>Piste${can ? "" : " – wählt der Host"}</div><div class="pj-slopes">${cards}</div>
        ${solo ? "" : `<div class="pj-mp"><div><div class="pj-sec">Bots</div><div class="pj-seg"><button data-b="1" class="${sel.bots ? "sel" : ""}" ${can ? "" : "disabled"}>auffüllen</button><button data-b="0" class="${sel.bots ? "" : "sel"}" ${can ? "" : "disabled"}>keine</button></div></div>
        <div style="flex:1 1 220px"><div class="pj-sec">Fahrer</div><div class="pj-plist">${rows}</div></div></div>`}
        <button class="pj-go" data-go ${can ? "" : "disabled"}>${can ? (solo ? "Los geht’s!" : "Rennen starten") : "Der Host startet das Rennen …"}</button>
        <div class="pj-help">${isTouch
          ? `<span>Links ziehen: <b>lenken</b> (in der Luft: drehen)</span><span><b>HOCKE</b> halten = schneller</span><span><b>ITEM</b> einsetzen</span><span><b>BREMSE</b></span><span>⛶ Vollbild</span>`
          : `<span><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> lenken, in der Luft drehen</span><span><kbd>Leertaste</kbd> Hocke (schneller)</span><span><kbd>W</kbd> / <kbd>↑</kbd> anschieben</span><span><kbd>S</kbd> / <kbd>↓</kbd> bremsen</span><span><kbd>E</kbd> / <kbd>Shift</kbd> Item</span><span><kbd>R</kbd> zurück auf die Piste</span><span><kbd>F</kbd> Vollbild</span>`}</div>
      </div>
    </div>`;
    menuEl.hidden = false;
  }
  menuEl.addEventListener("click", (e) => {
    const s = e.target.closest("[data-s]"), g = e.target.closest("[data-g]"), b = e.target.closest("[data-b]"), go = e.target.closest("[data-go]");
    if (g) { setMyGear(g.dataset.g); renderMenu(); return; }
    if (!isHost()) return;
    if (s) {
      const i = +s.dataset.s;
      if (i >= SLOPES.length && sel.slope === i) sel.rseed = (Math.random() * 1e9) >>> 0;
      sel.slope = i; if (solo) store.set("pistenjagd_slope", i < SLOPES.length ? i : 0);
      pushSel(); loadWorld(); renderMenu();
    } else if (b) { sel.bots = b.dataset.b === "1"; store.set("pistenjagd_bots", sel.bots); pushSel(); renderMenu(); }
    else if (go) startRace();
  });
  const pushSel = () => net && isHost() && net.send("sel", { s: sel.slope, r: sel.rseed, b: sel.bots ? 1 : 0 });

  function showMenu() {
    phase = "menu"; resultShown = false; resEl.hidden = true; hud.hidden = true; center.hidden = true;
    botCount = 0; loadWorld(); buildRiders(); world.clearItems(); items.clear(); ices = []; world.resetBoxes(); Object.assign(myInv, { item: null, count: 0, rolling: 0 }); renderMenu();
  }

  // ---------- Rennen ----------
  function startRace() {
    if (!isHost()) return;
    rid = Math.random().toString(36).slice(2, 8);
    const msg = { s: sel.slope, r: sel.rseed, id: rid, bots: solo || !sel.bots ? 0 : Math.max(0, MAX_RIDERS - players.length) };
    if (net) { net.send("begin", msg); setTimeout(() => beginRace(msg), 140); } else beginRace(msg);
  }
  function beginRace(m) {
    if (destroyed) return;
    sel.slope = clamp(m.s | 0, 0, SLOPES.length); sel.rseed = m.r >>> 0;
    rid = m.id;
    botCount = clamp(m.bots | 0, 0, MAX_RIDERS);
    loadWorld(); buildRiders();
    finished = false; finT = 0; firstFinAt = 0; resultShown = false; recordNew = false; time = 0;
    Object.assign(stats, { tricks: 0, best: 0, crashes: 0, top: 0 });
    Object.assign(myInv, { item: null, count: 0, rolling: 0 }); itemPress = false;
    world.clearItems(); items.clear(); ices = []; world.resetBoxes();
    prevBest = solo ? store.get(bestKey(spec), 0) : 0;
    results.clear(); raceT = 0; cd = COUNTDOWN; phase = "countdown"; cdShown = 4;
    menuEl.hidden = true; resEl.hidden = true; hud.hidden = false; center.hidden = false; hudCache = {};
    if (isTouch) setFull(true);
    $(".pj-best").textContent = solo ? "Bestzeit " + (prevBest ? fmtTime(prevBest) : "—") : spec.name;
    $(".pj-board").style.display = solo ? "none" : "";
    $(".pj-pos").style.display = solo ? "none" : "";
    msgEl.classList.remove("on");
    buildProgress();
  }
  let cdShown = 4;
  function countdownTick() {
    const n = Math.ceil(cd - 0.4);
    if (cd > 0.4 && n !== cdShown && n >= 1 && n <= 3) { cdShown = n; center.innerHTML = `<div class="pj-count">${n}</div>`; }
  }
  function goRace() {
    phase = "race"; raceT = 0;
    center.innerHTML = `<div class="pj-count go">LOS!</div>`;
    setTimeout(() => { if (phase === "race") center.innerHTML = ""; }, 900);
    me.pushT = 1.6;
    for (const b of bots) b.k.pushT = 1.4 + b.brain.r() * 0.4;
  }

  function doReset() {
    if (me.crashT > 0) return;
    reset(me, course); say("Zurück auf die Piste", "", 900);
  }

  // ---------- Netzwerk ----------
  const myFlags = (k, fin, gear) => (k.air ? 1 : 0) | (k.crashT > 0 ? 2 : 0) | (k.turboT > 0 ? 4 : 0) | (k.tuck > 0.5 ? 8 : 0) | (gear === "board" ? 16 : 0) | (fin ? 32 : 0) | (k.inv > 0 ? 64 : 0) | (k.starT > 0 ? 128 : 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  const pack = (k, fl) => [r2(k.x), r2(k.z), r2(k.y), Math.round(k.yaw * 1000) / 1000, r2(k.vx), r2(k.vz), fl, Math.round(k.spin * 100), Math.round(k.steer * 100)];
  function applyRemote(r, d) {
    const [x, z, y, yaw, vx, vz, flags, spin, steer] = d;
    if (![x, z, y, yaw].every(Number.isFinite)) return;
    if (!r.seen || Math.hypot(x - r.x, z - r.z) > 30) { r.x = x; r.z = z; r.y = y; r.yaw = yaw; }
    r.seen = true;
    r.tx = x; r.tz = z; r.ty = y; r.tyaw = yaw; r.tvx = +vx || 0; r.tvz = +vz || 0; r.tspin = (spin | 0) / 100; r.steer = (steer | 0) / 100; r.tAt = performance.now();
    if ((flags & 2) && !(r.flags & 2)) { r.tumble = 0; burst(x, y + 0.6, z, 0xffffff, 18, 5); }
    if (!(flags & 1) && (r.flags & 1)) burst(x, y + 0.2, z, 0xf2f7ff, 10, 4);
    r.flags = flags | 0;
    if (!r.bot) setRemoteGear(r, flags & 16 ? "board" : "ski");
  }
  if (net) {
    offs.push(net.onMessage("sel", ({ data }) => { if (phase !== "menu" || isHost() || !data) return; sel.slope = clamp(data.s | 0, 0, SLOPES.length); sel.rseed = data.r >>> 0; sel.bots = !!data.b; loadWorld(); renderMenu(); }));
    offs.push(net.onMessage("begin", ({ data }) => { if (!data || data.id === rid) return; beginRace(data); }));
    offs.push(net.onMessage("menu", () => { if (phase !== "menu") showMenu(); }));
    offs.push(net.onMessage("gear", ({ data, from }) => {
      if (!data) return; const g = data.g === "board" ? "board" : "ski";
      gears.set(from, g); const r = rem.get(from); if (r) setRemoteGear(r, g);
      if (phase === "menu") renderMenu();
    }));
    offs.push(net.onMessage("k", ({ data, from }) => { const r = rem.get(from); if (r && !r.bot && Array.isArray(data)) applyRemote(r, data); }));
    offs.push(net.onMessage("b", ({ data }) => {
      if (isHost() || !Array.isArray(data)) return;
      for (const row of data) { if (!Array.isArray(row)) continue; const r = rem.get("bot" + (row[0] | 0)); if (r && r.bot) applyRemote(r, row.slice(1)); }
    }));
    offs.push(net.onMessage("fin", ({ data, from }) => {
      if (!data) return;
      const id = data.id && String(data.id).startsWith("bot") ? String(data.id) : from;
      const r = rem.get(id); if (!r) return;
      r.finT = +data.t || 0; results.set(id, r.finT); if (!firstFinAt) firstFinAt = performance.now();
    }));
    offs.push(net.onEvent("leave", (p) => { const r = p && rem.get(p.id); if (r) { r.left = true; if (r.model) r.model.root.visible = false; } }));
    offs.push(net.onEvent("host", () => {
      // neuer Host: Bots aus ihrer letzten Lage weiterrechnen
      if (isHost() && (phase === "race" || phase === "countdown" || phase === "done")) {
        for (const r of [...rem.values()]) {
          if (!r.bot) continue;
          const k = newRider(course, r.x, r.z);
          Object.assign(k, { y: r.y, vx: r.tvx, vz: r.tvz, yaw: r.yaw, lastG: r.y });
          bots.push({ id: r.id, name: r.name, idx: r.idx, k, brain: newBotBrain(course.seed + r.idx * 977, 0.25 + ((r.idx * 37) % 10) / 13), gear: r.gear, model: r.model, fin: r.finT, inv: { item: null, count: 0, rolling: 0 }, useT: 0 });
          rem.delete(r.id);
        }
      }
      if (phase === "menu") renderMenu(); else if (phase === "done") renderResults();
    }));
    offs.push(net.onMessage("box", ({ data }) => { if (world && Array.isArray(data)) world.takeBox(data[0] | 0, BOX_RESPAWN); }));
    offs.push(net.onMessage("ice", ({ data, from }) => { if (!world || !Array.isArray(data) || phase === "menu") return; const x = +data[1], z = +data[2]; if (Number.isFinite(x) && Number.isFinite(z)) addIce(String(data[0]), x, z, from); }));
    offs.push(net.onMessage("sb", ({ data, from }) => { if (!world || !data || phase === "menu") return; const x = +data.x, z = +data.z; if (Number.isFinite(x) && Number.isFinite(z)) addSnowball(String(data.id), x, z, String(data.t || ""), String(data.o || from)); }));
    offs.push(net.onMessage("hit", ({ data }) => { if (Array.isArray(data)) removeItem(String(data[0]), true); }));
    // wer neu in den Raum kommt, soll unser Sportgerät kennen
    offs.push(net.onEvent("join", () => net.send("gear", { g: myGear })));
  }

  // ---------- Partikel ----------
  const burst = (x, y, z, hex, n, sp) => { if (!world) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.4 + Math.random()); world.particles.emit(x, y, z, Math.cos(a) * v, 1.5 + Math.random() * sp * 0.6, Math.sin(a) * v, 0.6 + Math.random() * 0.5, hex, -9); } };
  function riderFx(s, carve) {
    // s: { x, y, z, yaw, vx, vz, air, turbo, crash }
    const P = world.particles, sp = Math.hypot(s.vx, s.vz);
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    if (!s.air && !s.crash && sp > 6 && Math.random() < clamp(carve / 6, 0.12, 1)) {
      const n = carve > 4 ? 3 : 1;
      for (let i = 0; i < n; i++) P.emit(s.x - fx * 0.7 + (Math.random() - 0.5) * 0.6, s.y + 0.15, s.z - fz * 0.7 + (Math.random() - 0.5) * 0.6, -fx * 2 + (Math.random() - 0.5) * 3, 1.2 + Math.random() * 2 + carve * 0.2, -fz * 2 + (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.4, 0xeaf1fb, -6);
    }
    if (s.turbo) P.emit(s.x - fx * 0.6, s.y + 0.6 + Math.random() * 0.5, s.z - fz * 0.6, -fx * 3 + (Math.random() - 0.5) * 2, Math.random(), -fz * 3 + (Math.random() - 0.5) * 2, 0.35, pal.sun, 0);
  }

  // ---------- Items ----------
  // Wer: "me" (eigener Fahrer) oder ein Bot des Hosts. inv = { item, count, rolling }.
  function riderPos(id) {
    if (id === meId) return { x: me.x, y: me.y, z: me.z, fin: finished };
    const r = rem.get(id); if (r) return r.left ? null : { x: r.x, y: r.y, z: r.z, fin: r.finT < Infinity };
    const b = bots.find((x) => x.id === id); return b ? { x: b.k.x, y: b.k.y, z: b.k.z, fin: b.fin < Infinity } : null;
  }
  function rankFrac(z) {
    const all = allRiders(); if (all.length < 2) return 0;
    return all.filter((r) => r.z > z).length / (all.length - 1);
  }
  function drawItem(z) {
    const r = rankFrac(z);
    const pool = solo ? [["cocoa", 60], ["cocoa3", 28], ["yeti", 12]]
      : [["cocoa", 30], ["cocoa3", 8 + 22 * r], ["ice", 30 - 18 * r], ["snowball", 8 + 26 * r], ["yeti", 2 + 20 * r * r]];
    let x = Math.random() * pool.reduce((a, p) => a + p[1], 0);
    for (const [k, w] of pool) { x -= w; if (x <= 0) return k; }
    return "cocoa";
  }
  function pickBoxes(k, inv, isMe) {
    for (const b of world.boxes) {
      if (!b.active) continue;
      const dx = b.x - k.x, dz = b.z - k.z;
      if (dx * dx + dz * dz > 2.3 * 2.3 || Math.abs(k.y + 0.8 - b.y) > 2.4) continue;
      world.takeBox(b.id, BOX_RESPAWN);
      net && net.send("box", [b.id]);
      burst(b.x, b.y, b.z, pal.sun, 14, 6);
      if (!inv.item && !inv.rolling) inv.rolling = ROLL_TIME;
      if (isMe) shake = Math.max(shake, 0.15);
    }
  }
  function useItem(k, inv, ownerId, ownerIdx) {
    const kind = inv.item;
    if (!kind) return;
    if (kind === "cocoa" || kind === "cocoa3") { boost(k, 1.4); inv.count--; if (inv.count <= 0) inv.item = null; }
    else if (kind === "yeti") { k.starT = YETI_T; k.events.push("yeti"); inv.item = null; }
    else if (kind === "ice") {
      const x = k.x - Math.sin(k.yaw) * 2.4, z = k.z - Math.cos(k.yaw) * 2.4, id = ownerIdx + "-" + itemSeq++;
      addIce(id, x, z, ownerId);
      net && net.send("ice", [id, +x.toFixed(2), +z.toFixed(2)]);
      inv.item = null;
    } else if (kind === "snowball") {
      // Ziel: der nächste Fahrer vor einem, der noch nicht im Ziel ist
      let tgt = null, bd = Infinity;
      for (const r of allRiders()) { if (r.id === ownerId || r.t < Infinity) continue; const d = r.z - k.z; if (d > 0 && d < bd) { bd = d; tgt = r.id; } }
      const id = ownerIdx + "-" + itemSeq++;
      const sb = { x: k.x + Math.sin(k.yaw) * 1.5, z: k.z + 2, tgt: tgt || "", owner: ownerId };
      addSnowball(id, sb.x, sb.z, sb.tgt, ownerId);
      net && net.send("sb", { id, o: ownerId, x: +sb.x.toFixed(2), z: +sb.z.toFixed(2), t: sb.tgt });
      inv.item = null;
    }
    if (!inv.item) inv.count = 0;
    if (ownerId === meId) store.set("pistenjagd_item_uses", store.get("pistenjagd_item_uses", 0) + 1);
  }
  function addIce(id, x, z, owner) {
    const y = ground(course, x, z);
    items.set(id, { id, kind: "ice", x, y, z, owner, age: 0 });
    world.addItem(id, "ice", x, y + 0.05, z);
    ices.push(id);
    while (ices.length > 16) { const o = ices.shift(); items.delete(o); world.removeItem(o); }
  }
  function addSnowball(id, x, z, tgt, owner) {
    const y = ground(course, x, z) + 0.9;
    items.set(id, { id, kind: "snowball", x, y, z, tgt, owner, age: 0 });
    world.addItem(id, "snowball", x, y, z);
  }
  function removeItem(id, fx) {
    const it = items.get(id);
    if (it && fx) burst(it.x, it.y + 0.4, it.z, it.kind === "ice" ? 0x9fd8ff : 0xffffff, 16, 6);
    items.delete(id); world && world.removeItem(id);
  }
  function updateItems(dt) {
    for (const it of [...items.values()]) {
      it.age += dt;
      if (it.kind !== "snowball") { if (it.age > 40) removeItem(it.id, false); continue; }
      it.z += SNOWBALL_V * dt;
      const tg = it.tgt && riderPos(it.tgt);
      const tx = tg && tg.z > it.z - 3 ? tg.x : centerX(course, it.z) + (it.x - centerX(course, it.z - SNOWBALL_V * dt));
      it.x += clamp(tx - it.x, -22 * dt, 22 * dt);
      it.y = ground(course, it.x, it.z) + 0.9;
      const o = world.dyn.get(it.id); if (o) o.mesh.position.set(it.x, it.y, it.z);
      if (Math.random() < 0.6) world.particles.emit(it.x, it.y, it.z - 0.5, (Math.random() - 0.5), 0.5, -2, 0.4, 0xffffff, -2);
      if (it.age > 6 || it.z > course.L + 20 || (tg && it.z > tg.z + 12)) removeItem(it.id, true);
    }
  }
  // Treffer prüft nur der Getroffene: der eigene Fahrer hier, die Bots beim Host
  function itemHits(k, selfId) {
    for (const it of [...items.values()]) {
      if (it.owner === selfId && it.age < 0.8) continue;
      const dx = it.x - k.x, dz = it.z - k.z, rr = it.kind === "ice" ? 1.5 : 1.4;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (it.kind === "ice" && k.air) continue;
      if (Math.abs(it.y - k.y) > 2.2) continue;
      const got = hit(k, it.kind);
      if (got || k.starT > 0) { net && net.send("hit", [it.id]); removeItem(it.id, true); }
    }
  }
  // Bots: Items mit etwas Verzögerung und Verstand einsetzen
  function botItems(b, dt) {
    const inv = b.inv, k = b.k;
    if (inv.rolling > 0) { inv.rolling -= dt; if (inv.rolling <= 0) { inv.rolling = 0; inv.item = drawItem(k.z); inv.count = inv.item === "cocoa3" ? 3 : 1; b.useT = 0.6 + Math.random() * 1.8; } return; }
    if (!inv.item || k.crashT > 0 || k.air || b.fin < Infinity) return;
    b.useT -= dt; if (b.useT > 0) return;
    const rows = allRiders().filter((r) => r.id !== b.id && r.t === Infinity);
    let ok = true;
    if (inv.item === "snowball") ok = rows.some((r) => r.z - k.z > 6 && r.z - k.z < 110);
    else if (inv.item === "ice") ok = rows.some((r) => k.z - r.z > 3 && k.z - r.z < 40) || b.useT < -8;
    if (ok) { useItem(k, inv, b.id, b.idx); b.useT = 0.5 + Math.random(); }
  }

  // ---------- Ziel / Ergebnis ----------
  function finishMe() {
    finished = true; finT = raceT; results.set(meId, finT); if (!firstFinAt) firstFinAt = performance.now();
    net && net.send("fin", { t: +finT.toFixed(3) });
    if (solo) {
      const key = bestKey(spec);
      if (!prevBest || finT < prevBest) { store.set(key, +finT.toFixed(3)); recordNew = true; }
      say("Ziel!", "gold", 2200, prevBest ? (finT < prevBest ? "−" : "+") + Math.abs(finT - prevBest).toFixed(2) + " s zur Bestzeit" : "");
    } else {
      const r = rank() + 1;
      say(r === 1 ? "Erster!" : "Platz " + r, "gold", 2200, fmtTime(finT));
    }
    resultsAt = performance.now() + 1800;
  }
  function allRiders() {
    const rows = [{ id: meId, name: players[myIdx].name || "Du", idx: myIdx, me: true, bot: false, t: finished ? finT : Infinity, z: me.z }];
    for (const r of rem.values()) if (!r.left) rows.push({ id: r.id, name: r.name, idx: r.idx, me: false, bot: r.bot, t: r.finT, z: r.z });
    for (const b of bots) rows.push({ id: b.id, name: b.name, idx: b.idx, me: false, bot: true, t: b.fin, z: b.k.z });
    return rows;
  }
  function standings() {
    const rows = allRiders();
    rows.sort((a, b) => (a.t < Infinity || b.t < Infinity ? a.t - b.t || 0 : b.z - a.z));
    return rows;
  }
  function rank() {
    const my = finished ? 1e9 - finT : me.z;
    let r = 0;
    for (const o of allRiders()) { if (o.me) continue; const s = o.t < Infinity ? 1e9 - o.t : o.z; if (s > my) r++; }
    return r;
  }
  function checkDone(now) {
    if (phase !== "race" || resultShown || !finished || now < resultsAt) return;
    const humans = [...rem.values()].filter((k) => !k.left && !k.bot);
    const all = allRiders().every((r) => r.t < Infinity);
    const humansDone = humans.every((k) => k.finT < Infinity);
    const grace = firstFinAt && now - firstFinAt > FINISH_GRACE * 1000;
    if (solo || all || grace || (humansDone && now - firstFinAt > 8000)) { resultShown = true; phase = "done"; renderResults(); }
  }
  function renderResults() {
    const rows = standings();
    const host = isHost();
    const best = solo ? store.get(bestKey(spec), 0) : 0;
    const mine = rows.findIndex((r) => r.me) + 1;
    const title = solo ? "Geschafft!" : mine === 1 ? "Du hast gewonnen!" : "Platz " + mine;
    resEl.innerHTML = `<div class="pj-card"><h2>${esc(title)}${solo && recordNew ? '<span class="pj-new">NEUE BESTZEIT</span>' : ""}</h2>
      <p class="sub">${esc(spec.name)} · ${myGear === "board" ? "Snowboard" : "Ski"}</p>
      <table class="pj-res"><tr><th>#</th><th>Fahrer</th><th>Zeit</th></tr>
      ${rows.map((r, i) => `<tr class="${r.me ? "me" : ""}"><td>${i + 1}</td><td><i style="background:${cssHex(colorOf(r.idx))}"></i>${esc(r.name)}${r.bot ? '<span class="bot">BOT</span>' : ""}</td><td>${r.t < Infinity ? fmtTime(r.t) : "nicht im Ziel"}</td></tr>`).join("")}</table>
      <div class="pj-stats"><span>Spitze ${Math.round(stats.top * KMH)} km/h</span><span>${stats.tricks} ${stats.tricks === 1 ? "Trick" : "Tricks"}${stats.best ? " · bester " + stats.best + "°" : ""}</span><span>${stats.crashes} ${stats.crashes === 1 ? "Sturz" : "Stürze"}</span>${solo && best ? `<span>Bestzeit ${fmtTime(best)}</span>` : ""}</div>
      <div class="pj-btnrow">${host ? `<button class="pj-go" data-again>Nochmal</button><button class="pj-sec2" data-menu>${solo ? "Piste wählen" : "Andere Piste"}</button>` : `<button class="pj-go" disabled>Warte auf den Host …</button>`}</div></div>`;
    resEl.hidden = false;
  }
  resEl.addEventListener("click", (e) => {
    if (!isHost()) return;
    if (e.target.closest("[data-again]")) startRace();
    else if (e.target.closest("[data-menu]")) { net && net.send("menu", {}); showMenu(); }
  });

  // ---------- Simulation ----------
  const othersFor = (self) => {
    const list = [];
    const w = (k) => ({ x: k.x, z: k.z, y: k.y, vx: k.vx, vz: k.vz, star: k.starT > 0 });
    if (self !== me) list.push(w(me));
    for (const r of rem.values()) if (!r.left && r.seen) list.push({ x: r.x, z: r.z, y: r.y, vx: r.tvx, vz: r.tvz, star: !!(r.flags & 128) });
    for (const b of bots) if (b.k !== self) list.push(w(b.k));
    return list;
  };
  function handleEvents() {
    for (const e of me.events) {
      if (e.startsWith("trick:")) {
        const deg = +e.slice(6); stats.tricks++; stats.best = Math.max(stats.best, deg);
        say(deg + "°!", "gold", 1300, "Turbo!"); shake = Math.max(shake, 0.25);
        burst(me.x, me.y + 0.3, me.z, pal.sun, 16, 5);
      } else if (e === "land") { say("Saubere Landung", "good", 900); burst(me.x, me.y + 0.2, me.z, 0xf2f7ff, 12, 4); }
      else if (e === "touch") burst(me.x, me.y + 0.2, me.z, 0xf2f7ff, 6, 3);
      else if (e.startsWith("crash:")) {
        stats.crashes++; shake = 1;
        const why = e.slice(6);
        say(CRASH_MSG[why] || "Sturz!", "bad", 1100);
        burst(me.x, me.y + 0.6, me.z, 0xffffff, 26, 6);
      } else if (e === "boost") { shake = Math.max(shake, 0.25); if (!me.air) say("Kakao-Turbo!", "gold", 700); }
      else if (e === "yeti") { say("Yeti-Kraft!", "gold", 1200); shake = Math.max(shake, 0.4); }
      else if (e === "smash") { shake = Math.max(shake, 0.5); burst(me.x, me.y + 1, me.z, 0xffffff, 20, 7); }
      else if (e === "bump") shake = Math.max(shake, 0.35);
      else if (e === "net") shake = Math.max(shake, 0.3);
    }
    me.events.length = 0;
  }
  function simStep() {
    if (phase !== "race" && phase !== "done") return;
    const inp = finished ? { steer: readInput().steer, tuck: false, push: false, brake: me.z > course.L + 25 } : readInput();
    step(me, inp, DT, course, othersFor(me));
    stats.top = Math.max(stats.top, speedOf(me));
    if (!finished && me.crashT <= 0) pickBoxes(me, myInv, true);
    if (itemPress) { itemPress = false; if (!myInv.rolling && me.crashT <= 0 && !finished) useItem(me, myInv, meId, myIdx); }
    itemHits(me, meId);
    handleEvents();
    if (!finished && me.z >= course.L) finishMe();
    // Bots (nur Host)
    for (const b of bots) {
      const k = b.k, fin = b.fin < Infinity;
      const bi = fin ? { steer: 0, tuck: false, brake: k.z > course.L + 25 } : botInput(k, b.brain, course, time);
      step(k, bi, DT, course, othersFor(k));
      for (const e of k.events) {
        if (e === "air") botTakeoff(k, b.brain);
        else if (e.startsWith("crash") || e === "smash") burst(k.x, k.y + 0.6, k.z, 0xffffff, 18, 5);
      }
      k.events.length = 0;
      if (!fin && k.crashT <= 0) pickBoxes(k, b.inv, false);
      botItems(b, DT);
      itemHits(k, b.id);
      if (!fin && k.z >= course.L) { b.fin = raceT; results.set(b.id, raceT); if (!firstFinAt) firstFinAt = performance.now(); net && net.send("fin", { t: +raceT.toFixed(3), id: b.id }); }
    }
    if (++sendN % SEND_EVERY === 0 && net) {
      net.send("k", pack(me, myFlags(me, finished, myGear)));
      if (bots.length && isHost()) net.send("b", bots.map((b) => [b.idx - players.length, ...pack(b.k, myFlags(b.k, b.fin < Infinity, b.gear))]));
    }
  }

  // ---------- Frame ----------
  const frameLim = window.Perf ? Perf.limiter() : () => true;
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    // battery: 60 fps cap while racing (also on 120 Hz screens), 30 fps in the menu, nothing while the tab is hidden
    if (document.hidden || !frameLim(now, phase === "menu" ? 30 : 60)) return;
    tick(now);
  }
  function tick(now) {
    const dt = clamp((now - (last || now)) / 1000, 0, 0.05); last = now; time += dt;
    if (!world) return;
    if (phase === "countdown") { cd -= dt; countdownTick(); if (cd <= 0) goRace(); }
    if (phase === "race") raceT += dt;
    if (phase === "race" || phase === "done") {
      acc += dt; let n = 0;
      while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
      if (acc > DT) acc = 0;
    }

    if (myInv.rolling > 0) { myInv.rolling -= dt; if (myInv.rolling <= 0) { myInv.rolling = 0; myInv.item = drawItem(me.z); myInv.count = myInv.item === "cocoa3" ? 3 : 1; } }
    if (phase === "race" || phase === "done") updateItems(dt);

    // andere Fahrer nachführen
    for (const r of rem.values()) {
      if (r.left || !r.seen) { if (r.model && !r.left) r.model.set({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, t: time }); continue; }
      const age = Math.min(0.3, (performance.now() - r.tAt) / 1000);
      const ex = r.tx + r.tvx * age, ez = r.tz + r.tvz * age, k = Math.min(1, dt * 11);
      r.x += (ex - r.x) * k; r.z += (ez - r.z) * k; r.y += (r.ty - r.y) * k; r.yaw += angDiff(r.tyaw, r.yaw) * k;
      r.spin += (r.tspin - r.spin) * Math.min(1, dt * 14);
      const crash = !!(r.flags & 2), air = !!(r.flags & 1);
      if (crash) r.tumble += dt; else r.tumble = 0;
      const gy = ground(course, r.x, r.z);
      if (phase !== "menu") riderFx({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, vx: r.tvx, vz: r.tvz, air, crash, turbo: !!(r.flags & 4) }, Math.abs(r.steer) * Math.hypot(r.tvx, r.tvz) * 0.25);
      r.model.set({ x: r.x, y: Math.max(r.y, gy), z: r.z, yaw: r.yaw, spin: r.spin, steer: r.steer, tuck: r.flags & 8 ? 1 : 0, crash: crash ? 1 : 0, tumble: r.tumble, inv: r.flags & 64 ? 1 : 0, star: !!(r.flags & 128), t: time, gy, air });
    }
    for (const b of bots) {
      const k = b.k, gy = ground(course, k.x, k.z);
      if (phase !== "menu") riderFx({ x: k.x, y: k.y, z: k.z, yaw: k.yaw, vx: k.vx, vz: k.vz, air: k.air, crash: k.crashT > 0, turbo: k.turboT > 0 }, k.carve);
      b.model.set({ x: k.x, y: k.y, z: k.z, yaw: k.yaw, spin: k.spin, steer: k.steer, tuck: k.tuck, crash: k.crashT > 0 ? 1 : 0, tumble: k.tumble, inv: k.inv, star: k.starT > 0, t: time, gy, air: k.air });
    }
    {
      const gy = ground(course, me.x, me.z);
      if (phase === "race" || phase === "done") riderFx({ x: me.x, y: me.y, z: me.z, yaw: me.yaw, vx: me.vx, vz: me.vz, air: me.air, crash: me.crashT > 0, turbo: me.turboT > 0 }, me.carve);
      meModel.set({ x: me.x, y: me.y, z: me.z, yaw: me.yaw, spin: me.spin, steer: me.steer, tuck: me.tuck, crash: me.crashT > 0 ? 1 : 0, tumble: me.tumble, inv: me.inv, star: me.starT > 0, t: time, gy, air: me.air });
    }

    camera(dt);
    world.update(dt, time);
    world.render(phase === "menu" ? 30 : 60);
    if (phase !== "menu") { hudUpdate(); checkDone(performance.now()); }
  }

  const camPos = new T.Vector3(), camLook = new T.Vector3();
  function camera(dt) {
    const cam = world.camera, portrait = cam.aspect < 1;
    if (phase === "menu") {
      // Blick vom Startplateau den Hang hinunter, leicht schwenkend
      const a = time * 0.16, cz = -15, cx = centerX(course, cz) + Math.sin(a) * 4, gy = ground(course, cx, cz);
      cam.position.set(cx, gy + 4.2 + Math.sin(a * 1.3) * 0.6, cz);
      const lz = 26, lx = centerX(course, lz) + Math.sin(a * 0.7) * 6;
      cam.lookAt(lx, ground(course, lx, lz) + 1, lz);
      cam.fov = portrait ? 72 : 58; cam.updateProjectionMatrix();
      return;
    }
    const sp = speedOf(me), frac = clamp(sp / 32, 0, 1.4);
    // Blick folgt der Fahrtrichtung (nicht der Drehung in der Luft)
    const target = sp > 3 ? Math.atan2(me.vx, me.vz) : me.crashT > 0 ? camDir : me.yaw;
    camDir += angDiff(target, camDir) * Math.min(1, dt * (me.air ? 2 : 4));
    const dist = (portrait ? 7.6 : 6.6) + frac * 1.4 + (me.turboT > 0 ? 0.8 : 0), h = (portrait ? 3.8 : 3.3) + frac * 0.4;
    const sx = Math.sin(camDir), cz = Math.cos(camDir);
    camPos.set(me.x - sx * dist, me.y + h, me.z - cz * dist);
    camPos.y = Math.max(camPos.y, ground(course, camPos.x, camPos.z) + 1.4);
    const ax = me.x + sx * 16, az = me.z + cz * 16;
    camLook.set(ax, Math.min(me.y + 0.6, ground(course, ax, az) + 0.8 + (me.air ? (me.y - ground(course, me.x, me.z)) * 0.5 : 0)), az);
    shake = Math.max(0, shake - dt * 2.4);
    if (shake > 0) { camPos.x += (Math.random() - 0.5) * shake * 0.5; camPos.y += (Math.random() - 0.5) * shake * 0.4; camPos.z += (Math.random() - 0.5) * shake * 0.5; }
    cam.position.copy(camPos); cam.lookAt(camLook);
    camFov = lerp(camFov, (portrait ? 70 : 62) + frac * (portrait ? 6 : 12) + (me.turboT > 0 ? 6 : 0), Math.min(1, dt * 4));
    if (Math.abs(cam.fov - camFov) > 0.05) { cam.fov = camFov; cam.updateProjectionMatrix(); }
  }

  // ---------- HUD ----------
  let hudCache = {};
  const setTxt = (key, node, v) => { if (hudCache[key] !== v) { hudCache[key] = v; node.textContent = v; } };
  const itemNodes = { box: $(".pj-item"), ic: $(".pj-item .ic"), n: $(".pj-item .n"), l: $(".pj-item .l"), key: $(".pj-item .key") };
  function hudItem() {
    const shown = myInv.rolling > 0 ? ["cocoa", "ice", "snowball", "yeti"][Math.floor(time * 12) % 4] : myInv.item;
    const key = myInv.rolling > 0 ? "roll" + shown : myInv.item + ":" + myInv.count;
    if (hudCache.item === key) return;
    hudCache.item = key;
    itemNodes.ic.innerHTML = shown ? ICONS[shown] : "";
    itemNodes.n.textContent = myInv.item === "cocoa3" && myInv.count > 1 ? "×" + myInv.count : "";
    itemNodes.l.textContent = !myInv.rolling && myInv.item ? ITEM_NAME[myInv.item] : "";
    itemNodes.key.hidden = isTouch || !myInv.item || store.get("pistenjagd_item_uses", 0) >= 5;
    itemNodes.box.classList.toggle("roll", myInv.rolling > 0); itemNodes.box.classList.toggle("ready", !myInv.rolling && !!myInv.item);
  }
  const nodes = { pos: $(".pj-pos"), time: $(".pj-time"), speed: $(".pj-speed b"), bar: $(".pj-speed .bar i"), board: $(".pj-board"), prog: $(".pj-prog") };
  let progDots = new Map();
  function buildProgress() {
    nodes.prog.innerHTML = ""; progDots = new Map();
    for (const r of allRiders()) {
      const d = document.createElement("i"); d.style.background = cssHex(colorOf(r.idx)); if (r.me) d.className = "me";
      nodes.prog.appendChild(d); progDots.set(r.id, d);
    }
  }
  let t250 = 0;
  function hudUpdate() {
    setTxt("time", nodes.time, fmtTime(Math.max(0, finished ? finT : raceT)));
    setTxt("spd", nodes.speed, String(Math.round(speedOf(me) * KMH)));
    nodes.bar.style.width = clamp(speedOf(me) / 40, 0, 1) * 100 + "%";
    hudItem();
    const n = performance.now();
    if (n - t250 < 200) return;
    t250 = n;
    const rows = standings();
    for (const r of rows) { const d = progDots.get(r.id); if (d) d.style.top = clamp(r.z / course.L, 0, 1) * 100 + "%"; }
    if (solo) return;
    const rk = rank() + 1, total = rows.length;
    if (hudCache.rk !== rk + "/" + total) { hudCache.rk = rk + "/" + total; nodes.pos.className = "pj-pos p" + rk; nodes.pos.innerHTML = `${rk}<span>/${total}</span>`; }
    nodes.board.innerHTML = rows.map((s, i) => `<div class="${s.me ? "me" : ""}"><i style="background:${cssHex(colorOf(s.idx))}"></i>${i + 1}. ${esc(s.name)}${s.t < Infinity ? `<b>${fmtTime(s.t)}</b>` : ""}</div>`).join("");
  }

  // ---------- Start ----------
  loadWorld();
  renderMenu();
  raf = requestAnimationFrame(frame);

  return {
    go() { if (net) { net.send("gear", { g: myGear }); if (isHost()) pushSel(); } },
    menu() { if (isHost()) { net && net.send("menu", {}); showMenu(); } },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      for (const f of offs.splice(0)) { try { f(); } catch {} }
      ro.disconnect(); clearTimeout(msgTimer);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
      if (world) { disposeModels(); world.dispose(); }
      host.remove();
    },
  };
}
