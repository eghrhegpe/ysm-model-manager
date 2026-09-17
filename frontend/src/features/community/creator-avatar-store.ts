// ===== 创作者头像 store（ADR-264）=====
//
// 为什么头像缓存住在 community 层而不是页面里：
// 写入方是 `download-queue-store.ts`——模块级持久层，`Events.On("queue:file-done")` 在
// **脚本加载时**一次性注册（`_registered` 守卫），下载队列由 Go 侧驱动，**用户离开工坊页
// 后照跑**。因此 `avatar:refresh` 随时可能在任意页面派发。
//
// 原实现把这个缓存借宿在 `AppContentState`（app 壳层的「页面级」容器）上，为了不丢增量，
// 工坊页只能把订阅挂进**全局**桶（`addGlobalOnce`）——代价是工坊页长期持有一张「跳页令牌」：
// 人已离开，回调仍在替它写数据、甚至触发离屏重渲染。寿命错配的字段就该跟着长寿的那一方走。
//
// ⚠️ 形态是**模块级单例**（与 `download-queue-store` 同构、同寿命），遵循该模块 ADR-187 D3
// 的既有裁决：单例在此是**有意设计**——状态生命周期与 `Events.On` 常驻注册绑定。
// 这与 ADR-263 给「页作用域」定的「只给工厂不给单例」**不矛盾**：那条规则针对的是
// **页私有**状态（怕跨页泄漏）；本 store 是**跨页**状态，单例正是它的正确形态，与页面无关。
//
// ⚠️ 单一写入纪律（照抄 download-queue-store）：所有状态修改必须经本模块导出的写函数，
// 禁止模块外直接改返回的对象——绕过 notify 会让订阅者看到陈旧状态。
//
// ⚠️ 两种写语义**刻意不同**，勿「统一」：
//   - `setAvatars` 整表替换（换对象）：对应批量提取的 `avatarCache = avatars` 语义
//   - `setAvatar` 原地增量（不换对象）：对应下载完成后的单作者增量
// 渲染 ctx 是按值注入的（`init-workshop.ts`），故整表替换后旧 ctx 看不到新值——
// 这与上收前**完全一致**，由「提取后重渲染」兜底；若把增量也改成替换，会让
// 已渲染的卡片失去即时更新能力。契约见 creator-avatar-store.test.ts。
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";

/** 头像表：`作者名 → dataUri` */
export type AvatarMap = Record<string, string>;

/**
 * 模块级共享状态（不对外暴露原始引用的写权）。
 *
 * 初始为空：头像由批量提取（`setAvatars`）与下载增量（`setAvatar`）填充。
 */
let STATE: AvatarMap = {};

const listenerSet = createListenerSet<AvatarMap>();

/** 订阅头像表变更（返回取消订阅函数）。回调收到的引用即当前 STATE（活体），请勿修改。 */
export function subscribeAvatars(fn: (avatars: AvatarMap) => void): () => void {
  return listenerSet.subscribe(fn);
}

function notify(): void {
  listenerSet.notify(STATE);
}

/**
 * 当前头像表（**原始引用**，非拷贝）。
 *
 * 返回引用而非拷贝是刻意的：渲染 ctx 按值注入该对象，增量写（`setAvatar`）要能立即
 * 反映到已渲染的卡片上。调用方只读，不得修改。
 */
export function getAvatarSnapshot(): AvatarMap {
  return STATE;
}

/** 单作者头像查询（未命中返回 undefined，供渲染层 `?? 兜底`）。 */
export function getAvatar(author: string): string | undefined {
  return STATE[author];
}

/**
 * 整表替换（批量提取路径）。
 *
 * ⚠️ 空表**不覆盖**：`BatchExtractCreatorAvatars` 在「无 .ysm 文件 / 无 avatar 目录」时
 * 返回空表，代表「这次没提取到」而非「头像都没了」。若照单全收会把上一轮已知头像抹掉，
 * 切回工坊页时卡片全变 "?" 且需等下次提取才自愈。
 */
export function setAvatars(avatars: AvatarMap): void {
  if (Object.keys(avatars).length === 0) return;
  STATE = avatars;
  notify();
}

/** 单作者增量写（下载完成 `avatar:refresh` 路径）。**原地改写，不换对象**——见文件头。 */
export function setAvatar(author: string, dataUri: string): void {
  STATE[author] = dataUri;
  notify();
}

/** 清空（组件销毁 / 测试隔离）。 */
export function clearAvatars(): void {
  STATE = {};
  notify();
}
