// Server publik Bettel Elemen Arena: akun, antrean (rank & 1 vs 1), ruang pertandingan, relay pesan.
// Story TIDAK lewat server ini (individu per akun): server hanya menyimpan nomor chapter per akun.
// Jalankan:  npm install  &&  node server.js     (PORT=8080 secara bawaan). Letakkan bettel_v118.html di folder yang sama.
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

// HTTP: menyajikan game (bettel_v118.html) di alamat yang sama dengan server, jadi cukup satu perintah.
const GAME = process.env.GAME || 'bettel_v118.html';
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
const clean = s => String(s || 'Pemain').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Pemain';

function broadcastOnline() { for (const c of wss.clients) send(c, { t: 'online', n: wss.clients.size }); }

function qUpdate(mode) {
  const q = queues[mode];
  const left = timers[mode] ? Math.max(0, Math.ceil((deadline[mode] - Date.now()) / 1000)) : 0;
  for (const c of q) send(c, { t: 'queue', mode, n: q.length, need: NEED[mode], left });
}

function startRoom(mode, group) {
  const id = ++roomSeq;
  const players = group.map((c, i) => ({ slot: i, id: c.acc.id, name: c.acc.name }));
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

wss.on('connection', ws => {
  ws.alive = true; ws.acc = null; ws.room = null; ws.mode = null; ws.msgs = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (++ws.msgs > 60) return;            // batas ~60 pesan / detik
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      let a = m.id && db[m.id] && db[m.id].token === m.token ? db[m.id] : null;
      if (!a) {
        const id = crypto.randomBytes(4).toString('hex');
        a = db[id] = { id, token: crypto.randomBytes(16).toString('hex'), name: clean(m.name), ch: 0 };
      }
      a.name = clean(m.name); dirty = true;
      ws.acc = a;
      send(ws, { t: 'welcome', id: a.id, token: a.token, name: a.name, ch: a.ch || 0, online: wss.clients.size });
      broadcastOnline();
      return;
    }
    if (!ws.acc) return;

    if (m.t === 'queue') {
      if (m.mode === 'story') return send(ws, { t: 'err', m: 'Story tidak lewat server publik' });
      if (!NEED[m.mode] || ws.room != null) return;
      leaveQueue(ws);
      ws.mode = m.mode; queues[m.mode].push(ws); tryMatch(m.mode);
    } else if (m.t === 'cancel') {
      leaveQueue(ws); leaveRoom(ws);
    } else if (m.t === 'story') {           // progres Story: per akun, tidak dibagikan ke pemain lain
      const ch = Math.max(0, Math.min(99, m.ch | 0));
      if (ch > (ws.acc.ch || 0)) { ws.acc.ch = ch; dirty = true; }
    } else if (m.t === 'relay' && ws.room != null) {   // teruskan data ke pemain lain di ruang yang sama
      const g = rooms.get(ws.room) || [];
      g.forEach(x => { if (x !== ws) send(x, { t: 'relay', from: ws.slot, d: m.d }); });
    }
  });
  ws.on('close', () => { leaveQueue(ws); leaveRoom(ws); broadcastOnline(); });
  ws.on('error', () => {});
});

setInterval(() => { for (const c of wss.clients) c.msgs = 0; }, 1000);
setInterval(() => { for (const m of Object.keys(queues)) if (queues[m].length) qUpdate(m); }, 1000);
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; c.ping(); }
}, 20000);

console.log('Bettel berjalan: buka http://localhost:' + PORT + '  (game + server publik di port yang sama)');
