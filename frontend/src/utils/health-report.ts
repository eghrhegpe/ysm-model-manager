// ===== 体检报告解析（纯函数，跨层共享） =====
// 数据源：Go 端 RepoHealthAudit（go/repoaudit，GUI/CLI 同源，前端不自算）。
// 解析器放 utils 层供 views（诊断页）与 features（oldest 页）共用——分层规则
// R4：features 不得 import views，本模块同时供两域消费，故必须驻留 utils；零依赖更高层。
// 类型源：binding 生成（frontend/bindings/ysm-model-manager/go/repoaudit/models.ts），
// 此处仅保留运行时结构校验，不再重复定义 interface（消灭手写镜像与绑定双源）。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import type { HealthReport } from "./types-re-export.ts";

export type { HealthReport };

/** 校验 RepoHealthAudit 返回的 typed 报告（ADR-143 P1 后 Go 直出 struct）。
 * 返回有三种形态：
 *  - HealthReport（含 score/completeness）→ 正常报告
 *  - null（Go 返回 null / 结构不合法）→ 解析失败
 */
export function parseHealthReport(raw: HealthReport | null): HealthReport | null {
  // 最小运行时校验：score/completeness.percentage 必须为 number，
  // 防后端结构漂移时渲染层 .toFixed() 抛异常白屏
  if (
    raw &&
    typeof raw.score === "number" &&
    // 锐评④：verdict 是 Go 单源判定字段（go/repoaudit ScoreVerdict 产出 good/ok/bad，
    // 绑定类型必填）。缺失 = 后端结构漂移，按解析失败显式报错——宁可报修，不让前端
    // 回退分数带悄悄变成第二判定源。值在带外（Go 未来新档）不阻断，渲染层回退带兜底。
    typeof raw.verdict === "string" &&
    raw.completeness &&
    typeof raw.completeness.percentage === "number" &&
    typeof raw.completeness.valid === "number" &&
    typeof raw.completeness.invalid === "number" &&
    // cache 结构校验：防 cache_dir/cache_files 漂移时渲染层访问 undefined
    // （校验对象需在 CacheStatus 里稳定存在：hit_rate 曾因口径错误被删后恢复，
    // 改用语义稳定的 cache_files——命中率为 0 时该字段仍恒在，校验不会误拒）
    raw.cache &&
    typeof raw.cache.cache_files === "number" &&
    // resources 结构校验：防 by_type/total_files 漂移时渲染层访问 undefined
    raw.resources &&
    typeof raw.resources.total_files === "number" &&
    raw.resources.by_type !== undefined
  )
    return raw;
  return null;
}

// ===== verdict → 外观映射（单源，2026-10-13 锐评三查收口）=====
// 病：同一份「verdict(good/ok/bad)→颜色/文案/回退带」在 diagnostics/health.ts 与
// features/maintenance/oldest-models.ts **各写一份**（oldest 注释自陈「与 health.ts
// 同构」= 镜像的自供状），且牵出 6 枚 locale 键逐字重复（diagnostics.healthGood/Ok/Bad
// vs oldest.health.good/ok/bad，三语完全相同）——改一处文案另一处不跟，正是本页
// GetLogCaps 单源化干掉的「真相在别处、镜像手工抄」病，只是这次镜像在前端内部。
// parseHealthReport 早已因「features 不得 import views」（R4）驻留本模块，而映射没
// 跟着走：同一条数据管道前半共享后半双份。现合并——两域消费同一出口，键族统一走
// 三段式合规的 repo.health.*（ADR-124），两侧旧键退役进死键闸收编。
// ⚠️ 表存 LocaleKey、不在构建期求值 t()（模块级冻结译文病，门禁
// scripts/i18n-frozen-t-check.ts）；译文由 healthBand() 消费点现调。

/** verdict 值域外观（color = CSS 变量串；tagClass = .health-tag.<verdict> 徽章类名） */
export interface HealthBand {
  color: string;
  labelKey: LocaleKey;
  tagClass: string;
}

const VERDICT_BANDS: Record<string, HealthBand> = {
  good: { color: "var(--status-success)", labelKey: "repo.health.good", tagClass: "good" },
  ok: { color: "var(--tag-amber)", labelKey: "repo.health.ok", tagClass: "ok" },
  bad: { color: "var(--status-error)", labelKey: "repo.health.bad", tagClass: "bad" },
};

// 回退带：与 Go ScoreVerdict 阈值一致（good≥80 / ok≥60 / bad），仅当 verdict 缺失/
// 不在值域（旧后端直连 / Go 未来新档位）时兜底，正常链路不走。
// ⚠️ 这仍是 Go 阈值的前端镜像——刻意保留：它的存在意义正是「verdict 没来」时的降级，
// 若 Go 改带而此处不跟，后果只落在「本来就拿不到 verdict」的异常链路上。
export function scoreBand(score: number): HealthBand {
  return score >= 80 ? VERDICT_BANDS.good : score >= 60 ? VERDICT_BANDS.ok : VERDICT_BANDS.bad;
}

/** verdict → 外观带（未知/缺失回退分数带；两域唯一消费口） */
export function healthBand(verdict: string | undefined, score: number): HealthBand {
  return (verdict ? VERDICT_BANDS[verdict] : undefined) ?? scoreBand(score);
}

/** verdict → 本地化文案（消费点现调，防构建期冻结） */
export function healthBandLabel(verdict: string | undefined, score: number): string {
  return t(healthBand(verdict, score).labelKey);
}
