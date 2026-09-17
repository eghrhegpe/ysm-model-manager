// @vitest-environment node
// ===== 页面模板「结构完整性」守卫（防标签未闭合致 DOM 嵌套吞并）=====
//
// 复盘（2026-09-17，用户报「诊断看不见界面了」）：
//   ADR-258 把诊断页左栏收敛为顶部 repo-tab 后，diagnosticsHTML() 的
//   `.diag-log-bar` 漏了闭合 </div> —— 本该关工具条的 </div> 被当成了面板的闭合，
//   于是 #diag-tab-single … #diag-tab-sync-conflict 七个面板全被吞进 #diag-tab-log 内部。
//   而 bindTabs 切页时会把非激活的 `#diag-tab-log` 置 display:none ——
//   嵌在它里面的面板随之一起消失，**切任何 tab 都只剩空白**。
//
// 既有测试为何没拦住：tpl.test.ts 用子串断言（toContain('id="diag-tab-log"')）——
//   面板 id 字面量即便被错误嵌套也照样在字符串里，断言恒真，对「结构」完全失明。
//   本文件改为按 **div 深度** 验证结构，补上这块盲区。
//
// 语义（两条独立断言，缺一不可）：
//   ① 每个页面模板的 <div> 开合必须平衡（直接抓「漏闭合」）；
//   ② 同一容器（.tab-body）下的面板必须处在**同一层**（抓「被兄弟吞并」——
//      即使总开合平衡，嵌套错位同样会毁掉面板切换）。
//
// 纯字符串实现（node 环境，与 tpl.test.ts 同）——不依赖 jsdom/DOM 解析器。

import { describe, it, expect } from "vitest";
import {
  diagnosticsHTML,
  githubHTML,
  instancesHTML,
  repositoryHTML,
  workshopHTML,
} from "./tpl.ts";

/** 诊断页顶部 repo-tab 对应的面板 id（与 diagnosticsHTML 的 data-tab 一一对应） */
const DIAG_TAB_IDS = [
  "log",
  "single",
  "gui",
  "hist",
  "trace",
  "conflict",
  "health",
  "sync-conflict",
] as const;

/** 统计 `<div>` / `</div>` 数量（本仓模板不使用自闭合 `<div/>`） */
function divTally(html: string): { opens: number; closes: number } {
  return {
    opens: (html.match(/<div\b/g) ?? []).length,
    closes: (html.match(/<\/div>/g) ?? []).length,
  };
}

/**
 * `needle` 出现位置之前（不含 `needle` 自身所在的标签）的 div 净深度。
 * `needle` 须含该标签的 `<div` 起始，才能得到「该标签所处的层」。
 */
function depthBefore(html: string, needle: string): number {
  const idx = html.indexOf(needle);
  if (idx < 0) throw new Error(`模板中未找到 ${needle}`);
  const { opens, closes } = divTally(html.slice(0, idx));
  return opens - closes;
}

const PAGE_TEMPLATES: Array<[string, () => string]> = [
  ["repositoryHTML", repositoryHTML],
  ["instancesHTML", instancesHTML],
  ["diagnosticsHTML", diagnosticsHTML],
  ["githubHTML", githubHTML],
  ["workshopHTML", workshopHTML],
];

describe("页面模板 div 开合平衡（抓漏闭合）", () => {
  for (const [name, build] of PAGE_TEMPLATES) {
    it(`${name} 的 <div> 开合平衡`, () => {
      const { opens, closes } = divTally(build());
      expect(closes, `${name} 存在未闭合的 <div>`).toBe(opens);
    });
  }
});

describe("diagnosticsHTML 面板分层（抓兄弟吞并）", () => {
  it("八个面板均处于 .tab-body 下一层——未被前一面板吞并", () => {
    const html = diagnosticsHTML();
    const bodyOpen = '<div class="tab-body">';
    const bodyIdx = html.indexOf(bodyOpen);
    expect(bodyIdx, "未找到 .tab-body 容器").toBeGreaterThanOrEqual(0);
    // 以 .tab-body 开标签之后为原点，面板自身 <div> 之前的净深度应为 0（即直接子节点）
    const afterBody = html.slice(bodyIdx + bodyOpen.length);
    for (const id of DIAG_TAB_IDS) {
      const needle = `<div class="diag-panel" id="diag-tab-${id}"`;
      expect(depthBefore(afterBody, needle), `面板 ${id} 被嵌套（说明有标签未闭合）`).toBe(0);
    }
  });
});
