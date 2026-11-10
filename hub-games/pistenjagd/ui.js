// Pistenjagd — Oberfläche: HUD, Menü, Ergebnis, Touch-Steuerung (DOM/CSS im Shadow DOM).
// Akzentfarben kommen als CSS-Variablen (--acc, --acc2) aus der Design-Palette, gesetzt von game.js.

import { PRE } from "./course.js";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmtTime = (t) => {
  if (!isFinite(t)) return "—";
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
};

export const GEAR_ICON = {
  ski: `<svg viewBox="0 0 48 48"><path d="M10 6l8 34M22 6l8 34" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M14 40c2 3 6 3 8 0M26 40c2 3 6 3 8 0" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M36 8v30M40 8v30" stroke="currentColor" stroke-width="2" opacity=".6"/></svg>`,
  board: `<svg viewBox="0 0 48 48"><rect x="17" y="3" width="14" height="42" rx="7" fill="none" stroke="currentColor" stroke-width="4"/><path d="M19 14h10M19 34h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
};

// Item-Symbole (Winter-Versionen der Kart-Items)
export const ICONS = {
  cocoa: `<svg viewBox="0 0 64 64"><path d="M22 6c-4 6 4 8 0 14M32 4c-4 6 4 8 0 14M42 6c-4 6 4 8 0 14" stroke="#fff" stroke-opacity=".75" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M12 24h36v18c0 9-7 16-16 16h-4c-9 0-16-7-16-16z" fill="#e8383d"/><path d="M48 30h4c4 0 6 3 6 7s-3 7-7 7h-4" stroke="#e8383d" stroke-width="5" fill="none"/><rect x="12" y="24" width="36" height="7" fill="#6b3b1f"/><path d="M18 40h24" stroke="#fff" stroke-width="3" stroke-opacity=".6"/></svg>`,
  ice: `<svg viewBox="0 0 64 64"><path d="M32 6l20 12v28L32 58 12 46V18z" fill="#9fd8ff" stroke="#3a8fd1" stroke-width="3" stroke-linejoin="round"/><path d="M32 6v52M12 18l40 28M52 18L12 46" stroke="#fff" stroke-opacity=".6" stroke-width="2.5"/><circle cx="24" cy="22" r="4" fill="#fff"/></svg>`,
  snowball: `<svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="22" fill="#fff" stroke="#9fb6d6" stroke-width="3"/><circle cx="24" cy="27" r="5" fill="#dce8f6"/><circle cx="40" cy="40" r="4" fill="#dce8f6"/><path d="M6 20l8 4M4 32h9M6 44l8-4" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
  yeti: `<svg viewBox="0 0 64 64"><path d="M14 30c0-14 8-22 18-22s18 8 18 22v14c0 8-8 14-18 14s-18-6-18-14z" fill="#f2f6ff" stroke="#9fb6d6" stroke-width="3"/><path d="M14 30l-8-6M50 30l8-6" stroke="#9fb6d6" stroke-width="4" stroke-linecap="round"/><ellipse cx="32" cy="34" rx="12" ry="10" fill="#7fb3e6"/><circle cx="27" cy="31" r="2.5" fill="#1a2233"/><circle cx="37" cy="31" r="2.5" fill="#1a2233"/><path d="M26 38q6 5 12 0" stroke="#1a2233" stroke-width="2.5" fill="#fff"/></svg>`,
};
ICONS.cocoa3 = ICONS.cocoa;
export const ITEM_NAME = { cocoa: "Heißer Kakao", cocoa3: "3× Kakao", ice: "Eisplatte", snowball: "Schneeball", yeti: "Yeti-Kraft" };

// Große Illustrationen für die Auswahl Ski / Snowboard (Jacke in der Akzentfarbe)
export const GEAR_ART = {
  ski: `<svg viewBox="0 0 140 110" aria-hidden="true">
    <g fill="#fff" opacity=".55"><circle cx="18" cy="84" r="5"/><circle cx="10" cy="74" r="3.5"/><circle cx="26" cy="92" r="4"/><circle cx="8" cy="90" r="2.5"/></g>
    <path d="M14 96 L124 74" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M24 104 L130 83" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <path d="M118 75q8-2 9-7M124 84q8-2 9-7" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M50 46 L30 96" stroke="#cfd8e6" stroke-width="3" stroke-linecap="round"/><path d="M88 44 L104 90" stroke="#cfd8e6" stroke-width="3" stroke-linecap="round"/>
    <path d="M64 62 L56 78 L64 93" stroke="#2e3445" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M74 62 L78 78 L88 88" stroke="#2e3445" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M58 36 Q70 30 80 38 L78 64 Q68 68 60 62 Z" fill="var(--acc)"/>
    <path d="M62 42 L50 50 L48 44" stroke="var(--acc)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M78 42 L88 48 L88 42" stroke="var(--acc)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="72" cy="24" r="9" fill="#f1c59a"/><path d="M62 23a10 10 0 0 1 20 0z" fill="var(--acc)"/><rect x="65" y="21" width="14" height="5" rx="2.5" fill="#ffd23f"/>
  </svg>`,
  board: `<svg viewBox="0 0 140 110" aria-hidden="true">
    <g fill="#fff" opacity=".55"><circle cx="16" cy="80" r="5"/><circle cx="8" cy="70" r="3.5"/><circle cx="24" cy="90" r="4"/><circle cx="34" cy="96" r="3"/></g>
    <rect x="22" y="84" width="104" height="13" rx="6.5" transform="rotate(-10 74 90)" fill="#fff"/>
    <rect x="44" y="83" width="14" height="6" rx="2" transform="rotate(-10 74 90)" fill="var(--acc2)"/><rect x="88" y="83" width="14" height="6" rx="2" transform="rotate(-10 74 90)" fill="var(--acc2)"/>
    <path d="M66 60 L54 72 L52 86" stroke="#2e3445" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M78 60 L90 70 L94 82" stroke="#2e3445" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M62 34 Q72 28 82 36 L80 62 Q70 66 62 60 Z" fill="var(--acc)"/>
    <path d="M64 40 L46 44 L36 38" stroke="var(--acc)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M80 40 L98 46 L108 42" stroke="var(--acc)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="73" cy="22" r="9" fill="#f1c59a"/><path d="M63 21a10 10 0 0 1 20 0z" fill="var(--acc)"/><rect x="66" y="19" width="14" height="5" rx="2.5" fill="#ffd23f"/>
  </svg>`,
};

// Schwierigkeit wie auf echten Pisten: blau, rot, schwarz
export const LEVEL = { sonnenhang: ["blau", "Leicht"], tannen: ["rot", "Mittel"], schanzen: ["rot", "Mittel"], rinne: ["schwarz", "Schwer"] };
export const levelOf = (sp) => LEVEL[sp.id] || (sp.steep > 0.235 || sp.width < 29 ? ["schwarz", "Schwer"] : ["rot", "Mittel"]);

// Kopfbild des Menüs: Bergkette mit Schnee, ein paar Tannen
export const HERO_ART = `<svg class="pj-hero-art" viewBox="0 0 900 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path d="M0 140 L0 92 L90 40 L150 78 L240 18 L330 84 L410 46 L500 96 L590 30 L680 80 L760 50 L840 88 L900 62 L900 140 Z" fill="rgba(255,255,255,.16)"/>
  <path d="M240 18 L212 40 L226 38 L240 48 L256 36 L268 40 Z M590 30 L566 48 L580 46 L592 56 L606 44 L618 48 Z M90 40 L70 52 L84 52 L94 60 L104 50 Z" fill="rgba(255,255,255,.7)"/>
  <path d="M0 140 L0 116 Q120 96 240 112 T480 106 T720 114 T900 102 L900 140 Z" fill="rgba(255,255,255,.92)"/>
  <g fill="rgba(20,60,50,.75)"><path d="M120 112 l10-26 10 26z"/><path d="M136 114 l8-20 8 20z"/><path d="M700 112 l11-30 11 30z"/><path d="M720 114 l8-20 8 20z"/><path d="M800 106 l9-24 9 24z"/></g>
</svg>`;

// Piste von oben als kleine SVG-Linie (Start links, Ziel rechts) mit Schanzen-Punkten
export function slopeSvg(c, color = "#fff") {
  const pts = [], W = 180, H = 70, L = c.L;
  let mx = 1;
  for (let z = 0; z <= L; z += 20) mx = Math.max(mx, Math.abs(c.CX[Math.round(z + PRE)]) + c.HW[Math.round(z + PRE)]);
  const sx = (z) => 8 + (z / L) * (W - 16), sy = (x) => H / 2 + (x / mx) * (H / 2 - 8);
  for (let z = 0; z <= L; z += 15) pts.push(sx(z).toFixed(1) + "," + sy(c.CX[Math.round(z + PRE)]).toFixed(1));
  const dots = c.ramps.map((p) => `<circle cx="${sx(p.z).toFixed(1)}" cy="${sy(c.CX[Math.round(p.z + PRE)] + p.lat).toFixed(1)}" r="3.5" fill="var(--acc)"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}"><polyline points="${pts.join(" ")}" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

