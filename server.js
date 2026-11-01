const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3001;
const rooms = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.mp3':'audio/mpeg', '.fbx':'application/octet-stream', '.json':'application/json' };

function send(socket, value) {
  if (socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(value));
  let header;
  if (payload.length < 126) { header = Buffer.from([0x81, payload.length]); }
  else if (payload.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { socket.destroy(); return; }
  socket.write(Buffer.concat([header, payload]));
}
function broadcast(room, value, except) {
  const clients = rooms.get(room);
  if (!clients) return;
  clients.forEach(client => { if (client !== except) send(client.socket, value); });
}
function cleanPlayer(input, previous) {
  input = input && typeof input === 'object' ? input : {};
  const old = previous || {};
  const num = (v, fallback) => Number.isFinite(Number(v)) ? Math.max(-500, Math.min(500, Number(v))) : fallback;
  const player = {
    x: num(input.x, old.x || 0), z: num(input.z, old.z || 0), dir: num(input.dir, old.dir || 0),
    y: num(input.y, old.y || 0), name: String(input.name || old.name || 'Explorador').slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : (old.color || '#30bfe3')
  };
  const image = input.image || old.image;
  if (typeof image === 'string' && image.startsWith('data:image/') && image.length < 60000) player.image = image;
  return player;
}
function processFrame(client, opcode, payload) {
  if (opcode === 8) { client.socket.end(); return; }
  if (opcode === 9) { client.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); return; }
  if (opcode !== 1) return;
  let message;
  try { message = JSON.parse(payload.toString('utf8')); } catch (_) { return; }
  const room = rooms.get(client.room);
  if (!room) return;
  if (message.type === 'state') {
    const previous = room.players.get(client.id) || {};
    const player = cleanPlayer(message.player, previous);
    room.players.set(client.id, player);
    broadcast(client.room, { type:'state', id:client.id, player }, client);
  }
}
function readFrames(client, data) {
  client.buffer = Buffer.concat([client.buffer, data]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0], second = client.buffer[1], opcode = first & 15, masked = !!(second & 128);
    let length = second & 127, offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { client.socket.destroy(); return; }
    const maskSize = masked ? 4 : 0;
    if (length > 65536) { client.socket.destroy(); return; }
    if (client.buffer.length < offset + maskSize + length) return;
    let payload = client.buffer.subarray(offset + maskSize, offset + maskSize + length);
    if (masked) { const mask = client.buffer.subarray(offset, offset + 4); payload = Buffer.from(payload); for (let i=0;i<payload.length;i++) payload[i] ^= mask[i%4]; }
    client.buffer = client.buffer.subarray(offset + maskSize + length);
    processFrame(client, opcode, payload);
  }
}
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(ROOT, '.' + pathname);
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'index.html')) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type':MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    fs.createReadStream(target).pipe(res);
  });
});
server.on('upgrade', (req, socket) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (_) { socket.destroy(); return; }
  if (url.pathname !== '/spect-ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const roomId = String(url.searchParams.get('room') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  if (!roomId) { socket.end(); return; }
  let room = rooms.get(roomId);
  if (!room) { room = { clients:new Map(), players:new Map() }; rooms.set(roomId, room); }
  if (room.clients.size >= 12) { send(socket, {type:'full'}); socket.end(); return; }
  const client = { socket, room:roomId, id:crypto.randomBytes(5).toString('hex'), buffer:Buffer.alloc(0) };
  const snapshot = Array.from(room.players.entries()).map(([id, player]) => ({ id, player }));
  room.clients.set(client.id, client);
  send(socket, { type:'welcome', id:client.id, players:snapshot });
  broadcast(roomId, { type:'joined', id:client.id }, client);
  socket.on('data', data => readFrames(client, data));
  socket.on('close', () => { const current=rooms.get(roomId); if (!current) return; current.clients.delete(client.id); current.players.delete(client.id); broadcast(roomId, {type:'left', id:client.id}); if (!current.clients.size) rooms.delete(roomId); });
  socket.on('error', () => {});
});
server.listen(PORT, '0.0.0.0', () => console.log('Spect aberto em http://localhost:' + PORT));
