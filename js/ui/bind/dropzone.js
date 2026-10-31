/* ===== 绑定：文件选择 / 拖入 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const B = MC.uiBase;
  const S = C.S;
  const touch = C.touch;

  function init() {
    const drop = document.getElementById('drop');
    const input = document.getElementById('fileInput');
    const singleInput = document.getElementById('singleInput');
    if (drop && input) {
      const startPick = () => {
        MC.libraryPanel.chooseFolder().then(used => {
          if (used === false) input.click(); // 不支持文件系统接口时退回普通选择
        });
      };
      drop.addEventListener('click', () => startPick());
      drop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startPick(); }
      });
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) MC.ui.importFiles(files, { fromFolder: true });
      });
      if (singleInput) {
        singleInput.addEventListener('change', () => {
          const files = Array.from(singleInput.files || []);
          singleInput.value = '';
          if (files.length) MC.ui.importFiles(files, { single: true });
        });
      }
      const pickFolder = document.getElementById('pickFolder');
      const pickOne = document.getElementById('pickOne');
      if (pickFolder) pickFolder.addEventListener('click', e => { e.stopPropagation(); startPick(); });
      if (pickOne) pickOne.addEventListener('click', e => {
        e.stopPropagation();
        if (singleInput) singleInput.click();
      });

      /* 我的库：首页只放单行卡，文件夹列表在弹窗里 */
      MC.libraryPanel.init();

      ['dragenter', 'dragover'].forEach(type => {
        drop.addEventListener(type, e => {
          e.preventDefault();
          drop.classList.add('over');
          const n = e.dataTransfer && e.dataTransfer.items ? e.dataTransfer.items.length : 0;
          if (S().dragCount !== n) { S().dragCount = n; touch(); }
        });
      });
      drop.addEventListener('dragleave', e => {
        if (!drop.contains(e.relatedTarget)) {
          drop.classList.remove('over');
          S().dragCount = 0;
          touch();
        }
      });
      drop.addEventListener('drop', async e => {
        e.preventDefault();
        drop.classList.remove('over');
        const st = S();
        st.dragCount = 0;
        // 罗列子文件夹也要有反馈：这一步可能比读 jar 还久
        st.scan = { note: '正在罗列文件夹', done: 0, total: 0, name: '' };
        touch();
        const got = await B.collectDrop(e.dataTransfer);
        if (got.files.length) {
          MC.ui.importFiles(got.files, { fromFolder: got.fromFolder, handle: got.dirHandle });
        } else {
          st.scan = null;
          touch();
        }
      });
    }
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    const diffInput = document.getElementById('diffInput');
    if (diffInput) {
      diffInput.addEventListener('change', () => {
        const files = Array.from(diffInput.files || []);
        diffInput.value = '';
        if (files.length) C.importDiff(files);
      });
    }

    const logInput = document.getElementById('logInput');
    if (logInput) {
      logInput.addEventListener('change', () => {
        const files = Array.from(logInput.files || []);
        logInput.value = '';
        if (files.length) C.importLogs(files);
      });
    }

    /* 对比 / 日志的拖入区（元素是渲染出来的，用委托） */
    document.addEventListener('dragover', e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      e.preventDefault();
      z.classList.add('over');
    });
    document.addEventListener('dragleave', e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (z && !z.contains(e.relatedTarget)) z.classList.remove('over');
    });
    document.addEventListener('drop', async e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      e.preventDefault();
      z.classList.remove('over');
      const isDiff = z.dataset.drop === 'diff';
      const st = S();
      if (isDiff) {
        st.scan = { note: '正在罗列文件夹', done: 0, total: 0, name: '' };
        touch();
      }
      const got = await B.collectDrop(e.dataTransfer);
      if (!got.files.length) {
        if (isDiff) { st.scan = null; touch(); }
        return;
      }
      if (isDiff) C.importDiff(got.files);
      else if (z.dataset.drop === 'log') C.importLogs(got.files);
    });
  }

  MC.bindDrop = { init };
})(globalThis);
