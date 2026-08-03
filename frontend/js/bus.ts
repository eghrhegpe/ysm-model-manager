// ===== 全局事件总线（类型化版 — ADR-014 P1 渐进迁移）=====
// 组件 `import { bus }` 使用，入口层可用 `setBus(mockBus)` 替换。
// 类型契约：事件名拼错 / payload 形状错 → 编译期报错（.ts 调用方受益，.js 存量不受影响）。

// ── 事件 payload 类型 ───────────────────────────────

export interface ToastPayload {
  msg: string;
  duration?: number;
  /** 直接拼入 toast className（app-toast.js），合法值以 CSS class 为准：warn/success/error/info */
  type?: "info" | "success" | "error" | "warn";
}

export interface MenuItem {
  label?: string;
  divider?: boolean;
  icon?: string;
  danger?: boolean;
  onClick?: () => void;
  // TODO: disabled / submenu 等字段待补
}

export interface NavPagePayload {
  page: string;
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
  "stats:upload": void;
  "logs:refresh": void;
  "tree:reload": void;
  "tree:set-search": string; // TODO: 确认 payload（tree 搜索关键字）
  "avatar:refresh": { author: string; dataUri: string };
  // 模型 / 选择
  "model:select": ModelSelectPayload;
  "package:selected": object; // TODO: 细化 pkg 结构
  // 菜单 / 上下文
  "menu:show": { x: number; y: number; items: MenuItem[] };
  "ctx:show": CtxShowPayload;
  // 仓库 / 同步
  "repo:switch-tab": { tab: string };
  "repo:rtype-changed": string;
  "repo:search-creator": string;
  "sync:toggle:status": void;
  "sync:toggle:done": void;
  "sync:download:missing": { instanceName?: string; rtype?: string; token?: string };
  "sync:download:done": void;
  "sync:upload:done": void;
  // 实例 / 导入
  "instance:export-list": { name: string; rtype?: string };
  "instance:clear": { name: string; rtype?: string };
  "instance:install": void;
  "instance:sync": void;
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
  "batch:enable": void;
  "batch:disable": void;
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
  "mmd:sync-variant-folder": { instanceName: string; folderPath: string; rtype: string };
  "filter:results": void;
  "entry:toggle": void;
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
  return {
    on(event, fn) {
      ((listeners[event] as Array<(payload: unknown) => void>) ||= []).push(fn as (payload: unknown) => void);
      return () => this.off(event, fn);
    },
    off(event, fn) {
      const arr = listeners[event];
      if (arr) {
        const idx = arr.indexOf(fn as (payload: unknown) => void);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    emit(event, ...args) {
      (listeners[event] || []).forEach((fn) => {
        try {
          fn(args[0]);
        } catch (e) {
          console.error(`[bus] 事件 "${event}" 处理出错:`, e);
        }
      });
    },
    once(event, fn) {
      const wrapper = (data: unknown) => {
        fn(data as never);
        this.off(event, fn);
      };
      this.on(event, wrapper as never);
    },
  };
}

/** 默认实例（组件直接使用） */
const bus: Bus = _busInstance || (_busInstance = createBus());

/** 替换 bus 实例（入口层 / 测试用） */
export function setBus(newBus: Bus): void {
  _busInstance = newBus;
}

export { bus };
export default bus;

// 兼容：非 module 脚本也可通过 window.bus 访问
declare global {
  interface Window {
    bus: Bus;
  }
}
window.bus = bus;
