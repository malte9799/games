// Split-flap — titles are built from real two-halves flip tiles that clatter
// through the alphabet before they settle on a letter. Cards flip when they
// scroll into view and re-shuffle on hover; the hero has a live clock.

const _FL_SET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-!?/&'";
const _FL_STEP = 140;   // ms per flip

function _flNorm(s) {
  return [...String(s).toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")]
    .map((c) => (c === "·" || c === "•" || c === "–" || c === "—" || c === "→" ? "-" : c === "×" ? "X" : c === "’" || c === "‘" ? "'" : c === " " ? " " : _FL_SET.includes(c) ? c : "-"));
}

function _flTile(ch) {
  const t = document.createElement("span");
  t.className = "fl"; t.dataset.c = ch;
  t.innerHTML = '<span class="t"><i></i></span><span class="b"><i></i></span>';
  t._i = [...t.querySelectorAll("i")]; // t, b  (the two moving flaps are added only while the tile is flipping)
  t._i.forEach((i) => { i.textContent = ch; });
  return t;
}

// the moving flaps exist only while a tile flips — an idle board is 5 nodes per tile instead of 9
function _flFlaps(tile) {
  if (!tile._ft) {
    const ft = document.createElement("span"), fb = document.createElement("span");
    ft.className = "ft"; fb.className = "fb"; ft.innerHTML = fb.innerHTML = "<i></i>";
    tile.append(ft, fb); tile._ft = ft; tile._fb = fb;
  }
  return [tile._ft, tile._fb];
}
function _flDropFlaps(tile) {
  if (tile._ft) { tile._ft.remove(); tile._fb.remove(); tile._ft = tile._fb = null; }
}

// Flip with the Web Animations API: no class toggling + forced reflow (`void offsetWidth`) per flip, which made
// every flip a synchronous layout of the whole page (≈1.5 ms each, ~2 s of blocked main thread for a full board).
function _flipOnce(tile, next, done) {
  const [ti, bi] = tile._i, old = tile.dataset.c;
  const [ft, fb] = _flFlaps(tile);
  if (tile._anims) tile._anims.forEach((a) => a.cancel());
  ti.textContent = next; ft.firstChild.textContent = old; bi.textContent = old; fb.firstChild.textContent = next;
  tile.classList.add("go");
  tile._anims = [
    ft.animate([{ transform: "rotateX(0)" }, { transform: "rotateX(-90deg)" }], { duration: 70, easing: "ease-in", fill: "forwards" }),
    fb.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0)" }], { duration: 70, delay: 70, easing: "ease-out", fill: "both" }),
  ];
  tile.dataset.c = next;
  setTimeout(() => {
    bi.textContent = next; tile.classList.remove("go");
    if (tile._anims) { tile._anims.forEach((a) => a.cancel()); tile._anims = null; }
    if (done) done();
  }, _FL_STEP);
}

// run the tile through (up to `steps`) characters ending on `target`
function _flSettle(tile, target, steps, delay) {
  const run = (tile._run = {});
  const L = _FL_SET.length, tgt = _FL_SET.indexOf(target);
  const cur = _FL_SET.indexOf(tile.dataset.c);
  if (cur === tgt) return;
  const n = Math.min((tgt - cur + L) % L, steps);
  const seq = [];
  for (let k = n - 1; k >= 0; k--) seq.push(_FL_SET[(tgt - k + L) % L]);
  let i = 0;
  const next = () => { if (tile._run !== run) return; if (i >= seq.length) { _flDropFlaps(tile); return; } _flipOnce(tile, seq[i++], next); };
  setTimeout(() => { if (tile._run === run) next(); }, delay);
}

