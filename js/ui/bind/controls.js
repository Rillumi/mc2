/* ===== 绑定：工具栏 / 筛选 / 搜索框 / 清空 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const S = C.S;
  const touch = C.touch;

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

  function init() {
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
  }

  MC.bindControls = { init };
})(globalThis);
