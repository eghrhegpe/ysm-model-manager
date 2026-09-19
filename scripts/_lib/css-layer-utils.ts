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
 * 聚合 CSS 前展开 TS 模板插值：把 cssText 里 import 进来的 `${IDENT}` 常量就地展开，
 * 使按源文件文本正则扫类名 / @keyframes 的检查能看见插值内容。
 *
 * **为什么展开全部常量（不再只展开含 @keyframes 的）**：插值进来的常量正是本 shadow
 * 实际 adopt 的样式——`sidebar-css.ts` / `app-tree-styles.ts` 都靠 `${dropdownBaseCSS}` /
 * `${btnBaseCSS}` 引入共享串。旧实现只展开含 @keyframes 的常量（理由「不扰动检查 3
 * 判定基线」），后果是这些**真实生效的定义对检查 3 不可见**：`.dd-wrap` / `.dd-menu` 被判
 * 「未定义」（假阳性），而 `.btn-base` 仅因某句注释提过它才侥幸不被报（注释洗白，2026-09 实测）。
 * 判定基线本就该建立在「shadow 真正拿到什么」之上，故过滤条件删除。
 *
 * 最小侵入保留：
 * - 无 `${` 的文本原样返回（性能守卫：不触发 import 解析）
 * - 解析不出的 import（文件缺失 / 裸包）保持原样，不因 tooling 缺失制造新假阳性
 *
 * 对检查 1/1b/1c 无影响：共享常量里唯一的 animation 声明是 noAnimationsCSS 的
 * `animation: none !important`（extractAnimationRefs 显式跳过含 none 的体），
 * 故展开后不会新增任何 keyframe 引用。
 */
export function expandStyleInterpolations(cssText: string, fileAbs: string): string {
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
      if (!lit) continue;
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
 * 注释完整性探测：返回「注释体内误写星号加斜杠（即块注释闭合符）导致提前闭合」后
 * 残留的游离闭合符下标（无则 -1）。
 *
 * 原理：字符串感知扫描——先识别字符串 / 模板字面量区间（字面量内的行注释符、块注释符
 * 不参与判定），再线性扫字面量外的块注释开启，按「首个闭合符」结束。
 * 若注释体里再写闭合符（历史病例：keyframe 名与斜杠连写、CSS 选择器通配符连写），
 * 注释提前结束，其后文本成为裸 CSS，剥完后仍残留游离闭合符。
 *
 * 为何严重：解析器会把裸文本当选择器、并吞掉紧随的第一个花括号块——2026 实测吞掉
 * fadeSlideUp 的 @keyframes，使 app-content 全 shadow 的入场动画静默失效（无报错，
 * getComputedStyle().animationName 仍显示名字，但 getAnimations() 为 0）。
 *
 * 为何必须字符串感知：本函数消费方是承载 CSS 的 TS 源文件（检查 5 扫 shadow 域全量 .ts），
 * 字符串 / 模板正文合法含星号紧接斜杠（CSS 文本的选择器通配、glob 模式等）——不跳过字面量
 * 会把正文里的连写误判为破注释残留，假阳性阻断 pre-push。
 */
export function findStrayCommentClose(src: string): number {
  // 单次线性扫描：字符串/模板字面量、`//` 行注释、`/* */` 块注释三态交替。
  // 字符串/模板**原文保留**（正文合法含星号斜杠连写，如 CSS 选择器通配 `.dlg-*/`、glob），
  // `//` 行注释剥除（保留换行），`/* */` 块注释体剥除。
  // 剥完后**字面量外**残留的 `*/` 即游离闭合符（注释提前闭合 → 其后裸 CSS 被解析器吞掉）。
  // 判定面：先剥除字符串区间再找 `*/`——字面量正文的合法连写不参与判定（检查 5 假阳性防线）。
  const TICK = String.fromCharCode(96);
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === TICK) {
      // 字面量原文保留（正文合法，不剥除）
      const quote = c;
      let j = i + 1;
      if (quote === TICK) {
        // 模板字面量：按「未展开的原源码」扫描——${ 插值体整体当字面量正文（不递归进内部），
        // 嵌套引号、内部花括号都不参与终止判定
        let depth = 0;
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === "$" && src[j + 1] === "{") {
            depth += 1;
            j += 2;
          } else if (src[j] === "{" && depth > 0) {
            depth += 1;
            j += 1;
          } else if (src[j] === "}" && depth > 0) {
            depth -= 1;
            j += 1;
          } else if (src[j] === quote && depth === 0) {
            j += 1;
            break;
          } else j += 1;
        }
      } else {
        while (j < n) {
          if (src[j] === "\\") j += 2;
          else if (src[j] === quote) {
            j += 1;
            break;
          } else if (src[j] === "\n")
            break; // 单行字符串（TS 语义，防未终止引号吞掉整文件）
          else j += 1;
        }
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      // 行注释整段剥除（保留换行）
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      // 块注释按「首个闭合符」结束（与解析器同语义）；闭合符本身剥除
      while (i < n - 1 && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      if (i < n - 1) i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // 判定面：剥除字符串区间后再找 `*/`——字面量正文的合法星号斜杠连写不参与判定
  let idx = -1;
  for (let k = 0; k < out.length - 1; k++) {
    const ch = out[k];
    if (ch === '"' || ch === "'" || ch === TICK) {
      const quote = ch;
      let m = k + 1;
      while (m < out.length) {
        if (out[m] === "\\") {
          m += 2;
          continue;
        }
        if (out[m] === quote) {
          m += 1;
          break;
        }
        if (quote !== TICK && out[m] === "\n") break;
        m += 1;
      }
      k = m - 1;
      continue;
    }
    if (ch === "*" && out[k + 1] === "/") {
      idx = k;
      break;
    }
  }
  return idx;
}
