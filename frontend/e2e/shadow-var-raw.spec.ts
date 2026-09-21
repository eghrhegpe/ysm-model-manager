// ===== 契约探针：shadow 内 var() 读文档 :root 自定义属性（长期回归守卫）=====
// 目的：钉死「这套 calc(13px + var(--fs-scale)) 写法在标准浏览器内核（chromium）
// 的 adoptedStyleSheets / <style> + ShadowRoot 环境下是否成立」——即验证 AGENTS.md
// 那条「adoptedStyleSheets 中 var() 不继承文档自定义属性」在标准引擎下到底成不成立。
//
// 结论（2026-06 实测，本用例即实证）：
//   - shadow 内两种注入法（<style> 标签 / adoptedStyleSheets）**都**正常生效
//   - var() 读文档 :root 自定义属性**穿透成立**，且随文档变量差分响应（0→2px 增量正确）
//   → AGENTS.md 那句「不继承文档自定义属性」对**规则穿透**成立（shadow 规则只影响
//     自己树内），但对**变量值穿透**不成立（CSS custom property 可跨 shadow 边界继承）。
//     二者不可混为一谈。
//
// 关键方法（血泪教训）：必须用 page.setContent 手写**最简页面**。
//   在 app 页面（gotoApp 后）里人造 shadow 探针**会假阴性全红**——app 已加载全局样式、
//   既有 shadow 组件与自定义元素，evaluate 中途 append 的普通 div shadow 易被全局样式
//   干扰/覆盖；而真实自定义组件（app-content）却完全正常（shadow-var-control 实证：
//   .stg-card 的 var(--surf) 背景 + border 均生效）。故穿透结论以原始页面为准——
//   它只依赖浏览器核心行为，无 app 干扰。
//
// 局限：本用例只判**标准 chromium 行为**（e2e 运行环境）。WebView2（桌面实机）是
// 独立验证维度——见 docs 验证清单，chromium 绿 ≠ WebView2 绿。
import { expect, test } from "./fixture.ts";

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

    return {
      a0,
      b0,
      ca0,
      cb0,
      a2,
      b2,
      adoptedRules: shB.adoptedStyleSheets.length,
    };
  });

  console.log(
    "[shadow-var-raw] styleTag:",
    `${r.a0} → ${r.a2}`,
    " adopted:",
    `${r.b0} → ${r.b2}`,
    " adoptedCount:",
    r.adoptedRules,
  );
  console.log("[shadow-var-raw] colors: styleTag=", r.ca0, " adopted=", r.cb0);

  // 哨兵：两种注入都生效（颜色非黑）
  expect(r.ca0).toBe("rgb(1, 2, 3)");
  expect(r.cb0).toBe("rgb(10, 20, 30)");
  // 判据：var() 跟随文档变量 +2px
  expect(r.a2).not.toBe(r.a0);
  expect(r.b2).not.toBe(r.b0);
  expect(parseFloat(r.a2) - parseFloat(r.a0)).toBe(2);
  expect(parseFloat(r.b2) - parseFloat(r.b0)).toBe(2);
});
