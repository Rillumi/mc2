/* 模组图标本地缓存
   渲染时仍然先写外链地址（首屏快），随后这里把图片换成 IndexedDB 里的本地 blob，
   下次打开、甚至断网也能显示。失败就保持外链，不影响使用。 */
(function (globalThis) {
  const MC = (globalThis.MC = globalThis.MC || {});
  const DB = 'modpilot.icons';
  const STORE = 'icons';
  const VER = 1;
  const LIMIT = 1500;            // 最多留这么多张，超了删最旧的
  const MAX_BYTES = 800 * 1024;  // 单张超过 800KB 不存
  const MEM = new Map();         // url -> blob: 地址，整个会话复用
  const PENDING = new Map();     // url -> Promise，同一个图不重复下载
  let dbp = null;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'url' });
          os.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
    return dbp;
  }

  function idb(mode, run) {
    return openDB().then(db => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let out;
        try { out = run(tx.objectStore(STORE)); } catch (e) { reject(e); return; }
        tx.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        tx.onerror = () => reject(tx.error);
      });
    }).catch(() => null);
  }

  function getBlob(url) {
    return idb('readonly', os => os.get(url)).then(rec => (rec && rec.blob) || null);
  }

  function prune() {
    return idb('readonly', os => os.count()).then(n => {
      if (!n || n <= LIMIT) return;
      const need = n - LIMIT;
      return idb('readwrite', os => {
        let removed = 0;
        const cur = os.index('ts').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || removed >= need) return;
          os.delete(c.primaryKey);
          removed++;
          c.continue();
        };
      });
    });
  }

  function putBlob(url, blob) {
    return idb('readwrite', os => os.put({ url, blob, ts: Date.now() })).then(prune);
  }

  function fetchBlob(url) {
    if (PENDING.has(url)) return PENDING.get(url);
    const p = fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (blob && blob.size && blob.size <= MAX_BYTES) putBlob(url, blob);
        return blob;
      })
      .catch(() => null)
      .then(blob => { PENDING.delete(url); return blob; });
    PENDING.set(url, p);
    return p;
  }

  function useBlob(img, url, blob) {
    if (!blob) return;
    let obj = MEM.get(url);
    if (!obj) {
      obj = URL.createObjectURL(blob);
      MEM.set(url, obj);
    }
    img.src = obj;
  }

  function isRemote(url) {
    return typeof url === 'string' && /^https?:/i.test(url) && !/^(blob|data):/i.test(url);
  }

  function hydrateImg(img) {
    if (!img || img.dataset.icDone) return;
    const src = img.getAttribute('src') || '';
    if (!isRemote(src)) return;
    img.dataset.icDone = '1';
    if (MEM.has(src)) { img.src = MEM.get(src); return; }
    getBlob(src).then(blob => {
      if (blob) { useBlob(img, src, blob); return; }
      fetchBlob(src).then(b => useBlob(img, src, b));
    });
  }

  function hydrate(root) {
    const el = root || document;
    if (!el.querySelectorAll) return;
    el.querySelectorAll('img').forEach(hydrateImg);
  }

  function watch() {
    const ob = new MutationObserver(records => {
      records.forEach(rec => {
        if (rec.type !== 'childList') return;
        rec.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'IMG') hydrateImg(node);
          else hydrate(node);
        });
      });
    });
    ob.observe(document.body, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { watch(); hydrate(); });
    } else {
      watch();
      hydrate();
    }
  }

  MC.iconcache = { hydrate, fetchBlob };
})(globalThis);
