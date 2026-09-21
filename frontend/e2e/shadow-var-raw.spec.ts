// ===== 契约探针：shadow 内 CSS 变量穿透机制（长期回归守卫）=====
// 动机：AGENTS.md 旧认知「adoptedStyleSheets 中 var() 不继承文档自定义属性」含糊，
// 把「规则不穿透」与「变量值可穿透」混为一谈。本探针用最简页面钉死两件事：
//
// 契约 A（穿透成立）：待办（2026-09-21 实测）
//   - shadow 内两种注入法（<style> / adoptedStyleSheets）的**规则**都在本树生效
//   - `var(--x)` **可穿透**读宿主文档 :root 变量，且随文档变量差分响应
//   - 但 adoptedStyleSheets 里 `:root { --y: ... }` 的**变量定义并不落到 shadow 根**
//     ——真正让 `--uih-*` 生效的是 install*Styles 把整串（含 :root 块）注入 document.head，
//     变量定义在文档根，shadow 元素靠穿透读到。故「shadow 内 :root 定义」不作为变量源。
//
// 契约 B（双源裁决）：`--uih-slide-divider` 双源真值
//   - variables.css:85 定义 0.1（文档根，启动即载）
//   - slide-menu-styles.ts:21 定义 0.08（installSlideMenuStyles → document.head 后注入）
//   - 实测：后注入的 0.08 覆盖 0.1，消费方（.slide-header 边框）得到 0.08 → variables.css 0.1 是死值
//   - 本契约锁死「生效值必须是 0.08」——若将来有人误以为 0.1 是活值改回去，此测试红。
//
// 关键方法（血泪教训）：
//   1. 必须用 page.setContent 手写最简页面，不要在 app 页面里人造 shadow——app 全局样式
//      会干扰，导致假阴性（2026-09-21 探针踩坑，先全红后被 app 样式污染）。
//   2. 机制还原要镜像真实部署：真实 3D 菜单同时 adopt 样式表 + install 到 document.head，
//      单测只走 adoptedStyleSheets 会得出错误结论。
//   3. 真实注入路径：mount-preview-core.ts → ensureOverlayShell(adoptedStyleSheets) +
//      installComponentsStyles()/installSlideMenuStyles() → style-install.ts|install 塞 head。
//
// 局限：本用例判标准 chromium 行为；WebView2 桌面实机由人工清单验证（chromium 绿 ≠ WebView2 绿）。
import { expect, test } from "./fixture.ts";

// ===== 契约 A-1：穿透成立（核心）=====
test("原始页面：shadow 内 <style> 与 adoptedStyleSheets 均生效且 var() 穿透", async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          :root { --my-scale: 0px; --my-base: 13px; }
        </style>
      </head>
      <body>
        <div id="host-wrap"></div>
      </body>
    </html>
  `);

  const r = await page.evaluate(async () => {
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    // A) shadow <style> 注入
    const hostA = document.createElement("div");
    const shA = hostA.attachShadow({ mode: "open" });
    document.querySelector("#host-wrap")?.appendChild(hostA);
    const stA = document.createElement("style");
    stA.textContent = `
      .probe { font-size: calc(13px + var(--my-scale)); color: rgb(1,2,3); }
    `;
    shA.appendChild(stA);
    const elA = document.createElement("div");
    elA.className = "probe";
    shA.appendChild(elA);

    // B) adoptedStyleSheets 注入
    const hostB = document.createElement("div");
    const shB = hostB.attachShadow({ mode: "open" });
    document.querySelector("#host-wrap")?.appendChild(hostB);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .probe { font-size: calc(13px + var(--my-scale)); color: rgb(10,20,30); }
    `);
    shB.adoptedStyleSheets = [sheet];
    const elB = document.createElement("div");
    elB.className = "probe";
    shB.appendChild(elB);

    // C) 文档级变量改 2px 后重测（验证 var 跟随文档变量）
    await nextFrame();
    const a0 = getComputedStyle(elA).fontSize;
    const b0 = getComputedStyle(elB).fontSize;
    const ca0 = getComputedStyle(elA).color;
    const cb0 = getComputedStyle(elB).color;

    document.documentElement.style.setProperty("--my-scale", "2px");
    await nextFrame();
    const a2 = getComputedStyle(elA).fontSize;
    const b2 = getComputedStyle(elB).fontSize;

    return { a0, b0, ca0, cb0, a2, b2, adoptedRules: shB.adoptedStyleSheets.length };
  });

  // 哨兵：两种注入都生效（颜色非黑）
  expect(r.ca0).toBe("rgb(1, 2, 3)");
  expect(r.cb0).toBe("rgb(10, 20, 30)");
  // 判据：var() 跟随文档变量 +2px
  expect(r.a2).not.toBe(r.a0);
  expect(r.b2).not.toBe(r.b0);
  expect(parseFloat(r.a2) - parseFloat(r.a0)).toBe(2);
  expect(parseFloat(r.b2) - parseFloat(r.b0)).toBe(2);
});

// ===== 契约 B：--uih-slide-divider 双源裁决（variables.css 0.1 是死值）=====
// 真实部署：variables.css 先在 head（0.1），mount3D 时 installSlideMenuStyles 把
// slide-menu-styles.ts|:root(0.08) 后注入 head → 覆盖。消费方在 shadow 内读 var() → 穿透得 0.08。
// 本测试镜像该顺序，锁死「最终生效 = 0.08」。
test("镜像真实：--uih-slide-divider 生效值为 0.08（variables.css 0.1 被后注入覆盖）", async ({
  page,
}) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style id="variables-css">
          :root { --uih-slide-divider: rgba(255, 255, 255, 0.10); }
        </style>
      </head>
      <body>
        <div id="host-wrap"></div>
      </body>
    </html>
  `);

  const r = await page.evaluate(async () => {
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    // ① 模拟 installSlideMenuStyles：含 :root 0.08 的整串塞进 head（晚于 variables.css）
    const headStyle = document.createElement("style");
    headStyle.textContent = `
      :root { --uih-slide-divider: rgba(255, 255, 255, 0.08); }
    `;
    document.head.appendChild(headStyle);

    // ② adoptedStyleSheets：shadow 内消费规则（.slide-header border 同款）
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    document.querySelector("#host-wrap")?.appendChild(host);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`.probe { border-bottom: 1px solid var(--uih-slide-divider); }`);
    shadow.adoptedStyleSheets = [sheet];
    const el = document.createElement("div");
    el.className = "probe";
    shadow.appendChild(el);

    await nextFrame();
    await nextFrame();

    return {
      borderColor: getComputedStyle(el).borderBottomColor,
      docRootVar: getComputedStyle(document.documentElement)
        .getPropertyValue("--uih-slide-divider")
        .trim(),
    };
  });

  console.log("[shadow-var-raw] mirror-real:", JSON.stringify(r));
  // 生效值必须 0.08（后注入覆盖 0.1）——variables.css 的 0.1 是死定义
  expect(r.borderColor).toBe("rgba(255, 255, 255, 0.08)");
});
