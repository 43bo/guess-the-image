'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const store = require('./rooms');
const { getCategories, pickTwoRandom, getImageById, getImageFilePath } = require('./imageLibrary');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const IMAGE_TOKEN_TTL_MS = 15 * 60 * 1000;
const IMAGE_TOKEN_SECRET = process.env.IMAGE_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

function signImageToken(imageId, roomCode, role, expiresAt) {
  const payload = `${imageId}|${roomCode}|${role}|${expiresAt}`;
  return crypto.createHmac('sha256', IMAGE_TOKEN_SECRET).update(payload).digest('hex');
}

function createImageUrl(image, roomCode, role) {
  if (!image) return null;
  const expiresAt = Date.now() + IMAGE_TOKEN_TTL_MS;
  const signature = signImageToken(image.id, roomCode, role, expiresAt);
  return `/api/images/${encodeURIComponent(image.id)}?room=${encodeURIComponent(roomCode)}&role=${encodeURIComponent(role)}&expires=${expiresAt}&sig=${signature}`;
}

function verifyImageToken(imageId, roomCode, role, expiresAt, signature) {
  if (!imageId || !roomCode || !role || !expiresAt || !signature) return false;
  if (!['player1', 'player2'].includes(role)) return false;
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expected = signImageToken(imageId, roomCode, role, expiry);
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

app.get('/api/images/:id', async (req, res) => {
  const image = getImageById(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  const { room, role, expires, sig } = req.query;
  if (!verifyImageToken(image.id, String(room || ''), String(role || ''), expires, String(sig || ''))) {
    return res.status(403).json({ error: 'Invalid or expired image token' });
  }

  const filePath = getImageFilePath(image);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image file not found. Add the image to the assets folder.' });
  }

  try {
    res.set('Cache-Control', 'private, max-age=300');
    return res.sendFile(filePath);
  } catch (error) {
    console.error(`Failed to serve local image ${image.id}:`, error.message);
    return res.status(500).json({ error: 'Unable to serve image' });
  }
});

// Keep image files out of the public static namespace. They are only served
// through the signed /api/images/:id endpoint above.
app.use((req, res, next) => {
  if (req.path.startsWith('/assets/images/')) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
setInterval(() => store.cleanupStaleRooms(), 60 * 1000);

function emitError(socket, message) { socket.emit('gameError', { message }); }

function broadcastRoomState(room) {
  for (const { socketId, role, state } of store.allRecipients(room)) {
    if (state.opponentImage) {
      state.opponentImage.url = createImageUrl(state.opponentImage, room.roomCode, role);
    }
    io.to(socketId).emit('roomState', state);
  }
}

function getContext(socket) {
  const info = store.getRole(socket.id);
  if (!info) return null;
  const room = store.findRoom(info.roomCode);
  if (!room) return null;
  return { room, role: info.role };
}

function requireController(socket) {
  const ctx = getContext(socket);
  if (!ctx || ctx.role !== 'player1') {
    emitError(socket, 'Only Player 1 (the room creator) can do this.');
    return null;
  }
  return ctx;
}

function emitCategories(socket) { socket.emit('categories', getCategories()); }

io.on('connection', (socket) => {
  emitCategories(socket);

  socket.on('createRoom', ({ name } = {}) => {
    if (!String(name || '').trim()) return emitError(socket, 'Please enter your name.');
    if (store.getRole(socket.id)) return emitError(socket, 'You are already in a room.');
    const room = store.createRoom(socket.id, name);
    socket.join(room.roomCode);
    socket.emit('roomCreated', { roomCode: room.roomCode, role: 'player1' });
    broadcastRoomState(room);
  });

  socket.on('joinRoom', ({ name, roomCode } = {}) => {
    if (!String(name || '').trim()) return socket.emit('joinError', { message: 'Please enter your name.' });
    const room = store.findRoom(roomCode);
    if (!room) return socket.emit('joinError', { message: 'Room not found.' });
    if (store.getRole(socket.id)) return socket.emit('joinError', { message: 'You are already in a room.' });
    if (room.players.player2) return socket.emit('joinError', { message: 'Room is full.' });
    if (room.gameState !== 'lobby') return socket.emit('joinError', { message: 'Game has already started.' });

    const role = store.addPlayer(room, socket.id, name);
    if (!role) return socket.emit('joinError', { message: 'Room is full.' });
    socket.join(room.roomCode);
    socket.emit('roomJoined', { roomCode: room.roomCode, role });
    io.to(room.roomCode).emit('playerJoined', { name: room.players.player2.name });
    broadcastRoomState(room);
  });

  socket.on('startGame', ({ category } = {}) => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (!store.bothPlayersPresent(room) || !store.bothPlayersConnected(room)) {
      return emitError(socket, 'Both players must be connected.');
    }
    if (room.gameState !== 'lobby') return emitError(socket, 'The game has already started.');
    if (!category) return emitError(socket, 'Choose a category first.');

    let images;
    try { images = pickTwoRandom(category); }
    catch { return emitError(socket, 'Invalid category.'); }

    store.startNextRound(room, category, images[0], images[1]);
    io.to(room.roomCode).emit('roundStarted', { round: room.round, category });
    broadcastRoomState(room);
  });

  socket.on('nextRound', ({ category } = {}) => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (room.gameState !== 'roundEnd') return emitError(socket, 'Finish the current round first.');
    if (!category) category = room.category;
    let images;
    try { images = pickTwoRandom(category); }
    catch { return emitError(socket, 'Invalid category.'); }
    store.startNextRound(room, category, images[0], images[1]);
    io.to(room.roomCode).emit('roundStarted', { round: room.round, category });
    broadcastRoomState(room);
  });

  socket.on('awardPoint', ({ player } = {}) => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (room.gameState !== 'playing') return emitError(socket, 'The round is not active.');
    if (!['player1', 'player2'].includes(player)) return emitError(socket, 'Invalid player.');

    store.awardPoint(room, player);
    io.to(room.roomCode).emit('pointAwarded', {
      player,
      playerName: room.players[player].name,
      scores: { ...room.scores },
    });
    broadcastRoomState(room);
  });

  socket.on('setTurn', ({ player } = {}) => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (room.gameState !== 'playing') return emitError(socket, 'The round is not active.');
    if (!['player1', 'player2'].includes(player)) return emitError(socket, 'Invalid player.');
    room.turn = player;
    store.touch(room);
    io.to(room.roomCode).emit('turnChanged', { player });
    broadcastRoomState(room);
  });

  socket.on('endGame', () => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    room.gameState = 'gameOver';
    store.touch(room);
    let winner = null;
    if (room.scores.player1 > room.scores.player2) winner = 'player1';
    if (room.scores.player2 > room.scores.player1) winner = 'player2';
    io.to(room.roomCode).emit('gameEnded', {
      winner,
      winnerName: winner ? room.players[winner].name : null,
      scores: { ...room.scores },
    });
    broadcastRoomState(room);
  });

  socket.on('restartGame', () => {
    const ctx = requireController(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (!store.bothPlayersPresent(room)) return emitError(socket, 'Both players must be present.');
    store.resetToLobby(room);
    io.to(room.roomCode).emit('gameRestarted');
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    const info = store.removeSocket(socket.id);
    if (!info) return;
    const room = store.findRoom(info.roomCode);
    if (!room) return;
    const player = room.players[info.role];
    if (player && player.socketId === socket.id) player.connected = false;
    store.touch(room);

    if (info.role === 'player1') {
      io.to(room.roomCode).emit('controllerDisconnected', {
        message: 'Player 1 (room creator) disconnected. The room has been closed.',
      });
      io.socketsLeave(room.roomCode);
      store.deleteRoom(room.roomCode);
      return;
    }

    io.to(room.roomCode).emit('playerLeft', { role: info.role });
    broadcastRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`GUESSIT server running at http://localhost:${PORT}`);
});
