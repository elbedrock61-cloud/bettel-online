// Server publik Bettel Elemen Arena: akun, antrean (rank & 1 vs 1), ruang pertandingan, relay pesan.
// Story TIDAK lewat server ini (individu per akun): server hanya menyimpan nomor chapter per akun.
// Jalankan:  npm install  &&  node server.js     (PORT=8080 secara bawaan). Letakkan bettel_v127.html di folder yang sama.
const { WebSocketServer } = require('ws');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const FILE = process.env.DB || 'accounts.json';
const NEED = { rank: 4, duel: 2 };          // pemain per ruang
const RANK_WAIT = 15000;                    // rank: mulai 15 dtk setelah ada >=2 pemain (atau langsung bila penuh)

let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(FILE, JSON.stringify(db), () => {}); } }, 5000);

// HTTP: menyajikan game (bettel_v127.html) di alamat yang sama dengan server, jadi cukup satu perintah.
const GAME = process.env.GAME || 'bettel_v127.html';
const http = require('http');
const path = require('path');
const httpServer = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/' || u === '/index.html' || u === '/' + GAME) {
    fs.readFile(path.join(__dirname, GAME), (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('File game tidak ditemukan: ' + GAME); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (u === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Tidak ditemukan');
  }
});
const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });
httpServer.listen(PORT);
const queues = { rank: [], duel: [] };
const timers = { rank: null, duel: null };
const deadline = { rank: 0, duel: 0 };
const rooms = new Map();
let roomSeq = 0;

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
// ===== AKUN: nama akun unik + kata sandi (di-hash scrypt + salt). Sesi perangkat pakai id+token; tanpa sandi tidak bisa masuk di perangkat baru =====
const userName = n => String(n || '').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 14);
const hashPw = (p, salt) => crypto.scryptSync(String(p), salt, 32).toString('hex');
const okPw = (a, p) => { try { return !!a.salt && crypto.timingSafeEqual(Buffer.from(hashPw(p, a.salt), 'hex'), Buffer.from(a.hash, 'hex')); } catch (e) { return false; } };
const byUser = u => Object.values(db).find(a => a.user === u);
const checkCred = (name, pass) => {
  if (name.length < 3) return 'Nama akun minimal 3 karakter (huruf, angka, _ . -)';
  if (typeof pass !== 'string' || pass.length < 6) return 'Kata sandi minimal 6 karakter';
  if (pass.length > 40) return 'Kata sandi maksimal 40 karakter';
  return '';
};
const setPw = (a, pass) => { a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(pass, a.salt); dirty = true; };
const getGender = g => (g === 'cowok' || g === 'cewek') ? g : '';
const welcome = (ws, a) => send(ws, { t: 'welcome', id: a.id, token: a.token, name: a.name, gender: a.gender || '', ch: a.ch || 0, sec: a.user ? 1 : 0, online: wss.clients.size });
const authErr = (ws, msg) => { ws.tries = (ws.tries || 0) + 1; setTimeout(() => { send(ws, { t: 'autherr', m: msg }); if (ws.tries >= 8) ws.close(); }, 500); };
const clean = s => String(s || 'Pemain').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Pemain';

function broadcastOnline() { for (const c of wss.clients) send(c, { t: 'online', n: wss.clients.size }); }

function qUpdate(mode) {
  const q = queues[mode];
  const left = timers[mode] ? Math.max(0, Math.ceil((deadline[mode] - Date.now()) / 1000)) : 0;
  for (const c of q) send(c, { t: 'queue', mode, n: q.length, need: NEED[mode], left });
}

function startRoom(mode, group, opt = {}) {
  const id = ++roomSeq;
  // tim: solo & lobi teman (Rank) = satu tim melawan bot; antrean acak = bergantian 2 tim (Rank 2 vs 2, Duel 1 vs 1)
  const team = i => (opt.solo || (opt.friends && mode === 'rank')) ? 0 : i % 2;
  const players = group.map((c, i) => ({ slot: i, id: c.acc.id, name: c.acc.name, team: team(i) }));
  rooms.set(id, group);
  group.forEach((c, i) => { c.room = id; c.slot = i; c.mode = null; });
  const seed = crypto.randomInt(1, 2 ** 31 - 1);
  group.forEach((c, i) => send(c, { t: 'match', room: id, mode, seed, you: i, players }));
}

