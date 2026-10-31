#!/usr/bin/env node
// Benchmark + security smoke test against a running dashboard (default http://127.0.0.1:3100).
//   BENCH_USER=admin BENCH_PASS=... node scripts/bench.mjs [baseUrl]
// Read-only: only GET requests are load-tested; the only POSTs are login attempts from a
// throw-away spoofed client IP (needs TRUST_PROXY=true) and a cross-origin write that must be refused.
const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const { BENCH_USER: user, BENCH_PASS: pass } = process.env;
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const status = async (path, init = {}) => (await fetch(base + path, { redirect: 'manual', ...init })).status;

console.log('== Security probes (unauthenticated) ==');
const variants = ['/api/guests', '/%61pi/guests', '/%41pi/guests', '/api/%67uests', '/api/guests/', '/api/./guests', '/api/guests;x=1', '/api/guests%00', '/api/overview', '/%61pi/overview', '/api/logs/journal', '/%61pi/logs/journal', '/api/nginx/sites', '/%61pi/nginx/sites'];
for (const v of variants) { const s = await fetch(base + v).then((r) => r.status).catch(() => 0); ok(s !== 200, `GET ${v} -> ${s} (must not be 200)`); }
for (const v of ['/api/guests/100/stop', '/%61pi/guests/100/stop', '/%61pi/host/shutdown']) {
  const s = await status(v, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(s === 401 || s === 404, `POST ${v} -> ${s} (must be 401/404)`);
}
const headers = await fetch(base + '/').then((r) => r.headers);
for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) ok(headers.has(h), `response header ${h} present`);
ok(!headers.has('x-powered-by'), 'no x-powered-by header');

console.log('\n== Login spray limiter (spoofed client 203.0.113.77) ==');
let limited = 0;
for (let i = 0; i < 30; i++) {
  const s = await status('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' }, body: JSON.stringify({ username: `nobody${i}`, password: 'x' }) });
  if (s === 429) limited++;
}
ok(limited > 0, `spraying 30 usernames from one IP was throttled (${limited} x 429)`);

if (!user || !pass) { console.log('\nBENCH_USER / BENCH_PASS not set: skipping authenticated tests'); process.exit(failed ? 1 : 0); }
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.5' }, body: JSON.stringify({ username: user, password: pass }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
ok(login.status === 200 && cookie.startsWith('sid='), 'login works');
const auth = (ip) => ({ Cookie: cookie, 'X-Forwarded-For': ip });

console.log('\n== Cross-site write protection ==');
const evil = await status('/api/notify/settings', { method: 'POST', headers: { ...auth('203.0.113.5'), 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
ok(evil === 403, `POST with foreign Origin -> ${evil} (must be 403)`);
const site = await status('/api/notify/settings', { method: 'POST', headers: { ...auth('203.0.113.5'), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' });
ok(site === 403, `POST with Sec-Fetch-Site: cross-site -> ${site} (must be 403)`);
const arr = await status('/api/logs/journal?unit=a&unit=b', { headers: auth('203.0.113.5') });
ok(arr === 400, `duplicate query params rejected cleanly -> ${arr} (must be 400, not 500)`);

console.log('\n== Load ==');
const paths = ['/api/auth/me', '/api/guests', '/api/overview', '/api/guests/100/status', '/api/node'];
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
for (const conc of [1, 10, 50]) {
  const total = conc === 1 ? 60 : 300;
  for (const path of paths) {
    const lat = []; let errs = 0, n = 0;
    const t0 = performance.now();
    await Promise.all(Array.from({ length: conc }, async (_, w) => {
      while (n < total) {
        n++;
        const t = performance.now();
        const s = await fetch(base + path, { headers: auth(`198.51.100.${w + 1}`) }).then(async (r) => { await r.arrayBuffer(); return r.status; }).catch(() => 0);
        lat.push(performance.now() - t);
        if (s >= 500 || s === 0) errs++;
      }
    }));
    lat.sort((a, b) => a - b);
    const secs = (performance.now() - t0) / 1000;
    console.log(`c=${String(conc).padEnd(3)} ${path.padEnd(26)} ${(total / secs).toFixed(0).padStart(6)} rps  p50 ${pct(lat, .5).toFixed(0).padStart(5)}ms  p95 ${pct(lat, .95).toFixed(0).padStart(5)}ms  p99 ${pct(lat, .99).toFixed(0).padStart(5)}ms  errors ${errs}`);
  }
}
console.log('\n== Rate limiter ==');
let throttled = 0;
for (let i = 0; i < 700; i++) if (await status('/api/auth/me', { headers: auth('192.0.2.200') }) === 429) throttled++;
ok(throttled > 0, `700 rapid reads from one IP hit the limiter (${throttled} x 429)`);
process.exit(failed ? 1 : 0);
