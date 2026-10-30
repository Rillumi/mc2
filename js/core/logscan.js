/* ===== 日志粗筛：把 latest.log / crash-report 里最要命的几类问题挑出来 =====
   只是按行匹配，不做完整解析；目的是让人一眼看到「缺前置 / 重复 / Mixin / 找不到类」。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const RULES = [
    {
      id: 'missing', sev: 'bad', label: '缺前置 / 依赖不满足',
      re: /Missing[^\n]{0,50}dependenc|Missing mod|requires [^\n]* which is missing|Mod ID: [^\n]*Requested by|currently missing/i
    },
    {
      id: 'duplicate', sev: 'bad', label: '重复的 mod ID',
      re: /Duplicate mod|DuplicateMod|duplicate modid|already registered/i
    },
    {
      id: 'mixin', sev: 'bad', label: 'Mixin 注入失败',
      re: /Mixin apply failed|Mixin transformation|Mixin apply|mixin[^\n]*failed/i
    },
    {
      id: 'class', sev: 'bad', label: '找不到类 / 方法',
      re: /NoClassDefFoundError|ClassNotFoundException|NoSuchMethodError|NoSuchFieldError/i
    },
    {
      id: 'loadfail', sev: 'bad', label: '模组加载失败',
      re: /Failed to (load|create) mod|Mod [^\n]* failed to load|Failed loading mod|Exception loading mod/i
    },
    {
      id: 'incompat', sev: 'warn', label: '版本 / 环境不兼容',
      re: /Incompatible mod set|incompatible mods|requires Minecraft|Requires (forge|neoforge|fabric)[^\n]*/i
    },
    {
      id: 'error', sev: 'warn', label: '其他 ERROR',
      re: /^\[?\d{2}:\d{2}:\d{2}\]?\s*[^\n]*\bERROR\b|\[ERROR\]|\bERROR\b/
    }
  ];

  function scan(text, name) {
    const lines = String(text || '').split(/\r?\n/);
    const findings = [];
    let errors = 0;
    lines.forEach(line => { if (/\bERROR\b/.test(line)) errors++; });

    RULES.forEach(rule => {
      const hits = [];
      lines.forEach((line, i) => {
        if (rule.re.test(line)) hits.push({ n: i + 1, text: line.trim().slice(0, 260) });
      });
      if (hits.length) {
        findings.push({
          id: rule.id,
          sev: rule.sev,
          label: rule.label,
          count: hits.length,
          samples: hits.slice(0, 3),
          file: name || ''
        });
      }
    });

    return { findings, lines: lines.length, errors };
  }

  MC.logscan = { scan, RULES };
})(globalThis);
