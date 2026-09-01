#!/usr/bin/env node
/**
 * 契约测试：Android Java 桥注入时序与暴露面契约。
 *
 * 前端以「window.wails.requestStoragePermission 为函数」能力探测安卓桥。
 * 探测原语自 ADR-123 P3 后下沉到 frontend/src/backend/platform.ts
 * （android-bridge.ts 仅 re-export），契约测试须联合扫描两处，否则重构后误报漂移。
 * 这条链路依赖四处源码级隐式契约，任一漂移即产生误判：
 *
 *   1. 时序契约：MainActivity 必须 addJavascriptInterface 先于 loadUrl——
 *      页面首行 JS 执行时桥已可见，无冷启动竞态（桌面 WebView2 异步脚本注入才有
 *      此问题，platform.ts 留到 Phase 3 的 awaitWailsBridge）。若有人调换顺序或
 *      改为异步注入，前端启动期探测将假阴性。
 *   2. 注解契约：被 JS 探测的方法必须带 @JavascriptInterface（Android API 17+
 *      未注解的 public 方法不暴露给 JS，静默失败无报错）。
 *   3. 混淆契约：ProGuard 必须保留 WailsJSBridge/WailsBridge，否则 release 构建
 *      方法被剥离 → 同样静默假阴性。
 *   4. 命名契约：注册名 "wails" 与前端探测目标、前端接口声明的两个方法名
 *      （hasStoragePermission/requestStoragePermission）三方一致。
 *
 * 真机 e2e 需模拟器（重基础设施），本测试在源码层锁死契约，直接跑进 pre-push 门禁。
 * 若有意重构注入方式（如改异步桥），请同步更新本测试并重新论证首帧可用性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAIN_ACTIVITY = 'build/android/app/src/main/java/com/wails/app/MainActivity.java';
const JS_BRIDGE = 'build/android/app/src/main/java/com/wails/app/WailsJSBridge.java';
const PROGUARD = 'build/android/app/proguard-rules.pro';
// ADR-123 P3：探测原语下沉 backend/platform.ts（android-bridge.ts 仅 re-export），
// 命名契约需联合扫描两处，否则重构后误报漂移。
const FRONTEND_BRIDGE_FILES = [
  path.join('frontend', 'src', 'utils', 'dom', 'android-bridge.ts'),
  path.join('frontend', 'src', 'backend', 'platform.ts'),
];

/** 前端 WailsAndroidBridge 接口声明、且 getAndroidBridge 用作存在性判定的方法 */
const PROBED_METHODS = ['hasStoragePermission', 'requestStoragePermission'];
/** 上游对齐的核心调用面（runtime_android.go 注释所述 window.wails.invoke） */
const CORE_METHODS = ['invoke'];

const errors = [];

function read(relOrAbs) {
  const fp = relOrAbs.startsWith(ROOT) ? relOrAbs : path.join(ROOT, relOrAbs);
  if (!fs.existsSync(fp)) {
    errors.push(`MISSING: ${relOrAbs}（文件不存在，路径漂移？）`);
    return null;
  }
  return fs.readFileSync(fp, 'utf-8');
}

// ---- 1. 时序契约：先 addJavascriptInterface 后 loadUrl ----
const main = read(MAIN_ACTIVITY);
if (main !== null) {
  const injectIdx = main.indexOf('addJavascriptInterface');
  const loadIdx = main.indexOf('.loadUrl(');
  if (injectIdx === -1 || loadIdx === -1) {
    errors.push(`${MAIN_ACTIVITY}: 未找到 addJavascriptInterface 或 loadUrl（注入机制重构？需同步本测试）`);
  } else if (injectIdx > loadIdx) {
    errors.push(
      `${MAIN_ACTIVITY}: addJavascriptInterface 出现在 loadUrl 之后 → 页面首行 JS 看不到 window.wails，` +
      '前端 getAndroidBridge() 启动期假阴性。必须先注入再加载',
    );
  }
  // 注册名必须是 "wails"（上游 runtime_android.go 对齐：window.wails.invoke）
  if (!/addJavascriptInterface\(\s*new\s+WailsJSBridge\([^)]*\)\s*,\s*"wails"\s*\)/.test(main)) {
    errors.push(`${MAIN_ACTIVITY}: WailsJSBridge 未以 "wails" 名注册（前端按 window.wails 探测）`);
  }
}

// ---- 2. 注解契约：JS 探测的方法必须带 @JavascriptInterface ----
const bridgeSrc = read(JS_BRIDGE);
if (bridgeSrc !== null) {
  const annotated = new Set();
  const re = /@JavascriptInterface\s+public\s+(?:static\s+)?[\w.<>[\]]+\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(bridgeSrc)) !== null) annotated.add(m[1]);
  for (const name of [...PROBED_METHODS, ...CORE_METHODS]) {
    if (!annotated.has(name)) {
      errors.push(`${JS_BRIDGE}: 方法 ${name} 缺 @JavascriptInterface（API 17+ 未注解方法不暴露给 JS，前端探测静默假阴性）`);
    }
  }
}

// ---- 3. 混淆契约：release 构建不剥离桥类 ----
const proguard = read(PROGUARD);
if (proguard !== null) {
  for (const cls of ['com.wails.app.WailsJSBridge', 'com.wails.app.WailsBridge']) {
    if (!proguard.includes(`-keep class ${cls}`)) {
      errors.push(`${PROGUARD}: 缺 "-keep class ${cls} { *; }"，release 构建混淆剥离后前端探测假阴性`);
    }
  }
}

// ---- 4. 命名契约：前端探测目标与方法名和 Java 侧一致（多文件联合扫描）----
const feParts = FRONTEND_BRIDGE_FILES.map(read).filter((t) => t !== null);
const fe = feParts.join('\n');
if (feParts.length > 0) {
  if (!fe.includes('.wails')) {
    errors.push(`${FRONTEND_BRIDGE_FILES.join(' / ')}: 未探测 window.wails（Java 侧注册名或本文件漂移，两侧需同步）`);
  }
  for (const name of PROBED_METHODS) {
    if (!fe.includes(name)) {
      errors.push(`${FRONTEND_BRIDGE_FILES.join(' / ')}: 探口不再引用 ${name}，而 ${JS_BRIDGE} 仍暴露——删除 Java 侧方法前先同步本测试`);
    }
  }
}

if (errors.length) {
  console.error(`FAILED: ${errors.length} issue(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('OK: android bridge injection-order + @JavascriptInterface + proguard + naming parity checks passed');
