/* ===== 检查更新：用 Modrinth 查这个 modId 有没有更新版本 =====
   本地 modId 不一定等于 Modrinth 的 slug，查不到就如实标「未收录」，
   不拿搜索结果硬认成同一个模组。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function projectUrl(p) {
    const t = (p && p.project_type) === 'resourcepack' ? 'resourcepack'
      : (p && p.project_type) === 'shader' ? 'shader' : 'mod';
    return 'https://modrinth.com/' + t + '/' + encodeURIComponent(String((p && (p.slug || p.id)) || ''));
  }

  function isMod(p) {
    return !!p && (p.project_type === 'mod' || !p.project_type);
  }

  /* 不给 env 过滤，拿项目的全部版本，用文件名/版本号确认是不是同一份 */
  async function allVersions(pid) {
    try {
      const data = await MC.api.modrinth.get('/project/' + encodeURIComponent(pid) + '/version');
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return [];
    }
  }

  function fileMatch(entry, list) {
    const fn = String((entry && entry.fileName) || '').toLowerCase();
    const ver = String((entry && entry.version) || '');
    return (list || []).some(v =>
      (fn && (v.files || []).some(f => String(f.filename || '').toLowerCase() === fn)) ||
      (ver && String(v.version_number || '') === ver)
    );
  }

  /* 项目确实发布了这个文件（或这个版本号），才认它是同一个模组 */
  async function confirmed(proj, entry) {
    if (!isMod(proj)) return false;
    return fileMatch(entry, await allVersions(proj.id || proj.slug));
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
    // 1) 哈希最可靠：jar 被改名也能对上真正的项目
    if (entry.sha1) {
      try {
        const map = await MC.api.modrinth.versionFiles([entry.sha1]);
        const v = map && map[entry.sha1];
        if (v && v.project_id) {
          const p = await MC.api.modrinth.project(v.project_id);
          if (isMod(p)) return p;
        }
      } catch (err) { /* 查不到就继续试别的 */ }
    }

    // 2) 常见写法当 slug 试；同名但类型不同的项目（例如同名的资源包）在这里被挡掉
    for (const slug of slugCandidates(entry)) {
      try {
        const p = await MC.api.modrinth.project(slug);
        if (p && await confirmed(p, entry)) return p;
      } catch (err) { /* 继续试下一个写法 */ }
    }

    // 3) 兜底：按名字搜，只认同名、且确实发布过这份文件的 mod 项目
    const name = String((entry && entry.name) || '').trim();
    if (!name) return null;
    try {
      const hits = await MC.api.modrinth.search(name, { limit: 8, facets: [['project_type:mod']] });
      for (const hit of (hits || []).slice(0, 5)) {
        if (hit.project_type && hit.project_type !== 'mod') continue;
        if (!sameHit(entry, hit)) continue;
        const p = await MC.api.modrinth.project(hit.project_id);
        if (p && await confirmed(p, entry)) return p;
      }
    } catch (err) { /* 搜不到就算了 */ }
    return null;
  }

  /** 返回 { status: current|newer|notfound|nomatch|error, latest?, url?, reason? } */
  async function check(entry, env, known) {
    if (!entry || !entry.id) return { status: 'notfound' };
    let proj = known || null;
    try {
      if (!proj) proj = await findProject(entry);
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
