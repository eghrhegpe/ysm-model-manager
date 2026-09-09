// ===== i18n 语言状态管理（ADR-045）=====
// 语言偏好持久化到 localStorage，启动时检测系统语言，切换时触发 lang:changed 事件。
// 语言包缓存也收归本模块，避免与 t.ts 循环依赖。

import { bus } from "@/bus";
import { safeGet, safeSet } from "@/utils/base/storage.ts";

const STORAGE_KEY = "uiLang";

/** 支持的语言列表（规划清单） */
export const SUPPORTED_LANGS = [
  { code: "zh-CN", label: "简体中文", key: "lang.zh-CN" },
  { code: "en", label: "English", key: "lang.en" },
  { code: "ja", label: "日本語", key: "lang.ja" },
] as const;

export type LangCode = (typeof SUPPORTED_LANGS)[number]["code"];
type Bundle = Record<string, string>;

// ── 模块级状态 ──────────────────────────────────────

let _currentLang: LangCode = "zh-CN";

/** setLang 请求代际计数：并发切换时慢请求后到可覆盖后选，据此丢弃过期写入 */
let _langReqGen = 0;

/** 已加载的语言包缓存 */
const bundles: Record<string, Bundle> = {};

/** 无参 getBundle() 的活跃包引用缓存：t() 是渲染热路径，退化为一次属性读取。
 *  刷新契约：bundles/_currentLang 任一写点必须配对调 refreshActiveBundle（ADR-189 D5） */
let _activeBundle: Bundle | undefined;

/** 非空包判定（{} 是 truthy，直接判布尔会让空包短路 zh-CN 兜底） */
function isNonEmpty(b: Bundle | undefined): b is Bundle {
  return !!b && Object.keys(b).length > 0;
}

/** 刷新活跃包缓存（bundles / _currentLang 任一变更后调用）；
 *  平铺 early-return：每候选只取一次，避免 Object.keys 全量扫描重复执行 */
function refreshActiveBundle(): void {
  const cur = bundles[_currentLang];
  if (isNonEmpty(cur)) {
    _activeBundle = cur;
    return;
  }
  const base = bundles["zh-CN"];
  _activeBundle = isNonEmpty(base) ? base : undefined;
}

// 缺失 key 告警节流：每 key 只告警一次。可变状态保持私有，对外仅 warnMissingKey
//（ADR-207 D3：原导出可变 warnedKeys Set 属跨模块泄漏，收编为 API）
const warnedKeys = new Set<string>();
export function warnMissingKey(key: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(`[i18n] 缺失 key: ${key}`);
}

// ── 语言包加载 ──────────────────────────────────────

/** 在途加载表（lang → Promise）：并发 setLang/initI18n 同一未缓存语言只发一次 fetch */
const pendingLoads = new Map<string, Promise<void>>();

/**
 * 加载指定语言的 JSON 包（幂等：已加载或在途不重复 fetch）。
 * JSON 由 scripts/generate-locale-json.mjs 从 TS 源文件生成，
 * 放在 public/locales/{lang}.json。
 */
export function loadLocale(lang: string): Promise<void> {
  if (bundles[lang]) return Promise.resolve();
  const inFlight = pendingLoads.get(lang);
  if (inFlight) return inFlight;
  const p = doLoadLocale(lang).finally(() => pendingLoads.delete(lang));
  pendingLoads.set(lang, p);
  return p;
}

