/**
 * network.js — Socket.io client wrapper
 *
 * Abstracts the socket events so main.js doesn't depend on Socket.io directly.
 * All outbound methods are rate-limited internally (position at 20Hz).
 *
 * Usage:
 *   const net = new NetworkManager();
 *   net.on('gameStart', ({ players }) => { ... });
 *   net.on('opponentUpdate', (state) => { ... });
 *   net.connect();
 *
 *   // in game loop:
 *   net.sendPlayerUpdate({ position, rotation, hp, ... });
 *   net.sendAttackLanded({ damage, audioState, targetId });
 */

const POSITION_SYNC_HZ = 20;
const POSITION_SYNC_INTERVAL = 1000 / POSITION_SYNC_HZ;

export class NetworkManager {
  constructor() {
    this._socket = null;
    this._handlers = new Map();
    this._lastPositionSend = 0;

    // Set by server on join
    this.playerId = null;
    this.playerIndex = null; // 0 or 1
    this.roomId = null;
    this.connected = false;
  }

  connect() {
    // io() is loaded via CDN script tag in index.html
    this._socket = io();

    this._socket.on('connect', () => {
      this.connected = true;
    });

    this._socket.on('disconnect', () => {
      this.connected = false;
      this._emit('disconnect');
    });

    this._socket.on('joined', ({ roomId, playerIndex, playerId }) => {
      this.roomId = roomId;
      this.playerIndex = playerIndex;
      this.playerId = playerId;
      this._emit('joined', { roomId, playerIndex, playerId });
    });

    this._socket.on('waiting', () => this._emit('waiting'));
    this._socket.on('gameStart', (data) => this._emit('gameStart', data));
    this._socket.on('opponentUpdate', (data) => this._emit('opponentUpdate', data));
    this._socket.on('takeDamage', (data) => this._emit('takeDamage', data));
    this._socket.on('opponentDisconnected', () => this._emit('opponentDisconnected'));
    this._socket.on('opponentWindupStart', () => this._emit('opponentWindupStart'));
    this._socket.on('opponentWindupCancel', () => this._emit('opponentWindupCancel'));
  }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(handler);
  }

  off(event, handler) {
    if (!this._handlers.has(event)) return;
    this._handlers.set(
      event,
      this._handlers.get(event).filter((h) => h !== handler),
    );
  }

  /**
   * Send local player state to server. Rate-limited to 20Hz automatically.
   * Call this every frame — the rate limiter handles throttling.
   */
  sendPlayerUpdate(state) {
    const now = performance.now();
    if (now - this._lastPositionSend < POSITION_SYNC_INTERVAL) return;
    this._lastPositionSend = now;
    this._socket?.emit('playerUpdate', state);
  }

  sendAttackLanded(data) {
    this._socket?.emit('attackLanded', data);
  }

  sendWindupStart() {
    this._socket?.emit('windupStart');
  }

  sendWindupCancel() {
    this._socket?.emit('windupCancel');
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _emit(event, data) {
    const handlers = this._handlers.get(event);
    if (handlers) handlers.forEach((h) => h(data));
  }
}
