/* ===== 应用状态（唯一数据源，渲染层只读它） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const DEFAULTS = { Forge: '47.4.0', Fabric: '0.18.4', NeoForge: '47.1.106' };

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('modpilot.env') || 'null'); } catch { return null; }
  })();
  const savedLinks = (() => {
    try { return JSON.parse(localStorage.getItem('modpilot.links.v1') || '{}') || {}; } catch { return {}; }
  })();

  const state = {
    env: {
      loader: (saved && saved.loader) || 'Forge',
      mc: (saved && saved.mc) || '1.20.1',
      loaderVersion: (saved && saved.loaderVersion) || DEFAULTS.Forge
    },
    mods: [],           // 解析后的 jar（含资源包/光影）
    analysis: null,     // analyzer 的输出
    selection: {},      // modId → 选中的 row.uid
    excluded: {},       // modId → true（用户手动不进包）
    deps: [],           // 缺前置 + 匹配结果
    adapt: {},          // 不兼容 / 前置版本不够 → 找来的适配版本
    filter: 'all',
    includeOptional: false,
    includePacks: false, // 资源包 / 光影是否也放进整合包
    showOthers: false,   // 主列表里展开「资源包与光影」
    rpPair: {},          // uid → 另一个资源包 uid（对比覆盖）
    links: savedLinks,   // 手动保存的下载页：modId → [{ url, note, at }]
    mode: 'folder',     // folder：整理整个 mods 文件夹；single：只看一个模组
    selectMode: false,  // 打开后行内出现复选框
    tab: 'organize',    // organize 整理 / guide 导览 / diff 对比 / tools 工具
    guideQuery: '',     // 导览搜索词
    guideCat: 'all',    // 导览分类筛选
    updates: {},        // 组 id → 更新检查结果
    updateBusy: false,
    updateDone: 0,
    updateTotal: 0,
    updateError: '',    // 批量检查时的网络错误提示
    diff: { mods: [], at: 0 }, // 另一个整合包的模组
    diffSameOpen: false,     // 对比页里「共同且一致」是否展开
    rpOrder: [],        // 资源包 uid 顺序（越靠前优先级越高）
    logs: { name: '', findings: [], lines: 0, errors: 0 },
    detail: null,       // 打开详情抽屉的组 id
    previewOpen: false, // 打包预览
    previewQuery: '',   // 预览里的搜索词
    picker: null,       // 当前展开的自绘下拉：'g:<id>' / 'd:<key>'
    dragCount: 0,       // 拖拽悬停时的文件数，用于即时反馈
    busy: false,
    progress: ''
  };

  const subs = [];
  function touch() {
    subs.forEach(fn => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }
  function set(patch) {
    Object.assign(state, patch);
    touch();
  }
  function saveEnv() {
    try { localStorage.setItem('modpilot.env', JSON.stringify(state.env)); } catch { /* ignore */ }
  }
  function saveLinks() {
    try { localStorage.setItem('modpilot.links.v1', JSON.stringify(state.links)); } catch { /* ignore */ }
  }

  MC.store = { state, touch, set, saveEnv, saveLinks, subscribe(fn) { subs.push(fn); }, DEFAULTS };
})(globalThis);
