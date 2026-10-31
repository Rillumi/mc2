/* ===== 动作：对比页（导入、筛选、清空） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  Object.assign(acts, {
    'pick-diff'() {
      const inp = document.getElementById('diffInput');
      if (inp) inp.click();
    },

    diffclear(el, st) {
      st.diff = { mods: [], others: [], at: 0 };
      st.diffFilter = 'diff';
      MC.pager.reset('diff');
      MC.pager.reset('diffpacks');
      touch();
    },

    diffFilter(el, st) {
      const f = el.dataset.df || 'diff';
      if (st.diffFilter === f) return;
      st.diffFilter = f;
      MC.pager.reset('diff');
      touch();
    }
  });
})(globalThis);
