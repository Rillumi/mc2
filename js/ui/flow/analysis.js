/* ===== 流程：分析、缺前置匹配、适配版本 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast } = MC.uiBase;
  const FC = MC.flowCommon;

  /* ---------- 分析 + 缺前置自动匹配 ---------- */
  async function analyzeAndResolve(resetDeps) {
    const st = S();
    const my = FC.bumpGen();
    const analysis = MC.analyzer.analyze(st.mods, st.env, { includeOptional: st.includeOptional });
    st.analysis = analysis;
    MC.selector.assign(st, analysis);

    if (resetDeps) {
      st.adapt = {};
      st.connector = null;
      st.deps = analysis.missing.map(m => ({
        key: m.id, id: m.id, modId: m.modId, range: m.range,
        requiredBy: m.requiredBy.slice(), searchWord: m.modId,
        status: 'idle', project: null, versions: [], version: null,
        candidates: [], showCand: false,
        added: false, via: '', reason: ''
      }));
    }
    touch();

    const pending = st.deps.filter(d => !(d.status === 'ok' && d.version));
    if (pending.length) {
      // 前置的 modId 大多就是 slug：先用一次批量项目请求全部命中，再并发补版本
      await preResolveDeps(pending);
      if (my !== FC.getGen()) return;
      let cursor = 0;
      const worker = async () => {
        while (cursor < pending.length) {
          if (my !== FC.getGen()) return;
          const dep = pending[cursor++];
          await matchDep(dep, null, my);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
    if (my !== FC.getGen()) return;
    MC.flowMeta.analyzePacks(st);
    touch();
  }

  /** 把一堆前置的 id / modId / 别名 / 记住的 slug 合成一次 /projects?ids= 批量请求 */
  async function preResolveDeps(deps) {
    const map = MC.resolver.loadMap();
    const keys = [];
    const lookup = dep => {
      const cached = map[dep.id] && map[dep.id].slug;
      const alias = MC.resolver.ALIASES[String(dep.id || '').toLowerCase()] ||
        MC.resolver.ALIASES[String(dep.modId || '').toLowerCase()];
      return [cached, alias, dep.id, dep.modId].filter(Boolean);
    };
    deps.forEach(dep => lookup(dep).forEach(k => {
      const low = String(k).toLowerCase();
      if (keys.indexOf(low) < 0) keys.push(low);
    }));
    if (!keys.length) return;
    let projects = [];
    try { projects = await MC.api.modrinth.projectsByIds(keys); } catch (err) { return; }
    const by = new Map();
    projects.forEach(p => {
      [p.slug, p.id].filter(Boolean).forEach(k => by.set(String(k).toLowerCase(), p));
    });
    deps.forEach(dep => {
      const hit = lookup(dep).map(k => by.get(String(k).toLowerCase())).find(Boolean);
      if (hit) dep.prematch = { id: hit.id, slug: hit.slug, title: hit.title };
    });
  }

  async function matchDep(dep, word, my) {
    const st = S();
    dep.status = 'loading';
    if (word) dep.searchWord = word;
    dep.reason = '';
    dep.showCand = false;
    touch();
    try {
      const res = await MC.resolver.resolve(dep, {
        env: st.env,
        range: dep.range,
        searchWord: word || ''
      });
      if (my && my !== FC.getGen()) return;
      dep.via = res.via || '';
      dep.candidates = res.candidates || [];
      if (res.ok) {
        dep.project = res.project;
        dep.versions = res.versions;
        dep.version = res.version;
        dep.searchWord = res.searchWord || dep.searchWord;
        dep.added = true;
        dep.status = 'ok';
      } else {
        dep.project = res.project || null;
        dep.version = null;
        dep.versions = [];
        dep.reason = res.reason || '没匹配上';
        dep.added = false;
        dep.status = 'none';
      }
    } catch (err) {
      if (my && my !== FC.getGen()) return;
      dep.status = 'error';
      dep.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  async function chooseCandidate(dep, slug) {
    const st = S();
    const my = FC.getGen();
    dep.status = 'loading';
    dep.reason = '';
    touch();
    try {
      const res = await MC.resolver.resolveSlug(slug, st.env, dep.range);
      if (my !== FC.getGen() || !st.deps.includes(dep)) return;
      if (res.ok) {
        dep.project = res.project;
        dep.versions = res.versions;
        dep.version = res.version;
        dep.added = true;
        dep.status = 'ok';
        dep.via = '你从候选里选的';
        dep.candidates = (dep.candidates || []).filter(c => c.slug !== slug);
        dep.candidates.unshift({
          slug,
          title: res.project.title,
          description: res.project.description || '',
          downloads: res.project.downloads || 0
        });
      } else {
        dep.added = false;
        dep.version = null;
        dep.versions = [];
        dep.status = 'none';
        dep.reason = res.reason || '这个项目用不了';
      }
    } catch (err) {
      dep.status = 'error';
      dep.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  /* ---------- 不兼容 / 版本不够 → 找适配版本 ---------- */
  function providerGroups(st, id) {
    const target = MC.analyzer.normDep(id);
    return (st.analysis ? st.analysis.groups : []).filter(g =>
      g.usableRows.some(r => (r.entry.allIds || [r.entry.id]).some(x => MC.analyzer.normDep(x) === target)));
  }

  async function runAdapt(key, target, range) {
    const st = S();
    const my = FC.getGen();
    const ad = { key, status: 'loading', added: false, reason: '' };
    Object.assign(ad, target);
    st.adapt[key] = ad;
    touch();
    try {
      const res = await MC.resolver.resolve(
        { id: target.id, modId: target.title || target.id, searchWord: '' },
        { env: st.env, range: range || '' }
      );
      if (my !== FC.getGen() || st.adapt[key] !== ad) return;
      if (res.ok) {
        ad.project = res.project;
        ad.versions = res.versions;
        ad.version = res.version;
        ad.status = 'ok';
        ad.reason = '';
      } else {
        ad.status = 'none';
        ad.reason = res.reason || '没找到适配版本';
      }
    } catch (err) {
      if (my !== FC.getGen() || st.adapt[key] !== ad) return;
      ad.status = 'none';
      ad.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  function addAdapt(ad) {
    const st = S();
    const ids = [];
    if (ad.kind === 'group' && ad.groupId) ids.push(ad.groupId);
    else if (ad.kind === 'issue') providerGroups(st, ad.id).forEach(g => ids.push(g.id));
    ad.excludedGroups = ids.map(id => ({ id, had: !!st.excluded[id] }));
    ids.forEach(id => { st.excluded[id] = true; });
    ad.added = true;
    touch();
  }

  function removeAdapt(ad) {
    if (!ad) return;
    const st = S();
    (ad.excludedGroups || []).forEach(o => { if (!o.had) delete st.excluded[o.id]; });
    ad.excludedGroups = [];
    ad.added = false;
    touch();
  }

  async function retryAll() {
    const my = FC.getGen();
    const list = S().deps.filter(d => !(d.status === 'ok' && d.version));
    if (!list.length) return toast('没有需要重试的');
    toast('重新匹配 ' + list.length + ' 个…');
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        if (my !== FC.getGen()) return;
        const dep = list[cursor++];
        await matchDep(dep, null, my);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  MC.flowAnalysis = {
    analyzeAndResolve, preResolveDeps, matchDep, chooseCandidate,
    providerGroups, runAdapt, addAdapt, removeAdapt, retryAll
  };
})(globalThis);
