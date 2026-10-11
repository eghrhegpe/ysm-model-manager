// @vitest-environment node
// ===== 适配器 dispose 契约：异常隔离 + 清理不可中断（锐评抽象扫描）=====
//
// 抽象病（本轮扫出）：**同一不变量「dispose 必须跑完」由 5 个格式适配器各自维护**，
// 隔离度四分五裂；而缺陷形态完全一致——**任何外部注入回调抛错 → 后续清理静默跳过**：
//
//   ysm        裸序列，连 try 都没有（修前：rayCleanup 抛错 ⇒ 异常外泄 + 八项清理全跳过）
//   mmd        一个大 try 包全链（修前：bonePanelRef 抛错 ⇒ 注销/mixer/感知层全跳过，catch 只 dbg）
//   vrm        ✅ 只隔离 bonePanelRef，注销在其后（正确范式，本契约的参照基准）
//   fbx        ✅ 逐项 safeCall（正确范式）
//   litematic  裸写但前置为不可抛纯操作（✅ 已加注释说明「若插入回调须提前注销」）
//
// 本文件把「隔离度」固化为可机验契约。**关键设计**：不检查「有没有 try」这种形式，
// 而是检查**语义顺序**——「可能抛错的外部回调」不得出现在「注销 frustum 根」之前，
// 除非被 try 包住。这样既拦新写的裸序列，又不误伤 VRM/FBX 两种合法范式。
//
// ⚠️ 实现说明：用**行扫描**而非正则切函数体——因为 YSM 的修复注释里**字面提到了**
// `unregisterModelRoot(...)` 作为病理描述，正则切体会误命中注释行。行扫描 + 跳过注释行。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const P3D = resolve(ROOT, "frontend", "src", "preview-3d");

/** 各格式含 dispose 的文件 + 该 dispose 内可能出现的外部注入回调（行级正则） */
const DISPOSERS: Array<{ name: string; file: string; throwable: RegExp }> = [
  { name: "ysm", file: "adapters/ysm-adapter.ts", throwable: /rayCleanup\(\)|bonePanelRef\.current\?\.\(\)/ },
  { name: "mmd", file: "adapters/mmd/mmd-build-result.ts", throwable: /bonePanelRef\.current\?\.\(\)/ },
  { name: "vrm", file: "adapters/vrm/vrm-adapter.ts", throwable: /bonePanelRef\.current\?\.\(\)/ },
  { name: "litematic", file: "adapters/litematic-adapter.ts", throwable: /bonePanelRef|rayCleanup/ },
  // 2026-10-11 锐评收口补入 fbx/pack（此前手工清单漏列——它们各自合法范式不同：
  // fbx 逐项 safeCall 隔离、pack 首行注销，故注销前无裸回调，本契约的判据对它们成立）。
  { name: "fbx", file: "adapters/fbx/fbx-adapter.ts", throwable: /bonePanelRef|rayCleanup/ },
  { name: "pack", file: "adapters/pack-model-adapter.ts", throwable: /bonePanelRef|rayCleanup/ },
];

/** 也调用 unregisterModelRoot 但**不是格式 disposer** 的陈旧清扫位（重挂载/切换时兜底注销）。
 *  派生交叉校验用它放行；新增此类文件若不登记在此，同样会红。 */
const STALE_CLEANUP_ALLOWLIST: readonly string[] = ["adapters/mount-session.ts", "adapters/switch-preview.ts"];

/** 递归收集 adapters/ 下全部非测试 .ts，返回相对 P3D 的正斜杠路径（派生交叉校验用）。 */
function scanAdapterFiles(): string[] {
  const root = resolve(P3D, "adapters");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(root);
  return out.map((p) => p.slice(P3D.length + 1).split(sep).join("/"));
}

interface Line {
  n: number;
  text: string;
  isComment: boolean;
}

