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
  label?: string;
  divider?: boolean;
  icon?: string;
  danger?: boolean;
  onClick?: () => void;
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
}

// ── 事件名 → payload 类型映射 ──────────────────────
// void = 无 payload（emit 不带第二参数）

export interface BusEvents {
  // 导航
  "nav:change": NavPagePayload;
  "nav:changed": NavPagePayload;
  // 反馈
  "toast:show": ToastPayload;
  // 数据刷新
  "stats:refresh": void;
  "tree:reload": void;
  "tree:set-search": string; // tree 搜索关键字（app-tree 实证：srch.value = name）
  "avatar:refresh": { author: string; dataUri: string };
  // 模型 / 选择
  "model:select": ModelSelectPayload;
  "package:selected": { name: string; rtype?: string }; // sidebar loader 实证：{name, rtype}
  // 菜单 / 上下文
  "menu:show": { x: number; y: number; items: MenuItem[] };
  "ctx:show": CtxShowPayload;
  // 仓库 / 同步
  "repo:switch-tab": { tab: string };
  "repo:rtype-changed": string;
  "repo:search-creator": string;
  "sync:toggle:status": void;
  "sync:download:missing": { instanceName?: string; rtype?: string; token?: string };
  "sync:download:done": { token?: string; instanceName?: string };
  // 实例 / 导入
  "instance:export-list": { name: string; rtype?: string };
  "instance:clear": { name: string; rtype?: string };
  "instance:install": { name: string; rtype?: string };
  "instance:sync": { name: string; rtype?: string };
  "import:pending-changed": { count: number };
  "import:pending-files": Array<{ name: string; file: File }>;
  "dnd:lock-changed": { locked: boolean };
  // 配置
  "config:updated": void;
  "config:resource-types-changed": void;
  // 批量操作
  "batch:rename": { paths: string[] };
  "batch:enable-all": void;
  "batch:disable-all": void;
  "batch:enable": { dir: string };
  "batch:disable": { dir: string };
  // 目录
  "dir:rename": { dir: string };
  "dir:recycle": { dir: string };
  "dir:mkdir": { dir: string };
  "dir:batch-rename": { dir: string };
  "dir:select-repo": void;
  // 其他
  "loading:start": void;
  "loading:end": void;
  "recycle:open": void;
  "filter:results": Array<{ path: string }>;
  "entries:dedup": void;
}

export type BusEventName = keyof BusEvents;

export interface Bus {
  on<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): () => void;
  off<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): void;
  emit<K extends BusEventName>(event: K, ...args: BusEvents[K] extends void ? [] : [BusEvents[K]]): void;
  once<K extends BusEventName>(event: K, fn: (payload: BusEvents[K]) => void): void;
}

// ── 运行时实现（与原 bus.js 行为完全一致）──────────

let _busInstance: Bus | null = null;

/** 创建一个新 bus 实例 */
function createBus(): Bus {
  const listeners: Partial<Record<BusEventName, Array<(payload: unknown) => void>>> = {};
  // on/off 提取为闭包：unsub 与 once 内部不再依赖 this（解构调用不丢上下文）
  const on: Bus["on"] = (event, fn) => {
    ((listeners[event] as Array<(payload: unknown) => void>) ||= []).push(fn as (payload: unknown) => void);
    return () => off(event, fn);
  };
  const off: Bus["off"] = (event, fn) => {
    const arr = listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn as (payload: unknown) => void);
      if (idx !== -1) arr.splice(idx, 1);
    }
  };
  return {
    on,
    off,
    emit(event, ...args) {
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
      const wrapper = (data: unknown) => {
        off(event, wrapper as never);
        fn(data as never);
      };
      on(event, wrapper as never);
    },
  };
}

/** 默认实例（组件直接使用） */
const bus: Bus = _busInstance || (_busInstance = createBus());

export { bus };
export default bus;

// 兼容：非 module 脚本也可通过 window.bus 访问
declare global {
  interface Window {
    bus: Bus;
  }
}
window.bus = bus;
