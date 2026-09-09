// ===== i18n 语言状态管理（ADR-045 / ADR-210 D1 引擎无关 host 注入）=====
// 语言偏好持久化到 localStorage，启动时检测系统语言，切换时触发 lang:changed 事件。
// 语言包缓存也收归本模块，避免与 t.ts 循环依赖。
// ADR-210 D1：DOM/网络副作用（fetch / navigator / document / import.meta.env）全部经
// LocaleHost 注入——宿主实现 utils/dom/locale-host.ts（DOM 原语层），装配层 app-modules.ts
// 在 initI18n 前调 setLocaleHost 接线；core 只持纯策略：语言检测（detectFromLangs）、
// html lang 映射（htmlLangAttr）、回落链、告警节流。
// 未注入 host = fail-open：loadLocale 告警一次并跳过（host 就绪后可重试），
// systemLanguages / setHtmlLang 缺省空候选 / no-op，不挂启动链。

import { bus } from "@/bus";
import { safeGet, safeSet } from "@/utils/base/storage.ts";

const STORAGE_KEY = "uiLang";

/** 支持的语言列表（规划清单；i18n-check.ts 正则解析此字面量形式，勿改结构） */
export const SUPPORTED_LANGS = [
  { code: "zh-CN", label: "简体中文", key: "lang.zh-CN" },
  { code: "en", label: "English", key: "lang.en" },
  { code: "ja", label: "日本語", key: "lang.ja" },
] as const;

export type LangCode = (typeof SUPPORTED_LANGS)[number]["code"];
type Bundle = Record<string, string>;

/** 缺失键兜底语言（单一事实源：t.ts 引入使用；成员守卫在 locales-consistency.test.ts，ADR-210 D4） */
export const FALLBACK_LANG: LangCode = "en";

// ── 宿主注入（ADR-210 D1）──────────────────────────────────

/**
 * 语言副作用接口：实现由 DOM 原语层提供（utils/dom/locale-host.ts），
 * core 不碰浏览器全局（fetch / navigator / document / import.meta.env）。
 * loadBundle 契约：实现须自行捕获异步失败并返回 null（对齐 DiarySink 契约），
 * 返回 null = 本次未载到（不缓存、可重试），加载失败上下文由实现留痕。
 */
export interface LocaleHost {
  /** 加载指定语言 JSON 包（失败返回 null） */
  loadBundle(lang: string): Promise<Record<string, string> | null>;
  /** 系统语言候选列表（navigator.languages，老 WebView 可能为空列表） */
  systemLanguages(): readonly string[];
  /** 同步 <html lang> 属性（入参为已映射值，映射策略见 htmlLangAttr） */
  setHtmlLang(code: string): void;
}

let host: LocaleHost | null = null;
/** 注入 / 清除宿主实现（装配层在 initI18n 前调用；传 null 恢复 fail-open 语义，测试隔离用） */
export function setLocaleHost(h: LocaleHost | null): void {
  host = h;
}

// ── 模块级状态 ──────────────────────────────────────

let _currentLang: LangCode = "zh-CN";

/** setLang 请求代际计数：并发切换时慢请求后到可覆盖后选，据此丢弃过期写入 */
let _langReqGen = 0;

/** 已加载的语言包缓存 */
const bundles: Record<string, Bundle> = {};

/** 无 host 时 loadLocale 的告警节流（每模块生命周期一次） */
let warnedNoHost = false;

