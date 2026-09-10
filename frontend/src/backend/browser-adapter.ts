// ===== 浏览器后端适配器（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
// Proxy 生成与 Wails AppBindings 同形状的后端：
// - 已实现 binding：Phase 2 起走真实数据（IndexedDB 模型库 + localStorage 配置）
// - 未实现 binding：fail-fast 抛 WebUnsupportedError（明确报错，杜绝 undefined
//   穿透静默失败——治理红线陷阱 #5）
// 虚拟根 /web：让前端路径语义（GetRepoRoot → ScanModelEntries → ReadFileBytes）
// 与桌面一致，业务调用零改动。
// ADR-040 按职责拆分：本文件退化为「编排/入口」薄壳——实现函数/状态迁移至
// web-common.ts（共享原语）/ web-fs.ts（文件系统）/ web-store.ts（配置/日志/标签/ban）/
// web-community.ts（社区/头像/作者），此处从新文件 import 组装 webImpls，
// 并保留 browserAdapter Proxy 导出（知识卡 backend-idb invariant_anchor）。
import type { AppBindings } from "./types.ts";

// 共享原语 re-export（保持对外 API 导出名/签名不变）
export {
  arrayBufferToBase64,
  MAX_IMPORT_BYTES,
  WEB_ROOT,
  WebUnsupportedError,
} from "./web-common.ts";
// 文件系统类实现（web-fs.ts）；importWebFiles/selectLocalRepo 同时对外 re-export
// R2 FSA 持久化原语对外暴露（含授权状态查询，供 settings UI 启动引导）
export {
  getFsaAuthState,
  importWebFiles,
  reauthorizeFsaRoot,
  rescanFsaRoot,
  selectLocalRepo,
} from "./web-fs.ts";
// ADR-071 #6：SearchModels 数值统计 Worker 编排（降级标记/测试注入/取消）。
// 经 browserAdapter 链 re-export：保证消费方（toolbar-search / 测试）与 web-fs 内
// searchWebModels 拿到同一模块实例（vitest mock 图会拆出独立实例，直接 import 会断降级标记）。
export {
  __setStatsRunnerForTest,
  consumeWebSearchDegraded,
  getStatsPoolSize,
  onStatsProgress,
  prefetchStatsWorker,
  terminateStatsWorker,
} from "./web-stats.ts";

import { webCliBindings } from "./web-cli.ts";
// 注册表驱动装配（Top 6）：各职责模块自注册 binding 片段（web-common/web-fs/
// web-store/web-community），本文件只做 spread 装配 + 类型对账 + Proxy 门控。
import { WebUnsupportedError, webCommonBindings } from "./web-common.ts";
import { webCommunityBindings } from "./web-community.ts";
import { webFsBindings } from "./web-fs.ts";
import { webStoreBindings } from "./web-store.ts";

// 注册表驱动装配：由五个职责模块自注册的 binding 片段合并而成。
// P1-1 加固：键名对齐 Go 单一事实源 AppBindings（typeof Wails 生成绑定模块）。
// 编译期保证（satisfies Partial<GoBindingShape>）：web 实现的值必须是 WebBinding
// 形态（方法与 AppBindings 键名冲突时类型不兼容会报错）；但 Partial 允许额外
// 属性——Go 侧删除 binding 后 web 残留孤儿名**不会**在编译期报错，孤儿检测
// 只由 scripts/web-binding-check.ts 的键名集合比对承担（该脚本只对齐键名
// 覆盖率/孤儿，不做参数与返回结构漂移检测——结构漂移防线 = Go 侧调用时
// 运行期暴露，code_review 81ab1132b P3 更正原注释的虚假承诺）。
type WebBinding = (...args: never[]) => Promise<unknown>;
type GoBindingShape = {
  [K in keyof AppBindings as AppBindings[K] extends (...a: never[]) => unknown
    ? K
    : never]: WebBinding;
};
const webImpls = {
  ...webCommonBindings,
  ...webFsBindings,
  ...webStoreBindings,
  ...webCommunityBindings,
  ...webCliBindings,
} satisfies Partial<GoBindingShape>;

// fail-fast 函数缓存：保证同一 binding 返回稳定引用（便于 Phase 3 能力探测 /
// spyOn / 记忆化）——避免每次 get 新建函数导致 adapter.Foo !== adapter.Foo
const failFastCache = new Map<string, (...args: never[]) => Promise<never>>();
function makeFailFast(name: string): (...args: never[]) => Promise<never> {
  let f = failFastCache.get(name);
  if (!f) {
    f = async () => {
      throw new WebUnsupportedError(name);
    };
    failFastCache.set(name, f);
  }
  return f;
}

/** 浏览器后端（Proxy 动态形状，未实现 binding 一律 fail-fast） */
export const browserAdapter = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    // thenable 探测陷阱：await/`Promise.resolve(adapter)` 会访问 .then——
    // 若返回 async 函数则被误判为 thenable，await 调它抛错导致挂起。
    // 返回 undefined 让 adapter 不是 thenable。
    if (prop === "then") return undefined;
    // symbol（如 Symbol.toStringTag）不拦截，返回 undefined 走默认行为
    if (typeof prop === "symbol") return undefined;
    const name = String(prop);
    // Object 原型成员（toString/constructor/valueOf/hasOwnProperty 等）不得路由到
    // fail-fast：`String(adapter)` / adapter.toString() 会拿到 rejected Promise，
    // 交由 target 原型链的正常实现（Reflect.get 沿原型找函数）
    if (PROTOTYPE_MEMBERS.has(name)) return Reflect.get(_target, prop);
    // 仅自有键命中（与下方 has trap 的 hasOwnProperty 口径对称，避免沿原型链误命中）
    if (Object.hasOwn(webImpls, name)) return webImpls[name as keyof typeof webImpls];
    return makeFailFast(name);
  },
  // Phase 3 能力门控探测：`'Foo' in browserAdapter` 应反映是否真实现
  has(_target, prop) {
    if (typeof prop === "symbol") return false;
    const name = String(prop);
    // 原型成员沿原型链命中 Object.prototype（toString/constructor 等 8 个恒 true），
    // 与 get trap 的 PROTOTYPE_MEMBERS 豁免对称：门控契约只看自有实现
    if (PROTOTYPE_MEMBERS.has(name)) return false;
    // 仅自有键（webImpls 上的实现）；未实现 binding → false → 能力门控隐藏对应 UI（fail-fast 兜底）
    return Object.hasOwn(webImpls, name);
  },
}) as unknown as AppBindings;

/** Object 原型自有成员白名单（Proxy get 不拦截，交由默认原型行为） */
const PROTOTYPE_MEMBERS = new Set([
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "constructor",
]);
