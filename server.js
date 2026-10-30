/* ModPilot 本地启动器：纯 Node 自带模块 + 可选 mysql2。
   用法：node server.js [端口]（默认 8737，被占用时自动往后找）
   除了发静态文件，还提供：下载页数据库、日志自动读取、游戏/加载器版本列表。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const START_PORT = Number(process.argv[2]) || 8737;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/* ================= 数据库（MySQL） ================= */
const CFG_PATH = path.join(ROOT, 'db.config.json');
const DEFAULT_CFG = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'modpilot'
};
let cfg = Object.assign({}, DEFAULT_CFG);
let pool = null;
let dbReady = false;
let dbError = '没装 mysql2 或还没启动';

if (fs.existsSync(CFG_PATH)) {
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); }
  catch (err) { dbError = 'db.config.json 格式不对：' + err.message; }
} else {
  try { fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CFG, null, 2), 'utf8'); } catch (err) { /* 忽略 */ }
}

/* 站点分类：按链接域名认，认不出的算「作者网站」 */
const SITES = [
  { key: 'afdian', label: '爱发电', host: /(^|\.)(afdian\.(com|net)|ifdian\.net)$/ },
  { key: 'modrinth', label: 'Modrinth', host: /(^|\.)modrinth\.com$/ },
  { key: 'curseforge', label: 'CurseForge', host: /(^|\.)curseforge\.com$/ },
  { key: 'github', label: 'GitHub', host: /(^|\.)github\.com$/ },
  { key: 'gitee', label: 'Gitee', host: /(^|\.)gitee\.com$/ },
  { key: 'planetminecraft', label: 'Planet MC', host: /(^|\.)planetminecraft\.com$/ },
  { key: 'cloud', label: '网盘', host: /(^|\.)(pan\.baidu\.com|yun\.baidu\.com|lanzou[a-z]*\.com|123pan\.com|aliyundrive\.com|alipan\.com|quark\.cn|115\.com|weiyun\.com|mega\.nz|mediafire\.com|dropbox\.com|drive\.google\.com)$/ },
  { key: 'personal', label: '作者网站', host: /^$/ },
  { key: 'other', label: '其他', host: /^$/ }
];

function siteOf(url) {
  let host = '';
  try { host = new URL(String(url || '')).hostname.toLowerCase(); } catch { return 'other'; }
  for (const s of SITES) {
    if (s.host.source !== '(?:)' && s.host.test(host)) return s.key;
  }
  return 'personal';
}

