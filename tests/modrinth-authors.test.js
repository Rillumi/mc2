const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/api/modrinth.js');
const M = globalThis.MC.api.modrinth;

test('jar 里的三个作者能对应到 Modrinth 团队账号', () => {
  const members = [{ username: 'Tschipp' }, { username: 'Purplicious_Cow' }, { username: 'cy4n' }, { username: 'other' }];
  assert.deepEqual(M.matchAuthors(['Tschipp', 'Purplicious_Cow', 'cy4n'], members),
    ['Tschipp', 'Purplicious_Cow', 'cy4n']);
});

test('大小写和下划线不影响匹配', () => {
  assert.deepEqual(M.matchAuthors(['purplicious cow'], [{ username: 'Purplicious_Cow' }]), ['Purplicious_Cow']);
});

test('名字相似但不是同一个人时不给账号链接', () => {
  assert.deepEqual(M.matchAuthors(['Tschipp'], [{ username: 'TschippFan' }]), []);
  assert.deepEqual(M.matchAuthors(['cy4n'], [{ username: 'cy4n2' }]), []);
});

test('jar 没有作者或项目没有成员时返回空', () => {
  assert.deepEqual(M.matchAuthors([], [{ username: 'Tschipp' }]), []);
  assert.deepEqual(M.matchAuthors(['Tschipp'], []), []);
});
