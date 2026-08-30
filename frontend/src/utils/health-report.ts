// ===== 体检报告解析（纯函数，跨层共享） =====
// 数据源：Go 端 RepoHealthAudit（go/repoaudit，GUI/CLI 同源，前端不自算）。
// 解析器放 utils 层供 views（诊断页）与 features（oldest 页）共用——分层规则
// R4：features 不得 import views；原实现放 views 导致 oldest-models.ts 跨层
// 导入回归（8ef58232 引入，check-layering 拦截）。本模块零依赖更高层。
// 字段与 go/repoaudit.HealthReport JSON 对齐。

/** Go 端 repoaudit.HealthReport 的 JSON 结构（字段与 go/repoaudit 对齐） */
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
  };
  resources: {
    total_files: number;
    total_size: number;
    /** 禁用文件数（.disabled/.ban，Go types.IsDisableSuffix 单一口径） */
    banned?: number;
    by_type: Record<string, number>;
  };
  dedup: {
    groups: number;
    extra_files: number;
    reclaim_bytes: number;
  };
  warnings?: string[];
}

/** 解析 RepoHealthAudit 返回的 JSON 字符串。
 * 返回有三种形态：
 *  - HealthReport（含 score/completeness）→ 正常报告
 *  - {error: string} → 后端业务错误（路径校验等），返回 Error 对象供调用方区分展示
 *  - 非法 JSON / 其他 → null（真正的解析失败）
 */
export function parseHealthReport(raw: string): HealthReport | Error | null {
  try {
    const parsed = JSON.parse(raw) as HealthReport & { error?: string };
    // 最小运行时校验：score/completeness.percentage 必须为 number，
    // 防后端结构漂移时渲染层 .toFixed() 抛异常白屏
    if (
      typeof parsed.score === "number" &&
      parsed.completeness &&
      typeof parsed.completeness.percentage === "number" &&
      typeof parsed.completeness.valid === "number" &&
      typeof parsed.completeness.invalid === "number"
    )
      return parsed;
    if (parsed.error) return new Error(parsed.error);
    return null;
  } catch {
    return null;
  }
}
