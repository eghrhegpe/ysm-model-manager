import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './proc.ts';

// proc.mjs run() 共享层契约测试（code review f050902f 连环审核 P3 #9）：
// mergeStderr 切分 / 超时 stderr 保留 / stdio:'ignore' 空 out / 默认合并不回归。
// 用 process.execPath 跑 node -e 构造真实子进程（成功/失败/超时三态）。

const NODE = process.execPath;

// ── mergeStderr 切分语义 ──

test('run 默认 mergeStderr=true：失败时 out 合并 stdout+stderr（既有行为不回归）', () => {
  const r = run(NODE, ['-e', "process.stdout.write('OUT');process.stderr.write('ERR');process.exit(3)"], {});
  assert.equal(r.ok, false);
  assert.equal(r.rc, 3);
  assert.equal(r.out, 'OUTERR');
  // 默认合并时 err 不含 stderr 原文（stderr 已在 out 里）
  assert.ok(!r.err.includes('ERR'));
});

test('run mergeStderr=false：失败时 out 仅 stdout，stderr 原文附入 err', () => {
  const r = run(NODE, ['-e', "process.stdout.write('OUT');process.stderr.write('ERR-DETAIL');process.exit(3)"], { mergeStderr: false });
  assert.equal(r.ok, false);
  assert.equal(r.rc, 3);
  assert.equal(r.out, 'OUT');
  assert.ok(r.err.includes('ERR-DETAIL'), `err 应含 stderr 原文，实际: ${r.err}`);
});

test('run mergeStderr=false：无 stdout 时 out 为空，诊断全在 err', () => {
  const r = run(NODE, ['-e', "process.stderr.write('COMPILE-ERROR');process.exit(1)"], { mergeStderr: false });
  assert.equal(r.ok, false);
  assert.equal(r.out, '');
  assert.ok(r.err.includes('COMPILE-ERROR'), `err 应含编译错误，实际: ${r.err}`);
});

test('run 成功路径：out 为 stdout（与 mergeStderr 无关）', () => {
  const r = run(NODE, ['-e', "process.stdout.write('OK');process.stderr.write('NOISE');"], { mergeStderr: false });
  assert.equal(r.ok, true);
  assert.equal(r.rc, 0);
  assert.equal(r.out, 'OK');
});

// ── 超时分支：stderr 保留 ──

test('run 超时：rc=-2，mergeStderr=false 时 err 含超时文案与 stderr 原文', () => {
  // 慢 CI/Windows 冷启动下 node -e 引导可能 >200ms：timeout 太紧会在子进程写 stderr 前
  // 就 kill 掉，HANG-TRACE 断言随机红（连环 review 5c6accc4，4 条同源）。
  // 放宽到 1500ms（子进程自身 setTimeout 5000ms 保证 rc=-2 仍成立）+ setInterval 周期写，双保险。
  const r = run(NODE, ['-e', "setInterval(()=>process.stderr.write('HANG-TRACE'), 10);setTimeout(()=>{}, 5000)"], {
    timeout: 1500,
    mergeStderr: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.rc, -2);
  assert.ok(r.err.includes('timed out'), `err 应含超时文案，实际: ${r.err}`);
  assert.ok(r.err.includes('HANG-TRACE'), `err 应保留超时前的 stderr，实际: ${r.err}`);
});

// ── stdio 透传 ──

test('run stdio:ignore：成功时 out 为空（不捕获输出）', () => {
  const r = run(NODE, ['-e', "console.log('X')"], { stdio: 'ignore' });
  assert.equal(r.ok, true);
  assert.equal(r.rc, 0);
  assert.equal(r.out, '');
});

// ── ENOENT ──

test('run 找不到命令：rc=-1，err 提示 command not found', () => {
  const r = run('definitely-not-a-real-bin-ysm', ['--x'], {});
  assert.equal(r.ok, false);
  assert.equal(r.rc, -1);
  assert.ok(r.err.includes('command not found'));
});
