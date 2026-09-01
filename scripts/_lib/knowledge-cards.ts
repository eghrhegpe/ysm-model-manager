/**
 * knowledge-cards.ts — 知识卡常量共享层（ADR-114 §被补充）。
 *
 * YSM 有 6 个 category（core/go/ui/feature/utils/config），
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
import path from 'node:path';
import { ROOT } from './scan-files.ts';

/** 知识卡分类展示顺序（sidebar / 索引共用）。 */
export const KNOWLEDGE_ORDER = ['core', 'go', 'ui', 'feature', 'utils', 'config'];

/** 分类 → 中文标签（sidebar / 索引 / 路由表共用）。 */
export const CATEGORY_LABELS = {
  core: '核心基础设施（事件总线、页面状态、Wails 桥接）',
  go: 'Go 后端包（安装、下载、回收站、YSM 解析等）',
  ui: '前端 UI 组件（tree、sidebar、preview、content）',
  feature: '业务功能（导入队列、同步、社区）',
  utils: '工具函数（display、fmt、dom、animation）',
  config: '配置与注册表（resource_types、AppConfig）',
};

/** 非知识卡目录成员（索引 / 路由表 / 操作手册 / 机器生成地图）。 */
export const KNOWLEDGE_NON_CARDS = new Set([
  'index.md',
  'README.md',
  'AGENTS.md',
  'routes.md',       // gen-routes 产出（ADR-114 §被补充）
  'menu-map.md',     // 若后续 gen-menu-map 产出（BABY 预留）
  'graph.md',        // 若后续 gen-knowledge-graph 产出（BABY 预留）
  'tier-review.md',  // BABY 预留
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
  'cpu-bound': 'CPU 密集（解析/编译/解算/编码）',
  'io-bound': 'IO 密集（批量读写/RPC/网络）',
  'gpu-bound': 'GPU/显存敏感（纹理/3D 渲染）',
  'concurrent': '多核并行（goroutine 池/Worker 池/pthread/Promise 竞速）',
  'single-thread': '单线程顺序执行（顺序流水线/串行队列）',
  'memory-heavy': '内存/显存大户（大缓冲/长驻缓存）',
};

/** 知识卡目录（供各 gen-* 脚本复用，避免各自 path.join 漂移）。 */
export const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');