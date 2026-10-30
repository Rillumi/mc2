/* ===== 模组元数据：mods.toml / fabric.mod.json / mcmod.info ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const zip = MC.zip;

  /* TOML 基础字符串里的转义：\u73B0 这种中文名很常见，不解码界面上会是乱码 */
  function unescapeToml(s) {
    return String(s == null ? '' : s).replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|["\\btnfr])/g, (all, seq) => {
      if (seq[0] === 'u' || seq[0] === 'U') {
        const code = parseInt(seq.slice(1), 16);
        return code ? String.fromCodePoint(code) : all;
      }
      return { '"': '"', '\\': '\\', b: '\b', t: '\t', n: '\n', f: '\f', r: '\r' }[seq] || all;
    });
  }

  /* TOML 多行字符串：Forge 的 description 常用 '''...''' */
  function tomlText(text, key) {
    const re = new RegExp('(?:^|\\n)\\s*' + key + '\\s*=\\s*(?:\'\'\'([\\s\\S]*?)\'\'\'|"""([\\s\\S]*?)""")');
    const m = text.match(re);
    if (m) return (m[1] != null ? m[1] : m[2]).trim();
    return tomlStr(text, key);
  }

  /* 简介可能是字符串，也可能是 JSON 文本组件 */
  function plainText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.replace(/§./g, '').trim();
    if (typeof v === 'object') {
      if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join('');
      return plainText(v.text || v.translate || (v.with ? plainText(v.with) : '') || '');
    }
    return String(v);
  }

  function parsePackMeta(text) {
    let o = {};
    try { o = (JSON.parse(text) || {}).pack || {}; } catch { o = {}; }
    let fmt = o.pack_format;
    if (!fmt && o.supported_formats) {
      fmt = Array.isArray(o.supported_formats) ? o.supported_formats[0] : o.supported_formats.min_inclusive;
    }
    return { packFormat: fmt || 0, description: plainText(o.description).slice(0, 400) };
  }

  /* 资源包覆盖的文件路径 + 分类计数（判断两个包是否撞车就靠它） */
  function assetScan(z) {
    const list = [];
    const counts = { texture: 0, model: 0, lang: 0, sound: 0, other: 0 };
    z.map.forEach((_, n) => {
      const l = n.toLowerCase();
      if (!l.startsWith('assets/')) return;
      if (l.endsWith('/')) return;
      list.push(n);
      if (l.indexOf('/textures/') >= 0) counts.texture++;
      else if (l.indexOf('/models/') >= 0) counts.model++;
      else if (l.indexOf('/lang/') >= 0) counts.lang++;
      else if (l.indexOf('/sounds/') >= 0) counts.sound++;
      else counts.other++;
    });
    return { assets: list, assetCounts: counts };
  }

  /* --- 极简 TOML 取值（只取我们需要的键） --- */
  function tomlStr(section, key) {
    let m = section.match(new RegExp('(?:^|\\n)\\s*' + key + '\\s*=\\s*"([^"]*)"'));
    if (m) return unescapeToml(m[1]);
    // Forge 允许无引号布尔/数字：mandatory=false
    m = section.match(new RegExp('(?:^|\\n)\\s*' + key + '\\s*=\\s*([^\\s#]+)'));
    return m ? m[1] : '';
  }

  function tomlArray(text, key) {
    const out = [];
    const re = new RegExp('^\\s*' + key + '\\s*=\\s*\\[([^\\]]*)\\]', 'gm');
    let m;
    while ((m = re.exec(text))) {
      const inner = m[1];
      const q = /"([^"]+)"/g;
      let s;
      while ((s = q.exec(inner))) out.push(unescapeToml(s[1]));
    }
    return out;
  }

  function parseForgeToml(text) {
    const mods = [];
    for (const m of text.matchAll(/\[\[mods\]\]([\s\S]*?)(?=\[\[|$)/g)) {
      const body = m[1];
      const modId = tomlStr(body, 'modId');
      if (!modId || /\$\{/.test(modId)) continue; // Fabric 包里的模板文件跳过
      let version = tomlStr(body, 'version');
      if (/\$\{/.test(version)) version = '';      // ${file.jarVersion} 由 Forge 启动时替换
      mods.push({
        modId, version, name: tomlStr(body, 'displayName') || modId,
        description: plainText(tomlText(body, 'description') || tomlText(text, 'description')).slice(0, 600)
      });
    }

    const deps = [];
    let mcRange = '';
    for (const m of text.matchAll(/\[\[dependencies\.[^\]]+\]\]([\s\S]*?)(?=\[\[|$)/g)) {
      const body = m[1];
      const modId = tomlStr(body, 'modId');
      if (!modId) continue;
      const range = tomlStr(body, 'versionRange') || '*';
      if (/^minecraft$/i.test(modId)) { mcRange = range; continue; }
      if (/^(forge|neoforge)$/i.test(modId)) continue;
      deps.push({
        modId,
        versionRange: range,
        mandatory: (tomlStr(body, 'mandatory') || 'true').toLowerCase() !== 'false'
      });
    }
    return { mods, deps, mcRange, provides: tomlArray(text, 'provides') };
  }

  function parseFabricJson(text) {
    let o;
    try { o = JSON.parse(text); } catch { return null; }
    if (!o || !o.id) return null;
    const deps = [];
    if (o.depends && typeof o.depends === 'object') {
      for (const [k, v] of Object.entries(o.depends)) {
        deps.push({ modId: k, versionRange: String(v), mandatory: true });
      }
    }
    if (o.recommends && typeof o.recommends === 'object') {
      for (const [k, v] of Object.entries(o.recommends)) {
        deps.push({ modId: k, versionRange: String(v), mandatory: false });
      }
    }
    return {
      mods: [{
        modId: o.id, version: o.version || '', name: o.name || o.id, mc: '',
        description: plainText(o.description).slice(0, 600)
      }],
      deps,
      provides: Array.isArray(o.provides) ? o.provides : [],
      mcRange: o.depends && o.depends.minecraft ? String(o.depends.minecraft) : ''
    };
  }

  function parseMcmodInfo(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { mods: [], deps: [] }; }
    const list = Array.isArray(data) ? data : (data.modList || []);
    const mods = list.filter(x => x && x.modid).map(x => ({
      modId: x.modid,
      version: x.version || '',
      name: x.name || x.modid,
      mc: x.mcversion || '',
      description: plainText(x.description).slice(0, 600)
    }));
    let deps = [];
    if (list[0] && Array.isArray(list[0].dependencies)) {
      deps = list[0].dependencies.map(d => ({ modId: String(d), versionRange: '*', mandatory: true }));
    }
    return { mods, deps, provides: [] };
  }

  function normalizeMc(v) {
    if (!v) return '';
    const m = String(v).match(/\d+\.\d+(?:\.\d+)?/);
    return m ? m[0] : '';
  }

  function inferMcFromName(name) {
    const m = String(name).match(/mc[-_ ]?(\d+\.\d+(?:\.\d+)?)/i);
    return m ? m[1] : '';
  }

  /** 读取一个文件，返回 { kind, info }：
   *  kind = mod / resourcepack / shader / unknown
   *  info = 模组信息（只有 mod 才有） */
  async function inspect(buf) {
    const z = zip.parseCentral(buf);
    const forge = await zip.readEntry(z, 'META-INF/mods.toml');
    const fabric = await zip.readEntry(z, 'fabric.mod.json');
    const legacy = await zip.readEntry(z, 'mcmod.info');

    const found = [];
    if (fabric) {
      const p = parseFabricJson(fabric);
      if (p) found.push({ loader: 'Fabric', meta: p, provides: p.provides || [], mcRange: p.mcRange || '' });
    }
    if (forge) {
      const p = parseForgeToml(forge);
      if (p.mods.length) found.push({ loader: 'Forge', meta: p, provides: p.provides || [], mcRange: p.mcRange || '' });
    }
    if (legacy) {
      const p = parseMcmodInfo(legacy);
      if (p.mods.length) found.push({ loader: 'Forge1.12', meta: p, provides: [], mcRange: p.mods[0].mc || '' });
    }
    if (!found.length) {
      // 不是模组：再判断资源包 / 光影
      let isShader = false;
      let isPack = false;
      z.map.forEach((_, name) => {
        const n = name.toLowerCase();
        if (n.startsWith('shaders/') || n === 'iris.properties') isShader = true;
        if (n === 'pack.mcmeta') isPack = true;
      });
      if (isShader) {
        let n = 0;
        z.map.forEach((_, name) => { if (name.toLowerCase().startsWith('shaders/')) n++; });
        return { kind: 'shader', info: { shaderFiles: n } };
      }
      if (isPack) {
        const meta = parsePackMeta(await zip.readEntry(z, 'pack.mcmeta') || '');
        const scan = assetScan(z);
        return {
          kind: 'resourcepack',
          info: {
            packFormat: meta.packFormat,
            description: meta.description,
            assets: scan.assets,
            assetCounts: scan.assetCounts
          }
        };
      }
      return { kind: 'unknown', info: null };
    }

    // 统计 jar 自带的配方文件：data/<ns>/recipes/*.json（1.13+），老版本在 assets/<ns>/recipes/
    let recipes = 0;
    z.map.forEach((_, name) => {
      const n = name.toLowerCase();
      if (n.endsWith('.json') && /^(data|assets)\/[^/]+\/recipes?\//.test(n)) recipes++;
    });

    const primary = found[0];
    const depMap = new Map();
    const ids = new Set();
    let mcRange = '';

    for (const f of found) {
      if (!mcRange) mcRange = f.mcRange || (f.meta.mods[0] && f.meta.mods[0].mc) || '';
      (f.meta.mods || []).forEach(m => m.modId && ids.add(m.modId));
      (f.provides || []).forEach(x => ids.add(x));
      (f.meta.deps || []).forEach(d => {
        const k = d.modId.toLowerCase();
        const prev = depMap.get(k);
        // 同一个前置同时出现必选/可选时，以必选为准
        if (!prev || (!prev.mandatory && d.mandatory)) depMap.set(k, d);
      });
    }

    const deps = [...depMap.values()];
    return {
      kind: 'mod',
      info: {
        loader: primary.loader,
        loaders: found.map(f => f.loader),
        id: primary.meta.mods[0].modId,
        version: primary.meta.mods[0].version,
        name: primary.meta.mods[0].name,
        description: found.map(f => (f.meta.mods[0] && f.meta.mods[0].description) || '').find(Boolean) || '',
        recipes,
        mc: normalizeMc(mcRange),
        mcRange,
        allIds: [...ids],
        deps: deps.filter(d => d.mandatory),
        optionalDeps: deps.filter(d => !d.mandatory)
      }
    };
  }

  /** 兼容旧调用：只要模组信息，非模组返回 null */
  async function parseJarBuffer(buf) {
    return (await inspect(buf)).info;
  }

  MC.metadata = { inspect, parseJarBuffer, normalizeMc, inferMcFromName, parseForgeToml, parseFabricJson, parseMcmodInfo };
})(globalThis);
