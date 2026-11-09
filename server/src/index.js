// Room relay for multiplayer. Dumb on purpose: it knows nothing about games.
//
// One Durable Object per room code. Each browser holds one WebSocket to its room and the room forwards
// messages. Wire format (JSON), see multiplayer.js netOpen():
//   client -> server   { k: "msg", d: <any>, to?: <connId> }   to = one connection, absent = everybody else
//   server -> client   { k: "welcome", id, peers: [connId...] }   sent once, right after connecting
//                      { k: "join", id }                           another connection entered the room
//                      { k: "leave", id }                          another connection left
//                      { k: "msg", from, d }                       forwarded message
//                      { k: "full" }                               room is full, socket is closed

const MAX_PEERS = 8;            // connections per room (the games allow up to 6 players, a little slack)
const MAX_BYTES = 64 * 1024;    // one message
const CODE = /^[A-Z0-9]{3,12}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname !== "/ws" || request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade on /ws?room=CODE", { status: 400 });
    }
    const room = (url.searchParams.get("room") || "").toUpperCase();
    if (!CODE.test(room)) return new Response("bad room code", { status: 400 });
    const id = env.ROOMS.idFromName(room);
    return env.ROOMS.get(id).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_PEERS) {
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].send(JSON.stringify({ k: "full" }));
      pair[1].close(4001, "full");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const connId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // the connection id lives on the socket, so it survives hibernation
    this.state.acceptWebSocket(server, [connId]);
    server.serializeAttachment({ id: connId });

    const peers = sockets.map((s) => this.idOf(s)).filter(Boolean);
    server.send(JSON.stringify({ k: "welcome", id: connId, peers }));
    for (const s of sockets) s.send(JSON.stringify({ k: "join", id: connId }));

    return new Response(null, { status: 101, webSocket: client });
  }

  idOf(ws) {
    const a = ws.deserializeAttachment?.();
    return a && a.id ? a.id : null;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_BYTES) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || m.k !== "msg") return;
    const from = this.idOf(ws);
    if (!from) return;
    const out = JSON.stringify({ k: "msg", from, d: m.d });
    if (typeof m.to === "string") {
      for (const s of this.state.getWebSockets()) {
        if (this.idOf(s) === m.to) { s.send(out); break; }
      }
      return;
    }
    for (const s of this.state.getWebSockets()) {
      if (s !== ws) s.send(out);
    }
  }

  async webSocketClose(ws) {
    this.leave(ws);
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const id = this.idOf(ws);
    if (!id) return;
    const msg = JSON.stringify({ k: "leave", id });
    for (const s of this.state.getWebSockets()) {
      if (s !== ws) { try { s.send(msg); } catch {} }
    }
    try { ws.close(1000, "left"); } catch {}
  }
}
