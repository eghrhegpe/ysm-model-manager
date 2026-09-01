#!/usr/bin/env node
/**
 * 一键编译并安装 Android 调试版到已连接设备（gradle installDebug + 自动拉起应用）。
 * 解决「打指令装安卓版折腾」：仓库根一条口令 → 设备检查 → installDebug → am start。
 * 依赖：Android SDK（ANDROID_HOME，platform-tools/adb）+ JDK（gradle wrapper 自带下载）。
 * 子进程统一走 _lib/proc.ts run()（数组参数，无 shell 拼接，ADR-043）。
 * 用法：
 *   node scripts/android-install.ts            # 编译安装 + 自动拉起应用
 *   node scripts/android-install.ts --no-launch # 只安装，不拉起
 *   node scripts/android-install.ts --help
 * 退出码：0 成功；1 无设备/未授权/编译或安装失败（错误信息直通）。
 * 设计意图：一键编译安装 Android 调试版到已连接设备，解决「打指令装安卓版折腾」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const ANDROID_DIR = path.join(ROOT, 'build', 'android');
const APP_ID = 'com.ysm.modelmanager'; // app/build.gradle applicationId
// Activity 全名必须写全限定：namespace 是 com.wails.app（build.gradle），
// 缩写 .MainActivity 会被 am start 按 applicationId 解析成 com.ysm.modelmanager.MainActivity 而失败
const MAIN_ACTIVITY = `${APP_ID}/com.wails.app.MainActivity`;

/** 定位 adb：优先 $ANDROID_HOME/platform-tools/adb[.exe]，回退 PATH */
function findAdb() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    const exe = os.platform() === 'win32' ? 'adb.exe' : 'adb';
    const candidate = path.join(home, 'platform-tools', exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'adb'; // 交给 PATH
}

/** 列出已连接（state=device）的设备序列号 */
function connectedDevices(adb: string) {
  const r = run(adb, ['devices']);
  if (!r.ok) return [];
  return r.out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

function fail(msg: string) {
  console.error(`[android-install] ${msg}`);
  process.exit(1);
}

const noLaunch = process.argv.includes('--no-launch');
if (process.argv.includes('--help')) {
  console.log(`用法:
  node scripts/android-install.ts            编译安装 + 自动拉起应用
  node scripts/android-install.ts --no-launch 只安装，不拉起
前置：手机开启 USB 调试并连接（adb devices 可见），或无线调试：
  adb pair <ip:port>   # 首次配对（开发者选项 → 无线调试 → 配对码）
  adb connect <ip:port>
`);
  process.exit(0);
}

if (!fs.existsSync(path.join(ANDROID_DIR, 'settings.gradle'))) {
  fail(`未找到 ${path.relative(ROOT, ANDROID_DIR)}，确认在仓库根运行`);
}

const adb = findAdb();
const devices = connectedDevices(adb);
if (devices.length === 0) {
  fail(`未检测到已连接设备（adb devices 无 device 状态设备）。
  ① USB 调试：手机开「开发者选项 → USB 调试」后连接，弹窗允许调试；
  ② 无线调试：开发者选项 → 无线调试 → 「adb pair <ip:port>」配对后「adb connect <ip:port>」。
  若 adb 不在 PATH，请设置 ANDROID_HOME（当前: ${process.env.ANDROID_HOME || '未设置'}）。`);
}
console.log(`[android-install] 设备: ${devices.join(', ')}`);

const gradlew = os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlewPath = path.join(ANDROID_DIR, gradlew);
if (!fs.existsSync(gradlewPath)) {
  fail(`缺少 ${gradlew}（Android 工程未初始化？）`);
}
// POSIX 下嵌入资产解压会丢 gradlew 执行位（Taskfile 同款处理）
if (os.platform() !== 'win32') {
  try {
    fs.chmodSync(gradlewPath, 0o755);
  } catch { /* 只读文件系统等场景忽略，交由下方执行报错 */ }
}

/** 编译并安装 debug 版；失败返回 { ok, out }（out 含 gradle 输出，供 INSTALL_FAILED 判定） */
function installDebug() {
  // gradlew.bat 非原生 exe，Windows 必须 shell；gradle 首次可能拉发行版，timeout 放 0 不限时
  return run(gradlew, [':app:installDebug'], {
    cwd: ANDROID_DIR,
    timeout: 0,
    shell: os.platform() === 'win32',
  });
}

/** 卸载旧版（对每个设备；包不存在/已卸载时忽略错误） */
function uninstallAll() {
  for (const s of devices) {
    run(adb, ['-s', s, 'uninstall', APP_ID]);
  }
}

let install = installDebug();
if (!install.ok) {
  if (/INSTALL_FAILED/i.test(install.out)) {
    // 常见根因：手机上已有旧版且签名/版本不兼容（INSTALL_FAILED_UPDATE_INCOMPATIBLE）。
    // dev 安装场景旧版数据无兼容价值，卸载后重试一次；编译类错误不走此分支。
    console.warn('[android-install] 安装失败（签名/版本冲突），卸载旧版后重试...');
    uninstallAll();
    install = installDebug();
    if (!install.ok) {
      fail(`卸载旧版后重装仍失败：\n${install.out.slice(-800)}`);
    }
  } else {
    fail(`installDebug 失败（编译/环境问题，未卸载任何旧版）：\n${install.out.slice(-800)}`);
  }
}

if (!noLaunch) {
  let launched = 0;
  for (const s of devices) {
    const r = run(adb, ['-s', s, 'shell', 'am', 'start', '-n', MAIN_ACTIVITY]);
    if (r.ok) launched += 1;
    else console.warn(`[android-install] 设备 ${s} 拉起失败：${r.err || ''}`);
  }
  console.log(launched > 0 ? '[android-install] 已拉起应用' : '[android-install] 安装成功，但自动拉起失败，请手动点击应用图标');
}
console.log('[android-install] 完成');
