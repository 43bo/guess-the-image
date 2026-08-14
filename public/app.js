'use strict';

const socket = io();
let myRole = null;
let myRoomCode = null;
let latestState = null;
let categories = [];
let selectedCategory = null;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showScreen(id) {
  $$('.screen').forEach(x => x.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
function toast(message, type='') {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Navigation

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'show-home') return showScreen('screen-home');
  if (a === 'show-create') { showScreen('screen-create'); $('#create-name').focus(); return; }
  if (a === 'show-join') { showScreen('screen-join'); $('#join-name').focus(); return; }
  if (a === 'submit-create') return createRoom();
  if (a === 'submit-join') return joinRoom();
  if (a === 'start-game') return startGame(btn.dataset.category);
  if (a === 'next-round') return startNextRound(btn.dataset.category || latestState?.category);
  if (a === 'reveal-images') return revealImages();
  if (a === 'award-player') return awardPoint(btn.dataset.player);
  if (a === 'no-point') return noPoint();
  if (a === 'set-turn') return setTurn(btn.dataset.player);
  if (a === 'end-game') return endGame();
  if (a === 'restart-game') return restartGame();
});

$('#create-name').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
$('#join-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('#join-code').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));

function createRoom() {
  const name = $('#create-name').value.trim();
  $('#create-error').textContent = '';
  if (!name) return $('#create-error').textContent = 'Please enter your name.';
  socket.emit('createRoom', { name });
}
function joinRoom() {
  const name = $('#join-name').value.trim();
  const roomCode = $('#join-code').value.trim();
  $('#join-error').textContent = '';
  if (!name) return $('#join-error').textContent = 'Please enter your name.';
  if (roomCode.length !== 6) return $('#join-error').textContent = 'Room code must be 6 characters.';
  socket.emit('joinRoom', { name, roomCode });
}
function startGame(category) { socket.emit('startGame', { category }); }
function startNextRound(category) { socket.emit('nextRound', { category }); }
function setTurn(player) { socket.emit('setTurn', { player }); }
function revealImages() { socket.emit('revealImages'); }
function awardPoint(player) { socket.emit('awardPoint', { player }); }
function noPoint() { socket.emit('noPoint'); }
function endGame() { socket.emit('endGame'); }
function restartGame() { socket.emit('restartGame'); }

socket.on('categories', data => { categories = data || []; });
socket.on('roomCreated', ({roomCode, role}) => {
  myRole = role; myRoomCode = roomCode; showScreen('screen-room');
});
socket.on('roomJoined', ({roomCode, role}) => {
  myRole = role; myRoomCode = roomCode; showScreen('screen-room');
});
socket.on('joinError', ({message}) => $('#join-error').textContent = message);
socket.on('gameError', ({message}) => toast(message, 'error'));
socket.on('playerJoined', ({name}) => toast(`${name} joined the room`, 'success'));
socket.on('playerLeft', () => toast('Player 2 disconnected.', 'error'));
socket.on('controllerDisconnected', ({message}) => { toast(message, 'error'); setTimeout(() => location.reload(), 1400); });
socket.on('roundStarted', ({round, category}) => { selectedCategory = category; toast(`Round ${round} started`, 'success'); });
socket.on('turnChanged', ({player}) => toast(`Turn: ${player === 'player1' ? latestState?.players.player1?.name : latestState?.players.player2?.name}`));
socket.on('imagesRevealed', () => toast('Images revealed!', 'success'));
socket.on('pointAwarded', ({playerName}) => toast(`${playerName} gets +1 point`, 'success'));
socket.on('roundTied', () => toast('No one scored this round', ''));
socket.on('gameEnded', ({winnerName}) => toast(winnerName ? `${winnerName} wins!` : 'It is a tie!', 'success'));
socket.on('gameRestarted', () => { selectedCategory = null; toast('Game reset. Choose a category to start.'); });
socket.on('roomState', state => {
  latestState = state;
  myRole = state.role;
  myRoomCode = state.roomCode;
  render();
  showScreen('screen-room');
});

function categoryCard(c, disabled=false) {
  return `<button class="category-card ${selectedCategory===c.id?'selected':''}" data-action="${disabled?'noop':'start-game'}" data-category="${c.id}" ${disabled?'disabled':''}>
    <span class="category-icon">${c.icon}</span><span>${escapeHtml(c.label)}</span>
  </button>`;
}

function scoreBoard(s) {
  const p1=s.players.player1, p2=s.players.player2;
  return `<div class="panel"><div class="panel-title">🏆 Scoreboard</div><div class="scoreboard">
    <div class="score-cell ${s.turn==='player1'?'active-turn':''}"><div class="name">${escapeHtml(p1?.name||'Player 1')}</div><div class="score">${s.scores.player1}</div></div>
    <div class="score-cell ${s.turn==='player2'?'active-turn':''}"><div class="name">${escapeHtml(p2?.name||'Player 2')}</div><div class="score">${s.scores.player2}</div></div>
  </div></div>`;
}

function imageCard(image, title) {
  if (!image) return `<div class="image-card image-hidden"><div class="hidden-lock">🔒</div><div class="hidden-title">${title}</div><div class="hidden-sub">You cannot see your image</div></div>`;
  return `<div class="image-card"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(title)}" loading="eager" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.nextElementSibling.textContent='Retrying image…';this.src=(()=>{const u=new URL('${escapeHtml(image.url)}',location.origin);u.searchParams.set('retry',Date.now());return u.href;})();}else{this.classList.add('image-load-failed');this.nextElementSibling.textContent='Image unavailable';}"><div class="image-caption">${escapeHtml(title)}</div></div>`;
}

function communication() {
  return `<div class="panel comm-panel"><div class="panel-title">💬 Communication</div><p class="muted">Talk to your opponent using Discord, WhatsApp, Telegram, or any external app. There is no chat inside GUESSIT.</p><div class="comm-apps"><span>Discord</span><span>WhatsApp</span><span>Telegram</span></div></div>`;
}

function renderLobby(s) {
  const full = !!s.players.player2;
  const controller = s.role === 'player1';
  return `${scoreBoard(s)}
    <div class="panel"><div class="panel-title">👥 Room</div>
      <div class="player-list">
        <div class="player-row is-controller"><div class="player-identity"><span class="player-role-label">PLAYER 1 · ROOM CREATOR</span><span class="player-name">${escapeHtml(s.players.player1?.name||'Player 1')}</span></div><span class="status-dot connected">Controller</span></div>
        <div class="player-row"><div class="player-identity"><span class="player-role-label">PLAYER 2</span><span class="player-name ${full?'':'is-empty'}">${full?escapeHtml(s.players.player2.name):'Waiting…'}</span></div><span class="status-dot ${full?'connected':'waiting'}">${full?'Connected':'Waiting'}</span></div>
      </div>
    </div>
    ${communication()}
    ${controller && full ? `<div class="panel"><div class="panel-title">🎯 Choose Category</div><p class="muted">Choose a category. The server will randomly deal two different real images — one to each player.</p><div class="category-grid">${categories.map(c=>categoryCard(c)).join('')}</div></div>` : `<div class="waiting-box">Waiting for Player 2 to join…</div>`}`;
}

function hud(s) {
  const p1 = s.players.player1?.name || 'Player 1';
  const p2 = s.players.player2?.name || 'Player 2';
  const p1Score = s.scores?.player1 ?? 0;
  const p2Score = s.scores?.player2 ?? 0;
  const turnName = s.turn === 'player1' ? p1 : p2;
  const category = categories.find(c => c.id === s.category);
  return `
    <aside class="scene-hud" aria-label="Game information">
      <div class="hud-round">ROUND ${s.round || 1}</div>
      <div class="hud-category">${category?.icon || '🎴'} ${escapeHtml(category?.label || s.category || '')}</div>
      <div class="hud-divider"></div>
      <div class="hud-player ${s.turn === 'player1' ? 'is-turn' : ''}">
        <span class="hud-player-name">${escapeHtml(p1)}</span>
        <strong>${p1Score}</strong>
      </div>
      <div class="hud-player ${s.turn === 'player2' ? 'is-turn' : ''}">
        <span class="hud-player-name">${escapeHtml(p2)}</span>
        <strong>${p2Score}</strong>
      </div>
      <div class="hud-turn"><span>TURN</span><b>${escapeHtml(turnName)}</b></div>
    </aside>`;
}

function sceneImageCard(image, title, hidden=false) {
  if (hidden) {
    return `<div class="scene-card scene-card-hidden">
      <div class="scene-lock">🔒</div>
      <div class="scene-hidden-label">YOUR IMAGE</div>
    </div>`;
  }
  if (!image) {
    return `<div class="scene-card scene-card-hidden"><div class="scene-hidden-label">WAITING…</div></div>`;
  }
  return `<div class="scene-card scene-card-visible">
    <img src="${escapeHtml(image.url)}" alt="${escapeHtml(title)}" loading="eager"
      onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=(()=>{const u=new URL('${escapeHtml(image.url)}',location.origin);u.searchParams.set('retry',Date.now());return u.href;})();}else{this.style.display='none';this.parentElement.classList.add('image-failed');}">
  </div>`;
}

function renderPlaying(s) {
  const controller = s.role === 'player1';
  const category = categories.find(c => c.id === s.category);
  const opponentName = s.turn === 'player1' ? (s.players.player1?.name || 'Player 1') : (s.players.player2?.name || 'Player 2');

  return `<div class="game-scene">
    <div class="scene-background" aria-hidden="true"></div>
    <div class="scene-vignette" aria-hidden="true"></div>
    ${hud(s)}

    <div class="scene-card-wrap" aria-label="Opponent image">
      ${sceneImageCard(s.opponentImage, 'Opponent image')}
      <div class="scene-card-label">OPPONENT'S IMAGE</div>
    </div>

    <div class="scene-turn-pill ${s.turn === s.role ? 'your-turn' : ''}">
      ${s.turn === s.role ? 'YOUR TURN' : `${escapeHtml(opponentName)}'S TURN`}
    </div>

    ${controller ? `<div class="scene-controls">
      <button class="scene-control-btn primary" data-action="reveal-images">🔍 REVEAL IMAGES</button>
      <div class="scene-turn-controls">
        <button data-action="set-turn" data-player="player1">${escapeHtml(s.players.player1?.name || 'Player 1')}</button>
        <button data-action="set-turn" data-player="player2">${escapeHtml(s.players.player2?.name || 'Player 2')}</button>
      </div>
    </div>` : ''}

    <div class="scene-communication">Talk outside the game · Discord · WhatsApp · Telegram</div>
  </div>`;
}
function revealImageBox(image, label) {
  if (!image) return `<div class="reveal-image-box reveal-image-empty"><span>${escapeHtml(label)}</span></div>`;
  return `<div class="reveal-image-box"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(label)}" loading="eager"
    onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=(()=>{const u=new URL('${escapeHtml(image.url)}',location.origin);u.searchParams.set('retry',Date.now());return u.href;})();}else{this.style.display='none';this.parentElement.classList.add('image-failed');}"></div>`;
}
function renderRevealed(s) {
  const p1 = s.players.player1?.name || 'Player 1';
  const p2 = s.players.player2?.name || 'Player 2';
  const myLabel = s.myName || 'You';
  const oppRole = s.role === 'player1' ? 'player2' : 'player1';
  const oppName = s.players[oppRole]?.name || (oppRole === 'player1' ? p1 : p2);

  return `<div class="game-scene result-scene">
    <div class="scene-background" aria-hidden="true"></div>
    <div class="scene-vignette" aria-hidden="true"></div>
    ${hud(s)}
    <div class="result-card reveal-card">
      <div class="result-kicker">IMAGES REVEALED</div>
      <div class="reveal-images">
        <div class="reveal-image-block">
          <div class="reveal-image-label">${escapeHtml(myLabel)} (You)</div>
          ${revealImageBox(s.myImage, myLabel)}
        </div>
        <div class="reveal-image-block">
          <div class="reveal-image-label">${escapeHtml(oppName)}</div>
          ${revealImageBox(s.opponentImage, oppName)}
        </div>
      </div>
      ${s.role === 'player1' ? `<div class="reveal-award-actions">
        <button class="scene-control-btn primary" data-action="award-player" data-player="player1">✓ ${escapeHtml(p1)}</button>
        <button class="scene-control-btn primary" data-action="award-player" data-player="player2">✓ ${escapeHtml(p2)}</button>
        <button class="scene-control-btn" data-action="no-point">No One</button>
      </div>` : '<div class="result-waiting">Waiting for Player 1 to decide who scores this round…</div>'}
    </div>
  </div>`;
}
function renderRoundEnd(s) {
  const p1 = s.players.player1?.name || 'Player 1';
  const p2 = s.players.player2?.name || 'Player 2';
  const winner = s.roundWinner ? (s.players[s.roundWinner]?.name || '') : '';
  return `<div class="game-scene result-scene">
    <div class="scene-background" aria-hidden="true"></div>
    <div class="scene-vignette" aria-hidden="true"></div>
    ${hud(s)}
    <div class="result-card">
      <div class="result-icon">${winner ? '✓' : '–'}</div>
      <div class="result-kicker">ROUND ${s.round} COMPLETE</div>
      <div class="result-title">${winner ? escapeHtml(winner) + ' gets the point!' : 'No one scored this round'}</div>
      <div class="result-score">${escapeHtml(p1)} ${s.scores.player1} — ${s.scores.player2} ${escapeHtml(p2)}</div>
      ${s.role === 'player1' ? `<div class="result-actions">${categories.map(c => `<button class="scene-control-btn" data-action="next-round" data-category="${c.id}">${c.icon} ${escapeHtml(c.label)}</button>`).join('')}</div>` : '<div class="result-waiting">Waiting for Player 1 to start the next round…</div>'}
    </div>
  </div>`;
}
function renderGameOver(s) {
  const p1 = s.scores.player1;
  const p2 = s.scores.player2;
  const winner = p1 === p2 ? null : (p1 > p2 ? 'player1' : 'player2');
  const name = winner ? (s.players[winner]?.name || '') : "It's a tie!";
  return `<div class="game-scene result-scene">
    <div class="scene-background" aria-hidden="true"></div>
    <div class="scene-vignette" aria-hidden="true"></div>
    ${hud(s)}
    <div class="result-card game-over-card">
      <div class="result-icon trophy">🏆</div>
      <div class="result-kicker">GAME OVER</div>
      <div class="result-title">${escapeHtml(name)}</div>
      <div class="result-score">${escapeHtml(s.players.player1?.name || 'Player 1')} ${p1} — ${p2} ${escapeHtml(s.players.player2?.name || 'Player 2')}</div>
      ${s.role === 'player1' ? '<button class="scene-control-btn primary" data-action="restart-game">PLAY AGAIN</button>' : ''}
    </div>
  </div>`;
}
function render() {
  const s=latestState;
  if(!s) return;
  $('#room-code-chip').textContent=s.roomCode;
  $('#role-chip').textContent=s.role==='player1'?'PLAYER 1 · CREATOR':'PLAYER 2';
  $('#round-chip').textContent=s.round?`Round ${s.round}`:'';
  $('#screen-room').classList.toggle('game-mode', ['playing','revealed','roundEnd','gameOver'].includes(s.gameState));
  let html='';
  if(s.gameState==='lobby') html=renderLobby(s);
  else if(s.gameState==='playing') html=renderPlaying(s);
  else if(s.gameState==='revealed') html=renderRevealed(s);
  else if(s.gameState==='roundEnd') html=renderRoundEnd(s);
  else if(s.gameState==='gameOver') html=renderGameOver(s);
  $('#room-content').innerHTML=html;
}
