const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;

// Hanya file game yang boleh diakses publik
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/three.min.js': 'three.min.js' };
const srv = http.createServer((q, r) => {
  const f = FILES[q.url.split('?')[0]];
  if (!f) { r.writeHead(404); return r.end('404'); }
  fs.readFile(path.join(__dirname, f), (e, d) => {
    if (e) { r.writeHead(404); return r.end('404'); }
    r.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' });
    r.end(d);
  });
});

const wss = new WebSocketServer({ server: srv, maxPayload: 4096 });
const rooms = new Map(); // kode -> {seed, diff, p: Map(id -> ws)}
let nid = 1;

const bc = (R, from, msg) => {
  const s = JSON.stringify(msg);
  R.p.forEach(w => { if (w !== from && w.readyState === 1) w.send(s); });
};

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => ws.alive = true);

  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }

    if (d.t === 'j' && !ws.room) {
      const code = String(d.room || '').slice(0, 12).toUpperCase();
      if (!code) return;
      let R = rooms.get(code);
      if (!R) { R = { seed: (Math.random() * 1e9) | 0, diff: 1, p: new Map() }; rooms.set(code, R); }
      if (R.p.size >= 8) return ws.send(JSON.stringify({ t: 'e', m: 'Room penuh (maks 8)' }));
      const a = d.acc || {};
      ws.id = nid++; ws.room = code;
      ws.info = {
        id: ws.id,
        name: String(d.name || 'Pemain').slice(0, 14),
        av: /^#[0-9a-f]{3,6}$/i.test(d.av) ? d.av : '#e0902f',
        acc: { hat: !!a.hat, glass: !!a.glass, mask: !!a.mask }
      };
      ws.send(JSON.stringify({ t: 'w', id: ws.id, room: code, seed: R.seed, diff: R.diff, pl: [...R.p.values()].map(w => w.info) }));
      bc(R, ws, { t: '+', ...ws.info });
      R.p.set(ws.id, ws);
    }
    else if (d.t === 's' && ws.room) {
      const R = rooms.get(ws.room), s = d.s || {}, o = {};
      for (const k of ['x', 'y', 'z', 'r', 'vx', 'vz', 'vr', 'd']) {
        const v = +s[k];
        if (!isFinite(v)) return;
        o[k] = v;
      }
      bc(R, ws, { t: 's', id: ws.id, s: o });
    }
  });

  ws.on('close', () => {
    const R = ws.room && rooms.get(ws.room);
    if (!R) return;
    R.p.delete(ws.id);
    bc(R, ws, { t: '-', id: ws.id });
    if (!R.p.size) rooms.delete(ws.room);
  });
});

// Jaga koneksi tetap hidup & buang yang mati
setInterval(() => {
  wss.clients.forEach(w => {
    if (!w.alive) return w.terminate();
    w.alive = false; w.ping();
  });
}, 30000);

srv.listen(PORT, () => console.log('Server jalan di port ' + PORT));
