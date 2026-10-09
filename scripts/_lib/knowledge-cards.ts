/**
 * knowledge-cards.ts — 知识卡常量共享层（ADR-114 §被补充）。
 *
 * YSM 有 7 个 category（core/go/ui/feature/rendering/utils/config），
 * 与 BABY MikuMikuAR 的 8 桶（env/scene/physics/rendering/motion/ui/core/backend）不同——
 * 两边语义独立，切勿混用。
 *
 * 历史：此前 5 个脚本各自复制 KNOWLEDGE_ORDER / CATEGORY_LABELS / NON_CARDS
 *   - gen-knowledge-index.ts（CATEGORY_LABELS + NON_CARDS）
 *   - gen-knowledge-adr.ts（NON_CARDS，含 menu-map/graph/tier-review 冗余项）
 *   - gen-knowledge-h1.ts（NON_CARDS）
 *   - gen-knowledge-tests.ts（NON_CARDS）
 *   - gen-vitepress-sidebar.ts（KNOWLEDGE_ORDER）
 * 由本模块单点导出，补词/删词只改此处。
 *
 * 零依赖（仅 node:path）。
 */
import path from "node:path";
import { ROOT } from "./scan-files.ts";

/** 知识卡分类展示顺序（sidebar / 索引共用）。 */
export const KNOWLEDGE_ORDER = ["core", "go", "ui", "feature", "rendering", "utils", "config"];

/** 分类 → 中文标签（sidebar / 索引 / 路由表共用）。 */
export const CATEGORY_LABELS = {
  core: "核心基础设施（事件总线、页面状态、Wails 桥接）",
  go: "Go 后端包（安装、下载、回收站、YSM 解析等）",
  ui: "前端 UI 组件（tree、sidebar、preview、content）",
  feature: "业务功能（导入队列、同步、社区）",
  rendering: "3D 渲染与预览核心（preview-core、model2d/3d、perception、render-federation）",
  utils: "工具函数（display、fmt、dom、animation）",
  config: "配置与注册表（resource_types、AppConfig）",
};

/** 非知识卡目录成员（索引 / 路由表 / 操作手册 / 机器生成地图）。 */
export const KNOWLEDGE_NON_CARDS = new Set([
  "index.md",
  "README.md",
  "AGENTS.md",
  "routes.md", // gen-routes 产出（ADR-114 §被补充）
  "routes-quick.md", // gen-routes-quick 产出（AI 高频场景路由表）
  "menu-map.md", // 若后续 gen-menu-map 产出（BABY 预留）
  "graph.md", // 若后续 gen-knowledge-graph 产出（BABY 预留）
  "tier-review.md", // BABY 预留
  "android-dev.md", // Android 开发手册（枢纽总览，操作手册类，非单卡）
]);

/**
 * 知识卡 `perf:` 性能画像受控词表（单一事实源）。
 *
 * 卡片 frontmatter 可选声明（块列表，与 use_when 同格式）：
 *   perf:
 *     - cpu-bound
 * 词表外标签 → check-knowledge-drift ERROR（fail-closed，ADR-043 契约）。
 * 扩展新维度（远期能耗 energy-* 等）只改本常量，检查器/生成器自动跟上。
 */
export const PERF_TAGS = {
  "cpu-bound": "CPU 密集（解析/编译/解算/编码）",
  "io-bound": "IO 密集（批量读写/RPC/网络）",
  "gpu-bound": "GPU/显存敏感（纹理/3D 渲染）",
  concurrent: "多核并行（goroutine 池/Worker 池/pthread/Promise 竞速）",
  "single-thread": "单线程顺序执行（顺序流水线/串行队列）",
  "memory-heavy": "内存/显存大户（大缓冲/长驻缓存）",
};

/**
 * CARD_STATUS — 知识卡生命周期状态受控词表（2026-09 收编：status 原是 151 卡自发
 * 手写的野生字段，零校验零消费；现收编为正式字段，值域词表单一事实源本常量）。
 * 语义（卡的生命周期，非决策采纳——ADR 采纳状态在 adr-status-categories.ts）：
 *   active      当前有效，随源码演进维护
 *   draft       起草中/未定稿（new-knowledge-card 模板默认值；定稿后改 active）
 *   snapshot    一次性快照/报告（审计/迁移/扫描记录，不随源码演进；应配 affected: false）
 *   archived    已归档（不再适用，留档备查）
 *   superseded  被更新卡取代（应在正文标注取代关系）
 * 扩展新状态只改本常量（checker/gen 自动跟上）。
 */
