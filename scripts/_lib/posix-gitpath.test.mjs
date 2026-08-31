import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGitPath } from './posix-gitpath.ts';

const ROOT = 'C:\\repo';

// ── msys 路径归一 ──

test('msys /c/... → C:\\...（Windows 绝对路径）', () => {
  assert.equal(normalizeGitPath('/c/Users/x/msg.txt', ROOT), 'C:\\Users\\x\\msg.txt');
});

test('msys 含多级目录', () => {
  assert.equal(normalizeGitPath('/d/a/b/c.md', ROOT), 'D:\\a\\b\\c.md');
});

// ── 绝对路径直返 ──

test('Windows 绝对路径原样返回', () => {
  assert.equal(normalizeGitPath('C:\\repo\\docs\\x.md', ROOT), 'C:\\repo\\docs\\x.md');
});

// ── 相对路径 join root ──

test('相对路径相对仓库根解析', () => {
  assert.equal(normalizeGitPath('docs/x.md', ROOT), 'C:\\repo\\docs\\x.md');
});

test('posix 风格相对路径也 join root', () => {
  assert.equal(normalizeGitPath('frontend/src/y.ts', ROOT), 'C:\\repo\\frontend\\src\\y.ts');
});

// ── 边界 ──

test('空值原样返回', () => {
  assert.equal(normalizeGitPath('', ROOT), '');
  assert.equal(normalizeGitPath(null, ROOT), null);
});

test('非盘符字母的 /xxx 不被误判为 msys（视为相对，join root）', () => {
  // /etc/hosts 这种不带盘符的，按相对路径处理（join root）
  assert.equal(normalizeGitPath('etc/hosts', ROOT), 'C:\\repo\\etc\\hosts');
});
