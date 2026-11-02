const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const onlineCombat = require('./assets/online-combat.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3001;
const rooms = new Map();
const DATA_DIR = process.env.SPECT_DATA_DIR || path.join(ROOT, 'data');
const DATA_DIR_ABSOLUTE = path.resolve(DATA_DIR);
const SESSION_SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const WALLET_FILE = path.join(DATA_DIR, 'blue-coins.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
let sessionSecret = process.env.SPECT_SESSION_SECRET || '';
if (!sessionSecret) {
  try { sessionSecret = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim(); }
  catch (_) { sessionSecret = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(SESSION_SECRET_FILE, sessionSecret, { mode: 0o600 }); }
}
let wallet = { balances: {}, claims: [] };
try { wallet = Object.assign(wallet, JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'))); wallet.balances = wallet.balances || {}; wallet.claims = wallet.claims || []; } catch (_) {}
const busyAccounts = new Map();
const BLUE_COINS_PER_WIN = Math.max(1, Math.min(1000, Number(process.env.SPECT_BLUE_COINS_PER_WIN) || 10));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.fbx': 'application/octet-stream',
  '.json': 'application/json'
};

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}

function broadcast(room, message, except) {
  if (!room) return;
  for (const client of room.clients.values()) {
    if (client !== except) send(client.socket, message);
  }
}

function sessionSignature(id) { return crypto.createHmac('sha256', sessionSecret).update(id).digest('base64url'); }
function getSessionToken(request) {
  const entry = String(request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('spect_session='));
  if (!entry) return null;
  const parts = decodeURIComponent(entry.slice('spect_session='.length)).split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{48}$/.test(parts[0])) return null;
  const expected = Buffer.from(sessionSignature(parts[0])), actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return parts[0];
}
function persistWallet() {
  const temp = WALLET_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(wallet), { mode: 0o600 });
  fs.renameSync(temp, WALLET_FILE);
}
function accountBalance(id) { return Math.max(0, Number(wallet.balances[id]) || 0); }
function endInvite(room, invite, reason) {
  if (!invite || room.invites.get(invite.id) !== invite) return;
  room.invites.delete(invite.id); invite.accounts.forEach(account => busyAccounts.delete(account));
  [invite.fromId, invite.toId].forEach(id => send(room.clients.get(id)?.socket, { type: 'challenge-ended', inviteId: invite.id, reason }));
}
function cancelDuel(room, duel, reason) {
  if (!duel || room.duels.get(duel.id) !== duel) return;
  room.duels.delete(duel.id); duel.participants.forEach(player => busyAccounts.delete(player.accountId));
  duel.participants.forEach(player => send(room.clients.get(player.id)?.socket, { type: 'duel-cancelled', duelId: duel.id, reason }));
}
function finishDuel(room, duel) {
  if (room.duels.get(duel.id) !== duel || duel.completed.size !== 2) return;
  if (Date.now() - duel.startedAt < 3000 || duel.completed.get(duel.participants[0].id) !== duel.result.winner || duel.completed.get(duel.participants[1].id) !== duel.result.winner) {
    cancelDuel(room, duel, 'O resultado recebido não corresponde à batalha oficial. Nenhuma moeda foi entregue.'); return;
  }
  const winner = duel.participants[duel.result.winner], claimKey = duel.id;
  let awarded = false;
  if (!wallet.claims.includes(claimKey)) {
    wallet.balances[winner.accountId] = accountBalance(winner.accountId) + BLUE_COINS_PER_WIN;
    wallet.claims.push(claimKey); if (wallet.claims.length > 5000) wallet.claims = wallet.claims.slice(-5000);
    persistWallet(); awarded = true;
  }
  room.duels.delete(duel.id); duel.participants.forEach(player => busyAccounts.delete(player.accountId));
  duel.participants.forEach((player, index) => send(room.clients.get(player.id)?.socket, {
    type: 'duel-result', duelId: duel.id, winnerId: winner.id, winnerIndex: duel.result.winner,
    coins: awarded && index === duel.result.winner ? BLUE_COINS_PER_WIN : 0,
    balance: accountBalance(player.accountId), damage: duel.result.damage
  }));
}

