#!/usr/bin/env node
/**
 * rtype-panel-gate.ts — 「随 rtype 联动面板的感知性绑定契约」派生引擎（2026-10-14 P1b）。
 *
 * 立因（oldest-models 卡不变量「感知性绑定是三面板共同契约」，锐评 2026-10-13 P1-2 收口）：
 * dedup（init-pages.ts）/ oldest-models / recycle-bin 三个面板都订阅 useCurrentResourceType
 * 做类型联动，契约 = 隐藏面板只记脏账不发全价 RPC + onShow 切进面板按需补扫 + cleanup 卸载。
 * 回收站曾是唯一漏 container.hidden 守卫的一个——停在「文件树」tab 切类型会在用户没看的面板
 * 上发两次 RPC、占用 guard 世代（切进看到非自己触发的结果）。契约此前靠人/AI 读知识卡自觉，
 * 每新增一个随 rtype 联动面板就多一个人要记。
 *
 * 翻转判定方向（fail-closed，同 write-surface-gate 范式）：候选面板集**从 frontend/src 生产
 * 文件源码自动派生**（`useCurrentResourceType(` 调用点；测试文件与 hook 自身定义文件排除）——
 * 不手工枚举（枚举漏一个 = fail-open，2026-10-10 闸审计同款教训）。每个候选文件必须同时含
 * 感知性绑定三元组的两个文件级 token（hidden 守卫 + onShow 补渲染句柄），除非进精确豁免表
 * （带 reason，僵尸条目反查防烂尾）。新面板调用 useCurrentResourceType 但缺任一 token → 当场红。
 *
 * 诚实边界（明示）：token 检查是**文件级**的——不校验守卫在哪个闭包、dirty 记账是否真实
 * 生效（「守卫写错位置」形态抓不到，那是三面板行为回归测试的地盘）；闸只保证「契约要素不
 * 整体缺失」。minFiles 空转下限防派生失效静默绿。
 */
import fs from "node:fs";
import path from "node:path";

/** 精确豁免文件：路径（相对 repo root，POSIX 分隔）+ 必须带 reason */
export interface ExemptFile {
  file: string;
  reason: string;
}

export interface RtypePanelGateConfig {
  /** 仓库根 */
  root: string;
  /** 生产源码目录（相对 root） */
  srcDir: string;
  /** 联动订阅 hook 名（调用点即候选面） */
  hookName: string;
  /** 定义 hook 的 API 文件自身（相对 root，含 `export function <hookName>(` 字面量，须排除） */
  apiFiles: string[];
  /** 候选文件必须同时具备的 token（文件级存在即满足） */
  requiredTokens: { name: string; re: RegExp }[];
  exemptFiles?: ExemptFile[];
  /** 候选文件数空转下限（低于 = 派生/扫描本身坏了） */
  minFiles?: number;
}

export interface RtypePanelGateResult {
  candidates: string[];
  exemptHits: number;
  violations: string[];
}

/** 递归收集生产 .ts（排除 .test.ts / 隐藏目录 / node_modules） */
export function productionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...productionTsFiles(abs));
      continue;
    }
    if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts") || e.name.endsWith(".d.ts")) continue;
    out.push(abs);
  }
  return out;
}

/** 跑一枚感知性绑定派生闸（语义见文件头注释）。 */
export function runRtypePanelGate(cfg: RtypePanelGateConfig): RtypePanelGateResult {
  const { root, srcDir, hookName, apiFiles, requiredTokens, exemptFiles = [], minFiles = 1 } = cfg;
  const apiSet = new Set(apiFiles.map((p) => p.split("/").join(path.sep)));
  const callRe = new RegExp(`\\b${hookName}\\s*\\(`, "g");

  const candidates: string[] = [];
  for (const abs of productionTsFiles(path.join(root, srcDir))) {
    const relPosix = path.relative(root, abs).split(path.sep).join("/");
    // 两侧归一 POSIX 再比（Windows 上 path.sep=\\，直比会漏排 apiFiles）
    if (apiSet.has(relPosix.split("/").join(path.sep))) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (!callRe.test(text)) continue;
    callRe.lastIndex = 0;
    candidates.push(relPosix);
  }

  const violations: string[] = [];
  let exemptHits = 0;
  const seenExempt = new Set<string>();

  for (const rel of candidates) {
    const ex = exemptFiles.find((e) => e.file === rel);
    if (ex) {
      exemptHits++;
      seenExempt.add(rel);
      continue;
    }
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    for (const tok of requiredTokens) {
      if (!tok.re.test(text)) {
        violations.push(
          `${rel}：调用 ${hookName} 但缺「${tok.name}」token——补感知性绑定（隐藏面板只记脏账 + onShow 补扫），或有意例外进 exemptFiles（带 reason）`,
        );
      }
    }
  }

  // 僵尸豁免反查（同 write-surface-gate）：豁免条目不再命中任何候选 = 面板契约已补齐或文件已删，
  // 留着豁免 = 未来同位漏守卫时静默放行。删除即绿，防豁免烂尾。
  for (const e of exemptFiles) {
    if (!seenExempt.has(e.file)) {
      violations.push(`exemptFiles 僵尸条目 ${e.file}（对应调用点已不存在，删掉它）`);
    }
  }

  if (candidates.length < minFiles) {
    violations.push(
      `候选面板数 ${candidates.length} 低于空转下限 ${minFiles}——派生/扫描本身失效（srcDir 或 hookName 改动？）`,
    );
  }
  return { candidates, exemptHits, violations };
}
