/* ===== 简介机翻：谷歌公开翻译接口（无需 key，CORS 允许跨域） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const KEY = 'modpilot.tr.v1';
  const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=';

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

  /* 长文本按句子切成小段，逐段翻，避免单次 URL 过长或被截断 */
  function chunk(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= 480) return clean ? [clean] : [];
    const out = [];
    let buf = '';
    clean.split(/(?<=[.!?;:。！？；])\s+/).forEach(part => {
      if ((buf + ' ' + part).length > 480 && buf) { out.push(buf.trim()); buf = part; }
      else buf = buf ? buf + ' ' + part : part;
    });
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  async function one(text) {
    const url = ENDPOINT + encodeURIComponent(text);
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('翻译接口返回 ' + res.status);
    const data = await res.json();
    const segs = Array.isArray(data && data[0]) ? data[0] : [];
    const text2 = segs.map(x => (Array.isArray(x) ? x[0] : '')).filter(Boolean).join('');
    if (!text2) throw new Error('翻译接口没返回内容');
    return text2;
  }

  /**
   * 英 → 中
   * @returns {Promise<{ok:true,text:string}|{ok:false,reason:string}>}
   */
  async function zh(text) {
    const src = String(text || '').trim();
    if (!src) return { ok: true, text: '' };
    if (!/^[\x00-\x7F]*$/.test(src)) return { ok: true, text: src };   // 本来就是中文，不折腾

    const key = cacheKey(src);
    if (mem.has(key)) return { ok: true, text: mem.get(key) };
    if (disk[key]) { mem.set(key, disk[key]); return { ok: true, text: disk[key] }; }

    try {
      const parts = chunk(src);
      const out = [];
      for (const p of parts) out.push(await one(p));
      const text2 = out.join('');
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
    try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
  }

  MC.translate = { zh, clear };
})(globalThis);
