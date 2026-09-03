// ===== 体检报告解析（纯函数，跨层共享） =====
// 数据源：Go 端 RepoHealthAudit（go/repoaudit，GUI/CLI 同源，前端不自算）。
// 解析器放 utils 层供 views（诊断页）与 features（oldest 页）共用——分层规则
// R4：features 不得 import views；原实现放 views 导致 oldest-models.ts 跨层
// 导入回归（8ef58232 引入，check-layering 拦截）。本模块零依赖更高层。
// 字段与 go/repoaudit.HealthReport JSON 对齐（ADR-143 P1 后 Go 返回 typed struct，
// 此处仅保留运行时结构校验，不再 JSON.parse）。

/** Go 端 repoaudit.HealthReport 的 JSON 结构（字段与 go/repoaudit 对齐；ADR-143 P1 后与绑定类型同源） */
export interface HealthReport {
  timestamp: string;
  directory: string;
  score: number;
  completeness: {
    checked: number;
    valid: number;
    invalid: number;
    percentage: number;
  };
  cache: {
    cache_dir: string;
    cache_files: number;
    cache_size: number;
    hit_rate: number;
    /** 容量接近上限（texture_cache 0.8 阈值），体检页可高亮提示 */
    should_warn?: boolean;
  };
  resources: {
    total_files: number;
    total_size: number;
    /** 禁用文件数（.disabled/.ban，Go types.IsDisableSuffix 单一口径） */
    banned?: number;
    by_type: { [key: string]: number | undefined } | null;
  };
  dedup: {
    groups: number;
    extra_files: number;
    reclaim_bytes: number;
  };
  warnings?: string[] | null;
}

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
    typeof raw.completeness.invalid === "number"
  )
    return raw;
  return null;
}
