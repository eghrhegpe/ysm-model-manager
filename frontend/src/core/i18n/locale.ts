// ===== i18n 语言状态管理（ADR-045）=====
// 语言偏好持久化到 localStorage，启动时检测系统语言，切换时触发 lang:changed 事件。
// 语言包缓存也收归本模块，避免与 t.ts 循环依赖。

import { bus } from "../../bus.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";

const STORAGE_KEY = "uiLang";

/** 支持的语言列表（规划清单） */
export const SUPPORTED_LANGS = [
  { code: "zh-CN", label: "简体中文", key: "lang.zh-CN" },
  { code: "en", label: "English", key: "lang.en" },
] as const;

export type LangCode = (typeof SUPPORTED_LANGS)[number]["code"];
type Bundle = Record<string, string>;

// ── 模块级状态 ──────────────────────────────────────

let _currentLang: LangCode = "zh-CN";

/** 已加载的语言包缓存 */
const bundles: Record<string, Bundle> = {};

/** 缺失 key 告警节流（每 key 只告警一次） */
export const _warned = new Set<string>();

// ── 语言包加载 ──────────────────────────────────────

/**
 * 加载指定语言的 JSON 包（幂等：已加载不重复 fetch）。
 * JSON 由 scripts/generate-locale-json.mjs 从 TS 源文件生成，
 * 放在 public/locales/{lang}.json。
 */
export async function loadLocale(lang: string): Promise<void> {
  if (bundles[lang]) return;
  try {
    const base = import.meta.env.BASE_URL ?? "/";
    const resp = await fetch(`${base}locales/${lang}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    bundles[lang] = await resp.json();
  } catch (e) {
    console.warn(`[i18n] 加载 ${lang} 失败:`, e);
    bundles[lang] = {};
  }
}

/** 获取指定语言的翻译包（已加载时直接读缓存，否则回落到基准） */
export function getBundle(lang?: string): Bundle {
  const code = lang ?? _currentLang;
  return bundles[code] ?? bundles["zh-CN"] ?? {};
}

// ── 语言读写 ──────────────────────────────────────────

/** 读取当前语言代码 */
export function getLang(): LangCode {
  return _currentLang;
}

/** 切换语言（异步加载语言包后触发事件） */
export async function setLang(code: LangCode): Promise<void> {
  if (code === _currentLang) return;
  await loadLocale(code);
  _currentLang = code;
  safeSet(STORAGE_KEY, code);
  applyHtmlLang(code);
  bus.emit("lang:changed", { lang: code });
}

// ── 系统语言检测 ──────────────────────────────────────

function detectSystemLang(): LangCode | null {
  const langs = navigator.languages;
  for (const tag of langs) {
    const lower = tag.toLowerCase();
    // 繁体中文家族
    if (/^zh-(?:hant|tw|hk|mo)$/i.test(lower)) return "zh-CN"; // 暂回落简体，繁体包就绪后改为 "zh-TW"
    // 其余中文 → 简体
    if (/^zh/i.test(lower)) return "zh-CN";
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
 * 必须在组件渲染前完成，否则首帧会闪烁。
 */
export async function initI18n(): Promise<void> {
  const saved = safeGet(STORAGE_KEY) as LangCode | null;
  const detected = detectSystemLang();
  _currentLang =
    saved && SUPPORTED_LANGS.some((l) => l.code === saved)
      ? saved
      : detected ?? "zh-CN";

  applyHtmlLang(_currentLang);
  await loadLocale(_currentLang);
}
