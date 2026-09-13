/**
 * Go 域执行块（ADR-206 阶段 6）：updater 前置构建 → go build → go test（-race 分级）→
 * go vet → golangci-lint（增量 + 版本地板 + 快照守卫）→ gofmt 只读 → binding-check。
 *
 * 自守卫：plan.go 为 false 时 no-op。调度侧经 Promise.all 与前端域并行（ADR-088）。
 *
 * @module gate-blocks/go-domain
 */

import type { GateCtx } from "../gate-ctx.ts";
import { resolveBaseRev } from "../gate-resolve.ts";
import { run as procRun } from "../proc.ts";
import { ROOT } from "../scan-files.ts";

export async function runGoDomain(ctx: GateCtx): Promise<void> {
  if (!ctx.plan.go) return;
  // updater helper 前置构建（doctor 全量协议）：go/updater/updater.go 通过 //go:embed
  // 内嵌 ysm-updater-helper.exe（.gitignore 不入库），干净 checkout 缺此文件会导致
  // go build/vet/test 失败（2026-08-14 补入 gate，对齐 doctor）。
  const tH = Date.now();
  const uh = await ctx.shAsync("go build -o go/updater/ysm-updater-helper.exe ./cmd/updater");
  ctx.record("go build -o go/updater/ysm-updater-helper.exe ./cmd/updater", uh.rc === 0, {
    time: Date.now() - tH,
    tail: uh.rc ? uh.out.trim().split("\n").slice(-4).join("\n") : "",
  });

  const goFiles = (ctx.byDomain.go || []).filter((f) => f.endsWith(".go"));

  const t0 = Date.now();
  const goBuild = await ctx.shAsync("go build ./go/...");
  ctx.record("go build ./go/...", goBuild.rc === 0, {
    time: Date.now() - t0,
    tail: goBuild.rc ? goBuild.out.trim().split("\n").slice(-4).join("\n") : "",
  });

  const t1 = Date.now();
  // 对齐 doctor 全量：go test 同时跑 ./internal/app/（2026-08-14 修复漏测）
  // 2026-09-04 恢复 test cache：-count=1 系 .mjs→.ts 机械迁移（2685e53a）照抄的旧参数，
  // 无防假绿动机。源码/测试未变时重复跑（重推失败重试 / 连续 doctor）→ (cached) 秒回，
  // go test 37.4s → <1s。逃生阀：YSM_FRESH_GO_TEST=1 强制新鲜（发版前 / 怀疑测试读
  // 仓库外可变状态致缓存假绿时，doctor 输出 [WARN]skip 场景可配合使用）。
  // ADR-202 刀5（2026-09-07）：-race 仅并发敏感包（共享单锁/缓存/worker 池的包），
  // 其余包普通跑——-race 插桩慢 ~2-3x，非并发包无数据竞争风险，分级后门禁提速；
  // 普通全量仍覆盖 ./go/... ./internal/app/（并发包普通跑一遍，cache 秒回）。
  const freshGoTest = process.env.YSM_FRESH_GO_TEST === "1";
  // 并发敏感包 -race；其余包经 go list 过滤（排除并发包，避免重复跑两遍）。
  // 实测（-count=1 强制新鲜）：全量 -race 42.5s → 分级+过滤 18.9s（-55%）。
  // 跨平台修复：095b3d911 原命令含 `$(go list ...)` bash 替换——Windows cmd.exe
  // 不展开字面 `$(...)`（go 收到畸形包名恒 FAIL），自 ADR-202 刀5 起 Windows
  // gate 该项持续红（90+ commit 积压未推的直接原因）。改为 JS 侧先取包清单
  // 再拼字面命令，双平台等价（grep -vE 'go/(…)(\/|$)' → 等价正则在 JS 实现）。
  const racePkgs =
    "./go/sync/... ./go/conc/... ./go/download/... ./go/instance/... ./go/installer/... ./go/watcher/... ./go/scanner/...";
  const racePkgRe = /(^|\/)go\/(sync|conc|download|instance|installer|watcher|scanner)(\/|$)/;
  const goList = await ctx.shAsync("go list ./go/... ./internal/app/");
  if (goList.rc !== 0) {
    ctx.record("go list ./go/... ./internal/app/", false, {
      tail: goList.out.trim().split("\n").slice(-4).join("\n"),
    });
    return;
  }
  const otherPkgs = goList.out
    .trim()
    .split(/\s+/)
    .filter((p) => p && !racePkgRe.test(p));
  // code_review fd349a91a #6：命令提为变量供 label 复用——原标签含 `...`/中文伪
  // 命令不可执行且省略真实 flags（-count=1/-timeout 60s/go list grep）
  const goTestCmd =
    `go test -race ${racePkgs} ${freshGoTest ? "-count=1 " : ""}-timeout 60s ` +
    `&& go test ${otherPkgs.join(" ")} ${freshGoTest ? "-count=1 " : ""}-timeout 60s`;
  const goTest = await ctx.shAsync(goTestCmd);
  // 记录命令：并发敏感包 -race + 其余包普通跑（ADR-202 刀5 分级）
  ctx.record(goTestCmd, goTest.rc === 0, {
    time: Date.now() - t1,
    tail: goTest.rc ? goTest.out.trim().split("\n").slice(-4).join("\n") : "",
    note: freshGoTest
      ? "YSM_FRESH_GO_TEST=1 强制新鲜跑"
      : "ADR-202 刀5：-race 仅并发敏感包 + 普通全量",
  });

  const tV = Date.now();
  const goVet = await ctx.shAsync("go vet ./go/... ./internal/app/...");
  ctx.record("go vet ./go/... ./internal/app/...", goVet.rc === 0, {
    time: Date.now() - tV,
    tail: goVet.rc ? goVet.out.trim().split("\n").slice(-4).join("\n") : "",
  });

  // golangci-lint（ADR-205）：补齐 Go 静态分析真空面（errcheck/unused/ineffassign/
  // gocritic/gocyclo/staticcheck）。两条硬约束：
  //   ① 只跑增量（--new-from-rev）——全量会撞 736 条存量债（errcheck 623 占 85%），
  //      等于每次 push 必红，门禁即废。存量清零另案，不在此处惩罚。
  //   ② 未安装 / 无基线 rev → 降级 debt（只记录不阻断），与 gofmt 不可用同口径
  //      （.githooks/pre-commit:235）——不给未装工具的开发机或孤儿分支添堵。
  const tGL = Date.now();
  const glVer = procRun("golangci-lint", ["--version"], { cwd: ROOT });
  if (!glVer.ok) {
    ctx.record("golangci-lint（跳过：未安装）", true, {
      time: Date.now() - tGL,
      note: "未检测到 golangci-lint，跳过 Go 静态分析。安装：go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
      blockPolicy: "debt",
    });
  } else {
    // code_review 9403a4dff #4（P2）：版本地板校验——.golangci.yml 为 v2 schema
    // （version: "2"），v1 线或 <v1.64 的二进制解析不了（go directive/config keys
    // 静默丢）→ run 必失败且硬阻断，违背「宁可漏检不可误堵」；按地板降级 debt
    const glVerLine = glVer.out.split("\n")[0] ?? "";
    const vM = glVerLine.match(/v?(\d+)\.(\d+)\.(\d+)/);
    // code_review 9403a4dff #4 修复补（TS2345）：vM[1]/vM[2] 是 match 数组索引
    // （string | undefined）——parseInt 收 string 报 TS 错误；`?? "0"` 安抚类型
    // 且防极端空组 NaN（match 成功时组必在，兜底不改变正常语义）
    const glMaj = vM ? parseInt(vM[1] ?? "0", 10) : 0;
    const glMin = vM ? parseInt(vM[2] ?? "0", 10) : 0;
    const belowFloor = glMaj !== 0 && (glMaj < 1 || (glMaj === 1 && glMin < 64) || glMaj > 2);
    if (belowFloor) {
      ctx.record("golangci-lint（跳过：版本低于地板 v1.64+/v2 线）", true, {
        time: Date.now() - tGL,
        note: `${glVerLine} 低于 ADR-205 §2.4 版本地板（.golangci.yml 为 v2 schema）；安装 v2 线：go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`,
        blockPolicy: "debt",
      });
    } else {
      // code_review 9403a4dff #1/#9（P2）：非 push 模式（--all/--files）localOid 为
      // 空串 → merge-base 空 rev 必失败 → fallback 链恒返回 ""，doctor 每次记录误导性
      // 「跳过：孤儿分支」（真实原因是空 oid）；以 HEAD 为本地侧走 fallback 链
      const baseRev = resolveBaseRev(
        ctx.pushLocalOid || "HEAD",
        ctx.pushRemoteOid,
        ctx.pushLocalRef,
      );
      // code_review 9403a4dff #5（P2）：baseRev 可能来自 pre-push stdin 派生的
      // remoteOid（未验证 hex）——插入 shell 字符串执行构成命令注入（violate
      // git() helper 明示的「stdin 元字符禁入 shell」不变式）——先验 hex 再执行
      const hexOk = /^[0-9a-f]{40,64}$/i.test(baseRev);
      if (!baseRev || !hexOk) {
        ctx.record("golangci-lint（跳过：无基线 rev）", true, {
          time: Date.now() - tGL,
          note: `${glVerLine} 已安装，但无法解析 --new-from-rev 基线（孤儿分支/无远端/基线非 hex）；全量跑会撞 736 条存量债，故跳过而非阻断`,
          blockPolicy: "debt",
        });
      } else if (
        // code_review 9403a4dff #2/#3/#6（P2）：快照守卫——golangci-lint 分析当前
        // 检出工作树，基线却取被推 ref：推非当前分支/脏工作树时 lint 错快照
        // （漏检被推代码 / 误堵无关 WIP）；HEAD==localOid 才跑，否则降级
        ctx.pushLocalOid &&
        !ctx.pushLocalOid.startsWith("0") &&
        procRun("git", ["rev-parse", "HEAD"], { cwd: ROOT }).out.trim() !== ctx.pushLocalOid
      ) {
        ctx.record("golangci-lint（跳过：推非当前分支）", true, {
          time: Date.now() - tGL,
          note: `${glVerLine} 已安装，但推送 ref 与当前检出 HEAD 不一致——增量 lint 分析错快照（漏检被推代码/误堵 HEAD）；降级跳过（ADR-205 口径：宁可漏检不可误堵）`,
          blockPolicy: "debt",
        });
      } else {
        // 数组形式执行（防 shell 解析 baseRev）；字符串仅供 label 展示
        const glLabel = `golangci-lint run --new-from-rev=${baseRev} ./...`;
        const gl = procRun("golangci-lint", ["run", `--new-from-rev=${baseRev}`, "./..."], {
          cwd: ROOT,
        });
        ctx.record(glLabel, gl.rc === 0, {
          time: Date.now() - tGL,
          note: `增量基线 ${baseRev.slice(0, 8)}（只检新增代码；存量 736 条另案清零）`,
          tail: gl.rc ? gl.out.trim().split("\n").slice(-8).join("\n") : "",
        });
      }
    }
  }

  // gofmt：只读校验（修复已下沉 pre-commit；此处检出即阻断，防止绕过提交）
  const t2 = Date.now();
  const unformatted = ctx.gofmtCheck(goFiles);
  // code_review fd349a91a #1/#2/#4/#7：标签须与实际执行一致——门禁只跑只读
  // `gofmt -l <变更文件>`，原标签 "gofmt -w ." 冒充全仓库写盘命令（门禁从不执行
  // 写盘，dry-run 契约 + FAIL 时照抄会全库格式化变更集外的并行文件）
  ctx.record("gofmt -l（只读校验，未格式化文件见 tail）", unformatted.length === 0, {
    time: Date.now() - t2,
    note: unformatted.length
      ? `检出 ${unformatted.length} 个未格式化文件（pre-commit 应已自动修复；疑似 --no-verify 绕过）`
      : "无未格式化文件",
    tail: unformatted.length ? unformatted.join("\n") : "",
  });
  // 格式类债务阻断推送（2026-08-17 注释对齐：record 已置 blocked；pre-commit 正常已自动 gofmt -w，
  // 此处检出即说明绕过了 pre-commit——防 --no-verify 绕过，与 .githooks/pre-commit 口径一致）

  const t3 = Date.now();
  const bc = await ctx.shAsync("node scripts/binding-check.ts --json");
  ctx.record("node scripts/binding-check.ts --json", bc.rc === 0, {
    time: Date.now() - t3,
    raw: bc.out,
    tail: bc.rc ? bc.out.trim().split("\n").slice(-4).join("\n") : "",
  });
}
