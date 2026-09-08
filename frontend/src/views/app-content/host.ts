// ===== app-content 宿主接口 =====
// 定义所有页面初始化函数需要的组件实例契约。
// 状态已抽出到 AppContentState / SubscriptionBucket，host 直接暴露二者即可，
// 消灭 index.ts 中 75 行机械的 get _x() { return this.state.xxx; } 委托。

import type { AppContentState } from "./state.ts";
import type { SubscriptionBucket } from "./subscription-bucket.ts";

export interface AppContentHost {
  state: AppContentState;
  subs: SubscriptionBucket;
}
