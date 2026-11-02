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
const treeInstances = [];
const groundTriangles = [];
const furnitureInstances = [];
function addVertex(group, position, normal, uv, color, objectBounds, worldPosition = position) {
  group.values.push(position[0], position[1], position[2], normal[0], normal[1], normal[2], uv[0], uv[1]);
  for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], worldPosition[k]); bounds.max[k] = Math.max(bounds.max[k], worldPosition[k]); objectBounds.min[k] = Math.min(objectBounds.min[k], worldPosition[k]); objectBounds.max[k] = Math.max(objectBounds.max[k], worldPosition[k]); }
}
function vehicleGroup(vehicle, role, color) {
  const key = `custom-vehicle-${vehicle.id}-${role}`;
  if (!groups.has(key)) groups.set(key, { values: [], texture: null, color, vehicleId: vehicle.id });
  return groups.get(key);
}
function vehiclePoint(vehicle, centerX, centerZ, point) {
  const fx = vehicle.forward[0], fz = vehicle.forward[1], rx = fz, rz = -fx;
  return [centerX + rx * point[0] + fx * point[2], point[1], centerZ + rz * point[0] + fz * point[2]];
}
function addVehicleTriangle(vehicle, centerX, centerZ, group, a, b, c) {
  const points = [a, b, c].map((point) => vehiclePoint(vehicle, centerX, centerZ, point));
  const ab = points[1].map((value, i) => value - points[0][i]), ac = points[2].map((value, i) => value - points[0][i]);
  let normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...normal) || 1; normal = normal.map((value) => value / length);
  for (let i = 0; i < 3; i++) {
    const point = points[i], world = [vehicle.origin[0] + point[0], vehicle.origin[1] + point[1], vehicle.origin[2] + point[2]];
    addVertex(group, point, normal, [0, 0], group.color, vehicle.generatedBounds, world);
  }
  triangleCount++;
}
function addVehicleBox(vehicle, centerX, centerZ, group, center, size) {
  const [x, y, z] = center, [w, h, d] = size, v = [
    [x-w/2,y-h/2,z-d/2],[x+w/2,y-h/2,z-d/2],[x-w/2,y+h/2,z-d/2],[x+w/2,y+h/2,z-d/2],
    [x-w/2,y-h/2,z+d/2],[x+w/2,y-h/2,z+d/2],[x-w/2,y+h/2,z+d/2],[x+w/2,y+h/2,z+d/2]
  ];
  for (const face of [[4,5,7,6],[1,3,7,5],[0,2,3,1],[0,4,6,2],[2,6,7,3],[0,1,5,4]]) {
    addVehicleTriangle(vehicle,centerX,centerZ,group,v[face[0]],v[face[1]],v[face[2]]);
    addVehicleTriangle(vehicle,centerX,centerZ,group,v[face[0]],v[face[2]],v[face[3]]);
  }
}
function addVehicleWheel(vehicle, centerX, centerZ, group, cx, cy, cz, radius, thickness) {
  const sides = 10, left = [], right = [];
  for (let i = 0; i < sides; i++) { const a=i*Math.PI*2/sides; left.push([cx-thickness/2,cy+Math.cos(a)*radius,cz+Math.sin(a)*radius]); right.push([cx+thickness/2,cy+Math.cos(a)*radius,cz+Math.sin(a)*radius]); }
  const centerL=[cx-thickness/2,cy,cz], centerR=[cx+thickness/2,cy,cz];
  for (let i = 0; i < sides; i++) { const n=(i+1)%sides; addVehicleTriangle(vehicle,centerX,centerZ,group,left[i],left[n],right[n]); addVehicleTriangle(vehicle,centerX,centerZ,group,left[i],right[n],right[i]); addVehicleTriangle(vehicle,centerX,centerZ,group,centerR,right[i],right[n]); addVehicleTriangle(vehicle,centerX,centerZ,group,centerL,left[n],left[i]); }
}
function buildReplacementVehicles() {
  const paint = [[.05,.48,.63],[.82,.84,.79],[.08,.31,.79],[.96,.39,.07],[.78,.12,.13],[.27,.72,.08],[.94,.67,.05],[.42,.2,.63],[.04,.57,.48],[.88,.22,.28],[.56,.64,.69],[.06,.48,.75],[.72,.35,.08],[.08,.31,.48]];
  vehicles.forEach((vehicle,index) => {
    const b=vehicle.bounds, origin=vehicle.origin, local=vehicle.localBounds;
    const localCenterX=(local.min[0]+local.max[0])*.5, localCenterZ=(local.min[2]+local.max[2])*.5;
    const centerX=-localCenterZ, centerZ=localCenterX;
    const length=(local.max[0]-local.min[0])*.96, width=(local.max[2]-local.min[2])*.94;
    // A small set of square-bodied profiles keeps the old city-car style while
    // making every imported vehicle visibly distinct in cabin, ride height and details.
    const profiles=[
      {bodyH:.48,cabW:.86,cabL:.60,cabZ:-.015,cabY:.72,roof:1.32,wheelY:.22,wheelR:.215,wheelZ:.325,detail:'city'},
      {bodyH:.47,cabW:.82,cabL:.55,cabZ:.025,cabY:.73,roof:1.29,wheelY:.22,wheelR:.21,wheelZ:.34,detail:'taxi'},
      {bodyH:.51,cabW:.76,cabL:.50,cabZ:.065,cabY:.77,roof:1.39,wheelY:.25,wheelR:.23,wheelZ:.33,detail:'cargo'},
      {bodyH:.44,cabW:.78,cabL:.47,cabZ:.065,cabY:.78,roof:1.23,wheelY:.20,wheelR:.19,wheelZ:.35,detail:'sport'},
      {bodyH:.53,cabW:.90,cabL:.63,cabZ:-.015,cabY:.70,roof:1.42,wheelY:.25,wheelR:.24,wheelZ:.32,detail:'utility'},
      {bodyH:.49,cabW:.88,cabL:.57,cabZ:-.035,cabY:.73,roof:1.33,wheelY:.22,wheelR:.22,wheelZ:.34,detail:'retro'},
      {bodyH:.43,cabW:.80,cabL:.52,cabZ:.045,cabY:.77,roof:1.27,wheelY:.19,wheelR:.20,wheelZ:.33,detail:'compact'}
    ];
    const profile=profiles[index%profiles.length],style='boxy',color=paint[index%paint.length];
    vehicle.style=style; vehicle.generatedBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    const body=vehicleGroup(vehicle,'paint',color),trim=vehicleGroup(vehicle,'trim',[.12,.16,.2]),glass=vehicleGroup(vehicle,'glass',[.035,.19,.3]),glassGlow=vehicleGroup(vehicle,'glass-highlight',[.12,.55,.72]),rubber=vehicleGroup(vehicle,'rubber',[.055,.065,.075]),hub=vehicleGroup(vehicle,'hub',[.52,.58,.6]),lamp=vehicleGroup(vehicle,'headlights',[1,.82,.42]),tail=vehicleGroup(vehicle,'taillights',[.82,.045,.035]),accent=vehicleGroup(vehicle,'accent',[Math.min(1,color[0]*1.24+.08),Math.min(1,color[1]*1.18+.08),Math.min(1,color[2]*1.18+.08)]);
    const wheelY=profile.wheelY,wheelR=profile.wheelR,wheelX=width*.47,wheelZ=length*profile.wheelZ,wheelT=.145;
    for (const x of [-wheelX,wheelX]) for (const z of [-wheelZ,wheelZ]) { addVehicleWheel(vehicle,centerX,centerZ,rubber,x,wheelY,z,wheelR,wheelT); addVehicleWheel(vehicle,centerX,centerZ,hub,x+Math.sign(x)*(wheelT*.39),wheelY,z,wheelR*.48,.035); }
    const bodyTop=profile.bodyH+.435;
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,.39,0],[width*.82,.22,length*.91]);
    addVehicleBox(vehicle,centerX,centerZ,body,[0,.435+profile.bodyH*.5,0],[width*.94,profile.bodyH,length*.98]);
    addVehicleBox(vehicle,centerX,centerZ,body,[0,bodyTop+.045,length*.31],[width*.9,.18,length*.27]);
    const cabBottom=profile.cabY, roofY=profile.roof, cabLength=length*profile.cabL, cabZ=length*profile.cabZ, cabHeight=roofY-cabBottom-.11, cabWidth=width*profile.cabW;
    addVehicleBox(vehicle,centerX,centerZ,body,[0,cabBottom+cabHeight*.5,cabZ],[cabWidth,cabHeight,cabLength]);
    for (const x of [-1,1]) {
      addVehicleBox(vehicle,centerX,centerZ,body,[x*(cabWidth*.5+.025),cabBottom+cabHeight*.52,cabZ],[.065,cabHeight*.88,cabLength*.82]);
      for (const z of [-1,1]) addVehicleBox(vehicle,centerX,centerZ,glass,[x*(cabWidth*.5+.045),cabBottom+cabHeight*.61,cabZ+z*cabLength*.18],[.035,cabHeight*.48,cabLength*.27]);
    }
    addVehicleBox(vehicle,centerX,centerZ,glassGlow,[0,cabBottom+cabHeight*.7,cabZ+cabLength*.37],[cabWidth*.57,cabHeight*.055,.02]);
    addVehicleBox(vehicle,centerX,centerZ,glass,[0,cabBottom+cabHeight*.58,cabZ+cabLength*.5],[cabWidth*.68,cabHeight*.52,.035]);
    addVehicleBox(vehicle,centerX,centerZ,glass,[0,cabBottom+cabHeight*.55,cabZ-cabLength*.5],[cabWidth*.62,cabHeight*.47,.03]);
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,.42,length*.5+.045],[width*.82,.1,.045]);
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,.42,-length*.5-.045],[width*.82,.1,.045]);
    for (const x of [-1,1]) addVehicleBox(vehicle,centerX,centerZ,accent,[x*width*.3,bodyTop-.04,length*.493],[width*.19,.09,.035]);
    for (const x of [-1,1]) addVehicleBox(vehicle,centerX,centerZ,tail,[x*width*.3,bodyTop-.055,-length*.493],[width*.14,.12,.04]);
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,.38,length*.5],[width*.9,.13,.09]);
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,.38,-length*.5],[width*.9,.13,.09]);
    addVehicleBox(vehicle,centerX,centerZ,trim,[0,bodyTop-.01,length*.5],[width*.3,.12,.035]);
    addVehicleBox(vehicle,centerX,centerZ,body,[0,roofY,cabZ],[cabWidth*1.08,.12,cabLength*1.08]);
    const roofHalfW=cabWidth*.54,roofHalfL=cabLength*.54,roofCorners=[[-roofHalfW,-roofHalfL],[roofHalfW,-roofHalfL],[-roofHalfW,roofHalfL],[roofHalfW,roofHalfL]].map(([x,z])=>vehiclePoint(vehicle,centerX,centerZ,[x,roofY+.06,z]));
    const roofMin=[Math.min(...roofCorners.map(p=>p[0])),roofY-.08,Math.min(...roofCorners.map(p=>p[2]))],roofMax=[Math.max(...roofCorners.map(p=>p[0])),roofY+.06,Math.max(...roofCorners.map(p=>p[2]))];
    vehicle.roof={min:roofMin,max:roofMax};
    if(style==='boxy'){
      addVehicleBox(vehicle,centerX,centerZ,accent,[0,roofY+.095,cabZ],[cabWidth*.44,.045,cabLength*.48]);
      for(const x of [-1,1]){
        addVehicleBox(vehicle,centerX,centerZ,trim,[x*(cabWidth*.5+.035),.84,-length*.22],[.035,.035,length*.25]);
        addVehicleBox(vehicle,centerX,centerZ,accent,[x*(width*.47),.79,-length*.22],[.025,.065,length*.3]);
      }
      addVehicleBox(vehicle,centerX,centerZ,trim,[0,.84,-length*.49],[width*.52,.035,.03]);
    }
    if(profile.detail==='taxi'){
      addVehicleBox(vehicle,centerX,centerZ,accent,[0,roofY+.18,cabZ],[.42,.12,.24]);
      for(const side of [-1,1]) for(let stripe=0;stripe<3;stripe++) addVehicleBox(vehicle,centerX,centerZ,stripe%2?trim:accent,[side*(cabWidth*.5+.035),.59,cabZ+(stripe-1)*.2],[.025,.09,.15]);
    }else if(profile.detail==='cargo'){
      addVehicleBox(vehicle,centerX,centerZ,body,[0,bodyTop+.28,-length*.20],[width*.82,.48,length*.42]);
      addVehicleBox(vehicle,centerX,centerZ,accent,[0,bodyTop+.27,-length*.20],[width*.84,.075,.045]);
    }else if(profile.detail==='sport'){
      addVehicleBox(vehicle,centerX,centerZ,accent,[0,bodyTop+.015,length*.24],[width*.13,.025,length*.30]);
      addVehicleBox(vehicle,centerX,centerZ,trim,[0,roofY+.14,cabZ-cabLength*.44],[cabWidth*.72,.045,.09]);
    }else if(profile.detail==='utility'){
      addVehicleBox(vehicle,centerX,centerZ,trim,[0,roofY+.16,cabZ],[cabWidth*.70,.09,cabLength*.75]);
      for(const side of [-1,1]) addVehicleBox(vehicle,centerX,centerZ,accent,[side*(width*.5+.02),.57,0],[.035,.12,length*.54]);
    }else if(profile.detail==='retro'){
      for(const side of [-1,1]) addVehicleBox(vehicle,centerX,centerZ,accent,[side*width*.24,bodyTop+.012,length*.20],[width*.12,.025,length*.34]);
      addVehicleBox(vehicle,centerX,centerZ,trim,[0,bodyTop+.025,-length*.28],[width*.62,.045,.045]);
    }else if(profile.detail==='compact'){
      addVehicleBox(vehicle,centerX,centerZ,accent,[0,roofY+.15,cabZ-cabLength*.38],[cabWidth*.58,.04,.08]);
      addVehicleBox(vehicle,centerX,centerZ,glassGlow,[0,bodyTop+.012,length*.19],[width*.23,.018,length*.24]);
    }
    vehicle.bounds=vehicle.generatedBounds; delete vehicle.generatedBounds;
    // Separate the lower body and cabin so side collisions follow the square
    // silhouette and jump landings sit on real body and roof heights.
    const halfHitWidth=wheelX+wheelT*.5, halfHitLength=Math.max(length*.545,wheelZ+wheelR);
    const cabHalfWidth=cabWidth*.54,cabHalfLength=cabLength*.54;
    vehicle.hitboxes=[
      {min:[centerX-halfHitWidth,.005,centerZ-halfHitLength],max:[centerX+halfHitWidth,bodyTop+.11,centerZ+halfHitLength]},
      {min:[centerX-cabHalfWidth,cabBottom-.04,cabZ-cabHalfLength],max:[centerX+cabHalfWidth,roofY+.12,cabZ+cabHalfLength]}
    ];
    vehicle.platforms=[
      {min:[centerX-halfHitWidth,.005,centerZ-halfHitLength],max:[centerX+halfHitWidth,bodyTop+.09,centerZ+halfHitLength]},
      {min:[centerX-cabHalfWidth,cabBottom-.04,cabZ-cabHalfLength],max:[centerX+cabHalfWidth,roofY+.06,cabZ+cabHalfLength]}
    ];
    if(profile.detail==='cargo'){
      const cargoZ=-length*.20,cargoHalfLength=length*.21,cargoTop=bodyTop+.52;
      vehicle.hitboxes.push({min:[centerX-width*.42,bodyTop+.04,cargoZ-cargoHalfLength],max:[centerX+width*.42,cargoTop,cargoZ+cargoHalfLength]});
      vehicle.platforms.push({min:[centerX-width*.42,bodyTop+.04,cargoZ-cargoHalfLength],max:[centerX+width*.42,cargoTop-.02,cargoZ+cargoHalfLength]});
    }
    vehicle.squareTop=true;
  });
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
  const modelName = decodeName(model.values[1]), isVehicle = /^AUTOPOLY/i.test(modelName) || /^macchina(?:[._ ]|$)/i.test(modelName) || /^cube(?:[._ ]|$)/i.test(modelName), isTree = /^(?:alberello|pino|superpino)/i.test(modelName), isGround = /^Plane(?:\.\d+)?$/i.test(modelName), isFurniture = /^(?:TAVOLO|panchina|SEMI PANCHINA)/i.test(modelName), vehicleId = isVehicle ? String(model.values[0]) : null, renderOrigin = translation.map((v) => Number(v) * .01);
  const modelMaterials = materialsByModel.get(String(model.values[0])) || [];
  const objectBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const localBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const treeSamples = [], roofSamples = [];
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
    const key = isVehicle ? materialKey + ':vehicle:' + vehicleId : isTree ? materialKey + ':legacy-tree' : isFurniture ? materialKey + ':legacy-furniture' : materialKey;
    if (!groups.has(key)) groups.set(key, { values: [], texture: textureName, color, vehicleId });
    const group = groups.get(key);
    for (let tri = 1; tri < polygon.length - 1; tri++) {
      const groundTriangle = [];
      for (const corner of [0, tri, tri + 1]) {
        const entry = polygon[corner], vi = entry.index, pi = entry.pv;
        const local = [vertices[vi * 3] * Number(scaling[0]), vertices[vi * 3 + 1] * Number(scaling[1]), vertices[vi * 3 + 2] * Number(scaling[2])];
        const rotated = rotate(local, rotation), worldPosition = [(rotated[0] + Number(translation[0])) * .01, (rotated[1] + Number(translation[1])) * .01, (rotated[2] + Number(translation[2])) * .01];
        const yaw = Number(rotation[1] || 0) * Math.PI / 180, offsetX = worldPosition[0] - renderOrigin[0], offsetZ = worldPosition[2] - renderOrigin[2], localXZ = [offsetX * Math.cos(yaw) - offsetZ * Math.sin(yaw), offsetX * Math.sin(yaw) + offsetZ * Math.cos(yaw)];
        localBounds.min[0] = Math.min(localBounds.min[0], localXZ[0]); localBounds.max[0] = Math.max(localBounds.max[0], localXZ[0]); localBounds.min[2] = Math.min(localBounds.min[2], localXZ[1]); localBounds.max[2] = Math.max(localBounds.max[2], localXZ[1]);
        if (isTree) treeSamples.push(worldPosition[0], worldPosition[1], worldPosition[2], localXZ[0], localXZ[1]);
        if (isGround) groundTriangle.push(worldPosition);
        const position = isVehicle ? worldPosition.map((v, k) => v - renderOrigin[k]) : worldPosition;
        let nIndex = lookup(normalLayer, polyIndex, pi, vi, 3), normal = nIndex >= 0 ? normalLayer.values.slice(nIndex, nIndex + 3) : [0, 1, 0];
        normal = rotate(normal, rotation); const nLength = Math.hypot(...normal) || 1; normal = normal.map((v) => v / nLength); if (isVehicle && normal[1] > .72) roofSamples.push(worldPosition);
        const uvOffset = lookup(uvLayer, polyIndex, pi, vi, 2), uv = uvOffset >= 0 ? [uvLayer.values[uvOffset], uvLayer.values[uvOffset + 1]] : [0, 0];
        addVertex(group, position, normal, uv, color, objectBounds, worldPosition);
      }
      if (isGround && groundTriangle.length === 3) groundTriangles.push(groundTriangle);
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
  const jumpableProp = /idrante|hydrant|fire.?hyd|cestino|lixeira|trash.?bin|\bcone\b|\bcono\b|traffic.?cone|cone.?strad/i.test(modelName);
  if (isFurniture && Number.isFinite(width) && Number.isFinite(depth) && Number.isFinite(height)) {
    furnitureInstances.push({ name: modelName, centerX: (objectBounds.min[0] + objectBounds.max[0]) * .5, centerZ: (objectBounds.min[2] + objectBounds.max[2]) * .5, baseY: objectBounds.min[1], width: localBounds.max[0] - localBounds.min[0], depth: localBounds.max[2] - localBounds.min[2], height, rotation: [0, Number(rotation[1] || 0), 0] });
  }
  if (isTree && treeSamples.length && Number.isFinite(height)) treeInstances.push({ name: modelName, samples: treeSamples, minY: objectBounds.min[1], height });
  if (isVehicle && Number.isFinite(width)) {
    const forward = rotate([1, 0, 0], rotation);
    const roofY = roofSamples.length ? Math.max(...roofSamples.map((point) => point[1])) : objectBounds.max[1], roofPoints = roofSamples.filter((point) => point[1] >= roofY - .12);
    const roofMin = [0, roofY - .12, 0], roofMax = [0, roofY, 0];
    if (roofPoints.length) { for (let axis of [0, 2]) { const low = Math.min(...roofPoints.map((point) => point[axis])), high = Math.max(...roofPoints.map((point) => point[axis])), center = (low + high) * .5, half = Math.max(.39, (high - low) * .5 + .06); roofMin[axis] = center - half; roofMax[axis] = center + half; } }
    const squareTop = Math.max(width, depth) > 2.75 && Math.min(width, depth) > 1.68;
    vehicles.push({ id: vehicleId, name: modelName, origin: renderOrigin, bounds: { min: objectBounds.min, max: objectBounds.max }, localBounds: { min: localBounds.min.slice(), max: localBounds.max.slice() }, roof: { min: roofMin, max: roofMax }, squareTop, axis: width >= depth ? 'x' : 'z', forward: [forward[0], forward[2]], hitboxYaw: Math.atan2(-forward[2], forward[0]) + Math.PI / 2 });
  }
  if (!isVehicle && Number.isFinite(width) && height < .05 && width < 10 && depth < 10 && modelMaterials.some((id) => /strisce pedo/i.test(decodeName(materialById.get(id)?.values[1])))) {
    const center = objectBounds.min.map((v, i) => (v + objectBounds.max[i]) * .5);
    const roadAxis = width < depth ? 'x' : 'z';
    crosswalks.push({ center, axis: roadAxis, fixed: center[roadAxis === 'x' ? 2 : 0], along: center[roadAxis === 'x' ? 0 : 2] });
  }
  if (!isVehicle && !isTree && !isFurniture && Number.isFinite(width) && height > .12 && width > .04 && depth > .04 && width < 80 && depth < 80) {
    const halfWidth = jumpableProp ? Math.max((localBounds.max[0] - localBounds.min[0]) * .5, .29) : (localBounds.max[0] - localBounds.min[0]) * .5;
    const halfDepth = jumpableProp ? Math.max((localBounds.max[2] - localBounds.min[2]) * .5, .29) : (localBounds.max[2] - localBounds.min[2]) * .5;
    const centerX = (localBounds.min[0] + localBounds.max[0]) * .5, centerZ = (localBounds.min[2] + localBounds.max[2]) * .5;
    colliders.push({ min: [centerX - halfWidth, objectBounds.min[1], centerZ - halfDepth], max: [centerX + halfWidth, objectBounds.max[1], centerZ + halfDepth], origin: renderOrigin, yaw: Number(rotation[1] || 0) * Math.PI / 180, kind: jumpableProp ? 'jumpable' : 'object', platform: jumpableProp });
  }
}