async function initDb() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'mysql2'))) {
    dbError = '没装 mysql2（在项目目录运行 npm install mysql2）';
    return;
  }
  let mysql;
  try { mysql = require('mysql2/promise'); }
  catch (err) { dbError = '加载 mysql2 失败：' + err.message; return; }

  try {
    const boot = await mysql.createConnection({
      host: cfg.host, port: Number(cfg.port) || 3306, user: cfg.user, password: cfg.password || ''
    });
    await boot.query('CREATE DATABASE IF NOT EXISTS `' + String(cfg.database).replace(/`/g, '') +
      '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await boot.end();

    pool = mysql.createPool({
      host: cfg.host, port: Number(cfg.port) || 3306, user: cfg.user, password: cfg.password || '',
      database: cfg.database, waitForConnections: true, connectionLimit: 4, charset: 'utf8mb4'
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mod_id VARCHAR(190) NOT NULL DEFAULT '',
      mod_name VARCHAR(190) NOT NULL DEFAULT '',
      site VARCHAR(32) NOT NULL DEFAULT 'other',
      url VARCHAR(1000) NOT NULL,
      note VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_link (mod_id, url(191)),
      KEY idx_site (site)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    dbReady = true;
    dbError = '';
    console.log('  下载页数据库已连接：MySQL ' + cfg.host + ':' + (cfg.port || 3306) + ' / ' + cfg.database);
  } catch (err) {
    dbReady = false;
    dbError = (err && (err.code || err.message)) || String(err);
    console.log('  数据库没连上（' + dbError + '），链接先只存浏览器。');
  }
}

function linkRow(r) {
  return {
    id: r.id,
    modId: r.mod_id || '',
    modName: r.mod_name || '',
    site: r.site || 'other',
    url: r.url,
    note: r.note || '',
    at: r.created_at ? new Date(r.created_at).getTime() : 0
  };
}

async function dbList() {
  const [rows] = await pool.query('SELECT id, mod_id, mod_name, site, url, note, created_at FROM links ORDER BY created_at DESC, id DESC');
  const [counts] = await pool.query('SELECT site, COUNT(*) n FROM links GROUP BY site');
  return { links: rows.map(linkRow), counts: counts.map(c => ({ site: c.site, n: Number(c.n) })) };
}

async function dbAdd(items) {
  const list = Array.isArray(items) ? items : [];
  let saved = 0;
  for (const it of list) {
    const url = String((it && it.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const modId = String((it && (it.modId || it.id)) || '').trim().slice(0, 190);
    const modName = String((it && (it.modName || it.name)) || '').trim().slice(0, 190);
    const note = String((it && it.note) || '').trim().slice(0, 255);
    const site = siteOf(url);
    await pool.query(
      'INSERT INTO links (mod_id, mod_name, site, url, note) VALUES (?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE note = VALUES(note), site = VALUES(site), mod_name = VALUES(mod_name)',
      [modId, modName, site, url.slice(0, 1000), note]
    );
    saved++;
  }
  return saved;
}

/* ================= 日志自动读取 ================= */
function mcHome() {
  const app = process.env.APPDATA;
  if (app) return path.join(app, '.minecraft');
  return path.join(require('os').homedir(), '.minecraft');
}

function pickFile(dir, filter) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const files = names.filter(filter).map(n => {
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch { return null; }
    return st && st.isFile() ? { name: n, path: p, at: st.mtimeMs, size: st.size } : null;
  }).filter(Boolean);
  if (!files.length) return null;
  return files.sort((a, b) => b.at - a.at)[0];
}

function readLog(kind) {
  const home = mcHome();
  let hit = null;
  if (kind === 'crash') hit = pickFile(path.join(home, 'crash-reports'), n => /\.txt$/i.test(n));
  else hit = pickFile(path.join(home, 'logs'), n => /^latest\.log$/i.test(n)) ||
    pickFile(path.join(home, 'logs'), n => /\.log$/i.test(n));
  if (!hit) return { ok: false, reason: '没找到日志。默认路径：' + path.join(home, 'logs') };
  if (hit.size > 32 * 1024 * 1024) return { ok: false, reason: '日志太大（超过 32MB），先手动拖入最新的那一段吧' };
  let text = '';
  try { text = fs.readFileSync(hit.path, 'utf8'); }
  catch (err) { return { ok: false, reason: '读不了日志：' + err.message }; }
  return { ok: true, name: hit.name, path: hit.path, at: hit.at, size: hit.size, text };
}

/* ================= 版本列表（代理，避免浏览器跨域） ================= */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ModPilot/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ModPilot/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const MC_FALLBACK = ['1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
  '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.12.2', '1.12.1', '1.11.2', '1.10.2', '1.8.9', '1.7.10'];

const FORGE_FALLBACK = {
  '1.20.1': ['47.4.0', '47.3.0', '47.2.0', '47.1.3', '47.1.0'],
  '1.19.2': ['43.4.12', '43.3.0', '43.2.0'],
  '1.18.2': ['40.2.21', '40.2.0', '40.1.0'],
  '1.16.5': ['36.2.39', '36.2.34', '36.2.20'],
  '1.12.2': ['14.23.5.2860', '14.23.5.2859', '14.23.5.2854']
};
const FABRIC_FALLBACK = ['0.16.10', '0.16.9', '0.16.5', '0.15.11', '0.15.7', '0.14.24'];

function unic(v) { return String(v).replace(/[^0-9.]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, ''); }

function ncSort(a, b) {
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (B[i] || 0) - (A[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function mcVersions() {
  return cached('mc', 6 * 60 * 60 * 1000, async () => {
    try {
      const data = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const list = (data.versions || []).filter(v => v.type === 'release').map(v => v.id);
      if (list.length) return list.slice(0, 120);
    } catch (err) { /* 用内置列表 */ }
    return MC_FALLBACK;
  });
}

async function loaderVersions(loader, mc) {
  const key = 'ld:' + loader + ':' + mc;
  return cached(key, 60 * 60 * 1000, async () => {
    const L = String(loader || '').toLowerCase();
    if (L === 'fabric') {
      try {
        const data = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
        const list = (data || []).map(x => x.version).filter(Boolean);
        if (list.length) return list.slice(0, 60);
      } catch (err) { /* 内置 */ }
      return FABRIC_FALLBACK;
    }
    if (L === 'forge') {
      try {
        const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
        const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
        const list = all.filter(v => v.startsWith(mc + '-')).map(v => v.slice(mc.length + 1)).filter(Boolean);
        if (list.length) return list.reverse().slice(0, 80);
      } catch (err) { /* 内置 */ }
      return FORGE_FALLBACK[mc] || [];
    }
    if (L === 'neoforge') {
      try {
        const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
        const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
        const minor = mc.split('.').slice(1, 3).join('.');
        const list = all.filter(v => v.startsWith(minor + '.'));
        if (list.length) return list.reverse().slice(0, 80);
      } catch (err) { /* 内置 */ }
      return [];
    }
    return [];
  });
}

/* ================= HTTP ================= */
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(new Error('JSON 格式不对')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = '/';
  let query = new URLSearchParams();
  try {
    const raw = (req.url || '/').split('#')[0];
    const q = raw.indexOf('?');
    urlPath = decodeURIComponent(q >= 0 ? raw.slice(0, q) : raw);
    query = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
  } catch (err) {
    return sendJson(res, 400, { ok: false, reason: 'Bad request' });
  }
  if (urlPath === '/') urlPath = '/index.html';

  /* ---- API ---- */
  if (urlPath.startsWith('/api/')) {
    try {
      if (urlPath === '/api/health') {
        return sendJson(res, 200, { ok: true, db: dbReady, dbError, dbName: cfg.database, sites: SITES.map(s => ({ key: s.key, label: s.label })), logHome: mcHome() });
      }

      if (urlPath === '/api/links' && req.method === 'GET') {
        if (!dbReady) return sendJson(res, 200, { ok: false, db: false, reason: dbError, links: [], counts: [] });
        const data = await dbList();
        return sendJson(res, 200, { ok: true, db: true, sites: SITES.map(s => ({ key: s.key, label: s.label })), counts: data.counts, links: data.links });
      }

      if (urlPath === '/api/links' && req.method === 'POST') {
        if (!dbReady) return sendJson(res, 503, { ok: false, reason: '数据库没连上：' + dbError });
        const body = await bodyJson(req);
        const saved = await dbAdd(body.items || []);
        return sendJson(res, 200, { ok: true, saved, skipped: (body.items || []).length - saved });
      }

      if (urlPath === '/api/links/delete' && req.method === 'POST') {
        if (!dbReady) return sendJson(res, 503, { ok: false, reason: '数据库没连上：' + dbError });
        const body = await bodyJson(req);
        if (body.id) await pool.query('DELETE FROM links WHERE id = ?', [Number(body.id)]);
        return sendJson(res, 200, { ok: true });
      }

      if (urlPath === '/api/logs') {
        const r = readLog(query.get('kind') || 'latest');
        return sendJson(res, 200, r);
      }

      if (urlPath === '/api/mc-versions') {
        return sendJson(res, 200, { ok: true, list: await mcVersions() });
      }

      if (urlPath === '/api/loader-versions') {
        const list = await loaderVersions(query.get('loader') || 'forge', query.get('mc') || '1.20.1');
        return sendJson(res, 200, { ok: true, list });
      }

      return sendJson(res, 404, { ok: false, reason: '没有这个接口' });
    } catch (err) {
      return sendJson(res, 500, { ok: false, reason: (err && err.message) || String(err) });
    }
  }

  /* ---- 静态文件 ---- */
  if (/^\/?(db\.config\.json|package-lock\.json)$/i.test(urlPath) || /node_modules|\.git\//i.test(urlPath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  const target = path.resolve(ROOT, '.' + (urlPath.startsWith('/') ? urlPath : '/' + urlPath));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found: ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

function openBrowser(url) {
  if (process.platform === 'win32') exec('start "" "' + url + '"');
  else if (process.platform === 'darwin') exec('open "' + url + '"');
  else exec('xdg-open "' + url + '"');
}

initDb().then(() => {
  const listen = (port, left) => {
    const onError = err => {
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && left > 0) listen(port + 1, left - 1);
      else {
        console.error('启动失败：' + (err && err.message ? err.message : err));
        process.exit(1);
      }
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const url = 'http://127.0.0.1:' + port + '/index.html';
      console.log('');
      console.log('  ModPilot 已启动：' + url);
      console.log('  关闭这个窗口就会停止本地服务。');
      console.log('');
      if (process.env.MODPILOT_NO_OPEN !== '1') openBrowser(url);
    });
  };
  listen(START_PORT, 10);
});
