// ===== app-sync-manager 组件实例契约（类型下沉，打破 index ↔ 叶模块 循环） =====
// 背景：SyncManagerFields / SyncManagerSelf 原定义在 index.ts，而 store/events/network/
// renderer 四叶模块均 `import type { SyncManagerSelf } from "./index.ts"` 反向依赖主组件
// → 构成 index ↔ leaf 的 type-only 循环。现将契约下沉至此，index 与四叶模块统一从本文件导入，
// 依赖方向收敛为：leaf → self-type（纯类型），index → leaf（运行值）。index re-export 保持旧出口兼容。

import type { LoadGuard } from "@/utils/async/load-guard.ts";
import type { SyncItem } from "./tpl.ts";

/** 自定义字段（子模块通过 SyncManagerSelf 读写） */
export interface SyncManagerFields {
  /** 代际守卫（ADR-230）：全仓唯一出口 createLoadGuard，_gen 裸计数退役 */
  _guard: LoadGuard;
  _instance: string;
  _selectedType: string;
  _subtype: string;
  _statusFilter: string;
  /** 单行操作在途 path 集合（按 path 粒度防重入；不同 path 可并发 push/pull，P2 修复） */
  _singleBusy: Set<string>;
  _allItems: SyncItem[];
  _filteredItems: SyncItem[];
  /** 筛选后强制展开的目录 path 集合（status 筛选下「有命中后代的目录」，见 store.applyFilter） */
  _forceOpenPaths?: Set<string>;
  _typeConfig: Array<{ id: string; name?: string; icon?: string; dirLevelSync?: boolean }>;
  _loading: boolean;
  /** 展开/折叠状态（dir-level 层级展示用，key = item path） */
  _dirOpen: Record<string, boolean>;
  /** 各资源类型在 FilesRoot 下的仓库根路径缓存 */
  _filesRoots: Record<string, string>;
  /** 各资源类型实际同步目录对（GetSyncScanDirs 结果：global=仓库基准, instance=实例扫描；
   *  warningCode=结构化告警码（scan_dir_wide），warningParams=告警参数，显示文案由 i18n 组装） */
  _scanDirs: Record<
    string,
    {
      global: string;
      instance: string;
      warningCode?: string;
      warningParams?: { label: string; dir: string; subDir: string };
    }
  >;
  /** 当前回调引用容器（bindDelegatedEvents 一次性绑定后，后续 _init 仅更新此对象） */
  _cbRef:
    | {
        cb: {
          doRender: () => void;
          doPerformOp: (op: "push" | "pull", path: string) => Promise<void>;
        };
      }
    | undefined;
  /** click handler 引用（一次性绑定后存储，供 disconnectedCallback 清理） */
  _clickHandler: ((e: Event) => void) | null;
  /** click 委托 unsub（生命周期跟随元素连接，不随 _init——re-init 不得销毁委托） */
  _clickUnsub: (() => void) | undefined;
  /** 收窄 querySelector 返回类型（DOM 原生返回 Element，消费方需要 HTMLElement） */
  querySelector(sel: string): HTMLElement | null;
}

/** 合并四子模块（store / renderer / events / network）对组件实例的接口需求，
 * 一统江湖，消除各处 `as any` 桥接。各子模块可改从此导入。
 * DOM 能力由 HTMLElement 继承（Omit 移除原生 querySelector 后由 SyncManagerFields 覆盖返回类型）。 */
export type SyncManagerSelf = Omit<HTMLElement, "querySelector"> & SyncManagerFields;
