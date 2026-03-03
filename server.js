/**
 * HYAAAAT server
 *
 * Responsibilities:
 *   - Serve static client files
 *   - Manage matchmaking rooms (currently: 1v1 only)
 *   - Relay player state and attack events between peers
 *
 * Trust model (V1):
 *   Damage is calculated client-side and reported to the server, which relays
 *   it to the opponent. This is intentional for a party game — the complexity
 *   of server-side audio validation (streaming mic data) is not worth it yet.
 *   TODO: Add server-side damage caps / sanity checks when cheating is a concern.
 *
 * Room lifecycle:
 *   waiting  → (2nd player joins) → playing → (player disconnects) → waiting
 *
 * TODO (multi-room / FFA): rooms currently cap at 2 players. FFA-4 will need
 *   a different room type and broader broadcast logic. See CLAUDE.md §Future Work.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Increase ping timeout for slow connections
  pingTimeout: 10000,
  pingInterval: 5000,
});

app.use(express.static(join(__dirname, 'public')));

// roomId → { players: [socketId, ...], state: 'waiting' | 'playing' }
const rooms = new Map();
// socketId → roomId
const playerRooms = new Map();

function findOrCreateRoom() {
  for (const [id, room] of rooms) {
    if (room.players.length < 2 && room.state === 'waiting') {
      return id;
    }
  }
  const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  rooms.set(id, { players: [], state: 'waiting' });
  return id;
}

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  const roomId = findOrCreateRoom();
  const room = rooms.get(roomId);
  room.players.push(socket.id);
  playerRooms.set(socket.id, roomId);
  socket.join(roomId);

  const playerIndex = room.players.indexOf(socket.id);
  socket.emit('joined', { roomId, playerIndex, playerId: socket.id });

  if (room.players.length === 2) {
    room.state = 'playing';
    io.to(roomId).emit('gameStart', { players: room.players });
    console.log('[gameStart]', roomId);
  } else {
    socket.emit('waiting');
  }

  // ── State sync ──────────────────────────────────────────────────────────────
  // Client sends this at ~20Hz. Contains position, rotation, hp, action flags.
  socket.on('playerUpdate', (data) => {
    socket.to(roomId).emit('opponentUpdate', data);
  });

  // ── Combat events ────────────────────────────────────────────────────────────
  // Attacker sends this when an attack lands. Contains damage and audioState
  // (volume/fightingSpirit/ridiculousFactor) for debugging / future validation.
  socket.on('attackLanded', (data) => {
    socket.to(roomId).emit('takeDamage', { ...data, attackerId: socket.id });
  });

  // Visual-only: opponent started/cancelled a windup (so they can show the aura)
  socket.on('windupStart', () => socket.to(roomId).emit('opponentWindupStart'));
  socket.on('windupCancel', () => socket.to(roomId).emit('opponentWindupCancel'));

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('[disconnect]', socket.id);
    const rid = playerRooms.get(socket.id);
    if (!rid) return;
    const r = rooms.get(rid);
    if (r) {
      r.players = r.players.filter((id) => id !== socket.id);
      io.to(rid).emit('opponentDisconnected');
      if (r.players.length === 0) {
        rooms.delete(rid);
      } else {
        r.state = 'waiting';
        io.to(rid).emit('waiting');
      }
    }
    playerRooms.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`HYAAAAT running at http://localhost:${PORT}`);
});
