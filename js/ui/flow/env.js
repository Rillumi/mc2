/* ===== 流程：环境输入、版本列表、分页与选中 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();

  /* ---------- 环境输入 ---------- */
  function syncEnvInputs() {
    const st = S();
    document.querySelectorAll('#segLoader button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.loader === st.env.loader));
    });
  }

  /* ---------- 环境下拉：版本列表 ---------- */
  async function loadMcList() {
    const st = S();
    st.verLoading = true;
    touch();
    try {
      const list = await MC.versions.mcVersions();
      const cur = st.env.mc;
      st.mcList = list.indexOf(cur) >= 0 ? list : [cur].concat(list);
    } catch (err) {
      st.mcList = [st.env.mc];
    } finally {
      st.verLoading = false;
      touch();
    }
  }

  async function loadLoaderList() {
    const st = S();
    st.verLoading = true;
    touch();
    try {
      const list = await MC.versions.loaderVersions(st.env.loader, st.env.mc);
      const cur = st.env.loaderVersion;
      st.loaderList = (cur && list.indexOf(cur) < 0) ? [cur].concat(list) : list;
    } catch (err) {
      st.loaderList = [];
    } finally {
      st.verLoading = false;
      touch();
    }
  }

  /* ---------- 选中 ---------- */
  function findDep(key) {
    return S().deps.find(d => d.key === key);
  }

  function toggleExclude(groupId) {
    const st = S();
    if (st.excluded[groupId]) delete st.excluded[groupId];
    else st.excluded[groupId] = true;
    touch();
  }

  /* ---------- 分页 ---------- */
  function pagerGo(wrap, page) {
    if (!wrap) return;
    const st = S();
    const key = wrap.dataset.pgkey;
    const pages = Math.max(1, Number(wrap.dataset.pgpages) || 1);
    const cur = Number(wrap.dataset.pgpage) || 1;
    let p = Math.floor(Number(page) || 1);
    if (p < 1) p = 1;
    if (p > pages) p = pages;
    if (p === cur) return;
    if (!st.pg) st.pg = {};
    st.pg[key] = p;
    const anchor = wrap.dataset.pganchor;
    touch();
    const target = anchor ? document.querySelector(anchor) : null;
    if (target) {
      const y = target.getBoundingClientRect().top + window.pageYOffset - 14;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  function pagerFromEl(el) {
    const wrap = el.closest('.pager');
    if (!wrap) return;
    const cur = Number(wrap.dataset.pgpage) || 1;
    const to = el.dataset.pg;
    pagerGo(wrap, to === 'prev' ? cur - 1 : to === 'next' ? cur + 1 : Number(to));
  }

  MC.flowEnv = {
    syncEnvInputs, loadMcList, loadLoaderList,
    findDep, toggleExclude, pagerGo, pagerFromEl
  };
})(globalThis);
