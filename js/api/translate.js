/* ===== 简介机翻：谷歌公开翻译接口（无需 key，CORS 允许跨域），连不上时自动换备用源 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const KEY = 'modpilot.tr.v2';   // v2：保留段落/换行的新排版，旧缓存作废
  const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=';
  // 备用源：谷歌在国内经常连不上，MyMemory 不需要 key 且允许跨域
  const BACKUP = 'https://api.mymemory.translated.net/get?q=';
  const GOOGLE_TIMEOUT = 6000;
  const BACKUP_TIMEOUT = 8000;
  const DEAD_KEY = 'modpilot.tr.google.dead';

  const mem = new Map();      // 本次会话缓存
  let disk = {};              // 落盘的缓存（断网也能看到上次的译文）
  try { disk = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { disk = {}; }

  let savedTimer = 0;
  function saveDisk() {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(disk)); } catch { /* 配额满了就算了 */ }
    }, 400);
  }

  function cacheKey(text) {
    return String(text).trim().slice(0, 900);
  }

  /* 长文本按行/句子切成小段，逐段翻，避免单次 URL 过长或被截断；
     保留换行，译文才不会挤成一大坨 */
  function chunk(text) {
    const clean = String(text || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!clean) return [];
    if (clean.length <= 480) return [clean];

    const out = [];
    let buf = '';
    const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
    clean.split('\n').forEach(line => {
      if (line.length > 480 && !/^([-*•]|\d+\.)\s/.test(line)) {
        // 超长正文按句子切；列表行不切
        line.split(/(?<=[.!?;:])\s+/).forEach(part => {
          if (buf && (buf.length + part.length + 1) > 480) flush();
          buf = buf ? buf + ' ' + part : part;
          if (buf.length > 480) flush();
        });
        return;
      }
      if (buf && (buf.length + line.length + 1) > 480) flush();
      buf = buf ? buf + '\n' + line : line;
    });
    flush();
    return out;
  }

  // 接口被墙/断网时 fetch 会一直挂着，界面看不出是失败了

  // 记一下谷歌多久之前连不上：6 小时内直接走备用源，省得每次都等超时
  let googleDown = false;
  try { googleDown = Date.now() - (Number(localStorage.getItem(DEAD_KEY)) || 0) < 6 * 3600 * 1000; } catch { googleDown = false; }
  function markGoogleDown() {
    googleDown = true;
    try { localStorage.setItem(DEAD_KEY, String(Date.now())); } catch { /* 忽略 */ }
  }

  async function requestJson(url, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : 0;
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      throw new Error(aborted
        ? '翻译接口 ' + Math.round(ms / 1000) + ' 秒没响应（可能被当前网络拦截）'
        : '连不上翻译接口（' + (err && err.message ? err.message : '网络问题') + '）');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('翻译接口返回 ' + res.status);
    return res.json();
  }

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n ? String.fromCodePoint(n) : all;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()] || all;
    });
  }

  async function one(text) {
    const data = await requestJson(ENDPOINT + encodeURIComponent(text), GOOGLE_TIMEOUT);
    const segs = Array.isArray(data && data[0]) ? data[0] : [];
    const text2 = segs.map(x => (Array.isArray(x) ? x[0] : '')).filter(Boolean).join('');
    if (!text2) throw new Error('翻译接口没返回内容');
    return text2;
  }

  async function backupOne(text) {
    const url = BACKUP + encodeURIComponent(text) + '&langpair=en|zh-CN';
    let data;
    try {
      data = await requestJson(url, BACKUP_TIMEOUT);
    } catch (err) {
      // 这个源偶尔连不上，连接类错误再试一次
      if (!/没响应|连不上/.test((err && err.message) || '')) throw err;
      data = await requestJson(url, BACKUP_TIMEOUT);
    }
    if (data && data.quotaFinished) throw new Error('备用翻译源今天的额度用完了');
    const text2 = decodeEntities((data && data.responseData && data.responseData.translatedText) || '').trim();
    if (!text2 || /^MYMEMORY WARNING/i.test(text2)) throw new Error('备用翻译源没返回内容');
    return text2;
  }

  /**
   * 英 → 中
   * @returns {Promise<{ok:true,text:string}|{ok:false,reason:string}>}
   */
  async function zh(text) {
    const src = String(text || '').trim();
    if (!src) return { ok: true, text: '' };
    // 只看汉字和拉丁字母的比例，别用“有没有非 ASCII”来判断：
    // 英文简介里常有 emoji / 重音字符，那样会被误判成中文，直接原样返回（看起来就是“点了没反应”）
    const cjk = (src.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = (src.match(/[A-Za-z]/g) || []).length;
    if (cjk > 0 && cjk * 2 >= latin) return { ok: true, text: src };   // 中文字数占一半以上，本来就是中文，不折腾

    const key = cacheKey(src);
    if (mem.has(key)) return { ok: true, text: mem.get(key) };
    if (disk[key]) { mem.set(key, disk[key]); return { ok: true, text: disk[key] }; }

    try {
      const parts = chunk(src);
      const out = [];
      for (const p of parts) {
        if (googleDown) {
          out.push(await backupOne(p));
          continue;
        }
        try {
          out.push(await one(p));
        } catch (err) {
          const msg = (err && err.message) || '翻译失败';
          if (/没响应|连不上/.test(msg)) markGoogleDown();
          try { out.push(await backupOne(p)); }
          catch (err2) { throw new Error(msg + '；备用翻译源也失败：' + ((err2 && err2.message) || err2)); }
        }
      }
      const text2 = out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      mem.set(key, text2);
      disk[key] = text2;
      saveDisk();
      return { ok: true, text: text2 };
    } catch (err) {
      return { ok: false, reason: (err && err.message) || '连不上翻译接口' };
    }
  }

  function clear() {
    mem.clear();
    disk = {};
    googleDown = false;
    try { localStorage.removeItem(KEY); localStorage.removeItem(DEAD_KEY); } catch { /* 忽略 */ }
  }

  MC.translate = { zh, clear };
})(globalThis);