// Use upward-facing city surfaces to place replacement tires on the pavement,
// rather than trusting FBX pivots that can leave a visible gap or sink.
const walkableSurfaces = groundTriangles.map((points) => ({ points, minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])), minZ: Math.min(...points.map((p) => p[2])), maxZ: Math.max(...points.map((p) => p[2])) }));
for (const group of groups.values()) {
  if (group.vehicleId) continue;
  for (let i = 0; i + 23 < group.values.length; i += 24) {
    const a=[group.values[i],group.values[i+1],group.values[i+2]], b=[group.values[i+8],group.values[i+9],group.values[i+10]], c=[group.values[i+16],group.values[i+17],group.values[i+18]];
    const normalY=(group.values[i+4]+group.values[i+12]+group.values[i+20])/3, minY=Math.min(a[1],b[1],c[1]), maxY=Math.max(a[1],b[1],c[1]);
    if(normalY<.72||maxY-minY>.08||minY<.35||maxY>4.5)continue;
    const points=[a,b,c];
    walkableSurfaces.push({points,minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minZ:Math.min(a[2],b[2],c[2]),maxZ:Math.max(a[2],b[2],c[2])});
  }
}
function pavementHeightAt(x,z,nearY) {
  let best=NaN,bestDistance=Infinity;
  for(const surface of walkableSurfaces){
    if(x<surface.minX-1e-5||x>surface.maxX+1e-5||z<surface.minZ-1e-5||z>surface.maxZ+1e-5)continue;
    const [a,b,c]=surface.points,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(den)<1e-8)continue;
    const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den,w=1-u-v;
    if(u< -1e-5||v< -1e-5||w< -1e-5)continue;
    const y=u*a[1]+v*b[1]+w*c[1],distance=Math.abs(y-nearY);
    if(y<nearY-.45||y>nearY+.45||distance>=bestDistance)continue;
    best=y;bestDistance=distance;
  }
  return best;
}
for(const vehicle of vehicles){
  const local=vehicle.localBounds,localX=(local.min[0]+local.max[0])*.5,localZ=(local.min[2]+local.max[2])*.5,fx=vehicle.forward[0],fz=vehicle.forward[1],cx=-localZ,cz=localX;
  const worldX=vehicle.origin[0]+fz*cx+fx*cz,worldZ=vehicle.origin[2]-fx*cx+fz*cz,floorY=pavementHeightAt(worldX,worldZ,vehicle.origin[1]);
  if(Number.isFinite(floorY)){vehicle.origin[1]=floorY-.005;vehicle.pavementY=floorY;}
}

