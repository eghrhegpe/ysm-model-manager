// @vitest-environment happy-dom
// ===== ui-components-styles 契约冒烟测试 =====
// 断言消费者（cap-controls / render / ui-header-toggle / slide-menu-styles）引用的关键 class
// 存在于 componentsCss 字符串中。生成脚本若漏吐某个 class，构建绿但运行时样式崩——此测试兜底。
import { describe, it, expect } from "vitest";
import { componentsCss } from "./components-styles.ts";

// 消费者引用的关键 class（按模块分组，便于定位缺失来源）
const CRITICAL_CLASSES = {
  // cap-controls.ts：自绘滑块（cs-bar + cs-fill + cs-thumb）
  "cap-controls::slider": [".cs-bar", ".cs-fill", ".cs-thumb"],
  // cap-controls.ts：基础行/标签/选择器
  "cap-controls::base": [".slide-item", ".slide-label", ".setting-select"],
  // render.ts：字段行/图标/子标签
  "render::field": [".field-row", ".field-label", ".field-value", ".slide-icon", ".slide-sublabel"],
  // ui-header-toggle.ts：开关四件套
  "ui-header-toggle": [".toggle", ".slider", ".header-toggle", ".toggle-disabled"],
  // slide-menu-styles.ts：折叠组/章节/cs-icon
  "slide-menu-styles": [".collapsible-label", ".section-title", ".collapsible-header", ".cs-icon"],
  // slide-menu.ts：render-card 容器
  "slide-menu::render-card": [".render-card"],
} as const;

describe("componentsCss 契约冒烟", () => {
  for (const [group, selectors] of Object.entries(CRITICAL_CLASSES)) {
    describe(`消费者: ${group}`, () => {
      for (const sel of selectors) {
        it(`包含 ${sel}`, () => {
          expect(componentsCss).toContain(sel);
        });
      }
    });
  }

  // 3D overlay 是唯一 adopt 本串的 shadow 根，UI_ICONS 的 SVG 靠这里的 .ws-icon 着色/定尺。
  // 缺失时不是「图块过大」而是**0×0 不可见**：.slide-icon 是 flex 容器，无 width:1em 的
  // SVG 自动尺寸为 0（2026-09 实测 computed fill=rgb(0,0,0) / stroke=none / box=0x0）。
  it("自带 .ws-icon 规则（3D overlay 行图标唯一可达的着色/尺寸源）", () => {
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*width:\s*1em/);
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*fill:\s*none/);
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*stroke:\s*currentColor/);
  });
  it("非空字符串", () => {
    expect(componentsCss.length).toBeGreaterThan(1000);
  });
});

// ===== 字号收敛契约（2026-09：3D 菜单接进全局 --fs-scale）=====
// 背景：3D 菜单长期自成一套 --uih-* 裸 px 字号（11/13/10/14/12/15px），
// 不参与全局「基准字号」设置——用户在设置页调大字号，3D 菜单纹丝不动。
// 本条契约锁死：凡字号类 token 必须经 calc(... + var(--fs-scale)) 派生，
// 否则设置页的旋钮对 3D 菜单失效。新增字号 token 忘了接缩放 → 此测试红。
describe("componentsCss 字号/尺寸随 --fs-scale 缩放", () => {
  /** 从 :root 块中取某 token 的定义值 */
  const defOf = (name: string): string | null => {
    const m = componentsCss.match(new RegExp(`${name}:\\s*([^;]+);`));
    return m?.[1]?.trim() ?? null;
  };

  // 字号类：必须线性跟随（系数 1）
  const FONT_TOKENS = [
    "--uih-font-ui",
    "--uih-font-ui-sm",
    "--uih-font-lg",
    "--uih-cs-label-font-size",
  ];
  for (const name of FONT_TOKENS) {
    it(`${name} 经 --fs-scale 派生`, () => {
      const v = defOf(name);
      expect(v, `${name} 未定义`).not.toBeNull();
      expect(v).toContain("var(--fs-scale)");
      expect(v).toMatch(/^calc\(/);
    });
  }

  // 尺寸类：图标与行高须一同缩放，否则字号放大后图标撑破固定行高
  const SIZED_TOKENS = [
    "--uih-slide-icon-size",
    "--uih-slide-item-min-height",
  ];
  for (const name of SIZED_TOKENS) {
    it(`${name} 经 --fs-scale 派生`, () => {
      const v = defOf(name);
      expect(v, `${name} 未定义`).not.toBeNull();
      expect(v).toContain("var(--fs-scale)");
    });
  }

  it("默认 --fs-scale 缺失时仍退化为原基准像素（calc 容错）", () => {
    // calc(11px + var(--fs-scale)) 在 --fs-scale 未定义时整条 calc 失效回退——
    // 故 --fs-scale 必须由 :root 提供默认值（variables.css:190 = 0px）。
    // 本测试防的是「有人把 token 改成裸 px 后误以为平滑」。
    const v = defOf("--uih-font-ui-sm");
    expect(v).toMatch(/calc\(\s*11px\s*\+\s*var\(--fs-scale\)\s*\)/);
  });

  it("白色透明度收敛为三档，无 8 档残留", () => {
    expect(componentsCss).toContain("--uih-white-weak");
    expect(componentsCss).toContain("--uih-white-medium");
    expect(componentsCss).not.toMatch(/--uih-white-(0\d|1\d|40)/);
  });

  it("token 总数收敛（防单次消费的间接层回潮）", () => {
    const names = [...componentsCss.matchAll(/(--uih-[\w-]+):/g)].map((m) => m[1]);
    const unique = new Set(names);
    // 2026-10 死类清理后 13 个（原 19 个中 6 个随死类规则一并退役：--uih-card-bg /
    // --uih-font-title / --uih-font-ui-xs / --uih-preset-chip-height /
    // --uih-preset-chip-icon-size / --uih-collapsible-icon-size）；断言取**精确值**而非宽松
    // 上限——实测宽限 25 时注入 `--uih-font-bad: 13px` 能溜过（加 token 是最常见的
    // 回潮形态）。新增合法 token 时同步改此数字：强制走一次「这真有必要吗」的判断。
    expect(unique.size).toBe(13);
  });

  // 收敛的实质判据：**零引用 token 一律是间接层噪音**（定义完从不 var() 它）。
  // 这条比总数上限更锋利——它直接命中「加了个没人用的 token」这一回潮形态。
  it("无零引用 token（定义即须被消费，杜绝一次性间接层）", () => {
    const defined = [...componentsCss.matchAll(/(--uih-[\w-]+):/g)].map((m) => m[1]);
    const orphan = [...new Set(defined)].filter(
      (n) => !componentsCss.includes(`var(${n})`),
    );
    expect(orphan, `零引用 token: ${orphan.join(", ")}`).toEqual([]);
  });

  // 与 scripts/check-design-tokens.ts 同源规则（UI-Design.md「禁止硬编码 font-size」）。
  // 那支闸是行级增量（只管本次新增行），存量债不会被它拦；本测试补的是
  // 「本文件整体零硬编码字号」——菜单是 --fs-scale 的主战场，此处不许开倒车。
  it("本文件无硬编码 font-size:Npx（全部走 var(--uih-font-*)/var(--fs-*)）", () => {
    const hard = [...componentsCss.matchAll(/font-size:\s*[\d.]+px/g)].map((m) => m[0]);
    expect(hard, `发现硬编码字号: ${hard.join(", ")}`).toEqual([]);
  });
});