function tryMatch(mode) {
  const q = queues[mode];
  if (q.length >= NEED[mode]) {
    clearTimeout(timers[mode]); timers[mode] = null;
    startRoom(mode, q.splice(0, NEED[mode]));
  } else if (mode === 'rank' && q.length >= 2 && !timers[mode]) {
    deadline[mode] = Date.now() + RANK_WAIT;
    timers[mode] = setTimeout(() => {
      timers[mode] = null;
      const g = queues.rank.splice(0, 4);
      if (g.length >= 2) startRoom('rank', g); else queues.rank.unshift(...g);
      qUpdate('rank');
    }, RANK_WAIT);
  }
  if (mode === 'rank' && q.length < 2 && timers[mode]) { clearTimeout(timers[mode]); timers[mode] = null; }
  qUpdate(mode);
}

function leaveQueue(c) {
  for (const m of Object.keys(queues)) {
    const i = queues[m].indexOf(c);
    if (i >= 0) { queues[m].splice(i, 1); c.mode = null; tryMatch(m); }
  }
}

function leaveRoom(c) {
  if (c.room == null) return;
  const g = rooms.get(c.room);
  if (g) {
    const rest = g.filter(x => x !== c);
    rest.forEach(x => send(x, { t: 'left', slot: c.slot }));
    if (rest.length) rooms.set(c.room, rest); else rooms.delete(c.room);
  }
  c.room = null;
}

// ===== LOBI TEMAN: tiap akun bisa bikin satu room lobi berkode pendek; teman masuk pakai kode; host memulai pertandingan privat =====
const lobbies = new Map();
const LOBBY_MAX = 4;
const LOBBY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let c;
  do { c = Array.from({ length: 5 }, () => LOBBY_CHARS[crypto.randomInt(LOBBY_CHARS.length)]).join(''); } while (lobbies.has(c));
  return c;
};
function lobbyUpdate(l) {
  const members = l.members.map((c, i) => ({ slot: i, name: c.acc.name, host: c === l.host }));
  l.members.forEach((c, i) => send(c, { t: 'lobby', code: l.code, mode: l.mode, you: i, host: c === l.host, members }));
}
function leaveLobby(c) {
  const l = c.lobby;
  if (!l) return;
  c.lobby = null;
  l.members = l.members.filter(x => x !== c);
  if (!l.members.length) { lobbies.delete(l.code); return; }
  if (l.host === c) l.host = l.members[0];
  lobbyUpdate(l);
}

