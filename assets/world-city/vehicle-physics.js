(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpectVehiclePhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createVehicleCollider(vehicle, position, platform) {
    var origin = position || vehicle.origin;
    var shapes = platform ? (vehicle.platforms || (vehicle.hitbox ? [vehicle.hitbox] : [])) : (vehicle.hitboxes || (vehicle.hitbox ? [vehicle.hitbox] : []));
    return shapes.map(function (shape) {
      return {
        min: [shape.min[0], origin[1] + shape.min[1], shape.min[2]],
        max: [shape.max[0], origin[1] + shape.max[1], shape.max[2]],
        origin: [origin[0], origin[1], origin[2]],
        yaw: Number(vehicle.hitboxYaw) || 0,
        kind: platform ? 'vehicle-platform' : 'vehicle-body',
        platform: !!platform
      };
    });
  }

  function localPoint(x, z, box) {
    if (!box.origin) return [x, z];
    var dx = x - box.origin[0], dz = z - box.origin[2];
    var c = Math.cos(box.yaw || 0), s = Math.sin(box.yaw || 0);
    return [dx * c - dz * s, dz * c + dx * s];
  }

  function circleHitsBox(x, z, radius, box) {
    var point = localPoint(x, z, box);
    var closestX = Math.max(box.min[0], Math.min(point[0], box.max[0]));
    var closestZ = Math.max(box.min[2], Math.min(point[1], box.max[2]));
    var dx = point[0] - closestX, dz = point[1] - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  function rectanglePenetration(x, z, playerYaw, box, halfWidth, halfDepth) {
    var point = localPoint(x, z, box);
    var yaw = playerYaw - (box.yaw || 0);
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var cx = (box.min[0] + box.max[0]) * 0.5;
    var cz = (box.min[2] + box.max[2]) * 0.5;
    var hx = (box.max[0] - box.min[0]) * 0.5;
    var hz = (box.max[2] - box.min[2]) * 0.5;
    var dx = point[0] - cx, dz = point[1] - cz;
    var hw = halfWidth || 0.37, hd = halfDepth || 0.33;
    return Math.min(
      hx + Math.abs(c) * hw + Math.abs(s) * hd - Math.abs(dx),
      hz + Math.abs(s) * hw + Math.abs(c) * hd - Math.abs(dz),
      hw + hx * Math.abs(c) + hz * Math.abs(s) - Math.abs(dx * c - dz * s),
      hd + hx * Math.abs(s) + hz * Math.abs(c) - Math.abs(dx * s + dz * c)
    );
  }

  return {
    createVehicleCollider: createVehicleCollider,
    localPoint: localPoint,
    circleHitsBox: circleHitsBox,
    rectanglePenetration: rectanglePenetration
  };
});
