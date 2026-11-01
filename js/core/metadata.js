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

  /* 有些 jar 的 fabric.mod.json 在字符串里写了裸换行（Gson 宽松模式能读，JSON.parse 会直接报错）；
     这里只把字符串内部的控制字符转义，不碰结构 */
  function jsonLoose(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (const ch of String(text)) {
      const code = ch.charCodeAt(0);
      if (!inStr) {
        if (ch === '"') inStr = true;
        out += ch;
        continue;
      }
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (code < 0x20) {
        out += code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
    }
    return out;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return JSON.parse(jsonLoose(text)); }
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
    try { o = (parseJson(text) || {}).pack || {}; } catch { o = {}; }
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

  /* authors 常见写法："a, b" / "a;b" */
  function splitNames(s) {
    return String(s || '').split(/[,;，；]/).map(x => x.trim()).filter(Boolean);
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
        description: plainText(tomlText(body, 'description') || tomlText(text, 'description')).slice(0, 600),
        authors: splitNames(tomlStr(body, 'authors')),
        displayURL: tomlStr(body, 'displayURL')
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
    return {
      mods,
      deps,
      mcRange,
      provides: tomlArray(text, 'provides'),
      authors: mods.length ? mods[0].authors : [],
      links: mods.length && mods[0].displayURL ? [{ label: '主页', url: mods[0].displayURL }] : []
    };
  }

  function parseFabricJson(text) {
    let o;
    try { o = parseJson(text); } catch { return null; }
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
    const authors = [];
    (Array.isArray(o.authors) ? o.authors : []).forEach(a => {
      const n = typeof a === 'string' ? a : (a && a.name);
      if (n) authors.push(String(n).trim());
    });
    const links = [];
    const contact = o.contact || {};
    if (contact.homepage) links.push({ label: '主页', url: String(contact.homepage) });
    if (contact.sources) links.push({ label: '源码', url: String(contact.sources) });
    if (contact.issues) links.push({ label: '问题反馈', url: String(contact.issues) });
    return {
      mods: [{
        modId: o.id, version: o.version || '', name: o.name || o.id, mc: '',
        description: plainText(o.description).slice(0, 600)
      }],
      deps,
      provides: Array.isArray(o.provides) ? o.provides : [],
      mcRange: o.depends && o.depends.minecraft ? String(o.depends.minecraft) : '',
      authors,
      links
    };
  }

  function parseMcmodInfo(text) {
    let data;
    try { data = parseJson(text); } catch { return { mods: [], deps: [] }; }
    const list = Array.isArray(data) ? data : (data.modList || []);
    const mods = list.filter(x => x && x.modid).map(x => ({
      modId: x.modid,
      version: x.version || '',
      name: x.name || x.modid,
      mc: x.mcversion || '',
      description: plainText(x.description).slice(0, 600),
      authors: (Array.isArray(x.authorList) ? x.authorList : (x.author ? [x.author] : [])
        ).map(a => (typeof a === 'string' ? a : a && a.name)).filter(Boolean),
      url: x.url || ''
    }));
    let deps = [];
    if (list[0] && Array.isArray(list[0].dependencies)) {
      deps = list[0].dependencies.map(d => ({ modId: String(d), versionRange: '*', mandatory: true }));
    }
    return {
      mods, deps, provides: [],
      authors: mods.length ? mods[0].authors : [],
      links: mods.length && mods[0].url ? [{ label: '主页', url: mods[0].url }] : []
    };
  }

  /* 从 jar 自带的语言文件里找中文名：assets/<namespace>/lang/zh_cn.json（老版本是 .lang） */
  function normNs(x) { return String(x || '').toLowerCase().replace(/[_-]/g, ''); }

  async function readLangFile(z, hitPath) {
    const raw = await zip.readEntry(z, hitPath);
    if (!raw) return null;
    if (/\.lang$/i.test(hitPath)) {
      const obj = {};
      String(raw).split(/\r?\n/).forEach(line => {
        const t = line.trim();
        if (!t || t.charAt(0) === '#') return;
        const i = t.indexOf('=');
        if (i < 0) return;
        obj[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      });
      return obj;
    }
    try { return parseJson(raw); } catch { return null; }
  }

  async function findZhName(z, ids) {
    const want = (ids || []).filter(Boolean);
    const wantNorm = want.map(normNs).filter(Boolean);
    const files = [];
    z.map.forEach((_, n) => {
      const m = /^assets\/([^/]+)\/lang\/zh_cn\.(json|lang)$/i.exec(n);
      if (m) files.push({ ns: m[1], path: n });
    });
    // 命名空间和 modId 一模一样的优先
    files.sort((a, b) => (wantNorm.indexOf(normNs(a.ns)) >= 0 ? 0 : 1) - (wantNorm.indexOf(normNs(b.ns)) >= 0 ? 0 : 1));

    for (const f of files) {
      const ns = normNs(f.ns);
      const related = wantNorm.some(w => w === ns ||
        (w.length >= 5 && ns.length >= 5 && (w.indexOf(ns) === 0 || ns.indexOf(w) === 0)));
      if (!related) continue;

      const lang = await readLangFile(z, f.path);
      if (!lang || typeof lang !== 'object') continue;
      const lower = {};
      Object.keys(lang).forEach(k => { lower[k.toLowerCase()] = lang[k]; });

      const n = String(f.ns).toLowerCase();
      const cand = [
        'mod.' + n + '.name', 'mod.' + n + '.displayname', 'mod.' + n + '.title',
        n + '.name', n + '.displayname', n + '.title',
        'itemgroup.' + n, 'itemgroup.' + n + '.name',
        'tooltip.' + n + '.name'
      ];
      for (const k of cand) {
        const v = lower[k];
        if (typeof v === 'string' && v.trim()) return plainText(v).slice(0, 80);
      }
    }
    return '';
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

  /** 去掉作者手滑写出的尾巴："1.0.0}" → "1.0.0"；占位符没替换掉的直接当没有 */
  function sanitizeVersion(v) {
    let s = String(v == null ? '' : v).trim();
    s = s.replace(/[}\]>,;]+$/, '').trim();
    if (/[{}%$]/.test(s) || /^(unknown|null|none)$/i.test(s)) return '';
    return s;
  }

  /** 1.0 / 1.0.0 这类"填着玩"的版本号：真实版本往往只在文件名里 */
  function isGenericVersion(v) {
    const s = sanitizeVersion(v);
    if (!s) return true;
    const core = s.replace(/\b1\.(?:1[2-9]|2[0-9])(?:\.\d+)?\b/g, '').replace(/[^\d.]/g, '');
    const nums = core.split('.').filter(Boolean).join('.');
    return !nums || /^1(\.0)*$/.test(nums);
  }

  /** 从文件名里猜真实版本：去掉中文标记、MC 版本、加载器名，取第一个版本号 */
  function fileVersionOf(fileName, modName) {
    let base = String(fileName || '').replace(/\.(jar|zip)$/i, '');
    base = base.replace(/【[^】]*】|\[[^\]]*\]/g, ' ');
    const name = String(modName || '').trim();
    if (name && name.length >= 3) {
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'ig');
      base = base.replace(re, ' ');
    }
    base = base.replace(/mc\s*\d+\.\d+(?:\.\d+)?/ig, ' ');
    // 只剔除 1.x 的 MC 版本，避免把 3.2.7 这类真实版本当 MC 版本
    base = base.replace(/\b1\.(?:1[2-9]|2[0-9])(?:\.\d+)?\b/g, ' ');
    base = base.replace(/\b(fabric|forge|neoforge|quilt)\b/ig, ' ');
    const m = base.match(/[vV]?(\d+(?:\.\d+){1,3}(?:[a-zA-Z]+\d*)?)/);
    return m ? m[1] : '';
  }

  /** 声明的版本坏了/太笼统时，用文件名里的版本兜底 */
  function resolveVersion(declared, fileName, modName) {
    const d = sanitizeVersion(declared);
    const f = fileVersionOf(fileName, modName);
    if (!f) return d;
    if (!d || isGenericVersion(d)) return f;
    return d;
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
    const manifest = await zip.readEntry(z, 'META-INF/MANIFEST.MF');
    if (fabric) {
      const p = parseFabricJson(fabric);
      if (p) found.push({ loader: 'Fabric', meta: p, provides: p.provides || [], mcRange: p.mcRange || '' });
    }
    if (forge) {
      const p = parseForgeToml(forge);
      if (p.mods.length) {
        // mods.toml 里常见 version = "${file.jarVersion}"，真实版本在 MANIFEST 里
        if (!p.mods[0].version) {
          const mv = manifest && String(manifest).match(/Implementation-Version:\s*(\S+)/i);
          if (mv) p.mods[0].version = mv[1].trim();
        }
        found.push({ loader: 'Forge', meta: p, provides: p.provides || [], mcRange: p.mcRange || '' });
      }
    }
    if (legacy) {
      const p = parseMcmodInfo(legacy);
      if (p.mods.length) found.push({ loader: 'Forge1.12', meta: p, provides: [], mcRange: p.mods[0].mc || '' });
    }
    if (!found.length) {
      // Sinytra Connector 不是普通 Forge 模组（没有 mods.toml），靠 MANIFEST 认出来
      if (manifest && /Automatic-Module-Name:\s*org\.sinytra\.connector/i.test(String(manifest))) {
        const mv = String(manifest).match(/Implementation-Version:\s*(\S+)/i);
        const ver = mv ? mv[1].trim() : '';
        const mc = (ver.match(/\+(\d+\.\d+(?:\.\d+)?)/) || [])[1] || '';
        return {
          kind: 'mod',
          info: {
            loader: 'Forge', loaders: ['Forge'], id: 'connectormod',
            version: ver, name: 'Sinytra Connector', nameZh: 'Sinytra Connector',
            description: '让一部分 Fabric 模组跑在 Forge 上（需要 Forgified Fabric API）。', recipes: 0,
            mc, mcRange: mc, allIds: ['connectormod'], deps: [], optionalDeps: []
          }
        };
      }
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
    // 作者和作者留下的主页/源码/爱发电链接（写进 jar 里，谁都读得到）
    const authors = [];
    const links = [];
    found.forEach(f => {
      (f.meta.authors || []).forEach(a => {
        const n = String(a || '').trim();
        if (n && authors.indexOf(n) < 0) authors.push(n);
      });
      (f.meta.links || []).forEach(l => {
        if (!l || !l.url || !/^https?:/i.test(l.url)) return;
        if (links.some(x => x.url === l.url)) return;
        links.push({ label: l.label || '主页', url: l.url });
      });
    });
    const modId = primary.meta.mods[0].modId;
    const nameZh = await findZhName(z, [modId, ...ids]);
    return {
      kind: 'mod',
      info: {
        loader: primary.loader,
        loaders: found.map(f => f.loader),
        id: modId,
        version: sanitizeVersion(primary.meta.mods[0].version),
        name: primary.meta.mods[0].name,
        nameZh,
        description: found.map(f => (f.meta.mods[0] && f.meta.mods[0].description) || '').find(Boolean) || '',
        recipes,
        mc: normalizeMc(mcRange),
        mcRange,
        allIds: [...ids],
        deps: deps.filter(d => d.mandatory),
        optionalDeps: deps.filter(d => !d.mandatory),
        authors,
        links
      }
    };
  }

  /** 兼容旧调用：只要模组信息，非模组返回 null */
  async function parseJarBuffer(buf) {
    return (await inspect(buf)).info;
  }

  MC.metadata = { inspect, parseJarBuffer, normalizeMc, inferMcFromName, parseForgeToml, parseFabricJson, parseMcmodInfo, sanitizeVersion, isGenericVersion, fileVersionOf, resolveVersion, splitNames };
})(globalThis);