function lines(rel: string): Line[] {
  return readFileSync(resolve(P3D, rel), "utf8")
    .split("\n")
    .map((text, i) => {
      const t = text.trim();
      return { n: i + 1, text, isComment: t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") };
    });
}

/** 首个「非注释且形如调用」的 unregisterModelRoot 行号 */
function unregisterCallLine(rel: string): number {
  const hit = lines(rel).find(
    (l) => !l.isComment && /(?:^|[\s{(])unregisterModelRoot\(/.test(l.text) && !l.text.includes("import"),
  );
  return hit?.n ?? -1;
}

describe("适配器 dispose：外部回调不得排在注销之前（未隔离时）", () => {
  it.each(["ysm", "mmd"])(
    "%s：注销之前的**每一处**外部回调都必须各自被 try 包住",
    (name) => {
      const item = DISPOSERS.find((d) => d.name === name)!;
      const ls = lines(item.file);
      const unregAt = unregisterCallLine(item.file);
      expect(unregAt, `${name} 应有一处非注释的 unregisterModelRoot 调用`).toBeGreaterThan(0);

      const before = ls.filter((l) => l.n < unregAt);
      const throwables = before.filter((l) => !l.isComment && item.throwable.test(l.text));
      if (throwables.length === 0) return; // 注销前无外部回调 ⇒ 无风险

      // ⚠️ 判据必须**逐处绑定**：不能只判「注销之前存在某个 try」——文件里其它 try 会
      // 造成假绿（实证：把 ysm 的两处隔离删掉后，仅判「存在 try」的版本仍全绿）。
      // 正解：对每一处回调调用行，向上寻找**最近的** `try {`，且两者之间不得夹着
      // `} catch`（那说明该回调落在上一个 try 的 catch 之后、自身未受保护）。
      for (const t of throwables) {
        const idx = ls.findIndex((l) => l.n === t.n);
        let guarded = false;
        for (let i = idx - 1; i >= 0; i--) {
          const prev = ls[i]!;
          if (prev.isComment) continue;
          if (/\} catch\b|\bcatch\s*\(/.test(prev.text)) break; // 越过 catch 边界 ⇒ 未受保护
          if (/\btry\s*\{/.test(prev.text)) {
            guarded = true;
            break;
          }
          // 同一 try 块内允许夹其它语句；但遇到另一个回调调用则说明前面的 try 已闭合
          if (item.throwable.test(prev.text)) break;
        }
        expect(
          guarded,
          `${name}：L${t.n} 的外部回调未被 try 隔离（注销前）——抛错会中断整个 dispose，` +
            "后续清理静默跳过。请对齐 VRM 范式：只隔离易抛项，其余裸写。",
        ).toBe(true);
      }
    },
  );

  it("vrm：try 必须排在注销之前（既有正确范式，防回退）", () => {
    const ls = lines("adapters/vrm/vrm-adapter.ts");
    const tryAt = ls.find((l) => !l.isComment && /\btry\s*\{/.test(l.text))?.n ?? -1;
    const unregAt = unregisterCallLine("adapters/vrm/vrm-adapter.ts");
    expect(tryAt).toBeGreaterThan(0);
    expect(unregAt).toBeGreaterThan(0);
    expect(tryAt < unregAt, "vrm 的 try 必须在注销之前").toBe(true);
  });

  it("litematic：注销前不得出现外部回调（其前缀应为不可抛纯操作）", () => {
    const unregAt = unregisterCallLine("adapters/litematic-adapter.ts");
    expect(unregAt).toBeGreaterThan(0);
    const before = lines("adapters/litematic-adapter.ts").filter((l) => l.n < unregAt);
    const hit = before.filter((l) => !l.isComment && /bonePanelRef|rayCleanup/.test(l.text));
    expect(
      hit.length,
      "litematic 注销前出现外部回调 —— 须把注销提前或加隔离（见其行内注释）",
    ).toBe(0);
  });

  it("全部六个 disposer 都注销 frustum 根（无遗漏格式）", () => {
    for (const d of DISPOSERS) {
      expect(unregisterCallLine(d.file), `${d.name} 应注销 frustum 根`).toBeGreaterThan(0);
    }
  });

  it("派生的 unregister 调用文件集 ⊇ DISPOSERS，多出者必须落在陈旧清扫白名单内（防清单漂移）", () => {
    // 原「全部四个 disposer」只在 DISPOSERS 内自证——新增格式既不注销也不入表即隐身
    // （锐评 2026-10-11 P1 抓出的手工清单自证病）。现从 adapters 目录派生：
    // ① 每个 DISPOSERS 文件必须真调用 unregisterModelRoot（注销缺失 = 红）；
    // ② 派生集里不属于 DISPOSERS 的文件必须在 STALE_CLEANUP_ALLOWLIST（陈旧清扫位），
    //    否则红——未来新增注销文件必须登记为 disposer 或陈旧清扫位。
    const derived = new Set(scanAdapterFiles().filter((f) => unregisterCallLine(f) > 0));
    const listed = DISPOSERS.map((d) => d.file);

    const missing = listed.filter((f) => !derived.has(f));
    expect(missing, "DISPOSERS 清单内每个格式都必须真调用 unregisterModelRoot").toEqual([]);

    const stray = [...derived].filter((f) => !listed.includes(f) && !STALE_CLEANUP_ALLOWLIST.includes(f));
    expect(stray, "派生出的注销文件应全部来自 DISPOSERS 或陈旧清扫白名单").toEqual([]);
  });
});
