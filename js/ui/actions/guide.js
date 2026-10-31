/* ===== 动作：导览页（分类筛选、检查更新、导出） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  Object.assign(acts, {
    guidecat(el, st) {
      st.guideCat = el.dataset.cat || 'all';
      MC.pager.reset('guide');
      touch();
    },

    checkupdates() {
      C.checkAllUpdates();
    },

    checkupdate(el) {
      if (el.dataset.group) C.checkOneUpdate(el.dataset.group);
    },

    guideexport() {
      C.exportGuide();
    }
  });
})(globalThis);
