'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const physics = require('../assets/world-city/vehicle-physics.js');

function loadCity() {
  const source = fs.readFileSync(require.resolve('../assets/world-city/city-data.js'), 'utf8');
  const match = source.match(/window\.SPECT_CITY_GZIP='([^']+)'/);
  assert.ok(match, 'city-data.js contains the offline compressed city');
  const payload = zlib.gunzipSync(Buffer.from(match[1], 'base64'));
  const headerLength = payload.readUInt32LE(0);
  return JSON.parse(payload.toString('utf8', 4, 4 + headerLength));
}

function localToWorld(x, z, collider) {
  const yaw = collider.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return [collider.origin[0] + x * c + z * s, collider.origin[2] - x * s + z * c];
}

test('every normal city car has a distinct generated model and a floor-aligned OBB', () => {
  const city = loadCity();
  const cars = city.vehicles.filter(v => /^(?:AUTOPOLY|macchina|cube)(?:[._ ]|$)/i.test(v.name));
  assert.equal(cars.length, 29, 'all AUTOPOLY, macchina and Cube city cars are rebuilt');
  assert.equal(cars.filter(v => /^macchina(?:[._ ]|$)/i.test(v.name)).length, 11, 'all macchina cars are included');
  assert.equal(cars.filter(v => /^cube(?:[._ ]|$)/i.test(v.name)).length, 4, 'all Cube cars are included');
  const customGroups = city.groups.filter(group => group.vehicleId);
  assert.equal(customGroups.length, cars.length * 9, 'each car gets its own body, trim, glass, wheel and light meshes');
  assert.equal(new Set(cars.map(car => car.id)).size, cars.length, 'no vehicle IDs collide');
  for (const car of cars) {
    assert.ok(car.hitboxes && car.hitboxes.length >= 2, `${car.name} has separate body and cabin colliders`);
    assert.ok(car.platforms && car.platforms.length >= 2, `${car.name} has body and roof landing surfaces`);
    assert.ok(Number.isFinite(car.hitboxYaw), `${car.name} keeps its source orientation`);
    assert.ok(car.pavementY > 0, `${car.name} was matched to a pavement surface`);
    const boxes = physics.createVehicleCollider(car, car.origin, false), platforms = physics.createVehicleCollider(car, car.origin, true);
    assert.ok(Math.abs(boxes[0].min[1] - car.pavementY) <= 0.015, `${car.name} collider meets the pavement`);
    assert.ok(Math.max(...boxes.map(box => box.max[1])) > boxes[0].min[1] + .9, `${car.name} collider has vehicle height`);
    assert.ok(Math.max(...boxes.map(box => box.max[0])) - Math.min(...boxes.map(box => box.min[0])) > 1.2 && Math.max(...boxes.map(box => box.max[2])) - Math.min(...boxes.map(box => box.min[2])) > 2, `${car.name} retains a car-sized footprint`);
    assert.ok(platforms[0].max[1] < platforms[1].max[1], `${car.name} platforms follow hood and roof heights`);
  }
  assert.equal(customGroups.some(group => /gelataio/i.test(group.key)), false, 'the ice-cream vehicle remains on its original model path');
});

test('all four sides block a player without trapping motion parallel to the vehicle', () => {
  const city = loadCity();
  const cars = city.vehicles.filter(v => /^(?:AUTOPOLY|macchina|cube)(?:[._ ]|$)/i.test(v.name));
  for (const car of cars) {
    const boxes = physics.createVehicleCollider(car, car.origin, false);
    const box = boxes[0];
    const cx = (box.min[0] + box.max[0]) * .5;
    const cz = (box.min[2] + box.max[2]) * .5;
    const hx = Math.max(...boxes.map(item => item.max[0])) - cx;
    const hz = Math.max(...boxes.map(item => item.max[2])) - cz;
    const depth = point => Math.max(...boxes.map(item => physics.rectanglePenetration(point[0], point[1], Math.PI, item, .37, .33)));
    for (const [axis, sign, half] of [[0, -1, hx], [0, 1, hx], [1, -1, hz], [1, 1, hz]]) {
      const outside = half + .9, toward = half + .2;
      const start = axis === 0 ? localToWorld(cx + sign * outside, cz, box) : localToWorld(cx, cz + sign * outside, box);
      const candidate = axis === 0 ? localToWorld(cx + sign * toward, cz, box) : localToWorld(cx, cz + sign * toward, box);
      const before = depth(start);
      const after = depth(candidate);
      assert.ok(after > 0, `${car.name} blocks approach from side ${axis}:${sign}`);
      assert.ok(before <= 0 || after > before + .002, `${car.name} reports increasing penetration at side ${axis}:${sign}`);
      const slide = axis === 0 ? localToWorld(cx + sign * (half + .3), cz + .25, box) : localToWorld(cx + .25, cz + sign * (half + .3), box);
      const previous = axis === 0 ? localToWorld(cx + sign * (half + .3), cz, box) : localToWorld(cx, cz + sign * (half + .3), box);
      const slideDepth = depth(slide);
      const previousDepth = depth(previous);
      assert.ok(slideDepth <= 0 || slideDepth <= previousDepth + .002, `${car.name} permits parallel sliding`);
    }
  }
});

test('OBB transforms agree with source yaw and camera-circle collision', () => {
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const vehicle = { origin: [3, 1, -4], hitboxYaw: yaw, hitbox: { min: [-.8, 0, -1.3], max: [.8, 1.5, 1.3] } };
    const box = physics.createVehicleCollider(vehicle, vehicle.origin, false)[0];
    const front = localToWorld(0, 1.1, box);
    const side = localToWorld(.7, 0, box);
    assert.ok(physics.circleHitsBox(front[0], front[1], .2, box));
    assert.ok(physics.circleHitsBox(side[0], side[1], .2, box));
    const clear = localToWorld(1.5, 1.8, box);
    assert.equal(physics.circleHitsBox(clear[0], clear[1], .2, box), false);
  }
});

