/* ===== 我的库：记住上次的 mods 文件夹 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const esc = MC.uiBase.esc;
  const S = C.S;
  const touch = C.touch;
  const toast = C.toast;

  let libItems = [];

  const pad2 = n => (n < 10 ? '0' + n : String(n));

  function libTime(ms) {
    const d = new Date(Number(ms) || 0);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function permText(p) {
    return p === 'granted' ? '已授权' : p === 'denied' ? '权限被拒绝' : '需要点一次授权';
  }

  /* 首页只放一张单行卡，多个文件夹统一收进弹窗 */
  function renderLibrary() {
    const card = document.getElementById('libCard');
    if (!card) return;
    if (!libItems.length) { card.hidden = true; return; }
    const first = libItems[0];
    const nameEl = document.getElementById('libName');
    const metaEl = document.getElementById('libMeta');
    const openBtn = document.getElementById('libOpen');
    if (libItems.length === 1) {
      const bits = [];
      if (first.count) bits.push(first.count + ' 个模组');
      if (first.at) bits.push('上次扫描 ' + libTime(first.at));
      if (nameEl) nameEl.textContent = first.name;
      if (metaEl) metaEl.textContent = bits.join(' · ') || '已记住这个文件夹';
      if (openBtn) openBtn.textContent = '管理';
    } else {
      if (nameEl) nameEl.textContent = libItems.length + ' 个文件夹';
      if (metaEl) {
        metaEl.textContent = '最近：' + first.name + (first.at ? ' · ' + libTime(first.at) : '');
      }
      if (openBtn) openBtn.textContent = '我的库';
    }
    card.hidden = false;
  }

  async function loadLibrary() {
    if (!MC.library || !MC.library.supported()) return;
    try { libItems = await MC.library.list(); }
    catch (err) { libItems = []; }
    renderLibrary();
  }

  async function saveLibrary(handle, st) {
    try {
      await MC.library.save(handle, { name: handle.name, count: st.mods.length });
      libItems = await MC.library.list();
      renderLibrary();
      const modal = document.getElementById('libModal');
      if (modal && !modal.hidden) renderLibList();
    } catch (err) { /* 记不住只影响下次，不影响这次整理 */ }
  }

  async function rescanItem(it) {
    if (!it || !it.handle) return;
    const st = S();
    let allowed = false;
    try { allowed = await MC.library.permitted(it.handle, true); }
    catch (err) { allowed = false; }
    if (!allowed) return toast('读取权限没拿到，重新用「添加文件夹」选一次吧');

    st.scan = { note: '正在读取「' + (it.name || 'mods') + '」', done: 0, total: 0, name: '' };
    touch();
    let files = [];
    try { files = await MC.library.readFiles(it.handle); }
    catch (err) {
      st.scan = null;
      touch();
      return toast('读不了这个文件夹：' + (err && err.message ? err.message : err));
    }
    if (!files.length) {
      st.scan = null;
      touch();
      return toast('这个文件夹里没有 .jar / .zip');
    }
    showLibModal(false);
    await MC.ui.importFiles(files, { fromFolder: true, replace: true, handle: it.handle });
  }

  async function removeItem(id) {
    try { await MC.library.remove(id); }
    catch (err) { return toast('移除失败：' + (err && err.message ? err.message : err)); }
    libItems = await MC.library.list();
    renderLibrary();
    renderLibList();
    toast('已移除');
  }

  function renderLibList() {
    const box = document.getElementById('libList');
    if (!box) return;
    if (!libItems.length) {
      box.innerHTML = '<div class="lib-empty">还没有记住的文件夹</div>';
      return;
    }
    box.innerHTML = libItems.map(it => {
      const bits = [];
      if (it.count) bits.push(it.count + ' 个模组');
      if (it.at) bits.push(libTime(it.at));
      bits.push(permText(it.perm));
      return '<div class="librow">' +
        '<div class="librow-main"><b>' + esc(it.name) + '</b><small>' + esc(bits.join(' · ')) + '</small></div>' +
        '<div class="librow-acts">' +
        '<button type="button" class="btn soft xs" data-lib-rescan="' + esc(it.id) + '">重扫</button>' +
        '<button type="button" class="btn line xs danger" data-lib-remove="' + esc(it.id) + '">移除</button>' +
        '</div></div>';
    }).join('');
  }

  function showLibModal(on) {
    const m = document.getElementById('libModal');
    if (!m) return;
    m.hidden = !on;
    document.body.classList.toggle('no-scroll', on);
    if (on) renderLibList();
  }

  /* 打开系统文件夹选择器并读取；不支持时返回 false 交给普通 input */
  async function chooseFolder() {
    if (!MC.library || !MC.library.supported()) return false;
    let handle = null;
    try {
      handle = await root.showDirectoryPicker();
    } catch (err) {
      if (err && err.name === 'AbortError') return true; // 用户取消，不算失败
      toast('打不开文件夹选择器：' + (err && err.message ? err.message : err));
      return false;
    }
    const st = S();
    st.scan = { note: '正在读取「' + (handle.name || 'mods') + '」', done: 0, total: 0, name: '' };
    touch();
    let files = [];
    try { files = await MC.library.readFiles(handle); }
    catch (err) {
      st.scan = null;
      touch();
      toast('读不了这个文件夹：' + (err && err.message ? err.message : err));
      return true;
    }
    if (!files.length) {
      st.scan = null;
      touch();
      toast('这个文件夹里没有 .jar / .zip');
      return true;
    }
    await MC.ui.importFiles(files, { fromFolder: true, handle });
    return true;
  }

  /* 我的库相关控件：首页单行卡 + 弹窗列表 */
  function init() {
    const input = document.getElementById('fileInput');

    const libCard = document.getElementById('libCard');
    if (libCard) libCard.addEventListener('click', e => e.stopPropagation());

    const libRescan = document.getElementById('libRescan');
    if (libRescan) libRescan.addEventListener('click', e => {
      e.stopPropagation();
      if (libItems[0]) rescanItem(libItems[0]).catch(err => toast(err && err.message ? err.message : String(err)));
    });

    const libOpen = document.getElementById('libOpen');
    if (libOpen) libOpen.addEventListener('click', e => {
      e.stopPropagation();
      showLibModal(true);
    });

    const libModal = document.getElementById('libModal');
    if (libModal) {
      const closeLib = () => showLibModal(false);
      libModal.addEventListener('click', e => {
        if (e.target.closest('[data-close]')) return closeLib();
        const rescan = e.target.closest('[data-lib-rescan]');
        if (rescan) {
          const it = libItems.find(x => x.id === rescan.dataset.libRescan);
          if (it) rescanItem(it).catch(err => toast(err && err.message ? err.message : String(err)));
          return;
        }
        const rm = e.target.closest('[data-lib-remove]');
        if (rm) removeItem(rm.dataset.libRemove).catch(err => toast(err && err.message ? err.message : String(err)));
      });
      const libClose = document.getElementById('libClose');
      const libDone = document.getElementById('libDone');
      if (libClose) libClose.addEventListener('click', closeLib);
      if (libDone) libDone.addEventListener('click', closeLib);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !libModal.hidden) closeLib();
      });
    }

    const libAdd = document.getElementById('libAdd');
    if (libAdd && input) libAdd.addEventListener('click', e => {
      e.stopPropagation();
      chooseFolder().then(used => {
        if (used === false) input.click();
      });
    });

    loadLibrary();
  }

  MC.libraryPanel = { init, save: saveLibrary, chooseFolder, refresh: loadLibrary };
})(globalThis);
