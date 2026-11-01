const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/api/translate.js');
const TR = globalThis.MC.translate;

// 用假的 fetch 记录请求，验证“该不该翻译”
function stubFetch() {
  const urls = [];
  globalThis.fetch = async url => {
    const u = String(url);
    urls.push(u);
    const q = decodeURIComponent(u.split('q=')[1] || '');
    if (u.includes('googleapis')) {
      return { ok: true, json: async () => [[['【译】' + q.slice(0, 8), q]]] };
    }
    return { ok: true, json: async () => ({ responseData: { translatedText: '【备】' + q.slice(0, 8) } }) };
  };
  return urls;
}

test('纯中文不请求翻译接口', async () => {
  const urls = stubFetch();
  const r = await TR.zh('这是一个纯中文的简介，没有英文。');
  assert.equal(r.ok, true);
  assert.equal(r.text, '这是一个纯中文的简介，没有英文。');
  assert.equal(urls.length, 0);
});

test('中文里夹一个英文单词也不请求', async () => {
  const urls = stubFetch();
  await TR.zh('中文简介，里面提到 Minecraft 这个游戏。');
  assert.equal(urls.length, 0);
});

test('带 emoji 的英文简介会被翻译（不再误判成中文）', async () => {
  const urls = stubFetch();
  const r = await TR.zh("Gardener's Dream 🏳️ 🛏️ 🔨\n\nA mod that adds garden stuff. Place beds and grow plants.");
  assert.equal(r.ok, true);
  assert.match(r.text, /【译】/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /googleapis/);
});
