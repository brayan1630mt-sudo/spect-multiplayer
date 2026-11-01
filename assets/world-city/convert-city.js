// One-time offline conversion of the supplied FBX into compressed WebGL buffers.
// Run from the project root: node assets/world-city/convert-city.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dir = __dirname;
const source = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.fbx'));
if (!source) throw new Error('No FBX model in assets/world-city');
const data = fs.readFileSync(path.join(dir, source));
if (data.toString('ascii', 0, 20) !== 'Kaydara FBX Binary  ') throw new Error('Expected a binary FBX file');
const version = data.readUInt32LE(23);
if (version >= 7500) throw new Error('This converter currently supports FBX versions before 7500');
let offset = 27;

function readProperty() {
  const type = String.fromCharCode(data[offset++]);
  const scalar = { C: ['readInt8', 1], B: ['readInt8', 1], Y: ['readInt16LE', 2], I: ['readInt32LE', 4], F: ['readFloatLE', 4], L: ['readBigInt64LE', 8], D: ['readDoubleLE', 8] };
  if (scalar[type]) {
    const [reader, size] = scalar[type];
    const value = data[reader](offset);
    offset += size;
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if ('cbilfd'.includes(type)) {
    const count = data.readUInt32LE(offset), encoding = data.readUInt32LE(offset + 4), length = data.readUInt32LE(offset + 8);
    offset += 12;
    let bytes = data.subarray(offset, offset + length);
    offset += length;
    if (encoding === 1) bytes = zlib.inflateSync(bytes);
    else if (encoding !== 0) throw new Error('Unsupported FBX array encoding');
    return { type, count, bytes };
  }
  if (type === 'S' || type === 'R') {
    const length = data.readUInt32LE(offset); offset += 4;
    const bytes = data.subarray(offset, offset + length); offset += length;
    return type === 'S' ? bytes.toString('utf8') : bytes;
  }
  throw new Error('Unsupported FBX property ' + type);
}

function readNode() {
  if (offset + 13 > data.length) return null;
  const start = offset, end = data.readUInt32LE(offset), count = data.readUInt32LE(offset + 4), propertyBytes = data.readUInt32LE(offset + 8), nameLength = data[offset + 12];
  if (!end && !nameLength) { offset += 13; return null; }
  offset += 13;
  const name = data.toString('utf8', offset, offset + nameLength); offset += nameLength;
  const propertiesEnd = offset + propertyBytes, values = [];
  for (let i = 0; i < count; i++) values.push(readProperty());
  offset = propertiesEnd;
  const children = [];
  while (offset < end) {
    const before = offset, child = readNode();
    if (child) children.push(child);
    if (offset <= before) throw new Error('Invalid FBX node at ' + start);
  }
  return { name, values, children };
}

const root = { name: 'root', children: [] };
while (offset + 13 < data.length) { const node = readNode(); if (!node) break; root.children.push(node); }
function child(node, name) { return (node.children || []).find((item) => item.name === name); }
function all(node, name, out = []) { if (node.name === name) out.push(node); (node.children || []).forEach((item) => all(item, name, out)); return out; }
function arrayNumbers(value) {
  const out = new Array(value.count), read = { d: 'readDoubleLE', f: 'readFloatLE', i: 'readInt32LE', l: 'readBigInt64LE' }[value.type];
  const stride = { d: 8, f: 4, i: 4, l: 8 }[value.type];
  for (let i = 0; i < out.length; i++) { const v = value.bytes[read](i * stride); out[i] = typeof v === 'bigint' ? Number(v) : v; }
  return out;
}
function props(node) {
  const p70 = child(node, 'Properties70');
  const result = {};
  if (p70) for (const p of p70.children) result[p.values[0]] = p.values.slice(-3).map(Number);
  return result;
}
function layer(geometry, type) {
  const node = child(geometry, type);
  if (!node) return null;
  const info = {};
  for (const c of node.children) info[c.name] = c.values;
  const key = type === 'LayerElementNormal' ? 'Normals' : type === 'LayerElementUV' ? 'UV' : 'Materials';
  return {
    mapping: info.MappingInformationType && info.MappingInformationType[0],
    reference: info.ReferenceInformationType && info.ReferenceInformationType[0],
    values: info[key] && info[key][0] ? arrayNumbers(info[key][0]) : [],
    indices: info[type === 'LayerElementUV' ? 'UVIndex' : 'NormalsIndex'] && info[type === 'LayerElementUV' ? 'UVIndex' : 'NormalsIndex'][0] ? arrayNumbers(info[type === 'LayerElementUV' ? 'UVIndex' : 'NormalsIndex'][0]) : []
  };
}
function lookup(layerInfo, polygonIndex, polygonVertex, vertexIndex, stride) {
  if (!layerInfo || !layerInfo.values.length) return -1;
  let index;
  switch (layerInfo.mapping) {
    case 'ByPolygonVertex': index = polygonVertex; break;
    case 'ByVertex': case 'ByVertice': index = vertexIndex; break;
    case 'ByPolygon': index = polygonIndex; break;
    case 'AllSame': index = 0; break;
    default: index = polygonVertex;
  }
  if (layerInfo.reference === 'IndexToDirect' || layerInfo.reference === 'Index') index = layerInfo.indices[index];
  return Number.isInteger(index) ? index * stride : -1;
}
function rotate(v, r) {
  const x = r[0] * Math.PI / 180, y = r[1] * Math.PI / 180, z = r[2] * Math.PI / 180;
  let a = [v[0], v[1] * Math.cos(x) - v[2] * Math.sin(x), v[1] * Math.sin(x) + v[2] * Math.cos(x)];
  a = [a[0] * Math.cos(y) + a[2] * Math.sin(y), a[1], -a[0] * Math.sin(y) + a[2] * Math.cos(y)];
  return [a[0] * Math.cos(z) - a[1] * Math.sin(z), a[0] * Math.sin(z) + a[1] * Math.cos(z), a[2]];
}
function decodeName(value) { return String(value || '').split('\0')[0].replace(/^\d+::/, ''); }

const objects = child(root, 'Objects'), connections = child(root, 'Connections');
const models = objects.children.filter((n) => n.name === 'Model'), geometries = objects.children.filter((n) => n.name === 'Geometry'), materials = objects.children.filter((n) => n.name === 'Material'), textures = objects.children.filter((n) => n.name === 'Texture');
const links = connections.children.filter((n) => n.name === 'C');
const modelById = new Map(models.map((n) => [String(n.values[0]), n]));
const geometryById = new Map(geometries.map((n) => [String(n.values[0]), n]));
const materialById = new Map(materials.map((n) => [String(n.values[0]), n]));
const textureByMaterial = new Map();
for (const c of links) if (c.values[0] === 'OP') textureByMaterial.set(String(c.values[2]), String(c.values[1]));
const filenameByTexture = new Map();
for (const tex of textures) {
  const filename = (child(tex, 'RelativeFilename') || child(tex, 'FileName'))?.values[0] || '';
  filenameByTexture.set(String(tex.values[0]), /cartelli/i.test(filename) ? 'materiale_cartelli.png' : 'TEXTURE_multicolor.png');
}
const materialsByModel = new Map();
for (const c of links) if (c.values[0] === 'OO' && materialById.has(String(c.values[1])) && modelById.has(String(c.values[2]))) {
  const id = String(c.values[2]); if (!materialsByModel.has(id)) materialsByModel.set(id, []); materialsByModel.get(id).push(String(c.values[1]));
}
const groups = new Map();
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
let triangleCount = 0;
const colliders = [];
const vehicles = [];
const crosswalks = [];
function addVertex(group, position, normal, uv, color, objectBounds, worldPosition = position) {
  group.values.push(position[0], position[1], position[2], normal[0], normal[1], normal[2], uv[0], uv[1]);
  for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], worldPosition[k]); bounds.max[k] = Math.max(bounds.max[k], worldPosition[k]); objectBounds.min[k] = Math.min(objectBounds.min[k], worldPosition[k]); objectBounds.max[k] = Math.max(objectBounds.max[k], worldPosition[k]); }
}
for (const c of links) {
  if (c.values[0] !== 'OO') continue;
  const geometry = geometryById.get(String(c.values[1])), model = modelById.get(String(c.values[2]));
  if (!geometry || !model) continue;
  const vertexNode = child(geometry, 'Vertices'), polygonNode = child(geometry, 'PolygonVertexIndex');
  if (!vertexNode || !polygonNode) continue;
  const vertices = arrayNumbers(vertexNode.values[0]), polygons = arrayNumbers(polygonNode.values[0]);
  const normalLayer = layer(geometry, 'LayerElementNormal'), uvLayer = layer(geometry, 'LayerElementUV'), materialLayer = layer(geometry, 'LayerElementMaterial');
  const modelProps = props(model), translation = modelProps['Lcl Translation'] || [0, 0, 0], rotation = modelProps['Lcl Rotation'] || [0, 0, 0], scaling = modelProps['Lcl Scaling'] || [1, 1, 1];
  const modelName = decodeName(model.values[1]), isVehicle = /^AUTOPOLY/i.test(modelName), isTree = /^alberello/i.test(modelName), vehicleId = isVehicle ? String(model.values[0]) : null, renderOrigin = translation.map((v) => Number(v) * .01);
  const modelMaterials = materialsByModel.get(String(model.values[0])) || [];
  const objectBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const localBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const treeSamples = [];
  let polygon = [], polyIndex = 0, polygonVertex = 0;
  const emitPolygon = () => {
    if (polygon.length < 3) { polygon = []; polyIndex++; return; }
    const materialMapIndex = materialLayer && materialLayer.mapping === 'AllSame' ? 0 : materialLayer && materialLayer.mapping === 'ByPolygonVertex' ? polygonVertex - polygon.length : polyIndex;
    let materialSlot = materialLayer ? materialLayer.values[materialMapIndex] : 0;
    if (!Number.isFinite(materialSlot) || materialSlot < 0) materialSlot = 0;
    const materialId = modelMaterials[materialSlot] || modelMaterials[0] || 'default';
    const material = materialById.get(materialId), connectedTexture = textureByMaterial.get(materialId), textureName = connectedTexture ? filenameByTexture.get(connectedTexture) : null;
    const materialProps = material ? props(material) : {};
    const color = materialProps.DiffuseColor || [0.72, 0.74, 0.78];
    const materialKey = textureName ? 'tex:' + textureName : 'color:' + materialId;
    const key = isVehicle ? materialKey + ':vehicle:' + vehicleId : materialKey;
    if (!groups.has(key)) groups.set(key, { values: [], texture: textureName, color, vehicleId });
    const group = groups.get(key);
    for (let tri = 1; tri < polygon.length - 1; tri++) {
      for (const corner of [0, tri, tri + 1]) {
        const entry = polygon[corner], vi = entry.index, pi = entry.pv;
        const local = [vertices[vi * 3] * Number(scaling[0]), vertices[vi * 3 + 1] * Number(scaling[1]), vertices[vi * 3 + 2] * Number(scaling[2])];
        const rotated = rotate(local, rotation), worldPosition = [(rotated[0] + Number(translation[0])) * .01, (rotated[1] + Number(translation[1])) * .01, (rotated[2] + Number(translation[2])) * .01];
        const yaw = Number(rotation[1] || 0) * Math.PI / 180, offsetX = worldPosition[0] - renderOrigin[0], offsetZ = worldPosition[2] - renderOrigin[2], localXZ = [offsetX * Math.cos(yaw) - offsetZ * Math.sin(yaw), offsetX * Math.sin(yaw) + offsetZ * Math.cos(yaw)];
        localBounds.min[0] = Math.min(localBounds.min[0], localXZ[0]); localBounds.max[0] = Math.max(localBounds.max[0], localXZ[0]); localBounds.min[2] = Math.min(localBounds.min[2], localXZ[1]); localBounds.max[2] = Math.max(localBounds.max[2], localXZ[1]);
        if (isTree) treeSamples.push(worldPosition[0], worldPosition[1], worldPosition[2], localXZ[0], localXZ[1]);
        const position = isVehicle ? worldPosition.map((v, k) => v - renderOrigin[k]) : worldPosition;
        let nIndex = lookup(normalLayer, polyIndex, pi, vi, 3), normal = nIndex >= 0 ? normalLayer.values.slice(nIndex, nIndex + 3) : [0, 1, 0];
        normal = rotate(normal, rotation); const nLength = Math.hypot(...normal) || 1; normal = normal.map((v) => v / nLength);
        const uvOffset = lookup(uvLayer, polyIndex, pi, vi, 2), uv = uvOffset >= 0 ? [uvLayer.values[uvOffset], uvLayer.values[uvOffset + 1]] : [0, 0];
        addVertex(group, position, normal, uv, color, objectBounds, worldPosition);
      }
      triangleCount++;
    }
    polygon = []; polyIndex++;
  };
  for (let i = 0; i < polygons.length; i++) {
    const raw = polygons[i], index = raw < 0 ? -raw - 1 : raw;
    polygon.push({ index, pv: polygonVertex++ });
    if (raw < 0) emitPolygon();
  }
  const width = objectBounds.max[0] - objectBounds.min[0], height = objectBounds.max[1] - objectBounds.min[1], depth = objectBounds.max[2] - objectBounds.min[2];
  if (isVehicle && Number.isFinite(width)) {
    const forward = rotate([1, 0, 0], rotation);
    vehicles.push({ id: vehicleId, name: modelName, origin: renderOrigin, bounds: { min: objectBounds.min, max: objectBounds.max }, axis: width >= depth ? 'x' : 'z', forward: [forward[0], forward[2]] });
  }
  if (!isVehicle && Number.isFinite(width) && height < .05 && width < 10 && depth < 10 && modelMaterials.some((id) => /strisce pedo/i.test(decodeName(materialById.get(id)?.values[1])))) {
    const center = objectBounds.min.map((v, i) => (v + objectBounds.max[i]) * .5);
    const roadAxis = width < depth ? 'x' : 'z';
    crosswalks.push({ center, axis: roadAxis, fixed: center[roadAxis === 'x' ? 2 : 0], along: center[roadAxis === 'x' ? 0 : 2] });
  }
  if (!isVehicle && Number.isFinite(width) && height > .12 && width > .04 && depth > .04 && width < 80 && depth < 80) {
    let colliderMinX = localBounds.min[0], colliderMaxX = localBounds.max[0], colliderMinZ = localBounds.min[2], colliderMaxZ = localBounds.max[2];
    if (isTree && treeSamples.length) {
      let trunkMinX = Infinity, trunkMaxX = -Infinity, trunkMinZ = Infinity, trunkMaxZ = -Infinity;
      const trunkTop = objectBounds.min[1] + Math.min(1.35, Math.max(.65, height * .2));
      for (let i = 0; i < treeSamples.length; i += 5) if (treeSamples[i + 1] <= trunkTop) { trunkMinX = Math.min(trunkMinX, treeSamples[i + 3]); trunkMaxX = Math.max(trunkMaxX, treeSamples[i + 3]); trunkMinZ = Math.min(trunkMinZ, treeSamples[i + 4]); trunkMaxZ = Math.max(trunkMaxZ, treeSamples[i + 4]); }
      if (Number.isFinite(trunkMinX)) { const centerX = (trunkMinX + trunkMaxX) * .5, centerZ = (trunkMinZ + trunkMaxZ) * .5, halfX = Math.max(.28, (trunkMaxX - trunkMinX) * .5), halfZ = Math.max(.28, (trunkMaxZ - trunkMinZ) * .5); colliderMinX = centerX - halfX; colliderMaxX = centerX + halfX; colliderMinZ = centerZ - halfZ; colliderMaxZ = centerZ + halfZ; }
    }
    colliders.push({ min: [colliderMinX, objectBounds.min[1], colliderMinZ], max: [colliderMaxX, objectBounds.max[1], colliderMaxZ], origin: renderOrigin, yaw: Number(rotation[1] || 0) * Math.PI / 180, kind: isTree ? 'tree' : 'object' });
  }
}

