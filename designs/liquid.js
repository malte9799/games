// Liquid morph — metaball blob field behind the page, a rippling title, and a
// blob that chases the pointer and melts into the others.
DESIGN_FX.liquid = {
  enter() {
    const fx = document.createElement("div");
    fx.className = "liq-fx";
    fx.setAttribute("aria-hidden", "true");
    fx.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><defs>
        <filter id="liq-goo" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="b"/>
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/>
        </filter>
        <filter id="liq-ripple" x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="1" seed="4" result="t"/>
          <feDisplacementMap in="SourceGraphic" in2="t" scale="9" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs></svg>
      <div class="liq-goo"><i></i><i></i><i></i><i></i><i></i><b></b></div>`;
    document.body.prepend(fx);

    const ptr = fx.querySelector("b");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const P = window.Perf;
    let tx = innerWidth * 0.5, ty = innerHeight * 0.4, x = tx, y = ty;
    const move = (e) => { tx = e.clientX; ty = e.clientY; };

    // background blobs: pairs drift together, fuse into a peanut shape, and part again.
    // One loop (30 fps — the goo filter re-blurs the whole screen on every change) drives the blobs AND the
    // pointer blob; it pauses when the tab is hidden or the page has been idle, and is off in lite mode.
    const blobs = [...fx.querySelectorAll(".liq-goo i")];
    let sized = [];
    const measure = () => { sized = blobs.map((el) => ({ el, r: parseFloat(getComputedStyle(el).width) / 2 })); };
    measure();
    blobs.forEach((el) => { el.style.animation = "none"; el.style.left = "0px"; el.style.top = "0px"; });
    const t0 = performance.now();
    const place = (el, px, py, r) => { el.style.transform = `translate(${(px - r).toFixed(1)}px, ${(py - r).toFixed(1)}px)`; };
    const pairs = [[0, 1], [2, 3]];
    const draw = (now) => {
      const t = now - t0, W = innerWidth, H = innerHeight;
      pairs.forEach(([a, b], k) => {
        const A = sized[a], B = sized[b];
        if (!A || !B) return;
        const cx = W * (0.5 + 0.34 * Math.sin(t * 0.00004 + k * 2.1));
        const cy = H * (0.5 + 0.28 * Math.sin(t * 0.000055 + k * 1.3 + 0.7));
        const ang = t * 0.00012 + k * 1.7;
        const reach = A.r + B.r;
        const sep = 0.5 + 0.5 * Math.sin(t * 0.00028 + k * 2.4);   // 0 = fused, 1 = apart
        const D = reach * (0.55 + 0.9 * sep);                       // < reach overlaps → neck
        const ux = Math.cos(ang) * D / 2, uy = Math.sin(ang) * D / 2;
        place(A.el, cx + ux, cy + uy, A.r);
        place(B.el, cx - ux, cy - uy, B.r);
      });
      const L = sized[4];
      if (L) place(L.el, W * (0.5 + 0.4 * Math.sin(t * 0.00003 + 4)), H * (0.5 + 0.32 * Math.cos(t * 0.00004 + 1)), L.r);
      // pointer blob
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      const v = Math.min(1.7, 1 + Math.hypot(tx - x, ty - y) / 260);
      ptr.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${v.toFixed(3)})`;
    };
    const onResize = () => { measure(); if (!loop) draw(performance.now()); };
    let loop = null, offPerf = null;
    const sync = () => {
      const on = !reduce && !(P && P.lite);
      if (on && !loop) { loop = P ? P.loop(draw, { fps: 30, idle: true }) : null; if (loop) loop.start(); }
      else if (!on && loop) { loop.stop(); loop = null; }
    };
    if (reduce) ptr.style.display = "none";
    else addEventListener("pointermove", move, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    draw(performance.now());
    sync();
    if (P) offPerf = P.onChange(sync);

    return () => {
      if (loop) loop.stop();
      if (offPerf) offPerf();
      removeEventListener("pointermove", move); removeEventListener("resize", onResize);
      fx.remove();
    };
  },

  // gloss that follows the pointer across each card
  card(el) {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
      el.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
    });
  },
};