export const CARD_STATUS: Record<string, string> = {
  active: "当前有效，随源码演进维护",
  draft: "起草中/未定稿（模板默认；定稿后改 active）",
  snapshot: "一次性快照/报告（应配 affected: false）",
  archived: "已归档（不再适用，留档备查）",
  superseded: "被更新卡取代（应在正文标注取代关系）",
};

/**
 * QUICK_GROUPS — 路由表（routes-quick）场景分组受控词表（2026-10-05 治理）。
 *
 * 背景：quick_groups 原是每卡自由文本，组名漂移把 routes-quick 拖成 80 组
 * （69 组只挂 1 张卡；近重复名成堆——3D×4 / 后端桥接×3 / 门禁×3），浏览式检索失效。
 * 现收敛为封闭词表：gen-routes-quick 按本数组顺序渲染分组，词表外组名并入
 * 「未归类」桶并 WARN（fail-visible）——新增合法组名只改本常量，勿在卡里发明新组名。
 * 数组顺序 = 路由表渲染顺序（高频域在前）。
 */
export const QUICK_GROUPS = [
  "3D 预览与模型追加",
  "UI 交互与弹窗",
  "跨组件通信与页面",
  "模型扫描与仓库管理",
  "文件操作与标签",
  "后端桥接与数据存储",
  "配置与注册表",
  "下载与社区",
  "截图导出与缓存",
  "前端分层与边界",
  "重构与域切分",
  "门禁与脚本",
  "测试与验证",
  "能力门控与平台判定",
];

/** 知识卡目录（供各 gen-* 脚本复用，避免各自 path.join 漂移）。 */
export const KNOW_DIR = path.join(ROOT, "docs", "knowledge");

/**
 * CARD_TOP_KEYS — 知识卡 frontmatter 顶层键白名单（2026-10-08 P1 落地，fail-closed）。
 *
 * 背景：2026-10 存量审计发现 11 卡使用 schema 外野字段（last_verified/created/updated/
 * related_adrs/reference_files/supersedes/description），零消费者零校验——写进去没人管。
 * 处置（混合方案）：created/updated/related_adrs/reference_files/supersedes/description
 * 清理归零（占位符毒/复制/机制冲突），last_verified 收编进白名单（真实日期、活字段、
 * 填补「最后实证验证时间」空白——git 只能给改动时间，给不了「被验证过」的语义）。
 * 此后任何 schema 外顶层键 → check-knowledge-drift ERROR。
 * 新增合法字段只改本常量（checker/gen 自动跟上），勿在卡里发明键名。
 */
export const CARD_TOP_KEYS: Record<string, string> = {
  adr: "相关 ADR 引用",
  affected: "源码变更影响匹配开关（仅 affected: false 合法）",
  auto_fields: "机器推导字段域（symbols_with_lines/tests/reference_files 等）",
  broad_claim: "有意宽认领旗标：跨切面聚合视图，豁免本卡 5.14 派生符号体量 / 5.15 全重复认领 WARN；条件失配时 5.17 stale 自清理（2026-10-09，台账 K1 的机器表达）",
  category: "分类（core/go/ui/feature/rendering/utils/config）",
  invariant_anchors: "机制锚点（文件|符号）",
  kind: "卡标识（kebab-case，= 文件名）",
  last_verified: "最后实证验证时间（2026-10-08 收编）",
  name: "卡名（= H1 标题）",
  perf: "性能画像词表（PERF_TAGS）",
  pitfalls: "陷阱清单",
  quick_groups: "路由分组（受控词表 QUICK_GROUPS）",
  quick_intents: "路由意图关键词",
  quick_risk_lines: "风险红线（人读）",
  source_files: "真实源码路径",
  status: "生命周期（受控词表 CARD_STATUS）",
  tests: "关联测试文件",
  tier: "architecture|leaf",
  use_when: "适用场景关键词",
};
