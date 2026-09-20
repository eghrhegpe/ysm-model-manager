// ===== innerHTML 模板插值卫生扫描核（check-redlines R8 模板闸，2026-09 立法）=====
//
// 立因：既有 R8 正则 `innerHTML\s*=\s*[^'"`]` 只盯「RHS 是裸变量」的赋值——以反引号
// 开头的**模板串**恒不命中，而本仓 HTML 拼接的主力形态恰恰是模板插值（SVG 接入审计
// 实抓案例：app-sidebar/events.ts 把外部路径裸插进 innerHTML 模板，绕过了整道闸）。
//
// 本核补上盲区：解析 `X.innerHTML = \`...\``（含多行/嵌套模板/字符串转义），提取全部
// 顶层 `${...}` 插值表达式，按「可信来源」白名单判定，未命中即违规候选。
//
// 白名单哲学与 R8 豁免清单同源（内部常量 / i18n / esc 产物 / 图标解析产物 / *HTML()
// builder / 约定命名常量）；确属预构建 HTML 局部变量等静态不可推断的场景，用行注
// `// r8-allow: <理由>` 精确豁免（呼应 check-layering `layering-allow: html` 文化）。
//
// 纯函数、零依赖，供 check-redlines 消费；导出判定核供契约测试直测「非空转」。
//
// ⚠️ 表达式拆分的游标纪律（初版事故，vitest 实证钉死）：跳过字符串/模板/双字符运算符
// 后必须精确落到「下一未读字符」——外层 for 的 i++ 与分支内手动 i++ 相叠会双跳，
// 吞掉相邻条件文本或泄漏可信判定。以下各 skip* 统一返回「下一未读索引」。

export interface HygieneHit {
  line: number; // 赋值起始行（1-indexed）
  endLine: number; // 模板结束行
  expr: string; // 未信任的插值表达式
}

