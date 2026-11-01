const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3001;
const rooms = new Map();
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
  if (typeof image === 'string' && image.startsWith('data:image/') && image.length < 60000) player.image = image;
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
  const target = path.resolve(ROOT, '.' + pathname);
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
    socket.close(1008, 'CÃ³digo da sala ausente');
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = { clients: new Map(), players: new Map() };
    rooms.set(roomId, room);
  }
  if (room.clients.size >= 12) {
    send(socket, { type: 'full' });
    socket.close(1000, 'Sala cheia');
    return;
  }

  const id = crypto.randomBytes(5).toString('hex');
  const snapshot = Array.from(room.players.entries()).map(([playerId, player]) => ({ id: playerId, player }));
  room.clients.set(id, { socket, id });
  send(socket, { type: 'welcome', id, players: snapshot });
  broadcast(room, { type: 'joined', id }, socket);
  console.log(`Jogador ${id} entrou na sala ${roomId}`);

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_) { return; }
    if (message.type === 'chat') {
      const text = String(message.text || '').trim().slice(0, 180);
      if (!text) return;
      const player = room.players.get(id);
      broadcast(room, { type: 'chat', id, name: player && player.name || 'Explorador', text, time: Date.now() });
      return;
    }
    if (message.type !== 'state') return;
    const player = cleanPlayer(message.player, room.players.get(id));
    room.players.set(id, player);
    broadcast(room, { type: 'state', id, player }, socket);
  });

  socket.on('close', () => {
    const current = rooms.get(roomId);
    if (!current) return;
    current.clients.delete(id);
    current.players.delete(id);
    broadcast(current, { type: 'left', id });
    if (!current.clients.size) rooms.delete(roomId);
    console.log(`Jogador ${id} saiu da sala ${roomId}`);
  });
  socket.on('error', error => console.error(`WebSocket ${id}:`, error.message));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Spect pronto na porta ${PORT}`));

