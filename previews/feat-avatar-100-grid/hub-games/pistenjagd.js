// Pistenjagd im Mehrspieler-Hub: 2–6 Fahrer rasen auf Ski oder Snowboard bergab, freie Plätze füllen Bots.
// Die Engine liegt in hub-games/pistenjagd/ und wird auch von der Solo-Seite (games/pistenjagd.js) benutzt.
// Der Host wählt im Spiel die Piste und startet; jeder Client fährt seinen eigenen Fahrer, der Host zusätzlich die Bots.

import { shell } from "../hub-kit.js";

export default {
  min: 1, max: 6,
  async mount(ctx) {
    const kit = shell(ctx, { title: "Pistenjagd" });
    kit.body.innerHTML = `<p class="hub-loading">Lade Piste …</p>`;
    let game;
    try {
      const { createPiste } = await import("./pistenjagd/game.js");
      kit.body.innerHTML = "";
      game = await createPiste({
        root: kit.body, solo: false, players: ctx.players, me: ctx.me,
        net: {
          send: (t, d, to) => ctx.send(t, d, to),
          onMessage: (t, fn) => ctx.onMessage(t, fn),
          onEvent: (ev, fn) => ctx.onEvent(ev, fn),
          get isHost() { return !!ctx.isHost; },
          get hostId() { return ctx.hostId; },
        },
      });
    } catch (e) {
      console.error(e);
      kit.body.innerHTML = `<p class="hub-loading">Pistenjagd konnte nicht geladen werden.</p>`;
      return {};
    }
    return {
      go() { game.go(); },
      destroy() { game.destroy(); },
    };
  },
};
