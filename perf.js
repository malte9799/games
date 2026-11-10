// Perf — shared battery / CPU / GPU helpers (classic script, global `Perf`).
//
//  • html.perf-hidden  while the tab is hidden        → CSS pauses decorative animations
//  • html.perf-idle    after IDLE_MS without input     → same, and JS effect loops stop
//  • html.perf-lite    reduced motion, battery saver (low battery, not charging) or a weak device
//
//  Perf.limiter()            frame limiter for a requestAnimationFrame callback: `if (!lim(now, fps)) return;`
//  Perf.loop(fn, opts)       a managed rAF loop: fps cap, pauses when hidden (and when idle, if opts.idle)
//  Perf.pixelRatio(max)      devicePixelRatio, capped (lower in lite mode)
//  Perf.lite                 true in lite mode
//  Perf.onChange(cb)         called when hidden/idle/lite changes
(function () {
  if (window.Perf) return;
  const root = document.documentElement;
  const IDLE_MS = 45000;
  const listeners = new Set();
  const reduceMq = matchMedia("(prefers-reduced-motion: reduce)");

  const P = {
    hidden: document.hidden,
    idle: false,
    lite: false,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    // true while the page is worth animating (visible; and, with {idle:true}, recently used)
    live(opts) { return !P.hidden && !(opts && opts.idle && P.idle); },
    pixelRatio(max) {
      const dpr = window.devicePixelRatio || 1;
      return Math.min(dpr, P.lite ? Math.min(max, 1.25) : max);
    },
    limiter() {
      // Cadence-based: keeps the cap exact on 60/120/144 Hz screens (a plain "now - last >= gap" check aliases to 48 fps on 144 Hz).
      let next = 0, prev = 0, ft = 16.7;
      return function (now, fps) {
        if (prev) ft += (Math.min(now - prev, 100) - ft) * 0.1;   // running estimate of the display's frame interval
        prev = now;
        if (P.lite) fps = Math.min(fps, 30);
        if (!document.hasFocus()) fps = Math.min(fps, 30);
        const gap = 1000 / fps;
        if (!next) next = now;
        if (now < next - ft * 0.5) return false;
        next = now > next + gap ? now + gap : next + gap;
        return true;
      };
    },
    // Managed loop: fn(now, dt) with dt in seconds. Returns { stop(), start() }.
    loop(fn, opts) {
      opts = opts || {};
      const fps = opts.fps || 60;
      let id = 0, running = false, lastRun = 0;
      const lim = P.limiter();
      const tick = (now) => {
        id = 0;
        if (!running) return;
        if (!P.live(opts)) return;                 // paused; resumed by onChange below
        id = requestAnimationFrame(tick);
        if (!lim(now, typeof fps === "function" ? fps() : fps)) return;
        const dt = Math.min(0.1, (now - (lastRun || now)) / 1000);
        lastRun = now;
        fn(now, dt);
      };
      const kick = () => { if (running && !id && P.live(opts)) { lastRun = 0; id = requestAnimationFrame(tick); } };
      const off = P.onChange(kick);
      return {
        start() { running = true; kick(); },
        stop() { running = false; if (id) cancelAnimationFrame(id); id = 0; off(); },
      };
    },
  };

  function emit() {
    root.classList.toggle("perf-hidden", P.hidden);
    root.classList.toggle("perf-idle", P.idle);
    root.classList.toggle("perf-lite", P.lite);
    listeners.forEach((cb) => { try { cb(P); } catch (e) { /* ignore */ } });
  }

  document.addEventListener("visibilitychange", () => { P.hidden = document.hidden; emit(); });

  // idle detection: any input wakes the page up again
  let idleT = 0;
  const arm = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (!P.idle) { P.idle = true; emit(); } }, IDLE_MS); };
  let lastAct = 0;
  const act = () => {
    const n = performance.now();
    if (n - lastAct < 400 && !P.idle) return;   // throttle: pointermove fires constantly
    lastAct = n;
    if (P.idle) { P.idle = false; emit(); }
    arm();
  };
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((t) => addEventListener(t, act, { passive: true, capture: true }));
  arm();

  // lite mode: reduced motion, weak device, or battery saver
  let lowBattery = false;
  const calcLite = () => {
    const weak = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    const lite = reduceMq.matches || !!weak || lowBattery;
    if (lite !== P.lite) { P.lite = lite; emit(); }
  };
  if (reduceMq.addEventListener) reduceMq.addEventListener("change", calcLite);
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => { lowBattery = !b.charging && b.level <= 0.25; calcLite(); };
      b.addEventListener("levelchange", upd); b.addEventListener("chargingchange", upd); upd();
    }).catch(() => {});
  }
  calcLite();
  emit();

  window.Perf = P;
})();
