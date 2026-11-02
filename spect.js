
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };


  /* Limpa dados persistentes da versão anterior; as sessões novas começam vazias. */
  try {
    localStorage.removeItem('arenaPixelsRankings');
    localStorage.removeItem('arenaPixelsBattleHistory');
    localStorage.removeItem('arenaPixelsSocialFeed');
  } catch (e) {}

  /* ---------- rankings locais ---------- */
  var rankCategory = 'damage';
  var rankData = {};
  try { rankData = JSON.parse(sessionStorage.getItem('arenaPixelsRankings') || '{}') || {}; } catch (e) { rankData = {}; }
  function fighterRankId(f) { return f.name + '|' + f.type + '|' + f.stats.atq + '|' + f.stats.def + '|' + f.stats.vel + '|' + f.stats.esp; }
  function renderRanking() {
    var list = $('#rank-list');
    var entries = Object.keys(rankData).map(function (key) { return rankData[key]; });
    var field = rankCategory === 'damage' ? 'damage' : rankCategory === 'wins' ? 'wins' : 'fame';
    entries.sort(function (a, b) { return (b[field] || 0) - (a[field] || 0) || a.name.localeCompare(b.name); });
    if (!entries.length) { list.innerHTML = '<div class="rank-empty">As classificações aparecerão depois das primeiras lutas.</div>'; return; }
    list.innerHTML = entries.slice(0, 50).map(function (entry, index) {
      var value = rankCategory === 'damage' ? (entry.damage || 0) + ' dano' : rankCategory === 'wins' ? (entry.wins || 0) + ' vitórias' : (entry.fame || 0) + ' fama';
      var portrait = '';
      if (index < 3) {
        portrait = entry.portrait
          ? '<img class="rank-portrait" src="' + escapeRank(entry.portrait) + '" alt="Imagem de ' + escapeRank(entry.name) + '">'
          : '<span class="rank-portrait placeholder" aria-hidden="true">' + escapeRank(entry.name.charAt(0)) + '</span>';
      }
      return '<div class="rank-entry' + (index < 3 ? ' has-portrait' : '') + '"><div class="rank-pos">#' + (index + 1) + '</div>' + portrait + '<div><div class="rank-name">' + escapeRank(entry.name) + '</div><div class="rank-sub">' + escapeRank(entry.type) + ' · ' + (entry.battles || 0) + ' lutas</div></div><div class="rank-value">' + value + '</div></div>';
    }).join('');
  }
  function escapeRank(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  var battleHistory = [];
  try { battleHistory = JSON.parse(sessionStorage.getItem('arenaPixelsBattleHistory') || '[]') || []; } catch (e) { battleHistory = []; }
  function rarityFor(score) {
    return score >= 340 ? 'Lendário' : score >= 300 ? 'Épico' : score >= 260 ? 'Raro' : score >= 220 ? 'Incomum' : 'Comum';
  }
  function moreCard(label, value, sub) {
    return '<div class="more-stat"><div class="more-stat-label">' + label + '</div><div class="more-stat-value">' + value + '</div>' + (sub ? '<div class="more-stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function renderMorePanels() {
    var historyList = $('#history-list'), statsList = $('#stats-list'), recordsList = $('#records-list'), rarityList = $('#rarity-list');
    if (!historyList) return;
    var totalFights = 0, totalWins = 0, totalDamage = 0, roster = [];
    Object.keys(rankData).forEach(function (key) {
      var entry = rankData[key];
      totalFights += entry.battles || 0;
      totalWins += entry.wins || 0;
      totalDamage += entry.damage || 0;
      if (!entry.rarityScore) { entry.rarityScore = key.split('|').slice(2).reduce(function (sum, value) { return sum + (parseInt(value, 10) || 0); }, 0); }
      roster.push(entry);
    });
    var losses = Math.max(0, totalFights - totalWins);
    var recent = battleHistory.slice().sort(function (a, b) { return b.time - a.time; });
    historyList.innerHTML = recent.length ? recent.slice(0, 50).map(function (match) {
      var when = gameDate(match.time).toLocaleString('pt-BR');
      return '<div class="more-stat"><div class="more-stat-label">' + when + '</div><div class="more-stat-value">' + escapeRank(match.winner) + ' venceu</div><div class="more-stat-sub">' + escapeRank(match.loser) + ' · dano causado: ' + match.winnerDamage + ' x ' + match.loserDamage + '</div></div>';
    }).join('') : '<div class="rank-empty">As lutas concluídas aparecerão aqui.</div>';
    statsList.innerHTML = [
      moreCard('Vit\u00f3rias', totalWins, 'Total de vit\u00f3rias dos lutadores registrados'),
      moreCard('Derrotas', losses, 'Total de derrotas dos lutadores registrados'),
      moreCard('Dano causado', totalDamage, 'Dano acumulado em todas as lutas')
    ].join('');
    var biggestHit = recent.reduce(function (best, match) {
      var candidates = [{name:match.winner, damage:match.winnerDamage}, {name:match.loser, damage:match.loserDamage}];
      candidates.forEach(function (item) { if (!best || item.damage > best.damage) best = item; });
      return best;
    }, null);
    var mostWins = roster.slice().sort(function (a, b) { return (b.wins || 0) - (a.wins || 0); })[0];
    recordsList.innerHTML = totalFights ? [
      moreCard('Lutas disputadas', Math.round(totalFights / 2), 'Contagem acumulada'),
      moreCard('Maior dano em uma luta', biggestHit ? biggestHit.damage : 0, biggestHit ? 'Por ' + escapeRank(biggestHit.name) : ''),
      moreCard('Mais vit\u00f3rias', mostWins ? mostWins.wins : 0, mostWins ? escapeRank(mostWins.name) : '')
    ].join('') : '<div class="rank-empty">Seus recordes aparecerão depois das primeiras lutas.</div>';
    recordsList.innerHTML += [moreCard('Advers\u00e1rios derrotados', survivalRecords.defeated, 'Modo Sobreviv\u00eancia'), moreCard('Arenas conclu\u00eddas', survivalRecords.maxArenas, 'Recorde da jornada'), moreCard('Chef\u00f5es derrotados', survivalRecords.bosses, 'Modo Sobreviv\u00eancia'), moreCard('Mini-chefes derrotados', survivalRecords.mini, 'Modo Sobreviv\u00eancia')].join('');
    var rarityEntries = roster.map(function (entry) {
      var score = entry.rarityScore || 0;
      return {entry:entry, score:score, rarity:rarityFor(score)};
    }).sort(function (a, b) { return b.score - a.score; });
    rarityList.innerHTML = rarityEntries.length ? rarityEntries.map(function (item) {
      return moreCard(item.rarity, escapeRank(item.entry.name), escapeRank(item.entry.type) + ' · poder ' + item.score);
    }).join('') : '<div class="rank-empty">A raridade dos lutadores aparecerá depois das primeiras lutas.</div>';
  }
  function saveTwoByTwoRanking(winnerSide){
    var teams=twoByTwoBattle.teams,now=Date.now();
    var teamDamage=teams.map(function(team){return team.reduce(function(sum,f){return sum+(f.battleDamage||0)},0)});
    var match={time:now,winner:teams[winnerSide].map(function(f){return f.name}).join(' + '),loser:teams[1-winnerSide].map(function(f){return f.name}).join(' + '),winnerDamage:teamDamage[winnerSide],loserDamage:teamDamage[1-winnerSide],mode:'normal-2x2'};
    battleHistory.push(match);battleHistory=battleHistory.slice(-100);
    teams.forEach(function(team,side){team.forEach(function(f){var won=side===winnerSide,id=fighterRankId(f),entry=rankData[id];if(!entry)entry=rankData[id]={name:f.name,type:f.type,damage:0,wins:0,battles:0,fame:0,rarityScore:0};var damage=f.battleDamage||0;entry.damage=(entry.damage||0)+damage;entry.battles=(entry.battles||0)+1;entry.wins=(entry.wins||0)+(won?1:0);entry.fame=(entry.fame||0)+damage+(won?100:0)+10;entry.rarityScore=f.stats.atq+f.stats.def+f.stats.vel+f.stats.esp;entry.portrait=f.portrait||entry.portrait||'';var cr=ensureCareerFighter(f,f.src&&String(f.src).indexOf('data:')===0?f.src:f.portrait||'');cr.battles=(cr.battles||0)+1;if(won){cr.wins=(cr.wins||0)+1;cr.winsReachedAt=now;grantCareerXp(cr,25)}else grantCareerXp(cr,5);sessionFame[cr.id]=(Number(sessionFame[cr.id])||0)+damage+(won?100:0)+10;evaluateHall(cr)})});
    try{sessionStorage.setItem('arenaPixelsRankings',JSON.stringify(rankData));sessionStorage.setItem('arenaPixelsBattleHistory',JSON.stringify(battleHistory));sessionStorage.setItem('spectSessionFame',JSON.stringify(sessionFame))}catch(e){}
    persistCareer();renderRanking();renderMorePanels();renderHall();
  }
  function saveRanking(winnerIndex,resultToken){
    if(resultToken&&careerData.appliedResults[resultToken])return careerData.appliedResults[resultToken];
    if(twoByTwoBattle){saveTwoByTwoRanking(winnerIndex);return null}
    var mode=gameMode,countsFame=mode==='normal'||mode==='tournament';
    var match={time:Date.now(),winner:F[winnerIndex].name,loser:F[1-winnerIndex].name,winnerDamage:F[winnerIndex].battleDamage||0,loserDamage:F[1-winnerIndex].battleDamage||0,mode:mode};
    battleHistory.push(match);battleHistory=battleHistory.slice(-100);
    [0,1].forEach(function(i){
      var f=F[i],id=fighterRankId(f),entry=rankData[id];
      if(!entry)entry=rankData[id]={name:f.name,type:f.type,damage:0,wins:0,battles:0,fame:0,rarityScore:0};
      var damage=f.battleDamage||0;entry.damage=(entry.damage||0)+damage;entry.battles=(entry.battles||0)+1;entry.wins=(entry.wins||0)+(i===winnerIndex?1:0);
      if(countsFame)entry.fame=(entry.fame||0)+damage+(i===winnerIndex?100:0)+10;
      entry.rarityScore=f.stats.atq+f.stats.def+f.stats.vel+f.stats.esp;entry.portrait=f.portrait||entry.portrait||'';
      var cr=ensureCareerFighter(f,f.src&&String(f.src).indexOf('data:')===0?f.src:f.portrait||'');cr.battles=(cr.battles||0)+1;
      if(i===winnerIndex){cr.wins=(cr.wins||0)+1;cr.winsReachedAt=Date.now();grantCareerXp(cr,mode==='tournament'?30:25);if(mode==='tournament')cr.tournamentBattleWins=(cr.tournamentBattleWins||0)+1}
      else grantCareerXp(cr,5);
      if(countsFame){var fameGain=damage+(i===winnerIndex?100:0)+10;sessionFame[cr.id]=(Number(sessionFame[cr.id])||0)+fameGain}
      if(mode!=='tournament')evaluateHall(cr);
    });
    if(resultToken){careerData.appliedResults[resultToken]={winnerId:F[winnerIndex].careerId,loserId:F[1-winnerIndex].careerId,time:Date.now()};}
    try{sessionStorage.setItem('arenaPixelsRankings',JSON.stringify(rankData));sessionStorage.setItem('arenaPixelsBattleHistory',JSON.stringify(battleHistory));sessionStorage.setItem('spectSessionFame',JSON.stringify(sessionFame))}catch(e){}
    persistCareer();renderRanking();renderMorePanels();renderHall();return resultToken?careerData.appliedResults[resultToken]:null;
  }

  /* ---------- aleatório com semente ---------- */
  function hashStr(s) {
    var h = 1779033703 ^ s.length;
    for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- elementos ---------- */
  var TYPES = {
    'Fogo':   { color: '#ff6a3d', beats: 'Planta', move: 'Brasa Pixelada' },
    'Planta': { color: '#6fd26a', beats: 'Água',   move: 'Chicote de Cipó' },
    'Água':   { color: '#4db8ff', beats: 'Fogo',   move: 'Maré de Bits' },
    'Luz':    { color: '#ffd75e', beats: 'Sombra', move: 'Flash Dourado' },
    'Sombra': { color: '#9a9fc4', beats: 'Éter',   move: 'Eclipse Cego' },
    'Éter':   { color: '#b57bff', beats: 'Luz',    move: 'Pulso Etéreo' }
  };
  function typeMult(att, def) {
    if (TYPES[att].beats === def) return 1.3;
    if (TYPES[def].beats === att) return 0.75;
    return 1;
  }
  function pickType(f) {
    if (f.chroma < 0.04) return f.bri > 0.5 ? 'Luz' : 'Sombra';
    if (f.bri < 0.26) return 'Sombra';
    if (f.bri > 0.7 && f.sat < 0.35) return 'Luz';
    var h = f.hue;
    if (h < 45 || h >= 345) return 'Fogo';
    if (h < 165) return 'Planta';
    if (h < 255) return 'Água';
    return 'Éter';
  }

  /* ---------- IA básica: lê a imagem ---------- */
  function analyze(img) {
    var N = 64, c = document.createElement('canvas');
    c.width = c.height = N;
    var g = c.getContext('2d', { willReadFrequently: true });
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.min(iw, ih);
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, N, N);
    var d = g.getImageData(0, 0, N, N).data;
    var n = N * N, L = new Float32Array(n);
    var sumL = 0, sumS = 0, dark = 0, vx = 0, vy = 0, vw = 0, warmW = 0;
    var buckets = new Uint16Array(64);
    var q = function (v) { return Math.min(3, (v * 4) | 0); };
    for (var i = 0; i < n; i++) {
      var r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
      var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, df = mx - mn;
      var sat = df === 0 ? 0 : df / (1 - Math.abs(2 * l - 1) + 1e-6);
      var h = 0;
      if (df > 0) {
        if (mx === r) h = ((gg - b) / df) % 6; else if (mx === gg) h = (b - r) / df + 2; else h = (r - gg) / df + 4;
        h *= 60; if (h < 0) h += 360;
      }
      L[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      sumL += L[i]; sumS += sat; if (L[i] < 0.3) dark++;
      var w = clamp(sat, 0, 1) * (1 - Math.abs(2 * l - 1));
      var rad = h * Math.PI / 180;
      vx += Math.cos(rad) * w; vy += Math.sin(rad) * w; vw += w;
      if (h < 70 || h >= 330) warmW += w;
      buckets[q(r) * 16 + q(gg) * 4 + q(b)]++;
    }
    var bri = sumL / n, varL = 0;
    for (i = 0; i < n; i++) varL += (L[i] - bri) * (L[i] - bri);
    var con = clamp(Math.sqrt(varL / n) * 3, 0, 1);
    var ed = 0, sy = 0, x, y;
    for (y = 0; y < N - 1; y++) for (x = 0; x < N - 1; x++) {
      var k = y * N + x;
      ed += Math.abs(L[k] - L[k + 1]) + Math.abs(L[k] - L[k + N]);
    }
    var edge = clamp(ed / (2 * n) * 9, 0, 1);
    for (y = 0; y < N; y++) for (x = 0; x < N / 2; x++) sy += Math.abs(L[y * N + x] - L[y * N + N - 1 - x]);
    var sym = 1 - clamp(sy / (n / 2) * 3, 0, 1);
    var cnt = 0;
    for (i = 0; i < 64; i++) if (buckets[i] >= n * 0.012) cnt++;
    return {
      bri: bri, sat: sumS / n, con: con, edge: edge, sym: sym,
      variety: clamp((cnt - 2) / 18, 0, 1),
      warm: vw > 0 ? warmW / vw : 0.5,
      hue: vw > 0.5 ? (Math.atan2(vy, vx) * 180 / Math.PI + 360) % 360 : 0,
      dark: dark / n, chroma: vw / n
    };
  }

  var SYL = ['ka', 'zu', 'mi', 'ro', 'tel', 'vor', 'bi', 'lun', 'dra', 'xe', 'pa', 'nok', 'sha', 'gri', 'to', 'mu', 'fen', 'ul', 'qui', 'ba'];
  var TITLES = { atq: 'O Brutamontes', def: 'A Muralha', vel: 'O Relâmpago', esp: 'A Anomalia', hp: 'O Colosso' };

  function buildFighter(f, src, isSample) {
    var key = [f.bri, f.sat, f.con, f.edge, f.sym, f.variety, f.warm, f.hue / 360, f.dark].map(function (v) { return v.toFixed(3); }).join('|');
    var seed = hashStr(key), rng = mulberry(seed);
    var stats = {
      hp: Math.round(120 + 50 * f.dark + 40 * f.sym + 30 * f.sat),
      atq: Math.round(30 + 30 * f.sat + 25 * f.con + 10 * f.warm + 5 * f.edge),
      def: Math.round(25 + 30 * f.sym + 25 * f.dark + 20 * (1 - f.edge)),
      vel: Math.round(25 + 35 * f.edge + 25 * f.bri + 15 * f.variety),
      esp: Math.round(20 + 50 * f.variety + 20 * f.con + 10 * f.sat)
    };
    ['atq', 'def', 'vel', 'esp'].forEach(function (k) { stats[k] = clamp(stats[k], 20, 100); });
    var nsyl = 2 + (rng() < 0.4 ? 1 : 0), nm = '';
    for (var i = 0; i < nsyl; i++) nm += SYL[(rng() * SYL.length) | 0];
    nm = nm.charAt(0).toUpperCase() + nm.slice(1);
    var norm = { hp: (stats.hp - 120) / 120 + 0.35, atq: stats.atq / 100, def: stats.def / 100, vel: stats.vel / 100, esp: stats.esp / 100 };
    var best = 'atq';
    Object.keys(norm).forEach(function (k) { if (norm[k] > norm[best]) best = k; });
    var fighter = {
      src: src, isSample: isSample, feat: f, stats: stats, type: pickType(f), name: nm, title: TITLES[best],
      hp: stats.hp, gauge: 0
    };
    var sp = soundParams(f, rng);
    fighter.soundTraits = sp.traits;
    fighter.sounds = {
      atk: makeSound(sp.atk, seed + 1),
      hurt: makeSound(sp.hurt, seed + 2),
      ko: makeSound(sp.ko, seed + 3)
    };
    return fighter;
  }

  /* ---------- sons personalizados ---------- */
  var SR = 22050, WAVES = ['sine', 'triangle', 'square', 'saw'];
  function soundParams(f, rng) {
    var signed=function(value,variation){return Math.round(clamp((value*2-1)*100+(rng()*2-1)*variation,-100,100))};
    var unit=function(value){return clamp((value+100)/200,0,1)};
    var traits={tone:signed((Math.sin(f.hue*Math.PI/180)+1)/2,8),brightness:signed(f.bri,8),contrast:signed(f.con,8),texture:signed(f.con,8),saturation:signed(f.sat,8),chroma:signed(f.chroma,8),rhythm:signed(f.edge,8),complexity:signed(f.variety,8),symmetry:signed(f.sym,8),warmth:signed(f.warm,8),depth:signed(f.dark,8)};
    var tone=unit(traits.tone),brightness=unit(traits.brightness),contrast=unit(traits.contrast),saturation=unit(traits.saturation),chroma=unit(traits.chroma),rhythm=unit(traits.rhythm),complexity=unit(traits.complexity),symmetry=unit(traits.symmetry),warmth=unit(traits.warmth),depth=unit(traits.depth);
    var wi=Math.min(3,Math.floor((contrast*.30+saturation*.25+chroma*.25+(1-symmetry)*.20)*4)),f0=(100+tone*290)*(.72+brightness*.72);
    function addEnvelope(p){p.peakA=.02+rng()*.2;p.peakB=.24+rng()*.42;p.peakGainA=.25+rng()*.9;p.peakGainB=rng()*.95;p.peakWidth=.035+rng()*.09;p.baseLevel=.12+rng()*.25;p.tailStart=.52+rng()*.2;p.tailPower=2.4+rng()*3.2;p.level=.58+rng()*.34;return p}
    var atk=addEnvelope({wave:WAVES[(wi+Math.floor(rng()*3)+3)%4],f0:f0*(.82+rng()*.38),f1:f0*(1.1+warmth*2.4+contrast*.5)*(.82+rng()*.42),dur:.3,decay:.35+rhythm*.9+rng()*.8,noise:.025+contrast*.20+(1-symmetry)*.18+chroma*.10+rng()*.16,noiseDecay:5+rhythm*16+rng()*14,lp:.16+brightness*.62+contrast*.18,vibR:2+rhythm*22+rng()*18,vibD:.008+complexity*.07+(1-symmetry)*.035+rng()*.04,fmRatio:1+Math.round(complexity*4)+Math.floor(rng()*3),fmIdx:.15+contrast*2.8+chroma*.8+rng()*1.4,crush:Math.round((1-complexity)*4)+Math.floor(rng()*3)});
    var hurt=addEnvelope({wave:WAVES[(wi+1+Math.floor(rng()*4))%4],f0:f0*(.85+depth*.9)*(.8+rng()*.4),f1:f0*(.18+brightness*.62)*(.75+rng()*.5),dur:.3,decay:.35+depth*.8+rng()*.9,noise:.08+saturation*.24+contrast*.18+rng()*.2,noiseDecay:4+rhythm*12+rng()*15,lp:.14+brightness*.5+contrast*.12,vibR:3+complexity*20+rng()*20,vibD:.018+chroma*.075+rng()*.05,fmRatio:1+Math.round(warmth*4)+Math.floor(rng()*3),fmIdx:.3+contrast*2.7+chroma*.6+rng()*1.5,crush:2+Math.floor((1-warmth)*5)+Math.floor(rng()*3)});
    var ko=addEnvelope({wave:WAVES[(wi+Math.floor(rng()*4))%4],f0:hurt.f0*(.55+rng()*.65),f1:hurt.f0*(.08+rng()*.3),dur:.3,decay:.3+depth*.75+rng()*.8,noise:.08+contrast*.28+rng()*.25,noiseDecay:3+rhythm*8+rng()*12,lp:hurt.lp,vibR:2+complexity*12+rng()*14,vibD:.025+depth*.08+rng()*.05,fmRatio:hurt.fmRatio,fmIdx:hurt.fmIdx+rng()*1.5,crush:3+Math.floor((1-brightness)*4)+Math.floor(rng()*3)});
    return {atk:atk,hurt:hurt,ko:ko,traits:traits};
  }
  function osc(type, ph) {
    switch (type) {
      case 'sine': return Math.sin(ph);
      case 'triangle': return (2 / Math.PI) * Math.asin(Math.sin(ph));
      case 'square': return Math.sin(ph) >= 0 ? 0.6 : -0.6;
      default: return ((((ph / 6.2832) % 1) + 1) % 1 * 2 - 1) * 0.6;
    }
  }
  function synth(p, seed) {
    var n = Math.floor(p.dur * SR), out = new Float32Array(n), rnd = mulberry(seed);
    var ph = 0, y = 0, peak = 0.0001, i;
    for (i = 0; i < n; i++) {
      var t = i / SR, k = t / p.dur;
      var fr = p.f0 * Math.pow(p.f1 / p.f0, k) * (1 + p.vibD * Math.sin(6.2832 * p.vibR * t));
      ph += 6.2832 * fr / SR;
      var m = p.fmIdx * Math.sin(ph * p.fmRatio) * Math.exp(-t * 4);
      var x = osc(p.wave, ph + m);
      var nz = (rnd() * 2 - 1) * p.noise * Math.exp(-t * p.noiseDecay) * 2;
      var s = x * (1 - p.noise * 0.4) + nz;
      var bumpA=p.peakGainA*Math.exp(-Math.pow((k-p.peakA)/p.peakWidth,2)*2),bumpB=p.peakGainB*Math.exp(-Math.pow((k-p.peakB)/p.peakWidth,2)*2);
      var tail=k>p.tailStart?Math.pow(clamp((1-k)/(1-p.tailStart),0,1),p.tailPower):1;
      var envelope=(p.baseLevel+bumpA+bumpB)*Math.exp(-t*p.decay)*tail;
      s *= Math.min(1, t / 0.004) * Math.max(.3,envelope);
      y += p.lp * (s - y);
      var o = y;
      if (p.crush) { var lv = Math.pow(2, p.crush); o = Math.round(o * lv) / lv; }
      if(o===0&&i<n-1)o=(rnd()<.5?-1:1)*.00001;
      out[i] = o;
      var a = Math.abs(o); if (a > peak) peak = a;
    }
    var gain = (p.level||.75) / peak;
    for (i = 0; i < n; i++) out[i] *= gain;
    if (n) out[n - 1] = 0;
    return out;
  }
  function makeSound(p, seed) {
    var audible = Object.assign({}, p, { dur: Math.max(0.3, Number(p.dur) || 0), decay: Math.min(Number(p.decay) || 1.6, 1.6) });
    var data = synth(audible, seed), bins = 48, peaks = new Array(bins), size = Math.floor(data.length / bins);
    for (var b = 0; b < bins; b++) {
      var m = 0;
      for (var j = b * size; j < (b + 1) * size && j < data.length; j++) { var a = Math.abs(data[j]); if (a > m) m = a; }
      peaks[b] = m;
    }
    return { data: data, peaks: peaks, dur: audible.dur, abuf: null };
  }

  function makeSpeechSamples(traits, seed, seconds) {
    var rnd=mulberry(seed>>>0),duration=Math.max(.5,Math.min(1,Number(seconds)||1)),length=Math.floor(SR*duration),out=new Float32Array(length),imageTone=traits?clamp((traits.tone+100)/200,0,1):.5,imageBrightness=traits?clamp((traits.brightness+100)/200,0,1):.5,imageWarmth=traits?clamp((traits.warmth+100)/200,0,1):.5;
    // Each utterance gets a distinct voice identity; image traits nudge the result without flattening its range.
    var pitch=rnd(),formantScale=.68+rnd()*.76,brightness=clamp(imageBrightness*.35+.15+rnd()*.5,0,1),warmth=clamp(imageWarmth*.3+.15+rnd()*.55,0,1),pace=.075+rnd()*.075,base=54+pitch*176+(imageTone-.5)*36,formants=[[520,1180,2440],[410,870,2180],[680,1460,2760],[360,1880,2520],[590,980,1980]],phase=0,peak=.0001,vowelShift=.78+rnd()*.5,vibrato=.008+rnd()*.065;
    for(var i=0;i<length;i++){var t=i/SR,slot=Math.floor(t/pace),local=(t/pace)-slot,v=formants[slot%formants.length],shift=formantScale*(.9+.1*Math.sin(slot*2.3)*vowelShift),onset=Math.min(1,local*16),release=Math.min(1,(1-local)*10),pulse=Math.max(0,Math.sin(Math.PI*local)),syllable=(.25+.75*pulse)*onset*release,voiced=local>.09,frequency=base*(1+vibrato*Math.sin(6.2832*(2+slot%7)*t));phase+=6.2832*frequency/SR;var sample=0;if(voiced){for(var h=1;h<=16;h++){var hz=frequency*h,weight=.7*Math.exp(-Math.pow((hz-v[0]*shift)/(150+brightness*210),2))+Math.exp(-Math.pow((hz-v[1]*shift)/(210+brightness*260),2))*.72+Math.exp(-Math.pow((hz-v[2]*shift)/(280+brightness*320),2))*.42;sample+=Math.sin(phase*h)*weight/(1+h*.16)}}else sample=(rnd()*2-1)*(.08+brightness*.2);var consonant=local<.09?Math.exp(-local*14)*(.08+brightness*.16)*(rnd()*2-1):0;sample=(sample+consonant)*syllable*(.35+warmth*.55);if(t>duration-.08)sample*=Math.max(0,(duration-t)/.08);out[i]=sample;peak=Math.max(peak,Math.abs(sample))}
    var gain=.28/peak;for(i=0;i<length;i++)out[i]*=gain;out[length-1]=0;return out;
  }
  window.SPECT_CREATE_SPEECH=function(seed,seconds){var value=Number(seed)||Math.floor(Math.random()*0x7fffffff);return {samples:makeSpeechSamples(null,value,seconds||1),sampleRate:SR}};
  window.SPECT_CREATE_IMAGE_SPEECH=function(file,seconds,variationSeed){return new Promise(function(resolve,reject){if(!file){reject(new Error('Imagem do personagem não selecionada'));return}var url=URL.createObjectURL(file),img=new Image();img.onload=function(){try{var features=analyze(img),key=[features.bri,features.sat,features.con,features.edge,features.sym,features.variety,features.warm,features.hue/360,features.dark].map(function(v){return v.toFixed(3)}).join('|'),seed=hashStr(key),rng=mulberry(seed),profile=soundParams(features,rng),variation=Number(variationSeed)||Math.floor(Math.random()*0x7fffffff);URL.revokeObjectURL(url);resolve({samples:makeSpeechSamples(profile.traits,(seed^variation^Math.floor(Math.random()*0x7fffffff))>>>0,seconds||1),sampleRate:SR})}catch(error){URL.revokeObjectURL(url);reject(error)}};img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('Não foi possível analisar a imagem do personagem'))};img.src=url})};

  var ctx = null, master = null, muted = false, musicMuted = false, backgroundMusic = document.getElementById('background-music'), battleMusic = document.getElementById('battle-music');window.SPECT_MUSIC_MUTED=musicMuted;
  if(backgroundMusic){backgroundMusic.volume=0.5;backgroundMusic.muted=musicMuted}
  if(battleMusic){battleMusic.volume=0.5;battleMusic.muted=musicMuted}
  function startBackgroundMusic(){if(!backgroundMusic||musicMuted||tournamentAutoBatch||document.body.classList.contains('battle-mode')||document.body.classList.contains('world-open')||document.querySelector('.world-screen.exploring'))return;var promise=backgroundMusic.play();if(promise&&promise.catch)promise.catch(function(){})}
  function stopBackgroundMusic(){if(backgroundMusic)backgroundMusic.pause()}
  function startBattleMusic(){if(!battleMusic||musicMuted)return;stopBackgroundMusic();var promise=battleMusic.play();if(promise&&promise.catch)promise.catch(function(){})}
  function stopBattleMusic(){if(battleMusic)battleMusic.pause()}
  if(backgroundMusic){document.addEventListener('pointerdown',startBackgroundMusic,{once:true});document.addEventListener('keydown',startBackgroundMusic,{once:true});startBackgroundMusic()}

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function play(snd, opt) {
    if (muted || tournamentAutoRunning) return;
    var c = audio(); if (!c) return;
    opt = opt || {};
    if (!snd.abuf) { snd.abuf = c.createBuffer(1, snd.data.length, SR); snd.abuf.copyToChannel(snd.data, 0); }
    var src = c.createBufferSource(), gn = c.createGain();
    src.buffer = snd.abuf; src.playbackRate.value = opt.rate || 1; gn.gain.value = opt.gain == null ? 0.8 : opt.gain;
    src.connect(gn); gn.connect(master); src.start();
  }

  function playUiClick(){if(muted||tournamentAutoRunning||tournamentAutoBatch||document.body.classList.contains('battle-mode'))return;var c=audio();if(!c||!master)return;var now=c.currentTime,oscillator=c.createOscillator(),gain=c.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(720,now);oscillator.frequency.exponentialRampToValueAtTime(510,now+0.045);gain.gain.setValueAtTime(0.0001,now);gain.gain.exponentialRampToValueAtTime(0.035,now+0.004);gain.gain.exponentialRampToValueAtTime(0.0001,now+0.055);oscillator.connect(gain);gain.connect(master);oscillator.start(now);oscillator.stop(now+0.06)}
  document.addEventListener('pointerdown',function(event){if(event.button!==undefined&&event.button!==0)return;var target=event.target;if(!target||!target.closest)return;var control=target.closest('button,a,input,select,textarea,summary,label,[role="tab"],[role="button"],[data-like],.mode-choice');if(!control||control.disabled||control.closest('.snd,#fightBtn,#speedBtn,#muteBtn,#battle-screen'))return;playUiClick()},true);

  /* ---------- fichas ---------- */
  var F = [null, null, null, null], urls = [null, null, null, null], busy = false, speed = 1, runId = 0, survivalImageLocked = false, botPreparing = false, gameMode = 'normal', onlineBattleRng = null, activeOnlineDuel = null;
  function battleRandom(){return onlineBattleRng?onlineBattleRng():Math.random()}
  var twoByTwoEnabled=false,twoByTwoBattle=null;
  var evolution = { imageKey: '', points: 0, levels: { atq: 0, def: 0, vel: 0, esp: 0, hp: 0 } }, evolutionApplied = false;
  var survival = { active:false, imageKey:'', defeated:0, arenas:0, mini:0, bosses:0, streak:0, level:1, xp:0, damage:0, enemyClass:'normal', arena:1, encounter:1, awaitingArena:false, ended:false, bossStartHp:0 };
  var survivalRecords = { defeated:0, maxArenas:0, mini:0, bosses:0 };
  try { survivalRecords = Object.assign(survivalRecords, JSON.parse(sessionStorage.getItem('arenaPixelsSurvivalRecords') || '{}')); } catch (e) {}
  var careerData={version:1,fighters:{},tournaments:[],hall:{},appliedResults:{}};
  try{careerData=Object.assign(careerData,JSON.parse(localStorage.getItem('spectOfficialCareerV1')||'{}'));careerData.fighters=careerData.fighters||{};careerData.tournaments=careerData.tournaments||[];careerData.hall=careerData.hall||{};careerData.appliedResults=careerData.appliedResults||{}}catch(e){}
  function cleanArenaFighterName(name){return String(name||'').replace(/^arena\s+\d+\s+\S+\s*/i,'').replace(/\barena\b/gi,'').replace(/\s+/g,' ').trim()}
  var renamedArenaFighters=false;Object.keys(careerData.fighters).forEach(function(id){var fighter=careerData.fighters[id];if(fighter&&fighter.name){var cleanName=cleanArenaFighterName(fighter.name);if(cleanName!==fighter.name){fighter.name=cleanName;renamedArenaFighters=true}}});if(renamedArenaFighters)persistCareer();
  var GAME_TIME_MULTIPLIER=60,GAME_CLOCK_KEY='spectGameClockV1',gameClockAnchor;try{gameClockAnchor=JSON.parse(localStorage.getItem(GAME_CLOCK_KEY)||'null')}catch(e){}if(!gameClockAnchor||!Number.isFinite(gameClockAnchor.real)||!Number.isFinite(gameClockAnchor.game)){gameClockAnchor={real:Date.now(),game:new Date(2025,0,1,8,0,0,0).getTime()};try{localStorage.setItem(GAME_CLOCK_KEY,JSON.stringify(gameClockAnchor))}catch(e){}}
  function gameTimestamp(realTime){return gameClockAnchor.game+((Number(realTime)||Date.now())-gameClockAnchor.real)*GAME_TIME_MULTIPLIER}
  function gameDate(realTime){return new Date(gameTimestamp(realTime))}
  function renderGameClock(){var el=$('#game-clock');if(el)el.textContent=gameDate().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}
  renderGameClock();setInterval(renderGameClock,1000);
  var sessionFame={};try{sessionFame=JSON.parse(sessionStorage.getItem('spectSessionFame')||'{}')||{}}catch(e){}
  var tournament=careerData.activeTournament||null, tournamentAutoBatch=false, tournamentAutoRunning=false, tournamentAutoProgress={done:0,total:0};
  var tournamentSpeed=1;
  function persistCareer(){try{localStorage.setItem('spectOfficialCareerV1',JSON.stringify(careerData))}catch(e){console.warn('N\u00e3o foi poss\u00edvel salvar os dados oficiais localmente.',e)}}
  function careerIdFor(f){var x=f.feat||{};return 'fighter-'+hashStr([f.name,f.type,x.bri,x.sat,x.con,x.edge,x.sym,x.variety,x.hue].join('|')).toString(36)}
  function ensureCareerFighter(f,src){var id=f.careerId||careerIdFor(f),r=careerData.fighters[id];if(!r)r=careerData.fighters[id]={id:id,name:f.name,type:f.type,src:src||f.portrait||f.src||'',portrait:f.portrait||src||f.src||'',stats:Object.assign({},f.stats),wins:0,battles:0,tournamentBattleWins:0,tournamentTitles:0,level:1,xp:0,levelXp:0,winsReachedAt:0,hallReason:'',hallEnteredAt:0};r.name=f.name||r.name;r.type=f.type||r.type;if(src)r.src=src;if(f.portrait)r.portrait=f.portrait;if(f.stats)r.stats=Object.assign({},f.survivalBaseStats||f.stats);if(!r.src)r.src=r.portrait||f.src||'';f.careerId=id;return r}
  function imageForCollection(img){try{var c=document.createElement('canvas');c.width=c.height=256;var g=c.getContext('2d'),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,side=Math.min(w,h);g.drawImage(img,(w-side)/2,(h-side)/2,side,side,0,0,256,256);return c.toDataURL('image/jpeg',.78)}catch(e){return ''}}
  function hallInsert(r,reason){if(!r)return;r.hallReason=reason||r.hallReason||''}
  function evaluateHall(r){if(!r||r.tournamentTitles>0)return;if(r.wins>=10)hallInsert(r,'10 vit\u00f3rias');else if((Number(sessionFame[r.id])||0)>=3000)hallInsert(r,'3000 fama na sess\u00e3o')}
  function grantCareerXp(r,amount){r.xp=(r.xp||0)+amount;while((r.level||1)<30&&r.xp>=(100+((r.level||1)-1)*45)){r.xp-=100+((r.level||1)-1)*45;r.level=(r.level||1)+1}}
  function syncRankCollection(){Object.keys(rankData).forEach(function(k){var e=rankData[k],already=Object.values(careerData.fighters).some(function(r){return r.name===e.name&&r.type===e.type&&r.stats&&r.stats.atq===Number(k.split('|')[2])&&r.stats.def===Number(k.split('|')[3])});var id='rank-'+hashStr(k).toString(36);if(!already&&!careerData.fighters[id])careerData.fighters[id]={id:id,name:e.name,type:e.type,src:e.portrait||'',portrait:e.portrait||'',stats:{hp:150,atq:Number(k.split('|')[2])||50,def:Number(k.split('|')[3])||50,vel:Number(k.split('|')[4])||50,esp:Number(k.split('|')[5])||50},wins:e.wins||0,battles:e.battles||0,tournamentBattleWins:0,tournamentTitles:0,level:Math.max(1,1+Math.floor((e.wins||0)/5)),xp:0,levelXp:0,winsReachedAt:Date.now(),hallReason:'',hallEnteredAt:0};var rec=careerData.fighters[already?Object.keys(careerData.fighters).find(function(key){var r=careerData.fighters[key];return r.name===e.name&&r.type===e.type&&r.stats&&r.stats.atq===Number(k.split('|')[2])&&r.stats.def===Number(k.split('|')[3])}):id];if(rec)evaluateHall(rec)});persistCareer()}
  function publicTournamentParticipant(id){var r=careerData.fighters[id];return r?{id:id,name:r.name,type:r.type,src:r.src||r.portrait,portrait:r.portrait||r.src,stats:Object.assign({},r.stats),level:r.level||1,wins:r.wins||0,tournamentTitles:r.tournamentTitles||0}:null}

  var EVO_STATS = { atq: ['ATQ', 4], def: ['DEF', 4], vel: ['VEL', 3], esp: ['ESP', 4], hp: ['HP', 12] };
  var STAT_ROWS = [['ATQ', 'atq'], ['DEF', 'def'], ['VEL', 'vel'], ['ESP', 'esp']];

  function cardHTML(i) {
    return '' +
      '<div class="card-top"><span class="slot">'+(i===0?'Equipe azul · Lutador 1':i===1?'Equipe vermelha · Lutador 1':i===2?'Equipe azul · Lutador 2':'Equipe vermelha · Lutador 2')+'</span><span class="chip" data-f="type">...</span></div>' +
      '<label class="frame" data-f="frame">' +
        '<img data-f="img" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">' +
        '<span class="scan"></span><span class="hint">Trocar imagem</span>' +
        '<input type="file" accept="image/*" data-f="file" aria-label="Enviar imagem do lutador ' + (i + 1) + '">' +
      '</label>' +
      '<div class="ident"><h2 class="name" data-f="name">Lendo...</h2><p class="title" data-f="title">&nbsp;</p><div><span class="tag" data-f="sample" hidden>exemplo</span></div></div>' +
      '<div><div class="row"><span>HP</span><b data-f="hpnum">0</b></div><div class="bar" data-f="hpbar"><i></i></div></div>' +
      '<div><div class="row"><span>Especial</span></div><div class="bar thin gauge" data-f="gauge"><i></i></div></div>' +
      '<div class="stats" data-f="stats"></div>' +
      '<div class="snds">' +
        '<button type="button" class="snd" data-f="sndAtk"><span>Som de golpe</span><canvas width="160" height="28"></canvas></button>' +
        '<button type="button" class="snd" data-f="sndHurt"><span>Som de dano</span><canvas width="160" height="28"></canvas></button>' +
      '</div>' +
      '<details><summary>Leitura da IA</summary><dl data-f="read"></dl>' +
      '<p class="note">ATQ vem da saturação e do contraste. DEF, da simetria e das áreas escuras. VEL, dos detalhes e do brilho. ESP, da variedade de cores. A cor dominante define o elemento e o perfil dos sons, com valores de -100 a +100.</p></details>';
  }
  var cardEl = function (i) { return $('#card' + i); };
  var q = function (el, k) { return el.querySelector('[data-f="' + k + '"]'); };

  function drawWave(canvas, peaks, color) {
    var g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, bw = w / peaks.length;
    g.clearRect(0, 0, w, h);
    g.fillStyle = color;
    for (var i = 0; i < peaks.length; i++) {
      var bh = Math.max(2, peaks[i] * (h - 2));
      g.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh);
    }
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function paint(i) {
    var f = F[i], el = cardEl(i), col = TYPES[f.type].color;
    el.style.setProperty('--c', col);
    var img = q(el, 'img'); img.src = f.src; img.alt = 'Imagem de ' + f.name;
    q(el, 'type').textContent = f.type;
    q(el, 'name').textContent = f.name;
    q(el, 'title').textContent = f.title + ' · elemento ' + f.type.toLowerCase();
    q(el, 'sample').hidden = !f.isSample;
    q(el, 'stats').innerHTML = STAT_ROWS.map(function (r) {
      return '<div class="st"><span class="k">' + r[0] + '</span><div class="bar thin"><i style="width:' + Math.min(100, f.stats[r[1]]) + '%"></i></div><span class="v">' + f.stats[r[1]] + '</span></div>';
    }).join('');
    var ft = f.feat;
    q(el, 'read').innerHTML = [
      ['Brilho', pct(ft.bri)], ['Saturação', pct(ft.sat)], ['Contraste', pct(ft.con)], ['Detalhes', pct(ft.edge)],
      ['Simetria', pct(ft.sym)], ['Variedade de cores', pct(ft.variety)], ['Áreas escuras', pct(ft.dark)], ['Matiz dominante', Math.round(ft.hue) + '°'],
      ['Som - tom', f.soundTraits.tone], ['Som - brilho', f.soundTraits.brightness], ['Som - contraste', f.soundTraits.contrast],
      ['Som - satura\u00e7\u00e3o', f.soundTraits.saturation], ['Som - cromin\u00e2ncia', f.soundTraits.chroma], ['Som - ritmo', f.soundTraits.rhythm],
      ['Som - simetria', f.soundTraits.symmetry], ['Som - variedade', f.soundTraits.complexity], ['Som - calor', f.soundTraits.warmth], ['Som - profundidade', f.soundTraits.depth]
    ].map(function (r) {
      var isSound = r[0].indexOf('Som ·') === 0;
      return '<dt>' + r[0] + '</dt><dd>' + (isSound ? (r[1] > 0 ? '+' : '') + r[1] + ' / 100' : r[1]) + '</dd>';
    }).join('');
    drawWave(q(el, 'sndAtk').querySelector('canvas'), f.sounds.atk.peaks, col);
    drawWave(q(el, 'sndHurt').querySelector('canvas'), f.sounds.hurt.peaks, col);
    paintHp(i); paintGauge(i);
  }
  function paintHp(i) {
    var f = F[i], el = cardEl(i), bar = q(el, 'hpbar'), p = clamp(f.hp / f.stats.hp, 0, 1);
    bar.firstElementChild.style.width = (p * 100) + '%';
    bar.classList.toggle('low', p < 0.3);
    q(el, 'hpnum').textContent = f.hp + ' / ' + f.stats.hp;
  }
  function paintGauge(i) {
    q(cardEl(i), 'gauge').firstElementChild.style.width = clamp(F[i].gauge, 0, 100) + '%';
  }

  /* ---------- registro de combate removido: a área foi substituída pelo feed social ---------- */
  function log() {}

  /* ---------- carregar imagem ---------- */
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('falha')); };
      im.src = src;
    });
  }
  function setLocked(v) {
    $('#arena').classList.toggle('locked', v);
    var frozen = gameMode === 'tournament' || gameMode === 'survival' && (!survival.active || survival.awaitingArena || survival.ended);
    $('#sampleBtn').disabled = v || botPreparing || frozen;
    $('#fightBtn').disabled = v || botPreparing || !F[0] || !F[1] || gameMode==='normal'&&twoByTwoEnabled&&(!F[2]||!F[3]) || frozen;
    $('#bot-image-upload').disabled = botPreparing || survivalImageLocked;
    [0, 1, 2, 3].forEach(function (i) { q(cardEl(i), 'file').disabled = v || botPreparing || gameMode === 'tournament' || gameMode === 'survival' && survival.active; });
  }
  function saveSurvival() { try { sessionStorage.setItem('arenaPixelsSurvivalProgress', JSON.stringify(survival)); sessionStorage.setItem('arenaPixelsSurvivalRecords', JSON.stringify(survivalRecords)); } catch (e) {} }
  function evolutionKey(src) { return hashStr(src) + ':' + src.length; }
  function saveEvolution() { try { sessionStorage.setItem('arenaPixelsSurvivalEvolution', JSON.stringify(evolution)); } catch (e) {} }
  function applyEvolution(f) { if (!f || evolutionApplied) return; Object.keys(EVO_STATS).forEach(function (key) { f.stats[key] += evolution.levels[key] * EVO_STATS[key][1]; }); f.hp=f.stats.hp; evolutionApplied=true; }
  function addSurvivalXp(amount) {
    survival.xp += amount;
    while (survival.level < 30 && survival.xp >= 100 + (survival.level - 1) * 45) {
      survival.xp -= 100 + (survival.level - 1) * 45; survival.level++;
      if(F[0]) { F[0].stats.atq=Math.min(180,F[0].stats.atq+2); F[0].stats.def=Math.min(180,F[0].stats.def+2); F[0].stats.vel=Math.min(180,F[0].stats.vel+1); F[0].stats.esp=Math.min(180,F[0].stats.esp+2); F[0].stats.hp=Math.min(260,F[0].stats.hp+8); F[0].hp=Math.min(F[0].stats.hp,F[0].hp+8); paint(0); }
      survivalToast('N\u00edvel '+survival.level+' alcan\u00e7ado! Atributos aprimorados.');
    }
  }
  var achievementNames={firstMini:'Primeiro mini chefe',firstBoss:'Primeiro chef\u00e3o',firstArena:'Primeira arena conclu\u00edda',arenas3:'3 arenas conclu\u00eddas',arenas5:'5 arenas conclu\u00eddas',arenas10:'10 arenas conclu\u00eddas',streak10:'10 advers\u00e1rios seguidos',bossPerfect:'Chef\u00e3o derrotado sem sofrer dano'};
  function unlockAchievement(id) { var list=[];try{list=JSON.parse(sessionStorage.getItem('arenaPixelsSurvivalAchievements')||'[]')}catch(e){} if(list.indexOf(id)>=0)return;list.push(id);try{sessionStorage.setItem('arenaPixelsSurvivalAchievements',JSON.stringify(list))}catch(e){} survivalToast('CONQUISTA \u00b7 '+achievementNames[id]); }
  var toastTimer,toastQueue=[],toastShowing=false; function showSurvivalToast(){if(!toastQueue.length){toastShowing=false;return}toastShowing=true;var el=$('#achievement-toast');el.textContent=toastQueue.shift();el.hidden=false;toastTimer=setTimeout(function(){el.hidden=true;showSurvivalToast()},3800)} function survivalToast(text){toastQueue.push(text);if(!toastShowing)showSurvivalToast()}
  function renderEvolution(){var p=$('#survival-progress');p.hidden=gameMode!=='survival'||!survival.active||!F[0];if(p.hidden)return;var arena=Math.floor(survival.defeated/10)+1,enc=survival.defeated%10+1;$('#survival-progress-text').textContent='Arena '+arena+' \u00b7 confronto '+enc+'/10 \u00b7 '+survival.defeated+' vit\u00f3rias \u00b7 sequ\u00eancia '+survival.streak;var need=100+(survival.level-1)*45;$('#survival-xp').textContent='N\u00edvel '+survival.level+' \u00b7 XP '+survival.xp+'/'+need+' \u00b7 derrotados '+survivalRecords.defeated;$('#survival-evolution').innerHTML=['atq','def','vel','esp','hp'].map(function(k){return '<span>'+k.toUpperCase()+' '+F[0].stats[k]+'</span>'}).join(' \u00b7 ')}
  function renderSurvivalMessage(){var p=$('#survival-message'),show=gameMode==='survival'&&(survival.awaitingArena||survival.ended);p.hidden=!show;if(!show)return;$('#survival-message-title').textContent=survival.awaitingArena?'ARENA '+survival.arenas+' CONCLU\u00cdDA':'FIM DA JORNADA';$('#survival-message-text').textContent='Derrotados: '+survival.defeated+' \u00b7 Mini-chefes: '+survival.mini+' \u00b7 Chef\u00f5es: '+survival.bosses+' \u00b7 N\u00edvel '+survival.level+' \u00b7 Dano causado: '+Math.round(survival.damage)+' \u00b7 XP recebido: '+(survival.lastReward||0)+'.';$('#survival-continue').hidden=!survival.awaitingArena;$('#survival-end').textContent=survival.awaitingArena?'Encerrar partida':'Escolher outro lutador'}
  function recordSurvivalFight(winnerIndex){
    if(gameMode!=='survival'||!survival.active)return;
    var type=survival.enemyClass;
    if(winnerIndex!==0){survival.streak=0;survival.ended=true;F[0].hp=F[0].stats.hp;paintHp(0);survival.lastHpRatio=1;saveSurvival();renderSurvivalMessage();return}
    survival.defeated++;survival.streak++;survival.damage+=F[0].battleDamage||0;survivalRecords.defeated++;
    var xp=type==='boss'?240:type==='mini'?95:28;
    if(type==='mini'){survival.mini++;survivalRecords.mini++;if(survival.mini===1)unlockAchievement('firstMini')}
    if(type==='boss'){
      survival.bosses++;survivalRecords.bosses++;if(survival.bosses===1)unlockAchievement('firstBoss');
      if(F[0].hp>=survival.bossStartHp)unlockAchievement('bossPerfect');
      survival.arenas++;survivalRecords.maxArenas=Math.max(survivalRecords.maxArenas,survival.arenas);
      if(survival.arenas===1)unlockAchievement('firstArena');if(survival.arenas===3)unlockAchievement('arenas3');if(survival.arenas===5)unlockAchievement('arenas5');if(survival.arenas===10)unlockAchievement('arenas10');survival.awaitingArena=true;
    }
    if(survival.streak>=10)unlockAchievement('streak10');
    var reward=Math.round((xp+(type==='boss'?150:0))*1.5);
    addSurvivalXp(reward);survival.lastReward=reward;
    F[0].hp=F[0].stats.hp;paintHp(0);survival.lastHpRatio=1;
    survivalToast((type==='boss'?'Arena conclu\u00edda! ':'Vit\u00f3ria! ')+'+'+reward+' XP \u00b7 Vida restaurada');
    saveSurvival();renderEvolution();renderSurvivalMessage();renderMorePanels();
  }

  function resetBattleView(keepPlayerHp) {
    runId++; busy = false;
    // O banner pertence ao antigo painel de feedback, removido na versão social.
    // Verifica se ele existe para não interromper a leitura e a exibição das imagens.
    var banner = $('#banner');
    if (banner) banner.hidden = true;
    [0, 1, 2, 3].forEach(function (i) {
      if (F[i]) { if (!(keepPlayerHp && i === 0)) F[i].hp = F[i].stats.hp; F[i].gauge = 0; paintHp(i); paintGauge(i); }
      if(cardEl(i))cardEl(i).classList.remove('win', 'ko', 'act', 'hurt');
    });
    $('#fightBtn').textContent = 'Lutar';
  }
  function makePortrait(img) {
    try {
      var canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
      var ctx = canvas.getContext('2d'), iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      var side = Math.min(iw, ih);
      ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, 80, 80);
      return canvas.toDataURL('image/jpeg', 0.68);
    } catch (e) { return ''; }
  }
  function compressBotImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader(); reader.onerror = reject;
      reader.onload = function () {
        var img = new Image(); img.onerror = reject;
        img.onload = function () {
          var scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  var STYLES=['spiky','rings','blob','crystal','orbital','flower','pixel','mask','nebula','mecha','comet','gear','jelly','vortex','crown','mushroom','skull','tentacle','shield'];
  var sampleRoster=[];
  function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,Math.max(0,ms))})}
  function rememberSample(style,seed){if(!sampleRoster.some(function(x){return x.style===style&&x.seed===seed}))sampleRoster.push({style:style,seed:seed});sampleRoster=sampleRoster.slice(-24)}
  function makeSample(style,seed){
    var c=document.createElement('canvas');c.width=c.height=256;var g=c.getContext('2d'),r=mulberry(seed||1);
    var palette={spiky:['#ff8a3d','#5a0f1f','#ffd166'],rings:['#0b2a4a','#37c8d8','#e6fbff'],blob:['#0f3b24','#6fd26a','#e7ff9a'],crystal:['#1a0f3a','#b57bff','#ffd0ff'],orbital:['#071b3b','#1b4f91','#69e2ff'],flower:['#40143f','#e759a6','#ffe18c'],pixel:['#14213d','#3a86ff','#ffbe0b'],mask:['#32120e','#c43c2b','#ffd166'],nebula:['#180c3b','#5b3db5','#ff68c5'],mecha:['#172c34','#3f8790','#c3f5e8'],comet:['#102b4c','#55c9ff','#fff0a8'],gear:['#29213d','#dda83e','#fff0bb'],jelly:['#142e48','#66cde0','#e6fbff'],vortex:['#241242','#ab5cff','#ffe0ff'],crown:['#401829','#e8b744','#fff2a6'],mushroom:['#27331d','#d96652','#fff0cf'],skull:['#1c2234','#b9c4d8','#ff647c'],tentacle:['#102c3b','#26a99b','#c2fff0'],shield:['#301a13','#e37a32','#ffe17b']}[style]||['#202840','#6daac8','#fff'];
    var bg=g.createRadialGradient(128,100,8,128,128,190);bg.addColorStop(0,palette[1]);bg.addColorStop(1,palette[0]);g.fillStyle=bg;g.fillRect(0,0,256,256);
    for(var i=0;i<18;i++){g.globalAlpha=.12+r()*.28;g.fillStyle=palette[2];g.beginPath();g.arc(r()*256,r()*256,3+r()*15,0,Math.PI*2);g.fill()}g.globalAlpha=1;
    g.save();g.translate(128,128);g.rotate((r()-.5)*.24);var bodyScale=.88+r()*.24;g.scale(bodyScale,bodyScale);g.fillStyle=palette[1];g.strokeStyle=palette[2];g.lineWidth=5;
    if(style==='comet'){g.beginPath();g.moveTo(-112,-28);g.lineTo(8,-12);g.lineTo(8,12);g.lineTo(-112,45);g.closePath();g.fill();g.stroke();g.beginPath();g.arc(26,0,48,0,Math.PI*2);g.fill();g.stroke();g.beginPath();g.arc(26,0,23,0,Math.PI*2);g.stroke()}
    else if(style==='gear'){g.beginPath();for(i=0;i<32;i++){var ga=i*Math.PI/16,gr=i%2?70:94;g.lineTo(Math.cos(ga)*gr,Math.sin(ga)*gr)}g.closePath();g.fill();g.stroke();g.beginPath();g.arc(0,0,39,0,Math.PI*2);g.stroke();g.beginPath();g.arc(0,0,17,0,Math.PI*2);g.fill()}
    else if(style==='jelly'){g.beginPath();g.moveTo(-86,4);g.bezierCurveTo(-86,-104,86,-104,86,4);g.quadraticCurveTo(46,32,0,4);g.quadraticCurveTo(-42,34,-86,4);g.closePath();g.fill();g.stroke();for(i=-2;i<=2;i++){g.beginPath();g.moveTo(i*28,8);g.bezierCurveTo(i*36+18,42,i*20-18,64,i*28,96);g.stroke()}}
    else if(style==='vortex'){g.beginPath();for(i=0;i<150;i++){var va=i*.105,vr=i*.58;if(i===0)g.moveTo(Math.cos(va)*vr,Math.sin(va)*vr);else g.lineTo(Math.cos(va)*vr,Math.sin(va)*vr)}g.stroke();g.beginPath();g.arc(0,0,18,0,Math.PI*2);g.fill()}
    else if(style==='crown'){g.beginPath();g.moveTo(-82,-55);g.lineTo(-55,8);g.lineTo(-24,-42);g.lineTo(0,8);g.lineTo(29,-48);g.lineTo(55,8);g.lineTo(83,-55);g.lineTo(70,63);g.lineTo(-70,63);g.closePath();g.fill();g.stroke();g.beginPath();g.ellipse(0,56,70,22,0,0,Math.PI);g.stroke()}
    else if(style==='mushroom'){g.beginPath();g.moveTo(-34,4);g.lineTo(-40,75);g.quadraticCurveTo(0,92,40,75);g.lineTo(34,4);g.closePath();g.fill();g.stroke();g.beginPath();g.ellipse(0,0,91,50,0,Math.PI,Math.PI*2);g.lineTo(91,0);g.quadraticCurveTo(0,38,-91,0);g.fill();g.stroke();for(i=-2;i<=2;i++){g.beginPath();g.arc(i*29,-18+(i%2)*10,7,0,Math.PI*2);g.fillStyle=palette[2];g.fill()}}
    else if(style==='skull'){g.beginPath();g.moveTo(-67,-18);g.quadraticCurveTo(-92,-77,-42,-83);g.lineTo(-30,-58);g.quadraticCurveTo(0,-108,30,-58);g.lineTo(43,-83);g.quadraticCurveTo(92,-77,67,-18);g.lineTo(51,43);g.lineTo(35,74);g.lineTo(-35,74);g.lineTo(-51,43);g.closePath();g.fill();g.stroke();g.fillStyle=palette[0];g.beginPath();g.ellipse(-30,-5,19,25,-.2,0,Math.PI*2);g.ellipse(30,-5,19,25,.2,0,Math.PI*2);g.fill();g.fillStyle=palette[2];for(i=-2;i<=2;i++){g.fillRect(i*15-4,48,8,19)}}
    else if(style==='tentacle'){g.lineWidth=12;for(i=0;i<6;i++){var ta=-Math.PI*.82+i*Math.PI*.328,tx=Math.cos(ta)*45,ty=Math.sin(ta)*45;g.beginPath();g.moveTo(tx,ty);g.bezierCurveTo(tx+Math.cos(ta)*34,ty+Math.sin(ta)*34,tx+Math.cos(ta+.5)*68,ty+Math.sin(ta+.5)*68,Math.cos(ta)*101,Math.sin(ta)*101);g.stroke()}g.lineWidth=5;g.beginPath();g.ellipse(0,-20,58,67,0,0,Math.PI*2);g.fill();g.stroke();g.fillStyle=palette[2];for(i=0;i<5;i++){g.beginPath();g.arc(-38+i*19,31+(i%2)*8,4,0,Math.PI*2);g.fill()}}
    else if(style==='shield'){g.beginPath();g.moveTo(0,-104);g.lineTo(82,-72);g.lineTo(72,24);g.quadraticCurveTo(54,77,0,105);g.quadraticCurveTo(-54,77,-72,24);g.lineTo(-82,-72);g.closePath();g.fill();g.stroke();g.beginPath();g.moveTo(0,-83);g.lineTo(0,76);g.moveTo(-56,-60);g.lineTo(0,-34);g.lineTo(56,-60);g.stroke();g.fillStyle=palette[2];g.beginPath();g.arc(0,4,21,0,Math.PI*2);g.fill()}
    else if(style==='spiky'){g.beginPath();for(i=0;i<24;i++){var an=i*Math.PI/12,rr=i%2?69:103;g.lineTo(Math.cos(an)*rr,Math.sin(an)*rr)}g.closePath();g.fill();g.stroke()}
    else if(style==='rings'||style==='orbital'){for(i=0;i<4;i++){g.beginPath();g.ellipse(0,0,46+i*13,30+i*13,i*.48,0,Math.PI*2);g.stroke()}g.beginPath();g.arc(0,0,36,0,Math.PI*2);g.fill()}
    else if(style==='crystal'||style==='mecha'||style==='pixel'){g.beginPath();for(i=0;i<8;i++){an=i*Math.PI/4;rr=style==='crystal'?(i%2?48:100):80;g.lineTo(Math.cos(an)*rr,Math.sin(an)*rr)}g.closePath();g.fill();g.stroke();if(style==='pixel'){g.fillStyle=palette[2];for(i=-2;i<=2;i++)g.fillRect(i*22-8,-8,16,16)}}
    else if(style==='flower'){for(i=0;i<8;i++){g.rotate(Math.PI/4);g.beginPath();g.ellipse(0,-48,26,48,0,0,Math.PI*2);g.fill();g.stroke()}g.beginPath();g.arc(0,0,35,0,Math.PI*2);g.fill()}
    else {g.beginPath();g.ellipse(0,0,82,70,0,0,Math.PI*2);g.fill();g.stroke();for(i=0;i<7;i++){g.beginPath();g.arc((r()-.5)*110,(r()-.5)*95,7+r()*18,0,Math.PI*2);g.fillStyle=i%2?palette[2]:palette[0];g.fill()}}
    g.restore();
    var eyeSpread=31+r()*19,eyeY=119+(r()-.5)*18,eyeW=8+r()*6,eyeH=12+r()*8,pupilShift=(r()-.5)*5;
    g.fillStyle=palette[2];g.globalAlpha=.8;g.beginPath();g.ellipse(128-eyeSpread,eyeY,eyeW+5,eyeH+5,0,0,Math.PI*2);g.ellipse(128+eyeSpread,eyeY,eyeW+5,eyeH+5,0,0,Math.PI*2);g.fill();g.globalAlpha=1;
    g.fillStyle='#f5f7ff';g.beginPath();g.ellipse(128-eyeSpread,eyeY,eyeW,eyeH,0,0,Math.PI*2);g.ellipse(128+eyeSpread,eyeY,eyeW,eyeH,0,0,Math.PI*2);g.fill();g.fillStyle='#111827';g.beginPath();g.arc(128-eyeSpread+pupilShift,eyeY+2,4+r()*2,0,Math.PI*2);g.arc(128+eyeSpread+pupilShift,eyeY+2,4+r()*2,0,Math.PI*2);g.fill();
    g.strokeStyle='#111827';g.lineWidth=4+r()*3;g.lineCap='round';g.beginPath();var expression=(r()*4)|0;if(expression===0)g.arc(128,151,16,.15,Math.PI-.15);else if(expression===1)g.arc(128,169,16,Math.PI+.15,Math.PI*2-.15);else if(expression===2){g.moveTo(112,151);g.lineTo(128,159);g.lineTo(144,151)}else{g.moveTo(114,155);g.quadraticCurveTo(128,145,142,155)}g.stroke();if(r()>.58){g.fillStyle=palette[2];g.globalAlpha=.9;g.beginPath();g.arc(128+(r()-.5)*30,91+(r()-.5)*30,5+r()*7,0,Math.PI*2);g.fill();g.globalAlpha=1}return c.toDataURL('image/png');
  }
  async function load(i,src,isSample){var el=cardEl(i),frame=q(el,'frame');setLocked(true);frame.classList.add('scanning');try{var img=await loadImg(src),feat=analyze(img);await sleep(180);var oldHp=gameMode==='survival'&&i===1&&F[0]?F[0].hp:null;F[i]=buildFighter(feat,src,isSample);if(gameMode==='survival'&&i===0){F[i].survivalBaseStats=Object.assign({},F[i].stats);['atq','def','vel','esp','hp'].forEach(function(k){F[i].stats[k]=Math.round(F[i].stats[k]*1.1)});F[i].hp=F[i].stats.hp}if(i===0)evolutionApplied=false;F[i].portrait=makePortrait(img);F[i].careerId=careerIdFor(F[i]);if(!isSample)ensureCareerFighter(F[i],imageForCollection(img));resetBattleView(gameMode==='survival');if(oldHp!==null&&F[0]){F[0].hp=oldHp;paintHp(0)}paint(i);}catch(e){log('N\u00e3o consegui abrir a imagem. Tente outro arquivo.','e-miss')}finally{frame.classList.remove('scanning');setLocked(false)}}
  async function loadSamples(styleA,seedA,styleB,seedB){botPreparing=true;setLocked(true);await Promise.all([load(0,makeSample(styleA,seedA),true),load(1,makeSample(styleB,seedB),true)]);rememberSample(styleA,seedA);rememberSample(styleB,seedB);botPreparing=false;setLocked(false)}
  async function loadTwoByTwoSamples(){botPreparing=true;setLocked(true);var picks=[];for(var i=0;i<4;i++){var style=STYLES[(Math.random()*STYLES.length)|0],seed=(Math.random()*1e6)|0;picks.push({style:style,seed:seed,promise:load(i,makeSample(style,seed),true)})}await Promise.all(picks.map(function(p){return p.promise}));picks.forEach(function(p){rememberSample(p.style,p.seed)});botPreparing=false;setLocked(false)}
  async function handleFile(i,file){if(busy||botPreparing||gameMode==='survival'&&survival.active)return;if(!file||!/^image\//.test(file.type))return;if(urls[i])URL.revokeObjectURL(urls[i]);urls[i]=URL.createObjectURL(file);await load(i,urls[i],false)}
  function updateBattleHud(i){var f=F[i],p=clamp(f.hp/f.stats.hp,0,1);$('#battle-name-'+i).textContent=f.name;$('#battle-hp-'+i).textContent=Math.round(p*100)+'%';$('#battle-bar-'+i).style.width=(p*100)+'%';$('#battle-plate-'+i).textContent=f.name;$('#battle-img-'+i).src=f.src;$('#battle-img-'+i).alt=f.name}
  function enterBattleScene(){stopBackgroundMusic();document.body.classList.add('battle-mode');startBattleMusic();$('#battle-stage').classList.toggle('team-match',!!twoByTwoBattle);$('#battle-format-label').textContent=twoByTwoBattle?'BATALHA 2X2 · ELIMINAÇÃO':'RODADA EM ANDAMENTO';[0,1].forEach(updateBattleHud);$('#battle-winner').classList.remove('show')}
  function leaveBattleScene(){stopBattleMusic();document.body.classList.remove('battle-mode');startBackgroundMusic();$('#battle-winner').classList.remove('show');$('#battle-stage').classList.remove('special-cinematic','team-match');$('#battle-format-label').textContent='RODADA EM ANDAMENTO'}
  function showBattleWinner(i){$('#battle-winner-img').src=F[i].src;$('#battle-winner-name').textContent=twoByTwoBattle?(i===0?'EQUIPE AZUL VENCEU · ':'EQUIPE VERMELHA VENCEU · ')+F[i].name:F[i].name;$('#battle-winner').classList.add('show')}
  function pop(i,text,kind){var el=document.createElement('span');el.className='pop '+(kind||'');el.textContent=text;cardEl(i).appendChild(el);setTimeout(function(){el.remove()},900)}
  function battlePause(ms){return tournamentAutoRunning?Promise.resolve():sleep(ms/(gameMode==='tournament'?tournamentSpeed:speed))}
  async function animateBattleMove(i,special,move){
    if(tournamentAutoRunning&&gameMode==='tournament')return;
    var animSpeed=gameMode==='tournament'?tournamentSpeed:speed;
    var fighter=$('#battle-fighter-'+i),fx=$('#battle-attack-fx'),stage=$('#battle-stage');
    fx.className='battle-attack-fx';$('#battle-special').classList.remove('show');
    if(!special){fighter.classList.add('jump-attack');await sleep(460/animSpeed);fighter.classList.remove('jump-attack');return;}
    var key=String(move).toLowerCase();
    var type=key.indexOf('drag')>=0||key.indexOf('brasa')>=0||key.indexOf('eclipse')>=0?'breath':key.indexOf('mar')>=0||key.indexOf('pulso')>=0?'splash':key.indexOf('flash')>=0||key.indexOf('prisma')>=0?'ball':'matter';
    fx.className='battle-attack-fx show from-'+(i===0?'left':'right')+' fx-'+type+' special';
    fx.style.setProperty('--attack-color',TYPES[F[i].type].color);$('#battle-special').textContent=move;$('#battle-special').classList.add('show');stage.classList.add('special-cinematic');fighter.classList.add('special-charge');
    await sleep(650/animSpeed);fx.className='battle-attack-fx';$('#battle-special').classList.remove('show');stage.classList.remove('special-cinematic');fighter.classList.remove('special-charge');
  }

  function flashClass(el, cls, ms) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  async function act(ai, di) {
    var A = F[ai], D = F[di];
    A.gauge = Math.min(100, A.gauge + 18 + A.stats.esp / 6);
    var special = A.gauge >= 100;
    if (special) A.gauge = 0;
    paintGauge(ai);
    var basicMoves = ['Corte de Brasa','Chicote Rápido','Jato de Maré','Raio Luminoso','Garra Sombria','Pulso Arcano'];
    var move = special ? (A.specialMove || TYPES[A.type].move) : basicMoves[Object.keys(TYPES).indexOf(A.type)];
    cardEl(ai).classList.add('act');
    play(A.sounds.atk, { rate: special ? 0.8 : 1, gain: 0.8 });
    if (special) play(A.sounds.atk, { rate: 1.25, gain: 0.45 });
    await animateBattleMove(ai, special, move);
    await battlePause(90);
    cardEl(ai).classList.remove('act');
    var dodgeP = clamp(0.04 + (D.stats.vel - A.stats.vel) / 400 + D.stats.vel / 600, 0.03, 0.3);
    if (!special && battleRandom() < dodgeP) {
      pop(di, 'ESQUIVOU', 'miss');
      log(A.name + ' tentou um ' + move + ', mas ' + D.name + ' esquivou.', 'e-miss');
      return;
    }
    var mult = typeMult(A.type, D.type);
    var dmg = A.stats.atq * (60 / (60 + D.stats.def)) * 0.9 * (0.85 + battleRandom() * 0.3) * mult;
    var crit = battleRandom() < A.stats.esp / 280;
    if (special) dmg *= 1.7;
    if (crit) dmg *= 1.5;
    dmg = Math.max(1, Math.round(dmg));
    D.hp = Math.max(0, D.hp - dmg);
    A.battleDamage = (A.battleDamage || 0) + dmg;
    play(D.sounds.hurt, { gain: 0.6 + Math.min(0.4, dmg / 80), rate: crit ? 1.15 : 1 });
    flashClass(cardEl(di), 'hurt', 340); flashClass($('#battle-fighter-' + di), 'hit-recoil', 340); flashClass($('#battle-stage'), 'impact', 220);
    pop(di, '-' + dmg, crit || special ? 'crit' : '');
    paintHp(di);
    updateBattleHud(di);
    var extra = (mult > 1 ? ' Super eficaz!' : mult < 1 ? ' Pouco eficaz.' : '') + (crit ? ' Golpe crítico!' : '');
    log(A.name + ' usa ' + (special ? move : 'ataque básico') + ' e causa ' + dmg + ' de dano.' + extra, crit || special ? 'e-crit' : '');
    if (D.hp <= 0) {
      await battlePause(260);
      play(D.sounds.ko, { gain: 0.9 });
    }
  }
  function survivalEncounter(defeated){var n=defeated+1, step=(n-1)%10+1;return {arena:Math.floor((n-1)/10)+1,encounter:step,kind:step===10?'boss':step===5?'mini':'normal'}}
  var bossNames=['O Colosso','Rainha Prisma','O Devorador','Rei Abissal','Tit\u00e3 de Cinzas','A Matriarca','N\u00facleo Zero','Imperador Spect'];
  async function spawnSurvivalOpponent(){
    if(!survival.active||survival.awaitingArena||survival.ended||!F[0])return;
    var encounter=survivalEncounter(survival.defeated), arena=encounter.arena, step=encounter.encounter;
    survival.arena=arena;survival.encounter=step;survival.enemyClass=encounter.kind;
    var styles=STYLES.filter(function(x){return x!==sessionStorage.getItem('arenaPixelsSurvivalStyle')});
    var style=styles[(Math.random()*styles.length)|0]||STYLES[0], seed=(Math.random()*1e6)|0;
    sessionStorage.setItem('arenaPixelsSurvivalStyle',style);sessionStorage.setItem('arenaPixelsSurvivalSeed',String(seed));botPreparing=true;
    await load(1,makeSample(style,seed),true);rememberSample(style,seed);
    if(!F[1]){botPreparing=false;setLocked(false);return;}
    var f=F[1], scale=1+(arena-1)*.075, mult=survival.enemyClass==='boss'?2.25:survival.enemyClass==='mini'?1.55:1;
    ['atq','def','vel','esp','hp'].forEach(function(k){f.stats[k]=Math.round(f.stats[k]*scale*(k==='hp'?mult:survival.enemyClass==='normal'?1:survival.enemyClass==='mini'?1.22:1.38));});
    f.stats.hp=Math.min(600,f.stats.hp);f.hp=f.stats.hp;
    if(survival.enemyClass==='boss'){f.name=bossNames[(arena-1)%bossNames.length]+(arena>8?' '+arena:'');f.specialMove=['Eclipse Terminal','Prisma Devastador','V\u00f3rtice Devorador','Abismo Supremo'][((arena-1)%4)];}
    else if(survival.enemyClass==='mini'){f.name='Mini-chefe '+f.name;f.specialMove=['Impacto Tit\u00e2nico','Rajada de Brasas','Mar\u00e9 Esmagadora','Pulso Fren\u00e9tico'][((arena-1)%4)];}
    else f.name=cleanArenaFighterName(f.name);
    $('#arena').classList.toggle('survival-boss',survival.enemyClass==='boss');$('#arena').classList.toggle('survival-mini',survival.enemyClass==='mini');$('#battle-stage').classList.toggle('survival-boss',survival.enemyClass==='boss');$('#battle-stage').classList.toggle('survival-mini',survival.enemyClass==='mini');$('#battle-stage').style.setProperty('--attack-color',TYPES[f.type].color);
    if(survival.enemyClass==='boss')survival.bossStartHp=F[0].hp;
    saveSurvival();paint(1);renderEvolution();botPreparing=false;setLocked(false);
  }

  function waitForOnlineResult(duelId,winnerIndex){return new Promise(function(resolve){if(!activeOnlineDuel||activeOnlineDuel.id!==duelId){resolve(null);return}activeOnlineDuel.resultResolver=resolve;window.dispatchEvent(new CustomEvent('spect-online-duel-complete',{detail:{duelId:duelId,winnerIndex:winnerIndex}}));activeOnlineDuel.resultTimer=setTimeout(function(){if(activeOnlineDuel&&activeOnlineDuel.id===duelId&&activeOnlineDuel.resultResolver){activeOnlineDuel.resultResolver(null);activeOnlineDuel.resultResolver=null}},90000)})}
  window.addEventListener('spect-online-duel-result',function(event){var detail=event.detail||{};if(activeOnlineDuel&&detail.duelId===activeOnlineDuel.id&&activeOnlineDuel.resultResolver){clearTimeout(activeOnlineDuel.resultTimer);var resolve=activeOnlineDuel.resultResolver;activeOnlineDuel.resultResolver=null;resolve(detail)}});
  window.addEventListener('spect-online-duel-cancelled',function(event){var detail=event.detail||{};if(activeOnlineDuel&&detail.duelId===activeOnlineDuel.id&&activeOnlineDuel.resultResolver){clearTimeout(activeOnlineDuel.resultTimer);var resolve=activeOnlineDuel.resultResolver;activeOnlineDuel.resultResolver=null;resolve(null)}});
  function closeOnlineDuel(){var context=activeOnlineDuel;if(!context)return;clearTimeout(context.resultTimer);onlineBattleRng=null;F=context.previousF;gameMode=context.previousMode;twoByTwoEnabled=context.previousTwoByTwo;twoByTwoBattle=context.previousTwoByTwoBattle;activeOnlineDuel=null;resetBattleView(false);F.forEach(function(f,index){if(f)paint(index)});setLocked(false);updateModeControls();window.dispatchEvent(new CustomEvent('spect-world-duel-visibility',{detail:{visible:true}}))}
  window.SPECT_START_ONLINE_BATTLE=async function(duel){if(!duel||busy||activeOnlineDuel||!Array.isArray(duel.fighters)||duel.fighters.length!==2)return false;activeOnlineDuel={id:duel.duelId,previousF:F.slice(),previousMode:gameMode,previousTwoByTwo:twoByTwoEnabled,previousTwoByTwoBattle:twoByTwoBattle};gameMode='online';twoByTwoEnabled=false;twoByTwoBattle=null;window.dispatchEvent(new CustomEvent('spect-world-duel-visibility',{detail:{visible:false}}));try{await Promise.all(duel.fighters.map(function(fighter,index){return load(index,fighter.image,true)}));for(var i=0;i<2;i++){var official=duel.fighters[i];if(!F[i])throw Error('Lutador online não carregou.');F[i].name=official.name;F[i].stats=Object.assign({},official.stats);F[i].hp=official.stats.hp;F[i].gauge=0;F[i].battleDamage=0;F[i].specialMove=TYPES[F[i].type].move;paint(i)}onlineBattleRng=mulberry(duel.seed>>>0);fight();return true}catch(error){console.error('Não foi possível iniciar a batalha online:',error);window.dispatchEvent(new CustomEvent('spect-online-duel-complete',{detail:{duelId:duel.duelId,failed:true}}));closeOnlineDuel();return false}};
  async function restoreSurvival(image){
    try{var style=sessionStorage.getItem('arenaPixelsSurvivalStyle')||'spiky',seed=Number(sessionStorage.getItem('arenaPixelsSurvivalSeed'))||11;
      botPreparing=true;await load(0,image,false);if(!F[0])throw Error('fighter');survivalImageLocked=true;survival.imageKey=evolutionKey(image);survival.active=true;
      applySurvivalLevels();await spawnSurvivalOpponent();botPreparing=false;$('#bot-status').hidden=true;updateModeControls();
    }catch(e){botPreparing=false;throw e}
  }
  function applySurvivalLevels(){if(!F[0])return;var lv=Math.max(0,survival.level-1);F[0].stats.atq=Math.min(180,F[0].stats.atq+lv*2);F[0].stats.def=Math.min(180,F[0].stats.def+lv*2);F[0].stats.vel=Math.min(180,F[0].stats.vel+lv);F[0].stats.esp=Math.min(180,F[0].stats.esp+lv*2);F[0].stats.hp=Math.min(260,F[0].stats.hp+lv*8);F[0].hp=Math.max(1,Math.round(F[0].stats.hp*(survival.lastHpRatio||1)));paint(0)}
  async function fight() {
    if (busy || !F[0] || !F[1] || gameMode==='normal'&&twoByTwoEnabled&&(!F[2]||!F[3])) return;
    var useTwoByTwo=gameMode==='normal'&&twoByTwoEnabled;
    if(useTwoByTwo){twoByTwoBattle={teams:[[F[0],F[2]],[F[1],F[3]]],active:[0,0]};twoByTwoBattle.teams.forEach(function(team){team.forEach(function(f){f.hp=f.stats.hp;f.gauge=0;f.battleDamage=0})});F[0]=twoByTwoBattle.teams[0][0];F[1]=twoByTwoBattle.teams[1][0]}
    var autoTournamentFight=gameMode==='tournament'&&tournamentAutoRunning;
    if(autoTournamentFight)stopBackgroundMusic();
    resetBattleView(gameMode === 'survival');
    F[0].battleDamage = 0; F[1].battleDamage = 0;
    busy = true;
    var id = ++runId;
    if(!autoTournamentFight)audio();
    setLocked(true);
    $('#fightBtn').disabled = true;
    if(!autoTournamentFight)enterBattleScene();
    if (gameMode === 'survival' && survival.enemyClass !== 'normal') {
      var intro = survival.enemyClass === 'boss' ? 'CHEFÃO · ARENA ' + survival.arena : 'MINI CHEFE · ARENA ' + survival.arena;
      $('#battle-special').textContent = intro; $('#battle-special').classList.add('show'); $('#battle-stage').classList.add('special-cinematic');
      play(F[1].sounds.atk, { rate: 0.55, gain: 1 });
      await sleep(1300 / speed); $('#battle-special').classList.remove('show'); $('#battle-stage').classList.remove('special-cinematic');
    }
    var round = 1;
    while ((useTwoByTwo?twoByTwoBattle.active[0]<2&&twoByTwoBattle.active[1]<2:F[0].hp > 0 && F[1].hp > 0) && round <= (useTwoByTwo?80:40)) {
      $('#battle-round').textContent = 'RODADA ' + round;
      var j0 = F[0].stats.vel * (0.8 + battleRandom() * 0.4), j1 = F[1].stats.vel * (0.8 + battleRandom() * 0.4);
      var order = j0 >= j1 ? [0, 1] : [1, 0];
      for (var k = 0; k < 2; k++) {
        if (id !== runId) return;
        if (F[0].hp <= 0 || F[1].hp <= 0) break;
        await act(order[k], 1 - order[k]);
        if (id !== runId) return;
        await battlePause(520);
      }
      if(useTwoByTwo){
        if(F[0].hp<=0&&!await advanceTwoByTwoFighter(0))break;
        if(F[1].hp<=0&&!await advanceTwoByTwoFighter(1))break;
        if(twoByTwoBattle.active[0]>=2||twoByTwoBattle.active[1]>=2)break;
      }
      round++;
    }
    if (id !== runId) return;
    var w;
    if(useTwoByTwo){if(twoByTwoBattle.active[0]>=2)w=1;else if(twoByTwoBattle.active[1]>=2)w=0;else w=F[0].hp/F[0].stats.hp>=F[1].hp/F[1].stats.hp?0:1}
    else{w=F[0].hp / F[0].stats.hp >= F[1].hp / F[1].stats.hp ? 0 : 1;if (F[w].hp <= 0) w = 1 - w}
    var l = 1 - w;
    if(gameMode==='online'&&activeOnlineDuel){var officialResult=await waitForOnlineResult(activeOnlineDuel.id,w);if(!officialResult||officialResult.winnerIndex===undefined){$('#battle-winner-name').textContent='BATALHA CANCELADA';$('#battle-winner').classList.add('show');await sleep(1300);leaveBattleScene();resetBattleView(false);setLocked(false);closeOnlineDuel();return}w=officialResult.winnerIndex;l=1-w}
    var tournamentToken=gameMode==='tournament'&&tournament?tournament.id+':'+tournament.currentMatchId:null;
    saveRanking(w,gameMode==='online'&&activeOnlineDuel?'online:'+activeOnlineDuel.id:tournamentToken);
    if (gameMode === 'survival') recordSurvivalFight(w);
    if (gameMode === 'tournament' && tournament) settleTournamentResult(tourneyMatch(tournament.currentMatchId),F[w].careerId);
    if(autoTournamentFight){resetBattleView(false);setLocked(false);updateModeControls();startBackgroundMusic();return}
    if(!useTwoByTwo)publishBattleChat(w, l);
    cardEl(w).classList.add('win');
    if (F[l].hp <= 0) cardEl(l).classList.add('ko');
    showBattleWinner(w);
    await sleep(2500);
    leaveBattleScene();
    if(useTwoByTwo){F[0]=twoByTwoBattle.teams[0][0];F[1]=twoByTwoBattle.teams[1][0];F[2]=twoByTwoBattle.teams[0][1];F[3]=twoByTwoBattle.teams[1][1];twoByTwoBattle=null;[0,1,2,3].forEach(function(i){paint(i)})}
    resetBattleView(gameMode === 'survival');
    $('#fightBtn').textContent = 'Lutar';
    if(gameMode==='survival' && w===0 && survival.active && !survival.awaitingArena && !survival.ended) await spawnSurvivalOpponent();
    setLocked(false);
    updateModeControls();
    if(gameMode==='tournament')renderTournament();
    if(gameMode==='online')closeOnlineDuel();
  }

  async function advanceTwoByTwoFighter(side){
    var state=twoByTwoBattle;if(!state)return false;state.active[side]++;
    if(state.active[side]>=2)return false;
    var slot=side===0?0:1,next=state.teams[side][state.active[side]];next.hp=next.stats.hp;next.gauge=0;next.battleDamage=0;F[slot]=next;updateBattleHud(slot);
    var banner=$('#battle-special');banner.textContent=next.name+' ENTRA NA LUTA';banner.classList.add('show');$('#battle-stage').classList.add('special-cinematic');await battlePause(700);banner.classList.remove('show');$('#battle-stage').classList.remove('special-cinematic');return true;
  }

  /* ---------- montagem ---------- */
  [0, 1, 2, 3].forEach(function (i) {
    var el = cardEl(i);
    el.innerHTML = cardHTML(i);
    var frame = q(el, 'frame'), input = q(el, 'file');
    input.addEventListener('change', function () { var fl = input.files && input.files[0]; input.value = ''; handleFile(i, fl); });
    frame.addEventListener('dragover', function (e) { e.preventDefault(); frame.classList.add('dragover'); });
    frame.addEventListener('dragleave', function () { frame.classList.remove('dragover'); });
    frame.addEventListener('drop', function (e) {
      e.preventDefault(); frame.classList.remove('dragover');
      handleFile(i, e.dataTransfer && e.dataTransfer.files[0]);
    });
    [['sndAtk', 'atk'], ['sndHurt', 'hurt']].forEach(function (pair) {
      var btn = q(el, pair[0]);
      btn.addEventListener('click', function () {
        if (!F[i]) return;
        audio();
        var snd = F[i].sounds[pair[1]];
        play(snd, { gain: 0.8 });
        btn.classList.add('playing');
        setTimeout(function () { btn.classList.remove('playing'); }, snd.dur * 1000);
      });
    });
  });

  $('#bot-image-upload').addEventListener('change',async function(){
    var file=this.files&&this.files[0];if(!file||!/^image\//.test(file.type))return;this.disabled=true;botPreparing=true;
    try{var data=await compressBotImage(file);survival={active:true,imageKey:evolutionKey(data),defeated:0,arenas:0,mini:0,bosses:0,streak:0,level:1,xp:0,damage:0,enemyClass:'normal',arena:1,encounter:1,awaitingArena:false,ended:false,bossStartHp:0,lastHpRatio:1};
      sessionStorage.setItem('arenaPixelsSurvivalImage',data);evolution={imageKey:survival.imageKey,points:0,levels:{atq:0,def:0,vel:0,esp:0,hp:0}};
      await load(0,data,false);if(!F[0])throw Error('load');survivalImageLocked=true;$('#arena').classList.add('survival-image-locked');await spawnSurvivalOpponent();botPreparing=false;$('#bot-status').hidden=true;saveSurvival();updateModeControls();
    }catch(e){botPreparing=false;this.disabled=false;this.value='';$('#bot-status').hidden=false;$('#bot-status').textContent='N\u00e3o consegui carregar essa imagem. Escolha outro arquivo.';setLocked(false)}
  });
  $('#fightBtn').addEventListener('click', function () {
    if (!F[0] || !F[1] || gameMode==='normal'&&twoByTwoEnabled&&(!F[2]||!F[3]) || busy || (gameMode === 'survival' && (!survival.active || survival.awaitingArena || survival.ended))) return;
    closeModes();
    fight();
  });
  $('#two-by-two-toggle').addEventListener('click',function(){if(busy||botPreparing||gameMode!=='normal')return;twoByTwoEnabled=!twoByTwoEnabled;$('#arena').classList.toggle('mode-2x2',twoByTwoEnabled);$('#card2').hidden=!twoByTwoEnabled;$('#card3').hidden=!twoByTwoEnabled;this.textContent=twoByTwoEnabled?'2x2: Ativado':'2x2: Desativado';this.setAttribute('aria-pressed',twoByTwoEnabled?'true':'false');$('#fightBtn').textContent=twoByTwoEnabled?'Batalhar 2x2':'Lutar';$('#sampleBtn').textContent=twoByTwoEnabled?'Sortear 4 lutadores':'Sortear exemplos';setLocked(false)});
  $('#sampleBtn').addEventListener('click', function () {
    if (botPreparing) return;
    if(gameMode==='survival'){spawnSurvivalOpponent();return;}
    if(gameMode==='normal'&&twoByTwoEnabled){loadTwoByTwoSamples().catch(function(){botPreparing=false;setLocked(false)});return;}
    var useReturningFighter = sampleRoster.length > 0 && Math.random() < 0.16;
    var a = (Math.random() * STYLES.length) | 0, b = (a + 1 + ((Math.random() * (STYLES.length - 1)) | 0)) % STYLES.length;
    var styleA = STYLES[a], styleB = STYLES[b];
    var seedA = (Math.random() * 1e6) | 0, seedB = (Math.random() * 1e6) | 0;
    if (useReturningFighter) {
      var returning = sampleRoster[(Math.random() * sampleRoster.length) | 0];
      if (Math.random() >= 0.5) { styleB = returning.style; seedB = returning.seed; }
      else { styleA = returning.style; seedA = returning.seed; }
    }
    loadSamples(styleA, seedA, styleB, seedB).catch(function () { setLocked(false); });
  });
  $('#speedBtn').addEventListener('click', function () {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    this.textContent = 'Velocidade ' + speed + 'x';
  });
  $('#muteBtn').addEventListener('click', function () {
    musicMuted = !musicMuted;
    window.SPECT_MUSIC_MUTED=musicMuted;window.dispatchEvent(new CustomEvent('spect-music-toggle',{detail:{muted:musicMuted}}));
    if(backgroundMusic)backgroundMusic.muted=musicMuted;
    if(battleMusic)battleMusic.muted=musicMuted;
    if(!musicMuted){if(document.body.classList.contains('battle-mode')||tournamentAutoBatch)startBattleMusic();else startBackgroundMusic()}
    this.textContent = musicMuted ? 'Música desligada' : 'Música ligada';
    this.setAttribute('aria-pressed', musicMuted ? 'true' : 'false');
  });

  /* ---------- chat social local ---------- */
  var socialFeed = $('#social-feed');
  var socialPosts = [];
  try {
    socialPosts = JSON.parse(sessionStorage.getItem('arenaPixelsSocialFeed') || '[]') || [];
    socialPosts = socialPosts.sort(function (a, b) { return b.time - a.time; }).slice(0, 8);
  } catch (e) { socialPosts = []; }
  var socialFirst = ['Pixel','Neo','Luna','Byte','Nexus','Mika','Shadow','Kira','Zed','Nova','Kai','Vortex','Milo','Echo','Ravi','Dara'];
  var socialLast = ['Gamer','BR','Master','X','Plays','_07','Pro','zin','Fox','Storm','Bits','.exe','Knight','Zero'];
  var socialMessages = [
    'Acabei de testar um novo lutador. Essa arena ficou muito boa! ðŸŽ®',
    'Qual elemento vocês acham mais forte: Fogo, Água, Planta ou Sombra?',
    'Meu lutador favorito até agora é o que tem mais velocidade. ⚡',
    'Alguém conseguiu passar de 500 de dano em uma luta?',
    'As combinações de imagens deixam cada batalha diferente. ✨',
    'Desafio da comunidade: criem dois lutadores e vejam quem vence!',
    'A arena está aberta! Quem vai testar um duelo agora?',
    'Esse visual ficou com muita cara de chefe final ðŸ‘€',
    'Hoje eu estou torcendo pelo lutador mais improvável.',
    'Uma revanche desse duelo seria boa demais.',
    'Qual som de golpe ficou mais legal até agora?',
    'Dica: não subestimem a defesa alta ðŸ›¡ï¸',
    'Esse especial virou o combate no último segundo!',
    'Quero ver uma luta entre dois lutadores de Sombra ðŸŒ‘',
    'O visual da arena combina muito com esse lutador.',
    'Batalha equilibrada é sempre a melhor de assistir!',
    'Alguém mais escolhe o lutador pela aparência primeiro?',
    'Nova rodada, novas combinações. Bora pra arena!'
  ];
  var avatarColors = ['#6652a3','#286b80','#8a4d59','#4c765e','#8b672f','#425b91'];
  function socialRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function socialName() {
    // Às vezes usa o nome gerado a partir de uma das imagens como nome de perfil.
    var imageNames = F.filter(Boolean).map(function (fighter) { return fighter.name; });
    var base = imageNames.length && Math.random() < 0.38 ? socialRandom(imageNames) : socialRandom(socialFirst) + socialRandom(socialLast);
    return base;
  }
  function publishBattleChat(winnerIndex, loserIndex) {
    // Publica comentários novos a cada batalha, usando os resultados reais da luta.
    var winner = F[winnerIndex], loser = F[loserIndex];
    if (!winner || !loser) return;

    var winnerDamage = winner.battleDamage || 0;
    var loserDamage = loser.battleDamage || 0;
    var totalDamage = winnerDamage + loserDamage;
    var margin = Math.abs(winner.hp / winner.stats.hp - loser.hp / loser.stats.hp);
    var reactions = [
      winner.name + ' levou essa! Foram ' + winnerDamage + ' de dano causado. ðŸ”¥',
      loser.name + ' ainda conseguiu causar ' + loserDamage + ' de dano. Boa luta! ðŸ‘€',
      margin < 0.15 ? 'Foi por muito pouco! Essa luta merecia mais um round ðŸ˜±' : winner.name + ' fechou o combate com estilo!',
      winnerDamage > loserDamage * 1.5 ? winner.name + ' dominou o combate do começo ao fim ⚡' : 'Os dois trocaram golpes pesados. Foram ' + totalDamage + ' de dano no total!',
      'Esse especial de ' + winner.name + ' mudou tudo!',
      'Quero ver ' + loser.name + ' voltando para uma revanche.',
      'A defesa de ' + loser.name + ' segurou bem por vários rounds ðŸ›¡ï¸',
      'Combinação de cores do ' + winner.name + ' ficou incrível ✨',
      'Quem vocês acham que vence numa revanche?',
      'Esse duelo foi melhor do que eu esperava!',
      'A arena está pegando fogo depois dessa luta ðŸ”¥',
      'Mais alguém viu aquele crítico? Que impacto!'
    ];

    var resultPost = {
      id: 'battle-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
      name: 'RESULTADO',
      message: 'ðŸ† FIM DE BATALHA: ' + winner.name + ' venceu ' + loser.name + '! Dano causado: ' + winner.name + ' ' + winnerDamage + ' | ' + loser.name + ' ' + loserDamage + '.',
      likes: Math.floor(Math.random() * 8),
      liked: false,
      time: Date.now()
    };
    var newBattleMessages = [resultPost];
    var shuffledReactions = reactions.slice();
    for (var ri = shuffledReactions.length - 1; ri > 0; ri--) {
      var rj = Math.floor(Math.random() * (ri + 1));
      var swap = shuffledReactions[ri]; shuffledReactions[ri] = shuffledReactions[rj]; shuffledReactions[rj] = swap;
    }
    shuffledReactions.slice(0, 3).forEach(function (message, index) {
      newBattleMessages.push({
        id: 'battle-reaction-' + Date.now() + '-' + index + '-' + Math.random().toString(36).slice(2,6),
        name: socialName(), message: message, likes: Math.floor(Math.random() * 12),
        liked: false, time: Date.now() + index
      });
    });
    socialPosts = newBattleMessages.concat(socialPosts).sort(function (a, b) { return b.time - a.time; }).slice(0, 8);
    socialPosts.sort(function (a, b) { return b.time - a.time; });
    saveSocialFeed();
    renderSocialFeed();
  }

  function publishAmbientChat() {
    if (document.hidden || !F[0] || !F[1]) return;
    var fighter = socialRandom(F);
    var other = F[fighter === F[0] ? 1 : 0];
    var ambientLines = [
      'Alguém já escolheu seu favorito entre ' + F[0].name + ' e ' + F[1].name + '?',
      fighter.name + ' tem um visual muito marcante.',
      'Quero ver ' + fighter.name + ' usando o especial na próxima luta!',
      'Será que ' + other.name + ' consegue uma revanche?',
      'A combinação de tipos desse duelo está interessante ðŸ‘€',
      'Seus lutadores estão prontos para mais uma rodada?',
      'A arena continua aberta. Qual vai ser o próximo duelo?',
      'Acho que essa luta vai ser equilibrada ⚡',
      'Qual dos dois tem o melhor visual: ' + F[0].name + ' ou ' + F[1].name + '?',
      'Estou curioso para ver como o especial de ' + fighter.name + ' funciona.'
    ];
    socialPosts.unshift({
      id:'ambient-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
      name:socialName(), message:socialRandom(ambientLines),
      likes:Math.floor(Math.random() * 5), liked:false, time:Date.now()
    });
    socialPosts = socialPosts.slice(0, 8);
    saveSocialFeed();
    renderSocialFeed();
  }  function seedSocialFeed() {
    if (socialPosts.length) return;
    for (var i = 0; i < 4; i++) socialPosts.push({ id: 'seed-' + i, name: socialName(), message: socialRandom(socialMessages), likes: Math.floor(Math.random() * 18), liked: false, time: Date.now() - (i + 1) * 60000 });
    saveSocialFeed();
  }
  function saveSocialFeed() {
    try { sessionStorage.setItem('arenaPixelsSocialFeed', JSON.stringify(socialPosts.slice(0, 8))); } catch (e) {}
  }
  function renderSocialFeed() {
    if (!socialPosts.length) { socialFeed.innerHTML = '<div class="community-empty">Ainda não há publicações. Seja o primeiro a falar!</div>'; return; }
    socialFeed.innerHTML = socialPosts.slice().sort(function (a,b) { return b.time-a.time; }).slice(0, 8).map(function (post) {
      var initials = String(post.name).slice(0,2).toUpperCase();
      var color = avatarColors[Math.abs(String(post.name).split('').reduce(function (n,c) { return n+c.charCodeAt(0); },0)) % avatarColors.length];
      return '<article class="social-post"><div class="social-avatar" style="--avatar:'+color+'">'+escapeRank(initials)+'</div><div><div class="social-meta"><span class="social-name">'+escapeRank(post.name)+'</span><span class="social-time">'+gameDate(post.time).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+'</span></div><p class="social-message">'+escapeRank(post.message)+'</p><div class="social-actions"><button type="button" class="post-like '+(post.liked?'liked':'')+'" data-like="'+escapeRank(post.id)+'">♥ '+(post.likes||0)+'</button><span class="social-count">PUBLICAÇÃO DA COMUNIDADE</span></div></div></article>';
    }).join('');
  }
  $('#social-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = $('#social-input'), message = input.value.trim();
    if (!message) return;
    socialPosts.push({ id: 'post-' + Date.now() + '-' + Math.random().toString(36).slice(2,7), name: 'Você', message: message, likes: 0, liked: false, time: Date.now() });
    socialPosts.sort(function (a, b) { return b.time - a.time; });
    socialPosts = socialPosts.slice(0, 8);
    input.value = ''; saveSocialFeed(); renderSocialFeed();
  });
  socialFeed.addEventListener('click', function (event) {
    var button = event.target.closest('[data-like]'); if (!button) return;
    var post = socialPosts.find(function (item) { return item.id === button.getAttribute('data-like'); });
    if (!post) return;
    post.liked = !post.liked; post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1));
    saveSocialFeed(); renderSocialFeed();
  });
  renderSocialFeed();

  window.setInterval(publishAmbientChat, 55000);
  var rankSidebar = $('#rank-sidebar'), rankEdge = $('#rank-edge');
  var modesSidebar = $('#modes-sidebar');
  function openRanking() { rankSidebar.classList.add('open'); rankSidebar.setAttribute('aria-hidden', 'false'); rankEdge.classList.remove('visible'); renderRanking(); renderMorePanels(); }
  function closeRanking() { rankSidebar.classList.remove('open'); rankSidebar.setAttribute('aria-hidden', 'true'); }
  function openModes() { closeRanking(); modesSidebar.classList.add('open'); modesSidebar.setAttribute('aria-hidden', 'false'); }
  function closeModes() { modesSidebar.classList.remove('open'); modesSidebar.setAttribute('aria-hidden', 'true'); }
  var mainFightersBeforeTournament=null,modeBeforeTournament='normal';
  function tourneyRoundsName(count,index){if(count===1)return 'Final';if(count===2)return 'Semifinais';if(count===4)return 'Quartas de final';if(count===8)return 'Oitavas de final';if(count===16)return '16-avos de final';if(count===32)return 'Fase de 64';return 'Fase '+(index+1)}
  function tourneyMatch(id){if(!tournament)return null;for(var r=0;r<tournament.rounds.length;r++)for(var m=0;m<tournament.rounds[r].length;m++)if(tournament.rounds[r][m].id===id)return tournament.rounds[r][m];return null}
  function saveTournament(){if(!tournament)return;careerData.activeTournament=tournament;persistCareer()}
  function makeTournamentMatch(round,index,a,b){var m={id:'r'+round+'m'+index,a:a||null,b:b||null,winner:null,status:'pending'};if(!m.a&&!m.b){m.status='bye'}else if(!m.a||!m.b){m.status='bye';m.winner=m.a||m.b}return m}
  function createInitialTournamentRound(participantIds,bracketSize){var slots=Array(bracketSize).fill(null);participantIds.forEach(function(id,i){slots[Math.floor(i*bracketSize/participantIds.length)]=id});var matches=[];for(var i=0;i<bracketSize;i+=2)matches.push(makeTournamentMatch(0,i/2,slots[i],slots[i+1]));return matches}
  function advanceTournament(){if(!tournament||tournament.completed)return;var guard=0;while(guard++<12){var round=tournament.rounds[tournament.rounds.length-1];if(!round||round.some(function(m){return m.status==='pending'||m.status==='playing'}))break;if(round.length===1){var champion=round[0].winner;if(champion)finishTournament(champion);break}var winners=round.map(function(m){return m.winner||null}),next=[];for(var i=0;i<winners.length;i+=2)next.push(makeTournamentMatch(tournament.rounds.length,i/2,winners[i],winners[i+1]));tournament.rounds.push(next);if(next.some(function(m){return m.status==='pending'}))break}saveTournament()}
  function recoverTournamentMatch(){if(!tournament||tournament.completed)return;var playing=null;for(var r=0;r<tournament.rounds.length;r++)for(var i=0;i<tournament.rounds[r].length;i++)if(tournament.rounds[r][i].status==='playing')playing=tournament.rounds[r][i];if(!playing)return;var token=tournament.id+':'+playing.id,result=careerData.appliedResults[token];if(result){playing.winner=result.winnerId;playing.status='done';tournament.runWins[result.winnerId]=(tournament.runWins[result.winnerId]||0)+1;advanceTournament()}else{playing.status='pending';saveTournament()}}
  function finishTournament(championId){if(!tournament||tournament.completed)return;var r=careerData.fighters[championId];if(!r)return;tournament.completed=true;tournament.completedAt=Date.now();tournament.championId=championId;tournament.championWins=tournament.runWins[championId]||0;r.tournamentTitles=(r.tournamentTitles||0)+1;grantCareerXp(r,200);hallInsert(r,'Campe\u00e3o de Torneio');tournament.players.forEach(function(id){var member=careerData.fighters[id];if(member)evaluateHall(member)});if(!careerData.tournaments.some(function(t){return t.id===tournament.id})){careerData.tournaments.push({id:tournament.id,size:tournament.size,players:tournament.players.slice(),rounds:tournament.rounds.map(function(round){return round.map(function(m){return {id:m.id,a:m.a,b:m.b,winner:m.winner,status:m.status}})}),championId:championId,championWins:tournament.championWins,completedAt:tournament.completedAt})}saveTournament();renderHall();renderTournamentHistory();}
  function renderTournamentParticipant(id,winner){if(!id)return '<div class="tournament-player tournament-bye">BYE: avan\u00e7o autom\u00e1tico</div>';var r=careerData.fighters[id];if(!r)return '<div class="tournament-player">Lutador indispon\u00edvel</div>';return '<div class="tournament-player '+(winner?'winner':'')+'">'+(r.portrait||r.src?'<img src="'+escapeRank(r.portrait||r.src)+'" alt="">':'')+'<span>'+escapeRank(r.name)+'</span>'+(winner?'<span class="result">V</span>':'')+'</div>'}
  function renderTournamentHistory(){var el=$('#tournament-history');if(!el)return;var list=careerData.tournaments.slice().sort(function(a,b){return b.completedAt-a.completedAt});el.innerHTML=list.length?list.map(function(t){var r=careerData.fighters[t.championId]||{};return '<div class="tournament-history-row">'+(r.portrait||r.src?'<img src="'+escapeRank(r.portrait||r.src)+'" alt="">':'<span></span>')+'<div><b>'+escapeRank(r.name||'Campe\u00e3o')+'</b><div>'+gameDate(t.completedAt).toLocaleDateString('pt-BR')+' \u00b7 '+t.players.length+'/'+t.size+' participantes</div></div><strong>'+t.championWins+' vit\u00f3rias</strong></div>'}).join(''):'<div class="feature-empty">Os torneios conclu\u00eddos aparecer\u00e3o aqui.</div>'}
  function renderTournament(){
    var cfg=$('#tournament-config'),board=$('#tournament-board');if(!cfg||!board)return;var active=!!tournament;cfg.hidden=active;board.hidden=!active;if(!active){renderTournamentHistory();return}
    $('#tournament-title').textContent='TORNEIO DAS ARTES - '+tournament.players.length+' LUTADORES';var rounds=tournament.rounds,last=rounds[rounds.length-1],pending=last.filter(function(m){return m.status==='pending'}),playing=last.find(function(m){return m.status==='playing'}),autoRound=last.length>4;
    var advance=$('#tournament-advance');advance.hidden=tournament.completed||!autoRound;advance.disabled=tournamentAutoBatch;$('#tournament-speed').disabled=tournamentAutoBatch;$('#tournament-speed').textContent='Velocidade '+tournamentSpeed+'x';$('#tournament-speed').setAttribute('aria-pressed',tournamentSpeed===2?'true':'false');$('#tournament-new').disabled=tournamentAutoBatch;document.querySelectorAll('[data-feature-back]').forEach(function(b){b.disabled=tournamentAutoBatch});advance.textContent=tournamentAutoBatch?'SIMULANDO '+tournamentAutoProgress.done+'/'+tournamentAutoProgress.total:'AVAN\u00c7AR RODADA INTEIRA';
    $('#tournament-auto-status').textContent=tournamentAutoBatch?'Resolvendo automaticamente os confrontos desta fase.':'';
    var roundName=tourneyRoundsName(last.length,rounds.length-1);$('#tournament-status').textContent=tournament.completed?'Campeonato conclu\u00eddo - '+gameDate(tournament.completedAt).toLocaleDateString('pt-BR'):tournamentAutoBatch?'Fase em andamento: '+tournamentAutoProgress.done+'/'+tournamentAutoProgress.total+' confrontos resolvidos.':roundName+' - '+pending.length+' confrontos aguardando';
    var shown=autoRound?2:1,fixtures=playing?[playing]:pending.slice(0,shown);$('#tournament-next-pairings').innerHTML=fixtures.length?'<h3>PR\u00d3XIMOS CONFRONTOS - '+(autoRound?'AT\u00c9 2 PARTIDAS AUTOM\u00c1TICAS':'1 PARTIDA POR VEZ')+'</h3><div class="tournament-next-grid">'+fixtures.map(function(m){return '<div class="next-fixture"><div>'+renderTournamentParticipant(m.a,m.winner===m.a)+'<div class="tournament-bye">VS</div>'+renderTournamentParticipant(m.b,m.winner===m.b)+'</div>'+(autoRound?'':'<button class="btn primary" type="button" data-tournament-play="'+m.id+'" '+(m.status==='playing'?'disabled':'')+'>Lutar este confronto</button>')+'</div>'}).join('')+'</div>':tournament.completed?'':'<div class="feature-empty">Preparando a pr\u00f3xima fase...</div>';
    $('#tournament-bracket').innerHTML='<nav class="tournament-round-tabs" aria-label="Fases do torneio">'+rounds.map(function(matches,ri){var remaining=matches.filter(function(m){return m.status==='pending'||m.status==='playing'}).length;return '<button type="button" class="tournament-round-tab '+(ri===rounds.length-1?'active':'')+'" data-tournament-round="'+ri+'" aria-selected="'+(ri===rounds.length-1?'true':'false')+'"><span>'+tourneyRoundsName(matches.length,ri)+'</span><small>'+(remaining?remaining+' pendentes':'Conclu?da')+'</small></button>'}).join('')+'</nav><div class="tournament-round-panels">'+rounds.map(function(matches,ri){return '<section class="tournament-round-panel '+(ri===rounds.length-1?'active':'')+'" data-tournament-panel="'+ri+'" '+(ri===rounds.length-1?'':'hidden')+'><div class="tournament-round-summary"><h4>'+tourneyRoundsName(matches.length,ri)+'</h4><span>'+matches.length+' confrontos</span></div><div class="tournament-match-grid">'+matches.map(function(m,mi){return '<article class="tournament-match '+(m.status==='pending'?'pending':m.status==='done'?'won':'')+'"><div class="tournament-match-id">'+(m.status==='bye'?'BYE':tourneyRoundsName(matches.length,ri).toUpperCase()+' '+String(mi+1).padStart(2,'0'))+'<span>'+(m.status==='done'?'Conclu\u00eddo':m.status==='playing'?'Em andamento':m.status==='bye'?'Avan\u00e7o autom\u00e1tico':'Aguardando')+'</span></div>'+renderTournamentParticipant(m.a,m.winner===m.a)+'<div class="tournament-bye">VS</div>'+renderTournamentParticipant(m.b,m.winner===m.b)+'</article>'}).join('')+'</div></section>'}).join('')+'</div>';
    var champ=$('#tournament-champion');champ.hidden=!tournament.completed;if(tournament.completed){var c=careerData.fighters[tournament.championId];champ.innerHTML='<span class="feature-kicker">CAMPE\u00c3O OFICIAL SPECT</span><img src="'+escapeRank(c.portrait||c.src)+'" alt="'+escapeRank(c.name)+'"><h3>'+escapeRank(c.name)+'</h3><p>'+tournament.championWins+' confrontos vencidos - '+tournament.players.length+' participantes</p><p>T\u00edtulo registrado no Hall da Fama.</p>'}renderTournamentHistory();renderHall()
  }
  function showFeatureScreen(id){if(id==='tournament'&&!mainFightersBeforeTournament){modeBeforeTournament=gameMode==='tournament'?'normal':gameMode;mainFightersBeforeTournament=F.slice()}$('#tournament-screen').hidden=id!=='tournament';closeModes();closeRanking();if(id==='tournament'){gameMode='tournament';updateModeControls();syncRankCollection();recoverTournamentMatch();renderTournamentRoster();renderTournament()}}
  function availableTournamentFighters(){syncRankCollection();return Object.values(careerData.fighters).filter(function(r){return r&&r.id&&(r.src||r.portrait)}).sort(function(a,b){return a.name.localeCompare(b.name)})}
  function renderTournamentRoster(){var roster=$('#tournament-roster');if(!roster)return;var entries=availableTournamentFighters();$('#tournament-roster-count').textContent=entries.length+' lutadores dispon\u00edveis na cole\u00e7\u00e3o';roster.innerHTML=entries.length?entries.map(function(r){return '<label class="tournament-entrant"><input type="checkbox" data-tour-pick="'+escapeRank(r.id)+'"><img src="'+escapeRank(r.portrait||r.src)+'" alt=""><span>'+escapeRank(r.name)+' \u00b7 '+escapeRank(r.type||'Lutador')+'</span></label>'}).join(''):'<div class="feature-empty">Carregue imagens ou conclua batalhas para formar sua cole\u00e7\u00e3o.</div>'}
  function fillTournamentEntrants(selected,available,capacity,randomFill,rng){var known=new Set(available.map(function(r){return r.id})),ids=[];selected.forEach(function(id){if(known.has(id)&&ids.indexOf(id)<0)ids.push(id)});if(ids.length>capacity)return {ok:false,reason:'over',ids:ids};if(randomFill){var pool=available.filter(function(r){return ids.indexOf(r.id)<0}),random=rng||Math.random;for(var i=pool.length-1;i>0;i--){var j=Math.floor(random()*(i+1)),tmp=pool[i];pool[i]=pool[j];pool[j]=tmp}while(ids.length<capacity&&pool.length)ids.push(pool.pop().id)}return {ok:true,ids:ids,short:ids.length<capacity}}
  function createTournament(){var capacity=Number($('#tournament-size').value),available=availableTournamentFighters(),selected=[].slice.call(document.querySelectorAll('[data-tour-pick]:checked')).map(function(x){return x.getAttribute('data-tour-pick')}),note=$('#tournament-notice'),filled=fillTournamentEntrants(selected,available,capacity,$('#tournament-random-fill').checked);if(!filled.ok){note.textContent='Voc\u00ea selecionou '+filled.ids.length+' lutadores. Aumente a chave ou desmarque alguns.';return}var entrants=filled.ids;if(entrants.length<2){note.textContent='Selecione pelo menos dois lutadores para iniciar o torneio.';return}note.textContent=filled.short?'H\u00e1 apenas '+entrants.length+' participantes sem repeti\u00e7\u00e3o. As vagas restantes avan\u00e7ar\u00e3o por BYE.':'Chave completa com '+entrants.length+' participantes.';var first=createInitialTournamentRound(entrants,capacity);tournament={id:'spect-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),size:capacity,players:entrants,rounds:[first],runWins:{},completed:false,createdAt:Date.now(),currentMatchId:''};careerData.activeTournament=tournament;advanceTournament();saveTournament();renderTournament()}
  async function advanceTournamentRoundAutomatically(){if(!tournament||tournament.completed||tournamentAutoBatch||busy)return;var round=tournament.rounds[tournament.rounds.length-1];if(!round||round.length<=4)return;var matches=round.filter(function(m){return m.status==='pending'});if(!matches.length){advanceTournament();renderTournament();return}tournamentAutoBatch=true;stopBackgroundMusic();startBattleMusic();tournamentAutoProgress={done:0,total:matches.length};renderTournament();try{for(var i=0;i<matches.length;i++){var ok=await playTournamentMatch(matches[i].id,true);if(!ok)throw Error('match failed');tournamentAutoProgress.done=i+1;renderTournament()}}catch(e){$('#tournament-auto-status').textContent='Rodada interrompida. Avance novamente para continuar.'}finally{tournamentAutoBatch=false;tournamentAutoRunning=false;stopBattleMusic();startBackgroundMusic();renderTournament()}}
  function settleTournamentResult(match,winnerId){if(!tournament||!match)return;match.status='done';match.winner=winnerId;tournament.currentMatchId='';tournament.runWins[winnerId]=(tournament.runWins[winnerId]||0)+1;advanceTournament();renderTournament()}
  async function playTournamentMatch(matchId,automatic){if(!tournament||tournament.completed||busy)return false;var m=tourneyMatch(matchId);if(!m||m.status!=='pending')return false;var token=tournament.id+':'+m.id,prior=careerData.appliedResults[token];if(prior){settleTournamentResult(m,prior.winnerId);return true}m.status='playing';tournament.currentMatchId=m.id;gameMode='tournament';saveTournament();renderTournament();setLocked(true);
    try{for(var i=0;i<2;i++){var id=i===0?m.a:m.b,r=careerData.fighters[id];F[i]=null;if(!r||!(r.src||r.portrait))throw Error('participant image');await load(i,r.src||r.portrait,true);if(!F[i])throw Error('participant image');F[i].careerId=id;F[i].name=r.name;F[i].type=r.type||F[i].type;F[i].stats=Object.assign({},r.stats||F[i].stats);F[i].hp=F[i].stats.hp;F[i].gauge=0;F[i].portrait=r.portrait||F[i].portrait;paint(i)}tournamentAutoRunning=!!automatic;await fight();tournamentAutoRunning=false;return m.status==='done'}catch(e){tournamentAutoRunning=false;m.status='pending';tournament.currentMatchId='';saveTournament();renderTournament();$('#tournament-notice').textContent='N\u00e3o foi poss\u00edvel carregar um participante; tente novamente.';setLocked(false);return false}
  }
  function sortedHallEntries(){var fighters=Object.keys(careerData.fighters).map(function(id){return careerData.fighters[id]}).filter(function(r){return r&&r.id}),prior=careerData.hall||{},entries=[],next={};function sortMetric(a,b,key){return (Number(b[key])||0)-(Number(a[key])||0)||(Number(b.wins)||0)-(Number(a.wins)||0)||((prior[a.id]&&prior[a.id].enteredAt)||0)-((prior[b.id]&&prior[b.id].enteredAt)||0)}function addSlot(slot,reason,candidates){var fighter=candidates.find(function(r){return !entries.some(function(x){return x.r.id===r.id})});if(!fighter)return;var old=prior[fighter.id],hall={fighterId:fighter.id,slot:slot,enteredAt:old&&old.slot===slot?old.enteredAt:Date.now(),reason:reason};next[fighter.id]=hall;entries.push({hall:hall,r:fighter,slot:slot})}var champions=fighters.filter(function(r){return (Number(r.tournamentTitles)||0)>0}).sort(function(a,b){return sortMetric(a,b,'tournamentTitles')});addSlot('titles','Maior n\u00famero de torneios vencidos',champions);var fame=fighters.filter(function(r){return !(Number(r.tournamentTitles)>0)&&(Number(sessionFame[r.id])||0)>=3000}).sort(function(a,b){return (Number(sessionFame[b.id])||0)-(Number(sessionFame[a.id])||0)||(Number(b.wins)||0)-(Number(a.wins)||0)||((prior[a.id]&&prior[a.id].enteredAt)||0)-((prior[b.id]&&prior[b.id].enteredAt)||0)});addSlot('fame','Maior fama na sess\u00e3o',fame);var wins=fighters.filter(function(r){return !(Number(r.tournamentTitles)>0)&&(Number(r.wins)||0)>=10}).sort(function(a,b){return sortMetric(a,b,'wins')});addSlot('wins','Maior n\u00famero de vit\u00f3rias',wins);if(JSON.stringify(prior)!==JSON.stringify(next)){careerData.hall=next;persistCareer()}return entries}
  function renderHall(){var el=$('#hall-list');if(!el)return;var entries=sortedHallEntries();el.innerHTML=entries.length?entries.map(function(x,i){var r=x.r,metric=x.slot==='titles'?'Torneios vencidos: '+(r.tournamentTitles||0):x.slot==='fame'?'Fama nesta sess\u00e3o: '+(Number(sessionFame[r.id])||0):'Vit\u00f3rias: '+(r.wins||0);return '<article class="hall-card"><div class="hall-rank">#'+(i+1)+' - '+escapeRank(x.hall.reason)+'</div><img src="'+escapeRank(r.portrait||r.src)+'" alt="'+escapeRank(r.name)+'"><h3>'+escapeRank(r.name)+'</h3><p>'+metric+'</p><p>Vit\u00f3rias: '+(r.wins||0)+'</p><p>Torneios vencidos: '+(r.tournamentTitles||0)+'</p><p>N\u00edvel '+(r.level||1)+'</p><p>Entrada: '+gameDate(x.hall.enteredAt).toLocaleDateString('pt-BR')+'</p></article>'}).join(''):'<div class="feature-empty">O Hall da Fama est\u00e1 aguardando seus primeiros grandes feitos.</div>'}
  function updateModeControls() {
    var surv=gameMode==='survival';
    if(gameMode!=='normal'&&twoByTwoEnabled){twoByTwoEnabled=false;$('#arena').classList.remove('mode-2x2');$('#card2').hidden=true;$('#card3').hidden=true;$('#two-by-two-toggle').textContent='2x2: Desativado';$('#two-by-two-toggle').setAttribute('aria-pressed','false')}
    document.body.classList.toggle('survival-mode',surv);
    $('#bot-upload-wrap').hidden=!surv||survival.active;
    $('#bot-status').hidden=!surv||survival.active;
    $('#sampleBtn').hidden=surv;
    $('#fightBtn').hidden=surv&&(!survival.active||survival.awaitingArena||survival.ended);
    $('#sampleBtn').textContent=surv?'Sortear advers\u00e1rio':twoByTwoEnabled?'Sortear 4 lutadores':'Sortear exemplos';
    $('#fightBtn').textContent=surv?'Combater':'Lutar';
    $('#two-by-two-toggle').hidden=gameMode!=='normal';
    if(gameMode==='normal')$('#fightBtn').textContent=twoByTwoEnabled?'Batalhar 2x2':'Lutar';
    $('#toolbar-mode').textContent=surv?'SOBREVIV\u00caNCIA':gameMode==='tournament'?'TORNEIO DAS ARTES':'NORMAL';
    if(surv&&!survival.active)$('#bot-status').textContent='Escolha a imagem do seu lutador para iniciar a jornada.';
    setLocked($('#arena').classList.contains('locked'));renderEvolution();renderSurvivalMessage();
  }
  function clearFighterDisplay(i, message) {
    var el = cardEl(i);
    q(el, 'frame').classList.remove('scanning', 'dragover', 'win', 'ko', 'act', 'hurt');
    q(el, 'img').src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    q(el, 'img').alt = '';
    q(el, 'type').textContent = '...';
    q(el, 'name').textContent = message;
    q(el, 'title').textContent = '';
    q(el, 'sample').hidden = true;
    q(el, 'stats').innerHTML = '';
    q(el, 'hpnum').textContent = '0 / 0';
    q(el, 'hpbar').firstElementChild.style.width = '0%';
    q(el, 'gauge').firstElementChild.style.width = '0%';
    q(el, 'read').innerHTML = '';
  }
  function endSurvivalRun(){
    ['arenaPixelsSurvivalImage','arenaPixelsSurvivalStyle','arenaPixelsSurvivalSeed','arenaPixelsSurvivalProgress','arenaPixelsSurvivalEvolution'].forEach(function(k){sessionStorage.removeItem(k)});
    survival={active:false,imageKey:'',defeated:0,arenas:0,mini:0,bosses:0,streak:0,level:1,xp:0,damage:0,enemyClass:'normal',arena:1,encounter:1,awaitingArena:false,ended:false,bossStartHp:0};F[0]=null;F[1]=null;evolutionApplied=false;survivalImageLocked=false;
    $('#arena').classList.remove('survival-image-locked','survival-boss','survival-mini');$('#battle-stage').classList.remove('survival-boss','survival-mini');clearFighterDisplay(0,'Escolha um lutador');clearFighterDisplay(1,'Advers\u00e1rio');updateModeControls();
  }
  $('#survival-continue').addEventListener('click',function(){survival.awaitingArena=false;saveSurvival();spawnSurvivalOpponent();renderSurvivalMessage();updateModeControls()});
  $('#survival-end').addEventListener('click',endSurvivalRun);
  document.querySelectorAll('[data-feature-back]').forEach(function(button){button.addEventListener('click',function(){$('#tournament-screen').hidden=true;if(mainFightersBeforeTournament){F[0]=mainFightersBeforeTournament[0];F[1]=mainFightersBeforeTournament[1];mainFightersBeforeTournament=null;if(F[0])paint(0);if(F[1])paint(1);gameMode=modeBeforeTournament==='tournament'?'normal':modeBeforeTournament}updateModeControls();setLocked(false)})});
  $('#tournament-select-all').addEventListener('change',function(){document.querySelectorAll('[data-tour-pick]').forEach(function(input){input.checked=this.checked}.bind(this));$('#tournament-notice').textContent=this.checked?'Todos os lutadores dispon\u00edveis foram selecionados.':''});
  $('#tournament-roster').addEventListener('change',function(event){if(event.target.matches('[data-tour-pick]'))$('#tournament-select-all').checked=[].every.call(document.querySelectorAll('[data-tour-pick]'),function(x){return x.checked})});
  $('#tournament-create').addEventListener('click',createTournament);
  $('#tournament-new').addEventListener('click',function(){tournament=null;careerData.activeTournament=null;persistCareer();$('#tournament-notice').textContent='';$('#tournament-select-all').checked=false;renderTournamentRoster();renderTournament()});
  $('#tournament-next-pairings').addEventListener('click',function(event){var button=event.target.closest('[data-tournament-play]');if(button)playTournamentMatch(button.getAttribute('data-tournament-play'),false)});
  $('#tournament-bracket').addEventListener('click',function(event){var tab=event.target.closest('[data-tournament-round]');if(!tab)return;var index=tab.getAttribute('data-tournament-round');$('#tournament-bracket').querySelectorAll('.tournament-round-tab').forEach(function(button){var active=button===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false')});$('#tournament-bracket').querySelectorAll('.tournament-round-panel').forEach(function(panel){var active=panel.getAttribute('data-tournament-panel')===index;panel.hidden=!active;panel.classList.toggle('active',active)})});
  $('#tournament-speed').addEventListener('click',function(){tournamentSpeed=tournamentSpeed===1?2:1;this.textContent='Velocidade '+tournamentSpeed+'x';this.setAttribute('aria-pressed',tournamentSpeed===2?'true':'false')});
  $('#tournament-advance').addEventListener('click',advanceTournamentRoundAutomatically);
  $('#open-modes').addEventListener('click', openModes);
  $('#modes-close').addEventListener('click', closeModes);
  $('#mode-normal').addEventListener('click', function () { if(survival.active){survivalToast('Encerre a jornada antes de trocar de modo.');return;} gameMode = 'normal'; closeModes(); updateModeControls(); });
  $('#mode-survival').addEventListener('click',function(){gameMode='survival';closeModes();updateModeControls();});
  $('#mode-tournament').addEventListener('click',function(){closeModes();showFeatureScreen('tournament')});
  $('#mode-world').addEventListener('click',function(){stopBackgroundMusic();closeModes();document.getElementById('world-screen').hidden=false;document.body.classList.add('world-open')});
  document.addEventListener('mousemove', function (event) {
    if (event.clientX <= 18 && !rankSidebar.classList.contains('open')) rankEdge.classList.add('visible');
    else if (event.clientX > 70) rankEdge.classList.remove('visible');
  });
  rankEdge.addEventListener('click', openRanking);
  $('#rank-mobile').addEventListener('click', openRanking);
  $('#rank-close').addEventListener('click', closeRanking);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') { closeRanking(); closeModes(); } });
  document.querySelectorAll('.more-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var panelName = this.getAttribute('data-panel');
      document.querySelectorAll('.more-tab').forEach(function (other) {
        var active = other === tab;
        other.classList.toggle('active', active);
        other.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('.more-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.getAttribute('data-panel-content') === panelName);
      });
      renderMorePanels();
      if(panelName==='hall')renderHall();
    });
  });
  document.querySelectorAll('.rank-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      rankCategory = this.getAttribute('data-rank');
      document.querySelectorAll('.rank-tab').forEach(function (other) { other.classList.toggle('active', other === tab); other.setAttribute('aria-selected', other === tab ? 'true' : 'false'); });
      renderRanking();
    });
  });
  renderRanking();
  updateModeControls();

  var savedRun=null;try{savedRun=JSON.parse(sessionStorage.getItem('arenaPixelsSurvivalProgress')||'null')}catch(e){}
  var savedImage=sessionStorage.getItem('arenaPixelsSurvivalImage');
  if(savedRun&&savedImage&&savedRun.active){survival=Object.assign(survival,savedRun);gameMode='survival';updateModeControls();restoreSurvival(savedImage).catch(function(){gameMode='normal';survival.active=false;loadSamples('spiky',7,'rings',3);updateModeControls()});}
  else loadSamples('spiky',7,'rings',3);
})();

