/* ===== 绑定：把 DOM 事件接到动作分发上 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const B = MC.uiBase;
  const S = C.S;
  const touch = C.touch;

  function init() {
    /* 搜索框边打边筛：停下 150ms 才重绘；按钮 / 回车立即执行 */
    const timers = {};
    const later = (key, fn) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        delete timers[key];
        fn();
      }, 150);
    };
    const now = (key, fn) => {
      clearTimeout(timers[key]);
      delete timers[key];
      fn();
    };
    const cancel = key => {
      clearTimeout(timers[key]);
      delete timers[key];
    };

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

    /* 页签 */
    const tabs = document.getElementById('tabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tab]');
        if (btn) C.handleAct('tab', btn);
      });
    }

    /* 左侧栏：游戏版本 / 加载器版本下拉 */
    const rail = document.querySelector('.rail');
    if (rail) {
      rail.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
    }

    /* 导览 */
    const guideView = document.getElementById('guideView');
    if (guideView) {
      const commitGuide = () => {
        touch();
        const again = document.getElementById('guideQuery');
        if (again) {
          again.focus();
          const n = again.value.length;
          again.setSelectionRange(n, n);
        }
      };
      guideView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
      guideView.addEventListener('input', e => {
        const inp = e.target.closest('#guideQuery');
        if (!inp) return;
        S().guideQuery = inp.value;
        MC.pager.reset('guide');
        later('guide', commitGuide);
      });
      guideView.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('#guideQuery') && e.key === 'Enter') {
          e.preventDefault();
          now('guide', commitGuide);
          return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.gcard');
        if (!card) return;
        e.preventDefault();
        C.handleAct('detail', card);
      });
    }

    /* 对比 */
    const diffView = document.getElementById('diffView');
    if (diffView) {
      diffView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
      diffView.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const z = e.target.closest('[data-drop]');
        if (!z) return;
        e.preventDefault();
        C.handleAct(z.dataset.act, z);
      });
    }

    /* 工具 */
    const toolsView = document.getElementById('toolsView');
    if (toolsView) {
      toolsView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
      toolsView.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const z = e.target.closest('[data-drop]');
        if (!z) return;
        e.preventDefault();
        C.handleAct(z.dataset.act, z);
      });
    }

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

    const seg = document.getElementById('segLoader');
    if (seg) {
      seg.addEventListener('click', e => {
        const btn = e.target.closest('button[data-loader]');
        if (!btn) return;
        const st = S();
        const loader = btn.dataset.loader;
        if (st.env.loader === loader) return;
        const isDefault = st.env.loaderVersion === MC.store.DEFAULTS[st.env.loader] || !st.env.loaderVersion;
        st.env.loader = loader;
        if (isDefault) st.env.loaderVersion = MC.store.DEFAULTS[loader];
        st.updates = {};
        st.updateBusy = false;
        st.updateError = '';
        MC.store.saveEnv();
        C.syncEnvInputs();
        st.connector = null;
        touch();
        C.analyzeAndResolve(true);
        C.loadLoaderList();
      });
    }

    const filters = document.getElementById('filters');
    if (filters) {
      filters.addEventListener('click', e => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        S().filter = btn.dataset.filter;
        MC.pager.reset('organize');
        touch();
      });
    }

    const orgQuery = document.getElementById('orgQuery');
    const orgClear = document.getElementById('orgClear');
    const commitOrg = () => {
      if (orgQuery) S().organizeQuery = orgQuery.value.trim();
      MC.pager.reset('organize');
      touch();
    };
    if (orgQuery) {
      orgQuery.addEventListener('input', () => {
        if (orgClear) orgClear.hidden = !orgQuery.value;
        S().organizeQuery = orgQuery.value;
        MC.pager.reset('organize');
        later('organize', () => touch());
      });
      orgQuery.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          now('organize', commitOrg);
          return;
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancel('organize');
          orgQuery.value = '';
          if (orgClear) orgClear.hidden = true;
          S().organizeQuery = '';
          MC.pager.reset('organize');
          touch();
        }
      });
    }
    if (orgClear) {
      orgClear.addEventListener('click', () => {
        cancel('organize');
        if (orgQuery) orgQuery.value = '';
        orgClear.hidden = true;
        S().organizeQuery = '';
        MC.pager.reset('organize');
        touch();
        if (orgQuery) orgQuery.focus();
      });
    }

    const orgSearchBtn = document.getElementById('orgSearchBtn');
    if (orgSearchBtn) {
      orgSearchBtn.addEventListener('click', () => now('organize', commitOrg));
    }

    const selectBtn = document.getElementById('selectBtn');
    if (selectBtn) {
      selectBtn.addEventListener('click', () => {
        S().selectMode = !S().selectMode;
        touch();
        C.toast(S().selectMode ? '勾选要进包的模组，不要的点掉' : '选择完成');
      });
    }

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const st = S();
        if (!st.mods.length) return;
        if (!confirm('清空当前的扫描结果？只清页面，不会动你电脑里的 jar 文件。')) return;
        C.bumpGen();
        st.mods = [];
        st.analysis = null;
        st.selection = {};
        st.excluded = {};
        st.deps = [];
        st.adapt = {};
        st.connector = null;
        st.filter = 'all';
        st.mode = 'folder';
        st.selectMode = false;
        st.tab = 'organize';
        st.organizeQuery = '';
        const oq = document.getElementById('orgQuery');
        if (oq) oq.value = '';
        const oc = document.getElementById('orgClear');
        if (oc) oc.hidden = true;
        st.updates = {};
        st.updateBusy = false;
        st.updateError = '';
        st.diff = { mods: [], others: [], at: 0 };
        st.diffFilter = 'diff';
        st.rpOrder = [];
        st.projects = {};
        st.hashProject = {};
        st.packAdvice = null;
        st.mr = {};
        st.descTr = {};
        st.bodyTr = {};
        st.logs = { name: '', findings: [], lines: 0, errors: 0 };
        st.detail = null;
        st.previewOpen = false;
        st.progress = '';
        MC.pager.resetAll();
        touch();
      });
    }

    // 行 / 面板 / 弹窗统一用事件委托
    const rows = document.getElementById('rows');
    if (rows) {
      rows.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
      rows.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.row');
        if (!row) return;
        e.preventDefault();
        C.handleAct('detail', row);
      });
    }

    const deps = document.getElementById('deps');
    if (deps) {
      deps.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el && el.dataset.act !== 'depword') C.handleAct(el.dataset.act, el);
      });
      deps.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('input[data-act="depword"]');
        if (!input) return;
        e.preventDefault();
        const dep = C.findDep(input.dataset.key);
        if (dep) C.matchDep(dep, input.value.trim(), C.getGen());
      });
    }

    const pack = document.getElementById('pack');
    if (pack) {
      pack.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
    }

    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) C.handleAct(el.dataset.act, el);
      });
      const commitPreview = () => {
        touch();
        const again = document.getElementById('previewQuery');
        if (again) {
          again.focus();
          const n = again.value.length;
          again.setSelectionRange(n, n);
        }
      };
      overlay.addEventListener('input', e => {
        const inp = e.target.closest('#previewQuery');
        if (!inp) return;
        S().previewQuery = inp.value;
        later('preview', commitPreview);
      });
      overlay.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('#previewQuery') && e.key === 'Enter') {
          e.preventDefault();
          now('preview', commitPreview);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); C.handleAct('close', overlay); }
      });
    }

    document.addEventListener('click', e => {
      if (!S().picker) return;
      if (e.target.closest('.picker')) return;
      S().picker = null;
      touch();
    });

    // 分页：跳页输入框回车、每页条数切换
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const inp = e.target.closest && e.target.closest('input[data-act="pgjump"]');
      if (!inp) return;
      e.preventDefault();
      C.pagerGo(inp.closest('.pager'), inp.value);
    });

    document.addEventListener('change', e => {
      const sel = e.target.closest && e.target.closest('select[data-act="pgsize"]');
      if (!sel) return;
      const st = S();
      const n = Number(sel.value);
      st.pageSize = MC.pager.SIZES.indexOf(n) >= 0 ? n : MC.pager.DEFAULT_SIZE;
      MC.store.savePageSize();
      MC.pager.resetAll();
      touch();
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const st = S();
      if (st.detail || st.previewOpen) { st.detail = null; st.previewOpen = false; touch(); }
      else if (st.picker) { st.picker = null; touch(); }
    });

    C.syncEnvInputs();
    C.loadMcList();
    C.loadLoaderList();
    MC.linksdb.boot().then(C.syncDbState).catch(() => C.syncDbState());
    if (MC.afdian) MC.afdian.boot().catch(() => {});
  }

  MC.ui.init = init;
})(globalThis);
