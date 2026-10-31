/* ModPilot 本地启动器：纯 Node 自带模块 + 可选 mysql2。
   用法：node server.js [端口]（默认 8737，被占用时自动往后找）
   除了发静态文件，还提供：下载页数据库、日志自动读取、游戏/加载器版本列表。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const dns = require('dns');

/* MC百科的 IPv6 地址经常连不上，Node 默认又优先 IPv6，
   结果是每次抓中文名都「连接超时」。强制走 IPv4。 */
try { dns.setDefaultResultOrder('ipv4first'); } catch (err) { /* 老 Node 忽略 */ }

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
    // 中文名库：modId → 大家平时叫的中文名（数据来自 MC百科，查不到会缓存「没查到」）
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_names (
      mod_id VARCHAR(190) PRIMARY KEY,
      en VARCHAR(255) NOT NULL DEFAULT '',
      zh VARCHAR(255) NOT NULL DEFAULT '',
      abbr VARCHAR(32) NOT NULL DEFAULT '',
      mcmod_id VARCHAR(32) NOT NULL DEFAULT '',
      source VARCHAR(500) NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 分类库：modId → Modrinth 官方分类（cats 存原始 slug）+ 归并后的主分类
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_cats (
      mod_id VARCHAR(190) PRIMARY KEY,
      cats VARCHAR(255) NOT NULL DEFAULT '',
      primary_cat VARCHAR(32) NOT NULL DEFAULT '',
      source VARCHAR(20) NOT NULL DEFAULT 'modrinth',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

/* ================= 中文名库（代理 MC百科 + 本地缓存） =================
   mods.toml 里的 displayName 一般是英文；大家聊天时用的是中文俗称。
   MC百科的搜索结果标题就是「[缩写] 中文名 (English Name)」，所以按英文名核对后
   把中文名存下来，下次直接命中，不用再抓。查不到的条目记 1 天，避免反复请求。 */
const DATA_DIR = path.join(ROOT, 'data');
const ZH_FILE = path.join(DATA_DIR, 'zh-names.json');
const ZH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
/* 没查到的记录只留 24 小时；ZH_VER 变更时旧的「没查到」全部作废重试，
   避免匹配规则改好了却因为旧缓存一直显示没有中文名。 */
const ZH_VER = 2;
const ZH_MISS_TTL = 24 * 60 * 60 * 1000;
let zhMem = null;
let zhDirty = false;
let zhTimer = null;

function zhAll() {
  if (zhMem) return zhMem;
  zhMem = {};
  try {
    const obj = JSON.parse(fs.readFileSync(ZH_FILE, 'utf8'));
    if (obj && typeof obj === 'object') zhMem = obj;
  } catch (err) { /* 第一次运行还没有缓存 */ }
  return zhMem;
}

function zhFlush() {
  if (!zhDirty || !zhMem) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ZH_FILE, JSON.stringify(zhMem, null, 1), 'utf8');
    zhDirty = false;
  } catch (err) {
    console.log('  中文名缓存写入失败：' + err.message);
  }
}

function zhRemember(rec) {
  const all = zhAll();
  all[rec.id] = Object.assign({}, rec, { at: Date.now(), v: ZH_VER });
  zhDirty = true;
  clearTimeout(zhTimer);
  zhTimer = setTimeout(zhFlush, 800);
}

function zhOut(rec) {
  return { id: rec.id, zh: rec.zh || '', en: rec.en || '', abbr: rec.abbr || '', url: rec.url || '', mcmodId: rec.mcmodId || '' };
}

async function dbZhGet(id) {
  if (!dbReady) return null;
  try {
    const [rows] = await pool.query('SELECT mod_id, en, zh, abbr, mcmod_id, source FROM mod_names WHERE mod_id = ? LIMIT 1', [id]);
    if (!rows.length || !rows[0].zh) return null;
    const r = rows[0];
    return { id, en: r.en || '', zh: r.zh || '', abbr: r.abbr || '', mcmodId: r.mcmod_id || '', url: r.source || '' };
  } catch (err) { return null; }
}

async function dbZhSave(rec) {
  if (!dbReady) return;
  try {
    await pool.query(
      'INSERT INTO mod_names (mod_id, en, zh, abbr, mcmod_id, source) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE en = VALUES(en), zh = VALUES(zh), abbr = VALUES(abbr), mcmod_id = VALUES(mcmod_id), source = VALUES(source)',
      [rec.id, rec.en || '', rec.zh || '', rec.abbr || '', rec.mcmodId || '', (rec.url || '').slice(0, 500)]
    );
  } catch (err) { /* 数据库只是副本，文件缓存还在 */ }
}

