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

  /* ---------- Fabric 转接：找当前环境下能用的 Sinytra Connector ---------- */
  async function findConnector() {
    const st = S();
    if (st.connector && st.connector.status === 'loading') return;
    st.connector = { status: 'loading', mc: st.env.mc, loader: st.env.loader };
    touch();
    try {
      const [conn, ffapi] = await Promise.all([
        MC.api.modrinth.project('sinytra-connector'),
        MC.api.modrinth.project('forgified-fabric-api')
      ]);
      const env = { loader: st.env.loader, mc: st.env.mc };
      const [cv, fv] = await Promise.all([
        conn ? MC.api.modrinth.versions(conn.id, env) : [],
        ffapi ? MC.api.modrinth.versions(ffapi.id, env) : []
      ]);
      const c = MC.api.modrinth.pickVersion(cv);
      const f = MC.api.modrinth.pickVersion(fv);
      const items = [];
      if (c) {
        items.push({
          name: 'Sinytra Connector', version: c.version_number,
          url: (c.files && c.files[0] && c.files[0].url) || '',
          page: 'https://modrinth.com/mod/sinytra-connector/version/' + c.id
        });
      }
      if (f) {
        items.push({
          name: 'Forgified Fabric API', version: f.version_number,
          url: (f.files && f.files[0] && f.files[0].url) || '',
          page: 'https://modrinth.com/mod/forgified-fabric-api/version/' + f.id
        });
      }
      st.connector = { status: items.length ? 'ok' : 'none', mc: st.env.mc, loader: st.env.loader, items };
    } catch (err) {
      st.connector = { status: 'error', reason: (err && err.message) || '连不上 Modrinth' };
    }
    touch();
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
    syncEnvInputs, loadMcList, loadLoaderList, findConnector,
    findDep, toggleExclude, pagerGo, pagerFromEl
  };
})(globalThis);
