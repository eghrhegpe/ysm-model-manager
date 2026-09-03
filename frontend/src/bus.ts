// ===== 全局事件总线（类型化版 — ADR-014 P1 渐进迁移）=====
// 组件 `import { bus }` 使用。
// 类型契约：事件名拼错 / payload 形状错 → 编译期报错（.ts 调用方受益，.js 存量不受影响）。

// ── 事件 payload 类型 ───────────────────────────────

export interface ToastPayload {
  msg: string;
  duration?: number;
  /** 直接拼入 toast className（app-toast.js），合法值以 CSS class 为准：warn/success/error/info */
  type?: "info" | "success" | "error" | "warn";
  /** 点击 toast 时的回调（app-toast.js 支持，version-updater 用） */
  click?: () => void;
  /** 撤销按钮回调（app-toast.js 支持） */
  undo?: () => void;
}

export interface MenuItem {
  /** 行为标识（来自 menu-defs.ts，测试按此匹配） */
  action?: string | undefined;
  label?: string | undefined;
  divider?: boolean;
  icon?: string;
  danger?: boolean;
  onClick?: (() => void) | undefined;
  // disabled / submenu 字段暂无调用方，按需再补
}

/** 核心页面名（与 app-nav 导航菜单一致） */
export type PageName =
  | "repository"
  | "instances"
  | "workshop"
  | "github"
  | "diagnostics"
  | "settings";

export interface NavPagePayload {
  page: PageName;
}

export interface ModelSelectPayload {
  path: string;
  isDir?: boolean;
  /** 已分类的资源类型 ID（如 "EntityPlayer"）；发射点已知时带上，消费端优先用，
   *  缺失（undefined/空串）时回退 Go DetectResourceType 探测——避免歧义扩展名重复探测 */
  rtype?: string;
}

export interface CtxShowPayload {
  x: number;
  y: number;
  type: "instance" | "batch" | "file" | "dir";
  instanceName?: string;
  path?: string;
  banned?: boolean;
  dir?: string;
  name?: string;
  count?: number;
  paths?: string[];
  rtype?: string;
  /** MMD 用途子目录（全局 repo_subdir 选择，MMD 类型可选子目录；阶段 1 打开文件夹精确化） */
  subdir?: string;
}

// ── 事件名 → payload 类型映射 ──────────────────────
// void = 无 payload（emit 不带第二参数）

export interface BusEvents {
  // 导航
  "nav:changed": NavPagePayload;
  // i18n
  "lang:changed": { lang: string };
  // 反馈
  "toast:show": ToastPayload;
  // 数据刷新
  "stats:refresh": void;
  "tree:reload": void;
  "community:clearCache": void; // features → views 解耦（download-queue 触发社区缓存失效）
  "tree:set-search": string; // tree 搜索关键字（app-tree 实证：srch.value = name）
  "avatar:refresh": { author: string; dataUri: string };
  // 模型 / 选择
  "model:select": ModelSelectPayload;
  // rtype 必填（与 instance:export-list/clear 同款收紧）：发射点（app-sidebar）
  // 已显式拦截空 rtype（toast 报错不 emit），消费端（app-content init-pages）
  // 有 !rtype 守卫；收紧为必填让编译期堵漏「漏传 → 同步面板静默错成 YSM」回归。
  "package:selected": { name: string; rtype: string };
  // 菜单 / 上下文
  "menu:show": { x: number; y: number; items: MenuItem[] };
  "ctx:show": CtxShowPayload;
  // 仓库 / 同步
  "repo:rtype-changed": string;
  "repo:subdir-changed": string; // MMD 子目录选择（ADR-095 后续）：sync 页按 subdir 过滤
  "repo:search-creator": string;
  "sync:toggle:status": void;
  "sync:download:missing": { instanceName?: string; rtype: string; token?: string };
  "sync:download:done": { token?: string; instanceName?: string; skipped?: boolean; skipReason?: "busy" | "config" | "error" };
  // 实例 / 导入
  // rtype 必填（P0 修复后收紧契约）：消费方（instance-ops）已有 !rtype 显式失败
  // 守卫，发射点编译期强制提供非空 rtype，堵漏「漏传 → 导出/清空全部类型」回归。
  "instance:export-list": { name: string; rtype: string };
  "instance:clear": { name: string; rtype: string };
  // 批量操作
  "batch:rename": { paths: string[] };
  "batch:enable-all": void;
  "batch:disable-all": void;
  // 目录
  "dir:rename": { dir: string };
  "dir:recycle": { dir: string };
  "dir:mkdir": { dir: string };
  "dir:batch-rename": { dir: string };
}