// build a row of tiles in `host`; returns { tiles, text, play(steps, stagger) }
function _flRow(host, text, opts = {}) {
  const chars = _flNorm(text);
  const row = document.createElement("span");
  row.className = "flrow " + (opts.cls || "");
  row.setAttribute("aria-hidden", "true");
  const tiles = chars.map((c) => { const t = _flTile(" "); row.appendChild(t); return t; });
  host.textContent = "";
  host.setAttribute("aria-label", String(text));
  host.appendChild(row);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const api = {
    row, tiles, text,
    set() { tiles.forEach((t, i) => { t._run = {}; t.dataset.c = chars[i]; t._i.forEach((n) => { n.textContent = chars[i]; }); }); },
    play(steps = 8, stagger = 45, delay = 0) {
      if (reduce) { api.set(); return; }
      tiles.forEach((t, i) => _flSettle(t, chars[i], steps, delay + i * stagger + Math.random() * 60));
    },
    shuffle(steps = 4) {   // jumble, then settle again
      if (reduce) return;
      tiles.forEach((t, i) => {
        if (chars[i] === " ") return;
        t._run = {}; const r = _FL_SET[1 + ((Math.random() * (_FL_SET.length - 1)) | 0)];
        t.dataset.c = r; t._i.forEach((n) => { n.textContent = r; });
        _flSettle(t, chars[i], steps, i * 30);
      });
    },
  };
  return api;
}

DESIGN_FX.flap = {
  enter() {
    const cleanups = [], rows = [];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const home = document.getElementById("home");
    // the hub's solo grid has no .hero: only the old start page gets the big title treatment
    const onHome = !!home && home.style.display !== "none" && !!home.querySelector(".hero");

    if (onHome) {
      const hero = home.querySelector(".hero");
      const h1 = hero.querySelector("h1"), sub = hero.querySelector(".subtitle");
      const h1t = h1.textContent, subt = sub.textContent;

      // station header strip with a live clock
      const bar = document.createElement("div");
      bar.className = "fl-bar";
      bar.innerHTML = '<span>Departures</span><span>Abfahrt</span><span class="grow"></span><span class="clock"><span>Local time</span><span class="hh"></span><span class="colon">:</span><span class="mm"></span></span>';
      hero.prepend(bar);
      const hh = _flRow(bar.querySelector(".hh"), "00", { cls: "amber" }), mm = _flRow(bar.querySelector(".mm"), "00", { cls: "amber" });
      const setClock = (anim) => {
        const d = new Date(), a = String(d.getHours()).padStart(2, "0"), b = String(d.getMinutes()).padStart(2, "0");
        [[hh, a], [mm, b]].forEach(([r, v]) => r.tiles.forEach((t, i) => { if (t.dataset.c !== v[i]) { anim ? _flSettle(t, v[i], 10, i * 90) : (t.dataset.c = v[i], t._i.forEach((n) => { n.textContent = v[i]; })); } }));
      };
      setClock(!reduce);
      const clock = setInterval(() => setClock(true), 15000);

      const title = _flRow(h1, h1t, { cls: "" });
      const subr = _flRow(sub, subt, { cls: "amber" });
      rows.push(title, subr);
      setTimeout(() => { title.play(12, 110, 150); subr.play(6, 22, 900); }, 150);
      const hov = () => title.shuffle(5);
      h1.addEventListener("pointerenter", hov);

      cleanups.push(() => {
        clearInterval(clock); h1.removeEventListener("pointerenter", hov);
        bar.remove();
        h1.textContent = h1t; h1.removeAttribute("aria-label");
        sub.textContent = subt; sub.removeAttribute("aria-label");
      });
    } else {
      const h1 = document.querySelector("#app header h1");
      if (h1) {
        const t = h1.textContent;
        const r = _flRow(h1, t, {});
        r.play(10, 90, 100);
        const hov = () => r.shuffle(5);
        h1.addEventListener("pointerenter", hov);
        cleanups.push(() => { h1.removeEventListener("pointerenter", hov); h1.textContent = t; h1.removeAttribute("aria-label"); });
      }
    }
    return () => cleanups.forEach((c) => c());
  },

  // titles flip as the card scrolls into view, and again on hover
  card(el) {
    const tEl = el.querySelector(".card-title"), dEl = el.querySelector(".card-desc");
    if (!tEl || !dEl) return;
    // title tiles are built only when the card is near the viewport. The description stays plain text (a tile per
    // character made ~1400 extra tiles / 12k nodes on the hub) and just reveals left to right.
    let title = null;
    dEl.classList.add("fl-desc");
    const build = () => { if (!title) title = _flRow(tEl, tEl.textContent, {}); };
    const go = () => { build(); title.play(9, 55, 80); setTimeout(() => dEl.classList.add("on"), 400); };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { threshold: 0.25, rootMargin: "200px" });
      io.observe(el);
    } else go();
    el.addEventListener("pointerenter", () => { if (title) title.shuffle(4); });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) dEl.classList.add("on");
  },
};
