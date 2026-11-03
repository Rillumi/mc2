/* ===== 动作：工具页（日志、链接仓库、资源包顺序、爱发电） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  Object.assign(acts, {
    autolog() {
      C.autoLog();
    },

    siteset(el, st) {
      st.siteFilter = el.dataset.site || 'all';
      MC.pager.reset('links');
      touch();
    },

    'pick-log'() {
      const inp = document.getElementById('logInput');
      if (inp) inp.click();
    },

    logclear(el, st) {
      st.logs = { name: '', findings: [], lines: 0, errors: 0 };
      touch();
    },

    'rp-up'(el) {
      C.movePack(el.dataset.uid, -1);
    },

    'rp-down'(el) {
      C.movePack(el.dataset.uid, 1);
    },

    'rpsort'() {
      C.suggestOrder();
    },

    'rpexport-order'() {
      C.exportPackOrder();
    },

    'rpexport-options'() {
      C.exportPackOptions();
    },

    linkadd(el) {
      const id = el.dataset.id || '';
      const name = el.dataset.name || '';
      const url = ((document.getElementById('linkUrl') || {}).value || '').trim();
      const note = ((document.getElementById('linkNote') || {}).value || '').trim();
      if (!/^https?:\/\//i.test(url)) { C.toast('链接要以 http:// 或 https:// 开头'); return; }
      C.addLink(id, name, url, note);
    },

    linkdel(el) {
      C.removeLink({
        id: Number(el.dataset.row) || 0,
        modId: el.dataset.mod || '',
        url: el.dataset.url || ''
      });
    },

    linkbulk() {
      const ta = document.getElementById('linkBulk');
      if (ta) C.bulkLinks(ta);
    },

    afdianrefresh() {
      C.refreshAfdian();
    },

    afdianmapsync() {
      C.syncAfdianMap();
    }
  });
})(globalThis);
