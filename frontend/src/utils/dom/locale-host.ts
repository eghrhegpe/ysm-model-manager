// ===== i18n LocaleHost DOM 适配器（ADR-210 D1）=====
// core/i18n/locale.ts 定义 Locale 副作用接口（引擎无关），本文件提供 DOM 原语层实现：
// 语言包 fetch / 系统语言读取 / <html lang> 同步——浏览器全局的访问集中在这一处。
// utils/dom → core 为合法边（与 global-error-listeners.ts → error-diary.ts 同构）；
// 装配层 app-modules.ts 在 i18n 启动步内 setLocaleHost(makeLocaleHost()) 接线（先于 initI18n）。
import type { LocaleHost } from "@/core/i18n/locale.ts";

/** 构建生产 LocaleHost：fetch public/locales/{lang}.json（Vite BASE_URL 感知）+ navigator.languages + document.documentElement.lang */
export function makeLocaleHost(): LocaleHost {
  const base = import.meta.env.BASE_URL ?? "/";
  return {
    async loadBundle(lang) {
      try {
        const resp = await fetch(`${base}locales/${lang}.json`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()) as Record<string, string>;
      } catch (e) {
        // IO 层失败留痕（含 HTTP 状态 / 网络错误上下文）；core 侧把 null 当「不缓存、可重试」
        console.warn(`[i18n] ${lang} 语言包获取失败（未缓存，可重试）:`, e);
        return null;
      }
    },
    systemLanguages() {
      // navigator.languages 在个别老旧 WebView 下可能为 undefined，兜底单语言数组（ADR-045 原语义）
      return navigator.languages ?? [navigator.language ?? ""];
    },
    setHtmlLang(code) {
      document.documentElement.lang = code;
    },
  };
}
