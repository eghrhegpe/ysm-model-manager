/**
 * 前端域执行块（ADR-206 阶段 6）：check-layering → check-path-hygiene →
 * check-mock-paths → check-menu-health → check-menu-test-layout → check-singleton-hygiene →
 * check-ctx-menu-i18n → check-binding-usage → css-token-check →
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

  // ADR-311：菜单测试「布局快照断言」防回退闸——只减不增基线，新增有序 id/kind toEqual、
  // 精确 toHaveLength、nodes[i] 索引即回归阻断。存量 336 处（35 文件）在基线内不阻断，
  // 随触碰收敛。债务型（同 css-token-check），故 blockPolicy=debt：超基线只 WARN 不 blocked，
  // 避免在渐进执法未完成时把整条前端域锁死（闸本身 exit 1，供人/AI 显式看到回归信号）。
  const tMl = Date.now();
  const ml = await ctx.shAsync("node scripts/check-menu-test-layout.ts --json");
  const mlz = tryParseSummary(ml.out);
  const mlOk = ml.rc === 0;
  ctx.record("node scripts/check-menu-test-layout.ts --json", mlOk, {
    time: Date.now() - tMl,
    raw: ml.out,
    note:
      mlz === null
        ? "输出解析失败（scripts/check-menu-test-layout.ts 缺失？）"
        : mlOk
          ? `菜单布局债 ${mlz.total} 处在基线内（${mlz.files} 文件）`
          : `新增布局快照断言 ${mlz.regressions} 处超基线（ADR-311 三分法：归属用集合断言、定位用 findNodeById）`,
    tail: mlOk ? "" : ml.out.trim().split("\n").slice(-8).join("\n"),
    blockPolicy: "debt",
  });

  // 2026-10-08（3D 预览环境耦合度锐评 P2-b）：preview-3d 模块级可变单例「复位出口」闸。
  // 新增顶层 let 必须给复位出口（__reset* / reset* / clear* / 可传 null 的 set* 注入 setter）
  // 或行内 `// singleton-allow: <理由>`，否则入基线（只减不增）。存量 7 处在基线内。
  // 债务型（同 check-menu-test-layout）：超线只 WARN 不 blocked——渐进执法，随触碰收敛；
  // 闸自身 exit 1，供人/AI 显式看到回归信号。
  const tSg = Date.now();
  const sg = await ctx.shAsync("node scripts/check-singleton-hygiene.ts --json");
  const { ok: sgOk, summary: sgz } = requireSummaryOk(sg.out, sg.rc);
  ctx.record("node scripts/check-singleton-hygiene.ts --json", sgOk, {
    time: Date.now() - tSg,
    raw: sg.out,
    note:
      sgz === null
        ? "输出解析失败（scripts/check-singleton-hygiene.ts 缺失？）"
        : sgOk
          ? `单例卫生合规（存量 ${sgz.total} 处在基线内 / 扫 ${sgz.scannedFiles} 文件）`
          : `新增未受管模块级 let ${sgz.regressions} 处（需复位出口或行内 singleton-allow 注）`,
    tail: sgOk ? "" : sg.out.trim().split("\n").slice(-8).join("\n"),
    blockPolicy: "debt",
  });

  // 2026-10-08（3D 预览环境耦合度锐评 G2）：Worker 生命周期闸。
  // preview-3d 生产文件内出现 `new Worker(` 必须有终止出口（export dispose*/terminate*/
  // reset*/clear*，或经 createWorkerBridge 工厂，或行内 `// worker-allow: <理由>`），
  // 否则入基线（只减不增）。实证动因：KTX2 编码池曾裸建且生产侧零回收点（桥有 dispose()
  // 但无人调，唯一清空路径是 worker 崩溃），而编码是「每个纹理一生一次」的事件。
  // 闸自带两条假绿防线：扫描域 0 文件 → exit 2；`new Worker(` 总命中 0 → exit 2
  //（射程窄，目录改名时「零命中」会被误读成「零债」）。
  // 债务型（同单例卫生闸）：超线只 WARN 不 blocked——渐进执法，闸自身 exit 1 显式可见。
  const tWl = Date.now();
  const wl = await ctx.shAsync("node scripts/check-worker-lifecycle.ts --json");
  const { ok: wlOk, summary: wlz } = requireSummaryOk(wl.out, wl.rc);
  ctx.record("node scripts/check-worker-lifecycle.ts --json", wlOk, {
    time: Date.now() - tWl,
    raw: wl.out,
    note:
      wlz === null
        ? "输出解析失败（scripts/check-worker-lifecycle.ts 缺失？）"
        : wlOk
          ? `Worker 生命周期合规（${wlz.workerSites} 处 new Worker / 存量 ${wlz.total} 处在基线内 / 扫 ${wlz.scannedFiles} 文件）`
          : `新增未受管 Worker ${wlz.regressions} 处（需终止出口 / 工厂 / 行内 worker-allow 注）`,
    tail: wlOk ? "" : wl.out.trim().split("\n").slice(-8).join("\n"),
    blockPolicy: "debt",
  });

  // 右键菜单 i18n key 门禁（2026-09-01 新增）：menu-defs.ts / context-menu*-handlers.ts
  // 里所有字面量 t("key")（原文 tr("key")）必须存在于 zh-CN 基准包，否则运行时静默回退。
  // 与 check-menu-health 同口径——漏 i18n 破坏菜单文案契约，硬阻断。
  // 2026-09 修复：该闸的 SOURCE_FILES 曾整体指向已不存在的 `core/*`，叠加「文件不存在
  // 即跳过」的容错 → 扫零文件报绿（假绿）。现闸自带空域 fail-loud（0 文件 / 0 键 → exit 2），
  // 并在 note 里输出文件数，便于一眼看出「是否真的扫到了东西」。
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
          ? `右键菜单 ${cz.filesScanned ?? "?"} 文件 / ${cz.total} 个 key 全绿`
          : `${cz.violations} 个 key 缺失（运行时静默回退）`,
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
  // ADR-234：标签带 cwd=frontend 上下文（实际执行带 cwd: frontend，
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
  //
  // ⚡ 2026-10-07 本地轻量化（YSM_SKIP_HEAVY_LOCAL=1，默认开）：vite build / tsc / vitest
  // 三者是 pre-push 的**全部重型成本**（本地实测数分钟），而 CI 的 test.yml 已各自独立承担
  // 同一份检查（「前端构建」「前端类型检查」「前端测试（Vitest）」三步）——本地重跑一遍
  // 属纯重复付费，只在「CI 要等十几分钟才知道结果」这一前提下才有意义。
  // 决策依据（用户 2026-10-07 拍板）：推送应秒级返回；重型门禁全面交 CI。
  // 逃生阀：YSM_FAST_PUSH=0 显式关掉，恢复旧的「本地全量」行为（发版前自检用）。
  const heavyLocal = process.env.YSM_FAST_PUSH !== "0";
  if (heavyLocal) {
    ctx.record("cd frontend && npx vite build", true, {
      time: 0,
      note: "跳过（本地轻量模式：交 CI「前端构建」步；YSM_FAST_PUSH=0 可本地跑）",
      blockPolicy: "debt",
    });
    ctx.record("cd frontend && npx tsc --noEmit", true, {
      time: 0,
      note: "跳过（本地轻量模式：交 CI「前端类型检查」步；YSM_FAST_PUSH=0 可本地跑）",
      blockPolicy: "debt",
    });
  } else {
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
  }

  // 视图层 token 消费门禁（审计 UI-Design-Audit-2026-09.md §5.2 第 3 步）：
  // 视图层出现裸数值（非 var()/calc(var())）即报警，逼出 token 消费纪律。
  // 基线模式：首次自动建 baseline（存量 416 条），仅报基线外新增裸值，避免淹没信号。
  // 默认（无 --strict）只报 WARN、rc=0（可见但不阻断 push）；日后升 --strict 即阻断新增裸值。
  const tTk = Date.now();
  const tk = await ctx.shAsync("node scripts/css-token-check.ts --json");
  const tkz = tryParseSummary(tk.out);
  const tkOk = tk.rc === 0; // 默认无 --strict → rc 恒 0 → 不阻断；--strict 时新增裸值 rc=1 才阻断
  ctx.record("node scripts/css-token-check.ts --json", tkOk, {
    time: Date.now() - tTk,
    raw: tk.out,
    note:
      tkz === null
        ? "输出解析失败（scripts/css-token-check.ts 缺失？）"
        : tkOk
          ? `视图层 token 合规（新增裸值 0，存量在基线内）`
          : `新增裸值 ${tkz.warns} 处（未登记基线）`,
    blockPolicy: "debt", // 基线债务只报告不阻断（与 check-design-tokens 存量债同口径）
  });

  // ADR-023 P3：L3 Vitest 随前端域变更回归（串行在后，独占资源）
  const t1 = Date.now();
  // 与 frontend/package.json test 对齐：--maxWorkers 8（24 核默认并发过载反慢 ~10s）
  // 命令保持**字面量直传**：test_gate_sh_invariants.ts 禁未登记的动态 ctx.sh/shAsync 实参，
  // 提取成常量再传入会触发「未登记插值来源」断言（复跑同样用同一字面量，勿抽变量）。
  if (heavyLocal) {
    ctx.record("cd frontend && npx vitest run --maxWorkers 8", true, {
      time: 0,
      note: "跳过（本地轻量模式：交 CI「前端测试（Vitest）」步；YSM_FAST_PUSH=0 可本地跑）",
      blockPolicy: "debt",
    });
    return;
  }
  const ft = await ctx.shAsync("npx vitest run --maxWorkers 8", {
    cwd: path.join(ROOT, "frontend"),
  });
  // 负载瞬态容错（2026-10-07）：本块与 Go 域（go test -race）经 Promise.all **并行**
  // （ADR-088），满载下 vitest 用例被 CPU 饿死而击穿 5s testTimeout → rc≠0 → 误阻断推送。
  // 实证：ground-capability.test.ts 一条平时 1729ms 的用例在模拟满载下实测 7662ms 超时，
  // 单跑/复跑皆绿（典型负载 flaky，与 pre-push-gate 知识卡所记 go/cli 整包现象同源）。
  // 处置：对齐 contract-tests.ts 既有范式（有界并发 + 失败串行复跑 1 次）——**先串行复跑
  // 一次**：真回归复跑仍红（不掩盖），负载瞬态复跑转绿。复跑不污染首轮计时口径。
  let ft2 = ft;
  let retried = false;
  if (ft.rc !== 0) {
    retried = true;
    ft2 = await ctx.shAsync("npx vitest run --maxWorkers 8", {
      cwd: path.join(ROOT, "frontend"),
    });
  }
  // 失败时抓失败测试名：vitest 输出里失败用例行含测试名，比取最后 4 行（汇总数字）更易定位。
  // 2026-10-07 修正：原式取「尾部 4 行」时，输出末尾的 happy-dom 性能提示会挤掉真失败名
  // （首轮实证：tail 只捞到环境提示，看不出失败的是哪条）。改为优先抓失败用例行。
  const failLines = ft2.out.match(/^\s*(?:×|✗|FAIL)[^\n]*$/gm) ?? [];
  const vitestTail = ft2.rc
    ? (failLines.length ? failLines : ft2.out.trim().split("\n").slice(-4)).slice(0, 8).join("\n")
    : "";
  ctx.record("cd frontend && npx vitest run --maxWorkers 8", ft2.rc === 0, {
    time: Date.now() - t1,
    note: retried
      ? ft2.rc === 0
        ? "首轮失败 → 串行复跑转绿（负载瞬态 flaky，非本次回归）"
        : "首轮 + 复跑均失败（真回归，不掩盖）"
      : "",
    tail: vitestTail,
  });
}