function cleanPlayer(input, previous) {
  input = input && typeof input === 'object' ? input : {};
  const old = previous || {};
  const num = (value, fallback) => Number.isFinite(Number(value))
    ? Math.max(-500, Math.min(500, Number(value)))
    : fallback;
  const player = {
    x: num(input.x, old.x || 0),
    y: num(input.y, old.y || 0),
    z: num(input.z, old.z || 0),
    dir: num(input.dir, old.dir || 0),
    name: String(input.name || old.name || 'Explorador').slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : (old.color || '#30bfe3')
  };
  const image = input.image || old.image;
  if (typeof image === 'string' && image.startsWith('data:image/png;base64,') && image.length < 60000) player.image = image;
  return player;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/api/session' && req.method === 'GET') {
    const id = getSessionToken(req) || crypto.randomBytes(24).toString('hex');
    const token = id + '.' + sessionSignature(id);
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'spect_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (secure ? '; Secure' : '') });
    res.end(JSON.stringify({ ok: true })); return;
  }
  const target = path.resolve(ROOT, '.' + pathname);
  if (target === DATA_DIR_ABSOLUTE || target.startsWith(DATA_DIR_ABSOLUTE + path.sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
});

const webSockets = new WebSocketServer({ server, path: '/spect-ws', maxPayload: 65536 });
webSockets.on('connection', (socket, request) => {
  const url = new URL(request.url, 'http://localhost');
  const roomId = String(url.searchParams.get('room') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  if (!roomId) {
    socket.close(1008, 'Código da sala ausente');
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = { clients: new Map(), players: new Map(), updatedAt: new Map(), invites: new Map(), duels: new Map() };
    rooms.set(roomId, room);
  }
  if (room.clients.size >= 12) {
    send(socket, { type: 'full' });
    socket.close(1000, 'Sala cheia');
    return;
  }

  const id = crypto.randomBytes(5).toString('hex'), accountId = getSessionToken(request) || 'guest-' + crypto.randomBytes(20).toString('hex');
  const snapshot = Array.from(room.players.entries()).map(([playerId, player]) => ({ id: playerId, player }));
  room.clients.set(id, { socket, id, accountId });
  send(socket, { type: 'welcome', id, players: snapshot });
  send(socket, { type: 'coin-balance', balance: accountBalance(accountId) });
  broadcast(room, { type: 'joined', id }, socket);
  console.log(`Jogador ${id} entrou na sala ${roomId}`);

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_) { return; }
    const client = room.clients.get(id);
    if (!client) return;
    if (message.type === 'chat') {
      const text = String(message.text || '').trim().slice(0, 180);
      if (!text) return;
      const player = room.players.get(id);
      broadcast(room, { type: 'chat', id, name: player && player.name || 'Explorador', text, time: Date.now() });
      return;
    }
    if (message.type === 'challenge') {
      const targetId = String(message.targetId || ''), target = room.clients.get(targetId), from = room.players.get(id), to = room.players.get(targetId);
      if (!target || targetId === id || !from || !to || !from.image || !to.image || Date.now() - (room.updatedAt.get(targetId) || 0) > 2500) { send(socket, { type: 'challenge-error', text: 'Esse jogador está indisponível para um desafio.' }); return; }
      if (Math.hypot(from.x - to.x, from.z - to.z) > 4.5) { send(socket, { type: 'challenge-error', text: 'Chegue mais perto do outro jogador.' }); return; }
      if (busyAccounts.has(client.accountId) || busyAccounts.has(target.accountId)) { send(socket, { type: 'challenge-error', text: 'Um dos jogadores já recebeu um convite ou está em batalha.' }); return; }
      const invite = { id: crypto.randomBytes(12).toString('hex'), fromId: id, toId: targetId, accounts: [client.accountId, target.accountId], createdAt: Date.now() };
      room.invites.set(invite.id, invite); invite.accounts.forEach(account => busyAccounts.set(account, invite.id));
      const timer = setTimeout(() => endInvite(room, invite, 'O convite expirou.'), 30000); if (timer.unref) timer.unref();
      send(target.socket, { type: 'challenge-invite', inviteId: invite.id, fromId: id, name: from.name || 'Explorador' });
      send(socket, { type: 'challenge-sent', inviteId: invite.id, targetId, name: to.name || 'Explorador' }); return;
    }
    if (message.type === 'challenge-response') {
      const invite = room.invites.get(String(message.inviteId || ''));
      if (!invite || invite.toId !== id) return;
      if (!message.accept) { endInvite(room, invite, 'O jogador recusou o desafio.'); return; }
      const challengerClient = room.clients.get(invite.fromId), targetClient = room.clients.get(invite.toId), from = room.players.get(invite.fromId), to = room.players.get(invite.toId);
      if (!challengerClient || !targetClient || !from || !to || !from.image || !to.image) { endInvite(room, invite, 'Um jogador desconectou ou não tem uma imagem selecionada.'); return; }
      let fighters;
      try { fighters = [from, to].map(player => Object.assign(onlineCombat.analyzeImage(player.image), { image: player.image })); }
      catch (error) { endInvite(room, invite, 'Não foi possível preparar as imagens para a batalha.'); return; }
      room.invites.delete(invite.id);
      const duel = { id: crypto.randomBytes(16).toString('hex'), participants: [{ id: invite.fromId, accountId: challengerClient.accountId }, { id: invite.toId, accountId: targetClient.accountId }], fighters, seed: crypto.randomBytes(4).readUInt32LE(0), result: null, completed: new Map(), startedAt: Date.now() };
      duel.result = onlineCombat.simulateBattle(fighters, duel.seed);
      room.duels.set(duel.id, duel); duel.participants.forEach(player => busyAccounts.set(player.accountId, duel.id));
      const timer = setTimeout(() => cancelDuel(room, duel, 'A batalha expirou sem terminar.'), 120000); if (timer.unref) timer.unref();
      const payload = { type: 'duel-start', duelId: duel.id, seed: duel.seed, participantIds: duel.participants.map(player => player.id), fighters: duel.fighters };
      duel.participants.forEach(player => send(room.clients.get(player.id)?.socket, payload)); return;
    }
    if (message.type === 'duel-complete') {
      const duel = room.duels.get(String(message.duelId || ''));
      if (!duel || !duel.participants.some(player => player.id === id)) return;
      if (message.failed) { cancelDuel(room, duel, 'A batalha não pôde ser iniciada. Nenhuma moeda foi entregue.'); return; }
      if (!Number.isInteger(message.winnerIndex) || message.winnerIndex < 0 || message.winnerIndex > 1) return;
      if (duel.completed.has(id)) return;
      duel.completed.set(id, message.winnerIndex); finishDuel(room, duel); return;
    }
    if (message.type !== 'state') return;
    const player = cleanPlayer(message.player, room.players.get(id));
    room.players.set(id, player);
    room.updatedAt.set(id, Date.now());
    const networkPlayer = Object.assign({}, player);
    if (!message.player || !message.player.image) delete networkPlayer.image;
    broadcast(room, { type: 'state', id, player: networkPlayer }, socket);
  });

  socket.on('close', () => {
    const current = rooms.get(roomId);
    if (!current) return;
    current.clients.delete(id);
    current.players.delete(id);
    current.updatedAt.delete(id);
    broadcast(current, { type: 'left', id });
    for (const invite of Array.from(current.invites.values())) if (invite.fromId === id || invite.toId === id) endInvite(current, invite, 'Um jogador desconectou.');
    for (const duel of Array.from(current.duels.values())) if (duel.participants.some(player => player.id === id)) cancelDuel(current, duel, 'Um jogador desconectou. Nenhuma moeda foi entregue.');
    if (!current.clients.size) rooms.delete(roomId);
    console.log(`Jogador ${id} saiu da sala ${roomId}`);
  });
  socket.on('error', error => console.error(`WebSocket ${id}:`, error.message));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Spect pronto na porta ${PORT}`));

