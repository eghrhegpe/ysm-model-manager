// @vitest-environment happy-dom
// ===== static-a11y-labels.ts 契约（启动链静态可达性标签 i18n 覆写）=====
// 姿势同 locale.test.ts：fake LocaleHost 注入真实 zh-CN 包 → initI18n → t() 出值。
import { describe, expect, it, beforeEach } from "vitest";
import type { LocaleHost } from "./core/i18n/locale.ts";
import * as locale from "./core/i18n/locale.ts";
import { zhCN } from "./locales/zh-CN.ts";
import { localizeStaticA11yLabels } from "./static-a11y-labels.ts";

const host: LocaleHost = {
  loadBundle: async (lang: string) => (lang === "zh-CN" ? zhCN : null),
  systemLanguages: () => ["zh-CN"],
  setHtmlLang: () => {},
};

beforeEach(async () => {
  locale.__resetI18nStateForTest();
  locale.setLocaleHost(host);
  await locale.initI18n();
  document.body.innerHTML =
    '<a href="#main-content" class="skip-link" aria-label="静态兜底">静态兜底</a>' +
    '<app-nav aria-label="静态兜底"></app-nav>' +
    '<app-content id="main-content" aria-label="静态兜底"></app-content>';
});

describe("localizeStaticA11yLabels", () => {
  it("覆写 <title> 与四个静态标签为当前语言（zh-CN）", () => {
    localizeStaticA11yLabels();
    expect(document.title).toBe(zhCN["a11y.appTitle"]);
    expect(document.querySelector(".skip-link")!.textContent).toBe(zhCN["a11y.skipNav"]);
    expect(document.querySelector(".skip-link")!.getAttribute("aria-label")).toBe(
      zhCN["a11y.skipNavAria"],
    );
    expect(document.querySelector("app-nav")!.getAttribute("aria-label")).toBe(zhCN["a11y.mainNav"]);
    expect(document.getElementById("main-content")!.getAttribute("aria-label")).toBe(
      zhCN["a11y.mainContent"],
    );
  });

  it("缺失节点不抛（skip-link 缺席时其余标签照常覆写，幂等可重入）", () => {
    document.body.innerHTML = '<app-nav aria-label="x"></app-nav>';
    expect(() => localizeStaticA11yLabels()).not.toThrow();
    expect(document.querySelector("app-nav")!.getAttribute("aria-label")).toBe(zhCN["a11y.mainNav"]);
  });
});
