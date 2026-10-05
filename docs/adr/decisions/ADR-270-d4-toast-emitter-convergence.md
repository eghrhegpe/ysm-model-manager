# ADR-270-d4：toast:show 发射端收敛战役：162 绕行点迁入 utils/dom/toast.ts 原语，登记表逐条销账

- **状态**：✅ 已采纳（Accepted，2026-10-05 用户「继续」拍板）
- **日期**：2026-10-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

ADR-270-d3 把 bus 发射端锁进 `docs/.bus-emitters.json` 登记表后，`toast:show` 是扇入面最大的一格（52 文件 / 172 点），而 `frontend/src/utils/dom/toast.ts` 早已提供语义原语（`toast` / `toastError` / `toastEmptyRtype`）却只有 10 个点位在用它——162 个点位裸发 `bus.emit("toast:show", …)` 绕行原语，「一条 toast 怎么发」有 N 种写法，改文案/时长/类型语义无法一处生效。

## 决策（三行）

1. **收敛目标**：生产文件中除 `frontend/src/utils/dom/toast.ts`（原语实现本体）外，**禁止**裸发 `bus.emit("toast:show", …)`；一律走 `utils/dom/toast.ts` 的原语（`toast` / `toastError` / 必要时扩 `toastClickable`）。原语与 payload 的字段语义一对一，迁移**零行为变更**。

2. **推进方式**：按文件分批迁移（方向自内向外：`utils/` → `preview-3d/` → `features/` → `views/`），每批完成后从 `docs/.bus-emitters.json` 的 `toast:show` 数组中**删除已迁文件**（`--update` 只减不增天然支持），登记表即进度条；`--strict` 的 `emitterRemovable` 会持续提示可收紧项。

3. **守卫**：不新增独立闸——`event-graph --strict` 的登记表机制已足够（收敛后表内 `toast:show` 只剩原语文件一条；新裸发点 = 表外发射 = 硬错误）。`click` / `undo` 等需要交互的载荷**不属于本轮**（生产面仅 1 处 `click`、0 处 `undo`），需交互时另在该文件保留裸发并显式登记，或扩原语后再迁。

## 后果（一句）

影响面 162 点位 / 51 文件，纯机械替换（152/162 已是 `{msg, duration, type}` 精确对应原语签名，另 9 处 `{msg, duration}` 缺 `type` 等价于默认 `success`、1 处 `{duration}` 仅 `mount-preview-core.ts` 的注入适配器需保留）；回退=按文件 git revert，登记表随码回退即恢复原状，与原语实现解耦。
