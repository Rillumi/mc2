/* ===== 我的库：记住多个 mods 文件夹 =====
   用 File System Access API 拿到的目录句柄存进 IndexedDB，
   下次打开页面就能直接重扫（第一次需要点一下授权）。
   浏览器不支持时退回普通的 webkitdirectory 选择，只是记不住。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const DB_NAME = 'modpilot-library';
  const STORE = 'folders';
  const KEY = 'library.v2';
  const LEGACY = 'mods';
  const MAX = 20;

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

  function writeState(state) {
    return tx('readwrite', s => s.put(state, KEY));
  }

  async function readState() {
    const rec = await tx('readonly', s => s.get(KEY));
    if (rec && Array.isArray(rec.items)) return rec;
    // 旧版只存了一个文件夹（key = 'mods'），顺手迁移过来
    const old = await tx('readonly', s => s.get(LEGACY));
    if (old && old.handle) {
      const state = {
        items: [{
          id: 'lib_legacy',
          handle: old.handle,
          meta: old.meta || { name: old.handle.name || 'mods', count: 0, at: Date.now() }
        }]
      };
      await writeState(state);
      await tx('readwrite', s => s.delete(LEGACY));
      return state;
    }
    return { items: [] };
  }

  async function sameEntry(a, b) {
    if (!a || !b) return false;
    if (a.isSameEntry) {
      try { return await a.isSameEntry(b); } catch (err) { /* 有些环境不支持 */ }
    }
    return (a.name || '') === (b.name || '') && (a.kind || '') === (b.kind || '');
  }

  /* 存文件夹；同一个文件夹再次扫描只更新时间，不会重复添加 */
  async function save(handle, meta) {
    const state = await readState();
    const now = Date.now();
    const name = (meta && meta.name) || (handle && handle.name) || 'mods';
    const count = Number(meta && meta.count) || 0;
    let item = null;
    for (const it of state.items) {
      if (await sameEntry(it.handle, handle)) { item = it; break; }
    }
    if (item) {
      item.handle = handle;
      item.meta = { name, count, at: now };
    } else {
      item = {
        id: 'lib_' + now + '_' + Math.random().toString(36).slice(2, 6),
        handle, meta: { name, count, at: now }
      };
    }
    state.items = state.items.filter(x => x !== item);
    state.items.unshift(item);
    state.items = state.items.slice(0, MAX);
    await writeState(state);
    return { id: item.id, name, count, at: now };
  }

  async function list() {
    const state = await readState();
    const out = [];
    for (const it of state.items.slice(0, MAX)) {
      if (!it || !it.handle) continue;
      let perm = 'granted';
      try {
        if (it.handle.queryPermission) perm = await it.handle.queryPermission({ mode: 'read' });
      } catch (err) { perm = 'prompt'; }
      out.push({
        id: it.id,
        handle: it.handle,
        name: (it.meta && it.meta.name) || it.handle.name || 'mods',
        count: Number(it.meta && it.meta.count) || 0,
        at: Number(it.meta && it.meta.at) || 0,
        perm
      });
    }
    return out;
  }

  async function remove(id) {
    const state = await readState();
    state.items = state.items.filter(it => it.id !== id);
    return writeState(state);
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

  MC.library = { supported, save, list, remove, permitted, readFiles };
})(globalThis);
