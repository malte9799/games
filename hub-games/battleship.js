import { shell } from "../hub-kit.js";
// Battleship for the multiplayer hub. Loads games/battleship.js (factory `createBattleship`)
// and mounts it into the hub stage with room messaging.

const SRC = new URL("../games/battleship.js", import.meta.url).href;

function load(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed " + src));
    document.head.appendChild(s);
  });
}

export default {
  min: 2, max: 2,

  async mount(ctx) {
    const kit = shell(ctx, { title: "Battleship" }), root = kit.body;
    window.__BATTLESHIP_HUB__ = true;
    if (!window.createBattleship) await load(SRC);
    const game = window.createBattleship({
      root,
      net: {
        send: (type, data, to) => ctx.send(type, data, to),
        onMessage: (type, fn) => ctx.onMessage(type, fn),
        onEvent: (ev, fn) => ctx.onEvent(ev, fn),
        get me() { return ctx.me; },
        get isHost() { return ctx.isHost; },
        get hostId() { return ctx.hostId; },
        get players() { return ctx.players; },
        end: () => ctx.end(),
        leave: () => window.Multiplayer && window.Multiplayer.leave(),
      },
    });
    return { destroy: () => game && game.destroy && game.destroy() };
  },
};
