// ============================================================
// Networking foundation — multiplayer is not implemented yet,
// but the game routes every authoritative action through a
// NetworkAdapter so a real client/server can slot in later.
//
//   Game ──actions──▶ NetworkAdapter ──▶ Server (local today)
//        ◀──events───┘
//
// To go multiplayer: replace LocalServer with a WebSocket
// implementation that relays the same message types.
// ============================================================

// message types the protocol understands
export const MSG = {
  SET_BLOCK: 'setBlock',       // {x,y,z,id,meta}
  PLAYER_STATE: 'playerState', // {pos,yaw,pitch} — for future remote players
  SPAWN_ENTITY: 'spawnEntity',
  CHAT: 'chat',
};

export class NetworkAdapter {
  constructor(server) {
    this.server = server;
    this.listeners = {};
    server.attach(this);
  }
  on(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emitLocal(type, data) { for (const fn of this.listeners[type] || []) fn(data); }
  // client -> server
  send(type, data) { this.server.receive(type, data, this); }
}

// Loopback "server": applies actions immediately and echoes them
// back, exactly like an authoritative remote server would.
export class LocalServer {
  constructor() { this.clients = []; }
  attach(client) { this.clients.push(client); }
  receive(type, data, from) {
    // a real server would validate here (reach, permissions, rate)
    for (const c of this.clients) c.emitLocal(type, data);
  }
}
