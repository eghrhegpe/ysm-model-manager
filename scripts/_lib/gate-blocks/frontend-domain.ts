/**
 * 前端域执行块（ADR-206 阶段 6）：check-layering → check-path-hygiene →
 * check-mock-paths → check-menu-health → check-ctx-menu-i18n → check-binding-usage →
 * npm 三件套（vite build ∥ tsc --noEmit 并行，vitest 串行在后）。
 *
 * 自守卫：plan.frontend 为 false 时 no-op。调度侧经 Promise.all 与 Go 域并行（ADR-088）。
 *
 * @module gate-blocks/frontend-domain
 */
import path from "node:path";
import type { GateCtx } from "../gate-ctx.ts";
import { requireSummaryOk, tryParseSummary } from "../gate-parse.ts";
import { ROOT } from "../scan-files.ts";

export async function runFrontendDomain(ctx: GateCtx): Promise<void> {
  if (!ctx.plan.frontend) return;
  // 分层守护：前端目录间反向依赖（R1/R2 零容忍 + R3/R4 基线，现基线 0 条）
  const tL = Date.now();
  const ll = await ctx.shAsync("node scripts/check-layering.ts --json");
  const lz = tryParseSummary(ll.out);
  const lOk = ll.rc === 0;
  ctx.record("node scripts/check-layering.ts --json", lOk, {
    time: Date.now() - tL,
    raw: ll.out,
    note:
      lz === null
        ? "输出解析失败（scripts/check-layering.ts 缺失？）"
        : lOk
          ? `分层合规（零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}）`
          : `零容忍 ${lz.zero_tolerance} + 新增回归 ${lz.regressions}`,
  });

  // ADR-146：路径卫生门禁（反桶 R1 + 深度 R2 + 上跳 R3 + 跨边界冻结 R4 + 双写一致性）。
  // R0 别名闸已于闸二（2026-09-01）整条删除——check-layering/check-circular/check-path-hygiene 自身均已别名感知，
  // 写别名通过门禁（WARN 不阻断，仅 R4/一致性 FAIL 才会 rc≠0）。
  const tP = Date.now();
  const ph = await ctx.shAsync("node scripts/check-path-hygiene.ts --json");
  const pz = tryParseSummary(ph.out);
  const pOk = ph.rc === 0;
  ctx.record("node scripts/check-path-hygiene.ts --json", pOk, {
    time: Date.now() - tP,
    raw: ph.out,
    note:
      pz === null
        ? "输出解析失败（scripts/check-path-hygiene.ts 缺失？）"
        : pOk
          ? `路径卫生合规（warn ${pz.warn}）`
          : `FAIL ${pz.fail}：R4=${pz.r4_cross_boundary?.count}/${pz.r4_cross_boundary?.baseline} 一致性=${pz.consistency?.ok}`,
  });

  // ADR-224：mock 路径守卫（vi.mock 失效静默病灶静态校验）。
  // M1 内部 spec（@/ #root/ ./ ../）解析失败 → FAIL（唯一 fail-closed，sync 那类病灶）；
  // M2 裸包 deps∪node_modules 皆无 → 默认 WARN 不阻断（--strict 才升 FAIL，ADR E1 决策：
  //   deps 主导、node_modules 只兜底，本仓 node_modules 不完整，fail-closed 会制造环境噪声）；
  // M3 .js 胶水兜底（app.js→app.ts）→ INFO 只统计。故此处不加 --strict，只拦 M1。
  const tMock = Date.now();
  const mk = await ctx.shAsync("node scripts/check-mock-paths.ts --json");
  const mkz = tryParseSummary(mk.out);
  const mkOk = mk.rc === 0;
  ctx.record("node scripts/check-mock-paths.ts --json", mkOk, {
    time: Date.now() - tMock,
    raw: mk.out,
    note:
      mkz === null
        ? "输出解析失败（scripts/check-mock-paths.ts 缺失？）"
        : mkOk
          ? `mock 路径合规（fail ${mkz.fail} warn ${mkz.warn} info ${mkz.m3_info}）`
          : `FAIL ${mkz.fail}：M1=${mkz.m1_fail} 处 mock 路径失效`,
  });

  // ADR-085：菜单表健康门禁——"加菜单项只改表"的自动兜底（秒级正则扫描，早失败早停）。
  // 校验：id 唯一 / labelKey 非空 / i18n 三语齐全 / dockGroup 合法 / kind 合法 / render·run 完备。
  const tM = Date.now();
  const mh = await ctx.shAsync("node scripts/check-menu-health.ts --json");
  const { ok: mOk, summary: mz } = requireSummaryOk(mh.out, mh.rc);
  ctx.record("node scripts/check-menu-health.ts --json", mOk, {
    time: Date.now() - tM,
    raw: mh.out,
    note:
      mz === null
        ? "输出解析失败"
        : mOk
          ? `菜单表 ${mz.total} 项全绿`
          : `${mz.violations} 条菜单表违规（id/labelKey/i18n/dockGroup/kind/render-run）`,
    tail: mOk ? "" : mh.out.trim().split("\n").slice(-4).join("\n"),
  });
  // 菜单表违规 = hard（默认）：ctx.record() 已自动置 blocked，无需重复手动设

  // 右键菜单 i18n key 门禁（2026-09-01 新增）：menu-defs.ts / context-menu*-handlers.ts
  // 里所有字面量 tr("key") 必须存在于 zh-CN 基准包，否则运行时静默回退英文。
  // 与 check-menu-health 同口径——漏 i18n 破坏菜单文案契约，硬阻断。
  const tC = Date.now();
  const ci = await ctx.shAsync("node scripts/check-ctx-menu-i18n.ts --json");
  const { ok: cOk, summary: cz } = requireSummaryOk(ci.out, ci.rc);
  ctx.record("node scripts/check-ctx-menu-i18n.ts --json", cOk, {
    time: Date.now() - tC,
    raw: ci.out,
    note:
      cz === null
        ? "输出解析失败"
        : cOk
          ? `右键菜单 ${cz.total} 个 tr() key 全绿`
          : `${cz.violations} 个 key 缺失（运行时静默回退英文）`,
    tail: cOk ? "" : ci.out.trim().split("\n").slice(-8).join("\n"),
  });
  // 右键菜单 i18n 缺失 = hard（默认）：ctx.record() 已自动置 blocked，无需重复手动设

  // 问题 3-A 解法：禁止绕过 bindings 直接调 window.go.main.App.xxx
  // 前端调 Go 函数必须走 bindings/ 强类型接口，避免参数错位编译期不报错
  const tB = Date.now();
  const bu = await ctx.shAsync("node scripts/check-binding-usage.ts --json", {
    cwd: path.join(ROOT, "frontend"),
  });
  const { ok: buOk, summary: buz } = requireSummaryOk(bu.out, bu.rc);
  // code_review fd349a91a #5：标签带 cwd=frontend 上下文（实际执行带 cwd: frontend，
  // 仓库根 scripts/ 下无此脚本）——原标签照抄从根执行 ENOENT；与同域 vite/tsc
  // vitest 标签的 "cd frontend &&" 约定对齐
  ctx.record("cd frontend && node scripts/check-binding-usage.ts --json", buOk, {
    time: Date.now() - tB,
    raw: bu.out,
    note:
      buz === null
        ? "输出解析失败"
        : buOk
          ? "无绕过 bindings 的直接调用"
          : `${buz.violations} 处绕过 bindings 直接调 window.go.main.App`,
    tail: buOk ? "" : bu.out.trim().split("\n").slice(-8).join("\n"),
  });

  // npm 三件套并行优化：vite build ∥ tsc --noEmit，vitest 串行在后
  // （vitest 是重活儿，独占资源更稳；build 与 tsc 无依赖，墙钟减半）
  // tsc 路径解析：优先 npx 探测（workspace hoisting 兼容），回退硬编码路径
  const t0 = Date.now();
  const [fb, tscResult] = await Promise.all([
    ctx.shAsync("npx vite build", { cwd: path.join(ROOT, "frontend") }),
    // npx tsc --version 探测（最简且最鲁棒的 monorepo 兼容方案）
    ctx
      .shAsync("npx tsc --version")
      .then((r) => {
        if (r.rc !== 0) return { rc: -1, out: "" };
        // tsc 可用，再跑 --noEmit 检查
        return ctx.shAsync("npx tsc --noEmit", { cwd: path.join(ROOT, "frontend") });
      })
      .catch(() => ({ rc: -1, out: "" })),
  ]);
  const wallA = Date.now() - t0;
  const tscRc = tscResult.rc ?? -1;
  ctx.record("cd frontend && npx vite build", fb.rc === 0, {
    time: wallA,
    tail: fb.rc ? fb.out.trim().split("\n").slice(-4).join("\n") : "",
  });
  if (tscRc >= 0) {
    const lines = tscResult.out.trim().split("\n").filter(Boolean);
    ctx.record("cd frontend && npx tsc --noEmit", tscRc === 0, {
      time: wallA,
      note: tscRc === 0 ? "" : `${lines.length} errors`,
      tail: tscRc === 0 ? "" : lines.slice(-5).join("\n"),
    });
  } else {
    ctx.record("cd frontend && npx tsc --noEmit", false, {
      time: 0,
      note: "tsc 未安装（npx tsc --version 失败）——请 npm ci 后重推",
    });
  }

  // ADR-023 P3：L3 Vitest 随前端域变更回归（串行在后，独占资源）
  const t1 = Date.now();
  // 与 frontend/package.json test 对齐：--maxWorkers 8（24 核默认并发过载反慢 ~10s）
  const ft = await ctx.shAsync("npx vitest run --maxWorkers 8", {
    cwd: path.join(ROOT, "frontend"),
  });
  // 失败时抓失败测试名：vitest 输出里 ❯/×/FAIL 行含测试文件名+用例名，
  // 比取最后 4 行（汇总数字）更易定位。最多取 8 行避免 tail 过长。
  const vitestTail = ft.rc
    ? (ft.out.match(/^(?:❯|×|FAIL)[^\n]*$/gm) || ft.out.trim().split("\n").slice(-4))
        .slice(0, 8)
        .join("\n")
    : "";
  ctx.record("cd frontend && npx vitest run --maxWorkers 8", ft.rc === 0, {
    time: Date.now() - t1,
    tail: vitestTail,
  });
}
