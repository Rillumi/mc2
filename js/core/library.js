/* ===== 我的库：记住上次用的 mods 文件夹 =====
   用 File System Access API 拿到的目录句柄可以存进 IndexedDB，
   下次打开页面就能直接重扫（第一次需要点一下授权）。
   浏览器不支持时退回普通的 webkitdirectory 选择，只是记不住。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const DB_NAME = 'modpilot-library';
  const STORE = 'folders';
  const KEY = 'mods';
  const LS_KEY = 'modpilot.lib.v1';

  function supported() {
    return typeof root.showDirectoryPicker === 'function';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打不开本地库'));
    });
  }

  function tx(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      t.onerror = () => { db.close(); reject(t.error || new Error('本地库读写失败')); };
      t.onabort = () => { db.close(); reject(t.error || new Error('本地库操作取消')); };
    }));
  }

  /* meta 只用来快速显示「几个模组 / 什么时候扫的」，句柄本身才是能重扫的关键 */
  function save(handle, meta) {
    const info = {
      name: (meta && meta.name) || (handle && handle.name) || 'mods',
      count: Number(meta && meta.count) || 0,
      at: Date.now()
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(info)); } catch (err) { /* 忽略 */ }
    return tx('readwrite', s => s.put({ handle, meta: info }, KEY)).then(() => info);
  }

  function savedInfo() {
    try {
      const obj = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return obj && typeof obj === 'object' ? obj : null;
    } catch (err) {
      return null;
    }
  }

  function load() {
    return tx('readonly', s => s.get(KEY)).then(rec => rec || null).catch(() => null);
  }

  function forget() {
    try { localStorage.removeItem(LS_KEY); } catch (err) { /* 忽略 */ }
    return tx('readwrite', s => s.delete(KEY)).catch(() => null);
  }

  /* 页面重开后权限会变回 prompt，必须由用户点击触发 requestPermission */
  async function permitted(handle, request) {
    const opts = { mode: 'read' };
    if (!handle || !handle.queryPermission) return true;
    let state = await handle.queryPermission(opts);
    if (state === 'granted') return true;
    if (!request) return false;
    state = await handle.requestPermission(opts);
    return state === 'granted';
  }

  async function readFiles(dir) {
    const out = [];
    const walk = async d => {
      const it = d.entries();
      while (true) {
        const step = await it.next();
        if (step.done) break;
        const name = step.value[0];
        const h = step.value[1];
        if (h.kind === 'file') {
          if (!/\.(jar|zip)$/i.test(name)) continue;
          try { out.push(await h.getFile()); } catch (err) { /* 单个文件读不了就跳过 */ }
        } else if (h.kind === 'directory') {
          await walk(h);
        }
      }
    };
    await walk(dir);
    return out;
  }

  MC.library = { supported, save, load, savedInfo, forget, permitted, readFiles };
})(globalThis);
