/* ===== 导出整合包时，从原包里带哪些非 mods 内容 =====
   原包的 overrides/ 动辄几百兆，所以按目录白名单挑，mods/ 与启动器自己的东西一律不带。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  // 带走的目录（去掉 overrides/ 前缀后判断，比较时忽略大小写）
  const KEEP_DIRS = [
    'config', 'defaultconfigs', 'kubejs', 'customskinloader',
    'emotes', 'resourcepacks', 'shaderpacks'
  ];
  // 带走的根文件
  const KEEP_FILES = ['options.txt', 'icon.png', 'pack.png'];

  function relPath(p) {
    let s = String(p || '').replace(/\\/g, '/');
    if (/^overrides\//i.test(s)) s = s.slice('overrides/'.length);
    return s;
  }

  function keepable(path) {
    const rel = relPath(path);
    if (!rel) return false;
    const parts = rel.split('/');
    if (parts.length === 1) return KEEP_FILES.indexOf(rel.toLowerCase()) >= 0;
    return KEEP_DIRS.indexOf(parts[0].toLowerCase()) >= 0;
  }

  /** @returns {{src:string, path:string}[]} src 是原包里的路径，path 是导出后的相对路径 */
  function plan(paths) {
    const out = [];
    (paths || []).forEach(p => {
      if (keepable(p)) out.push({ src: String(p), path: relPath(p) });
    });
    return out;
  }

  MC.overrides = { relPath, keepable, plan, KEEP_DIRS };
})(globalThis);
