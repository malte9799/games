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
    { id: "standard",   name: "Standard (Goodall)",  dir: "standard",   ten: "T", back: BK("goodall-red") },
    { id: "plain",      name: "Schlicht",            dir: "plain",      ten: "T", back: BK("illusion-red") },
    { id: "fourcolour", name: "Vier Farben",         dir: "fourcolour", ten: "T", back: BK("maze-red") },
    { id: "old",        name: "Alter Stil",          dir: "old",        ten: "T" },
    { id: "blue",       name: "Blau",                dir: "blue",       ten: "T", back: BK("goodall-blue") },
    { id: "grey",       name: "Grau",                dir: "grey",       ten: "T", back: BK("illusion-grey") },
    { id: "ghost",      name: "Ghost",               dir: "ghost",      ten: "T", back: BK("maze-grey") },
    { id: "symmetric",  name: "Symmetrisch",         dir: "symmetric",  ten: "T", back: BK("illusion-blue") },
    { id: "super",      name: "Großer Index",        dir: "super",      ten: "T", back: BK("maze-blue") },
    { id: "knoll",      name: "Klassisch (Knoll)",   dir: "knoll",      ten: "10", back: BK("goodall-green") },
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
  function cycle() {
    idx = (idx + 1) % DECKS.length;
    try { localStorage.setItem(KEY, current().id); } catch {}
    preload(current());
    listeners.forEach((f) => f(current()));
    return current();
  }
  preload(current());

  window.PlayingCards = { decks: DECKS, ranks: RANKS, current, cycle, face, back, preload, onChange: (f) => listeners.push(f) };
})();
