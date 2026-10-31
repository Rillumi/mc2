/* ===== Modrinth 开放接口封装（浏览器直接可调，CORS 全开） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const BASE = 'https://api.modrinth.com/v2';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* Modrinth 限流是每分钟 300 次；请求排队，至少间隔 220ms，避免批量检查更新时被 429 */
  let lastAt = 0;
  let chain = Promise.resolve();
  function gate() {
    chain = chain.then(async () => {
      const wait = 220 - (Date.now() - lastAt);
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
    });
    return chain;
  }

  function loaderSlug(loader) {
    const l = String(loader || '').toLowerCase();
    if (l === 'fabric') return 'fabric';
    if (l === 'neoforge') return 'neoforge';
    return 'forge';
  }

  async function get(path, tries) {
    tries = tries || 3;
    let lastError = null;
    for (let i = 0; i < tries; i++) {
      await gate();
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), 15000) : null;
      try {
        const res = await fetch(BASE + path, {
          headers: { Accept: 'application/json' },
          signal: ac ? ac.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (res.status === 404) return null;
        if (res.status === 429) {
          const after = Number(res.headers.get('Retry-After'));
          await sleep(after > 0 ? Math.min(after * 1000, 10000) : 2200);
          continue;
        }
        if (!res.ok) throw new Error('Modrinth 返回 ' + res.status);
        return await res.json();
      } catch (err) {
        lastError = err;
        if (timer) clearTimeout(timer);
        if (i < tries - 1) await sleep(700);
      }
    }
    throw lastError || new Error('Modrinth 请求失败');
  }

  /** 按 slug / project id 取项目；不存在返回 null */
  function project(idOrSlug) {
    return get('/project/' + encodeURIComponent(idOrSlug));
  }

  /** 搜索；facets 形如 [["project_type:mod"]] */
  async function search(query, opts) {
    opts = opts || {};
    const p = new URLSearchParams();
    p.set('query', query || '');
    p.set('limit', String(opts.limit || 10));
    p.set('index', 'relevance');
    if (opts.facets) p.set('facets', JSON.stringify(opts.facets));
    const data = await get('/search?' + p.toString());
    return (data && data.hits) || [];
  }

  /** 某项目在当前加载器 + MC 版本下的全部版本 */
  async function versions(projectId, env) {
    const p = new URLSearchParams();
    p.set('loaders', JSON.stringify([loaderSlug(env.loader)]));
    p.set('game_versions', JSON.stringify([env.mc]));
    const data = await get('/project/' + encodeURIComponent(projectId) + '/version?' + p.toString());
    return Array.isArray(data) ? data : [];
  }

  /** 批量查更新：一次 POST 交出所有 jar 的哈希，返回 { sha1: 最新版本 } */
  async function versionFilesUpdate(hashes, env) {
    if (!hashes || !hashes.length) return {};
    let lastError = null;
    for (let i = 0; i < 3; i++) {
      await gate();
      try {
        const res = await fetch(BASE + '/version_files/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            hashes,
            algorithm: 'sha1',
            loaders: [loaderSlug(env.loader)],
            game_versions: [env.mc]
          })
        });
        if (res.status === 429) {
          const after = Number(res.headers.get('Retry-After'));
          await sleep(after > 0 ? Math.min(after * 1000, 10000) : 2200);
          continue;
        }
        if (!res.ok) throw new Error('Modrinth 返回 ' + res.status);
        return await res.json();
      } catch (err) {
        lastError = err;
        if (i < 2) await sleep(700);
      }
    }
    throw lastError || new Error('Modrinth 请求失败');
  }

  /** 批量：哈希 → 版本对象。不按加载器/版本过滤，所以资源包、光影也能查出所属项目 */
  async function versionFiles(hashes) {
    const uniq = Array.from(new Set((hashes || []).filter(Boolean)));
    if (!uniq.length) return {};
    let lastError = null;
    for (let i = 0; i < 3; i++) {
      await gate();
      try {
        const res = await fetch(BASE + '/version_files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ hashes: uniq, algorithm: 'sha1' })
        });
        if (res.status === 429) {
          const after = Number(res.headers.get('Retry-After'));
          await sleep(after > 0 ? Math.min(after * 1000, 10000) : 2200);
          continue;
        }
        if (!res.ok) throw new Error('Modrinth 返回 ' + res.status);
        return await res.json();
      } catch (err) {
        lastError = err;
        if (i < 2) await sleep(700);
      }
    }
    throw lastError || new Error('Modrinth 请求失败');
  }

  /** 批量：项目 id / slug → 项目详情（含正文 body），每批最多 40 个 */
  async function projectsByIds(ids) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean).map(String)));
    const out = [];
    for (let i = 0; i < uniq.length; i += 40) {
      const chunk = uniq.slice(i, i + 40);
      let list = null;
      let lastError = null;
      for (let t = 0; t < 3 && !list; t++) {
        try {
          list = await get('/projects?ids=' + encodeURIComponent(JSON.stringify(chunk)));
        } catch (err) {
          lastError = err;
          if (t < 2) await sleep(700);
        }
      }
      if (!list && lastError) throw lastError;
      (list || []).forEach(p => out.push(p));
    }
    return out;
  }

  /** 在符合环境的版本里，按依赖给出的版本区间挑一个；挑不到就取最新的正式版 */
  function pickVersion(list, range) {
    if (!list || !list.length) return null;
    const V = MC.version;
    const inRange = range ? list.filter(v => V.mcMatches(range, v.version_number)) : list;
    const pool = inRange.length ? inRange : list;
    const rank = v => (v.version_type === 'release' ? 0 : v.version_type === 'beta' ? 1 : 2);
    return pool.slice().sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      return String(b.date_published || '').localeCompare(String(a.date_published || ''));
    })[0];
  }

  async function download(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('下载失败 ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  MC.api = MC.api || {};
  MC.api.modrinth = { get, project, search, versions, versionFilesUpdate, versionFiles, projectsByIds, pickVersion, download, loaderSlug };
})(globalThis);
