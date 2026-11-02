(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpectOnlineCombat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var syllables = ['ka','zu','mi','ro','tel','vor','bi','lun','dra','xe','pa','nok','sha','gri','to','mu','fen','ul','qui','ba'];
  var beats = [1, 2, 0, 4, 5, 3]; // Fogo, Planta, Água, Luz, Sombra, Éter.
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function hashString(value) {
    var hash = 1779033703 ^ value.length;
    for (var i = 0; i < value.length; i++) { hash = Math.imul(hash ^ value.charCodeAt(i), 3432918353); hash = (hash << 13) | (hash >>> 19); }
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507); hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^ (hash >>> 16)) >>> 0;
  }
  function random(seed) {
    return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function paeth(a, b, c) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
  function decodePngDataUrl(dataUrl) {
    var match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match || match[1].length > 80000) throw new Error('A imagem de batalha deve ser PNG pequeno.');
    var bytes = Buffer.from(match[1], 'base64');
    if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Imagem PNG inválida.');
    var width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, chunks = [];
    for (var offset = 8; offset + 12 <= bytes.length;) {
      var length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), start = offset + 8;
      if (length > bytes.length || start + length + 4 > bytes.length) throw new Error('PNG truncado.');
      if (type === 'IHDR') { width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4); bitDepth = bytes[start + 8]; colorType = bytes[start + 9]; interlace = bytes[start + 12]; }
      if (type === 'IDAT') chunks.push(bytes.subarray(start, start + length));
      offset = start + length + 4;
      if (type === 'IEND') break;
    }
    var channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
    if (width !== 64 || height !== 64 || bitDepth !== 8 || !channels || interlace !== 0) throw new Error('Use retrato PNG quadrado de 64 x 64.');
    var raw = require('node:zlib').inflateSync(Buffer.concat(chunks)), rowBytes = width * channels, stride = rowBytes + 1;
    if (raw.length !== stride * height) throw new Error('Dados da imagem inválidos.');
    var pixels = Buffer.alloc(rowBytes * height);
    for (var y = 0; y < height; y++) {
      var filter = raw[y * stride], row = y * rowBytes, prev = row - rowBytes;
      for (var x = 0; x < rowBytes; x++) {
        var left = x >= channels ? pixels[row + x - channels] : 0, above = y ? pixels[prev + x] : 0, upperLeft = y && x >= channels ? pixels[prev + x - channels] : 0, predictor = 0;
        if (filter === 1) predictor = left;
        else if (filter === 2) predictor = above;
        else if (filter === 3) predictor = Math.floor((left + above) / 2);
        else if (filter === 4) predictor = paeth(left, above, upperLeft);
        else if (filter !== 0) throw new Error('Filtro PNG inválido.');
        pixels[row + x] = (raw[y * stride + 1 + x] + predictor) & 255;
      }
    }
    var rgba = new Uint8Array(width * height * 4);
    for (var i = 0; i < width * height; i++) {
      var src = i * channels, dst = i * 4;
      if (colorType === 6) { rgba[dst] = pixels[src]; rgba[dst+1] = pixels[src+1]; rgba[dst+2] = pixels[src+2]; rgba[dst+3] = pixels[src+3]; }
      else if (colorType === 2) { rgba[dst] = pixels[src]; rgba[dst+1] = pixels[src+1]; rgba[dst+2] = pixels[src+2]; rgba[dst+3] = 255; }
      else if (colorType === 4) { rgba[dst] = rgba[dst+1] = rgba[dst+2] = pixels[src]; rgba[dst+3] = pixels[src+1]; }
      else { rgba[dst] = rgba[dst+1] = rgba[dst+2] = pixels[src]; rgba[dst+3] = 255; }
    }
    return rgba;
  }
  function analyzeImage(dataUrl) {
    var pixels = decodePngDataUrl(dataUrl), total = 4096, luminance = new Float32Array(total), sumLight = 0, sumSat = 0, dark = 0, vx = 0, vy = 0, weightTotal = 0, warmWeight = 0, buckets = new Uint16Array(64);
    function quantize(value) { return Math.min(3, (value * 4) | 0); }
    for (var i = 0; i < total; i++) {
      var r = pixels[i*4]/255, g = pixels[i*4+1]/255, b = pixels[i*4+2]/255, max = Math.max(r,g,b), min = Math.min(r,g,b), light = (max+min)/2, delta = max-min;
      var sat = delta === 0 ? 0 : delta/(1-Math.abs(2*light-1)+1e-6), hue = 0;
      if (delta > 0) { if (max === r) hue = ((g-b)/delta)%6; else if (max === g) hue = (b-r)/delta+2; else hue = (r-g)/delta+4; hue *= 60; if (hue < 0) hue += 360; }
      luminance[i] = .299*r+.587*g+.114*b; sumLight += luminance[i]; sumSat += sat; if (luminance[i] < .3) dark++;
      var weight = clamp(sat,0,1)*(1-Math.abs(2*light-1)), radians = hue*Math.PI/180; vx += Math.cos(radians)*weight; vy += Math.sin(radians)*weight; weightTotal += weight; if(hue<70||hue>=330)warmWeight += weight;
      buckets[quantize(r)*16+quantize(g)*4+quantize(b)]++;
    }
    var brightness=sumLight/total,variance=0,edges=0,symmetryDifference=0,x,y;
    for(i=0;i<total;i++)variance+=(luminance[i]-brightness)*(luminance[i]-brightness);
    var contrast=clamp(Math.sqrt(variance/total)*3,0,1);
    for(y=0;y<63;y++)for(x=0;x<63;x++){var at=y*64+x;edges+=Math.abs(luminance[at]-luminance[at+1])+Math.abs(luminance[at]-luminance[at+64]);}
    var edge=clamp(edges/(2*total)*9,0,1);
    for(y=0;y<64;y++)for(x=0;x<32;x++)symmetryDifference+=Math.abs(luminance[y*64+x]-luminance[y*64+63-x]);
    var symmetry=1-clamp(symmetryDifference/(total/2)*3,0,1),colors=0;for(i=0;i<64;i++)if(buckets[i]>=total*.012)colors++;
    var saturation=sumSat/total,variety=clamp((colors-2)/18,0,1),warm=weightTotal>0?warmWeight/weightTotal:.5,hueValue=weightTotal>.5?(Math.atan2(vy,vx)*180/Math.PI+360)%360:0,chroma=weightTotal/total,darkness=dark/total;
    var features={bri:brightness,sat:saturation,con:contrast,edge:edge,sym:symmetry,variety:variety,warm:warm,hue:hueValue,chroma:chroma,dark:darkness};
    var key=[features.bri,features.sat,features.con,features.edge,features.sym,features.variety,features.warm,features.hue/360,features.dark].map(function(v){return v.toFixed(3);}).join('|'),seed=hashString(key),rng=random(seed),syllableCount=2+(rng()<.4?1:0),name='';
    for(i=0;i<syllableCount;i++)name+=syllables[(rng()*syllables.length)|0];name=name.charAt(0).toUpperCase()+name.slice(1);
    var stats={hp:Math.round(120+50*darkness+40*symmetry+30*saturation),atq:Math.round(30+30*saturation+25*contrast+10*warm+5*edge),def:Math.round(25+30*symmetry+25*darkness+20*(1-edge)),vel:Math.round(25+35*edge+25*brightness+15*variety),esp:Math.round(20+50*variety+20*contrast+10*saturation)};
    ['atq','def','vel','esp'].forEach(function(k){stats[k]=clamp(stats[k],20,100);});
    var type=chroma<.04?(brightness>.5?3:4):brightness<.26?4:brightness>.7&&saturation<.35?3:hueValue<45||hueValue>=345?0:hueValue<165?1:hueValue<255?2:5;
    return {name:name,stats:stats,type:type};
  }
  function simulateBattle(fighterData, seed) {
    var rng=random(seed>>>0),fighters=fighterData.map(function(f){return {stats:f.stats,hp:f.stats.hp,gauge:0,damage:0,type:f.type};});
    for(var round=0;round<40&&fighters[0].hp>0&&fighters[1].hp>0;round++){
      var speed0=fighters[0].stats.vel*(.8+rng()*.4),speed1=fighters[1].stats.vel*(.8+rng()*.4),order=speed0>=speed1?[0,1]:[1,0];
      for(var step=0;step<2;step++){
        var attacker=fighters[order[step]],defender=fighters[1-order[step]];if(attacker.hp<=0||defender.hp<=0)break;
        attacker.gauge=Math.min(100,attacker.gauge+18+attacker.stats.esp/6);var special=attacker.gauge>=100;if(special)attacker.gauge=0;
        var dodge=clamp(.04+(defender.stats.vel-attacker.stats.vel)/400+defender.stats.vel/600,.03,.3);if(!special&&rng()<dodge)continue;
        var multiplier=beats[attacker.type]===defender.type?1.3:beats[defender.type]===attacker.type?.75:1;
        var damage=attacker.stats.atq*(60/(60+defender.stats.def))*.9*(.85+rng()*.3)*multiplier,critical=rng()<attacker.stats.esp/280;if(special)damage*=1.7;if(critical)damage*=1.5;damage=Math.max(1,Math.round(damage));defender.hp=Math.max(0,defender.hp-damage);attacker.damage+=damage;
      }
    }
    var winner=fighters[0].hp/fighters[0].stats.hp>=fighters[1].hp/fighters[1].stats.hp?0:1;if(fighters[winner].hp<=0)winner=1-winner;
    return {winner:winner,damage:[fighters[0].damage,fighters[1].damage],remaining:[fighters[0].hp,fighters[1].hp]};
  }
  return { analyzeImage: analyzeImage, decodePngDataUrl: decodePngDataUrl, simulateBattle: simulateBattle };
});
