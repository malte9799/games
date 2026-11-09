// Gemeinsames Kartenbild für alle Kartenspiele (Solitär, Blackjack, ...).
// Zeichnet auf einem Canvas-2D-Kontext, unabhängig von p5 und von der Kartengröße.
// Vorbilder: Anglo-amerikanisches Standardblatt (Bicycle-Stil), Vier-Farben-Poker,
// Deutsches Blatt (Eichel · Grün · Herz · Schellen), Spanisches Blatt (Baraja).
// Farben/Suit-Index: 0 = ♠, 1 = ♥, 2 = ♦, 3 = ♣ — die Spiele rechnen immer so.
// Die Wahl gilt global pro Browser (localStorage "games_card_deck").
(function () {
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const lighten = (c, d) => c.map((v) => Math.min(255, v + d));

  const RED = [196, 30, 48], BLACK = [26, 26, 34], BLUE = [30, 84, 176], GREEN = [20, 120, 60];

  const DECKS = [
    { id: "classic", name: "Standard (Bicycle)", kind: "french", ranks: RANKS,
      cols: [BLACK, RED, RED, BLACK], paper: [253, 252, 248], edge: [150, 140, 128],
      back: { field: [176, 24, 44], ink: [255, 255, 255], style: "lattice" } },
    { id: "fourcolor", name: "Poker (4 Farben)", kind: "french", ranks: RANKS,
      cols: [BLACK, [214, 36, 46], [30, 100, 214], [22, 140, 66]], paper: [252, 252, 250], edge: [140, 140, 150],
      back: { field: [24, 56, 120], ink: [226, 232, 250], style: "lattice" } },
    { id: "deutsch", name: "Deutsches Blatt", kind: "german",
      ranks: ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "U", "O", "K"],
      cols: [[38, 128, 62], [196, 34, 40], [214, 150, 30], [120, 76, 36]],
      paper: [248, 241, 220], edge: [120, 88, 48],
      back: { field: [34, 96, 58], ink: [236, 214, 150], style: "ornament" } },
    { id: "spanisch", name: "Spanisches Blatt", kind: "spanish",
      ranks: ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "S", "C", "R"],
      cols: [[30, 74, 140], [186, 36, 44], [212, 154, 24], [38, 112, 54]],
      paper: [250, 244, 226], edge: [130, 96, 52],
      back: { field: [28, 70, 124], ink: [240, 232, 206], style: "arabesque" } },
  ];

  // ---- suit emblems, drawn in a unit box (-.5 .. .5), y down ----
  function emblemPath(ctx, kind) {
    ctx.beginPath();
    switch (kind) {
      case "heart":
        ctx.moveTo(0, 0.46);
        ctx.bezierCurveTo(-0.74, -0.04, -0.42, -0.52, 0, -0.2);
        ctx.bezierCurveTo(0.42, -0.52, 0.74, -0.04, 0, 0.46);
        break;
      case "diamond":
        ctx.moveTo(0, -0.5); ctx.bezierCurveTo(0.1, -0.2, 0.26, -0.08, 0.38, 0);
        ctx.bezierCurveTo(0.26, 0.08, 0.1, 0.2, 0, 0.5);
        ctx.bezierCurveTo(-0.1, 0.2, -0.26, 0.08, -0.38, 0);
        ctx.bezierCurveTo(-0.26, -0.08, -0.1, -0.2, 0, -0.5);
        break;
      case "spade":
        ctx.moveTo(0, -0.5);
        ctx.bezierCurveTo(0.12, -0.28, 0.52, -0.1, 0.5, 0.16);
        ctx.bezierCurveTo(0.48, 0.38, 0.2, 0.42, 0.06, 0.2);
        ctx.bezierCurveTo(0.07, 0.34, 0.12, 0.44, 0.22, 0.5);
        ctx.lineTo(-0.22, 0.5);
        ctx.bezierCurveTo(-0.12, 0.44, -0.07, 0.34, -0.06, 0.2);
        ctx.bezierCurveTo(-0.2, 0.42, -0.48, 0.38, -0.5, 0.16);
        ctx.bezierCurveTo(-0.52, -0.1, -0.12, -0.28, 0, -0.5);
        break;
      case "club":
        ctx.arc(0, -0.25, 0.25, 0, Math.PI * 2); ctx.moveTo(-0.01, 0.1);
        ctx.arc(-0.26, 0.1, 0.25, 0, Math.PI * 2); ctx.moveTo(0.51, 0.1);
        ctx.arc(0.26, 0.1, 0.25, 0, Math.PI * 2);
        ctx.moveTo(0, 0); ctx.lineTo(-0.05, 0.3); ctx.lineTo(-0.2, 0.5); ctx.lineTo(0.2, 0.5);
        ctx.lineTo(0.05, 0.3); ctx.closePath();
        break;
      case "acorn":
        ctx.moveTo(-0.27, -0.02); ctx.bezierCurveTo(-0.27, 0.34, -0.1, 0.5, 0, 0.5);
        ctx.bezierCurveTo(0.1, 0.5, 0.27, 0.34, 0.27, -0.02); ctx.closePath();
        break;
      case "leaf":
        ctx.moveTo(0, -0.5); ctx.bezierCurveTo(0.46, -0.26, 0.46, 0.2, 0.03, 0.46);
        ctx.lineTo(0, 0.5); ctx.lineTo(-0.03, 0.46);
        ctx.bezierCurveTo(-0.46, 0.2, -0.46, -0.26, 0, -0.5);
        break;
      case "bell":
        ctx.arc(0, 0.04, 0.4, 0, Math.PI * 2);
        break;
      case "sword":
        ctx.moveTo(0, -0.52); ctx.lineTo(0.08, -0.36); ctx.lineTo(0.08, 0.2);
        ctx.lineTo(-0.08, 0.2); ctx.lineTo(-0.08, -0.36); ctx.closePath();
        break;
      case "cup":
        ctx.moveTo(-0.4, -0.42); ctx.lineTo(0.4, -0.42);
        ctx.bezierCurveTo(0.42, -0.04, 0.2, 0.1, 0.06, 0.12);
        ctx.lineTo(0.06, 0.3); ctx.lineTo(0.26, 0.4); ctx.lineTo(0.26, 0.48);
        ctx.lineTo(-0.26, 0.48); ctx.lineTo(-0.26, 0.4); ctx.lineTo(-0.06, 0.3);
        ctx.lineTo(-0.06, 0.12);
        ctx.bezierCurveTo(-0.2, 0.1, -0.42, -0.04, -0.4, -0.42); ctx.closePath();
        break;
      case "coin":
        ctx.arc(0, 0, 0.47, 0, Math.PI * 2);
        break;
      case "stick":
        ctx.moveTo(-0.05, 0.5); ctx.lineTo(0.05, 0.5); ctx.lineTo(0.11, -0.18);
        ctx.bezierCurveTo(0.26, -0.3, 0.2, -0.54, 0, -0.54);
        ctx.bezierCurveTo(-0.2, -0.54, -0.26, -0.3, -0.11, -0.18); ctx.closePath();
        break;
    }
  }

  const KINDS = {
    french: ["spade", "heart", "diamond", "club"],
    german: ["leaf", "heart", "bell", "acorn"],
    spanish: ["sword", "cup", "coin", "stick"],
  };

  // one emblem centred on (cx,cy), size s (px), optionally turned by 180°
  function emblem(ctx, D, suit, cx, cy, s, flip) {
    const kind = KINDS[D.kind][suit], col = D.cols[suit];
    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.rotate(Math.PI);
    ctx.scale(s, s);
    ctx.fillStyle = rgb(col);
    ctx.strokeStyle = rgb(col);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const px = 1 / s;                       // one screen pixel in unit space
    emblemPath(ctx, kind);
    if (kind === "club") ctx.fill("nonzero"); else ctx.fill();
    if (kind === "acorn") {
      // cap with scaly texture, stalk
      ctx.fillStyle = rgb(lighten(col, -30));
      ctx.beginPath(); ctx.moveTo(-0.34, -0.04); ctx.bezierCurveTo(-0.36, -0.4, 0.36, -0.4, 0.34, -0.04); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(col); ctx.fillRect(-0.035, -0.5, 0.07, 0.16);
      ctx.strokeStyle = rgb(lighten(col, 80), 0.6); ctx.lineWidth = px * 0.8;
      for (const x of [-0.18, 0, 0.18]) { ctx.beginPath(); ctx.moveTo(x, -0.28); ctx.lineTo(x, -0.06); ctx.stroke(); }
    } else if (kind === "leaf") {
      ctx.strokeStyle = rgb(lighten(col, 110), 0.85); ctx.lineWidth = Math.max(px * 0.9, 0.035);
      ctx.beginPath(); ctx.moveTo(0, -0.4); ctx.lineTo(0, 0.44); ctx.stroke();
      for (const y of [-0.22, -0.02, 0.18]) {
        ctx.beginPath(); ctx.moveTo(0, y + 0.1); ctx.lineTo(-0.2, y - 0.04); ctx.moveTo(0, y + 0.1); ctx.lineTo(0.2, y - 0.04); ctx.stroke();
      }
    } else if (kind === "bell") {
      ctx.fillStyle = rgb(lighten(col, 70), 0.55);
      ctx.beginPath(); ctx.arc(-0.12, -0.1, 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgb(lighten(col, -90), 0.9); ctx.lineWidth = Math.max(px, 0.04);
      ctx.beginPath(); ctx.moveTo(-0.3, 0.3); ctx.lineTo(0.3, 0.3); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -0.48, 0.07, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgb(lighten(col, -90)); ctx.beginPath(); ctx.arc(0, 0.34, 0.06, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "sword") {
      ctx.fillRect(-0.32, 0.2, 0.64, 0.08);                 // guard
      ctx.fillRect(-0.05, 0.28, 0.1, 0.18);                 // grip
      ctx.beginPath(); ctx.arc(0, 0.5, 0.06, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgb(lighten(col, 100), 0.8); ctx.lineWidth = Math.max(px, 0.03);
      ctx.beginPath(); ctx.moveTo(0, -0.4); ctx.lineTo(0, 0.14); ctx.stroke();
    } else if (kind === "coin") {
      ctx.strokeStyle = rgb(lighten(col, 90), 0.85); ctx.lineWidth = Math.max(px, 0.05);
      ctx.beginPath(); ctx.arc(0, 0, 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgb(lighten(col, 90), 0.85); ctx.beginPath(); ctx.arc(0, 0, 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "stick") {
      ctx.fillStyle = rgb(lighten(col, 60));
      ctx.beginPath(); ctx.arc(-0.17, -0.1, 0.07, 0, Math.PI * 2); ctx.arc(0.17, 0.0, 0.07, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "cup") {
      ctx.strokeStyle = rgb(lighten(col, 90), 0.7); ctx.lineWidth = Math.max(px, 0.04);
      ctx.beginPath(); ctx.moveTo(-0.28, -0.3); ctx.lineTo(0.28, -0.3); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- court card figures ----
  // draws a bust in the unit square (0..1), head at the top, cut off at y = 1
  function figure(ctx, D, rank, suit) {
    const sc = D.cols[suit], gold = [232, 188, 74];
    const robes = [[196, 36, 50], [38, 78, 160], [210, 150, 36], [30, 120, 70]];
    const robe = D.kind === "french" ? (suit % 2 ? [38, 78, 160] : [196, 36, 50]) : robes[(suit + rank) % 4];
    const skin = [244, 208, 170], line = "rgba(30,24,20,.85)";
    ctx.lineJoin = "round";
    // hair behind head
    if (rank === 12) { ctx.fillStyle = rgb([196, 140, 52]); ctx.beginPath(); ctx.ellipse(0.5, 0.36, 0.22, 0.32, 0, 0, Math.PI * 2); ctx.fill(); }
    // robe
    ctx.fillStyle = rgb(robe); ctx.strokeStyle = line; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.moveTo(0.04, 1); ctx.bezierCurveTo(0.04, 0.7, 0.18, 0.6, 0.38, 0.56);
    ctx.lineTo(0.62, 0.56); ctx.bezierCurveTo(0.82, 0.6, 0.96, 0.7, 0.96, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
    // trim + diagonal band + collar
    ctx.fillStyle = rgb(gold);
    ctx.beginPath(); ctx.moveTo(0.3, 0.58); ctx.lineTo(0.5, 0.78); ctx.lineTo(0.7, 0.58); ctx.lineTo(0.64, 0.56); ctx.lineTo(0.5, 0.68); ctx.lineTo(0.36, 0.56); ctx.closePath(); ctx.fill();
    ctx.fillRect(0.04, 0.9, 0.92, 0.05);
    ctx.fillStyle = rgb(sc); ctx.beginPath(); ctx.arc(0.5, 0.82, 0.05, 0, Math.PI * 2); ctx.fill();
    // neck + face
    ctx.fillStyle = rgb(skin);
    ctx.fillRect(0.44, 0.46, 0.12, 0.14);
    ctx.beginPath(); ctx.ellipse(0.5, 0.34, 0.15, 0.19, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // beard (King), eyes
    if (rank === 13) {
      ctx.fillStyle = rgb([210, 200, 190]); ctx.beginPath();
      ctx.moveTo(0.36, 0.38); ctx.bezierCurveTo(0.38, 0.6, 0.62, 0.6, 0.64, 0.38); ctx.bezierCurveTo(0.58, 0.46, 0.42, 0.46, 0.36, 0.38); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = line;
    ctx.beginPath(); ctx.arc(0.44, 0.31, 0.017, 0, Math.PI * 2); ctx.arc(0.56, 0.31, 0.017, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(160,60,50,.9)"; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.moveTo(0.46, 0.4); ctx.quadraticCurveTo(0.5, 0.42, 0.54, 0.4); ctx.stroke();
    ctx.strokeStyle = line; ctx.lineWidth = 0.014;
    // headgear + attribute
    if (rank === 13) {                       // crown, sword
      ctx.fillStyle = rgb(gold);
      ctx.beginPath(); ctx.moveTo(0.34, 0.2); ctx.lineTo(0.32, 0.02); ctx.lineTo(0.42, 0.11); ctx.lineTo(0.5, -0.02);
      ctx.lineTo(0.58, 0.11); ctx.lineTo(0.68, 0.02); ctx.lineTo(0.66, 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgb(sc); for (const x of [0.4, 0.5, 0.6]) { ctx.beginPath(); ctx.arc(x, 0.16, 0.018, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#d8dce2"; ctx.fillRect(0.84, 0.18, 0.04, 0.8); ctx.strokeRect(0.84, 0.18, 0.04, 0.8);
      ctx.fillStyle = rgb(gold); ctx.fillRect(0.78, 0.5, 0.16, 0.04);
    } else if (rank === 12) {                // tiara, flower
      ctx.fillStyle = rgb(gold);
      ctx.beginPath(); ctx.moveTo(0.36, 0.17); ctx.lineTo(0.38, 0.06); ctx.lineTo(0.44, 0.12); ctx.lineTo(0.5, 0.02);
      ctx.lineTo(0.56, 0.12); ctx.lineTo(0.62, 0.06); ctx.lineTo(0.64, 0.17); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#3a8a3c"; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(0.82, 0.96); ctx.lineTo(0.82, 0.6); ctx.stroke();
      ctx.fillStyle = rgb(sc); ctx.strokeStyle = line; ctx.lineWidth = 0.012;
      ctx.beginPath(); ctx.arc(0.82, 0.54, 0.07, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgb(gold); ctx.beginPath(); ctx.arc(0.82, 0.54, 0.025, 0, Math.PI * 2); ctx.fill();
    } else {                                 // jack: cap with feather, halberd
      ctx.fillStyle = rgb(sc);
      ctx.beginPath(); ctx.moveTo(0.33, 0.22); ctx.bezierCurveTo(0.32, 0.0, 0.68, 0.0, 0.67, 0.22); ctx.lineTo(0.76, 0.2); ctx.lineTo(0.7, 0.26); ctx.lineTo(0.3, 0.26); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = rgb(gold); ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(0.62, 0.08); ctx.quadraticCurveTo(0.84, -0.04, 0.9, 0.16); ctx.stroke();
      ctx.strokeStyle = "#7a5a34"; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.moveTo(0.86, 0.98); ctx.lineTo(0.86, 0.3); ctx.stroke();
      ctx.fillStyle = "#d8dce2"; ctx.strokeStyle = line; ctx.lineWidth = 0.012;
      ctx.beginPath(); ctx.moveTo(0.86, 0.3); ctx.lineTo(0.96, 0.4); ctx.lineTo(0.86, 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = rgb(skin);
  }

  function courtPanel(ctx, D, rank, suit, x, y, w, h) {
    const col = D.cols[suit];
    const px = x + w * 0.13, py = y + h * 0.1, pw = w * 0.74, ph = h * 0.8;
    ctx.save();
    ctx.lineWidth = Math.max(1, w * 0.014);
    ctx.fillStyle = rgb([250, 238, 200]); ctx.strokeStyle = rgb(col, 0.9);
    ctx.fillRect(px, py, pw, ph); ctx.strokeRect(px, py, pw, ph);
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    if (D.kind === "french") {
      // double-ended: figure on the top half, turned copy below, diagonal divider
      const half = ph / 2, sw = pw * 0.92;
      for (let k = 0; k < 2; k++) {
        ctx.save();
        ctx.translate(px + pw / 2, py + ph / 2);
        if (k) ctx.rotate(Math.PI);
        ctx.translate(-sw / 2, -half);
        ctx.scale(sw, half);
        figure(ctx, D, rank, suit);
        ctx.restore();
      }
      ctx.strokeStyle = rgb(col, 0.85); ctx.lineWidth = Math.max(1, w * 0.014);
      ctx.beginPath(); ctx.moveTo(px, py + ph); ctx.lineTo(px + pw, py); ctx.stroke();
    } else {
      // single standing figure on a coloured ground, emblem in the corner
      ctx.fillStyle = rgb(col, 0.16); ctx.fillRect(px, py, pw, ph);
      const s = pw * 0.96;
      ctx.save(); ctx.translate(px + pw * 0.02, py + ph * 0.1); ctx.scale(s, ph * 0.9); figure(ctx, D, rank, suit); ctx.restore();
    }
    ctx.restore();
  }

  // ---- pip layouts: [column -1/0/1, row 0..1] ----
  const six = [[-1, 0], [1, 0], [-1, 0.5], [1, 0.5], [-1, 1], [1, 1]];
  const eight = [[-1, 0], [1, 0], [-1, 1 / 3], [1, 1 / 3], [-1, 2 / 3], [1, 2 / 3], [-1, 1], [1, 1]];
  const PIPS = {
    2: [[0, 0], [0, 1]], 3: [[0, 0], [0, 0.5], [0, 1]],
    4: [[-1, 0], [1, 0], [-1, 1], [1, 1]], 5: [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 0.5]],
    6: six, 7: [...six, [0, 0.25]], 8: [...six, [0, 0.25], [0, 0.75]],
    9: [...eight, [0, 0.5]], 10: [...eight, [0, 1 / 6], [0, 5 / 6]],
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---- public drawing ----
  // face: ctx, top-left (x,y), size w×h, rank 1..13, suit 0..3
  function face(ctx, x, y, w, h, rank, suit, o = {}) {
    const D = o.deck || current();
    const u = w / 72, col = D.cols[suit];
    ctx.save();
    rr(ctx, x, y, w, h, w * 0.085);
    ctx.fillStyle = rgb(D.paper); ctx.fill();
    ctx.strokeStyle = rgb(D.edge, 0.55); ctx.lineWidth = Math.max(1, u * 1.1); ctx.stroke();
    ctx.font = "";
    const cx = x + w / 2;
    // centre art first, then the corner indices on top
    if (rank === 1) {
      emblem(ctx, D, suit, cx, y + h / 2, w * 0.56, false);
    } else if (rank <= 10) {
      const size = w * (rank >= 9 ? 0.2 : 0.23);
      for (const [c, ry] of PIPS[rank]) {
        emblem(ctx, D, suit, cx + c * w * 0.22, y + h * (0.2 + ry * 0.6), size, ry > 0.5);
      }
    } else {
      courtPanel(ctx, D, rank, suit, x, y, w, h);
    }
    // corner index: top-left and the same turned by 180° bottom-right
    for (let k = 0; k < 2; k++) {
      ctx.save();
      if (k) { ctx.translate(x + w, y + h); ctx.rotate(Math.PI); } else ctx.translate(x, y);
      ctx.fillStyle = rgb(col);
      ctx.font = `bold ${(rank === 10 ? 14 : 17) * u}px Georgia, "Times New Roman", serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(D.ranks[rank], 10 * u, 4 * u);
      emblem(ctx, D, suit, 10 * u, 30 * u, 11 * u, false);
      ctx.restore();
    }
    ctx.restore();
  }

  // back: classic woven lattice with medallion, scroll ornaments, arabesque
  function back(ctx, x, y, w, h, o = {}) {
    const D = o.deck || current(), B = D.back, u = w / 72;
    ctx.save();
    rr(ctx, x, y, w, h, w * 0.085);
    ctx.fillStyle = rgb(D.paper); ctx.fill();
    ctx.strokeStyle = rgb(D.edge, 0.55); ctx.lineWidth = Math.max(1, u * 1.1); ctx.stroke();
    const m = 5 * u;
    ctx.fillStyle = rgb(B.field); rr(ctx, x + m, y + m, w - 2 * m, h - 2 * m, 4 * u); ctx.fill();
    ctx.save();
    rr(ctx, x + m, y + m, w - 2 * m, h - 2 * m, 4 * u); ctx.clip();
    ctx.strokeStyle = rgb(B.ink, 0.5); ctx.lineWidth = Math.max(0.8, u * 0.9);
    const ix = x + m, iy = y + m, iw = w - 2 * m, ih = h - 2 * m, st = 8 * u;
    if (B.style === "lattice" || B.style === "arabesque") {
      for (let k = -ih; k < iw + ih; k += st) {
        ctx.beginPath(); ctx.moveTo(ix + k, iy); ctx.lineTo(ix + k + ih, iy + ih);
        ctx.moveTo(ix + k + ih, iy); ctx.lineTo(ix + k, iy + ih); ctx.stroke();
      }
      if (B.style === "arabesque") {
        ctx.fillStyle = rgb(B.ink, 0.65);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
          ctx.beginPath(); ctx.arc(ix + (i + 0.5) * iw / 4, iy + (j + 0.5) * ih / 6, 1.8 * u, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (B.style === "ornament") {
      ctx.fillStyle = rgb(B.ink, 0.55);
      for (let j = 0; j < 8; j++) for (const fx of j % 2 ? [0.25, 0.75] : [0.5]) {
        const cx = ix + iw * fx, cy = iy + (j + 0.5) * ih / 8;
        ctx.beginPath(); ctx.moveTo(cx, cy - 6 * u); ctx.lineTo(cx + 5 * u, cy); ctx.lineTo(cx, cy + 6 * u); ctx.lineTo(cx - 5 * u, cy); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
    // inner frame + central medallion
    ctx.strokeStyle = rgb(B.ink, 0.8); ctx.lineWidth = Math.max(1, u);
    rr(ctx, x + m + 3 * u, y + m + 3 * u, w - 2 * m - 6 * u, h - 2 * m - 6 * u, 3 * u); ctx.stroke();
    const mx = x + w / 2, my = y + h / 2;
    ctx.fillStyle = rgb(B.field); ctx.strokeStyle = rgb(B.ink, 0.9); ctx.lineWidth = Math.max(1, 1.3 * u);
    ctx.beginPath(); ctx.moveTo(mx, my - 17 * u); ctx.lineTo(mx + 12 * u, my); ctx.lineTo(mx, my + 17 * u); ctx.lineTo(mx - 12 * u, my); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgb(B.ink, 0.9); ctx.beginPath(); ctx.arc(mx, my, 4.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- selection, global per browser ----
  const KEY = "games_card_deck";
  let idx = 0;
  try { const i = DECKS.findIndex((d) => d.id === localStorage.getItem(KEY)); if (i >= 0) idx = i; } catch {}
  const listeners = [];
  function current() { return DECKS[idx]; }
  function cycle() {
    idx = (idx + 1) % DECKS.length;
    try { localStorage.setItem(KEY, current().id); } catch {}
    listeners.forEach((f) => f(current()));
    return current();
  }

  window.PlayingCards = { decks: DECKS, ranks: RANKS, current, cycle, face, back, onChange: (f) => listeners.push(f) };
})();
