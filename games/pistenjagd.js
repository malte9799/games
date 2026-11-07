// Pistenjagd (Solo) — Zeitfahren bergab auf vier Pisten plus Zufallspiste, gegen die eigene Bestzeit.
// Spielt dieselbe Engine wie der Mehrspieler-Modus im Hub (hub-games/pistenjagd/); hier ohne Netz, ohne Gegner.
// Die Seite nutzt die Kopfleiste des Spielerahmens (fullscreen), das Spiel selbst rendert in Three.js.

let PJ = null;

initGame({
  title: "Pistenjagd",
  tag: "Ski · Snowboard · Bestzeit",
  fullscreen: true,
  presets: [{ label: "Zeitfahren", values: [0] }],
  buttons: [
    { id: "btn-menu", label: "Piste wählen", primary: true, onClick: () => PJ && PJ.menu() },
  ],
  sliders: [],
  onPreset: () => {},
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gefahren",
    text: [
      "Fahre so schnell wie möglich den Berg hinunter ins Ziel – auf Ski oder Snowboard. A/D oder ←/→ lenken, die Leertaste geht in die Hocke (deutlich schneller, aber schwerer zu lenken), W oder ↑ schiebt mit den Stöcken an, wenn du langsam bist, S oder ↓ bremst.",
      "Tannen, Felsen und Schneemänner werfen dich um. Auf den Schanzen drehst du dich in der Luft mit Links/Rechts: Landest du gerade (180°, 360°, …), gibt es Turbo – je mehr Drehung, desto länger. Schief gelandet heißt Sturz. R setzt dich zurück auf die Piste, Enter startet neu.",
      "Fahr durch die Geschenke: Heißer Kakao gibt Turbo, Yeti-Kraft macht dich ein paar Sekunden unaufhaltsam (im Mehrspieler gibt es auch Eisplatten und Schneebälle für die Gegner). E oder Shift setzt das Item ein.",
      "Am Handy: links ziehen zum Lenken, rechts HOCKE, BREMSE und ITEM.",
    ].join(" "),
  },
});

// Info-Animation: Fahrer schwingt um eine Tanne, springt über die Schanze und dreht sich
function infoAnim(p, w, h, f) {
  p.background(...PAL.board);
  const t = (f % 120) / 120;
  // Hang: helle Schneefläche, schräg nach unten
  p.noStroke();
  p.fill(240, 245, 252); p.quad(0, h * 0.35, w, h * 0.12, w, h, 0, h);
  p.fill(225, 234, 246); p.quad(0, h * 0.35, w, h * 0.12, w, h * 0.2, 0, h * 0.43);
  // Netze
  p.stroke(...PAL.rose); p.strokeWeight(3); p.line(0, h * 0.95, w, h * 0.72);
  p.noStroke();
  // Tanne
  const tree = (x, y, s) => { p.fill(...PAL.mint.map((v) => v * 0.55)); p.triangle(x - 22 * s, y, x + 22 * s, y, x, y - 56 * s); p.fill(250); p.triangle(x - 8 * s, y - 40 * s, x + 8 * s, y - 40 * s, x, y - 56 * s); p.fill(90, 60, 40); p.rect(x - 3 * s, y, 6 * s, 8 * s); };
  tree(w * 0.3, h * 0.58, 1);
  tree(w * 0.86, h * 0.44, 0.7);
  // Schanze
  const rx = w * 0.56, ry = h * 0.66;
  p.fill(232, 239, 250); p.triangle(rx - 50, ry + 6, rx + 10, ry + 6, rx + 10, ry - 22);
  p.fill(...PAL.sun); p.rect(rx + 6, ry - 24, 6, 30, 2);
  // Fahrerbahn: Schwung um die Tanne, dann Sprung
  let x, y, rot = 0;
  if (t < 0.45) { const u = t / 0.45; x = w * 0.08 + u * (rx - w * 0.08); y = h * 0.52 + u * (ry - h * 0.52) - 4 + Math.sin(u * Math.PI * 2) * 14; }
  else if (t < 0.8) { const u = (t - 0.45) / 0.35; x = rx + u * w * 0.3; y = ry - 26 - Math.sin(u * Math.PI) * 60 + u * 30; rot = u * Math.PI * 2; }
  else { const u = (t - 0.8) / 0.2; x = rx + w * 0.3 + u * w * 0.12; y = ry + 4 + u * 10; }
  p.push(); p.translate(x, y); p.rotate(rot * 0.999);
  p.fill(...PAL.ink); p.rect(-16, 2, 32, 4, 2);
  p.fill(...PAL.sky); p.rect(-6, -20, 12, 20, 4);
  p.fill(...PAL.rose); p.circle(0, -26, 12);
  p.pop();
  // Turbo-Hinweis nach der Landung
  if (t > 0.8) {
    p.fill(...PAL.sun); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLDITALIC); p.textSize(26);
    p.text("360° · Turbo!", w * 0.62, h * 0.2);
    for (let i = 0; i < 6; i++) p.circle(x - 10 - i * 8, y - 6 + Math.sin(i + f) * 3, 5 - i * 0.6);
  }
}

function setup() {
  noCanvas();
  noLoop();
  const wrap = document.getElementById("canvas-wrap");
  wrap.style.touchAction = "none";
  const ui = document.getElementById("ui-overlay");
  const top = ui ? Math.ceil(ui.getBoundingClientRect().height) + 6 : 90;
  new Function("u", "return import(u)")(new URL("hub-games/pistenjagd/game.js", document.baseURI).href)
    .then((m) => m.createPiste({ root: wrap, solo: true, net: null, topInset: top, onFull: (v) => { if (ui) ui.style.display = v ? "none" : ""; wrap.style.zIndex = v ? 99999 : 0; }, players: [{ id: "me", name: "Du" }], me: { id: "me" } }))
    .then((g) => { PJ = g; })
    .catch((e) => { console.error(e); wrap.textContent = "Pistenjagd konnte nicht geladen werden."; });
}
