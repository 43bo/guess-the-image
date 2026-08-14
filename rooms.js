'use strict';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 18;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;
const EMPTY_ROOM_GRACE_MS = 1000 * 60 * 5;

const rooms = new Map();
const socketRoles = new Map();

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[<>]/g, '').slice(0, MAX_NAME_LENGTH);
}

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(socketId, nameRaw) {
  const roomCode = generateRoomCode();
  const name = sanitizeName(nameRaw) || 'Player 1';
  const room = {
    roomCode,
    players: {
      player1: { socketId, name, connected: true },
      player2: null,
    },
    gameState: 'lobby', // lobby | playing | roundEnd | gameOver
    round: 0,
    category: null,
    turn: 'player1',
    images: { player1: null, player2: null },
    scores: { player1: 0, player2: 0 },
    roundWinner: null,
    lastActivity: Date.now(),
  };
  rooms.set(roomCode, room);
  socketRoles.set(socketId, { roomCode, role: 'player1' });
  return room;
}

function findRoom(roomCode) {
  if (!roomCode) return null;
  return rooms.get(String(roomCode).toUpperCase().trim()) || null;
}

function getRole(socketId) {
  return socketRoles.get(socketId) || null;
}

function addPlayer(room, socketId, nameRaw) {
  if (room.players.player2) return null;
  const name = sanitizeName(nameRaw) || 'Player 2';
  room.players.player2 = { socketId, name, connected: true };
  socketRoles.set(socketId, { roomCode: room.roomCode, role: 'player2' });
  touch(room);
  return 'player2';
}

function touch(room) { room.lastActivity = Date.now(); }

function bothPlayersPresent(room) {
  return !!room.players.player1 && !!room.players.player2;
}

function bothPlayersConnected(room) {
  return !!room.players.player1?.connected && !!room.players.player2?.connected;
}

function otherPlayerKey(key) { return key === 'player1' ? 'player2' : 'player1'; }

function resetRoundState(room) {
  room.images = { player1: null, player2: null };
  room.roundWinner = null;
}

function resetToLobby(room) {
  room.gameState = 'lobby';
  room.round = 0;
  room.category = null;
  room.turn = 'player1';
  room.scores = { player1: 0, player2: 0 };
  resetRoundState(room);
  touch(room);
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const key of ['player1', 'player2']) {
    if (room.players[key]) socketRoles.delete(room.players[key].socketId);
  }
  rooms.delete(roomCode);
}

function removeSocket(socketId) {
  const info = socketRoles.get(socketId);
  socketRoles.delete(socketId);
  return info || null;
}

function revealImages(room) {
  room.gameState = 'revealed';
  touch(room);
}

function awardPoint(room, playerKey) {
  if (!['player1', 'player2'].includes(playerKey)) return false;
  room.scores[playerKey] += 1;
  room.roundWinner = playerKey;
  room.gameState = 'roundEnd';
  touch(room);
  return true;
}

function skipPoint(room) {
  room.roundWinner = null;
  room.gameState = 'roundEnd';
  touch(room);
}

function startNextRound(room, category, image1, image2) {
  room.round += 1;
  room.category = category;
  room.images = { player1: image1, player2: image2 };
  room.turn = 'player1';
  room.roundWinner = null;
  room.gameState = 'playing';
  touch(room);
}

function publicPlayer(room, key) {
  const p = room.players[key];
  return p ? { name: p.name, connected: p.connected } : null;
}

function sanitizeForPlayer(room, role) {
  const opponent = otherPlayerKey(role);
  // Own image stays hidden while guessing is still in progress, and only
  // becomes visible once the controller reveals it (or the round is over).
  const revealPhase = ['revealed', 'roundEnd', 'gameOver'].includes(room.gameState);
  return {
    role,
    isController: role === 'player1',
    roomCode: room.roomCode,
    gameState: room.gameState,
    round: room.round,
    category: room.category,
    turn: room.turn,
    myName: room.players[role]?.name || null,
    players: {
      player1: publicPlayer(room, 'player1'),
      player2: publicPlayer(room, 'player2'),
    },
    myImageHidden: !revealPhase,
    myImage: revealPhase && room.images[role] ? { ...room.images[role] } : null,
    // The opponent's image is always sent to this player.
    opponentImage: room.images[opponent] ? { ...room.images[opponent] } : null,
    scores: { ...room.scores },
    roundWinner: room.roundWinner,
  };
}

function sanitizeForHost(room) {
  // Player 1 is the room creator/controller, but is still a player.
  // Do NOT send Player 1's own secret image. They only see Player 2's image.
  return sanitizeForPlayer(room, 'player1');
}

function sanitizeForRecipient(room, role) {
  return role === 'player1' ? sanitizeForHost(room) : sanitizeForPlayer(room, role);
}

function allRecipients(room) {
  const result = [];
  for (const role of ['player1', 'player2']) {
    const p = room.players[role];
    if (p) result.push({ socketId: p.socketId, role, state: sanitizeForRecipient(room, role) });
  }
  return result;
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const nobodyConnected = !room.players.player1?.connected && !room.players.player2?.connected;
    if ((nobodyConnected && now - room.lastActivity > EMPTY_ROOM_GRACE_MS) || now - room.lastActivity > ROOM_TTL_MS) {
      deleteRoom(room.roomCode);
    }
  }
}

module.exports = {
  createRoom,
  findRoom,
  getRole,
  addPlayer,
  removeSocket,
  bothPlayersPresent,
  bothPlayersConnected,
  otherPlayerKey,
  touch,
  revealImages,
  awardPoint,
  skipPoint,
  startNextRound,
  resetToLobby,
  deleteRoom,
  sanitizeForRecipient,
  allRecipients,
  cleanupStaleRooms,
};
