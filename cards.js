// Gemeinsames Kartenbild für alle Kartenspiele (Solitär, Blackjack, ...).
// Die Karten sind fertige SVG-Dateien unter cards/<deck>/ (Lizenzen: cards/LICENSES.md),
// werden beim ersten Gebrauch geladen und in der gezeichneten Größe zwischengespeichert.
// Zeichnet auf einem Canvas-2D-Kontext, unabhängig von p5.
// Suit-Index: 0 = ♠, 1 = ♥, 2 = ♦, 3 = ♣ — die Spiele rechnen immer so.
// Die Wahl gilt global pro Browser (localStorage "games_card_deck").
(function () {
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = ["S", "H", "D", "C"];

  // dir = Ordner unter cards/, ten = Dateiname der Zehn, back = Rückseite (sonst <dir>/1B.svg)
  const BK = (n) => "cards/backs/" + n + ".svg";
  const DECKS = [
    { id: "skat",       name: "Skat (Altenburger Stil)", dir: "skat",     ten: "T", back: BK("skat") },
    { id: "standard",   name: "Standard (Goodall)",  dir: "standard",   ten: "T", back: BK("d3_red") },
    { id: "plain",      name: "Schlicht",            dir: "plain",      ten: "T", back: BK("d2_black") },
    { id: "fourcolour", name: "Vier Farben",         dir: "fourcolour", ten: "T", back: BK("d3_green") },
    { id: "blue",       name: "Blau",                dir: "blue",       ten: "T", back: BK("d3_blue") },
    { id: "grey",       name: "Grau",                dir: "grey",       ten: "T", back: BK("d2_lightblue") },
    { id: "ghost",      name: "Ghost",               dir: "ghost",      ten: "T", back: BK("d1_black") },
    { id: "symmetric",  name: "Symmetrisch",         dir: "symmetric",  ten: "T", back: BK("d2_blue") },
    { id: "super",      name: "Großer Index",        dir: "super",      ten: "T", back: BK("d2_red") },
    { id: "knoll",      name: "Klassisch (Knoll)",   dir: "knoll",      ten: "10", back: BK("d3_black") },
  ];

  const imgs = new Map();     // url -> { img, ok }
  const scaled = new Map();   // url|w|h -> canvas

  function load(url) {
    let e = imgs.get(url);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.onload = () => { e.ok = true; };
      e.img.src = url;
      imgs.set(url, e);
    }
    return e;
  }

  function fileOf(D, rank, suit) {
    const r = rank === 1 ? "A" : rank === 10 ? D.ten : RANKS[rank];
    return "cards/" + D.dir + "/" + r + SUITS[suit] + ".svg";
  }
  const backOf = (D) => D.back || "cards/" + D.dir + "/1B.svg";

  function preload(D) {
    load(backOf(D));
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) load(fileOf(D, r, s));
  }

  // draws the image at (x,y,w,h); cached at the current device scale so big SVGs are rasterised once
  function blit(ctx, url, x, y, w, h) {
    const e = load(url);
    if (!e.ok) {                                  // not loaded yet: plain card-coloured placeholder
      ctx.save(); ctx.fillStyle = "#f4f1ea"; ctx.strokeStyle = "rgba(0,0,0,.25)";
      ctx.beginPath(); ctx.roundRect(x, y, w, h, w * 0.08); ctx.fill(); ctx.stroke(); ctx.restore();
      return;
    }
    const m = ctx.getTransform();
    const k = Math.hypot(m.c, m.d) || 1;            // vertical scale: flips squeeze x only
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    const key = url + "|" + pw + "|" + ph;
    let c = scaled.get(key);
    if (!c) {
      c = document.createElement("canvas"); c.width = pw; c.height = ph;
      c.getContext("2d").drawImage(e.img, 0, 0, pw, ph);
      scaled.set(key, c);
      if (scaled.size > 600) scaled.delete(scaled.keys().next().value);
    }
    ctx.drawImage(c, x, y, w, h);
  }

  function face(ctx, x, y, w, h, rank, suit, o = {}) { blit(ctx, fileOf(o.deck || current(), rank, suit), x, y, w, h); }
  function back(ctx, x, y, w, h, o = {}) { blit(ctx, backOf(o.deck || current()), x, y, w, h); }

  // ---- selection, global per browser ----
  const KEY = "games_card_deck";
  let idx = 0;
  try { const i = DECKS.findIndex((d) => d.id === localStorage.getItem(KEY)); if (i >= 0) idx = i; } catch {}
  const listeners = [];
  function current() { return DECKS[idx]; }
  function select(id) {
    const i = DECKS.findIndex((d) => d.id === id);
    if (i < 0 || i === idx) return current();
    idx = i;
    try { localStorage.setItem(KEY, current().id); } catch {}
    preload(current());
    listeners.forEach((f) => f(current()));
    return current();
  }
  function cycle() { return select(DECKS[(idx + 1) % DECKS.length].id); }

  // ---- Auswahlmenü: Kacheln mit Vorderseite (Q♥) + Rückseite, geöffnet unter dem Button ----
  const CSS = `
.pc-menu{position:fixed;z-index:500;width:min(420px,calc(100vw - 24px));max-height:min(70vh,560px);overflow-y:auto;padding:6px;
  display:grid;grid-template-columns:1fr 1fr;gap:2px;background:var(--modal-bg,var(--panel,#222));color:var(--ink,#eee);
  border:var(--border-w,1px) solid var(--panel-edge,#555);border-radius:var(--r-md,12px);box-shadow:0 16px 40px -12px rgba(0,0,0,.5)}
.pc-opt{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;cursor:pointer;
  border-radius:calc(var(--r-sm,8px)*.7);text-align:center;font:inherit;font-size:13px;color:inherit}
.pc-opt:hover,.pc-opt:focus-visible{background:var(--panel-2,#333)}
.pc-opt[aria-checked="true"]{outline:2px solid var(--accent,#6cf);outline-offset:-2px}
.pc-pair{display:flex;gap:6px}
.pc-pair img{width:56px;height:auto;aspect-ratio:5/7;display:block;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.35);background:#fff}
@media (max-width:420px){.pc-menu{grid-template-columns:1fr}}`;
  let menu = null, menuBtn = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", closeMenu);
  }
  const onOutside = (e) => { if (menu && !menu.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) closeMenu(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };
  function openMenu(btn) {
    if (menu) { const same = menuBtn === btn; closeMenu(); if (same) return; }
    if (!document.getElementById("pc-style")) {
      const st = document.createElement("style"); st.id = "pc-style"; st.textContent = CSS; document.head.appendChild(st);
    }
    menuBtn = btn;
    menu = document.createElement("div");
    menu.className = "pc-menu"; menu.setAttribute("role", "menu");
    menu.innerHTML = DECKS.map((d) => `<button class="pc-opt" type="button" role="menuitemradio" data-id="${d.id}" aria-checked="${d === current()}">
      <span class="pc-pair"><img src="${fileOf(d, 12, 1)}" alt=""><img src="${backOf(d)}" alt=""></span><span>${d.name}</span></button>`).join("");
    menu.addEventListener("click", (e) => {
      const o = e.target.closest(".pc-opt"); if (!o) return;
      e.stopPropagation();
      select(o.dataset.id);
      menu.querySelectorAll(".pc-opt").forEach((x) => x.setAttribute("aria-checked", String(x === o)));
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
    const top = Math.min(r.bottom + 8, window.innerHeight - 160);
    menu.style.top = top + "px";
    menu.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + "px";
    menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - mw - 12)) + "px";
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeMenu);
  }
  preload(current());

  window.PlayingCards = { decks: DECKS, ranks: RANKS, current, cycle, select, openMenu, face, back, preload, onChange: (f) => listeners.push(f) };
})();
