/* ===== 动作：页签、弹窗与全局状态 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx; // events.js 先加载，这里取一次
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  Object.assign(acts, {
    close(el, st) {
      st.detail = null;
      st.previewOpen = false;
      st.packPick = false;
      touch();
    },

    tab(el, st) {
      if (!el.dataset.tab) return;
      st.tab = el.dataset.tab;
      st.picker = null;
      touch();
      // 第一次进工具页，顺手读一次最新日志
      if (st.tab === 'tools' && !st.logs.name && !st.logAutoTried) {
        st.logAutoTried = true;
        C.autoLog();
      }
    },

    'open-folder'() {
      const inp = document.getElementById('fileInput');
      if (inp) inp.click();
    },

    'copy-file'(el) {
      C.copyText(el.dataset.file || '');
    },

    gotools(el, st) {
      st.detail = null;
      st.previewOpen = false;
      st.tab = 'tools';
      touch();
    },

    'open-preview'(el, st) {
      st.previewOpen = true;
      st.detail = null;
      touch();
    },

    'exit-single'(el, st) {
      st.mode = 'folder';
      st.detail = null;
      touch();
      C.toast('已退出单模组模式，现在可以拖 mods 文件夹');
    },

    'toggle-select'(el, st) {
      st.selectMode = !st.selectMode;
      if (!st.selectMode) st.picker = null;
      touch();
    },

    picktoggle(el, st) {
      const pk = el.dataset.pick;
      st.picker = st.picker === pk ? null : pk;
      touch();
    },

    pickset(el, st) {
      const pk = el.dataset.pick;
      const value = el.dataset.value;
      st.picker = null;
      if (pk === 'env:mc') {
        if (value && value !== st.env.mc) {
          st.env.mc = value;
          st.updates = {};
          st.updateBusy = false;
          st.updateError = '';
          st.connector = null;
          MC.store.saveEnv();
          touch();
          C.analyzeAndResolve(true);
          C.loadLoaderList();
        }
      } else if (pk === 'env:ld') {
        st.env.loaderVersion = value;
        MC.store.saveEnv();
        touch();
      } else if (pk.indexOf('g:') === 0) {
        st.selection[pk.slice(2)] = value;
      } else if (pk.indexOf('d:') === 0) {
        const dep = C.findDep(pk.slice(2));
        if (dep) dep.version = (dep.versions || []).find(v => v.id === value) || dep.version;
      } else if (pk.indexOf('a:') === 0) {
        const ad = st.adapt[pk.slice(2)];
        if (ad) ad.version = (ad.versions || []).find(v => v.id === value) || ad.version;
      } else if (pk.indexOf('p:') === 0) {
        st.rpPair[pk.slice(2)] = value;
      }
      touch();
    },

    pg(el) {
      C.pagerFromEl(el);
    }
  });
})(globalThis);
