/* ===== 模组身份：产键与分级匹配 =====
   统一去重、分组、前置、链接、对比、更新使用的身份判断。
   不依赖 DOM，可在 Node 中直接测试。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const LEVELS = { FILE: 'file', PROJECT: 'project', MOD: 'mod', NAME: 'name', FUZZY: 'fuzzy' };
  const SCORES = { file: 100, project: 90, mod: 80, name: 60, fuzzy: 40 };

  function normalizeName(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’“”]/g, "'")
      .toLowerCase()
      .replace(/^the\s+/i, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  }

  function normalizeId(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[-_\s]/g, '');
  }

  function normalizeSha(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  function getProjectId(m) {
    if (!m) return '';
    if (m.projectId) return String(m.projectId);
    if (m.project && m.project.id) return String(m.project.id);
    if (m.mr && m.mr.id) return String(m.mr.id);
    return '';
  }

  function getModId(m) {
    if (!m) return '';
    return normalizeId(m.id || m.modId || m.modid || '');
  }

  function getName(m) {
    if (!m) return '';
    return normalizeName(m.name || m.displayName || m.title || m.nameZh || '');
  }

  /* 文件名 → 去掉标签、加载器、MC、版本后的名字 */
  function fileBase(fileName) {
    let s = String(fileName == null ? '' : fileName)
      .replace(/\.(jar|zip)$/i, '')
      .replace(/[\[【][^\]】]*[\]】]/g, ' ')
      .replace(/\b(mc)\s*[.\-_]?\s*\d+(?:\.\d+)*x?\b/gi, ' ')
      .replace(/\b(forge|fabric|neoforge|quilt|fab)\b/gi, ' ')
      .replace(/\bforge\s*\d+\.\d+(?:\.\d+)*\b/gi, ' ')
      .replace(/[vV]\s*\d+(?:\.\d+)*/g, ' ')
      .replace(/\d+(?:\.\d+)*(?:[-._]?(?:alpha|beta|pre|rc|patch|hf|build|rev|re)[-._]?\d*)?/gi, ' ')
      .replace(/\b(alpha|beta|pre|rc|patch|hf|build|revision|rev|slim|all|english|birthday)\b/gi, ' ');
    return normalizeName(s);
  }

  function keys(m) {
    return {
      sha1: normalizeSha(m && (m.sha1 || m.hash)),
      projectId: getProjectId(m),
      modId: getModId(m),
      name: getName(m),
      file: fileBase(m && (m.fileName || (m.file && m.file.name)))
    };
  }

  function hitLevel(a, b, level) {
    const x = keys(a), y = keys(b);
    if (level === LEVELS.FILE) return !!x.sha1 && x.sha1 === y.sha1;
    if (level === LEVELS.PROJECT) return !!x.projectId && x.projectId === y.projectId;
    if (level === LEVELS.MOD) return !!x.modId && x.modId === y.modId;
    if (level === LEVELS.NAME) return !!x.name && x.name === y.name && x.name.length >= 4;
    if (level === LEVELS.FUZZY) return !!x.file && x.file === y.file && x.file.length >= 5;
    return false;
  }

  /* score：返回命中的最高级别分数；0 表示不匹配 */
  function score(a, b) {
    if (hitLevel(a, b, LEVELS.FILE)) return SCORES.file;
    if (hitLevel(a, b, LEVELS.PROJECT)) return SCORES.project;
    if (hitLevel(a, b, LEVELS.MOD)) return SCORES.mod;
    if (hitLevel(a, b, LEVELS.NAME)) return SCORES.name;
    if (hitLevel(a, b, LEVELS.FUZZY)) return SCORES.fuzzy;
    return 0;
  }

  /* allowed 可传单级别、级别数组或省略（全部级别） */
  function same(a, b, allowed) {
    const levels = allowed ? (Array.isArray(allowed) ? allowed : [allowed]) : Object.values(LEVELS);
    for (const lv of levels) if (hitLevel(a, b, lv)) return true;
    return false;
  }

  MC.identity = {
    LEVELS, SCORES, normalizeName, normalizeId, fileBase, keys, score, same
  };
})(globalThis);