function zhText(s) {
  return String(s || '')
    .replace(/<\/em>\s*<em[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 搜索页高亮会在标题里插图标，比如「玉 🔍 ( Jade 🔍 )」，先清掉 */
function zhClean(s) {
  return String(s || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u200b-\u200f\uFE0F\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 搜索结果的高亮会给每个词之间插空格：森罗 物语 ： 兼容 → 森罗物语：兼容 */
function zhTight(s) {
  return String(s || '')
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    .replace(/\s*([：:，,、])\s*/g, '$1')
    .trim();
}

/** 「[TF] 暮色森林 (The Twilight Forest)」→ { abbr: 'TF', zh: '暮色森林', en: 'The Twilight Forest' } */
function zhTitle(text) {
  let t = zhClean(zhText(text));
  let abbr = '';
  const ab = /^\[([^\]]{1,12})\]\s*/.exec(t);
  if (ab) { abbr = ab[1]; t = t.slice(ab[0].length).trim(); }
  let zh = t;
  let en = '';
  const m = /^([\s\S]*?)\s*[(（]([^()（）]*)[)）]\s*$/.exec(t);
  if (m) { zh = zhClean(m[1]); en = zhClean(m[2]); }
  if (zhHasCjk(zh)) zh = zhTight(zh);
  return { abbr, zh, en };
}

function parseMcmod(html) {
  const out = [];
  const chunks = String(html || '').split('<div class="result-item">').slice(1);
  for (const chunk of chunks) {
    const block = chunk.slice(0, 3000);
    const m = /<a[^>]+href="(https:\/\/www\.mcmod\.cn\/class\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!m) continue;
    const info = zhTitle(m[3]);
    if (!info.zh) continue;
    out.push({ mcmodId: m[2], url: m[1], abbr: info.abbr, zh: info.zh, en: info.en });
  }
  return out;
}

function zhNorm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function zhHasCjk(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''));
}

/** 只认名字对得上的结果，避免把「暮色森林法术包」当成暮色森林。
   英文名和标题里的中文名都参与比对：显示名本身是中文的模组（比如森罗物语），
   搜索结果里只有一个英文名，只比英文永远对不上。 */
function pickMcmod(list, keys) {
  let best = null;
  let bestScore = 0;
  const want = keys.map(k => zhNorm(k).replace(/^the/, '')).filter(k => k && k.length >= 3);
  (list || []).forEach(r => {
    const en = zhNorm(r.en).replace(/^the/, '');
    const zh = zhNorm(r.zh).replace(/^the/, '');
    want.forEach(kk => {
      let score = 0;
      if (en && en === kk) score = 100;
      else if (zh && zh === kk) score = 100;
      else if (en.length >= 5 && kk.length >= 5 && (en.indexOf(kk) >= 0 || kk.indexOf(en) >= 0)) {
        score = 80 + Math.min(en.length, kk.length) / 10;
      } else if (zhHasCjk(kk) && zh.length >= 3 && (zh.indexOf(kk) >= 0 || kk.indexOf(zh) >= 0)) {
        score = 72 + Math.min(zh.length, kk.length) / 10;
      }
      if (score > bestScore) { bestScore = score; best = r; }
    });
  });
  if (bestScore < 70) return null;
  // 标题就是纯英文（GeckoLib / Cloth Config API）说明它本来没有中文名，别硬塞
  if (!zhHasCjk(best.zh)) return null;
  return best;
}

/* 先用显示名搜；显示名是中文、MC百科标题只有英文时，再用 modId/slug 搜一次 */
async function mcmodSearch(title, keys, alt) {
  const words = [title, alt]
    .map(x => String(x || '').trim().slice(0, 90))
    .filter((x, i, arr) => x && arr.indexOf(x) === i);
  if (!words.length) return null;

  let lastError = null;
  let responded = false;
  let calls = 0;
  for (const word of words) {
    // MC百科偶尔会抽风／超时，每个关键词重试一次再判定「没查到」
    for (let i = 0; i < 2; i++) {
      if (calls) await new Promise(r => setTimeout(r, 600));
      calls++;
      try {
        const res = await fetch('https://search.mcmod.cn/s?key=' + encodeURIComponent(word) + '&filter=0', {
          headers: { 'User-Agent': ZH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error('MC百科返回 ' + res.status);
        responded = true;
        const hit = pickMcmod(parseMcmod(await res.text()), keys || [word]);
        if (hit) return hit;
        break;   // 搜索本身成功了，只是没匹配上，换下一个关键词
      } catch (err) {
        lastError = err;
      }
    }
  }
  if (!responded) throw lastError || new Error('连不上 MC百科');
  return null;
}

/* ================= 爱发电（我支持过的作者 → 主页 / 发电帖） =================
   爱发电没有公开文档，接口是从 AfdianToMarkdown 里扒出来的：
   /api/user/get-sponsoring 拿「TA 发电的」列表，/api/post/get-list 拿每位作者的发电帖。
   需要浏览器登录后的 auth_token，存在 data/afdian.json（不会提交到 git）。 */
const AFDIAN_FILE = path.join(DATA_DIR, 'afdian.json');
const AFDIAN_UA = ZH_UA;
const afdianSleep = ms => new Promise(r => setTimeout(r, ms));
let afdianMem = null;
let afdianJob = { running: false, startedAt: 0, done: 0, total: 0, posts: 0, note: '', error: '', updatedAt: 0 };

function afdianFile() {
  if (afdianMem) return afdianMem;
  afdianMem = { token: '', userId: '', updatedAt: 0, creators: [] };
  try {
    const obj = JSON.parse(fs.readFileSync(AFDIAN_FILE, 'utf8'));
    if (obj && typeof obj === 'object') {
      afdianMem.token = String(obj.token || '');
      afdianMem.userId = String(obj.userId || '');
      afdianMem.updatedAt = Number(obj.updatedAt || 0);
      afdianMem.creators = Array.isArray(obj.creators) ? obj.creators : [];
    }
  } catch (err) { /* 还没抓过 */ }
  return afdianMem;
}

function afdianWrite() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AFDIAN_FILE, JSON.stringify(afdianFile(), null, 1), 'utf8');
  } catch (err) { console.log('  爱发电缓存写入失败：' + err.message); }
}

function afdianToken() {
  return String(process.env.AFDIAN_TOKEN || afdianFile().token || '').trim();
}

async function afdianApi(pathname, token) {
  let lastError = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch('https://afdian.com' + pathname, {
        headers: { 'User-Agent': AFDIAN_UA, Cookie: 'auth_token=' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error('爱发电返回 ' + res.status);
      const j = await res.json();
      if (!j || j.ec !== 200) throw new Error((j && j.em) || '爱发电接口失败');
      return j.data || {};
    } catch (err) {
      lastError = err;
      if (i < 2) await afdianSleep(800 + i * 500);
    }
  }
  throw lastError;
}

function afdianCleanPost(p) {
  const text = String((p && p.content) || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: String((p && p.post_id) || ''),
    title: String((p && p.title) || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    excerpt: text.slice(0, 160),
    type: (p && p.type) || 0,
    created: (p && p.create_time) || 0,
    url: 'https://afdian.com/p/' + String((p && p.post_id) || '')
  };
}

async function afdianRefresh() {
  if (afdianJob.running) return false;
  const token = afdianToken();
  if (!token) throw new Error('还没有爱发电登录令牌，把 auth_token 写进 data/afdian.json 的 token 字段');
  afdianJob = { running: true, startedAt: Date.now(), done: 0, total: 0, posts: 0, note: '正在读取你发电过的作者…', error: '', updatedAt: afdianFile().updatedAt || 0 };

  (async () => {
    try {
      const me = await afdianApi('/api/my/profile', token);
      const uid = String((me.user && me.user.user_id) || afdianFile().userId || '');
      if (!uid) throw new Error('读不到你的爱发电 user_id');
      const creators = [];
      const seen = {};
      // 注意：这个接口的分页参数经常被忽略，翻到重复页就停，按 user_id 去重
      for (let page = 1; page <= 30; page++) {
        const data = await afdianApi('/api/user/get-sponsoring?user_id=' + uid + '&page=' + page, token);
        const list = data.sponsoring || [];
        if (!list.length) break;
        let fresh = 0;
        for (const it of list) {
          const u = it.user || {};
          const c = u.creator || {};
          const id = String(u.user_id || '');
          if (!id || seen[id]) continue;
          seen[id] = 1;
          fresh++;
          creators.push({
            userId: id,
            name: String(u.name || ''),
            slug: String(u.url_slug || ''),
            doing: String(c.doing || '').slice(0, 120),
            detail: String(c.detail || '').replace(/\s+/g, ' ').slice(0, 600),
            avatar: String(u.avatar || ''),
            home: 'https://afdian.com/u/' + id,
            posts: []
          });
        }
        if (!fresh) break;
        afdianJob.note = '已找到 ' + creators.length + ' 位作者，正在翻发电帖…';
        await afdianSleep(350);
      }

      afdianJob.total = creators.length;
      for (const c of creators) {
        if (!c.userId) continue;
        const seenPost = {};
        for (let page = 1; page <= 3; page++) {
          let data;
          try { data = await afdianApi('/api/post/get-list?user_id=' + c.userId + '&page=' + page, token); }
          catch (err) { break; }
          const list = data.list || [];
          let items = 0;
          list.forEach(p => {
            const id = String((p && p.post_id) || '');
            if (!id || seenPost[id]) return;
            seenPost[id] = 1;
            items++;
            const post = afdianCleanPost(p);
            // 没赞助过的帖子标题/正文都是空的，留下也匹配不上，直接跳过
            if (!post.title) return;
            c.posts.push(post);
            afdianJob.posts++;
          });
          if (!items || !data.has_more) break;
          await afdianSleep(300);
        }
        afdianJob.done++;
        await afdianSleep(280);
      }

      const mem = afdianFile();
      mem.token = token;
      mem.userId = uid;
      mem.updatedAt = Date.now();
      mem.creators = creators;
      afdianJob.updatedAt = mem.updatedAt;
      afdianJob.running = false;
      afdianJob.note = '已更新 ' + creators.length + ' 位作者、' + afdianJob.posts + ' 条发电帖';
      afdianWrite();
    } catch (err) {
      afdianJob.running = false;
      afdianJob.error = err.message || '爱发电读取失败';
      afdianJob.note = '更新失败：' + afdianJob.error;
    }
  })();

  return true;
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

/* ================= 后台（仅本机） =================
   /admin 页面能看到数据库里的三张表 + 两个文件缓存。
   所有 /api/admin/* 只认 127.0.0.1，以后就算端口被局域网看到也进不来。 */
function isLocalReq(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvText(head, rows) {
  return '\uFEFF' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
}

function sendDownload(res, filename, ctype, body) {
  res.writeHead(200, {
    'Content-Type': ctype,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function fileInfo(p) {
  try {
    const st = fs.statSync(p);
    return { size: st.size, at: st.mtimeMs };
  } catch (err) {
    return { size: 0, at: 0 };
  }
}

/* 中文名库有两份：MySQL 的 mod_names（正式数据）和 data/zh-names.json（查询缓存，
   含「没查到」）。后台把两边并起来看，才能知道谁还没查到。 */
async function adminNames() {
  const out = {};
  if (dbReady) {
    try {
      const [rows] = await pool.query('SELECT mod_id, en, zh, abbr, mcmod_id, source, updated_at FROM mod_names');
      rows.forEach(r => {
        out[r.mod_id] = {
          id: r.mod_id, en: r.en || '', zh: r.zh || '', abbr: r.abbr || '',
          mcmodId: r.mcmod_id || '', url: r.source || '',
          at: r.updated_at ? new Date(r.updated_at).getTime() : 0, origin: 'db'
        };
      });
    } catch (err) { /* 数据库抽风时至少还能看文件缓存 */ }
  }
  const file = zhAll();
  Object.keys(file).forEach(id => {
    const rec = file[id] || {};
    const cur = out[id];
    if (cur) {
      cur.origin = 'both';
      if (rec.zh) {
        cur.zh = rec.zh;
        if (rec.en) cur.en = rec.en;
        if (rec.abbr) cur.abbr = rec.abbr;
        if (rec.mcmodId) cur.mcmodId = rec.mcmodId;
        if (rec.url) cur.url = rec.url;
        if (rec.at) cur.at = Number(rec.at) || cur.at;
      }
    } else {
      out[id] = {
        id, en: rec.en || '', zh: rec.zh || '', abbr: rec.abbr || '',
        mcmodId: rec.mcmodId || '', url: rec.url || '',
        at: Number(rec.at) || 0, origin: 'file'
      };
    }
  });
  return Object.keys(out).map(k => out[k]);
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
  if (urlPath === '/admin' || urlPath === '/admin/') urlPath = '/admin.html';

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

      /* 分类库：读全部（离线或没被 Modrinth 覆盖的模组用它兜底） */
      if (urlPath === '/api/mod-cats' && req.method === 'GET') {
        if (!dbReady) return sendJson(res, 200, { ok: false, reason: dbError, cats: {} });
        const [rows] = await pool.query('SELECT mod_id, cats, primary_cat, source FROM mod_cats');
        const cats = {};
        rows.forEach(r => { cats[r.mod_id] = { cats: r.cats || '', primary: r.primary_cat || '', source: r.source || '' }; });
        return sendJson(res, 200, { ok: true, cats });
      }

      /* 分类库：批量写入（按 Modrinth 官方分类覆盖同一个 modId） */
      if (urlPath === '/api/mod-cats' && req.method === 'POST') {
        if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
        const body = await bodyJson(req);
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500);
        let saved = 0;
        for (const it of items) {
          const id = String((it && it.id) || '').trim().toLowerCase().slice(0, 190);
          if (!id) continue;
          try {
            await pool.query(
              'INSERT INTO mod_cats (mod_id, cats, primary_cat, source) VALUES (?, ?, ?, ?) ' +
              'ON DUPLICATE KEY UPDATE cats = VALUES(cats), primary_cat = VALUES(primary_cat), source = VALUES(source)',
              [id, String((it && it.cats) || '').slice(0, 255), String((it && it.primary) || '').slice(0, 32), String((it && it.source) || 'modrinth').slice(0, 20)]
            );
            saved++;
          } catch (err) { /* 单条失败不影响其他 */ }
        }
        return sendJson(res, 200, { ok: true, saved });
      }

      if (urlPath === '/api/links/delete' && req.method === 'POST') {
        if (!dbReady) return sendJson(res, 503, { ok: false, reason: '数据库没连上：' + dbError });
        const body = await bodyJson(req);
        if (body.id) await pool.query('DELETE FROM links WHERE id = ?', [Number(body.id)]);
        return sendJson(res, 200, { ok: true });
      }

      /* 爱发电：已缓存的作者 + 发电帖（不含 token） */
      if (urlPath === '/api/afdian' && req.method === 'GET') {
        const d = afdianFile();
        return sendJson(res, 200, {
          ok: true,
          updatedAt: d.updatedAt || 0,
          count: (d.creators || []).length,
          creators: d.creators || []
        });
      }

      /* 重新抓一遍「我发电的」+ 每位作者的发电帖（后台跑，前端轮询状态） */
      if (urlPath === '/api/afdian/refresh' && req.method === 'POST') {
        try {
          const started = await afdianRefresh();
          return sendJson(res, 200, { ok: true, started });
        } catch (err) {
          return sendJson(res, 200, { ok: false, reason: err.message });
        }
      }

      if (urlPath === '/api/afdian/status' && req.method === 'GET') {
        return sendJson(res, 200, Object.assign({ ok: true }, afdianJob));
      }

      /* 中文名库：items = [{ id, title, slug }]，返回 { names: { id: { zh, en, abbr, url } } }
         缓存命中的立刻返回；没查过的按顺序去 MC百科搜（400ms 间隔，别把人站打挂）。 */
      if (urlPath === '/api/zh-names' && req.method === 'POST') {
        const body = await bodyJson(req);
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40);
        const force = body.force === true;   // 手动「重新查」：忽略缓存，查过的也重来
        const all = zhAll();
        const names = {};
        const todo = [];
        for (const it of items) {
          const id = String((it && it.id) || '').trim().slice(0, 190);
          if (!id) continue;
          const rec = all[id];
          if (force) {
            delete all[id];
            zhDirty = true;
          } else {
            if (rec && rec.zh) { names[id] = zhOut(rec); continue; }
            // 旧规则查空的不算数；刚查过没查到才跳过
            if (rec && rec.v === ZH_VER && rec.at && Date.now() - rec.at < ZH_MISS_TTL) continue;
          }
          todo.push({
            id,
            title: String((it && it.title) || '').trim().slice(0, 120),
            slug: String((it && it.slug) || '').trim().slice(0, 120)
          });
        }

        for (const t of todo) {
          if (names[t.id] || force) continue;
          const db = await dbZhGet(t.id);
          if (db) {
            zhRemember(db);
            names[t.id] = zhOut(db);
          }
        }

        let searched = 0;
        let offline = 0;
        for (const t of todo) {
          if (names[t.id]) continue;
          const keys = [t.title, t.slug, t.id].filter(Boolean);
          if (!keys.length) continue;
          if (searched) await new Promise(r => setTimeout(r, 400));
          searched++;
          let hit = null;
          try {
            hit = await mcmodSearch(t.title, keys, t.slug || t.id);
          } catch (err) {
            offline++;
            continue;   // 网络临时出错：不记「没查到」，下次再试
          }
          if (hit) {
            const rec = { id: t.id, zh: hit.zh, en: hit.en, abbr: hit.abbr, mcmodId: hit.mcmodId, url: hit.url };
            zhRemember(rec);
            dbZhSave(rec);
            names[t.id] = zhOut(rec);
          } else {
            zhRemember({ id: t.id, zh: '', en: '', abbr: '', mcmodId: '', url: '' });
          }
        }
        zhFlush();
        return sendJson(res, 200, {
          ok: true,
          names,
          cached: Object.keys(names).length,
          fetched: searched - offline,
          offline
        });
      }

      /* ---- 后台接口（只允许本机） ---- */
      if (urlPath.startsWith('/api/admin/')) {
        if (!isLocalReq(req)) return sendJson(res, 403, { ok: false, reason: '后台只允许在本机打开（127.0.0.1）' });

        /* 总览：各表条数 + 文件缓存信息 + 主分类分布 */
        if (urlPath === '/api/admin/overview' && req.method === 'GET') {
          const names = await adminNames();
          let links = 0;
          let cats = 0;
          let pcats = [];
          if (dbReady) {
            try {
              const [[lc]] = await pool.query('SELECT COUNT(*) n FROM links');
              const [[cc]] = await pool.query('SELECT COUNT(*) n FROM mod_cats');
              links = Number(lc.n) || 0;
              cats = Number(cc.n) || 0;
              const [pc] = await pool.query("SELECT primary_cat, COUNT(*) n FROM mod_cats WHERE primary_cat <> '' GROUP BY primary_cat ORDER BY n DESC");
              pcats = pc.map(x => ({ cat: x.primary_cat, n: Number(x.n) }));
            } catch (err) { /* 先把能显示的显示出来 */ }
          }
          const af = afdianFile();
          return sendJson(res, 200, {
            ok: true, db: dbReady, dbError, database: cfg.database,
            names: { total: names.length, hit: names.filter(n => n.zh).length, miss: names.filter(n => !n.zh).length },
            links, cats, pcats,
            sites: SITES.map(s => ({ key: s.key, label: s.label })),
            files: { zh: fileInfo(ZH_FILE), afdian: fileInfo(AFDIAN_FILE) },
            afdian: {
              creators: (af.creators || []).length,
              posts: (af.creators || []).reduce((sum, c) => sum + ((c.posts || []).length), 0),
              at: af.updatedAt || 0,
              token: !!afdianToken()
            }
          });
        }

        /* 中文名库：数据库 + 文件缓存合并后分页 */
        if (urlPath === '/api/admin/names' && req.method === 'GET') {
          const all = await adminNames();
          const q = String(query.get('q') || '').trim().toLowerCase();
          const status = String(query.get('status') || 'all');
          let list = all;
          if (q) {
            list = list.filter(n => [n.id, n.zh, n.en, n.abbr, n.mcmodId]
              .some(v => String(v || '').toLowerCase().indexOf(q) >= 0));
          }
          if (status === 'hit') list = list.filter(n => n.zh);
          else if (status === 'miss') list = list.filter(n => !n.zh);
          else if (status === 'file') list = list.filter(n => n.origin !== 'db');
          list.sort((a, b) => (b.at || 0) - (a.at || 0) || String(a.id).localeCompare(String(b.id)));
          const size = Math.min(200, Math.max(5, Number(query.get('size')) || 30));
          const pages = Math.max(1, Math.ceil(list.length / size));
          const page = Math.min(pages, Math.max(1, Number(query.get('page')) || 1));
          const start = (page - 1) * size;
          return sendJson(res, 200, {
            ok: true, db: dbReady, total: list.length,
            hit: all.filter(n => n.zh).length, miss: all.filter(n => !n.zh).length,
            page, size, rows: list.slice(start, start + size)
          });
        }

        if (urlPath === '/api/admin/names/delete' && req.method === 'POST') {
          const body = await bodyJson(req);
          const id = String(body.id || '').trim();
          if (id) {
            if (dbReady) await pool.query('DELETE FROM mod_names WHERE mod_id = ?', [id]);
            const all = zhAll();
            if (all[id]) { delete all[id]; zhDirty = true; zhFlush(); }
          }
          return sendJson(res, 200, { ok: true });
        }

        /* mode=all 清空全部；mode=miss 只清「没查到」的缓存（主程序下次会重查） */
        if (urlPath === '/api/admin/names/clear' && req.method === 'POST') {
          const body = await bodyJson(req);
          const mode = String(body.mode || 'all');
          const all = zhAll();
          let removed = 0;
          if (mode === 'miss') {
            Object.keys(all).forEach(id => {
              if (!all[id] || !all[id].zh) { delete all[id]; removed++; }
            });
          } else {
            if (dbReady) await pool.query('DELETE FROM mod_names');
            Object.keys(all).forEach(id => delete all[id]);
            removed = 1;
          }
          zhDirty = true;
          zhFlush();
          return sendJson(res, 200, { ok: true, mode, removed });
        }

        /* 链接库：分页 + 站点筛选 */
        if (urlPath === '/api/admin/links' && req.method === 'GET') {
          if (!dbReady) return sendJson(res, 200, { ok: false, reason: dbError, total: 0, rows: [] });
          const q = String(query.get('q') || '').trim();
          const site = String(query.get('site') || '');
          const where = [];
          const args = [];
          if (q) {
            const like = '%' + q + '%';
            where.push('(mod_id LIKE ? OR mod_name LIKE ? OR url LIKE ? OR note LIKE ?)');
            args.push(like, like, like, like);
          }
          if (site) { where.push('site = ?'); args.push(site); }
          const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
          const [[cnt]] = await pool.query('SELECT COUNT(*) n FROM links' + w, args);
          const size = Math.min(200, Math.max(5, Number(query.get('size')) || 30));
          const pages = Math.max(1, Math.ceil(Number(cnt.n) / size));
          const page = Math.min(pages, Math.max(1, Number(query.get('page')) || 1));
          const [rows] = await pool.query(
            'SELECT id, mod_id, mod_name, site, url, note, created_at FROM links' + w +
            ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
            args.concat([size, (page - 1) * size])
          );
          return sendJson(res, 200, {
            ok: true, db: true, total: Number(cnt.n), page, size,
            rows: rows.map(r => ({
              id: r.id, modId: r.mod_id || '', modName: r.mod_name || '',
              site: r.site || 'other', url: r.url || '', note: r.note || '',
              at: r.created_at ? new Date(r.created_at).getTime() : 0
            }))
          });
        }

        if (urlPath === '/api/admin/links/delete' && req.method === 'POST') {
          if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
          const body = await bodyJson(req);
          if (body.id) await pool.query('DELETE FROM links WHERE id = ?', [Number(body.id)]);
          return sendJson(res, 200, { ok: true });
        }

        if (urlPath === '/api/admin/links/clear' && req.method === 'POST') {
          if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
          await pool.query('DELETE FROM links');
          return sendJson(res, 200, { ok: true });
        }

        /* 分类库：分页 + 主分类筛选 */
        if (urlPath === '/api/admin/cats' && req.method === 'GET') {
          if (!dbReady) return sendJson(res, 200, { ok: false, reason: dbError, total: 0, rows: [] });
          const q = String(query.get('q') || '').trim();
          const primary = String(query.get('primary') || '');
          const where = [];
          const args = [];
          if (q) {
            const like = '%' + q + '%';
            where.push('(mod_id LIKE ? OR cats LIKE ? OR primary_cat LIKE ?)');
            args.push(like, like, like);
          }
          if (primary) { where.push('primary_cat = ?'); args.push(primary); }
          const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
          const [[cnt]] = await pool.query('SELECT COUNT(*) n FROM mod_cats' + w, args);
          const size = Math.min(200, Math.max(5, Number(query.get('size')) || 30));
          const pages = Math.max(1, Math.ceil(Number(cnt.n) / size));
          const page = Math.min(pages, Math.max(1, Number(query.get('page')) || 1));
          const [rows] = await pool.query(
            'SELECT mod_id, cats, primary_cat, source, updated_at FROM mod_cats' + w +
            ' ORDER BY updated_at DESC, mod_id ASC LIMIT ? OFFSET ?',
            args.concat([size, (page - 1) * size])
          );
          return sendJson(res, 200, {
            ok: true, db: true, total: Number(cnt.n), page, size,
            rows: rows.map(r => ({
              id: r.mod_id, cats: r.cats || '', primary: r.primary_cat || '',
              source: r.source || '', at: r.updated_at ? new Date(r.updated_at).getTime() : 0
            }))
          });
        }

        if (urlPath === '/api/admin/cats/delete' && req.method === 'POST') {
          if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
          const body = await bodyJson(req);
          const id = String(body.id || '').trim();
          if (id) await pool.query('DELETE FROM mod_cats WHERE mod_id = ?', [id]);
          return sendJson(res, 200, { ok: true });
        }

        if (urlPath === '/api/admin/cats/clear' && req.method === 'POST') {
          if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
          await pool.query('DELETE FROM mod_cats');
          return sendJson(res, 200, { ok: true });
        }

        /* 爱发电缓存（不含 token） */
        if (urlPath === '/api/admin/afdian' && req.method === 'GET') {
          const d = afdianFile();
          return sendJson(res, 200, {
            ok: true, updatedAt: d.updatedAt || 0, token: !!afdianToken(),
            creators: d.creators || []
          });
        }

        if (urlPath === '/api/admin/afdian/clear' && req.method === 'POST') {
          const d = afdianFile();
          d.creators = [];
          d.updatedAt = 0;
          afdianWrite();
          return sendJson(res, 200, { ok: true });
        }

        /* 导出：type=names|links|cats|afdian，format=json|csv */
        if (urlPath === '/api/admin/export' && req.method === 'GET') {
          const type = String(query.get('type') || 'names').toLowerCase();
          const format = String(query.get('format') || 'json').toLowerCase();
          const base = 'modpilot-' + type + '-' + new Date().toISOString().slice(0, 10);
          let payload = null;
          let head = [];
          let csvRows = [];

          if (type === 'names') {
            const list = await adminNames();
            payload = { version: 1, type: 'names', exportedAt: new Date().toISOString(), items: list };
            head = ['mod_id', 'zh', 'en', 'abbr', 'mcmod_id', 'url', 'status', 'origin', 'updated_at'];
            csvRows = list.map(n => [n.id, n.zh, n.en, n.abbr, n.mcmodId, n.url,
              n.zh ? 'hit' : 'miss', n.origin, n.at ? new Date(n.at).toISOString() : '']);
          } else if (type === 'links') {
            if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
            const [rows] = await pool.query('SELECT id, mod_id, mod_name, site, url, note, created_at FROM links ORDER BY created_at DESC, id DESC');
            const items = rows.map(r => ({
              id: r.id, modId: r.mod_id || '', modName: r.mod_name || '', site: r.site || '',
              url: r.url || '', note: r.note || '',
              at: r.created_at ? new Date(r.created_at).toISOString() : ''
            }));
            payload = { version: 1, type: 'links', exportedAt: new Date().toISOString(), items };
            head = ['mod_id', 'mod_name', 'site', 'url', 'note', 'created_at'];
            csvRows = items.map(x => [x.modId, x.modName, x.site, x.url, x.note, x.at]);
          } else if (type === 'cats') {
            if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
            const [rows] = await pool.query('SELECT mod_id, cats, primary_cat, source, updated_at FROM mod_cats ORDER BY mod_id ASC');
            const items = rows.map(r => ({
              id: r.mod_id, cats: r.cats || '', primary: r.primary_cat || '',
              source: r.source || '', at: r.updated_at ? new Date(r.updated_at).toISOString() : ''
            }));
            payload = { version: 1, type: 'cats', exportedAt: new Date().toISOString(), items };
            head = ['mod_id', 'cats', 'primary_cat', 'source', 'updated_at'];
            csvRows = items.map(x => [x.id, x.cats, x.primary, x.source, x.at]);
          } else if (type === 'afdian') {
            const d = afdianFile();
            payload = { version: 1, type: 'afdian', exportedAt: new Date().toISOString(), updatedAt: d.updatedAt || 0, creators: d.creators || [] };
            head = ['user_id', 'name', 'home', 'posts', 'doing'];
            csvRows = (d.creators || []).map(c => [c.userId, c.name, c.home, (c.posts || []).length, c.doing]);
          } else {
            return sendJson(res, 400, { ok: false, reason: '不认识的导出类型' });
          }

          if (format === 'csv') {
            return sendDownload(res, base + '.csv', 'text/csv; charset=utf-8', csvText(head, csvRows));
          }
          return sendDownload(res, base + '.json', 'application/json; charset=utf-8', JSON.stringify(payload, null, 2));
        }

        /* 导入：type 放 query，body 直接是导出的 JSON（数组或 {items:[...]} 都行） */
        if (urlPath === '/api/admin/import' && req.method === 'POST') {
          const type = String(query.get('type') || 'names').toLowerCase();
          const body = await bodyJson(req);
          let saved = 0;
          let skipped = 0;

          if (type === 'names') {
            const list = Array.isArray(body) ? body
              : (Array.isArray(body.items) ? body.items
                : (body && typeof body === 'object'
                  ? Object.keys(body).map(k => {
                    const v = body[k];
                    return typeof v === 'string' ? { id: k, zh: v } : Object.assign({ id: k }, v || {});
                  }) : []));
            for (const it of list.slice(0, 2000)) {
              const id = String((it && (it.id || it.modId || it.mod_id)) || '').trim().slice(0, 190);
              if (!id) { skipped++; continue; }
              const rec = {
                id,
                en: String((it && it.en) || '').slice(0, 255),
                zh: String((it && it.zh) || '').slice(0, 255),
                abbr: String((it && it.abbr) || '').slice(0, 32),
                mcmodId: String((it && (it.mcmodId || it.mcmod_id)) || '').slice(0, 32),
                url: String((it && (it.url || it.source)) || '').slice(0, 500)
              };
              zhRemember(rec);
              await dbZhSave(rec);
              saved++;
            }
            zhFlush();
          } else if (type === 'links') {
            if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
            const list = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
            saved = await dbAdd(list.slice(0, 2000));
            skipped = list.length - saved;
          } else if (type === 'cats') {
            if (!dbReady) return sendJson(res, 503, { ok: false, reason: dbError });
            const list = Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []);
            for (const it of list.slice(0, 2000)) {
              const id = String((it && (it.id || it.mod_id)) || '').trim().toLowerCase().slice(0, 190);
              if (!id) { skipped++; continue; }
              try {
                await pool.query(
                  'INSERT INTO mod_cats (mod_id, cats, primary_cat, source) VALUES (?, ?, ?, ?) ' +
                  'ON DUPLICATE KEY UPDATE cats = VALUES(cats), primary_cat = VALUES(primary_cat), source = VALUES(source)',
                  [id, String((it && it.cats) || '').slice(0, 255),
                    String((it && (it.primary || it.primary_cat)) || '').slice(0, 32),
                    String((it && it.source) || 'modrinth').slice(0, 20)]
                );
                saved++;
              } catch (err) { skipped++; }
            }
          } else if (type === 'afdian') {
            const d = afdianFile();
            const list = Array.isArray(body.creators) ? body.creators : (Array.isArray(body) ? body : []);
            d.creators = list.slice(0, 2000).map(c => ({
              userId: String((c && c.userId) || ''),
              name: String((c && c.name) || ''),
              slug: String((c && c.slug) || ''),
              doing: String((c && c.doing) || '').slice(0, 120),
              detail: String((c && c.detail) || '').slice(0, 600),
              avatar: String((c && c.avatar) || ''),
              home: String((c && c.home) || ('https://afdian.com/u/' + String((c && c.userId) || ''))),
              posts: Array.isArray(c && c.posts) ? c.posts : []
            })).filter(c => c.userId);
            d.updatedAt = Number(body.updatedAt) || Date.now();
            afdianWrite();
            saved = d.creators.length;
          } else {
            return sendJson(res, 400, { ok: false, reason: '不认识的导入类型' });
          }

          return sendJson(res, 200, { ok: true, type, saved, skipped });
        }

        return sendJson(res, 404, { ok: false, reason: '没有这个后台接口' });
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