/** 非空包判定（{} 是 truthy，直接判布尔会让空包短路 zh-CN 兜底） */
function isNonEmpty(b: Bundle | undefined): b is Bundle {
  return !!b && Object.keys(b).length > 0;
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

/** 在途加载表（lang → Promise）：并发 setLang/initI18n 同一未缓存语言只发一次加载 */
const pendingLoads = new Map<string, Promise<void>>();

/**
 * 加载指定语言包（幂等：已缓存或在途不重复加载；返回 undefined，状态经 getBundle 观察）。
 * JSON 包由 scripts/generate-locale-json 从 TS 源生成，经宿主通道取用（ADR-210 D1）。
 */
export function loadLocale(lang: string): Promise<void> {
  if (isNonEmpty(bundles[lang])) return Promise.resolve();
  const inFlight = pendingLoads.get(lang);
  if (inFlight) return inFlight;
  const p = doLoadLocale(lang).finally(() => pendingLoads.delete(lang));
  pendingLoads.set(lang, p);
  return p;
}

async function doLoadLocale(lang: string): Promise<void> {
  if (!host) {
    if (!warnedNoHost) {
      warnedNoHost = true;
      console.warn(
        `[i18n] ${lang} 语言包加载跳过：LocaleHost 未注入（装配层漏 setLocaleHost?），宿主就绪后自动重试`,
      );
    }
    return;
  }
  try {
    const loaded = await host.loadBundle(lang);
    if (loaded !== null) {
      bundles[lang] = loaded;
    } else {
      // 失败不缓存空对象——{} 是 truthy，会把「已加载」误判成立阻断重试、
      // 且让 zh-CN 兜底永不触发；删键允许瞬态失败后自愈重试（失败上下文由宿主实现留痕）
      delete bundles[lang];
    }
  } catch (e) {
    // 宿主实现违约（契约要求自行捕获失败返回 null）：兜底同「不缓存、可重试」语义
    console.warn(`[i18n] 加载 ${lang} 失败（未缓存，可重试）:`, e);
    delete bundles[lang];
  }
}

/**
 * 获取指定语言的翻译包（已加载时直接读缓存，空包/未加载回落非空基准 zh-CN）。
 * ADR-210 D2：已删 _activeBundle 手工缓存——其「刷新契约」（bundles/_currentLang 任一
 * 写点必须配对调 refreshActiveBundle）是口头纪律，漏配对即幽灵缓存；无参退化直查表，
 * 多两次属性读取（纳秒级），不为它买正确性风险。
 * 注意与 getLang() 区分：getBundle 返回翻译表（对象），getLang 返回语言代码（字符串）。
 */
export function getBundle(lang?: string): Bundle {
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

/** 切换语言（异步加载语言包后触发事件） */
export async function setLang(code: LangCode): Promise<void> {
  if (code === _currentLang) return;
  if (!SUPPORTED_LANGS.some((l) => l.code === code)) return; // 运行时收窄，防 .js 调用方注入
  const gen = ++_langReqGen;
  await loadLocale(code);
  if (gen !== _langReqGen) return; // 已有更新的切换请求 → 放弃过期写入
  // initI18n 旁路直接写 _currentLang（不经 gen），写前再对账一次防覆盖
  if (code === _currentLang) return;
  _currentLang = code;
  safeSet(STORAGE_KEY, code);
  host?.setHtmlLang(htmlLangAttr(code));
  // 切语言后清空缺失 key 告警节流——warnedKeys 是全局 Set 跨语言复用，
  // zh-CN 期记录的 key 会吃掉 en/ja 期同 key 的告警（静默缺译）
  warnedKeys.clear();
  bus.emit("lang:changed", { lang: code });
}

// ── 系统语言检测（ADR-210 D1：navigator 读取经宿主，策略在此纯化）────────────────────

/** 系统语言候选 → 支持语言（纯策略：繁体中文家族暂回落简体，其余中文 → 简体） */
export function detectFromLangs(langs: readonly string[]): LangCode | null {
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

// ── HTML 属性映射（ADR-210 D1：属性写入经宿主，映射策略在此）──────────────────────

/** <html lang> 属性映射：zh-CN → BCP-47 简体标记，其余透传 */
function htmlLangAttr(code: string): string {
  return code === "zh-CN" ? "zh-Hans" : code;
}

// ── 初始化 ──────────────────────────────────────────────

/**
 * 启动时调用：读取持久化/系统语言 → 预加载语言包 → 同步 HTML 属性。
 * 组件渲染可能早于语言包就绪（customElements.define 在模块顶层同步执行，
 * 加载异步），故加载成功后补发一次 lang:changed，让首帧拿到空 bundle
 * 的组件重渲染（与 setLang 热切换走同一通道）。
 * 未注入 host（装配层漏接线）：语言回落 zh-CN 默认 + 加载跳过告警一次（fail-open），
 * 不抛错、不挂 app-modules 启动链。
 */
export async function initI18n(): Promise<void> {
  const saved = safeGet(STORAGE_KEY) as LangCode | null;
  const detected = detectFromLangs(host?.systemLanguages() ?? []);
  _currentLang =
    saved && SUPPORTED_LANGS.some((l) => l.code === saved) ? saved : (detected ?? "zh-CN");

  host?.setHtmlLang(htmlLangAttr(_currentLang));
  await loadLocale(_currentLang);
  // 仅当语言包确实加载成功（非空）才通知重渲染；失败留待重试，不污染订阅通道
  const loaded = bundles[_currentLang];
  if (loaded && Object.keys(loaded).length > 0) {
    bus.emit("lang:changed", { lang: _currentLang });
  }
}
