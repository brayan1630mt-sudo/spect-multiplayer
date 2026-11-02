'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const combat = require('../assets/online-combat.js');

function pngDataUrl(color) {
  const chunk = (name, body) => { const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(body.length); return Buffer.concat([length, type, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.alloc(1 + 64 * 4); for (let i = 0; i < 64 * 64; i++) color.forEach((v, c) => { row[1 + i * 4 + c] = v; });
  const rows = Buffer.concat(Array.from({ length: 64 }, () => row));
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test('server decodes only the small PNG format used for multiplayer portraits', () => {
  const red = pngDataUrl([240, 25, 40, 255]);
  const decoded = combat.decodePngDataUrl(red);
  assert.equal(decoded.length, 64 * 64 * 4);
  assert.deepEqual(Array.from(decoded.slice(0, 4)), [240, 25, 40, 255]);
  const fighter = combat.analyzeImage(red);
  assert.ok(fighter.name.length >= 4);
  assert.ok(fighter.stats.hp > 0 && fighter.stats.atq >= 20 && fighter.stats.atq <= 100);
  assert.throws(() => combat.decodePngDataUrl('data:image/jpeg;base64,AAAA'), /PNG/);
});

test('official online combat is deterministic and produces a single winner', () => {
  const fighters = [
    { stats: combat.analyzeImage(pngDataUrl([245, 30, 25, 255])).stats, type: combat.analyzeImage(pngDataUrl([245, 30, 25, 255])).type },
    { stats: combat.analyzeImage(pngDataUrl([20, 35, 240, 255])).stats, type: combat.analyzeImage(pngDataUrl([20, 35, 240, 255])).type }
  ];
  const first = combat.simulateBattle(fighters, 123456);
  const second = combat.simulateBattle(fighters, 123456);
  assert.deepEqual(first, second);
  assert.ok(first.winner === 0 || first.winner === 1);
  assert.ok(first.damage[0] >= 0 && first.damage[1] >= 0);
});
