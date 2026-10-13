// ===== 安装入口双链对齐结构闸（ADR-310 性能/正确修复配套，2026-10）=====
// 前端红线的硬性体现：类型分流归 Go + resource_types.json；前端不重判类型。
// 故「装到整合包」的两个入口必须成对出现且按 rtype 分流——
//   · InstallModelTo 只允许出现在 `rtype === RESOURCE_TYPES.YSM` 分支（它写 YSM custom 子目录）；
//   · 同函数内必须有 InstallResourceToInstance 作非 YSM 类型的孪生出口（否则非 YSM 推送到整合包
//     会落到错误的 custom 子目录、游戏内不可见——缺陷①的根因形态）。
// 本测试静态扫 frontend/src 全部 .ts，对每处 InstallModelTo 落点函数做不变量断言；
// 任一调用点退化（缺 YSM 守卫 / 无孪生出口）立即红，防止缺陷①形态回流。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// frontend/src 根：本文件位于 src/features/sync/
const SRC_ROOT = join(__dirname, "..", "..");

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".vitepress") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, acc);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

interface CallSite {
  file: string;
  line: number;
  fnName: string | null;
  fnBody: string;
}

/** 找出某文件内所有 InstallModelTo 调用，并向上回溯到所属函数体（含 YSM 守卫与孪生出口判定） */
function findInstallModelToSites(file: string): CallSite[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const sites: CallSite[] = [];
  const callRe = /\bInstallModelTo\s*\(/;
  const fnStartRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;
  const fnArrowRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?\(/;

  // 预处理：记录每个函数起止行（从定义行到下一个同/更浅缩进的函数定义或可顶层语句）
  const fnBounds: Array<{ name: string | null; start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnStartRe) || lines[i].match(fnArrowRe);
    if (!m) continue;
    const depth = lines[i].search(/\S/);
    // 结束：下一个缩进<=depth 的函数定义行，或文件尾
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if ((fnStartRe.test(lines[j]) || fnArrowRe.test(lines[j])) && lines[j].search(/\S/) <= depth) {
        end = j - 1;
        break;
      }
    }
    fnBounds.push({ name: m[1], start: i, end });
  }

  for (let i = 0; i < lines.length; i++) {
    // 去除行内注释再匹配，避免注释里提及 InstallModelTo 误判为调用点（如分流说明注脚）
    const codeOnly = lines[i].replace(/\/\/.*$/, "");
    if (!callRe.test(codeOnly)) continue;
    // 找到包含调用行的最近函数（fnBounds 按 start 升序，取最后一个 start<=i<=end 的）
    let fnName: string | null = null;
    let fnStart = 0;
    let fnEnd = lines.length - 1;
    for (const b of fnBounds) {
      if (b.start <= i && i <= b.end) {
        fnName = b.name;
        fnStart = b.start;
        fnEnd = b.end;
      }
    }
    const fnBody = lines.slice(fnStart, fnEnd + 1).join("\n");
    sites.push({ file, line: i + 1, fnName, fnBody });
  }
  return sites;
}

describe("安装入口双链对齐（InstallModelTo ↔ InstallResourceToInstance）", () => {
  const files = walkTs(SRC_ROOT);
  const sites = files.flatMap(findInstallModelToSites);

  it("至少存在一处 InstallModelTo 调用（基线，避免空断言恒绿）", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  for (const site of sites) {
    it(`${site.file}:${site.line} 的 InstallModelTo 受 YSM 守卫且有非 YSM 孪生出口`, () => {
      // 不变量①：调用函数体内必须出现 YSM 类型判定（RESOURCE_TYPES.YSM 或字面值 "ysm"）
      const hasYsmGuard =
        /RESOURCE_TYPES\.YSM/.test(site.fnBody) || /rt(?:ype)?\s*===?\s*["']ysm["']/.test(site.fnBody);
      expect(hasYsmGuard, "InstallModelTo 调用函数缺少 rtype === YSM 守卫").toBe(true);
      // 不变量②：同函数必须有 InstallResourceToInstance 作孪生出口（覆盖非 YSM 类型）
      expect(
        /InstallResourceToInstance\s*\(/.test(site.fnBody),
        "InstallModelTo 调用函数缺少非 YSM 孪生出口 InstallResourceToInstance",
      ).toBe(true);
    });
  }
});
