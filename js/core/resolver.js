/* ===== 依赖 ID → Modrinth 项目（四步解析 + 记忆 + 候选） =====
   1 精确 slug / project id  2 别名表  3 搜索后规范化比对  4 用户改搜索词重试
   成功的映射写进 localStorage，下次直接命中。
   无论成功失败都带回 candidates（前 5 个搜索结果），用户可以点「就是它」纠正。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const KEY = 'modpilot.map.v1';

  /* 依赖 ID 常常是「子模块 ID」，不是项目 slug */
  const ALIASES = {
    fabric_api_base: 'fabric-api',
    fabric_api: 'fabric-api',
    fabric: 'fabric-api',
    fabric_renderer_api_v1: 'fabric-api',
    fabric_api_lookup: 'fabric-api',
    fabric_loader: 'fabric-loader',
    mizunoky_mod: 'mizunoky',
    geckolib3: 'geckolib',
    mod_minecraftforge: 'forge',
    minecraftforge: 'forge'
  };

  function loadMap() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
  }
  function saveMap(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 隐私模式下就不记忆 */ }
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** 搜索命中项与依赖 ID 的相似度，0 表示不认 */
  function scoreHit(hit, id) {
    const target = norm(id);
    if (!target) return 0;
    const slug = norm(hit.slug);
    const title = norm(hit.title);
    if (slug === target) return 5;
    if (title === target) return 4;
    if (target.length >= 5 && slug.startsWith(target)) return 3;
    if (target.length >= 5 && title.startsWith(target)) return 2;
    if (target.length >= 6 && (hit.description || '').toLowerCase().indexOf(String(id).toLowerCase()) >= 0) return 1;
    return 0;
  }

  /** 搜索命中项瘦身，够界面展示就行 */
  function brief(p) {
    if (!p) return null;
    return {
      slug: p.slug || p.project_id || p.id,
      title: p.title || p.slug,
      description: p.description || '',
      downloads: p.downloads || 0,
      icon: p.icon_url || '',
      projectId: p.id || p.project_id
    };
  }

  function uniq(list) {
    const seen = new Set();
    return list.filter(x => {
      if (!x || !x.slug || seen.has(x.slug)) return false;
      seen.add(x.slug);
      return true;
    });
  }

  async function projectVersions(project, env) {
    return MC.api.modrinth.versions(project.id || project.project_id, env);
  }

  function remember(dep, project) {
    const map = loadMap();
    map[dep.id] = { slug: project.slug || project.project_id || project.id, title: project.title };
    saveMap(map);
  }

  function chooseVersion(project, list, range, extra) {
    const version = MC.api.modrinth.pickVersion(list, range);
    // 下拉框也只给满足约束的版本，避免手动切回不兼容的前置。
    const versions = range ? list.filter(v => MC.version.mcMatches(range, v.version_number)) : list;
    return Object.assign({
      ok: !!version, project, versions, version,
      reason: version ? '' : '没有满足版本要求 ' + (range || '*') + ' 的候选'
    }, extra);
  }

  /**
   * @param dep {id, modId, searchWord}
   * @param ctx {env, range, searchWord} searchWord 有值表示用户手动指定的搜索词
   */
  async function resolve(dep, ctx) {
    const API = MC.api.modrinth;
    const env = ctx.env;
    const range = ctx.range || dep.range || '';
    const override = ctx.searchWord && ctx.searchWord.trim();
    const word = override ? ctx.searchWord.trim() : (dep.searchWord || dep.modId || dep.id);
    let project = null;
    let via = '';
    let candidates = [];

    if (!override) {
      // 批量预解析已经命中的，直接复用，省掉一次 /project 请求
      if (dep.prematch && dep.prematch.id) {
        project = dep.prematch;
        via = '批量命中';
      }
    }
    if (!project && !override) {
      const cached = loadMap()[dep.id];
      if (cached && cached.slug) {
        project = await API.project(cached.slug);
        if (project) via = '之前记住的';
      }
      if (!project) {
        const alias = ALIASES[String(dep.id).toLowerCase()] || ALIASES[String(dep.modId || '').toLowerCase()];
        if (alias) { project = await API.project(alias); if (project) via = '别名表'; }
      }
      if (!project) { project = await API.project(dep.id); if (project) via = '依赖 ID 精确命中'; }
      if (!project && dep.modId && dep.modId !== dep.id) {
        project = await API.project(String(dep.modId).toLowerCase());
        if (project) via = 'modId 精确命中';
      }
    }

    if (project) {
      const list = await projectVersions(project, env);
      if (list.length) {
        if (!override) remember(dep, project);
        return chooseVersion(project, list, range, {
          via,
          searchWord: word,
          candidates: [brief(project)]
        });
      }
      candidates = [brief(project)];
    }

    // 精确/别名没结果，或项目存在但没有当前环境的版本 → 用搜索找候选
    const hits = await API.search(word, { limit: 10, facets: [['project_type:mod']] });
    candidates = uniq(candidates.concat(hits.slice(0, 5).map(brief)));

    if (!project) {
      let best = null;
      let bestScore = 0;
      hits.forEach(h => {
        const s = scoreHit(h, dep.id) + scoreHit(h, dep.modId);
        if (s > bestScore) { best = h; bestScore = s; }
      });
      if (best) {
        project = (await API.project(best.slug)) || best;
        via = '搜索 “' + word + '”';
      }
    }

    if (!project) {
      return {
        ok: false,
        candidates,
        reason: 'Modrinth 里没搜到对应的项目',
        via: '',
        searchWord: word
      };
    }

    const list = await projectVersions(project, env);
    if (!list.length) {
      return {
        ok: false,
        project,
        candidates,
        reason: '这个项目没有 ' + env.loader + ' ' + env.mc + ' 的版本',
        via,
        searchWord: word
      };
    }
    if (!override) remember(dep, project);
    return chooseVersion(project, list, range, {
      via,
      searchWord: word,
      candidates: uniq(candidates.concat([brief(project)]))
    });
  }

  /** 用户从候选里直接点了一个项目 */
  async function resolveSlug(slug, env, range) {
    const API = MC.api.modrinth;
    const project = await API.project(slug);
    if (!project) return { ok: false, reason: '这个项目不存在了' };
    const list = await projectVersions(project, env);
    if (!list.length) {
      return { ok: false, project, reason: '它没有 ' + env.loader + ' ' + env.mc + ' 的版本' };
    }
    return chooseVersion(project, list, range || '', {});
  }

  MC.resolver = { resolve, resolveSlug, ALIASES, loadMap };
})(globalThis);
