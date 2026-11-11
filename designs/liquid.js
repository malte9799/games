// Liquid morph — metaball blob field behind the page and a blob that chases the pointer and melts into the others.
//
// The field is computed on a tiny canvas (~1/8 resolution) and scaled up by the browser, so the GPU only composites one
// texture. (The previous version ran a full-screen SVG goo filter — blur + colour matrix — on every frame, which is
// extremely slow in Safari / on integrated GPUs.)
DESIGN_FX.liquid = {
  enter() {
    const fx = document.createElement("div");
    fx.className = "liq-fx";
    fx.setAttribute("aria-hidden", "true");
    const cv = document.createElement("canvas");
    cv.className = "liq-cv";
    fx.appendChild(cv);
    document.body.prepend(fx);
    const ctx = cv.getContext("2d");

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const P = window.Perf;
    let SC = 8;                                     // CSS px per canvas px (grows on big screens: ~22k canvas pixels at most)
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    // size in vmax, inner / outer colour
    const DEF = [
      [46, "#ff6fb0", "#c2306f"], [38, "#7a7bff", "#4a2fd0"], [34, "#5ef0c8", "#1aa3b8"],
      [30, "#ffd666", "#ff8a3d"], [22, "#ba8cff", "#7b4ae6"], [9, "#fff2a8", "#ff8ac8"],   // last = pointer blob
    ];
    const B = DEF.map(([s, a, b]) => ({ s, c1: hex(a), c2: hex(b), x: 0, y: 0, r: 1 }));
    let W = 0, H = 0, cw = 0, ch = 0, img = null, data = null;
    let tx = innerWidth * 0.5, ty = innerHeight * 0.4, px = tx, py = ty, pv = 1;
    const move = (e) => { tx = e.clientX; ty = e.clientY; };

    const measure = () => {
      W = innerWidth; H = innerHeight;
      SC = Math.max(8, Math.round(Math.sqrt(W * H / 22000)));
      cw = Math.max(24, Math.ceil(W / SC)); ch = Math.max(24, Math.ceil(H / SC));
      cv.width = cw; cv.height = ch;
      img = ctx.createImageData(cw, ch); data = img.data;
      const vm = Math.max(W, H) / 100;
      B.forEach((b) => { b.r0 = b.s * vm / 2; });
    };
    measure();

    const t0 = performance.now();
    const pairs = [[0, 1], [2, 3]];
    // blob positions: pairs drift together, fuse into a peanut shape, and part again
    const layout = (now) => {
      const t = now - t0;
      pairs.forEach(([a, b], k) => {
        const A = B[a], Bb = B[b];
        const cx = W * (0.5 + 0.34 * Math.sin(t * 0.00004 + k * 2.1));
        const cy = H * (0.5 + 0.28 * Math.sin(t * 0.000055 + k * 1.3 + 0.7));
        const ang = t * 0.00012 + k * 1.7;
        const reach = A.r0 + Bb.r0;
        const sep = 0.5 + 0.5 * Math.sin(t * 0.00028 + k * 2.4);   // 0 = fused, 1 = apart
        const D = reach * (0.55 + 0.9 * sep);                       // < reach overlaps → neck
        const ux = Math.cos(ang) * D / 2, uy = Math.sin(ang) * D / 2;
        A.x = cx + ux; A.y = cy + uy; Bb.x = cx - ux; Bb.y = cy - uy;
      });
      const L = B[4];
      L.x = W * (0.5 + 0.4 * Math.sin(t * 0.00003 + 4)); L.y = H * (0.5 + 0.32 * Math.cos(t * 0.00004 + 1));
      B.forEach((b) => { b.r = b.r0; });
      // pointer blob
      px += (tx - px) * 0.12; py += (ty - py) * 0.12;
      pv = Math.min(1.7, 1 + Math.hypot(tx - px, ty - py) / 260);
      const Pb = B[5]; Pb.x = px; Pb.y = py; Pb.r = Pb.r0 * pv;
    };

    // metaball field: F = Σ r²/d². Inside where F > 1; colour = blend of the blobs' radial gradients, weighted by their share.
    const N = B.length;
    const draw = () => {
      let o = 0;
      for (let j = 0; j < ch; j++) {
        const y = (j + 0.5) * SC;
        for (let i = 0; i < cw; i++, o += 4) {
          const x = (i + 0.5) * SC;
          let F = 0, wr = 0, wg = 0, wb = 0, wsum = 0;
          for (let k = 0; k < N; k++) {
            const b = B[k], dx = x - b.x, dy = y - b.y;
            const d2 = dx * dx + dy * dy + 1, r2 = b.r * b.r;
            const f = r2 / d2;
            F += f;
            if (f > 0.04) {
              const w = f * f;                                   // dominant blob wins the colour
              const m = Math.min(1, Math.sqrt(d2) / b.r);         // 0 centre → 1 rim
              wr += w * (b.c1[0] + (b.c2[0] - b.c1[0]) * m);
              wg += w * (b.c1[1] + (b.c2[1] - b.c1[1]) * m);
              wb += w * (b.c1[2] + (b.c2[2] - b.c1[2]) * m);
              wsum += w;
            }
          }
          if (F < 0.8 || wsum === 0) { data[o + 3] = 0; continue; }
          const a = F >= 1.2 ? 1 : (F - 0.8) / 0.4;              // soft edge (bilinear upscaling smooths it further)
          data[o] = wr / wsum; data[o + 1] = wg / wsum; data[o + 2] = wb / wsum;
          data[o + 3] = a * a * (3 - 2 * a) * 235;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    const frame = (now) => { layout(now); draw(); };
    const onResize = () => { measure(); frame(performance.now()); };

    // 30 fps (the field is ~35k pixels × 6 blobs of plain arithmetic — a few ms); paused while hidden / idle; static in lite mode
    let loop = null, offPerf = null;
    const sync = () => {
      const on = !reduce && !(P && P.lite);
      if (on && !loop && P) { loop = P.loop(frame, { fps: 30, idle: true }); loop.start(); }
      else if (!on && loop) { loop.stop(); loop = null; }
    };
    if (!reduce) addEventListener("pointermove", move, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    frame(performance.now());
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