export const CSS = `
.pj { --acc: #ffc21a; --acc2: #9b7bff; --pj-font: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; position: absolute; inset: 0; overflow: hidden; background: #0b1020; color: #fff; border-radius: 14px; user-select: none; -webkit-user-select: none; touch-action: none; font-family: var(--pj-font); line-height: 1.3; letter-spacing: normal; text-transform: none; -webkit-tap-highlight-color: transparent; }
.pj * { box-sizing: border-box; }
.pj.pj-full { border-radius: 0; }
.pj-view, .pj-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pj button { font: inherit; cursor: pointer; margin: 0; }
[hidden] { display: none !important; }

.pj-hud { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.pj-glass { background: rgba(10,14,30,.74);border: 1px solid rgba(255,255,255,.16); border-radius: 14px; }
.pj-top { position: absolute; left: 50%; top: calc(var(--pj-top, 0px) + 10px); transform: translateX(-50%); padding: 6px 18px; text-align: center; font-weight: 800; }
.pj-time { font: 800 24px/1.1 ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
.pj-best { font-size: 11px; opacity: .78; letter-spacing: .03em; min-height: 1.2em; }
.pj-pos { position: absolute; left: 14px; top: calc(var(--pj-top, 0px) + 12px); padding: 6px 14px 8px; border-radius: 14px; background: rgba(10,14,30,.6); font: 900 italic 48px/0.9 var(--pj-font); text-shadow: 0 3px 0 rgba(0,0,0,.45); }
.pj-pos:empty { display: none; }
.pj-pos span { font-size: 20px; opacity: .8; margin-left: 2px; }
.pj-pos.p1 { color: var(--acc); }
.pj-board { position: absolute; left: 14px; top: calc(var(--pj-top, 0px) + 80px); width: 160px; display: grid; gap: 3px; font-size: 12px; font-weight: 700; }
.pj-board div { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; background: rgba(10,14,30,.5); white-space: nowrap; overflow: hidden; }
.pj-board div.me { background: rgba(255,255,255,.9); color: #10142a; }
.pj-board i, .pj-res i, .pj-plist i { width: 10px; height: 10px; border-radius: 50%; flex: none; display: inline-block; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.pj-board b { margin-left: auto; opacity: .8; font-variant-numeric: tabular-nums; }
.pj-prog { position: absolute; right: 18px; top: calc(var(--pj-top, 0px) + 70px); bottom: 130px; width: 8px; border-radius: 4px; background: rgba(10,14,30,.45); box-shadow: 0 0 0 1px rgba(255,255,255,.25); }
.pj-prog::after { content: "ZIEL"; position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 900; letter-spacing: .1em; }
.pj-prog i { position: absolute; left: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; box-shadow: 0 0 0 2px #fff; }
.pj-prog i.me { width: 16px; height: 16px; margin: -8px 0 0 -8px; z-index: 2; box-shadow: 0 0 0 3px #fff, 0 2px 6px rgba(0,0,0,.5); }
.pj-speed { position: absolute; right: 44px; bottom: 16px; width: 150px; padding: 8px 12px 10px; text-align: right; }
.pj-speed b { font: 900 italic 38px/1 var(--pj-font); font-variant-numeric: tabular-nums; } .pj-speed small { font-size: 12px; font-weight: 700; opacity: .8; margin-left: 4px; }
.pj-speed .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,.16); margin-top: 6px; overflow: hidden; }
.pj-speed .bar i { display: block; height: 100%; width: 0; background: var(--acc); border-radius: 3px; transition: width .1s; }
.pj-item { position: absolute; left: 14px; bottom: 16px; width: 74px; height: 74px; display: grid; place-items: center; }
.pj-item svg { width: 52px; height: 52px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
.pj-item .key { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 8px; min-width: 30px; padding: 4px 9px; border-radius: 8px; background: rgba(255,255,255,.92); color: #10142a; font: 800 16px/1 ui-monospace, Menlo, monospace; text-align: center; box-shadow: 0 3px 0 rgba(0,0,0,.35); }
.pj-item .n { position: absolute; right: 5px; bottom: 3px; font: 900 italic 18px/1 var(--pj-font); text-shadow: 0 2px 0 rgba(0,0,0,.6); }
.pj-item .l { position: absolute; left: 0; right: 0; top: -18px; text-align: center; font-size: 11px; font-weight: 700; white-space: nowrap; text-shadow: 0 1px 2px #000; }
.pj-item.roll svg { animation: pj-roll .16s steps(1) infinite; }
.pj-item.ready { animation: pj-pulse .9s ease-in-out infinite; border-color: var(--acc); }
@keyframes pj-pulse { 50% { transform: scale(1.07); } }
@keyframes pj-roll { 0% { transform: scale(1.05); } 50% { transform: scale(.9); } }
.pj-b-item { right: 30px; bottom: 140px; width: 80px; height: 80px; border-color: var(--acc2); }
.pj.touch .pj-item { left: auto; right: 132px; bottom: 112px; width: 62px; height: 62px; } .pj.touch .pj-item svg { width: 42px; height: 42px; } .pj.touch .pj-item .key { display: none; }
.pj-tools { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: auto; }
.pj-ico { min-width: 40px; height: 40px; padding: 0 12px; border-radius: 12px; color: #fff; font-size: 17px; font-weight: 700; display: grid; place-items: center; }
.pj-msg { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); font: 900 italic 40px/1 var(--pj-font); text-shadow: 0 4px 0 rgba(0,0,0,.5); text-align: center; white-space: nowrap; opacity: 0; transition: opacity .25s; }
.pj-msg small { display: block; font-size: 18px; margin-top: 6px; }
.pj-msg.on { opacity: 1; } .pj-msg.bad { color: #ff7b7b; } .pj-msg.good { color: #8dffb0; } .pj-msg.gold { color: var(--acc); }
.pj-center { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 3; }
.pj-count { font: 900 italic 170px/1 var(--pj-font); text-shadow: 0 8px 0 rgba(0,0,0,.4); animation: pj-pop .9s ease-out both; }
.pj-count.go { color: var(--acc); font-size: 140px; }
@keyframes pj-pop { 0% { transform: scale(2.2); opacity: 0; } 25% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: 0; } }

.pj-menu, .pj-result { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: calc(var(--pj-top, 0px) + 14px) 14px 14px; overflow: auto; background: linear-gradient(rgba(8,10,24,.35), rgba(8,10,24,.72)); }
.pj-card { flex: none; width: min(860px, 100%); margin: auto; padding: 18px 20px 20px; border-radius: 22px; background: rgba(14,18,40,.86); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.pj-card h2 { margin: 0; font: 900 italic 32px/1.05 var(--pj-font); }
.pj-card h2 em { color: var(--acc); font-style: italic; }
.pj-card .sub { margin: 8px 0 12px; opacity: .75; font-size: 14px; }
.pj-sec { margin: 14px 0 6px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; opacity: .65; }
.pj-slopes { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
.pj-sl { padding: 8px; border-radius: 14px; background: rgba(255,255,255,.07); border: 2px solid transparent; color: #fff; text-align: left; display: grid; gap: 3px; }
.pj-sl svg { width: 100%; height: 56px; display: block; }
.pj-sl b { font-size: 14px; } .pj-sl small { font-size: 11px; opacity: .7; line-height: 1.25; }
.pj-sl .rec { font-size: 11px; font-weight: 800; color: var(--acc); font-variant-numeric: tabular-nums; }
.pj-sl.sel { border-color: var(--acc); background: rgba(255,255,255,.14); }
.pj-sl[disabled] { cursor: default; } .pj-sl:not([disabled]):hover { background: rgba(255,255,255,.14); }
.pj-row2 { display: flex; flex-wrap: wrap; gap: 6px 28px; }
.pj-seg { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.pj-seg button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; background: rgba(255,255,255,.09); color: #fff; font-weight: 800; border: 2px solid transparent; }
.pj-seg button svg { width: 20px; height: 20px; }
.pj-seg button.sel { border-color: var(--acc); background: rgba(255,255,255,.16); }
.pj-seg button[disabled] { cursor: default; opacity: .8; }
.pj-plist { display: flex; flex-wrap: wrap; gap: 6px; }
.pj-plist span { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.09); font-size: 13px; font-weight: 700; }
.pj-plist svg { width: 15px; height: 15px; opacity: .8; }
.pj-go { margin-top: 16px; width: 100%; padding: 14px 18px; border-radius: 16px; border: 0; background: var(--acc); color: #1a1200; font: 900 italic 22px/1 var(--pj-font); box-shadow: 0 5px 0 rgba(0,0,0,.35); }
.pj-go:active { transform: translateY(3px); box-shadow: 0 2px 0 rgba(0,0,0,.35); }
.pj-go[disabled] { background: rgba(255,255,255,.14); color: #fff; box-shadow: none; cursor: default; opacity: .85; font-size: 16px; }
.pj-help { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; opacity: .78; }
.pj-help kbd { display: inline-block; min-width: 20px; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.16); font: 700 11px ui-monospace, Menlo, monospace; text-align: center; }
.pj-res { width: 100%; border-collapse: collapse; margin-top: 10px; font-variant-numeric: tabular-nums; }
.pj-res td, .pj-res th { padding: 7px 8px; text-align: left; font-size: 15px; }
.pj-res th { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .6; }
.pj-res tr.me td { background: rgba(255,255,255,.1); } .pj-res td:first-child { font: 900 italic 20px/1 var(--pj-font); width: 40px; }
.pj-res i { margin-right: 7px; }
.pj-res .bot { opacity: .6; font-size: 11px; margin-left: 4px; }
.pj-btnrow { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.pj-btnrow .pj-go { margin: 0; flex: 1 1 200px; } .pj-btnrow .pj-sec2 { flex: 1 1 160px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.12); color: #fff; font-weight: 800; border: 0; }
.pj-new { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: var(--acc); color: #1a1200; font: 900 12px/1.4 var(--pj-font); vertical-align: middle; }
.pj-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.pj-stats span { padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.09); font-size: 12px; font-weight: 700; }

/* --- Menü (neu) --- */
.pj-card.menu { width: min(940px, 100%); padding: 0 0 18px; overflow: hidden; background: linear-gradient(180deg, rgba(18,24,52,.94), rgba(12,16,36,.96)); }
.pj-hero { position: relative; padding: 20px 22px 74px; background: linear-gradient(135deg, var(--acc2), #3474d8 70%); overflow: hidden; }
.pj-hero-art { position: absolute; left: 0; right: 0; bottom: -1px; width: 100%; height: 70px; }
.pj-hero h2 { position: relative; z-index: 1; font-size: 40px; line-height: 1.1; text-shadow: 0 3px 0 rgba(0,0,0,.2); }
.pj-hero h2 em { color: #fff; } .pj-hero h2 span { color: var(--acc); }
.pj-hero .sub { position: relative; z-index: 1; margin: 6px 0 0; opacity: .95; max-width: 600px; line-height: 1.35; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
.pj-hero .badge { position: absolute; right: 18px; top: 18px; padding: 5px 12px; border-radius: 999px; background: rgba(0,0,0,.28); font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.pj-hero .flake { position: absolute; color: #fff; opacity: .5; font-size: 18px; animation: pj-fall 7s linear infinite; }
@keyframes pj-fall { from { transform: translateY(-30px) rotate(0); } to { transform: translateY(140px) rotate(180deg); } }
.pj-body { padding: 4px 22px 0; }
.pj-step { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font-size: 13px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; opacity: .8; }
.pj-step i { width: 22px; height: 22px; border-radius: 50%; background: var(--acc); color: #1a1200; font-style: normal; display: grid; place-items: center; font-size: 12px; letter-spacing: 0; }
.pj-gear { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pj-gear button { position: relative; display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 8px; min-height: 132px; padding: 10px 16px 10px 8px; border-radius: 18px; border: 3px solid rgba(255,255,255,.1); background: linear-gradient(160deg, rgba(120,170,255,.22), rgba(255,255,255,.05)); color: #fff; text-align: left; transition: transform .12s, border-color .12s, background .12s; }
.pj-gear button:hover { transform: translateY(-2px); background: linear-gradient(160deg, rgba(120,170,255,.3), rgba(255,255,255,.08)); }
.pj-gear button svg { width: 150px; height: 118px; }
.pj-gear b { display: block; font: 900 italic 26px/1 var(--pj-font); }
.pj-gear small { display: block; margin-top: 6px; font-size: 13px; opacity: .78; line-height: 1.3; }
.pj-gear button.sel { border-color: var(--acc); box-shadow: 0 0 0 4px rgba(255,255,255,.06), 0 10px 28px rgba(0,0,0,.35); background: linear-gradient(160deg, rgba(120,170,255,.36), rgba(255,255,255,.1)); }
.pj-gear button.sel::after { content: "✓"; position: absolute; right: 10px; top: 10px; width: 28px; height: 28px; border-radius: 50%; background: var(--acc); color: #1a1200; font-weight: 900; display: grid; place-items: center; }
.pj-sl { position: relative; padding: 10px; }
.pj-sl .lvl { position: absolute; right: 8px; top: 8px; display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; opacity: .9; }
.pj-sl .lvl i { width: 13px; height: 13px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.85); }
.pj-sl .lvl.blau i { background: #2f7df6; } .pj-sl .lvl.rot i { background: #e8383d; } .pj-sl .lvl.schwarz i { background: #111; border-radius: 2px; transform: rotate(45deg) scale(.85); }
.pj-sl .meta { margin-top: 2px; display: flex; gap: 6px; flex-wrap: wrap; } .pj-sl .meta span { padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,.1); font-size: 10.5px; font-weight: 700; }
.pj-mp { display: flex; flex-wrap: wrap; gap: 6px 28px; }
.pj-card.menu .pj-go { margin-top: 18px; padding: 16px; font-size: 24px; }
@media (max-width: 760px) {
  .pj-hero h2 { font-size: 30px; } .pj-hero { padding: 16px 16px 46px; } .pj-hero .badge { display: none; } .pj-body { padding: 0 14px; }
  .pj-gear button { grid-template-columns: 1fr; justify-items: center; text-align: center; min-height: 0; padding: 8px; } .pj-gear button svg { width: 120px; height: 92px; } .pj-gear b { font-size: 20px; } .pj-gear small { display: none; }
}
@media (max-height: 520px) {
  .pj-hero { padding: 10px 16px 30px; } .pj-hero .sub { display: none; } .pj-hero-art { height: 40px; } .pj-hero h2 { font-size: 26px; }
  .pj-gear button { min-height: 0; grid-template-columns: 90px 1fr; } .pj-gear button svg { width: 90px; height: 64px; } .pj-gear small { display: none; } .pj-step { margin: 8px 0 5px; }
}

.pj-touch { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.pj-pad { position: absolute; left: 0; top: 30%; bottom: 0; width: 55%; pointer-events: auto; }
.pj-pad .hint { position: absolute; left: 24px; bottom: 26px; font-size: 38px; opacity: .38; font-weight: 900; }
.pj-pad .ring { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; border: 3px solid rgba(255,255,255,.45); background: rgba(255,255,255,.08); display: none; }
.pj-pad .knob { position: absolute; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%; background: rgba(255,255,255,.75); display: none; }
.pj-pad.on .ring, .pj-pad.on .knob { display: block; }
.pj-b { position: absolute; pointer-events: auto; border-radius: 50%; border: 3px solid rgba(255,255,255,.6); background: rgba(255,255,255,.16); color: #fff; font: 900 italic 14px/1 var(--pj-font); display: grid; place-items: center;}
.pj-b.on { background: rgba(255,255,255,.5); transform: scale(.94); }
.pj-b-tuck { right: 20px; bottom: 22px; width: 104px; height: 104px; font-size: 18px; border-color: var(--acc); }
.pj-b-brake { right: 140px; bottom: 18px; width: 76px; height: 76px; border-color: #ff9a9a; }
.pj.touch .pj-tools { bottom: auto; top: calc(var(--pj-top, 0px) + 84px); left: 8px; transform: none; flex-direction: column; }
.pj.touch .pj-speed { right: auto; left: 50%; transform: translateX(-50%); bottom: auto; top: calc(var(--pj-top, 0px) + 76px); width: auto; padding: 3px 12px; }
.pj.touch .pj-speed b { font-size: 20px; } .pj.touch .pj-speed .bar { display: none; }
.pj.touch .pj-prog { bottom: 150px; }
.pj:not(.touch) .pj-touch { display: none; }

@media (max-width: 760px), (max-height: 520px) {
  .pj-pos { font-size: 34px; left: 10px; } .pj-pos span { font-size: 15px; }
  .pj-board { display: none; }
  .pj-top { padding: 4px 12px; top: calc(var(--pj-top, 0px) + 6px); } .pj-time { font-size: 18px; }
  .pj-msg { font-size: 28px; } .pj-count { font-size: 110px; }
  .pj-card { padding: 14px; } .pj-card h2 { font-size: 24px; } .pj-sl svg { height: 44px; }
}
@media (max-width: 760px) { .pj-slopes { grid-template-columns: repeat(2, 1fr); } }
@media (max-height: 520px) { .pj.touch .pj-tools { top: calc(var(--pj-top, 0px) + 60px); } .pj-slopes { grid-template-columns: repeat(5, 1fr); gap: 6px; } .pj-sl { padding: 5px; } .pj-sl small, .pj-sl .rec { display: none; } .pj-sl svg { height: 32px; } .pj-card .sub, .pj-help { display: none; } .pj-sec { margin: 8px 0 4px; } .pj-go { margin-top: 10px; padding: 10px; font-size: 18px; } }
`;

