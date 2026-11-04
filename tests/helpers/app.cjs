const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

function createApp() {
  const saved = [], messages = [], errors = [];
  const ctx = vm.createContext({
    Blob, File, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView,
    Response, CompressionStream, DecompressionStream, URL, URLSearchParams,
    crypto: webcrypto, setTimeout, clearTimeout,
    console: { log(){}, warn(){}, error(e){errors.push(e.stack || String(e));} },
    localStorage: {getItem(){return null;},setItem(){}},
    fetch: async () => { throw new Error('测试不访问外网'); }
  });
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ctx, {filename:file});
  for (const name of ['zip-reader', 'zip-writer', 'version', 'identity', 'metadata', 'conflicts', 'analyzer', 'selector', 'platform-deps', 'plan', 'dependencies', 'modpack', 'overrides']) load('js/core/' + name + '.js');
  load('js/ui/state.js');
  const MC = ctx.MC;
  MC.uiBase = {
    toast: text => messages.push(text), saveBlob: (blob, name) => saved.push({blob,name}),
    sha1Hex: async buf => createHash('sha1').update(new Uint8Array(buf)).digest('hex')
  };
  MC.api = {modrinth:{download:async () => {throw new Error('未提供下载样本');}}};
  MC.flowCommon = {projectForEntry(){return null;}};
  MC.flowAnalysis = {async analyzeAndResolve(){
    const s = MC.store.state;
    s.analysis = MC.analyzer.analyze(s.mods, s.env);
    MC.selector.assign(s, s.analysis);
  }};
  MC.flowMeta = Object.fromEntries(['prefetchProjects','prefetchLite','prefetchZhNames','applyCats'].map(k=>[k,()=>{}]));
  MC.pager = {resetAll(){}};
  for (const file of ['js/pack/mrpack.js','js/pack/verify.js','js/ui/flow/scan.js','js/ui/flow/pack.js']) load(file);
  return {MC,saved,messages,errors,load,ctx};
}

module.exports = { createApp };