const metadata = [], chunks = [];
let byteOffset = 0;
for (const [key, group] of groups) {
  const packed = Buffer.from(Float32Array.from(group.values).buffer);
  metadata.push({ key, offset: byteOffset, bytes: packed.length, vertices: packed.length / 32, texture: group.texture, color: group.color, vehicleId: group.vehicleId || null });
  chunks.push(packed); byteOffset += packed.length;
}
const header = Buffer.from(JSON.stringify({ version: 1, stride: 32, groups: metadata, bounds, colliders, vehicles, crosswalks, triangles: triangleCount }), 'utf8');
const dataStart = 4 + Math.ceil(header.length / 4) * 4;
const payload = Buffer.allocUnsafe(dataStart + byteOffset);
payload.writeUInt32LE(header.length, 0); header.copy(payload, 4);
let writeAt = dataStart; for (const chunk of chunks) { chunk.copy(payload, writeAt); writeAt += chunk.length; }
const compressed = zlib.gzipSync(payload, { level: 9 });
const output = `/* Offline converted from the supplied FBX. */\nwindow.SPECT_CITY_GZIP='${compressed.toString('base64')}';\n`;
fs.writeFileSync(path.join(dir, 'city-data.js'), output);
console.log(JSON.stringify({ source, groups: metadata.length, triangles: triangleCount, colliders: colliders.length, bounds, originalBytes: data.length, packedBytes: payload.length, gzipBytes: compressed.length }, null, 2));
