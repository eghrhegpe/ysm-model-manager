// ===== 体检报告解析（纯函数，跨层共享） =====
// 数据源：Go 端 RepoHealthAudit（go/repoaudit，GUI/CLI 同源，前端不自算）。
// 解析器放 utils 层供 views（诊断页）与 features（oldest 页）共用——分层规则
// R4：features 不得 import views，本模块同时供两域消费，故必须驻留 utils；零依赖更高层。
// 类型源：binding 生成（frontend/bindings/ysm-model-manager/go/repoaudit/models.ts），
// 此处仅保留运行时结构校验，不再重复定义 interface（消灭手写镜像与绑定双源）。

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
    raw.completeness &&
    typeof raw.completeness.percentage === "number" &&
    typeof raw.completeness.valid === "number" &&
    typeof raw.completeness.invalid === "number" &&
    // cache 结构校验：防 cache_dir/cache_files 漂移时渲染层访问 undefined
    // （原校验 hit_rate —— 该字段因语义错误已从 CacheStatus 删除，改校验 cache_files）
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
