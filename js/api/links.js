/* ===== 另外两个站点：没有可用接口，只能生成搜索/项目链接 =====
   CurseForge 的接口必须带 x-api-key，浏览器跨域会被拦；
   Planet Minecraft 没有公开接口。所以这里只做「一键跳过去」。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function curseforgeSearch(name, mc) {
    const p = new URLSearchParams({
      page: '1',
      pageSize: '20',
      sortBy: 'relevancy',
      class: 'mc-mods',
      search: name || ''
    });
    if (mc) p.set('version', mc);
    return 'https://www.curseforge.com/minecraft/search?' + p.toString();
  }

  function curseforgeProject(slug) {
    return 'https://www.curseforge.com/minecraft/mc-mods/' + encodeURIComponent(slug);
  }

  function planetMinecraftSearch(name) {
    return 'https://www.planetminecraft.com/projects/?keywords=' + encodeURIComponent(name || '');
  }

  function modrinthSearch(name, env) {
    const p = new URLSearchParams({ q: name || '' });
    if (env && env.mc) p.set('g', JSON.stringify([env.mc]));
    if (env && env.loader) p.set('l', JSON.stringify([env.loader.toLowerCase()]));
    return 'https://modrinth.com/mods?' + p.toString();
  }

  /* 爱发电没有公开接口，只能跳到站内搜索结果 */
  function afdianSearch(name) {
    return 'https://afdian.com/search?q=' + encodeURIComponent(name || '');
  }

  MC.links = { curseforgeSearch, curseforgeProject, planetMinecraftSearch, modrinthSearch, afdianSearch };
})(globalThis);