;

(function(){var intro=document.getElementById("spect-intro");if(!intro)return;window.setTimeout(function(){intro.classList.add("leaving");window.setTimeout(function(){intro.remove();},700);},2200);})();

;

(function(){
  var screen=document.getElementById('world-screen');if(!screen)return;
  var canvas=document.getElementById('world-canvas');
  var fallback=document.getElementById('world-webgl-fallback');
  var nameInput=document.getElementById('world-name-input');
  var nameLabel=document.getElementById('world-avatar-name');
  var imageInput=document.getElementById('world-image-input');
  var soundInput=document.getElementById('world-generate-voice');
  var audio=document.getElementById('world-audio-preview');
  var play=document.getElementById('world-sound-play');
  var gl=null,program=null,texture=null,meshes={},running=false,imageUrl='',soundUrl='',voiceSeed=Math.floor(Math.random()*0x7fffffff);window.SPECT_PLAYER_VOICE_SEED=voiceSeed;
  var look={hat:'helmet',boots:'armor'};
  var uniforms={},attributes={};
  function shader(type,source){var item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(item));return item}
  function makeProgram(){var vertex='attribute vec3 aPosition;attribute vec3 aNormal;attribute vec2 aUV;uniform mat4 uMvp;uniform mat4 uModel;varying vec3 vNormal;varying vec2 vUV;void main(){gl_Position=uMvp*vec4(aPosition,1.0);vNormal=normalize((uModel*vec4(aNormal,0.0)).xyz);vUV=aUV;}';var fragment='precision mediump float;uniform vec4 uColor;uniform bool uUseTexture;uniform sampler2D uTexture;varying vec3 vNormal;varying vec2 vUV;void main(){vec4 base=uColor;if(uUseTexture){base=texture2D(uTexture,vUV);base.rgb*=uColor.rgb;}vec3 lightDir=normalize(vec3(-0.42,0.78,0.56));float light=0.39+0.61*max(dot(normalize(vNormal),lightDir),0.0);gl_FragColor=vec4(base.rgb*light,base.a);}';program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);attributes.position=gl.getAttribLocation(program,'aPosition');attributes.normal=gl.getAttribLocation(program,'aNormal');attributes.uv=gl.getAttribLocation(program,'aUV');uniforms.mvp=gl.getUniformLocation(program,'uMvp');uniforms.model=gl.getUniformLocation(program,'uModel');uniforms.color=gl.getUniformLocation(program,'uColor');uniforms.useTexture=gl.getUniformLocation(program,'uUseTexture');uniforms.texture=gl.getUniformLocation(program,'uTexture')}
  function cubeData(){var positions=[],normals=[],uvs=[];var faces=[[[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5],[0,0,1]], [[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5],[0,0,-1]], [[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5],[1,0,0]], [[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5],[-1,0,0]], [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5],[0,1,0]], [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5],[0,-1,0]]];var order=[0,1,2,0,2,3],uv=[[0,0],[0,1],[1,1],[1,0]];faces.forEach(function(face){order.forEach(function(idx){positions.push(face[idx][0],face[idx][1],face[idx][2]);normals.push(face[4][0],face[4][1],face[4][2]);uvs.push(uv[idx][0],uv[idx][1])})});return {p:positions,n:normals,u:uvs}}
  function sphereData(){var p=[],n=[],u=[],lat=14,lon=20;function point(a,b){var theta=a*Math.PI/lat,phi=b*2*Math.PI/lon,x=Math.sin(theta)*Math.cos(phi),y=Math.cos(theta),z=Math.sin(theta)*Math.sin(phi);return [x,y,z,b/lon,1-a/lat]}for(var i=0;i<lat;i++)for(var j=0;j<lon;j++){var q=[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)];[0,1,2,0,2,3].forEach(function(k){var v=q[k];p.push(v[0]*.5,v[1]*.5,v[2]*.5);n.push(v[0],v[1],v[2]);u.push(v[3],v[4])})}return {p:p,n:n,u:u}}
  function cylinderData(top,bottom,segments){var p=[],n=[],u=[];for(var i=0;i<segments;i++){var a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;var v=[[Math.cos(a)*bottom,-.5,Math.sin(a)*bottom],[Math.cos(a)*top,.5,Math.sin(a)*top],[Math.cos(b)*top,.5,Math.sin(b)*top],[Math.cos(b)*bottom,-.5,Math.sin(b)*bottom]];var uv=[[i/segments,0],[i/segments,1],[(i+1)/segments,1],[(i+1)/segments,0]];[0,1,2,0,2,3].forEach(function(k){var q=v[k],t=uv[k];p.push(q[0],q[1],q[2]);n.push(Math.cos((a+b)/2),0,Math.sin((a+b)/2));u.push(t[0],t[1])});p.push(0,-.5,0,Math.cos(a)*bottom,-.5,Math.sin(a)*bottom,Math.cos(b)*bottom,-.5,Math.sin(b)*bottom);n.push(0,-1,0,0,-1,0,0,-1,0);u.push(.5,.5,.5+Math.cos(a)*bottom,.5+Math.sin(a)*bottom,.5+Math.cos(b)*bottom,.5+Math.sin(b)*bottom);p.push(0,.5,0,Math.cos(b)*top,.5,Math.sin(b)*top,Math.cos(a)*top,.5,Math.sin(a)*top);n.push(0,1,0,0,1,0,0,1,0);u.push(.5,.5,.5+Math.cos(b)*top,.5+Math.sin(b)*top,.5+Math.cos(a)*top,.5+Math.sin(a)*top)}return {p:p,n:n,u:u}}
  function geometry(data){var buffer=gl.createBuffer(),interleaved=new Float32Array(data.p.length/3*8);for(var i=0,j=0;i<data.p.length/3;i++){interleaved[j++]=data.p[i*3];interleaved[j++]=data.p[i*3+1];interleaved[j++]=data.p[i*3+2];interleaved[j++]=data.n[i*3];interleaved[j++]=data.n[i*3+1];interleaved[j++]=data.n[i*3+2];interleaved[j++]=data.u[i*2];interleaved[j++]=data.u[i*2+1]}gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,interleaved,gl.STATIC_DRAW);return {buffer:buffer,count:data.p.length/3}}
  function mul(a,b){var o=new Float32Array(16);for(var c=0;c<4;c++)for(var r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o}
  function translate(x,y,z){var m=new Float32Array(16);m[0]=m[5]=m[10]=m[15]=1;m[12]=x;m[13]=y;m[14]=z;return m}
  function scale(x,y,z){var m=new Float32Array(16);m[0]=x;m[5]=y;m[10]=z;m[15]=1;return m}
  function rotateY(a){var c=Math.cos(a),s=Math.sin(a),m=new Float32Array(16);m[0]=c;m[2]=-s;m[5]=1;m[8]=s;m[10]=c;m[15]=1;return m}
  function perspective(fov,aspect,near,far){var f=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m}
  function normalize(v){var l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1;return [v[0]/l,v[1]/l,v[2]/l]}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
  function lookAt(eye,target,up){var z=normalize([eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]]),x=normalize(cross(up,z)),y=cross(z,x),m=new Float32Array(16);m[0]=x[0];m[1]=y[0];m[2]=z[0];m[4]=x[1];m[5]=y[1];m[6]=z[1];m[8]=x[2];m[9]=y[2];m[10]=z[2];m[12]=-dot(x,eye);m[13]=-dot(y,eye);m[14]=-dot(z,eye);m[15]=1;return m}
  function makeTexture(source){gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)}
  function defaultTexture(){var c=document.createElement('canvas');c.width=512;c.height=512;var x=c.getContext('2d'),g=x.createLinearGradient(0,0,512,512);g.addColorStop(0,'#35cde9');g.addColorStop(.46,'#30215d');g.addColorStop(1,'#151b38');x.fillStyle=g;x.fillRect(0,0,512,512);x.strokeStyle='rgba(183,224,255,.12)';x.lineWidth=2;for(var i=0;i<=512;i+=32){x.beginPath();x.moveTo(i,0);x.lineTo(i,512);x.stroke();x.beginPath();x.moveTo(0,i);x.lineTo(512,i);x.stroke()}x.fillStyle='rgba(7,12,26,.7)';x.fillRect(52,146,408,220);x.strokeStyle='#8af2ff';x.lineWidth=5;x.strokeRect(52,146,408,220);x.fillStyle='#e7d7ff';x.textAlign='center';x.font='bold 82px sans-serif';x.fillText('SPECT',256,280);x.font='600 20px sans-serif';x.fillStyle='#83eaff';x.fillText('WORLD FIGHTER',256,326);return c}
  function setupGL(){if(!canvas||!fallback)return false;try{gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false})}catch(e){}if(!gl){fallback.hidden=false;canvas.hidden=true;return false}try{makeProgram();meshes.cube=geometry(cubeData());meshes.sphere=geometry(sphereData());meshes.cap=geometry(cylinderData(.5,.5,24));meshes.crown=geometry(cylinderData(.34,.5,24));meshes.cone=geometry(cylinderData(0,.5,16));texture=gl.createTexture();makeTexture(defaultTexture());gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);return true}catch(e){if(fallback)fallback.hidden=false;if(canvas)canvas.hidden=true;return false}}
  function resize(){if(!gl||screen.hidden)return;var rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;var dpr=Math.min(window.devicePixelRatio||1,1.6),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}}
  function part(mesh,pos,size,color,textured,angle){var c=Math.cos(angle),s=Math.sin(angle),x=c*pos[0]+s*pos[2],z=-s*pos[0]+c*pos[2],model=mul(mul(translate(x,pos[1],z),rotateY(angle)),scale(size[0],size[1],size[2])),view=lookAt([0,2.65,7.2],[0,1.48,0],[0,1,0]),proj=perspective(Math.PI/4,canvas.width/canvas.height,.1,40),mvp=mul(mul(proj,view),model);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.enableVertexAttribArray(attributes.position);gl.vertexAttribPointer(attributes.position,3,gl.FLOAT,false,32,0);gl.enableVertexAttribArray(attributes.normal);gl.vertexAttribPointer(attributes.normal,3,gl.FLOAT,false,32,12);gl.enableVertexAttribArray(attributes.uv);gl.vertexAttribPointer(attributes.uv,2,gl.FLOAT,false,32,24);gl.uniformMatrix4fv(uniforms.model,false,model);gl.uniformMatrix4fv(uniforms.mvp,false,mvp);gl.uniform4fv(uniforms.color,color);gl.uniform1i(uniforms.useTexture,textured?1:0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniforms.texture,0);gl.drawArrays(gl.TRIANGLES,0,mesh.count)}
  function render(time){if(!gl)return;resize();if(!canvas.width||!canvas.height)return;gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);var t=time*.001,turn=Math.sin(t*.36)*.36+t*.12,bob=Math.sin(t*2.1)*.035;part(meshes.cap,[0,-.12,0],[2.65,.16,2.65],[.12,.26,.42,1],false,turn);part(meshes.cap,[0,-.025,0],[2.32,.035,2.32],[.22,.76,.91,1],false,turn);part(meshes.cube,[0,1.86+bob,0],[1.72,1.72,1.72],[1,1,1,1],true,turn);var legColor=look.boots==='boot'?[.42,.28,.2,1]:look.boots==='sneaker'?[.14,.34,.34,1]:[.19,.23,.39,1],bootColor=look.boots==='boot'?[.68,.4,.22,1]:look.boots==='sneaker'?[.2,.72,.62,1]:[.54,.63,.86,1];[-.44,.44].forEach(function(x){part(meshes.cube,[x,.53+bob,0],[.36,.96,.42],legColor,false,turn);part(meshes.cube,[x,.17+bob,.16],[.5,.28,.72],bootColor,false,turn);if(look.boots==='armor'){part(meshes.cube,[x,.53+bob,.228],[.27,.55,.055],[.32,.8,.98,1],false,turn);part(meshes.cube,[x,.82+bob,.23],[.34,.1,.06],[.77,.79,.98,1],false,turn)}else if(look.boots==='sneaker'){part(meshes.cube,[x,.12+bob,.51],[.36,.045,.035],[.83,.98,.94,1],false,turn)}else{part(meshes.cube,[x,.35+bob,.23],[.4,.13,.05],[.84,.61,.38,1],false,turn)}});if(look.hat==='cap'){part(meshes.cube,[0,2.75+bob,.1],[1.28,.12,.98],[.12,.76,.91,1],false,turn);part(meshes.sphere,[0,2.84+bob,0],[.92,.44,.84],[.3,.19,.65,1],false,turn)}else if(look.hat==='helmet'){part(meshes.sphere,[0,2.82+bob,0],[1.04,.46,.96],[.57,.66,.86,1],false,turn);part(meshes.cube,[0,2.72+bob,.45],[1.02,.15,.15],[.17,.84,.97,1],false,turn);part(meshes.cube,[0,2.91+bob,.48],[.25,.15,.06],[.78,.94,1,1],false,turn)}else if(look.hat==='crown'){part(meshes.crown,[0,2.83+bob,0],[1.05,.34,.95],[.98,.68,.18,1],false,turn);[[-.36,0],[0,0],[.36,0],[-.18,.28],[.18,.28]].forEach(function(p){part(meshes.cone,[p[0],3.06+bob,p[1]],[.24,.35,.24],[1,.78,.25,1],false,turn)});part(meshes.cap,[0,2.77+bob,0],[1,.09,.9],[.94,.36,.12,1],false,turn)}}
  function start(){if(screen.hidden||running||!gl)return;running=true;function frame(t){if(screen.hidden){running=false;return}render(t);requestAnimationFrame(frame)}requestAnimationFrame(frame)}
  function uploadImage(file){if(!file||!gl)return;if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=URL.createObjectURL(file);var image=new Image();image.onload=function(){makeTexture(image)};image.onerror=function(){fallback.hidden=false;fallback.textContent='Não foi possível abrir esta imagem.'};image.src=imageUrl}
  if(canvas&&fallback&&setupGL()){window.addEventListener('resize',resize);canvas.addEventListener('webglcontextlost',function(event){event.preventDefault();running=false;fallback.hidden=false;fallback.textContent='A visualização 3D foi interrompida pelo navegador.'})}
  document.querySelectorAll('[data-world-choice]').forEach(function(group){group.addEventListener('click',function(event){var button=event.target.closest('button[data-value]');if(!button)return;group.querySelectorAll('button').forEach(function(item){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',item===button?'true':'false')});look[group.getAttribute('data-world-choice')]=button.getAttribute('data-value')})});
  document.querySelectorAll('[data-world-choice="hat"] button').forEach(function(button){button.classList.toggle('selected',button.getAttribute('data-value')==='helmet');button.setAttribute('aria-pressed',button.getAttribute('data-value')==='helmet'?'true':'false')});
  document.querySelectorAll('[data-world-choice="boots"] button').forEach(function(button){button.classList.toggle('selected',button.getAttribute('data-value')==='armor');button.setAttribute('aria-pressed',button.getAttribute('data-value')==='armor'?'true':'false')});
  nameInput.addEventListener('input',function(){var value=nameInput.value.trim();nameLabel.textContent=(value||'LUTADOR DO MUNDO').toLocaleUpperCase('pt-BR')});
  imageInput.addEventListener('change',function(){uploadImage(imageInput.files&&imageInput.files[0])});
  function speechWav(samples,sampleRate){var buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);function writeText(offset,text){for(var i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))}writeText(0,'RIFF');view.setUint32(4,36+samples.length*2,true);writeText(8,'WAVE');writeText(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);writeText(36,'data');view.setUint32(40,samples.length*2,true);for(var i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*32767,true);return new Blob([buffer],{type:'audio/wav'})}
  soundInput.addEventListener('click',function(){voiceSeed=Math.floor(Math.random()*0x7fffffff);window.SPECT_PLAYER_VOICE_SEED=voiceSeed;soundInput.disabled=true;soundInput.textContent='GERANDO VOZ...';play.disabled=true;var file=imageInput.files&&imageInput.files[0],generated=file&&window.SPECT_CREATE_IMAGE_SPEECH?window.SPECT_CREATE_IMAGE_SPEECH(file,1,voiceSeed):Promise.resolve(window.SPECT_CREATE_SPEECH(voiceSeed,1));generated.then(function(voice){if(soundUrl)URL.revokeObjectURL(soundUrl);soundUrl=URL.createObjectURL(speechWav(voice.samples,voice.sampleRate));audio.src=soundUrl;play.disabled=false;play.textContent='▶ Ouvir voz';soundInput.textContent='GERAR OUTRA VOZ'}).catch(function(error){console.warn('Não foi possível gerar a voz:',error);soundInput.textContent='TENTAR DE NOVO'}).finally(function(){soundInput.disabled=false})});
  play.addEventListener('click',function(){if(!audio.src)return;if(audio.paused){audio.play().then(function(){play.textContent='Ⅱ Parar som'}).catch(function(){play.textContent='Não foi possível reproduzir'})}else{audio.pause();audio.currentTime=0;play.textContent='▶ Ouvir som'}});audio.addEventListener('ended',function(){play.textContent='▶ Ouvir som'});
  document.getElementById('world-volume-input').addEventListener('input',function(){audio.volume=Number(this.value)/100});audio.volume=.5;
  function closeWorld(){screen.hidden=true;screen.setAttribute('aria-hidden','true');document.body.classList.remove('world-open');audio.pause();audio.currentTime=0;if(soundUrl){URL.revokeObjectURL(soundUrl);soundUrl=''}audio.removeAttribute('src');audio.load();play.disabled=true;play.textContent='Ouvir som';soundInput.textContent='GERAR OUTRA VOZ';startBackgroundMusic()}
  document.getElementById('world-back').addEventListener('click',closeWorld);document.addEventListener('keydown',function(event){if(event.key==='Escape'&&!screen.hidden)closeWorld()});
  var opener=document.getElementById('mode-world');if(opener)opener.addEventListener('click',function(){screen.setAttribute('aria-hidden','false');start()});
})();;