/** 可信插值：直接形态白名单（整段表达式即产物/常量/字面量） */
const TRUSTED_DIRECT: RegExp[] = [
  // 图标常量表成员（UI_ICONS.xxx / ICONS.XXX）
  /^(UI_ICONS|ICONS)\.[A-Za-z0-9_]+$/,
  // 图标解析/查表产物（返回值只可能是内部常量 SVG 或 ""）
  /^(resolveIcon|getSiteIcon|getTagIconFromRole|statusIconOf|renderIconHtml)\(/,
  // i18n（与 R8「i18n-only 模板」豁免同口径；tOf = 带参薄包装）
  /^(t|tOf|translate)\(/,
  // 显式转义产物（esc(x) / ctx.esc(x) / escUtil(x)）
  /^(esc|escUtil)\(/,
  /^[\w$.]+\.esc(Util)?\(/,
  // 项目约定：HTML 构造器命名 render*/build*/*HTML(/*Html(/*html(
  /^(render|build)[A-Za-z0-9_]*\(/,
  /^[A-Za-z_$][A-Za-z0-9_$]*(HTML|Html|html)\(/,
  // 约定命名常量：静态 CSS 串（*CSS/*Css/*css）、图标产物局部（*Svg/*SVG）、
  // 预构建 HTML 局部（*HTML/*Html/*html，与 builder 调用形态同命名法）
  /^[A-Za-z_$][A-Za-z0-9_$]*(CSS|Css|css)$/,
  /^[A-Za-z_$][A-Za-z0-9_$]*(Svg|SVG)$/,
  /^[A-Za-z_$][A-Za-z0-9_$]*(HTML|Html|html)$/,
  // 字面量（单/双引各自成对，允许串内含另一类引号；模板串需无插值）
  /^"[^"\n]*"$/,
  /^'[^'\n]*'$/,
  /^`[^`$]*`$/,
  /^-?[\d.\s_]+$/,
  // 数值格式化（结果恒为数字文本）
  /\.(toLocaleString|toLocaleFixed|toString)\(\)$/,
  /\.toFixed\(\d*\)$/,
  // 字符串字面量方法（点串装饰器等）
  /^["'][^"'\n]*["']\.repeat\([\s\S]*\)$/,
];

/** 字符串字面量：起点 e[i] 为开引号，返回「闭引号下一位」；未闭合返回 e.length */
function nextOfString(e: string, i: number): number {
  const q = e[i];
  let j = i + 1;
  for (; j < e.length; j++) {
    if (e[j] === "\\") {
      j++;
      continue;
    }
    if (e[j] === q) return j + 1;
  }
  return e.length;
}

/** 模板字面量：起点 e[i] === "`"，返回「闭引号下一位」（内部 ${} 深度穿越） */
function nextOfTemplate(e: string, i: number): number {
  let j = i + 1;
  for (; j < e.length; j++) {
    const c = e[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") return j + 1;
    if (c === "$" && e[j + 1] === "{") {
      j = nextOfBraces(e, j + 1) - 1;
    }
  }
  return e.length;
}

/** `${` 的 `}` 配对：起点 e[i] === "{"，返回「闭花括号下一位」 */
function nextOfBraces(e: string, i: number): number {
  let depth = 0;
  let j = i;
  for (; j < e.length; j++) {
    const c = e[j];
    if (c === '"' || c === "'") {
      j = nextOfString(e, j) - 1;
      continue;
    }
    if (c === "`") {
      j = nextOfTemplate(e, j) - 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return e.length;
}

/** 模板字面量顶层插值提取：start 指向开 backtick；返回 [exprs, nextIdx] */
function templateInterps(e: string, start: number): [string[], number] {
  const out: string[] = [];
  let i = start + 1;
  for (; i < e.length; i++) {
    const c = e[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") return [out, i + 1];
    if (c === "$" && e[i + 1] === "{") {
      const end = nextOfBraces(e, i + 1);
      out.push(e.slice(i + 2, end - 1));
      i = end - 1;
    }
  }
  return [out, i];
}

/**
 * 顶层运算符扫描：把表达式按 depth-0（字符串/模板/括号内的不算）运算符切成段。
 * 返回 [{ text, op }]——op = 终止该段的运算符（?? || && ? : +），末段 op = ""。
 * 无 depth-0 运算符时返回 null（整段为原子）。
 */
interface Seg {
  text: string;
  op: string;
}
function topSegments(e: string): Seg[] | null {
  const segs: Seg[] = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  const push = (op: string): void => {
    segs.push({ text: cur, op });
    cur = "";
  };
  while (i < e.length) {
    const c = e[i];
    if (c === '"' || c === "'") {
      const next = nextOfString(e, i);
      cur += e.slice(i, next);
      i = next;
      continue;
    }
    if (c === "`") {
      const next = nextOfTemplate(e, i);
      cur += e.slice(i, next);
      i = next;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (depth === 0) {
      const two = e.slice(i, i + 2);
      if (two === "??" || two === "||") {
        push(two);
        i += 2;
        continue;
      }
      if (two === "&&") {
        push("&&");
        i += 2;
        continue;
      }
      if (c === "?" && two !== "?." && two !== "??") {
        push("?");
        i += 1;
        continue;
      }
      if (c === ":") {
        push(":");
        i += 1;
        continue;
      }
      if (
        c === "+" &&
        e[i + 1] !== "=" &&
        segs.length + cur.length > 0 &&
        /[\w$)\]"'`]/.test(e[i - 1] ?? "")
      ) {
        push("+");
        i += 1;
        continue;
      }
    }
    cur += c;
    i++;
  }
  push("");
  return segs.length > 1 ? segs : null;
}

/** 单表达式可信判定（递归：运算符分支、嵌套模板内容出口） */
export function isTrustedExpr(expr: string): boolean {
  const e = expr.trim();
  if (!e) return true;
  if (TRUSTED_DIRECT.some((re) => re.test(e))) return true;

  // 含嵌套模板：内层模板的全部插值出口都可信 → 外层为代码骨架（map/join/箭头），可信。
  // 出口 = 每个 backtick 模板的 templateInterps；外层残量只是代码，不产出 HTML 文本。
  if (e.includes("`")) {
    let allSafe = true;
    let i = 0;
    let sawTemplate = false;
    while (i < e.length) {
      const c = e[i];
      if (c === '"' || c === "'") {
        i = nextOfString(e, i);
        continue;
      }
      if (c === "`") {
        sawTemplate = true;
        const [inner, next] = templateInterps(e, i);
        if (!inner.every((x) => isTrustedExpr(x))) allSafe = false;
        i = next;
        continue;
      }
      i++;
    }
    // 骨架含顶层运算符（?? || && ? : +）时，模板之外的操作数也会被注入，须走下方分支
    // 递归（纯模板段在递归内经本规则自成可信叶）；仅纯代码骨架（map/join 箭头链）才短路。
    if (sawTemplate && allSafe && (topSegments(e)?.every((s) => s.op === "") ?? true)) return true;
  }

  const segs = topSegments(e);
  if (!segs) return false;

  // 三元（最高优先，先于逻辑运算符处理）：segs[qi].op === "?" 终止的是**条件段**，
  // 真值段 = segs[qi+1]（被 `:` 终止），假支 = `:` 之后重建（可再含三元，天然递归覆盖
  // a ? b : c ? d : e 链）。条件段不被注入，不检。
  const qi = segs.findIndex((s) => s.op === "?");
  const valSeg = qi >= 0 ? segs[qi + 1] : undefined;
  if (valSeg && valSeg.op === ":") {
    const val = valSeg.text;
    const alt = segs
      .slice(qi + 2)
      .map((s) => (s.op ? `${s.text}${s.op}` : s.text))
      .join("");
    return isTrustedExpr(val) && isTrustedExpr(alt);
  }

  // || / ??：任一真值段都可能被注入 → 全段必检。
  if (segs.some((s) => s.op === "||" || s.op === "??")) {
    const groups = groupByOps(segs, ["||", "??"]);
    return groups.every((g) => isTrustedExpr(g));
  }
  // &&：短路尾部 = 实际注入值；前段落选只注入 falsy（""/0/false 文本，无尖括号面）。
  if (segs.some((s) => s.op === "&&")) {
    const groups = groupByOps(segs, ["&&"]);
    const tail = groups[groups.length - 1];
    return tail !== undefined && isTrustedExpr(tail);
  }
  // 顶层 + 拼接：各段必检。
  if (segs.some((s) => s.op === "+")) {
    return groupByOps(segs, ["+"]).every((g) => isTrustedExpr(g));
  }
  return false;
}

/** 按给定运算符集合分组重拼（组内保留其他运算符原文，交由递归再处理） */
function groupByOps(segs: Seg[], ops: string[]): string[] {
  const groups: string[] = [];
  let cur = "";
  for (const s of segs) {
    cur += s.text;
    if (ops.includes(s.op)) {
      groups.push(cur);
      cur = "";
    } else {
      cur += s.op;
    }
  }
  groups.push(cur);
  return groups;
}

/**
 * 扫描单文件源码：找出全部 `X.innerHTML = \`...\`` 模板中不可信插值。
 * 豁免：赋值起始行前 4 行 ~ 模板结束行 +1 范围内出现 `r8-allow` 行注的模板整体放行。
 */
export function scanSource(src: string): HygieneHit[] {
  if (!src.includes(".innerHTML")) return [];
  const hits: HygieneHit[] = [];
  const re = /\.innerHTML\s*\+?=\s*/g;
  const lineOf = (idx: number) => src.slice(0, idx).split("\n").length;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    let i = m.index + m[0].length;
    let ch = src[i];
    while (ch !== undefined && /\s/.test(ch)) {
      i++;
      ch = src[i];
    }
    const [interps, end] = templateInterps(src, i);
    const startLine = lineOf(m.index);
    const endLine = lineOf(end);
    const markerWindow = src
      .split("\n")
      .slice(Math.max(0, startLine - 4), endLine + 1)
      .join("\n");
    if (/r8-allow\b/.test(markerWindow)) continue;
    for (const expr of interps) {
      if (!isTrustedExpr(expr)) {
        hits.push({
          line: startLine,
          endLine,
          expr: expr.replace(/\s+/g, " ").slice(0, 100),
        });
      }
    }
    re.lastIndex = end;
  }
  return hits;
}