// Replace every imported FBX car mesh with the custom low-poly vehicle set.
// Vehicle IDs, origins and collision metadata remain attached to each model.
for (const [key, group] of groups) if (group.vehicleId) groups.delete(key);
buildReplacementVehicles();

// Replace the FBX tree meshes with lightweight, faceted trees. Their trunks
// stay at the imported tree locations, while foliage no longer gets collision.
for (const key of groups.keys()) if (key.endsWith(':legacy-tree')) groups.delete(key);
for (const key of groups.keys()) if (key.endsWith(':legacy-furniture')) groups.delete(key);

const barkGroup = { values: [], texture: null, color: [.34, .19, .1], vehicleId: null };
const leafPalette = [
  [[.06, .28, .16], [.09, .39, .2], [.15, .49, .25]],
  [[.08, .25, .2], [.1, .4, .3], [.19, .52, .35]],
  [[.13, .28, .12], [.23, .42, .16], [.34, .53, .19]],
  [[.07, .3, .25], [.1, .44, .34], [.18, .56, .43]]
];
const leafGroups = leafPalette.map((palette, shade) => palette.map((color, tier) => ({ values: [], texture: null, color, vehicleId: null, _key: `tree-leaves-${shade}-${tier}` })));
function treeGroup(source) {
  const key = source._key || 'tree-bark';
  if (!groups.has(key)) groups.set(key, source);
  return groups.get(key);
}
function addTreeTriangle(group, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...normal) || 1;
  for (let i = 0; i < 3; i++) normal[i] /= length;
  for (const point of [a, b, c]) addVertex(group, point, normal, [0, 0], group.color, bounds, point);
  triangleCount++;
}
const furniturePalette = {
  wood: { values: [], texture: null, color: [.34, .16, .075], vehicleId: null, _key: 'furniture-wood' },
  woodLight: { values: [], texture: null, color: [.48, .255, .11], vehicleId: null, _key: 'furniture-wood-light' },
  woodDark: { values: [], texture: null, color: [.22, .095, .045], vehicleId: null, _key: 'furniture-wood-dark' },
  metal: { values: [], texture: null, color: [.12, .15, .16], vehicleId: null, _key: 'furniture-metal' }
};
function addFurnitureBox(group, instance, localCenter, size) {
  const [cx, cy, cz] = localCenter, [sx, sy, sz] = size;
  const corners = [], boxMin = [Infinity, Infinity, Infinity], boxMax = [-Infinity, -Infinity, -Infinity];
  for (const dx of [-.5, .5]) for (const dy of [-.5, .5]) for (const dz of [-.5, .5]) {
    const rotated = rotate([cx + dx * sx, cy + dy * sy, cz + dz * sz], instance.rotation);
    const point = [instance.centerX + rotated[0], instance.baseY + rotated[1], instance.centerZ + rotated[2]];
    corners.push(point);
    for (let axis = 0; axis < 3; axis++) { boxMin[axis] = Math.min(boxMin[axis], point[axis]); boxMax[axis] = Math.max(boxMax[axis], point[axis]); }
  }
    colliders.push({ min: boxMin, max: boxMax, kind: 'furniture-part' });
  const idx = (x, y, z) => x * 4 + y * 2 + z;
  for (const face of [
    [idx(0,0,0),idx(0,0,1),idx(0,1,1),idx(0,1,0)], [idx(1,0,0),idx(1,1,0),idx(1,1,1),idx(1,0,1)],
    [idx(0,0,0),idx(1,0,0),idx(1,0,1),idx(0,0,1)], [idx(0,1,0),idx(0,1,1),idx(1,1,1),idx(1,1,0)],
    [idx(0,0,0),idx(0,1,0),idx(1,1,0),idx(1,0,0)], [idx(0,0,1),idx(1,0,1),idx(1,1,1),idx(0,1,1)]
  ]) {
    addTreeTriangle(treeGroup(group), corners[face[0]], corners[face[1]], corners[face[2]]);
    addTreeTriangle(treeGroup(group), corners[face[0]], corners[face[2]], corners[face[3]]);
  }
}
function addFurniturePlatform(instance) {
  if (!instance.platform) return;
  const [cx, top, cz] = instance.platform.center, [sx, , sz] = instance.platform.size;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const dx of [-.5, .5]) for (const dz of [-.5, .5]) {
    const rotated = rotate([cx + dx * sx, top, cz + dz * sz], instance.rotation);
    const point = [instance.centerX + rotated[0], instance.baseY + rotated[1], instance.centerZ + rotated[2]];
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
  }
  min[1] -= .04;
  colliders.push({ min, max, kind: 'furniture' });
}
function makeFurniture(instance) {
  const alongX = instance.width >= instance.depth;
  const length = Math.max(.9, Math.min(2, Math.max(instance.width, instance.depth) * .94));
  const depth = Math.max(.34, Math.min(.76, Math.min(instance.width, instance.depth) * .94));
  const xSize = alongX ? length : depth, zSize = alongX ? depth : length;
  const at = (x, y, z) => alongX ? [x, y, z] : [z, y, x];
  if (/^TAVOLO/i.test(instance.name)) {
    const top = Math.max(.4, Math.min(.72, instance.height));
    instance.platform = { center: at(0, top, 0), size: [xSize, .04, zSize] };
    for (let plank = -1; plank <= 1; plank++) addFurnitureBox(furniturePalette.woodLight, instance, at(0, top - .055, plank * zSize * .27), [xSize, .11, zSize * .24]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) addFurnitureBox(furniturePalette.metal, instance, at(x * xSize * .39, top * .43, z * zSize * .34), [.075, top * .82, .075]);
    addFurnitureBox(furniturePalette.woodDark, instance, at(0, top * .24, 0), [xSize * .78, .075, .075]);
    return;
  }
  const hasBack = /^panchina/i.test(instance.name);
  const seatY = Math.max(.28, Math.min(.48, instance.height * (hasBack ? .43 : .9)));
  instance.platform = { center: at(0, seatY + .035, 0), size: [xSize, .04, zSize] };
  for (let plank = -1; plank <= 1; plank++) addFurnitureBox(furniturePalette.woodLight, instance, at(0, seatY, plank * zSize * .27), [xSize, .07, zSize * .24]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) addFurnitureBox(furniturePalette.metal, instance, at(x * xSize * .39, seatY * .47, z * zSize * .34), [.07, seatY * .9, .07]);
  if (hasBack) {
    const backZ = -zSize * .36;
    for (const x of [-1, 1]) addFurnitureBox(furniturePalette.woodDark, instance, at(x * xSize * .42, seatY + .31, backZ), [.07, .62, .07]);
    addFurnitureBox(furniturePalette.woodLight, instance, at(0, seatY + .37, backZ), [xSize, .11, .08]);
    addFurnitureBox(furniturePalette.wood, instance, at(0, seatY + .57, backZ), [xSize, .11, .08]);
  }
}
const tables = furnitureInstances.filter((instance) => /^TAVOLO/i.test(instance.name));
let benchesTurnedTowardTables = 0;
for (const bench of furnitureInstances.filter((instance) => /^SEMI PANCHINA/i.test(instance.name))) {
  let nearestTable = null, nearestDistance = 1.6;
  for (const table of tables) {
    const distance = Math.hypot(table.centerX - bench.centerX, table.centerZ - bench.centerZ);
    if (distance < nearestDistance) { nearestDistance = distance; nearestTable = table; }
  }
  if (!nearestTable) continue;
  const yaw = bench.rotation[1] * Math.PI / 180;
  const towardTable = (nearestTable.centerX - bench.centerX) * Math.sin(yaw) + (nearestTable.centerZ - bench.centerZ) * Math.cos(yaw);
  if (towardTable < 0) { bench.rotation[1] += 180; benchesTurnedTowardTables++; }
}
for (const instance of furnitureInstances) {
  makeFurniture(instance);
  addFurniturePlatform(instance);
}
function addTreeCone(group, x, baseY, z, radius, height, sides, phase) {
  const base = [], top = [x, baseY + height, z];
  for (let side = 0; side < sides; side++) {
    const angle = phase + side * Math.PI * 2 / sides;
    base.push([x + Math.cos(angle) * radius, baseY, z + Math.sin(angle) * radius]);
  }
  for (let side = 0; side < sides; side++) addTreeTriangle(group, base[side], base[(side + 1) % sides], top);
}
function findTreeBases(instance) {
  const points = new Map(), lowY = instance.minY + Math.min(.95, Math.max(.6, instance.height * .22));
  for (let i = 0; i < instance.samples.length; i += 5) {
    const x = instance.samples[i], y = instance.samples[i + 1], z = instance.samples[i + 2];
    if (y > lowY) continue;
    const key = `${Math.round(x * 4)},${Math.round(z * 4)}`;
    const item = points.get(key) || { x: 0, z: 0, y: Infinity, count: 0 };
    item.x += x; item.z += z; item.y = Math.min(item.y, y); item.count++;
    points.set(key, item);
  }
  const clusters = [];
  for (const point of points.values()) {
    point.x /= point.count; point.z /= point.count;
    let closest = null, closestDistance = .7;
    for (const cluster of clusters) {
      const distance = Math.hypot(point.x - cluster.x, point.z - cluster.z);
      if (distance < closestDistance) { closest = cluster; closestDistance = distance; }
    }
    if (!closest) clusters.push({ x: point.x, z: point.z, y: point.y, count: point.count });
    else {
      const total = closest.count + point.count;
      closest.x = (closest.x * closest.count + point.x * point.count) / total;
      closest.z = (closest.z * closest.count + point.z * point.count) / total;
      closest.y = Math.min(closest.y, point.y); closest.count = total;
    }
  }
  return clusters.filter((cluster) => cluster.count >= 3);
}
function groundHeightAt(x, z, referenceY) {
  let height = -Infinity;
  for (const tri of groundTriangles) {
    const [a, b, c] = tri;
    if (x < Math.min(a[0], b[0], c[0]) - .001 || x > Math.max(a[0], b[0], c[0]) + .001 || z < Math.min(a[2], b[2], c[2]) - .001 || z > Math.max(a[2], b[2], c[2]) + .001) continue;
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-8) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    const w = 1 - u - v;
    if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
    const y = u * a[1] + v * b[1] + w * c[1];
    if (y <= referenceY + .35 && y > referenceY - 3 && y > height) height = y;
  }
  return Number.isFinite(height) ? height : referenceY;
}
let snappedTreeBases = 0;
const allTreeBases = [];
for (const instance of treeInstances) allTreeBases.push(...findTreeBases(instance).map((base) => {
  const y = groundHeightAt(base.x, base.z, base.y);
  if (Math.abs(y - base.y) > .03) snappedTreeBases++;
  return { ...base, y };
}));
function treeOrder(base) {
  const value = Math.sin((base.x + 137.2) * 127.1 + (base.z - 53.4) * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
allTreeBases.sort((a, b) => treeOrder(a) - treeOrder(b));
const keptTreeBases = [], treeSpacing = 2.2, treeSpacingSquared = treeSpacing * treeSpacing;
let generatedTreeCount = 0;
const maxTreeCount = 392;
for (const base of allTreeBases) {
  if (generatedTreeCount >= maxTreeCount) break;
  if (keptTreeBases.some((other) => (base.x - other.x) ** 2 + (base.z - other.z) ** 2 < treeSpacingSquared)) continue;
  keptTreeBases.push(base);
  {
    const treeIndex = generatedTreeCount++, x = base.x, z = base.z, y = base.y;
    const palette = leafGroups[treeIndex % leafGroups.length];
    const sides = 7, phase = (treeIndex % 5) * .17, trunkHeight = 1.35 + (treeIndex % 3) * .1;
    const trunkBottom = [], trunkTop = [];
    for (let side = 0; side < sides; side++) {
      const angle = phase + side * Math.PI * 2 / sides;
      trunkBottom.push([x + Math.cos(angle) * .2, y, z + Math.sin(angle) * .2]);
      trunkTop.push([x + Math.cos(angle) * .13, y + trunkHeight, z + Math.sin(angle) * .13]);
    }
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides, group = treeGroup(barkGroup);
      addTreeTriangle(group, trunkBottom[side], trunkBottom[next], trunkTop[next]);
      addTreeTriangle(group, trunkBottom[side], trunkTop[next], trunkTop[side]);
    }
    const height = 3.15 + (treeIndex % 4) * .18, crownRadius = .82 + (treeIndex % 5) * .065;
    addTreeCone(treeGroup(palette[0]), x, y + .85, z, crownRadius, height * .63, sides, phase);
    addTreeCone(treeGroup(palette[1]), x, y + 1.42, z, crownRadius * .76, height * .59, sides, phase + .12);
    addTreeCone(treeGroup(palette[2]), x, y + 1.95, z, crownRadius * .53, height * .52, sides, phase + .24);
    colliders.push({ min: [x - .29, y, z - .29], max: [x + .29, y + 1.75, z + .29], kind: 'tree' });
  }
}

const metadata = [], chunks = [];
let byteOffset = 0;
for (const [key, group] of groups) {
  const packed = Buffer.from(Float32Array.from(group.values).buffer);
  metadata.push({ key, offset: byteOffset, bytes: packed.length, vertices: packed.length / 32, texture: group.texture, color: group.color, vehicleId: group.vehicleId || null });
  chunks.push(packed); byteOffset += packed.length;
}
const header = Buffer.from(JSON.stringify({ version: 1, stride: 32, groups: metadata, bounds, colliders, vehicles, crosswalks, groundTriangles, triangles: triangleCount }), 'utf8');
const dataStart = 4 + Math.ceil(header.length / 4) * 4;
const payload = Buffer.allocUnsafe(dataStart + byteOffset);
payload.writeUInt32LE(header.length, 0); header.copy(payload, 4);
let writeAt = dataStart; for (const chunk of chunks) { chunk.copy(payload, writeAt); writeAt += chunk.length; }
const compressed = zlib.gzipSync(payload, { level: 9 });
const output = `/* Offline converted from the supplied FBX. */\nwindow.SPECT_CITY_GZIP='${compressed.toString('base64')}';\n`;
fs.writeFileSync(path.join(dir, 'city-data.js'), output);
console.log(JSON.stringify({ source, trees: generatedTreeCount, furniture: furnitureInstances.length, benchesTurnedTowardTables, treeSpacing, snappedTreeBases, groundTriangles: groundTriangles.length, groups: metadata.length, triangles: triangleCount, colliders: colliders.length, bounds, originalBytes: data.length, packedBytes: payload.length, gzipBytes: compressed.length }, null, 2));
