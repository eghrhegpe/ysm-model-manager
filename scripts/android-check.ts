#!/usr/bin/env node
/**
 * Android Java 语法/API 编译检测（gradle :app:compileDebugJavaWithJavac）。
 * 改 build/android 下的 Java 后跑它做语法+类型+API 可用性验证，无需连接设备。
 * 依赖：Android SDK（ANDROID_HOME）+ JDK（gradle wrapper 自带下载）。
 * 子进程统一走 _lib/proc.ts run()（数组参数，无 shell 拼接，ADR-043）。
 * 用法：
 *   node scripts/android-check.ts          # 编译检测
 *   node scripts/android-check.ts --full   # 完整 assembleDebug（含 dex/打包/签名）
 *   node scripts/android-check.ts --help
 * 退出码：0 编译通过；1 失败（gradle 输出尾部直通）。
 * 设计意图：Android Java 语法/API 编译检测，改 build/android 下的 Java 后做验证，无需连接设备。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const ANDROID_DIR = path.join(ROOT, 'build', 'android');

function fail(msg: string) {
  console.error(`[android-check] ${msg}`);
  process.exit(1);
}

const full = process.argv.includes('--full');
const jsonOut = process.argv.includes('--json');
if (process.argv.includes('--help')) {
  console.log(`用法:
  node scripts/android-check.ts          编译检测（compileDebugJavaWithJavac，约 10s）
  node scripts/android-check.ts --full   完整 assembleDebug（含 dex/打包/签名）
前置：ANDROID_HOME 指向 SDK（platforms + build-tools），JDK 可用。
装到手机用: node scripts/android-install.ts
`);
  process.exit(0);
}

if (!fs.existsSync(path.join(ANDROID_DIR, 'settings.gradle'))) {
  fail(`未找到 ${path.relative(ROOT, ANDROID_DIR)}，确认在仓库根运行`);
}

const gradlew = os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlewPath = path.join(ANDROID_DIR, gradlew);
if (!fs.existsSync(gradlewPath)) {
  fail(`缺少 ${gradlew}（Android 工程未初始化？）`);
}
// POSIX 下嵌入资产解压会丢 gradlew 执行位（Taskfile 同款处理）
if (os.platform() !== 'win32') {
  try {
    fs.chmodSync(gradlewPath, 0o755);
  } catch { /* 忽略，交由下方执行报错 */ }
}

const task = full ? ':app:assembleDebug' : ':app:compileDebugJavaWithJavac';
console.log(`[android-check] gradlew ${task} ...`);
// gradle 首次可能拉发行版/依赖，timeout 放 0 不限时
const r = run(gradlew, [task], {
  cwd: ANDROID_DIR,
  timeout: 0,
  shell: os.platform() === 'win32',
});

if (r.ok) {
  if (jsonOut) console.log(JSON.stringify({ _summary: { ok: true, task }, rc: r.rc }));
  else console.log(`[android-check] ✅ ${task} 通过`);
  process.exit(0);
}
if (jsonOut) {
  console.log(JSON.stringify({ _summary: { ok: false, task, rc: r.rc }, tail: r.out.slice(-1200) }));
} else {
  console.error(`[android-check] ❌ ${task} 失败（rc=${r.rc}）：\n${r.out.slice(-1200)}`);
}
process.exit(1);