wss.on('connection', ws => {
  ws.alive = true; ws.acc = null; ws.room = null; ws.mode = null; ws.lobby = null; ws.msgs = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (++ws.msgs > 60) return;            // batas ~60 pesan / detik
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {                   // lanjut sesi di perangkat ini (id + token); tanpa token valid -> wajib login
      const a = m.id && db[m.id] && db[m.id].token === m.token ? db[m.id] : null;
      if (!a) return send(ws, { t: 'need_login' });
      ws.acc = a; welcome(ws, a); broadcastOnline();
      return;
    }
    if (m.t === 'register') {
      const name = userName(m.name), bad = checkCred(name, m.pass);
      if (bad) return authErr(ws, bad);
      const gender = getGender(m.gender);
      if (!gender) return authErr(ws, 'Pilih jenis gender: cowok atau cewek');
      if (byUser(name.toLowerCase())) return authErr(ws, 'Nama akun sudah dipakai');
      const id = crypto.randomBytes(4).toString('hex');
      const a = db[id] = { id, token: crypto.randomBytes(16).toString('hex'), name, user: name.toLowerCase(), gender, ch: 0 };
      setPw(a, m.pass); ws.acc = a; welcome(ws, a); broadcastOnline();
      return;
    }
    if (m.t === 'login') {
      const a = byUser(userName(m.name).toLowerCase());
      if (!a || !okPw(a, m.pass)) return authErr(ws, 'Nama akun atau kata sandi salah');
      ws.acc = a; welcome(ws, a); broadcastOnline();
      return;
    }
    if (m.t === 'claim') {                   // akun lama tanpa sandi: beri nama akun + sandi agar tidak hilang (progres tetap)
      if (!ws.acc || ws.acc.user) return;
      const name = userName(m.name), bad = checkCred(name, m.pass);
      if (bad) return authErr(ws, bad);
      const gender = getGender(m.gender);
      if (!gender) return authErr(ws, 'Pilih jenis gender: cowok atau cewek');
      if (byUser(name.toLowerCase())) return authErr(ws, 'Nama akun sudah dipakai');
      ws.acc.gender = gender; ws.acc.name = name; ws.acc.user = name.toLowerCase(); setPw(ws.acc, m.pass); welcome(ws, ws.acc);
      return;
    }
    if (m.t === 'setgender') {               // akun yang dibuat sebelum ada pilihan gender: lengkapi sekali saja
      if (!ws.acc || !ws.acc.user || ws.acc.gender) return;
      const gender = getGender(m.gender);
      if (!gender) return authErr(ws, 'Pilih jenis gender: cowok atau cewek');
      ws.acc.gender = gender; dirty = true; welcome(ws, ws.acc);
      return;
    }
    if (!ws.acc || !ws.acc.user) return;     // akun belum bersandi tidak boleh bermain online

    if (m.t === 'queue') {
      if (m.mode === 'story') return send(ws, { t: 'err', m: 'Story tidak lewat server publik' });
      if (!NEED[m.mode] || ws.room != null) return;
      leaveQueue(ws); leaveLobby(ws); clearTimeout(ws.soloT);
      if (m.solo) {                       // MAIN SENDIRI: matchmaking cepat, tanpa menunggu pemain lain
        ws.soloT = setTimeout(() => { ws.soloT = null; if (ws.readyState === 1 && ws.room == null) startRoom(m.mode, [ws], { solo: true }); }, 1200);
        return;
      }
      ws.mode = m.mode; queues[m.mode].push(ws); tryMatch(m.mode);
    } else if (m.t === 'cancel') {
      clearTimeout(ws.soloT); ws.soloT = null; leaveQueue(ws); leaveRoom(ws);
    } else if (m.t === 'story') {           // progres Story: per akun, tidak dibagikan ke pemain lain
      const ch = Math.max(0, Math.min(99, m.ch | 0));
      if (ch > (ws.acc.ch || 0)) { ws.acc.ch = ch; dirty = true; }
    } else if (m.t === 'lobby_create') {
      if (ws.room != null || ws.mode) return;
      leaveLobby(ws);
      const l = { code: newCode(), host: ws, mode: 'rank', members: [ws] };
      lobbies.set(l.code, l); ws.lobby = l; lobbyUpdate(l);
    } else if (m.t === 'lobby_join') {
      if (ws.room != null || ws.mode) return;
      const l = lobbies.get(String(m.code || '').toUpperCase().trim());
      if (!l) return send(ws, { t: 'err', m: 'Kode lobi tidak ditemukan' });
      if (l.members.includes(ws)) return lobbyUpdate(l);
      if (l.members.length >= LOBBY_MAX) return send(ws, { t: 'err', m: 'Lobi penuh' });
      leaveLobby(ws);
      l.members.push(ws); ws.lobby = l; lobbyUpdate(l);
    } else if (m.t === 'lobby_leave') {
      leaveLobby(ws); send(ws, { t: 'lobby_closed' });
    } else if (m.t === 'lobby_mode') {
      const l = ws.lobby;
      if (!l || l.host !== ws || !NEED[m.mode]) return;
      l.mode = m.mode; lobbyUpdate(l);
    } else if (m.t === 'lobby_start') {
      const l = ws.lobby;
      if (!l || l.host !== ws) return;
      const n = l.members.length;
      if (l.mode === 'duel' && n !== 2) return send(ws, { t: 'err', m: '1 vs 1 harus tepat 2 pemain' });
      if (l.mode === 'rank' && n < 2) return send(ws, { t: 'err', m: 'Minimal 2 pemain' });
      lobbies.delete(l.code);
      const g = l.members; g.forEach(c => { c.lobby = null; });
      startRoom(l.mode, g, { friends: true });
    } else if (m.t === 'relay' && ws.room != null) {   // teruskan data ke pemain lain di ruang yang sama
      const g = rooms.get(ws.room) || [];
      g.forEach(x => { if (x !== ws) send(x, { t: 'relay', from: ws.slot, d: m.d }); });
    }
  });
  ws.on('close', () => { clearTimeout(ws.soloT); leaveQueue(ws); leaveLobby(ws); leaveRoom(ws); broadcastOnline(); });
  ws.on('error', () => {});
});

setInterval(() => { for (const c of wss.clients) c.msgs = 0; }, 1000);
setInterval(() => { for (const m of Object.keys(queues)) if (queues[m].length) qUpdate(m); }, 1000);
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; c.ping(); }
}, 20000);

console.log('Bettel berjalan: buka http://localhost:' + PORT + '  (game + server publik di port yang sama)');
