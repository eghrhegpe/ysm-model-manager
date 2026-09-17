/**
 * css-layer-utils.ts — css-layer-check 的纯函数抽出（2026-09-14 契约测试缺口收口）。
 *
 * 背景：css-layer-check.ts 主体在模块顶层无条件执行 + process.exit，任何
 * import 它的文件都会在同进程内被杀掉（tests/test_css_layer_check.ts 曾因此
 * 导入即终止、断言永不执行）。本模块把 3 个「文本解析 + 文件读取」的纯函数
 * 抽出，零顶层副作用，供测试直接消费（锁定插值展开语义的回归）。
 *
 * 与 css-layer-check.ts 的分工：本模块 = 纯算法（别名解析 / 字面量读取 / 插值展开）；
 * 脚本主体 = 全仓扫描编排 + 判定 + 落盘（读文件、扫 shadow domain、exit 码）。
 */
import fs from "node:fs";
import path from "node:path";
import { tryResolveAlias } from "./alias-resolve.ts";

/**
 * 解析 import 说明符到绝对路径：
 * - `@/` 别名 / `#root` 根别名 → 经 alias-resolve 解到 frontend/src 具体文件
 * - 相对路径（`./` `../`）→ 基于 fromAbs 所在目录 resolve
 * - 裸包导入（react / three 等）→ null（不参与 shadow CSS 组装）
 */
export function resolveImportAbs(spec: string, fromAbs: string): string | null {
  if (spec.startsWith("@/") || spec.startsWith("#root")) return tryResolveAlias(spec);
  if (spec.startsWith(".")) return path.resolve(path.dirname(fromAbs), spec);
  return null;
}

/** 取被导入模块里 `export const NAME = "字面量"` 的内容（跨行字符串字面量亦可）。 */
export function readConstLiteral(src: string, name: string): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 正则用普通字符串拼接（非模板字面量）：字符类含反引号时内嵌模板字符串会被
  // Node 24 的 TS 类型剥离器误判为模板边界 → ERR_INVALID_TYPESCRIPT_SYNTAX
  const re = new RegExp(
    // biome-ignore lint/style/useTemplate: 拼接为刻意选择（上条注释：内嵌模板字面量会被 Node 24 TS 类型剥离器误判模板边界）
    "export\\s+const\\s+" + esc + "\\s*=\\s*([" + "'\u0060\"" + "])([\\s\\S]*?)\\1",
  );
  return src.match(re)?.[2] ?? null;
}

/**
 * 聚合 CSS 前展开 TS 模板插值：把 cssText 里 import 进来、且内容含 @keyframes 的
 * `${IDENT}` 常量就地展开，使按源文件文本扫 @keyframes 的正则能看见插值内容。
 *
 * 最小侵入：
 * - 无 `${` 的文本原样返回（性能守卫：不触发 import 解析）
 * - 只展开内容含 @keyframes 的常量——避免把无关样式常量（如 btnBaseCSS）的类名
 *   一并引入，扰动既有 WARN 判定基线
 * - 解析不出的 import（文件缺失 / 裸包）保持原样，不因 tooling 缺失制造新假阳性
 */
export function expandKeyframeInterpolations(cssText: string, fileAbs: string): string {
  if (!cssText.includes("${")) return cssText;
  const importRe = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let out = cssText;
  for (const im of cssText.matchAll(importRe)) {
    const names = (im[1] ?? "")
      .split(",")
      .map(
        (s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      )
      .filter(Boolean);
    const abs = resolveImportAbs(im[2] ?? "", fileAbs);
    if (!abs) continue;
    let src: string | null = null;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // 解析不出的 import 保持原样（不因 tooling 缺失制造新假阳性）
    }
    for (const n of names) {
      // biome-ignore lint/style/useTemplate: 拼接的是被展开占位符的字面量文本本身，非模板
      const token = "${" + n + "}";
      if (!out.includes(token)) continue;
      const lit = readConstLiteral(src, n);
      if (!lit || !/@keyframes/.test(lit)) continue;
      out = out.split(token).join(lit);
    }
  }
  return out;
}

/**
 * shadow 域是否含动效声明（`animation` / `transition` 系列的**属性位**）。
 *
 * 用途：css-layer-check 检查 4——有动效的 shadow 域必须 adopt `.no-animations` 通配桥。
 *
 * 判定要点：
 * - 前缀用负向后顾 `(?<![-\w])` 而非字符类：`--btn-transition:` 是**自定义属性**声明，
 *   前面的 `-` 若被 `[^-\w]` 收下就会误判成「本域有动效」（实测噪声源）；
 * - `transition-duration/-delay/-property` 显式列入：它们同样产生动效，漏判会让域被
 *   当成纯静态而跳过桥检查（假绿）。
 */
export function hasMotionDeclaration(cssText: string): boolean {
  return /(?<![-\w])animation\s*:|(?<![-\w])transition(?:-duration|-delay|-property)?\s*:/.test(
    cssText,
  );
}

/**
 * shadow 域是否已 adopt `.no-animations` 通配桥。
 *
 * 认可两种形态：
 *   ① 引用共享片段 `noAnimationsCSS`（`utils/dom/css.ts`，**推荐**——单一事实源）；
 *   ② 手写等价通配 `:host-context(.no-animations) *`（手抄一份也应放行，闸门不惩罚等价实现）。
 *
 * **刻意不认可逐类登记**（`:host-context(.no-animations) .foo`）：那正是漂移源头——
 * 新增组件动画不会自动被覆盖，「所有动画都可关闭」退化成假承诺。闸门的全部价值就是
 * 逼出通配形态，故此处对逐类形态判「无桥」。
 */
export function hasNoAnimationsBridge(cssText: string): boolean {
  if (/\bnoAnimationsCSS\b/.test(cssText)) return true;
  return /:host-context\(\s*\.no-animations\s*\)\s*\*/.test(cssText);
}

/**
 * 注释完整性探测：返回「注释体内误写星号+斜杠（即块注释闭合符）导致提前闭合」后
 * 残留的游离闭合符下标（无则 -1）。
 *
 * 原理：先按 TS/CSS 语义剥注释——`//` 行注释 + 块注释（块注释按「首个闭合符」结束）。
 * 若注释体里再写闭合符（如 `fadeSlide*` 紧跟 `/breathe-subtle`、`.dlg-*` 紧跟 `/.afv-*`），
 * 注释提前结束，其后文本成为裸 CSS，剥完后仍残留游离闭合符。
 *
 * 为何严重：解析器会把裸文本当选择器、并吞掉紧随的第一个 `{...}` 块——2026 实测吞掉
 * `@keyframes fadeSlideUp`，使 app-content 全 shadow 的入场动画静默失效（无报错，
 * getComputedStyle().animationName 仍显示名字，但 getAnimations() 为 0）。
 */
export function findStrayCommentClose(src: string): number {
  const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped.indexOf("*/");
}
