/* 前端接线测试：脚本清单完整、模块导出齐全（不需要真实浏览器）
   目的：拆分模块后漏写 <script> 或漏掉导出时，能在这里直接报错 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

/* 其它模块通过 C.xxx / R.xxx 调用的接口，必须存在 */
const ACTION_KEYS = [
  'S', 'touch', 'toast', 'copyText', 'handleAct',
  'getGen', 'bumpGen', 'findDep', 'toggleExclude', 'pagerGo', 'pagerFromEl',
  'autoLog', 'analyzeAndResolve', 'loadLoaderList', 'loadMcList', 'syncEnvInputs',
  'checkAllUpdates', 'checkOneUpdate', 'exportGuide', 'findConnector',
  'refreshAfdian', 'addLink', 'removeLink', 'bulkLinks',
  'movePack', 'exportPackOrder', 'exportPackOptions', 'buildPack',
  'chosenOf', 'projectForEntry', 'applyZhNames',
  'ensureDesc', 'ensureMrDesc', 'ensureBodyTr',
  'matchDep', 'chooseCandidate', 'runAdapt', 'addAdapt', 'removeAdapt', 'retryAll',
  'importFiles', 'importDiff', 'importLogs', 'syncDbState'
];

const RENDER_KEYS = [
  'all', 'esc', 'icon', 'IC', 'tile', 'fmtSize', 'picker', 'versionItems', 'compact',
  'countsOf', 'chosenOf', 'scanBar', 'adaptAdded', 'siteTag', 'adaptState',
  'renderDeps', 'renderRows', 'renderPack', 'renderGuide', 'renderDiff', 'renderTools',
  'detailHtml', 'previewHtml', 'orderedPacks'
];

const FLOW_NAMES = [
  'flowCommon', 'flowTools', 'flowEnv', 'flowLinks', 'flowMeta',
  'flowUpdates', 'flowAnalysis', 'flowScan', 'flowPack'
];

const BIND_NAMES = ['bindDrop', 'bindViews', 'bindControls', 'bindGlobal'];

function makeSandbox() {
  const timers = new Set();
  const sandbox = {
    console,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    document: {
      readyState: 'loading',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
      addEventListener: () => {},
      body: { classList: { add() {}, remove() {} } }
    },
    setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); },
    TextEncoder,
    TextDecoder,
    URL,
    Blob,
    fetch: () => Promise.reject(new Error('测试环境不发网络请求'))
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx, timers };
}

function loadAll() {
  const { ctx } = makeSandbox();
  scripts.forEach(src => {
    const code = read(src);
    vm.runInContext(code, ctx, { filename: src });
  });
  return ctx.MC;
}

test('index.html 里的脚本都存在，且没有重复加载', () => {
  assert.ok(scripts.length > 30, '脚本数量异常：' + scripts.length);
  scripts.forEach(src => {
    assert.ok(fs.existsSync(path.join(ROOT, src)), '脚本文件不存在：' + src);
  });
  assert.equal(new Set(scripts).size, scripts.length, '有重复的 <script>');
});

test('按 index.html 顺序加载后，核心命名空间齐全', () => {
  const MC = loadAll();
  assert.ok(MC.store && MC.store.state, 'MC.store 缺失');
  assert.ok(MC.render && typeof MC.render.all === 'function', 'MC.render.all 缺失');
  assert.ok(MC.ui && typeof MC.ui.init === 'function', 'MC.ui.init 缺失');
  assert.ok(typeof MC.actionCtx === 'object', 'MC.actionCtx 缺失');
  assert.ok(typeof MC.actions === 'object', 'MC.actions 缺失');
});

test('渲染层导出完整（拆分视图时容易漏）', () => {
  const MC = loadAll();
  RENDER_KEYS.forEach(k => {
    assert.ok(MC.render[k] !== undefined, '缺 MC.render.' + k);
  });
  ['renderDeps', 'renderRows', 'renderPack', 'renderGuide', 'renderDiff', 'renderTools', 'detailHtml', 'previewHtml']
    .forEach(k => assert.equal(typeof MC.render[k], 'function', 'MC.render.' + k + ' 不是函数'));
});

test('动作接口完整：其它模块调用到的 C.xxx 都存在', () => {
  const MC = loadAll();
  ACTION_KEYS.forEach(k => {
    const v = MC.actionCtx[k];
    assert.ok(v !== undefined, '缺 MC.actionCtx.' + k);
    if (k !== 'S') assert.equal(typeof v, 'function', 'MC.actionCtx.' + k + ' 不是函数');
  });
  assert.ok(Object.keys(MC.actionCtx).length >= ACTION_KEYS.length, 'actionCtx 键数量偏少');
});

test('流程层与绑定层模块都已加载', () => {
  const MC = loadAll();
  FLOW_NAMES.forEach(k => assert.ok(MC[k], '缺 ' + k));
  BIND_NAMES.forEach(k => assert.ok(MC[k] && typeof MC[k].init === 'function', '缺 ' + k + '.init'));
});

test('没有动作处理函数被注册表引用却不存在', () => {
  const MC = loadAll();
  const names = Object.keys(MC.actions);
  assert.ok(names.length >= 20, '动作注册表偏少：' + names.length);
  names.forEach(name => {
    assert.equal(typeof MC.actions[name], 'function', 'MC.actions.' + name + ' 不是函数');
  });
});