export const TEMPLATE = `
<div class="pj-view"></div>
<div class="pj-hud" hidden>
  <div class="pj-pos"></div>
  <div class="pj-board"></div>
  <div class="pj-top pj-glass"><div class="pj-time">0:00.00</div><div class="pj-best"></div></div>
  <div class="pj-prog"></div>
  <div class="pj-speed pj-glass"><b>0</b><small>km/h</small><div class="bar"><i></i></div></div>
  <div class="pj-item pj-glass"><div class="ic"></div><kbd class="key">E</kbd><span class="n"></span><div class="l"></div></div>
  <div class="pj-msg"></div>
  <div class="pj-tools">
    <button class="pj-ico pj-glass" data-a="reset" title="Zurück auf die Piste (R)">↺</button>
    <button class="pj-ico pj-glass" data-a="full" title="Vollbild (F)">⛶</button>
  </div>
</div>
<div class="pj-center" hidden></div>
<div class="pj-touch" hidden>
  <div class="pj-pad"><div class="hint">◀ ▶</div><div class="ring"></div><div class="knob"></div></div>
  <button class="pj-b pj-b-brake" data-k="brake">BREMSE</button>
  <button class="pj-b pj-b-tuck" data-k="tuck">HOCKE</button>
  <button class="pj-b pj-b-item" data-k="item">ITEM</button>
</div>
<div class="pj-menu" hidden></div>
<div class="pj-result" hidden></div>`;