async function doLoadLocale(lang: string): Promise<void> {
  try {
    const base = import.meta.env.BASE_URL ?? "/";
    const resp = await fetch(`${base}locales/${lang}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    bundles[lang] = await resp.json();
  } catch (e) {
    // 失败不缓存空对象——`if (bundles[lang]) return` 会把 {} 当「已加载」阻断重试，
    // 且空对象 truthy 让 zh-CN 兜底永不触发；删除键允许瞬态网络失败后自愈重试
    console.warn(`[i18n] 加载 ${lang} 失败（未缓存，可重试）:`, e);
    delete bundles[lang];
  } finally {
    refreshActiveBundle();
  }
}

/**
 * 获取指定语言的翻译包（已加载时直接读缓存，空包/未加载回落非空基准 zh-CN）。
 * 注意与 getLang() 区分：getBundle 返回翻译表（对象），getLang 返回语言代码（字符串）。
 */
export function getBundle(lang?: string): Bundle {
  if (lang === undefined && _activeBundle) return _activeBundle;
  const code = lang ?? _currentLang;
  if (isNonEmpty(bundles[code])) return bundles[code];
  if (isNonEmpty(bundles["zh-CN"])) return bundles["zh-CN"];
  return {};
}

// ── 语言读写 ──────────────────────────────────────────

/** 读取当前语言代码 */
export function getLang(): LangCode {
  return _currentLang;
}

/** _currentLang 唯一写点（ADR-189 D5）：赋值与活跃包缓存刷新强制配对 */
function setCurrentLang(code: LangCode): void {
  _currentLang = code;
  refreshActiveBundle();
}

/** 切换语言（异步加载语言包后触发事件） */
export async function setLang(code: LangCode): Promise<void> {
  if (code === _currentLang) return;
  if (!SUPPORTED_LANGS.some((l) => l.code === code)) return; // 运行时收窄，防 .js 调用方注入
  const gen = ++_langReqGen;
  await loadLocale(code);
  if (gen !== _langReqGen) return; // 已有更新的切换请求 → 放弃过期写入
  if (code === _currentLang) return;
  setCurrentLang(code);
  safeSet(STORAGE_KEY, code);
  applyHtmlLang(code);
  // 切语言后清空缺失 key 告警节流——warnedKeys 是全局 Set 跨语言复用，
  // zh-CN 期记录的 key 会吃掉 en/ja 期同 key 的告警（静默缺译）
  warnedKeys.clear();
  bus.emit("lang:changed", { lang: code });
}

// ── 系统语言检测 ──────────────────────────────────────

function detectSystemLang(): LangCode | null {
  // navigator.languages 在个别老旧 WebView 下可能为 undefined（initI18n 被
  // app-modules 顶层 await，抛错会打挂整个启动链），兜底单语言数组
  const langs = navigator.languages ?? [navigator.language ?? ""];
  for (const tag of langs) {
    const lower = tag.toLowerCase();
    // 繁体中文家族
    if (/^zh-(?:hant|tw|hk|mo)$/i.test(lower)) return "zh-CN"; // 暂回落简体，繁体包就绪后改为 "zh-TW"
    // 其余中文 → 简体
    if (/^zh/i.test(lower)) return "zh-CN";
    // 日语
    if (/^ja/i.test(lower)) return "ja";
    // 英语
    if (/^en/i.test(lower)) return "en";
  }
  return null;
}

// ── HTML 属性同步 ──────────────────────────────────────

function applyHtmlLang(code: string): void {
  document.documentElement.lang = code === "zh-CN" ? "zh-Hans" : code;
}

// ── 初始化 ──────────────────────────────────────────────

/**
 * 启动时调用：读取持久化/系统语言 → 预加载语言包 → 同步 HTML 属性。
 * 组件渲染可能早于语言包就绪（customElements.define 在模块顶层同步执行，
 * 而 fetch 异步），故加载成功后补发一次 lang:changed，让首帧拿到空 bundle
 * 的组件重渲染（与 setLang 热切换走同一通道）。
 */
export async function initI18n(): Promise<void> {
  const saved = safeGet(STORAGE_KEY) as LangCode | null;
  const detected = detectSystemLang();
  setCurrentLang(
    saved && SUPPORTED_LANGS.some((l) => l.code === saved) ? saved : (detected ?? "zh-CN"),
  );

  applyHtmlLang(_currentLang);
  await loadLocale(_currentLang);
  // 仅当语言包确实加载成功（非空）才通知重渲染；失败留待重试，不污染订阅通道
  const loaded = bundles[_currentLang];
  if (loaded && Object.keys(loaded).length > 0) {
    bus.emit("lang:changed", { lang: _currentLang });
  }
}
