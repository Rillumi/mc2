/* ===== 检查更新：用 Modrinth 查这个 modId 有没有更新版本 =====
   本地 modId 不一定等于 Modrinth 的 slug，查不到就如实标「未收录」，
   不拿搜索结果硬认成同一个模组。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function projectUrl(p) {
    return 'https://modrinth.com/mod/' + encodeURIComponent(String((p && (p.slug || p.id)) || ''));
  }

  function slugCandidates(entry) {
    const base = String((entry && entry.id) || '').toLowerCase().trim();
    if (!base) return [];
    const list = [base];
    const dashed = base.replace(/_/g, '-');
    if (dashed !== base) list.push(dashed);
    // 很多项目的 slug 是把下划线/横线都去掉的，例如 kaleidoscope_tavern → kaleidoscopetavern
    const flat = base.replace(/[_-]/g, '');
    if (flat !== base && flat !== dashed) list.push(flat);
    return list;
  }

  /* 搜索结果只认同一个模组：slug 等于本地 modId，或标题按统一判重完全一致 */
  const SEARCH_LEVELS = [MC.identity.LEVELS.MOD, MC.identity.LEVELS.NAME];
  function sameHit(entry, hit) {
    return MC.identity.same(entry, { id: hit.slug, name: hit.title }, SEARCH_LEVELS);
  }

  async function findProject(entry) {
    for (const slug of slugCandidates(entry)) {
      try {
        const p = await MC.api.modrinth.project(slug);
        if (p) return p;
      } catch (err) { /* 继续试下一个写法 */ }
    }

    // 兜底：按名字搜一次，只认同一个模组的，避免把别的模组当成同一个
    const name = String((entry && entry.name) || '').trim();
    if (!name) return null;
    try {
      const hits = await MC.api.modrinth.search(name, { limit: 5, facets: [['project_type:mod']] });
      const hit = (hits || []).find(h => sameHit(entry, h));
      if (hit) return { id: hit.project_id, slug: hit.slug, title: hit.title };
    } catch (err) { /* 搜不到就算了 */ }
    return null;
  }

  /** 返回 { status: current|newer|notfound|nomatch|error, latest?, url?, reason? } */
  async function check(entry, env) {
    if (!entry || !entry.id) return { status: 'notfound' };
    let proj;
    try {
      proj = await findProject(entry);
    } catch (err) {
      return { status: 'error', reason: err && err.message ? err.message : String(err) };
    }
    if (!proj) return { status: 'notfound' };

    let versions;
    try {
      versions = await MC.api.modrinth.versions(proj.id || proj.slug, env);
    } catch (err) {
      return { status: 'error', reason: err && err.message ? err.message : String(err), url: projectUrl(proj) };
    }
    if (!versions || !versions.length) {
      return { status: 'nomatch', url: projectUrl(proj), project: proj.title };
    }

    const latest = MC.api.modrinth.pickVersion(versions, '');
    if (!latest) return { status: 'nomatch', url: projectUrl(proj), project: proj.title };

    const cmp = entry.version ? MC.version.compare(latest.version_number, entry.version) : 1;
    return {
      status: cmp > 0 ? 'newer' : 'current',
      latest: latest.version_number,
      installed: entry.version || '',
      url: projectUrl(proj),
      project: proj.title,
      at: Date.now()
    };
  }

  MC.updates = { check, projectUrl, findProject };
})(globalThis);
