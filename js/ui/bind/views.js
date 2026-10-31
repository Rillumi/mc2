/* ===== 绑定：页签 / 视图点击 / 行操作 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const S = C.S;
  const touch = C.touch;

  /* 停下 150ms 才重绘；回车立即执行 */
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

  function init() {
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
  }

  MC.bindViews = { init };
})(globalThis);
