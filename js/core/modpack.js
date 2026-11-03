/* ===== 整合包识别：从 zip 中央目录判断类型、列 jar、读清单里的环境 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const JAR_RE = /^(?:overrides\/)?mods\/[^/]+\.jar$/i;
  const LOADER_NAMES = { forge: 'Forge', fabric: 'Fabric', neoforge: 'NeoForge' };

  /** 返回 mrpack / curseforge / zip；普通资源包等返回 '' */
  function detect(map) {
    if (map.has('modrinth.index.json')) return 'mrpack';
    if (map.has('manifest.json') && (map.has('modlist.html') || hasDir(map, 'overrides/'))) return 'curseforge';
    for (const name of map.keys()) if (JAR_RE.test(name)) return 'zip';
    return '';
  }

  function hasDir(map, prefix) {
    for (const name of map.keys()) if (name.indexOf(prefix) === 0) return true;
    return false;
  }

  /** 包里真正的 jar（mods/ 与 overrides/mods/ 都算） */
  function jarPaths(map) {
    const out = [];
    map.forEach((_, name) => { if (JAR_RE.test(name)) out.push(name); });
    return out;
  }

  /** .mrpack 的 modrinth.index.json → { loader, loaderVersion, mc }（不认识的字段留空） */
  function envFromMrpack(index) {
    const d = (index && index.dependencies) || {};
    const out = {};
    if (d.minecraft) out.mc = String(d.minecraft);
    const deps = { 'fabric-loader': 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };
    for (const k in deps) {
      if (!d[k]) continue;
      out.loader = deps[k];
      out.loaderVersion = String(d[k]);
      break;
    }
    return out;
  }

  /** CurseForge manifest.json → { loader, loaderVersion, mc } */
  function envFromCurse(manifest) {
    const out = {};
    const mc = manifest && manifest.minecraft && manifest.minecraft.version;
    if (mc) out.mc = String(mc);
    const list = (manifest && manifest.modLoaders) || [];
    const primary = list.find(l => l && l.primary) || list[0] || {};
    const m = String(primary.id || '').match(/^([a-z]+)-(.+)$/i);
    if (m) {
      const name = LOADER_NAMES[m[1].toLowerCase()];
      if (name) {
        out.loader = name;
        out.loaderVersion = m[2];
      }
    }
    return out;
  }

  /** PCL 等启动器导出的外壳 zip：没有整合包标记，但里面恰好只有一个 .mrpack */
  function wrapperPath(map) {
    let found = '';
    for (const name of map.keys()) {
      if (!/\.mrpack$/i.test(name)) continue;
      if (found) return ''; // 多于一个，不猜
      found = name;
    }
    return found;
  }

  MC.modpack = { detect, jarPaths, envFromMrpack, envFromCurse, wrapperPath };
})(globalThis);
