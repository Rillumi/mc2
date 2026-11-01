/* ===== 绑定：全局兜底 / 分页 / 启动 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const S = C.S;
  const touch = C.touch;

  function init() {
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
    if (MC.afdianMap) MC.afdianMap.load().then(() => touch()).catch(() => {});
  }

  MC.bindGlobal = { init };
})(globalThis);