export type BusEventName = keyof BusEvents;

// ── void 事件契约 ─────────────────────────────────────
// emit 缺参告警的唯一权威清单：必须与 BusEvents 里的 `: void` 标记同步。
// 双方向都编译期兜底——新增 void 事件漏加清单（完整性校验）、或非 void 事件误入清单
// （satisfies 元素级校验）都会报类型错误，杜绝「类型改了、告警清单没跟」的漂移。
type VoidEventName = {
  [K in BusEventName]: BusEvents[K] extends void ? K : never;
}[BusEventName];

const VOID_EVENTS = [
  "stats:refresh",
  "tree:reload",
  "community:clearCache",
  "sync:toggle:status",
  "batch:enable-all",
  "batch:disable-all",
] as const satisfies readonly VoidEventName[];

const isVoidEvent = (event: BusEventName): boolean =>
  (VOID_EVENTS as readonly string[]).includes(event);

export interface Bus {
  on<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): () => void;
  off<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): void;
  emit<K extends BusEventName>(event: K, ...args: BusEvents[K] extends void ? [] : [BusEvents[K]]): void;
  once<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): () => void;
}

// ── 运行时实现（与原 bus.js 行为完全一致）──────────

let _busInstance: Bus | null = null;

/** 创建一个新 bus 实例 */
function createBus(): Bus {
  const listeners: Partial<Record<BusEventName, Array<(payload: unknown) => void>>> = {};
  // on/off 提取为闭包：unsub 与 once 内部不再依赖 this（解构调用不丢上下文）。
  // 闭包签名保留泛型（Bus["on"]/Bus["off"]）——内部 push/indexOf 时转内部存储类型
  // (payload: unknown) => void（listeners 的存储类型）。
  const on: Bus["on"] = (event, fn) => {
    ((listeners[event] as Array<(payload: unknown) => void>) ||= []).push(fn as (payload: unknown) => void);
    return () => off(event, fn);
  };
  const off: Bus["off"] = (event, fn) => {
    const arr = listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn as (payload: unknown) => void);
      if (idx !== -1) {
        arr.splice(idx, 1);
        // P4 修复（审核）：handler 全部移除后回收事件名键，避免空数组永久驻留
        if (arr.length === 0) delete listeners[event];
      }
    }
  };
  return {
    on,
    off,
    emit(event, ...args) {
      // P2 修复（审核）：非 void 事件缺参 emit 会让 handler 解构抛错（被 try/catch 吞掉
      // → 静默不触发）。dev 模式给出显式告警；.js/内联脚本存量调用方借此暴露缺参
      // 原实现手抄 8 个 void 事件名第二份清单，现复用 isVoidEvent 消除漂移源
      if (args.length === 0 && !isVoidEvent(event)) {
        console.warn(`[bus] 事件 "${event}" 声明带 payload，emit 未传参数`);
      }
      // 拷贝快照再遍历：handler 内 on/off 修改注册表不影响本次派发
      (listeners[event] || []).slice().forEach((fn) => {
        try {
          fn(args[0]);
        } catch (e) {
          console.error(`[bus] 事件 "${event}" 处理出错:`, e);
        }
      });
    },
    once(event, fn) {
      // wrapper 与 fn 同签名（泛型窄类型），内部传给 on/off 时由闭包转内部存储类型；
      // 无需 as never——wrapper 的 payload 类型与 event 的 BusEvents[K] 一致
      const wrapper: (payload: BusEvents[typeof event]) => void = (data) => {
        off(event, wrapper);
        fn(data);
      };
      on(event, wrapper);
      // P2 修复：返回退订函数（与 on 契约对齐）——事件永不触发时调用方可主动移除 wrapper，
      // 否则 wrapper 永久驻留全局单例 listeners，且 off(event, 原fn) 按引用匹配不到 wrapper（幽灵监听器）
      return () => off(event, wrapper);
    },
  };
}

/** 默认实例（组件直接使用） */
const bus: Bus = _busInstance || (_busInstance = createBus());

export { bus };
export default bus;

// index.html 内联脚本通过 window.bus 访问（ES module 无法被内联脚本直接 import）
declare global {
  interface Window {
    bus: Bus;
  }
}
// node 测试环境无 window（vitest @vitest-environment node），跳过挂载
if (typeof window !== "undefined") window.bus = bus;
