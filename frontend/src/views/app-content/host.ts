// ===== app-content 宿主接口（P1-1 从 init-workshop.ts 抽出，归属归位）=====
// 定义所有页面初始化函数需要的组件实例契约。
// 放在独立 host.ts 而非 init-workshop.ts：一个页面初始化器不应定义
// 整个 app-content 组件的共享接口（原 init-workshop.ts:186-204 归属错位）。

import type { PageName } from "@/bus";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { RepoCacheEntry } from "./state.ts";

/** 页面上下文（只读）：root 阴影根 / 当前页名 / 当前站点 */
export interface PageContext {
  readonly _root: ShadowRoot;
  readonly _current: PageName;
  readonly _currentSite: WorkshopSite | null;
}

/** 页面订阅（写入）：页面级卸载桶 + 全局卸载桶 */
export interface PageSubscriptions {
  _unsubs: Array<() => void>;
  _globalUnsubs: Array<() => void>;
}

/** app-content 组件接口（供 workshop/github/settings/diagnostics 初始化函数访问） */
export interface AppContentHost {
  _root: ShadowRoot;
  _unsubs: Array<() => void>;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void;
  _currentSite: WorkshopSite | null;
  _setCurrentSite(site: WorkshopSite | null): void;
  _avatarCache: Record<string, string>;
  _setAvatarCache(cache: Record<string, string>): void;
  _workshopCache: Map<string, RepoCacheEntry> | null;
  _setWorkshopCache(cache: Map<string, RepoCacheEntry> | null): void;
  _githubCache: Map<string, RepoCacheEntry> | null;
  _setGithubCache(cache: Map<string, RepoCacheEntry> | null): void;
  _workshopTimer: ReturnType<typeof setTimeout> | null;
  _setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void;
  _avatarRefreshRegistered: boolean;
  _setAvatarRefreshRegistered(v: boolean): void;
  _insListenerReg: boolean;
}
