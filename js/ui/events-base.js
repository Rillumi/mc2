/* ===== 事件层公共工具：提示、复制、下载、拖拽读取、哈希 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  /* ---------- 小工具 ---------- */
  let toastTimer = null;
  function toast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* 复制文件路径：浏览器打不开资源管理器，只能把路径递到剪贴板 */
  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('已复制：' + text),
        () => toast('复制失败，手动记一下：' + text)
      );
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制：' + text); }
    catch (err) { toast('复制失败，手动记一下：' + text); }
    ta.remove();
  }

  /* ---------- 拖入文件夹 ---------- */
  function walkEntry(entry, out) {
    return new Promise(resolve => {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(f => {
          try {
            // 记住它在文件夹里的相对路径，详情里能直接对上文件名
            Object.defineProperty(f, 'modpilotPath', {
              value: (entry.fullPath || ('/' + f.name)).replace(/^\/+/, ''),
              configurable: true
            });
          } catch (err) { /* 某些浏览器不让加属性，就算了 */ }
          out.push(f);
          resolve();
        }, () => resolve());
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const next = () => reader.readEntries(async batch => {
          if (!batch.length) return resolve();
          for (const e of batch) await walkEntry(e, out);
          next();
        }, () => resolve());
        next();
        return;
      }
      resolve();
    });
  }

  async function collectDrop(dt) {
    if (!dt) return { files: [], fromFolder: false, dirHandle: null };
    const entries = [];
    const handleReqs = [];
    let fromFolder = false;
    if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
      for (const item of dt.items) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (entry) {
          if (entry.isDirectory) fromFolder = true;
          entries.push(entry);
        }
        // 拖进来的文件夹也能拿到句柄，存起来就能下次一键重扫
        if (item.getAsFileSystemHandle) {
          try { handleReqs.push(item.getAsFileSystemHandle()); } catch (err) { /* 忽略 */ }
        }
      }
    }
    let dirHandle = null;
    if (handleReqs.length) {
      try {
        const got = await Promise.all(handleReqs.map(p => Promise.resolve(p).catch(() => null)));
        const dir = got.find(h => h && h.kind === 'directory');
        if (dir) dirHandle = dir;
      } catch (err) { /* 忽略 */ }
    }
    if (entries.length) {
      const out = [];
      for (const e of entries) await walkEntry(e, out);
      if (out.length) return { files: out, fromFolder, dirHandle };
    }
    return { files: Array.from(dt.files || []), fromFolder, dirHandle };
  }

  /* ---------- 哈希 ---------- */
  function sha1Hex(buf) {
    try {
      if (!globalThis.crypto || !globalThis.crypto.subtle) return Promise.resolve('');
      return globalThis.crypto.subtle.digest('SHA-1', buf).then(d => {
        const bytes = new Uint8Array(d);
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
        return s;
      }).catch(() => '');
    } catch (err) {
      return Promise.resolve('');
    }
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  MC.uiBase = { toast, saveBlob, copyText, walkEntry, collectDrop, sha1Hex, esc };
})(globalThis);
